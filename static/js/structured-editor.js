// 通用长文本与结构化档案编辑器
(function () {
    'use strict';

    const enhancedTextareas = new WeakSet();
    const resizeHandlers = new WeakMap();
    const supportedTextareaIds = new Set([
        'doctor-extra-prompt', 'clone-editor-extra-prompt', 'extra-prompt',
        'rhodes-entry-content', 'import-config-text'
    ]);

    function getViewportHeight() {
        return window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 800;
    }

    function estimateTokens(text) {
        const value = String(text || '');
        let weighted = 0;
        for (const ch of value) {
            weighted += /[\u3400-\u9fff\uf900-\ufaff]/.test(ch) ? 1 : 0.35;
        }
        return Math.max(0, Math.ceil(weighted));
    }

    function updateTextStats(text, statsElement) {
        if (!statsElement) return;
        const length = String(text || '').length;
        statsElement.textContent = `${length.toLocaleString('zh-CN')} 字符 · 预计 ${estimateTokens(text).toLocaleString('zh-CN')} tokens`;
    }

    function resizeTextarea(textarea) {
        if (!textarea || textarea.classList.contains('fullscreen-text-editor-input')) return;
        const isArrayEntry = textarea.classList.contains('profile-array-entry-textarea');
        const computedStyle = getComputedStyle(textarea);
        const lineHeight = parseFloat(computedStyle.lineHeight) || 20;
        const verticalPadding = (parseFloat(computedStyle.paddingTop) || 0)
            + (parseFloat(computedStyle.paddingBottom) || 0)
            + (parseFloat(computedStyle.borderTopWidth) || 0)
            + (parseFloat(computedStyle.borderBottomWidth) || 0);
        const minHeight = isArrayEntry
            ? Math.ceil(lineHeight + verticalPadding)
            : Math.round(getViewportHeight() * 0.25);
        const maxHeight = Math.round(getViewportHeight() * 0.5);
        textarea.style.minHeight = `${minHeight}px`;
        textarea.style.maxHeight = `${maxHeight}px`;
        textarea.style.height = 'auto';
        const nextHeight = Math.max(minHeight, Math.min(maxHeight, textarea.scrollHeight + 2));
        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }

    function getDraftKey(textarea) {
        const identity = textarea.dataset.draftKey || textarea.id || textarea.name;
        if (!identity) return '';
        const page = document.querySelector('.page.active-page')?.id || location.hash || 'global';
        return `zoot_text_draft:${page}:${identity}`;
    }

    function saveDraft(textarea, value) {
        const key = getDraftKey(textarea);
        if (!key) return;
        try {
            localStorage.setItem(key, JSON.stringify({ value, updatedAt: Date.now() }));
        } catch (error) {
            console.warn('[文本编辑器] 草稿保存失败:', error);
        }
    }

    function clearDraft(textarea) {
        const key = getDraftKey(textarea);
        if (!key) return;
        try { localStorage.removeItem(key); } catch (_) {}
    }

    function readDraft(textarea) {
        const key = getDraftKey(textarea);
        if (!key) return null;
        try {
            const draft = JSON.parse(localStorage.getItem(key) || 'null');
            return draft && typeof draft.value === 'string' ? draft : null;
        } catch (_) {
            return null;
        }
    }

    function dispatchTextChange(textarea, includeCommit = false) {
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        if (includeCommit) {
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            textarea.dispatchEvent(new Event('blur', { bubbles: true }));
        }
    }

    function shouldEnhance(textarea) {
        if (!(textarea instanceof HTMLTextAreaElement)) return false;
        if (textarea.id === 'message') return false;
        if (textarea.classList.contains('no-workbench')) return false;
        if (textarea.closest('.fullscreen-text-editor-overlay, .structured-import-overlay')) return false;
        return supportedTextareaIds.has(textarea.id)
            || textarea.classList.contains('structured-json-editor')
            || Boolean(textarea.closest('.profile-tree, #custom-operator-form'));
    }

    function enhanceTextarea(textarea) {
        if (!shouldEnhance(textarea) || enhancedTextareas.has(textarea)) return;
        enhancedTextareas.add(textarea);
        textarea.classList.add('zoot-adaptive-textarea');

        const wrapper = document.createElement('div');
        wrapper.className = 'textarea-workbench-wrapper';
        textarea.parentNode.insertBefore(wrapper, textarea);
        wrapper.appendChild(textarea);

        const expandButton = document.createElement('button');
        expandButton.type = 'button';
        expandButton.className = 'textarea-workbench-button';
        expandButton.title = '全页编辑';
        expandButton.setAttribute('aria-label', '全页编辑');
        expandButton.innerHTML = '<img src="/static/images/img_workbench.png" alt="">';
        expandButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            openFullscreenTextEditor(textarea);
        });
        wrapper.appendChild(expandButton);

        const handler = () => {
            resizeTextarea(textarea);
            saveDraft(textarea, textarea.value);
        };
        resizeHandlers.set(textarea, handler);
        textarea.addEventListener('input', handler);
        requestAnimationFrame(() => resizeTextarea(textarea));
    }

    function enhanceTextareas(root = document) {
        if (root instanceof HTMLTextAreaElement) {
            enhanceTextarea(root);
            return;
        }
        root.querySelectorAll?.('textarea').forEach(enhanceTextarea);
    }

    function ensureFullscreenEditor() {
        let overlay = document.getElementById('fullscreen-text-editor');
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'fullscreen-text-editor';
        overlay.className = 'fullscreen-text-editor-overlay';
        overlay.innerHTML = `
            <section class="fullscreen-text-editor-panel" role="dialog" aria-modal="true">
                <header class="fullscreen-text-editor-header">
                    <h2 id="fullscreen-text-editor-title">全页文本编辑</h2>
                    <button type="button" id="fullscreen-text-editor-close" aria-label="关闭">${ZootIcons.html('close')}</button>
                </header>
                <textarea id="fullscreen-text-editor-input" class="fullscreen-text-editor-input no-workbench"></textarea>
                <footer class="fullscreen-text-editor-footer">
                    <small id="fullscreen-text-editor-stats"></small>
                    <div>
                        <button type="button" id="fullscreen-text-editor-cancel">关闭</button>
                        <button type="button" id="fullscreen-text-editor-save" class="primary">保存</button>
                    </div>
                </footer>
            </section>`;
        document.body.appendChild(overlay);
        return overlay;
    }

    function inferEditorTitle(source) {
        return source.dataset.editorTitle
            || source.closest('.settings-item, .drawer-content, .profile-tree-item, .rhodes-entry-editor-body')?.querySelector('label, .tree-label, summary, span')?.textContent?.trim()
            || source.getAttribute('placeholder')
            || '全页文本编辑';
    }

    function openFullscreenTextEditor(source, options = {}) {
        if (!source) return;
        const overlay = ensureFullscreenEditor();
        const input = overlay.querySelector('#fullscreen-text-editor-input');
        const stats = overlay.querySelector('#fullscreen-text-editor-stats');
        const title = overlay.querySelector('#fullscreen-text-editor-title');
        const saveButton = overlay.querySelector('#fullscreen-text-editor-save');
        const closeButton = overlay.querySelector('#fullscreen-text-editor-close');
        const cancelButton = overlay.querySelector('#fullscreen-text-editor-cancel');
        let timer = null;
        let saving = false;

        title.textContent = options.title || inferEditorTitle(source);
        const draft = readDraft(source);
        let initialValue = source.value || '';
        if (draft && draft.value !== initialValue && confirm('发现该文本框的未提交草稿，是否恢复？')) {
            initialValue = draft.value;
        }
        input.value = initialValue;
        updateTextStats(input.value, stats);
        overlay.classList.add('active');
        document.body.classList.add('fullscreen-editor-open');

        const sync = async (commit = false) => {
            source.value = input.value;
            saveDraft(source, input.value);
            dispatchTextChange(source, commit);
            resizeTextarea(source);
            if (commit && typeof source._fullEditorSave === 'function') {
                saving = true;
                saveButton.disabled = true;
                try {
                    await source._fullEditorSave();
                    clearDraft(source);
                } finally {
                    saving = false;
                    saveButton.disabled = false;
                }
            }
            if (commit) clearDraft(source);
        };

        const close = async () => {
            if (saving) return;
            clearTimeout(timer);
            await sync(false);
            overlay.classList.remove('active');
            document.body.classList.remove('fullscreen-editor-open');
            input.oninput = null;
        };

        input.oninput = () => {
            updateTextStats(input.value, stats);
            clearTimeout(timer);
            timer = setTimeout(() => sync(false), 450);
        };
        saveButton.onclick = async () => {
            clearTimeout(timer);
            await sync(true);
            overlay.classList.remove('active');
            document.body.classList.remove('fullscreen-editor-open');
        };
        closeButton.onclick = close;
        cancelButton.onclick = close;
        overlay.onclick = event => {
            if (event.target === overlay) close();
        };
        setTimeout(() => input.focus(), 0);
    }

    function replaceRootData(target, source) {
        if (!target || typeof target !== 'object' || !source || typeof source !== 'object') {
            throw new Error('档案根节点必须是 JSON 对象');
        }
        if (Array.isArray(target) !== Array.isArray(source)) {
            throw new Error('导入数据的根节点类型与当前档案不一致');
        }
        if (Array.isArray(target)) {
            target.splice(0, target.length, ...source);
            return;
        }
        Object.keys(target).forEach(key => delete target[key]);
        Object.assign(target, source);
    }

    async function parseStructuredJson(text) {
        try {
            return JSON.parse(text);
        } catch (_) {
            const response = await fetch('/structured-profile/repair-json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            const payload = await response.json();
            if (!response.ok || payload.status !== 'ok') {
                throw new Error(payload.detail || 'JSON 结构错误且自动修复失败');
            }
            return payload.data;
        }
    }

    function setStructuredToolbarMode(toolbar, mode) {
        if (!toolbar) return;
        toolbar.dataset.activeMode = mode;
        toolbar.querySelectorAll('[data-mode]').forEach(button => {
            const isActive = button.dataset.mode === mode;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });
    }

    function buildStructuredToolbar(container, rootData, onSave, rerender, activeMode = 'tree') {
        const toolbar = document.createElement('div');
        toolbar.className = 'structured-profile-toolbar';
        toolbar.setAttribute('role', 'group');
        toolbar.setAttribute('aria-label', '档案编辑模式');
        toolbar.innerHTML = `
            <button type="button" data-mode="tree" aria-pressed="false">树形</button>
            <button type="button" data-mode="json" aria-pressed="false">JSON</button>
            <button type="button" data-mode="import" aria-pressed="false">文本智能导入</button>`;
        setStructuredToolbarMode(toolbar, activeMode);
        toolbar.querySelector('[data-mode="tree"]').onclick = rerender;
        toolbar.querySelector('[data-mode="json"]').onclick = () => showJsonEditor(container, rootData, onSave, rerender);
        toolbar.querySelector('[data-mode="import"]').onclick = () => {
            const returnMode = toolbar.dataset.activeMode === 'json' ? 'json' : 'tree';
            setStructuredToolbarMode(toolbar, 'import');
            openStructuredTextImporter(
                rootData,
                onSave,
                () => {
                    if (returnMode === 'json') {
                        showJsonEditor(container, rootData, onSave, rerender);
                    } else {
                        rerender();
                    }
                },
                () => setStructuredToolbarMode(toolbar, returnMode)
            );
        };
        container.appendChild(toolbar);
        return toolbar;
    }

    function showJsonEditor(container, rootData, onSave, rerender) {
        container.innerHTML = '';
        buildStructuredToolbar(container, rootData, onSave, rerender, 'json');

        const textarea = document.createElement('textarea');
        textarea.className = 'structured-json-editor';
        textarea.dataset.editorTitle = 'JSON 结构化档案';
        textarea.value = JSON.stringify(rootData, null, 2);
        container.appendChild(textarea);

        const actions = document.createElement('div');
        actions.className = 'structured-json-actions';
        actions.innerHTML = '<span class="structured-json-status">可直接复制、粘贴或修改 JSON</span><button type="button">应用到树形档案</button>';
        container.appendChild(actions);
        enhanceTextarea(textarea);

        actions.querySelector('button').onclick = async () => {
            const status = actions.querySelector('.structured-json-status');
            try {
                const parsed = await parseStructuredJson(textarea.value);
                replaceRootData(rootData, parsed);
                if (typeof onSave === 'function') await onSave();
                status.textContent = '已应用并保存';
                rerender();
            } catch (error) {
                status.textContent = error.message;
                status.classList.add('error');
                window.showTemporaryToast?.(error.message, 3000, 'error');
            }
        };
    }

    function ensureStructuredImporter() {
        let overlay = document.getElementById('structured-profile-importer');
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'structured-profile-importer';
        overlay.className = 'structured-import-overlay';
        overlay.innerHTML = `
            <section class="structured-import-panel">
                <header><h2>文本智能导入</h2><button type="button" data-action="close" aria-label="关闭">${ZootIcons.html('close')}</button></header>
                <p>粘贴完整人物设定或档案文本，模型会依照当前档案结构整理字段。生成结果会先应用到编辑器，再由原有保存机制保存。</p>
                <textarea class="structured-import-input no-workbench" placeholder="在此粘贴长文本……"></textarea>
                <footer>
                    <small class="structured-import-stats"></small>
                    <div><button type="button" data-action="cancel">取消</button><button type="button" class="primary" data-action="generate">解析并导入</button></div>
                </footer>
            </section>`;
        document.body.appendChild(overlay);
        return overlay;
    }

    function openStructuredTextImporter(rootData, onSave, onApplied, onDismiss) {
        const overlay = ensureStructuredImporter();
        const input = overlay.querySelector('.structured-import-input');
        const stats = overlay.querySelector('.structured-import-stats');
        const generate = overlay.querySelector('[data-action="generate"]');
        const notify = (message, type = 'error') => {
            if (typeof window.showTemporaryToast === 'function') {
                window.showTemporaryToast(message, 3000, type);
                return;
            }
            input.setCustomValidity(message);
            input.reportValidity();
            input.setCustomValidity('');
        };
        const close = (applied = false) => {
            overlay.classList.remove('active');
            if (!applied) onDismiss?.();
        };
        input.value = '';
        updateTextStats('', stats);
        overlay.classList.add('active');
        input.oninput = () => updateTextStats(input.value, stats);
        overlay.querySelector('[data-action="close"]').onclick = () => close();
        overlay.querySelector('[data-action="cancel"]').onclick = () => close();
        overlay.onclick = event => { if (event.target === overlay) close(); };
        generate.onclick = async () => {
            const text = input.value.trim();
            if (!text) {
                notify('请先输入需要整理的文本', 'warning');
                input.focus();
                return;
            }
            generate.disabled = true;
            generate.textContent = '正在解析…';
            try {
                const response = await fetch('/structured-profile/import-text', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, schema: rootData })
                });
                const payload = await response.json();
                if (!response.ok || payload.status !== 'ok') {
                    throw new Error(payload.detail || '模型未能生成有效档案');
                }
                replaceRootData(rootData, payload.data);
                if (typeof onSave === 'function') await onSave();
                close(true);
                onApplied?.();
                window.showTemporaryToast?.('文本已转换为结构化档案', 2500, 'success');
            } catch (error) {
                onDismiss?.();
                notify('导入失败：' + error.message);
            } finally {
                generate.disabled = false;
                generate.textContent = '解析并导入';
            }
        };
        setTimeout(() => input.focus(), 0);
    }

    window.resizeAdaptiveTextarea = resizeTextarea;
    window.enhanceTextareas = enhanceTextareas;
    window.openFullscreenTextEditor = openFullscreenTextEditor;
    window.attachStructuredProfileToolbar = buildStructuredToolbar;

    function initialize() {
        enhanceTextareas(document);
        const observer = new MutationObserver(records => {
            records.forEach(record => record.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) enhanceTextareas(node);
            }));
        });
        observer.observe(document.body, { childList: true, subtree: true });
        window.addEventListener('resize', () => document.querySelectorAll('.zoot-adaptive-textarea').forEach(resizeTextarea));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
})();
