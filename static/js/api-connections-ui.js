(function () {
    'use strict';

    const CAPABILITIES = {
        vision: { label: '图片理解', description: '读取图片中的画面、人物、物体和文字。' },
        transcription: { label: '语音转写', description: '将录音转换为文字。' },
        image_prompt_planning: { label: '生图规划', description: '把已确认的上下文整理为可编辑的生图方案。' },
        image_generation: { label: '图片生成', description: '根据已确认的方案渲染图片，真实探测可能产生费用。' }
    };

    const ROUTE_CAPABILITIES = {
        chat: '聊天回复',
        vision: '图片理解',
        transcription: '语音转写',
        image_prompt_planning: '生图规划',
        image_generation: '图片生成'
    };

    const state = {
        initialized: false,
        loaded: false,
        profiles: [],
        services: {},
        protocols: {},
        routes: {},
        selected: {},
        drafts: new Map(),
        modelResults: new Map(),
        probeOperations: new Map(),
        routeDirty: new Set(),
        loadError: ''
    };
    let initializationPromise = null;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function modelDiscoveryStrategy(profile) {
        const serviceId = profile?.service_id || currentDraft(profile?.capability_id || '')?.service_id || '';
        const protocolId = profile?.protocol_id || currentDraft(profile?.capability_id || '')?.protocol_id || '';
        return state.services[serviceId]?.model_discovery || state.protocols[protocolId]?.model_discovery || 'manual';
    }

    function errorText(value, depth = 0) {
        if (value == null || depth > 4) return '';
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (Array.isArray(value)) return value.map(item => errorText(item, depth + 1)).filter(Boolean).join('；');
        if (typeof value === 'object') {
            for (const key of ['message', 'detail', 'error_description', 'error', 'reason', 'msg']) {
                const nested = errorText(value[key], depth + 1);
                if (nested) return nested;
            }
            try {
                return JSON.stringify(value);
            } catch (_) {
                return '';
            }
        }
        return String(value);
    }

    function apiError(payload, response, rawText) {
        const detail = payload && typeof payload === 'object' ? payload.detail : null;
        const code = detail?.code || payload?.code || '';
        const upstream = detail?.request_id || detail?.upstream_request_id || payload?.request_id || payload?.upstream_request_id || '';
        const upstreamStatus = detail?.upstream_status || payload?.upstream_status || '';
        const retryable = Boolean(detail?.retryable || payload?.retryable);
        const probe = detail?.probe && typeof detail.probe === 'object' ? detail.probe : null;
        const fallback = rawText && !/^\s*</.test(rawText) ? rawText : '';
        const source = detail ?? payload?.message ?? payload?.error ?? fallback;
        const rawMessage = errorText(source) || `请求失败（${response.status}）`;
        const guidance = {
            charge_confirmation_required: '该能力探测可能产生少量费用，需要先明确确认。',
            missing_api_key: 'API密钥尚未配置或未能安全读取。',
            authentication_failed: 'API密钥无效、已撤销，或与当前服务地址不匹配。',
            insufficient_credit: '当前账户额度不足。',
            permission_denied: '当前账户无权访问该服务或模型。',
            endpoint_not_found: '模型目录端点不存在，请检查API地址。',
            invalid_provider_response: '服务返回了无法识别的数据结构。',
            missing_model: '当前能力尚未配置模型。',
            model_not_configured: '当前能力尚未保存模型，请保存后重试。',
            provider_unavailable: '服务暂时无法连接，请检查网络和API地址。',
            provider_task_timeout: '服务生成超时，未自动重试以避免重复费用。',
            provider_generation_locked: 'NovelAI仍在处理上一项生成，请等待其完成后再试；请勿连续提交。',
            provider_http_error: Number(upstreamStatus) >= 500
                ? '上游服务发生内部错误；配置已保留，可稍后重试。'
                : '服务拒绝了本次请求，请检查模型和参数。'
        }[code];
        const message = guidance && !rawMessage.includes(guidance) ? `${guidance} ${rawMessage}` : rawMessage;
        const technical = [
            `HTTP ${response.status}`,
            upstreamStatus ? `上游HTTP ${upstreamStatus}` : '',
            code ? `错误码 ${code}` : '',
            upstream ? `请求ID ${upstream}` : '',
            probe?.protocol ? `协议 ${probe.protocol}` : '',
            probe?.model ? `模型 ${probe.model}` : '',
            probe?.size ? `探测尺寸 ${probe.size}` : '',
            retryable ? '可以安全重试' : ''
        ].filter(Boolean).join(' · ');
        const error = new Error(message);
        error.code = code;
        error.status = response.status;
        error.technical = technical;
        return error;
    }

    async function request(url, options = {}) {
        const response = await fetch(url, options);
        const rawText = await response.text();
        let payload = {};
        if (rawText) {
            try {
                payload = JSON.parse(rawText);
            } catch (_) {
                payload = {};
            }
        }
        if (!response.ok) {
            throw apiError(payload, response, rawText);
        }
        return payload;
    }

    function notify(message, type = 'info') {
        if (typeof window.showTemporaryToast === 'function') {
            window.showTemporaryToast(message, 2800, type);
        } else if (typeof window.showToast === 'function') {
            window.showToast(message, 2800, type);
        } else {
            console.info(message);
        }
    }

    function profileKey(capability, profileId) {
        return `${capability}:${profileId || '__new__'}`;
    }

    function profilesFor(capability) {
        return state.profiles.filter(profile => profile.capability_id === capability);
    }

    function selectedProfile(capability) {
        const id = state.selected[capability];
        return profilesFor(capability).find(profile => profile.profile_id === id) || null;
    }

    function blankDraft(capability) {
        return {
            profile_id: '',
            capability_id: capability,
            display_name: `${CAPABILITIES[capability].label}配置`,
            service_id: 'custom',
            protocol_id: 'openai_compatible',
            auth_mode: 'bearer',
            api_base: '',
            model: '',
            options: {},
            secrets: {},
            has_api_key: false,
            saved_secret_fields: [],
            revision: 0,
            dirty: false
        };
    }

    function draftFromProfile(profile) {
        const capability = profile.capability_id;
        return {
            ...profile,
            model: profile.model || profile.models?.[capability] || '',
            options: { ...(profile.options || {}) },
            secrets: {},
            dirty: false
        };
    }

    function currentDraft(capability) {
        const profile = selectedProfile(capability);
        const key = profileKey(capability, profile?.profile_id || '');
        if (!state.drafts.has(key)) {
            state.drafts.set(key, profile ? draftFromProfile(profile) : blankDraft(capability));
        }
        return state.drafts.get(key);
    }

    function statusText(profile) {
        if (profile?.credential_status === 'store_unavailable') return '设备密钥存储不可用';
        if (profile?.credential_status === 'unreadable') return '密钥载荷无法读取';
        if (profile?.credential_status === 'migration_pending') return '旧密钥等待迁移';
        if (!profile) return '尚未保存';
        if (profile.connection_status === 'verified') return '连接已验证';
        if (profile.connection_status === 'validation_only') return '配置完整，尚未在线验证';
        if (profile.connection_status === 'failed') return '连接验证失败';
        return profile.has_api_key || profile.auth_mode === 'none' ? '已保存，尚未测试' : '尚未填写凭据';
    }

    function protocolPreset(protocolId) {
        const catalog = state.protocols[protocolId] || {};
        return {
            ...catalog,
            required_options: catalog.required_options || [],
            required_secrets: catalog.required_secrets || []
        };
    }

    function serviceOptions(capability, selected) {
        const options = Object.entries(state.services)
            .filter(([, item]) => !Array.isArray(item.capabilities) || item.capabilities.includes(capability))
            .map(([id, item]) =>
            `<option value="${escapeHtml(id)}" ${id === selected ? 'selected' : ''}>${escapeHtml(item.name || id)}</option>`
        ).join('');
        if (selected && !state.services[selected]) {
            return `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}（旧配置）</option>${options}`;
        }
        return options;
    }

    function protocolOptions(capability, selected) {
        const options = Object.entries(state.protocols)
            .filter(([, item]) => (item.capabilities || []).includes(capability))
            .map(([id, item]) => `<option value="${escapeHtml(id)}" ${id === selected ? 'selected' : ''}>${escapeHtml(item.name || id)}</option>`)
            .join('');
        const selectedSupported = Boolean(state.protocols[selected]?.capabilities?.includes(capability));
        if (selected && !selectedSupported) {
            return `<option value="${escapeHtml(selected)}" selected>${escapeHtml(state.protocols[selected]?.name || selected)}（兼容配置）</option>${options}`;
        }
        return options;
    }

    function profileOptions(capability, selected) {
        const profiles = profilesFor(capability);
        if (!profiles.length) return '<option value="">新建首个配置</option>';
        const pending = selected ? '' : '<option value="" selected>新配置未保存</option>';
        return pending + profiles.map(profile => {
            const model = profile.model || profile.models?.[capability] || '未选择模型';
            return `<option value="${escapeHtml(profile.profile_id)}" ${profile.profile_id === selected ? 'selected' : ''}>${escapeHtml(profile.display_name)} · ${escapeHtml(profile.service_id)} · ${escapeHtml(model)}</option>`;
        }).join('');
    }

    function dynamicFields(draft) {
        const protocol = protocolPreset(draft.protocol_id);
        const saved = new Set(draft.saved_secret_fields || []);
        const optionFields = (protocol.required_options || []).map(key => `
            <label class="multimodal-field">
                <span>${escapeHtml(key)}</span>
                <input class="api-key-input" data-profile-option="${escapeHtml(key)}" value="${escapeHtml(draft.options?.[key] || '')}">
            </label>`).join('');
        const secretFields = (protocol.required_secrets || []).map(key => `
            <label class="multimodal-field">
                <span>${escapeHtml(key)}</span>
                <input class="api-key-input" type="password" autocomplete="new-password" data-profile-secret="${escapeHtml(key)}" placeholder="${saved.has(key) ? '已保存；留空保持不变' : '请输入凭据'}">
            </label>`).join('');
        if (!optionFields && !secretFields) return '';
        return `<details class="api-profile-advanced"><summary>协议专属设置</summary>${optionFields}${secretFields}</details>`;
    }

    function generationDefaultFields(draft) {
        if (draft.capability_id !== 'image_generation') return '';
        const fields = protocolPreset(draft.protocol_id).generation_parameters || [];
        if (!fields.length) return '';
        const controls = fields.map(field => {
            const key = `generation.${field.id}`;
            const stored = draft.options?.[key];
            const current = stored == null || stored === '' ? field.default : stored;
            if (field.type === 'boolean') {
                const checked = current === true || String(current).toLowerCase() === 'true';
                return `<label class="api-generation-toggle"><input type="checkbox" data-generation-option="${escapeHtml(field.id)}" ${checked ? 'checked' : ''}><span>${escapeHtml(field.label)}</span></label>`;
            }
            if (field.type === 'select') {
                return `<label class="multimodal-field"><span>${escapeHtml(field.label)}</span><select data-generation-option="${escapeHtml(field.id)}">${(field.choices || []).map(choice => `<option value="${escapeHtml(choice)}" ${String(choice) === String(current) ? 'selected' : ''}>${escapeHtml(choice)}</option>`).join('')}</select></label>`;
            }
            const type = field.type === 'integer' || field.type === 'number' ? 'number' : 'text';
            return `<label class="multimodal-field"><span>${escapeHtml(field.label)}</span><input class="api-key-input" type="${type}" data-generation-option="${escapeHtml(field.id)}" value="${escapeHtml(current ?? '')}" ${field.min != null ? `min="${escapeHtml(field.min)}"` : ''} ${field.max != null ? `max="${escapeHtml(field.max)}"` : ''} ${field.step != null ? `step="${escapeHtml(field.step)}"` : ''}></label>`;
        }).join('');
        return `<details class="api-profile-generation-defaults"><summary>默认生成参数</summary><p>这些值只作为新生图方案的默认值；工作台中的本次设置优先。</p><div class="api-generation-default-grid">${controls}</div></details>`;
    }

    function recommendation(draft) {
        const service = state.services[draft.service_id] || {};
        if (!service.protocol && !service.api_base) return '';
        const differs = (service.protocol && service.protocol !== draft.protocol_id)
            || (service.api_base && service.api_base !== draft.api_base);
        if (!differs) return '';
        return `<div class="api-profile-recommendation"><span>推荐协议：${escapeHtml(service.protocol || '保持当前')}；推荐地址：${escapeHtml(service.api_base || '保持当前')}</span><button type="button" data-action="apply-recommendation">应用推荐值</button></div>`;
    }

    function modelResults(capability) {
        const result = state.modelResults.get(capability);
        if (!result) return '';
        if (result.loading) return '<div class="api-model-results">正在获取模型…</div>';
        if (result.error) return `<div class="api-model-results error">${escapeHtml(result.error)}</div>`;
        if (!result.models?.length) return `<div class="api-model-results">${escapeHtml(result.message || '未获取到模型，请手动填写模型ID。')}</div>`;
        return `<div class="api-model-results"><strong>选择模型</strong><div class="api-model-result-list">${result.models.map(item => `<button type="button" data-model-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name || item.id)}</strong><small>${escapeHtml(item.id)}</small></button>`).join('')}</div></div>`;
    }

    function probeStatusPanel(capability, profile) {
        const operation = state.probeOperations.get(capability);
        if (operation) {
            const active = ['saving', 'submitting', 'waiting'].includes(operation.phase);
            const elapsed = active && operation.startedAt
                ? ` · 已等待 ${Math.max(0, Math.floor((Date.now() - operation.startedAt) / 1000))} 秒`
                : '';
            const details = operation.technical
                ? `<details><summary>技术详情</summary><code>${escapeHtml(operation.technical)}</code></details>`
                : '';
            return `<div class="api-profile-probe-status ${escapeHtml(operation.phase)}" data-probe-status role="status" aria-live="polite"><strong>${escapeHtml(operation.message)}</strong><small data-probe-elapsed>${escapeHtml(elapsed)}</small>${details}</div>`;
        }
        if (!profile || profile.capability_status === 'not_checked') return '';
        const checked = profile.last_checked_at
            ? new Date(Number(profile.last_checked_at) * 1000).toLocaleString()
            : '时间未知';
        const failed = profile.capability_status === 'failed';
        const message = failed
            ? errorText(profile.verification_error) || '上次能力验证失败'
            : profile.capability_status === 'verified' ? '上次能力验证成功' : '配置完整，尚未在线验证';
        return `<div class="api-profile-probe-status ${failed ? 'failed' : 'persisted'}" data-probe-status><strong>${escapeHtml(message)}</strong><small>${escapeHtml(checked)}</small></div>`;
    }

    function setProbeOperation(capability, next) {
        if (next) state.probeOperations.set(capability, next);
        else state.probeOperations.delete(capability);
        renderWorkspace(capability);
    }

    function updateProbeElapsed(capability) {
        const operation = state.probeOperations.get(capability);
        const node = document.querySelector(`.multimodal-capability-workspace[data-capability="${capability}"] [data-probe-elapsed]`);
        if (!operation || !node || !operation.startedAt) return;
        node.textContent = ` · 已等待 ${Math.max(0, Math.floor((Date.now() - operation.startedAt) / 1000))} 秒`;
    }

    function renderWorkspace(capability) {
        const root = document.querySelector(`.multimodal-capability-workspace[data-capability="${capability}"] .multimodal-workspace-body`);
        if (!root) return;
        if (state.loadError) {
            root.innerHTML = `<section class="multimodal-config-card api-profile-load-error" role="alert"><strong>API配置目录加载失败</strong><p>${escapeHtml(state.loadError)}</p><button type="button" class="secondary-action-btn" data-action="retry-load">重新加载</button></section>`;
            return;
        }
        if (!state.loaded) {
            root.innerHTML = '<section class="multimodal-config-card"><p class="settings-empty-state">正在加载服务商与协议目录…</p></section>';
            return;
        }
        const profile = selectedProfile(capability);
        const draft = currentDraft(capability);
        const protocol = protocolPreset(draft.protocol_id);
        const probeOperation = state.probeOperations.get(capability);
        const probeBusy = Boolean(probeOperation && ['saving', 'submitting', 'waiting'].includes(probeOperation.phase));
        const disabled = probeBusy ? 'disabled' : '';
        const dirtyLabel = draft.dirty ? '<span class="api-profile-dirty">有未保存更改</span>' : '';
        const capabilityProbe = capability === 'image_generation'
            ? `<button type="button" class="secondary-action-btn" data-action="probe-capability" ${disabled}>${probeBusy ? '正在探测图片生成…' : '保存并探测图片生成（可能计费）'}</button>`
            : `<button type="button" class="secondary-action-btn" data-action="probe-capability" ${disabled}>${probeBusy ? '正在验证…' : capability === 'chat' ? '验证Chat模型（可能计费）' : '验证当前能力'}</button>`;
        const clineModelHint = draft.service_id === 'cline' || /api\.cline\.bot/i.test(draft.api_base)
            ? '<small class="settings-help-text">Cline模型ID必须保留 provider/model 格式，例如 deepseek/deepseek-chat。</small>'
            : '';
        root.innerHTML = `
            <section class="multimodal-config-card" data-profile-editor>
                <div class="multimodal-card-title"><div><strong>${escapeHtml(CAPABILITIES[capability].label)}</strong><small>${escapeHtml(CAPABILITIES[capability].description)}</small></div><span class="status-text">${escapeHtml(statusText(profile))}</span></div>
                <div class="api-profile-switcher">
                    <select data-field="profile_id" aria-label="选择${escapeHtml(CAPABILITIES[capability].label)}配置" ${disabled}>${profileOptions(capability, profile?.profile_id || '')}</select>
                    <button type="button" class="secondary-action-btn" data-action="new" ${disabled}>新建</button>
                    <button type="button" class="secondary-action-btn" data-action="delete" ${profile && !probeBusy ? '' : 'disabled'}>删除</button>
                </div>
                <label class="multimodal-field"><span>配置名称</span><input class="api-key-input" data-field="display_name" value="${escapeHtml(draft.display_name)}"></label>
                <div class="multimodal-field-row">
                    <label class="multimodal-field"><span>服务商</span><select data-field="service_id">${serviceOptions(capability, draft.service_id)}</select></label>
                    <label class="multimodal-field"><span>接口协议</span><select data-field="protocol_id">${protocolOptions(capability, draft.protocol_id)}</select></label>
                </div>
                ${recommendation(draft)}
                <label class="multimodal-field"><span>API地址</span><input class="api-key-input" type="url" data-field="api_base" value="${escapeHtml(draft.api_base)}"></label>
                <label class="multimodal-field"><span>API密钥</span><input class="api-key-input" type="password" autocomplete="new-password" data-field="api_key" placeholder="${draft.has_api_key ? '已安全保存；留空保持不变' : '请输入API密钥'}"></label>
                ${dynamicFields(draft)}
                <label class="multimodal-field"><span>${escapeHtml(CAPABILITIES[capability].label)}模型</span><input class="api-key-input" data-field="model" value="${escapeHtml(draft.model)}" placeholder="填写或获取当前能力的模型ID"></label>
                ${clineModelHint}
                ${generationDefaultFields(draft)}
                <div class="api-profile-primary-actions">
                    <button type="button" class="multimodal-save-btn" data-action="save" ${disabled}>保存配置</button>
                    <button type="button" class="secondary-action-btn" data-action="probe-connection" ${profile && !probeBusy ? '' : 'disabled'}>免费测试连接</button>
                    <button type="button" class="secondary-action-btn" data-action="models" ${profile && !probeBusy ? '' : 'disabled'}>${modelDiscoveryStrategy(draft) === 'manual' ? '查看模型填写说明' : modelDiscoveryStrategy(draft) === 'catalog' ? '查看模型目录' : '获取模型'}</button>
                    ${capabilityProbe}
                </div>
                ${probeStatusPanel(capability, profile)}
                ${dirtyLabel}
                ${modelResults(capability)}
                <details class="api-profile-copy"><summary>套用其他已配置服务</summary><div class="multimodal-inline-actions"><select data-copy-source><option value="">选择来源配置</option>${state.profiles.filter(item => item.profile_id !== profile?.profile_id && item.has_api_key).map(item => `<option value="${escapeHtml(item.profile_id)}">${escapeHtml(item.display_name)} · ${escapeHtml(item.capability_id || '')}</option>`).join('')}</select><button type="button" class="secondary-action-btn" data-action="copy" ${profile ? '' : 'disabled'}>复制选中字段</button></div><div class="api-profile-copy-fields"><label><input type="checkbox" data-copy-field="api_key" checked>API密钥</label><label><input type="checkbox" data-copy-field="api_base" checked>API地址</label><label><input type="checkbox" data-copy-field="protocol">协议</label><label><input type="checkbox" data-copy-field="options">高级连接项</label><label><input type="checkbox" data-copy-field="secrets">协议附加凭据</label></div><small>模型、所属能力、路由和验证状态始终保持独立。</small></details>
            </section>`;
    }

    function ensureWorkspaces() {
        const host = document.getElementById('multimodal-capability-workspaces');
        if (!host) return;
        Object.keys(CAPABILITIES).forEach(capability => {
            if (host.querySelector(`[data-capability="${capability}"]`)) return;
            const section = document.createElement('section');
            section.className = 'multimodal-capability-workspace';
            section.dataset.capability = capability;
            section.hidden = capability !== 'vision';
            section.innerHTML = '<div class="multimodal-workspace-body"></div>';
            host.appendChild(section);
        });
    }

    function renderAll() {
        ensureWorkspaces();
        Object.keys(CAPABILITIES).forEach(renderWorkspace);
        renderRoutes();
    }

    function activeCapability() {
        return document.querySelector('#api-tab-multimodal .multimodal-subtab.active')?.dataset.mmTab || 'vision';
    }

    function switchCapability(capability) {
        if (!CAPABILITIES[capability]) return;
        document.querySelectorAll('#api-tab-multimodal .multimodal-subtab').forEach(button => button.classList.toggle('active', button.dataset.mmTab === capability));
        document.querySelectorAll('.multimodal-capability-workspace').forEach(workspace => {
            workspace.hidden = workspace.dataset.capability !== capability;
        });
        renderWorkspace(capability);
    }

    function collectWorkspace(capability, root) {
        const draft = currentDraft(capability);
        root.querySelectorAll('[data-field]').forEach(input => {
            if (input.dataset.field === 'profile_id') return;
            draft[input.dataset.field] = input.value.trim();
        });
        const savedProfile = selectedProfile(capability);
        draft.options = savedProfile && savedProfile.protocol_id === draft.protocol_id
            ? {...(draft.options || {})}
            : {};
        root.querySelectorAll('[data-profile-option]').forEach(input => {
            if (input.value.trim()) draft.options[input.dataset.profileOption] = input.value.trim();
            else delete draft.options[input.dataset.profileOption];
        });
        root.querySelectorAll('[data-generation-option]').forEach(input => {
            const key = `generation.${input.dataset.generationOption}`;
            const current = input.type === 'checkbox' ? String(input.checked) : input.value.trim();
            if (current !== '') draft.options[key] = current;
        });
        draft.secrets = {};
        root.querySelectorAll('[data-profile-secret]').forEach(input => {
            if (input.value.trim()) draft.secrets[input.dataset.profileSecret] = input.value.trim();
        });
        return draft;
    }

    async function reload(preferred = {}) {
        state.loadError = '';
        let payload = null;
        let catalogs;
        try {
            catalogs = await request('/api-connections/catalogs');
        } catch (error) {
            if (error.status !== 404) throw error;
            try {
                payload = await request('/api-connections/profiles');
            } catch (legacyError) {
                if (legacyError.status === 404) {
                    throw new Error('当前后端仍是旧进程，尚未注册API配置接口。请完全退出应用后重新启动。');
                }
                throw legacyError;
            }
            catalogs = payload;
        }
        state.services = catalogs.services || {};
        state.protocols = catalogs.protocols || {};
        if (!Object.keys(state.services).length || !Object.keys(state.protocols).length) {
            throw new Error('服务商或协议目录为空');
        }
        if (!payload) payload = await request('/api-connections/profiles');
        let routePayload = null;
        try {
            routePayload = await request('/api-connections/routes');
        } catch (error) {
            if (error.status !== 404) throw error;
        }
        state.profiles = payload.profiles || [];
        state.routes = routePayload?.routes || payload.routes || {};
        state.routeDirty.clear();
        const freshProfileIds = new Set(state.profiles.map(profile => profile.profile_id));
        for (const [key, draft] of state.drafts.entries()) {
            if (!draft.dirty && (!draft.profile_id || freshProfileIds.has(draft.profile_id))) {
                state.drafts.delete(key);
            }
        }
        Object.keys(CAPABILITIES).forEach(capability => {
            const saved = preferred[capability] || state.selected[capability] || localStorage.getItem(`api-profile:${capability}`) || '';
            const list = profilesFor(capability);
            state.selected[capability] = list.some(item => item.profile_id === saved) ? saved : list[0]?.profile_id || '';
        });
        state.loaded = true;
        renderAll();
        renderChatProbeStatus();
        renderChatKimiPanel();
    }

    function renderChatProbeStatus(message = '') {
        const status = document.getElementById('chat-api-probe-status');
        if (!status) return;
        if (message) {
            status.textContent = message;
            return;
        }
        const route = state.routes.chat?.[0];
        const profile = route ? state.profiles.find(item => item.profile_id === route.profile_id) : null;
        if (!profile) {
            status.textContent = '尚未找到可用 Chat 配置';
        } else if (profile.connection_status === 'verified') {
            status.textContent = `当前默认：${profile.display_name} · 连接已验证`;
        } else {
            status.textContent = `当前默认：${profile.display_name} · 可测试连接`;
        }
    }

    function currentChatProfile() {
        const route = state.routes.chat?.find(item => item.enabled !== false) || state.routes.chat?.[0];
        return route ? state.profiles.find(item => item.profile_id === route.profile_id) || null : null;
    }

    function modelLeafId(model) {
        return String(model || '').trim().replaceAll('\\', '/').split('/').pop().toLowerCase();
    }

    function isClineProfile(profile) {
        if (!profile) return false;
        if (profile.service_id === 'cline') return true;
        try {
            return new URL(profile.api_base || '').hostname.toLowerCase() === 'api.cline.bot';
        } catch (_) {
            return false;
        }
    }

    function renderChatKimiPanel() {
        const panel = document.getElementById('kimi-k3-settings');
        if (!panel) return;
        const profile = currentChatProfile();
        const model = String(document.getElementById('custom-model-input')?.value || profile?.models?.chat || '').trim();
        const isK3 = modelLeafId(model) === 'kimi-k3';
        panel.hidden = !isK3;
        if (!isK3 || !profile) return;
        const clineProfile = isClineProfile(profile);
        const options = profile.options || {};
        const region = options['kimi.region'] || (/moonshot\.ai/i.test(profile.api_base || '') ? 'global' : 'cn');
        document.getElementById('kimi-region').value = region;
        document.getElementById('kimi-reasoning-effort').value = options['kimi.reasoning_effort'] || 'high';
        document.getElementById('kimi-max-completion-tokens').value = options['kimi.max_completion_tokens'] || '16384';
        document.getElementById('kimi-stream-enabled').checked = options['kimi.stream'] !== 'false';
        const summary = panel.querySelector('summary');
        if (summary) summary.textContent = clineProfile ? 'ClinePass Kimi K3兼容状态' : 'Kimi K3专用设置';
        for (const id of ['kimi-region', 'kimi-reasoning-effort', 'kimi-max-completion-tokens', 'kimi-stream-enabled']) {
            const control = document.getElementById(id);
            const field = control?.closest('label');
            if (field) field.hidden = clineProfile;
        }
        const saveButton = document.getElementById('kimi-k3-save-btn');
        if (saveButton) saveButton.hidden = clineProfile;
        const hint = document.getElementById('kimi-region-hint');
        if (hint) hint.textContent = clineProfile
            ? 'ClinePass使用完整模型ID并由网关管理推理参数；连接检查不会发送聊天，模型访问探测可能消耗额度。'
            : region === 'cn'
            ? '中国区账号、余额与API Key仅适用于 api.moonshot.cn；K3还需要满足官方账户访问条件。'
            : '全球区账号、余额与API Key仅适用于 api.moonshot.ai。';
    }

    async function saveKimiSettings() {
        const profile = currentChatProfile();
        if (!profile) throw new Error('请先保存Kimi Chat配置');
        if (isClineProfile(profile)) {
            if (modelLeafId(profile.models?.chat) !== 'kimi-k3') {
                throw new Error('请先保存完整的ClinePass Kimi K3模型ID');
            }
            return profile;
        }
        const region = document.getElementById('kimi-region')?.value || 'cn';
        const oldRegion = profile.options?.['kimi.region'] || (/moonshot\.ai/i.test(profile.api_base || '') ? 'global' : 'cn');
        const apiKey = document.getElementById('api-key-input')?.value.trim() || '';
        const model = String(document.getElementById('custom-model-input')?.value || profile.models?.chat || '').trim();
        if (!model) throw new Error('请先填写并保存Kimi K3模型');
        const options = {
            ...(profile.options || {}),
            'kimi.region': region,
            'kimi.reasoning_effort': document.getElementById('kimi-reasoning-effort')?.value || 'high',
            'kimi.max_completion_tokens': document.getElementById('kimi-max-completion-tokens')?.value || '16384',
            'kimi.stream': document.getElementById('kimi-stream-enabled')?.checked ? 'true' : 'false'
        };
        let saved;
        if (region !== oldRegion) {
            if (!apiKey) throw new Error('切换Kimi区域时必须填写该区域的新API Key；不会跨区复用已保存密钥');
            const payload = await request('/api-connections/profiles', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    capability_id: 'chat', display_name: region === 'global' ? 'Kimi全球区' : 'Kimi中国区',
                    service_id: region === 'global' ? 'moonshot_global' : 'moonshot_cn',
                    protocol_id: 'openai_compatible',
                    api_base: region === 'global' ? 'https://api.moonshot.ai/v1' : 'https://api.moonshot.cn/v1',
                    api_key: apiKey, models: { chat: model }, options
                })
            });
            saved = payload.profile;
            await request('/api-connections/routes/chat', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ routes: [{ profile_id: saved.profile_id, model, enabled: true }] })
            });
            document.getElementById('api-key-input').value = '';
        } else {
            const payload = await request(`/api-connections/profiles/${encodeURIComponent(profile.profile_id)}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ expected_revision: profile.revision, options, models: { chat: model } })
            });
            saved = payload.profile;
        }
        await reload();
        notify('K3专用设置已保存', 'success');
        return saved;
    }

    async function probeKimiAccess() {
        const confirmed = typeof window.requestProjectConfirmation === 'function'
            ? await window.requestProjectConfirmation('确认模型访问探测', 'K3模型访问探测会发送最小请求，可能产生少量费用或消耗ClinePass额度。是否继续？')
            : false;
        if (!confirmed) return;
        const button = document.getElementById('kimi-k3-probe-btn');
        const status = document.getElementById('kimi-k3-status');
        if (button) button.disabled = true;
        if (status) status.textContent = '正在保存设置并验证K3访问权限…';
        try {
            const profile = await saveKimiSettings();
            const payload = await request(`/api-connections/profiles/${encodeURIComponent(profile.profile_id)}/probe`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'model_access', allow_charge: true })
            });
            const requestId = payload.result?.request_id ? ` · 请求ID ${payload.result.request_id}` : '';
            if (status) status.textContent = `K3访问验证成功${requestId}`;
            notify('K3访问验证成功', 'success');
            await reload();
        } catch (error) {
            if (status) status.textContent = `K3验证失败：${error.message}${error.technical ? ` · ${error.technical}` : ''}`;
            notify(`K3验证失败：${error.message}`, 'error');
        } finally {
            if (button) button.disabled = false;
        }
    }

    async function probeChatConnection() {
        const button = document.getElementById('chat-api-probe-btn');
        if (button) button.disabled = true;
        renderChatProbeStatus('正在检查 Chat 配置与连接…');
        try {
            const providerPayload = await request('/get_current_provider');
            const provider = String(providerPayload.provider || '').trim();
            await request('/set_current_provider', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider })
            });
            await reload();
            const route = state.routes.chat?.[0];
            const profile = (route && state.profiles.find(item => item.profile_id === route.profile_id))
                || state.profiles.find(item => item.capability_id === 'chat' && item.service_id === provider);
            if (!profile) throw new Error('未找到已保存的 Chat 配置，请先保存 API 密钥和模型');
            if (!(profile.models?.chat || '').trim()) throw new Error('当前 Chat 配置尚未保存模型');
            const payload = await request(`/api-connections/profiles/${encodeURIComponent(profile.profile_id)}/probe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'connection' })
            });
            await reload();
            const label = payload.status === 'validation_only' ? '配置完整；该协议不提供免费在线探测' : 'Chat 连接检查通过';
            renderChatProbeStatus(label);
            notify(label, 'success');
        } catch (error) {
            renderChatProbeStatus(`检查失败：${error.message}`);
            notify(`Chat 连接检查失败：${error.message}`, 'error');
        } finally {
            if (button) button.disabled = false;
        }
    }

    async function saveWorkspace(capability, root, quiet = false) {
        const draft = collectWorkspace(capability, root);
        if (!draft.display_name) throw new Error('请填写配置名称');
        if (draft.api_base && !/^https?:\/\//i.test(draft.api_base)) throw new Error('API地址必须以http://或https://开头');
        const profile = selectedProfile(capability);
        const body = {
            capability_id: capability,
            display_name: draft.display_name,
            service_id: draft.service_id,
            protocol_id: draft.protocol_id,
            auth_mode: state.protocols[draft.protocol_id]?.auth_mode || draft.auth_mode || 'bearer',
            api_base: draft.api_base,
            model: draft.model,
            models: { [capability]: draft.model },
            options: draft.options,
            secrets: draft.secrets
        };
        if (draft.api_key) body.api_key = draft.api_key;
        if (profile) body.expected_revision = profile.revision;
        const payload = await request(profile ? `/api-connections/profiles/${encodeURIComponent(profile.profile_id)}` : '/api-connections/profiles', {
            method: profile ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const id = payload.profile.profile_id;
        state.selected[capability] = id;
        localStorage.setItem(`api-profile:${capability}`, id);
        state.drafts.delete(profileKey(capability, profile?.profile_id || ''));
        await reload({ [capability]: id });
        if (!quiet) notify('配置已保存；未执行联网测试或付费请求', 'success');
        return payload.profile;
    }

    async function probe(capability, root, mode) {
        const existingOperation = state.probeOperations.get(capability);
        if (existingOperation && ['saving', 'submitting', 'waiting'].includes(existingOperation.phase)) return;
        state.probeOperations.delete(capability);
        let profile = selectedProfile(capability);
        const startedAt = Date.now();
        let timer = 0;
        if (mode === 'capability' && capability === 'image_generation') {
            if (!await requestProjectConfirmation('确认能力探测', '将先保存当前图片生成配置，再生成最小测试图片。该操作可能产生费用，是否继续？')) return;
            setProbeOperation(capability, { phase: 'saving', message: '正在保存图片生成配置…', startedAt });
            try {
                profile = await saveWorkspace(capability, root, true);
            } catch (error) {
                setProbeOperation(capability, { phase: 'failed', message: `保存失败：${error.message}`, technical: error.technical || '' });
                throw error;
            }
        } else if (!profile) {
            throw new Error('请先保存当前配置');
        } else if (currentDraft(capability).dirty && mode === 'capability') {
            throw new Error('请先保存当前能力的模型和配置，再执行能力验证');
        }
        if (mode === 'capability' && capability === 'chat') {
            if (!await requestProjectConfirmation('确认Chat模型探测', '将发送一条最小测试消息验证当前模型，可能产生少量费用。是否继续？')) return;
        }
        setProbeOperation(capability, {
            phase: capability === 'image_generation' ? 'submitting' : 'waiting',
            message: capability === 'image_generation' ? '正在提交最小测试图…' : '正在验证当前能力…',
            startedAt
        });
        if (capability === 'image_generation') {
            timer = window.setTimeout(() => {
                const current = state.probeOperations.get(capability);
                if (!current || current.phase !== 'submitting') return;
                setProbeOperation(capability, { ...current, phase: 'waiting', message: '图片服务正在生成测试结果…' });
                timer = window.setInterval(() => updateProbeElapsed(capability), 1000);
            }, 700);
        }
        try {
            const body = { mode, capability };
            if (mode === 'capability' && ['chat', 'image_generation'].includes(capability)) body.allow_charge = true;
            const payload = await request(`/api-connections/profiles/${encodeURIComponent(profile.profile_id)}/probe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (timer) window.clearInterval(timer);
            await reload({ [capability]: profile.profile_id });
            const latency = payload.result?.latency_ms;
            const message = payload.message || (mode === 'connection' ? '连接检查完成' : '能力验证成功');
            setProbeOperation(capability, {
                phase: 'succeeded',
                message: latency != null ? `${message} · ${latency} ms` : message
            });
            notify(message, 'success');
        } catch (error) {
            if (timer) window.clearInterval(timer);
            setProbeOperation(capability, {
                phase: 'failed',
                message: `验证失败：${error.message}`,
                technical: error.technical || ''
            });
            throw error;
        }
    }

    async function fetchModels(capability) {
        const profile = selectedProfile(capability);
        if (!profile) throw new Error('请先保存当前配置');
        state.modelResults.set(capability, { loading: true });
        renderWorkspace(capability);
        try {
            const payload = await request(`/api-connections/profiles/${encodeURIComponent(profile.profile_id)}/models`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ capability, force: true })
            });
            state.modelResults.set(capability, {
                models: payload.models || [],
                message: payload.strategy === 'manual' ? '该协议不提供模型枚举，请手动填写模型ID。' : '未获取到适用模型。'
            });
        } catch (error) {
            state.modelResults.set(capability, { error: `模型获取失败：${error.message}。当前模型不会被清空。` });
        }
        renderWorkspace(capability);
    }

    async function deleteProfile(capability) {
        const profile = selectedProfile(capability);
        if (!profile || !await requestProjectConfirmation('删除API配置', `确定删除配置“${profile.display_name}”吗？`)) return;
        await request(`/api-connections/profiles/${encodeURIComponent(profile.profile_id)}`, { method: 'DELETE' });
        state.selected[capability] = '';
        state.drafts.delete(profileKey(capability, profile.profile_id));
        await reload();
    }

    async function copyProfile(capability, root) {
        const profile = selectedProfile(capability);
        const sourceId = root.querySelector('[data-copy-source]')?.value;
        if (!profile || !sourceId) throw new Error('请选择可套用的来源配置');
        const fields = Array.from(root.querySelectorAll('[data-copy-field]:checked')).map(input => input.dataset.copyField);
        if (!fields.length) throw new Error('请至少选择一个要复制的连接字段');
        await request(`/api-connections/profiles/${encodeURIComponent(profile.profile_id)}/copy-from`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_profile_id: sourceId, fields })
        });
        state.drafts.delete(profileKey(capability, profile.profile_id));
        await reload({ [capability]: profile.profile_id });
        notify('连接信息已安全复制；模型和路由保持独立', 'success');
    }

    function routeProfiles(capability) {
        return state.profiles.filter(profile => profile.capability_id === capability);
    }

    function renderRoutes() {
        const host = document.getElementById('api-routes-root');
        if (!host) return;
        host.innerHTML = Object.entries(ROUTE_CAPABILITIES).map(([capability, label]) => {
            const entries = state.routes[capability] || [];
            const available = routeProfiles(capability);
            return `<section class="api-route-section" data-route-capability="${capability}"><div class="multimodal-card-title"><div><strong>${label}</strong><small>独立设置主服务和有序备用服务</small><small class="api-route-dirty" ${state.routeDirty.has(capability) ? '' : 'hidden'}>存在未保存更改</small></div><button type="button" class="secondary-action-btn" data-route-save>保存此路由</button></div><div class="multimodal-route-cards">${entries.map((entry, index) => routeCard(capability, entry, index)).join('')}</div><div class="multimodal-route-add"><select><option value="">选择${label}配置</option>${available.filter(item => !entries.some(entry => entry.profile_id === item.profile_id)).map(item => `<option value="${escapeHtml(item.profile_id)}">${escapeHtml(item.display_name)} · ${escapeHtml(item.model || item.models?.[capability] || '未选择模型')}</option>`).join('')}</select><button type="button" data-route-add>添加</button></div></section>`;
        }).join('');
    }

    function routeCard(capability, entry, index) {
        const profile = state.profiles.find(item => item.profile_id === entry.profile_id);
        return `<article class="multimodal-route-card" data-route-index="${index}" data-profile-id="${escapeHtml(entry.profile_id)}"><div><strong>${escapeHtml(profile?.display_name || entry.profile_id)}</strong><small>${index === 0 ? '主服务' : '备用服务'}</small></div><label class="multimodal-route-model"><span>路由模型</span><input value="${escapeHtml(entry.model || profile?.model || profile?.models?.[capability] || '')}"></label>${index > 0 ? `<label><input type="checkbox" data-fallback-consent ${entry.fallback_consent ? 'checked' : ''}>允许备用服务接触此能力的数据</label>` : ''}<label><input type="checkbox" data-risk-acknowledged ${entry.risk_acknowledged ? 'checked' : ''}>允许使用仅完成配置校验、尚未在线验证的服务</label><div><button type="button" data-route-up ${index === 0 ? 'disabled' : ''}>上移</button><button type="button" data-route-down>下移</button><button type="button" data-route-remove>移除</button></div></article>`;
    }

    function routeEntries(section) {
        return Array.from(section.querySelectorAll('.multimodal-route-card')).map((card, index) => ({
            profile_id: card.dataset.profileId,
            model: card.querySelector('.multimodal-route-model input')?.value.trim() || '',
            enabled: true,
            fallback_consent: index === 0 || Boolean(card.querySelector('[data-fallback-consent]')?.checked),
            risk_acknowledged: Boolean(card.querySelector('[data-risk-acknowledged]')?.checked)
        }));
    }

    async function saveRoute(section) {
        const capability = section.dataset.routeCapability;
        const submitted = routeEntries(section);
        const payload = await request(`/api-connections/routes/${capability}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ routes: submitted })
        });
        const verified = await request(`/api-connections/routes/${capability}`);
        const saved = verified.routes || payload.routes || [];
        if (saved.length !== submitted.length || saved.some((entry, index) => entry.profile_id !== submitted[index]?.profile_id || entry.model !== submitted[index]?.model)) {
            throw new Error('路由保存后的权威回读不一致，请重试；现有配置未在页面中伪装为已保存');
        }
        state.routes[capability] = saved;
        state.routeDirty.delete(capability);
        renderRoutes();
        notify(`${ROUTE_CAPABILITIES[capability]}路由已保存`, 'success');
    }

    function bind() {
        if (state.initialized) return;
        document.addEventListener('click', async event => {
            if (event.target.closest?.('#kimi-k3-save-btn')) {
                try { await saveKimiSettings(); } catch (error) { notify(error.message, 'error'); }
                return;
            }
            if (event.target.closest?.('#kimi-k3-probe-btn')) {
                await probeKimiAccess();
                return;
            }
            if (event.target.closest?.('#chat-api-probe-btn')) {
                await probeChatConnection();
                return;
            }
            const subtab = event.target.closest?.('#api-tab-multimodal .multimodal-subtab');
            if (subtab) {
                switchCapability(subtab.dataset.mmTab);
                return;
            }
            const workspace = event.target.closest?.('.multimodal-capability-workspace');
            if (workspace) {
                const capability = workspace.dataset.capability;
                const root = workspace.querySelector('.multimodal-workspace-body');
                const action = event.target.closest?.('[data-action]')?.dataset.action;
                try {
                    if (action === 'retry-load') {
                        await init(true);
                    } else if (action === 'new') {
                        state.selected[capability] = '';
                        state.drafts.set(profileKey(capability, ''), blankDraft(capability));
                        renderWorkspace(capability);
                    } else if (action === 'delete') {
                        await deleteProfile(capability);
                    } else if (action === 'save') {
                        await saveWorkspace(capability, root);
                    } else if (action === 'probe-connection') {
                        await probe(capability, root, 'connection');
                    } else if (action === 'probe-capability') {
                        await probe(capability, root, 'capability');
                    } else if (action === 'models') {
                        await fetchModels(capability);
                    } else if (action === 'copy') {
                        await copyProfile(capability, root);
                    } else if (action === 'apply-recommendation') {
                        const draft = collectWorkspace(capability, root);
                        const service = state.services[draft.service_id] || {};
                        if (service.protocol && (state.protocols[service.protocol]?.capabilities || []).includes(capability)) draft.protocol_id = service.protocol;
                        if (service.api_base) draft.api_base = service.api_base;
                        draft.dirty = true;
                        renderWorkspace(capability);
                    }
                } catch (error) {
                    notify(error.message || '操作失败', 'error');
                }
                const modelButton = event.target.closest?.('[data-model-id]');
                if (modelButton) {
                    const draft = collectWorkspace(capability, root);
                    draft.model = modelButton.dataset.modelId;
                    draft.dirty = true;
                    state.modelResults.delete(capability);
                    renderWorkspace(capability);
                }
                return;
            }
            const routeSection = event.target.closest?.('[data-route-capability]');
            if (!routeSection) return;
            try {
                if (event.target.closest('[data-route-save]')) {
                    await saveRoute(routeSection);
                } else if (event.target.closest('[data-route-add]')) {
                    const select = routeSection.querySelector('.multimodal-route-add select');
                    if (!select.value) return;
                    const capability = routeSection.dataset.routeCapability;
                    state.routes[capability] = [...(state.routes[capability] || []), { profile_id: select.value, model: '', enabled: true, fallback_consent: false }];
                    state.routeDirty.add(capability);
                    renderRoutes();
                } else {
                    const card = event.target.closest('.multimodal-route-card');
                    if (!card) return;
                    const capability = routeSection.dataset.routeCapability;
                    const entries = routeEntries(routeSection);
                    const index = Number(card.dataset.routeIndex);
                    if (event.target.closest('[data-route-remove]')) entries.splice(index, 1);
                    if (event.target.closest('[data-route-up]') && index > 0) [entries[index - 1], entries[index]] = [entries[index], entries[index - 1]];
                    if (event.target.closest('[data-route-down]') && index < entries.length - 1) [entries[index], entries[index + 1]] = [entries[index + 1], entries[index]];
                    state.routes[capability] = entries;
                    state.routeDirty.add(capability);
                    renderRoutes();
                }
            } catch (error) {
                notify(error.message || '路由操作失败', 'error');
            }
        });

        document.addEventListener('change', event => {
            const routeSection = event.target.closest?.('.api-route-section');
            if (routeSection) {
                const capability = routeSection.dataset.routeCapability;
                state.routes[capability] = routeEntries(routeSection);
                state.routeDirty.add(capability);
                routeSection.querySelector('.api-route-dirty')?.removeAttribute('hidden');
                return;
            }
            const workspace = event.target.closest?.('.multimodal-capability-workspace');
            if (!workspace) return;
            const capability = workspace.dataset.capability;
            const root = workspace.querySelector('.multimodal-workspace-body');
            if (event.target.matches('[data-field="profile_id"]')) {
                state.selected[capability] = event.target.value;
                localStorage.setItem(`api-profile:${capability}`, event.target.value);
                renderWorkspace(capability);
                return;
            }
            const draft = collectWorkspace(capability, root);
            draft.dirty = true;
            if (event.target.matches('[data-field="protocol_id"], [data-field="service_id"]')) renderWorkspace(capability);
            else root.querySelector('.api-profile-dirty')?.removeAttribute('hidden');
        });
        document.addEventListener('input', event => {
            const routeSection = event.target.closest?.('.api-route-section');
            if (!routeSection) return;
            const capability = routeSection.dataset.routeCapability;
            state.routes[capability] = routeEntries(routeSection);
            state.routeDirty.add(capability);
            routeSection.querySelector('.api-route-dirty')?.removeAttribute('hidden');
        });
        state.initialized = true;
    }

    async function performInit() {
        bind();
        ensureWorkspaces();
        state.loaded = false;
        state.loadError = '';
        renderAll();
        try {
            await reload();
            switchCapability(activeCapability());
        } catch (error) {
            state.loaded = false;
            state.loadError = error.message || '无法读取API配置目录';
            renderAll();
            throw error;
        }
    }

    async function init(force = false) {
        if (force || !initializationPromise) {
            initializationPromise = performInit().finally(() => {
                initializationPromise = null;
            });
        }
        return initializationPromise;
    }

    window.ZootApiConnectionsUI = { init, reload, switchCapability };
})();
