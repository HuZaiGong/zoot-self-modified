(() => {
    'use strict';

    const state = { job: null, diff: null, busy: false };
    const labels = {
        story: '长剧情', lore: '世界书', character: '自定义角色',
        image: '生图预设', sampling: '采样建议', workflow: 'ComfyUI工作流',
        artist_style: '画师串'
    };

    function element(id) {
        return document.getElementById(id);
    }

    function readableError(error) {
        if (typeof error === 'string') return error;
        const detail = error && (error.detail || error.error || error.message);
        if (typeof detail === 'string') return detail;
        try { return JSON.stringify(detail || error); } catch (_) { return '请求失败'; }
    }

    async function request(url, options = {}) {
        const response = await fetch(url, options);
        const text = await response.text();
        let body = {};
        try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { detail: text }; }
        if (!response.ok) throw new Error(readableError(body));
        return body;
    }

    function setStatus(message, failed = false) {
        const node = element('preset-import-status');
        if (!node) return;
        node.textContent = message;
        node.classList.toggle('error', failed);
    }

    function selectedComponents() {
        return Array.from(document.querySelectorAll('#preset-import-components input:checked'))
            .map(input => input.value);
    }

    function renderComponents(components) {
        const host = element('preset-import-components');
        if (!host) return;
        host.replaceChildren();
        Object.entries(components || {}).forEach(([key, enabled]) => {
            if (!enabled) return;
            const label = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = key;
            input.checked = true;
            label.append(input, document.createTextNode(labels[key] || key));
            host.append(label);
        });
        if (components && components.image) {
            const label = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = 'artist_style';
            label.append(input, document.createTextNode('画师串（如存在）'));
            host.append(label);
        }
    }

    async function loadProfiles() {
        const select = element('preset-import-profile');
        if (!select) return;
        try {
            const body = await request('/api-connections/profiles?capability=image_generation');
            const profiles = body.profiles || body.items || (Array.isArray(body) ? body : []);
            profiles.forEach(profile => {
                const option = document.createElement('option');
                option.value = profile.profile_id;
                option.dataset.revision = String(profile.revision || 0);
                option.textContent = profile.display_name + ' · ' +
                    (profile.models && profile.models.image_generation || '未选择模型');
                select.append(option);
            });
        } catch (_) {
            // API profile selection is optional.
        }
    }

    async function refreshDiff() {
        if (!state.job) return;
        state.diff = await request('/preset-imports/' + encodeURIComponent(state.job.import_id) + '/diff');
        element('preset-import-before').textContent = JSON.stringify(
            (state.job.preview || {}).source_structure || state.diff.source || {}, null, 2
        );
        element('preset-import-after').textContent = JSON.stringify(state.diff.proposed || {}, null, 2);
        element('preset-import-warnings').textContent = JSON.stringify({
            warnings: state.diff.warnings || [],
            quarantined_fields: state.diff.quarantined_fields || [],
            conflicts: state.diff.conflicts || []
        }, null, 2);
        element('preset-import-diff-card').hidden = false;
    }

    async function inspect() {
        const file = element('preset-import-file').files[0];
        if (!file || state.busy) {
            if (!file) setStatus('请先选择文件', true);
            return;
        }
        state.busy = true;
        setStatus('正在进行格式识别和安全扫描…');
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('mime_type', file.type || '');
        try {
            state.job = await request('/preset-imports/inspect', { method: 'POST', body: form });
            renderComponents(state.job.preview && state.job.preview.components);
            element('preset-import-scope-card').hidden = false;
            const chatRoute = (state.job.conversion_routes || {}).chat || {};
            const visionRoute = (state.job.conversion_routes || {}).vision || {};
            setStatus('预检完成：' + state.job.source_format +
                (state.job.deduplicated ? '（已复用相同来源任务）' : '') +
                '；Chat：' + (chatRoute.configured ? chatRoute.display_name + '/' + chatRoute.model : '未配置') +
                '；图片理解：' + (visionRoute.configured ? visionRoute.display_name + '/' + visionRoute.model : '未配置'));
            await refreshDiff();
        } catch (error) {
            setStatus(readableError(error), true);
        } finally {
            state.busy = false;
            element('preset-import-cancel').hidden = true;
        }
    }

    async function cancelTransform() {
        if (!state.job) return;
        try {
            state.job = await request('/preset-imports/' + encodeURIComponent(state.job.import_id) + '/cancel', { method: 'POST' });
            setStatus('已请求停止；当前正在执行的单次调用结束后，不再进入下一阶段。');
        } catch (error) {
            setStatus(readableError(error), true);
        }
    }

    async function transform() {
        if (!state.job || state.busy) return;
        const mode = element('preset-import-llm-mode').value;
        const consent = element('preset-import-cost-consent').checked;
        if (mode !== 'none' && !consent) {
            setStatus('使用LLM前必须确认档案、模型、输入范围和费用风险', true);
            return;
        }
        state.busy = true;
        element('preset-import-cancel').hidden = mode === 'none';
        setStatus(mode === 'none' ? '正在刷新确定性草稿…' : '正在调用能力路由转换；失败不会丢失确定性草稿…');
        try {
            state.job = await request('/preset-imports/' + encodeURIComponent(state.job.import_id) + '/transform', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode, allow_cost: mode !== 'none' && consent })
            });
            setStatus('转换草稿已更新；本任务累计模型请求 ' + (state.job.calls || []).length + '/3');
            await refreshDiff();
        } catch (error) {
            setStatus(readableError(error), true);
        } finally {
            state.busy = false;
            element('preset-import-cancel').hidden = true;
        }
    }

    async function approve() {
        if (!state.job || state.busy) return;
        const components = selectedComponents();
        if (!components.length) {
            setStatus('请至少选择一个要批准的组件', true);
            return;
        }
        const profile = element('preset-import-profile');
        const selected = profile.options[profile.selectedIndex];
        const payload = {
            expected_revision: state.job.revision,
            components,
            character_id: element('preset-import-character-id').value.trim(),
            target_image_profile_id: profile.value,
            expected_profile_revision: selected && selected.dataset.revision ?
                Number(selected.dataset.revision) : null,
            apply_technical_defaults: element('preset-import-apply-profile').checked
        };
        state.busy = true;
        setStatus('正在按组件写入正式预设库…');
        try {
            state.job = await request('/preset-imports/' + encodeURIComponent(state.job.import_id) + '/approve', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            setStatus('批准完成。规范化预设可参与可信设备同步；原文件仍只保存在本机。');
            element('preset-import-rollback').hidden = false;
        } catch (error) {
            setStatus(readableError(error), true);
        } finally {
            state.busy = false;
        }
    }

    async function rollback() {
        if (!state.job || state.busy) return;
        state.busy = true;
        setStatus('正在创建回滚修订…');
        try {
            state.job = await request('/preset-imports/' + encodeURIComponent(state.job.import_id) + '/rollback', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ expected_revision: state.job.revision })
            });
            const conflicts = state.job.rollback_conflicts || [];
            setStatus(conflicts.length ? '回滚完成，但有需要人工处理的冲突' : '回滚完成', conflicts.length > 0);
        } catch (error) {
            setStatus(readableError(error), true);
        } finally {
            state.busy = false;
        }
    }

    function openImporter() {
        if (typeof window.showPage === 'function') window.showPage('preset-importer');
    }

    function init() {
        element('preset-import-inspect')?.addEventListener('click', inspect);
        element('preset-import-transform')?.addEventListener('click', transform);
        element('preset-import-cancel')?.addEventListener('click', cancelTransform);
        element('preset-import-approve')?.addEventListener('click', approve);
        element('preset-import-rollback')?.addEventListener('click', rollback);
        document.addEventListener('click', event => {
            const tab = event.target.closest('[data-story-tab="imports"]');
            if (tab) {
                event.preventDefault();
                event.stopImmediatePropagation();
                openImporter();
            }
            const button = event.target.closest('[data-open-preset-importer]');
            if (button) openImporter();
        }, true);
        const editor = document.getElementById('image-workspace-preset-editor');
        if (editor && !editor.querySelector('[data-open-preset-importer]')) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn-secondary';
            button.dataset.openPresetImporter = 'true';
            button.textContent = '导入酒馆／生图预设';
            editor.append(button);
        }
        loadProfiles();
    }

    window.openPresetImporter = openImporter;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
