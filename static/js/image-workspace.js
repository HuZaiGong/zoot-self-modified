(function imageWorkspaceModule() {
    'use strict';

    const state = {
        initialized: false,
        manifest: null,
        settings: null,
        context: null,
        plan: null,
        wardrobe: null,
        wardrobeOwnerType: 'operator',
        wardrobeOwnerId: '',
        wardrobeOwnerQuery: '',
        wardrobeOwnerViews: new Map(),
        wardrobeOwnerRestoreScroll: false,
        wardrobeRequestGeneration: 0,
        wardrobeRequestController: null,
        wardrobeUploadLookId: '',
        wardrobeEditorMode: 'create',
        wardrobeEditorLookId: '',
        wardrobeEditorProposalId: '',
        wardrobeEditorProposalRevision: 0,
        wardrobeEditorDirty: false,
        wardrobeEditorFiles: [],
        wardrobeGlobalItems: [],
        wardrobeGlobalCursor: '',
        wardrobeGlobalTotal: 0,
        wardrobeGlobalQuery: '',
        wardrobeGlobalOwnerType: '',
        wardrobeGlobalScrollTop: 0,
        wardrobeGlobalRestoreScroll: false,
        wardrobeGlobalRequestGeneration: 0,
        wardrobeGlobalRequestController: null,
        workspaceOptions: {},
        sourceMode: 'free',
        chatSources: [],
        chatSourceCursor: '',
        chatMessages: [],
        chatMessageCursor: '',
        selectedConversationKey: '',
        selectedBranchId: '',
        selectedViewRevision: '',
        selectedMessageUids: new Set(),
        anchorMessageUid: '',
        participantDecisions: new Map(),
        participantsConfirmed: false,
        characterPromptItems: new Map(),
        characterPromptDrafts: new Map(),
        characterPromptOverrides: new Map(),
        characterPromptRequestGeneration: 0,
        characterPromptRequestController: null,
        characterPromptLoadTimer: null,
        sourceRequestGeneration: 0,
        sourceRequestController: null,
        promptPresets: [],
        artistStyleChains: [],
        gallery: [],
        galleryTotal: 0,
        galleryNextCursor: '',
        galleryFacets: {},
        galleryLoading: false,
        galleryRequestGeneration: 0,
        galleryRequestController: null,
        galleryObserver: null,
        galleryResizeObserver: null,
        galleryLayout: 'masonry',
        gallerySort: 'created_desc',
        galleryGroup: 'none',
        galleryFilters: {},
        gallerySelection: new Set(),
        galleryDetail: null,
        galleryScrollTop: 0,
        galleryRestoreScroll: false,
        galleryScrollHandler: null,
        galleryCollapsedGroups: new Set(),
        visualProposals: [],
        selectedGalleryId: '',
        railCollapsed: false,
        galleryBackfillPromise: null,
        proposalId: '',
        planDirty: false,
        planningActive: false,
        planningGeneration: 0,
        planningSourceSignature: '',
        generation: null,
        generationSubmitting: false,
        generationPollTimer: null,
        generationElapsedTimer: null,
        generationPollController: null,
        generationRequestGeneration: 0,
        workspaceStep: 1,
        workspaceStepScrollTops: new Map()
    };

    const ACTIVE_GENERATION_STORAGE_KEY = 'zoot:image-workspace-active-generation:v1';

    const byId = id => document.getElementById(id);
    const value = id => String(byId(id)?.value || '').trim();
    const splitIds = text => String(text || '').split(',').map(item => item.trim()).filter(Boolean);
    const requestId = prefix => `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
    const escapeHtml = text => String(text ?? '').replace(/[&<>'"]/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[character]));
    const toast = (message, type = 'info') => {
        if (typeof showTemporaryToast === 'function') {
            showTemporaryToast(message, 2600, type);
        } else {
            console[type === 'error' ? 'error' : 'log'](message);
        }
    };
    const readableError = (input, fallback = '') => {
        if (input === null || input === undefined || input === '') return fallback;
        if (typeof input === 'string') return input;
        if (Array.isArray(input)) {
            return input.map(item => readableError(item)).filter(Boolean).join('；') || fallback;
        }
        if (typeof input === 'object') {
            for (const key of ['message', 'detail', 'error', 'reason', 'description']) {
                const text = readableError(input[key]);
                if (text) return text;
            }
            try {
                return JSON.stringify(input);
            } catch (_) {
                return fallback;
            }
        }
        return String(input);
    };
    const api = async (url, options = {}) => {
        const response = await fetch(url, options);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(readableError(payload.detail || payload.message || payload, `请求失败 (${response.status})`));
            error.status = response.status;
            error.payload = payload;
            throw error;
        }
        return payload;
    };
    const openPage = pageId => {
        if (typeof showPage === 'function') {
            showPage(pageId);
        }
    };
    const openImageGenerationRoutes = () => {
        localStorage.setItem('settings-tab:settings-api', 'routes');
        openPage('settings-api');
    };

    function rememberWorkspaceStepScroll() {
        const scroll = document.querySelector('#page-image-workspace > .image-studio-scroll');
        if (!scroll) return;
        state.workspaceStepScrollTops.set(state.workspaceStep, scroll.scrollTop);
    }

    function restoreWorkspaceStepScroll(step) {
        const scroll = document.querySelector('#page-image-workspace > .image-studio-scroll');
        if (!scroll) return;
        const scrollTop = state.workspaceStepScrollTops.get(step) || 0;
        requestAnimationFrame(() => {
            if (state.workspaceStep === step) scroll.scrollTop = scrollTop;
        });
    }

    function setStep(step) {
        const normalizedStep = Math.max(1, Math.min(Number(step) || 1, 4));
        rememberWorkspaceStepScroll();
        state.workspaceStep = normalizedStep;
        document.querySelectorAll('[data-image-step]').forEach(button => {
            button.classList.toggle('active', Number(button.dataset.imageStep) === normalizedStep);
        });
        document.querySelectorAll('[data-image-panel]').forEach(panel => {
            panel.classList.toggle('active', Number(panel.dataset.imagePanel) === normalizedStep);
        });
        restoreWorkspaceStepScroll(normalizedStep);
        if (normalizedStep === 2) scheduleCharacterPromptLoad(0);
    }

    function currentOperator() {
        try {
            return String((typeof currentOperatorId !== 'undefined' && currentOperatorId) || (typeof currentChatOperatorId !== 'undefined' && currentChatOperatorId) || '');
        } catch (_) {
            return '';
        }
    }

    function currentPersona() {
        try {
            return String((typeof currentPersonaId !== 'undefined' && currentPersonaId) || 'doctor');
        } catch (_) {
            return 'doctor';
        }
    }

    async function loadManifest() {
        if (state.manifest) {
            return state.manifest;
        }
        const payload = await api('/image-workspace/manifest');
        state.manifest = payload;
        state.settings = payload.settings || {};
        const source = byId('image-workspace-source-type');
        const intent = byId('image-workspace-intent');
        const galleryIntent = byId('image-gallery-intent');
        const gallerySource = byId('image-gallery-source');
        state.promptPresets = Array.isArray(payload.prompt_presets) ? payload.prompt_presets : [];
        state.artistStyleChains = Array.isArray(payload.artist_style_chains) ? payload.artist_style_chains : [];
        if (source) {
            source.innerHTML = payload.context_providers.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('');
        }
        const intentOptions = payload.intents.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('');
        if (intent) {
            intent.innerHTML = intentOptions;
        }
        if (galleryIntent) {
            galleryIntent.innerHTML = `<option value="">全部意图</option>${intentOptions}`;
        }
        if (gallerySource) {
            gallerySource.innerHTML = `<option value="">全部来源</option>${payload.context_providers.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('')}`;
        }
        renderPromptPresetOptions();
        installArtistChainControls();
        renderArtistChainOptions();
        applyGenerationDefaults(payload.generation_profile || {});
        if (byId('image-workspace-rail-setting')) {
            byId('image-workspace-rail-setting').checked = Boolean(state.settings.floating_rail_enabled);
        }
        if (byId('image-workspace-chat-wardrobe-setting')) {
            byId('image-workspace-chat-wardrobe-setting').checked = Boolean(state.settings.chat_wardrobe_enabled);
        }
        updateRail();
        return payload;
    }

    function renderPromptPresetOptions() {
        const select = byId('image-workspace-prompt-preset');
        if (!select) return;
        const current = select.value || 'none';
        select.innerHTML = state.promptPresets.map(item => `<option value="${escapeHtml(item.preset_id)}">${escapeHtml(item.name)}</option>`).join('');
        select.value = state.promptPresets.some(item => item.preset_id === current) ? current : 'none';
        renderPromptPresetEditor();
    }

    function renderPromptPresetEditor() {
        const preset = state.promptPresets.find(item => item.preset_id === value('image-workspace-prompt-preset')) || {};
        if (byId('image-workspace-preset-name')) byId('image-workspace-preset-name').value = preset.built_in ? '' : (preset.name || '');
        if (byId('image-workspace-preset-prefix')) byId('image-workspace-preset-prefix').value = preset.prefix_positive || '';
        if (byId('image-workspace-preset-suffix')) byId('image-workspace-preset-suffix').value = preset.suffix_positive || '';
        if (byId('image-workspace-preset-negative')) byId('image-workspace-preset-negative').value = preset.fixed_negative || '';
        if (byId('image-workspace-preset-quality')) byId('image-workspace-preset-quality').value = preset.quality_prompt || '';
        if (byId('image-workspace-preset-replacements')) byId('image-workspace-preset-replacements').value = JSON.stringify(preset.replacements || [], null, 2);
        if (byId('image-workspace-preset-delete')) byId('image-workspace-preset-delete').disabled = !preset.preset_id || preset.built_in;
        if (byId('image-workspace-preset-save')) byId('image-workspace-preset-save').textContent = preset.preset_id && !preset.built_in ? '更新预设' : '另存为预设';
    }

    function installArtistChainControls() {
        if (byId('image-workspace-artist-chain')) return;
        const preset = byId('image-workspace-prompt-preset')?.closest('label');
        preset?.insertAdjacentHTML('afterend', '<label class="image-studio-span">画师串<select id="image-workspace-artist-chain"><option value="">不使用画师串</option></select></label>');
        byId('image-workspace-preset-editor')?.insertAdjacentHTML('afterend', '<details class="image-preset-editor"><summary>管理画师串</summary><p class="image-studio-help">按顺序组合自定义 artist/style 标签；历史方案保存完整快照。</p><div class="image-studio-grid"><label>名称<input id="image-workspace-artist-chain-name" type="text" maxlength="80"></label><label class="image-studio-span">条目（每行：标签 | 权重）<textarea id="image-workspace-artist-chain-entries" rows="5" placeholder="style tag | 1.0"></textarea></label><label class="image-studio-span">说明<textarea id="image-workspace-artist-chain-note" rows="2"></textarea></label></div><div class="image-studio-actions"><button class="btn-secondary" id="image-workspace-artist-chain-save" type="button">保存画师串</button><button class="btn-danger" id="image-workspace-artist-chain-delete" type="button">删除当前画师串</button></div></details>');
        bindArtistChainEvents();
    }

    function bindArtistChainEvents() {
        byId('image-workspace-artist-chain')?.addEventListener('change', renderArtistChainEditor);
        byId('image-workspace-artist-chain-save')?.addEventListener('click', () => saveArtistChain().catch(error => toast(error.message, 'error')));
        byId('image-workspace-artist-chain-delete')?.addEventListener('click', () => deleteArtistChain().catch(error => toast(error.message, 'error')));
    }

    function renderArtistChainOptions() {
        const select = byId('image-workspace-artist-chain'); if (!select) return; const current = select.value;
        select.innerHTML = `<option value="">不使用画师串</option>${state.artistStyleChains.map(item => `<option value="${escapeHtml(item.chain_id)}">${escapeHtml(item.name)}</option>`).join('')}`;
        select.value = state.artistStyleChains.some(item => item.chain_id === current) ? current : ''; renderArtistChainEditor();
    }

    function renderArtistChainEditor() {
        const chain = state.artistStyleChains.find(item => item.chain_id === value('image-workspace-artist-chain')) || {};
        if (byId('image-workspace-artist-chain-name')) byId('image-workspace-artist-chain-name').value = chain.name || '';
        if (byId('image-workspace-artist-chain-note')) byId('image-workspace-artist-chain-note').value = chain.description || '';
        if (byId('image-workspace-artist-chain-entries')) byId('image-workspace-artist-chain-entries').value = (chain.entries || []).map(item => `${item.label} | ${Number(item.weight ?? 1)}`).join('\n');
        if (byId('image-workspace-artist-chain-delete')) byId('image-workspace-artist-chain-delete').disabled = !chain.chain_id;
        if (byId('image-workspace-artist-chain-save')) byId('image-workspace-artist-chain-save').textContent = chain.chain_id ? '更新画师串' : '另存为画师串';
    }

    function artistChainEntries() { return value('image-workspace-artist-chain-entries').split(/\r?\n/).map(line => { const [label, rawWeight] = line.split('|'); return {label: String(label || '').trim(), weight: Number(String(rawWeight || '1').trim()) || 1, enabled: true}; }).filter(item => item.label); }
    async function saveArtistChain() { const selected = state.artistStyleChains.find(item => item.chain_id === value('image-workspace-artist-chain')); const payload = await api(selected ? `/image-workspace/artist-style-chains/${encodeURIComponent(selected.chain_id)}` : '/image-workspace/artist-style-chains', {method: selected ? 'PATCH' : 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: value('image-workspace-artist-chain-name') || '自定义画师串', description: value('image-workspace-artist-chain-note'), entries: artistChainEntries(), expected_revision: selected?.revision})}); state.artistStyleChains = selected ? state.artistStyleChains.map(item => item.chain_id === payload.chain.chain_id ? payload.chain : item) : state.artistStyleChains.concat(payload.chain); renderArtistChainOptions(); byId('image-workspace-artist-chain').value = payload.chain.chain_id; renderArtistChainEditor(); toast('画师串已保存', 'success'); }
    async function deleteArtistChain() { const chain = state.artistStyleChains.find(item => item.chain_id === value('image-workspace-artist-chain')); if (!chain) return; await api(`/image-workspace/artist-style-chains/${encodeURIComponent(chain.chain_id)}?expected_revision=${chain.revision}`, {method: 'DELETE'}); state.artistStyleChains = state.artistStyleChains.filter(item => item.chain_id !== chain.chain_id); renderArtistChainOptions(); toast('画师串已删除', 'success'); }

    function applyGenerationDefaults(profile) {
        const defaults = profile.defaults || {};
        const expert = byId('image-workspace-expert-fields');
        if (expert && !byId('image-workspace-width')) {
            expert.insertAdjacentHTML('afterbegin', '<label>宽度<input id="image-workspace-width" type="number" min="64" max="4096" step="64"></label><label>高度<input id="image-workspace-height" type="number" min="64" max="4096" step="64"></label><label>质量<input id="image-workspace-quality" type="text" placeholder="standard、high 或 Provider 值"></label>');
        }
        const ratioSelect = byId('image-workspace-ratio');
        ['2:3', '3:2'].forEach(ratio => {
            if (ratioSelect && ![...ratioSelect.options].some(option => option.value === ratio)) ratioSelect.add(new Option(ratio, ratio));
        });
        const map = {
            width: 'image-workspace-width', height: 'image-workspace-height', steps: 'image-workspace-steps',
            sampler: 'image-workspace-sampler', scheduler: 'image-workspace-scheduler', cfg: 'image-workspace-cfg',
            cfg_rescale: 'image-workspace-cfg-rescale', denoise: 'image-workspace-denoise', seed: 'image-workspace-seed',
            variant_count: 'image-workspace-variants', quality: 'image-workspace-quality', style: 'image-workspace-style'
        };
        Object.entries(map).forEach(([key, id]) => {
            const input = byId(id);
            if (input && defaults[key] !== undefined) input.value = defaults[key];
        });
        if (defaults.seed_mode && byId('image-workspace-seed-mode')) byId('image-workspace-seed-mode').value = defaults.seed_mode;
        if (defaults.aspect_ratio && ratioSelect) ratioSelect.value = defaults.aspect_ratio;
        if (defaults.size && ratioSelect) {
            const sizeRatios = {'1024x1024': '1:1', '1024x1536': '2:3', '1536x1024': '3:2'};
            if (sizeRatios[defaults.size]) ratioSelect.value = sizeRatios[defaults.size];
        }
        if (byId('image-workspace-variety')) byId('image-workspace-variety').checked = Boolean(defaults.variety);
        if (byId('image-workspace-character-position')) byId('image-workspace-character-position').value = defaults.character_position || 'auto';
    }

    function applyContext(context) {
        state.context = context;
        if (byId('image-workspace-ai-plan')) byId('image-workspace-ai-plan').hidden = context.source_type !== 'chat';
        const preview = byId('image-workspace-context-preview');
        if (preview) {
            preview.textContent = [
                context.title || '未命名来源',
                context.excerpt || '无可展示摘要',
                `可用意图：${(context.allowed_intents || []).join(' / ')}`,
                `将发送：${(context.privacy_blocks || []).join('、') || '仅用户输入'}`
            ].join('\n\n');
        }
        if (byId('image-workspace-actors')) {
            byId('image-workspace-actors').value = (context.actors || []).join(', ');
        }
        if (context.source_type !== 'chat' && byId('image-workspace-scene') && !value('image-workspace-scene')) {
            byId('image-workspace-scene').value = context.excerpt || '';
        }
        const wardrobe = context.wardrobe?.look || context.wardrobe;
        if (byId('image-workspace-outfit') && wardrobe && typeof wardrobe === 'object') {
            byId('image-workspace-outfit').value = wardrobe.description || wardrobe.name || '';
        }
        const intent = byId('image-workspace-intent');
        if (intent && context.allowed_intents?.length && !context.allowed_intents.includes(intent.value)) {
            intent.value = context.allowed_intents[0];
        }
        scheduleCharacterPromptLoad(0);
    }

    const CHARACTER_PROMPT_MODE_LABELS = Object.freeze({
        default: '跟随推荐',
        character_tag: '英文名 Tag',
        description: '外貌描述',
        hybrid: '融合使用'
    });

    function characterPromptOperatorIds() {
        return [...new Set(splitIds(value('image-workspace-actors')))];
    }

    function normalizeCharacterPromptItem(raw) {
        const compatibility = raw?.provider_compatibility || raw?.provider_support || {};
        const appearanceValue = raw?.appearance_description ?? raw?.effective_identity_prompt ?? raw?.final_identity_prompt ?? '';
        const appearanceDescription = Array.isArray(appearanceValue) ? appearanceValue.join(', ') : String(appearanceValue || '');
        const currentOutfit = raw?.current_outfit && typeof raw.current_outfit === 'object'
            ? raw.current_outfit
            : {name: '', description: String(raw?.clothing_prompt || ''), revision: null};
        return {
            ...raw,
            operator_id: String(raw?.operator_id || ''),
            display_name: String(raw?.display_name || raw?.operator_id || ''),
            requested_mode: String(raw?.requested_mode || 'default'),
            effective_mode: String(raw?.effective_mode || 'description'),
            catalog_tag: String(raw?.catalog_tag || ''),
            custom_tag: String(raw?.custom_tag || ''),
            tag_source: String(raw?.tag_source || ''),
            appearance_description: appearanceDescription,
            current_outfit: currentOutfit,
            final_identity_prompt: String(raw?.final_identity_prompt || raw?.effective_identity_prompt || ''),
            provider_compatibility: {
                status: String(compatibility.status || 'unknown'),
                message: String(compatibility.message || '当前图片服务尚未声明角色 Tag 兼容性')
            },
            revision: Number(raw?.revision || raw?.preference_revision || 0),
            catalog_revision: String(raw?.catalog_revision || '')
        };
    }

    function defaultCharacterPromptDraft(item) {
        const override = state.characterPromptOverrides.get(item.operator_id) || {};
        return {
            mode: String(override.mode || item.requested_mode || 'default'),
            custom_tag: String(override.custom_tag ?? item.custom_tag ?? ''),
            outfit_description: String(override.outfit_override?.description ?? item.current_outfit?.description ?? ''),
            applied: state.characterPromptOverrides.has(item.operator_id)
        };
    }

    function characterPromptDraft(item) {
        if (!state.characterPromptDrafts.has(item.operator_id)) {
            state.characterPromptDrafts.set(item.operator_id, defaultCharacterPromptDraft(item));
        }
        return state.characterPromptDrafts.get(item.operator_id);
    }

    function characterPromptEffectiveMode(item, draft) {
        if (draft.mode !== 'default') return draft.mode;
        return item.catalog_tag ? 'character_tag' : 'description';
    }

    function buildCharacterPromptPreview(item, draft) {
        const mode = characterPromptEffectiveMode(item, draft);
        const tag = String(draft.custom_tag || item.catalog_tag || '').trim();
        const appearance = String(item.appearance_description || '').trim();
        const outfit = String(draft.outfit_description || item.current_outfit?.description || '').trim();
        const parts = [];
        if ((mode === 'character_tag' || mode === 'hybrid') && tag) parts.push(tag);
        if ((mode === 'description' || mode === 'hybrid') && appearance) parts.push(appearance);
        if (outfit) parts.push(outfit);
        return parts.join(', ') || item.final_identity_prompt || '当前角色没有可用的外貌或衣装描述';
    }

    function buildCharacterPromptOverride(item, draft) {
        const override = {
            mode: draft.mode,
            custom_tag: draft.custom_tag || null
        };
        const currentDescription = String(item.current_outfit?.description || '').trim();
        const draftDescription = String(draft.outfit_description || '').trim();
        if (draftDescription && draftDescription !== currentDescription) {
            override.outfit_override = {
                look_id: item.current_outfit?.look_id || null,
                name: item.current_outfit?.name || '本次衣装',
                description: draftDescription,
                revision: item.current_outfit?.revision ?? null
            };
        }
        return override;
    }

    function characterPromptOverridesPayload() {
        const operatorIds = new Set(characterPromptOperatorIds());
        const payload = {};
        state.characterPromptOverrides.forEach((override, operatorId) => {
            if (operatorIds.has(operatorId)) payload[operatorId] = override;
        });
        if (operatorIds.size === 1) {
            const operatorId = [...operatorIds][0];
            const item = state.characterPromptItems.get(operatorId);
            const legacyOutfit = value('image-workspace-outfit');
            if (item && legacyOutfit && legacyOutfit !== String(item.current_outfit?.description || '').trim()) {
                payload[operatorId] = {
                    ...(payload[operatorId] || {mode: item.requested_mode || 'default', custom_tag: item.custom_tag || null}),
                    outfit_override: {
                        look_id: item.current_outfit?.look_id || null,
                        name: item.current_outfit?.name || '本次衣装',
                        description: legacyOutfit,
                        revision: item.current_outfit?.revision ?? null
                    }
                };
            }
        }
        return payload;
    }

    function renderCharacterPromptCards() {
        const list = byId('image-workspace-character-prompt-list');
        const status = byId('image-workspace-character-prompt-status');
        if (!list) return;
        const operatorIds = characterPromptOperatorIds();
        if (!operatorIds.length) {
            list.innerHTML = '<div class="image-empty-state">填写相关干员后，可设置英文名 Tag、外貌描述或融合模式。</div>';
            if (status) status.textContent = '';
            return;
        }
        const cards = operatorIds.map(operatorId => {
            const item = state.characterPromptItems.get(operatorId);
            if (!item) {
                return `<article class="image-character-prompt-card unavailable"><strong>${escapeHtml(operatorId)}</strong><p>该ID不是可配置的正式干员，仍会作为普通角色参与方案。</p></article>`;
            }
            const draft = characterPromptDraft(item);
            const effectiveMode = characterPromptEffectiveMode(item, draft);
            const compatibility = item.provider_compatibility;
            const modeOptions = Object.entries(CHARACTER_PROMPT_MODE_LABELS).map(([mode, label]) => `<option value="${mode}"${draft.mode === mode ? ' selected' : ''}>${label}</option>`).join('');
            return `<article class="image-character-prompt-card${draft.applied ? ' applied' : ''}" data-character-prompt-card="${escapeHtml(operatorId)}">
                <header><span><strong>${escapeHtml(item.display_name)}</strong><small>${escapeHtml(operatorId)}</small></span><em>${escapeHtml(CHARACTER_PROMPT_MODE_LABELS[effectiveMode] || effectiveMode)}</em></header>
                <div class="image-character-prompt-grid">
                    <label>角色识别方式<select data-character-prompt-mode>${modeOptions}</select></label>
                    <label>自定义英文 Tag<input data-character-prompt-tag type="text" maxlength="160" value="${escapeHtml(draft.custom_tag)}" placeholder="${escapeHtml(item.catalog_tag || '例如 name(arknights)')}"></label>
                    <label class="image-character-prompt-span">本次衣装<textarea data-character-prompt-outfit rows="2" maxlength="1200">${escapeHtml(draft.outfit_description)}</textarea></label>
                </div>
                <dl><div><dt>目录 Tag</dt><dd>${escapeHtml(item.catalog_tag || '暂无推荐 Tag')}${item.tag_source ? ` · ${escapeHtml(item.tag_source)}` : ''}</dd></div><div><dt>当前衣装</dt><dd>${escapeHtml(item.current_outfit?.name || '未命名衣装')} · v${escapeHtml(item.current_outfit?.revision ?? '—')}</dd></div></dl>
                <p class="image-character-provider-status" data-state="${escapeHtml(compatibility.status)}">${escapeHtml(compatibility.message)}</p>
                <div class="image-character-prompt-preview"><span>最终身份 Prompt 预览</span><pre data-character-prompt-preview>${escapeHtml(buildCharacterPromptPreview(item, draft))}</pre></div>
                <footer><button class="btn-secondary" type="button" data-character-prompt-action="apply">仅本次使用</button><button class="btn-primary" type="button" data-character-prompt-action="save">保存为该干员默认</button><button class="btn-secondary" type="button" data-character-prompt-action="reset">恢复随包推荐设置</button></footer>
            </article>`;
        });
        list.innerHTML = cards.join('');
        if (status) status.textContent = `已识别 ${state.characterPromptItems.size} 名可配置干员；本次覆盖仅写入新方案快照。`;
    }

    function scheduleCharacterPromptLoad(delay = 220) {
        clearTimeout(state.characterPromptLoadTimer);
        state.characterPromptLoadTimer = setTimeout(() => loadCharacterPromptItems(), delay);
    }

    async function loadCharacterPromptItems() {
        const operatorIds = characterPromptOperatorIds();
        state.characterPromptRequestController?.abort();
        const generation = ++state.characterPromptRequestGeneration;
        if (!operatorIds.length) {
            state.characterPromptItems.clear();
            renderCharacterPromptCards();
            return;
        }
        const controller = new AbortController();
        state.characterPromptRequestController = controller;
        const status = byId('image-workspace-character-prompt-status');
        if (status) status.textContent = '正在读取干员生图身份配置…';
        const params = new URLSearchParams();
        operatorIds.forEach(operatorId => params.append('operator_ids', operatorId));
        const providerAdapter = String(state.manifest?.generation_profile?.protocol_id || '');
        if (providerAdapter) params.set('provider_adapter', providerAdapter);
        try {
            const payload = await api(`/image-workspace/character-prompts?${params.toString()}`, {signal: controller.signal});
            if (generation !== state.characterPromptRequestGeneration) return;
            const next = new Map();
            (payload.items || []).forEach(raw => {
                const item = normalizeCharacterPromptItem(raw);
                if (item.operator_id) next.set(item.operator_id, item);
            });
            state.characterPromptItems = next;
            [...state.characterPromptDrafts.keys()].forEach(operatorId => {
                if (!operatorIds.includes(operatorId)) state.characterPromptDrafts.delete(operatorId);
            });
            renderCharacterPromptCards();
        } catch (error) {
            if (error.name === 'AbortError' || generation !== state.characterPromptRequestGeneration) return;
            if (status) status.textContent = `读取失败：${error.message}`;
            toast(error.message, 'error');
        }
    }

    function updateCharacterPromptDraft(card) {
        const operatorId = card?.dataset.characterPromptCard || '';
        const item = state.characterPromptItems.get(operatorId);
        if (!item) return null;
        const draft = {
            mode: String(card.querySelector('[data-character-prompt-mode]')?.value || 'default'),
            custom_tag: String(card.querySelector('[data-character-prompt-tag]')?.value || '').trim(),
            outfit_description: String(card.querySelector('[data-character-prompt-outfit]')?.value || '').trim(),
            applied: false
        };
        state.characterPromptDrafts.set(operatorId, draft);
        const preview = card.querySelector('[data-character-prompt-preview]');
        if (preview) preview.textContent = buildCharacterPromptPreview(item, draft);
        const badge = card.querySelector('header em');
        const effectiveMode = characterPromptEffectiveMode(item, draft);
        if (badge) badge.textContent = CHARACTER_PROMPT_MODE_LABELS[effectiveMode] || effectiveMode;
        card.classList.remove('applied');
        markPlanDirty();
        return draft;
    }

    async function handleCharacterPromptAction(event) {
        const button = event.target.closest('[data-character-prompt-action]');
        if (!button) return;
        const card = button.closest('[data-character-prompt-card]');
        const operatorId = card?.dataset.characterPromptCard || '';
        const item = state.characterPromptItems.get(operatorId);
        if (!item) return;
        const draft = updateCharacterPromptDraft(card) || characterPromptDraft(item);
        const action = button.dataset.characterPromptAction;
        if (action === 'apply') {
            if (['character_tag', 'hybrid'].includes(characterPromptEffectiveMode(item, draft)) && !(draft.custom_tag || item.catalog_tag)) {
                toast('当前干员没有可用英文名 Tag，请填写自定义 Tag 或改用外貌描述', 'error');
                return;
            }
            state.characterPromptOverrides.set(operatorId, buildCharacterPromptOverride(item, draft));
            draft.applied = true;
            renderCharacterPromptCards();
            markPlanDirty();
            toast('已应用到本次方案；不会修改该干员默认设置', 'success');
            return;
        }
        button.disabled = true;
        try {
            let payload;
            if (action === 'save') {
                payload = await api(`/image-workspace/character-prompts/operator/${encodeURIComponent(operatorId)}`, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        mode: draft.mode,
                        custom_tag: draft.custom_tag || null,
                        expected_revision: item.revision,
                        provider_adapter: String(state.manifest?.generation_profile?.protocol_id || '')
                    })
                });
                toast('该干员的生图身份偏好已保存', 'success');
            } else if (action === 'reset') {
                const resetParams = new URLSearchParams();
                if (item.revision) resetParams.set('expected_revision', String(item.revision));
                const providerAdapter = String(state.manifest?.generation_profile?.protocol_id || '');
                if (providerAdapter) resetParams.set('provider_adapter', providerAdapter);
                const suffix = resetParams.toString() ? `?${resetParams.toString()}` : '';
                payload = await api(`/image-workspace/character-prompts/operator/${encodeURIComponent(operatorId)}${suffix}`, {method: 'DELETE'});
                state.characterPromptOverrides.delete(operatorId);
                toast('已恢复随包推荐设置', 'success');
            } else {
                return;
            }
            const updated = normalizeCharacterPromptItem(payload.item || payload);
            state.characterPromptItems.set(operatorId, updated);
            state.characterPromptDrafts.set(operatorId, defaultCharacterPromptDraft(updated));
            renderCharacterPromptCards();
            markPlanDirty();
        } catch (error) {
            toast(error.status === 409 ? '设置已在其他位置更新，请刷新后重试' : error.message, 'error');
        } finally {
            button.disabled = false;
        }
    }

    function chatPlanningSignature() {
        return [
            state.selectedConversationKey,
            state.selectedBranchId,
            state.selectedViewRevision,
            state.anchorMessageUid,
            ...[...state.participantDecisions.entries()].map(([actorId, item]) => `${actorId}:${item.state}`),
            ...state.selectedMessageUids
        ].join('|');
    }

    function setPlanningStatus(message, kind = '') {
        const status = byId('image-workspace-planning-status');
        if (!status) return;
        status.textContent = message || '';
        status.dataset.state = kind;
        status.hidden = !message;
    }

    function applyPlannedImagePlan(record) {
        const plan = record?.plan || {};
        state.plan = record;
        if (byId('image-workspace-actors') && Array.isArray(plan.characters)) byId('image-workspace-actors').value = plan.characters.join(', ');
        if (byId('image-workspace-scene')) byId('image-workspace-scene').value = plan.scene || '';
        if (byId('image-workspace-positive')) byId('image-workspace-positive').value = plan.positive_prompt || '';
        if (byId('image-workspace-negative')) byId('image-workspace-negative').value = plan.negative_prompt || '';
        if (byId('image-workspace-pov') && plan.pov) byId('image-workspace-pov').value = plan.pov;
        if (byId('image-workspace-ratio') && plan.aspect_ratio) byId('image-workspace-ratio').value = plan.aspect_ratio;
        if (byId('image-workspace-style')) byId('image-workspace-style').value = plan.style || '';
        scheduleCharacterPromptLoad(0);
        state.planningSourceSignature = chatPlanningSignature();
        state.planDirty = false;
        const fidelity = plan.fidelity_report || {};
        const repaired = Number(plan.planning_repair_count || 0) > 0;
        const message = fidelity.critical_count
            ? '规划仍有关键场景冲突，请查看忠实度报告后修改或重新规划。'
            : `生图规划已完成${repaired ? '，并已自动修复一次场景冲突' : ''}。请检查后再创建方案。`;
        setPlanningStatus(message, fidelity.critical_count ? 'failed' : 'succeeded');
    }

    async function planChatSource() {
        if (state.planningActive) return false;
        if ((value('image-workspace-source-type') || '') !== 'chat' || !state.selectedConversationKey || !state.selectedMessageUids.size) {
            toast('请先选择聊天及至少一条消息', 'error');
            return false;
        }
        if (!state.anchorMessageUid || !state.selectedMessageUids.has(state.anchorMessageUid)) {
            toast('请选择一条消息作为画面锚点', 'error');
            return false;
        }
        if (!state.participantsConfirmed) {
            toast('请先确认本次入镜人物', 'error');
            return false;
        }
        const [chatType, ...chatIdParts] = state.selectedConversationKey.split(':');
        const chatId = chatIdParts.join(':');
        if (!chatId || !['private', 'group'].includes(chatType)) {
            toast('当前聊天来源无法用于生图规划，请重新选择会话', 'error');
            return false;
        }
        const generation = ++state.planningGeneration;
        const button = byId('image-workspace-ai-plan');
        state.planningActive = true;
        if (button) button.disabled = true;
        setPlanningStatus('正在提交生图规划…', 'submitting');
        try {
            const accepted = await api('/media/images/plan', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    source_message_uids: [...state.selectedMessageUids],
                    chat_type: chatType,
                    chat_id: chatId,
                    owner_persona_id: currentPersona(),
                    pov: value('image-workspace-pov') || 'third_person',
                    proposal_id: state.proposalId || undefined,
                    branch_id: state.selectedBranchId,
                    timeline_view_revision: state.selectedViewRevision,
                    anchor_message_uid: state.anchorMessageUid,
                    participant_decisions: participantDecisionPayload(),
                    participants_confirmed: true,
                    include_zoot_context: false,
                    client_request_id: requestId('workspace-planning')
                })
            });
            let job = accepted.job;
            if (!job?.id) throw new Error('生图规划任务未正确创建');
            for (let attempt = 0; attempt < 180; attempt += 1) {
                if (generation !== state.planningGeneration) return false;
                if (job.status === 'completed') {
                    let record = job.result?.image_plan_record;
                    const planId = job.result?.image_plan_id || job.request?.image_plan_id;
                    if (!record && planId) {
                        record = (await api(`/image-interactions/plans/${encodeURIComponent(planId)}`)).image_plan;
                    }
                    if (!record) throw new Error('生图规划完成，但未返回可编辑方案');
                    applyPlannedImagePlan(record);
                    toast('已使用生图规划服务生成场景和提示词', 'success');
                    return true;
                }
                if (['failed', 'cancelled'].includes(job.status)) {
                    throw new Error(job.error_message || job.result?.error_message || '生图规划失败');
                }
                setPlanningStatus('生图规划服务正在分析所选聊天…', 'waiting');
                await new Promise(resolve => setTimeout(resolve, 1000));
                job = (await api(`/media/jobs/${encodeURIComponent(job.id)}`)).job;
            }
            throw new Error('生图规划等待超时，请稍后重试');
        } catch (error) {
            if (generation === state.planningGeneration) setPlanningStatus(`规划失败：${error.message}`, 'failed');
            toast(error.message, 'error');
            return false;
        } finally {
            if (generation === state.planningGeneration) {
                state.planningActive = false;
                if (button) button.disabled = false;
            }
        }
    }

    function setSourceMode(mode) {
        state.sourceMode = mode;
        document.querySelectorAll('[data-image-source-mode]').forEach(button => {
            const selected = button.dataset.imageSourceMode === mode;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
        const chatMode = mode === 'current_chat' || mode === 'select_chat';
        if (byId('image-workspace-chat-picker')) byId('image-workspace-chat-picker').hidden = !chatMode;
        if (byId('image-workspace-source-type-field')) byId('image-workspace-source-type-field').hidden = mode !== 'other';
        if (byId('image-workspace-source-text')) byId('image-workspace-source-text').closest('label').hidden = mode !== 'free' && mode !== 'other';
        if (mode === 'free') {
            byId('image-workspace-source-type').value = 'free';
            state.selectedMessageUids.clear();
            renderSelectedMessages();
        } else if (chatMode) {
            byId('image-workspace-source-type').value = 'chat';
            if (mode === 'select_chat') {
                loadChatSources(false);
            } else {
                selectCurrentChat();
            }
        }
    }

    function selectCurrentChat() {
        let conversationKey = state.selectedConversationKey;
        try {
            if (!conversationKey && typeof currentGroupId !== 'undefined' && currentGroupId) conversationKey = `group:${currentGroupId}`;
            if (!conversationKey && typeof currentOperatorId !== 'undefined' && currentOperatorId) conversationKey = `private:${currentOperatorId}`;
        } catch (_) {
            conversationKey = '';
        }
        if (!conversationKey) {
            if (byId('image-workspace-message-list')) byId('image-workspace-message-list').innerHTML = '<div class="image-empty-state">当前没有打开的聊天，请选择已有聊天</div>';
            return;
        }
        state.selectedConversationKey = conversationKey;
        loadChatMessages(false);
    }

    async function loadChatSources(append = false) {
        const generation = ++state.sourceRequestGeneration;
        state.sourceRequestController?.abort();
        state.sourceRequestController = new AbortController();
        const cursor = append ? state.chatSourceCursor : '';
        try {
            const params = new URLSearchParams({q: value('image-workspace-chat-search'), cursor, limit: '30'});
            const payload = await api(`/image-workspace/chat-sources?${params}`, {signal: state.sourceRequestController.signal});
            if (generation !== state.sourceRequestGeneration) return;
            state.chatSources = append ? state.chatSources.concat(payload.items || []) : (payload.items || []);
            state.chatSourceCursor = payload.next_cursor || '';
            const list = byId('image-workspace-chat-list');
            if (list) list.innerHTML = state.chatSources.length ? state.chatSources.map(item => `
                <button type="button" class="image-chat-source-card ${item.conversation_key === state.selectedConversationKey ? 'active' : ''}" data-image-conversation="${escapeHtml(item.conversation_key)}">
                    <strong>${escapeHtml(item.display_name)}</strong><span>${escapeHtml(item.chat_type === 'group' ? '群聊' : '私聊')} · ${escapeHtml(item.message_count)} 条</span><small>${escapeHtml(item.last_message || '暂无消息')}</small>
                </button>`).join('') : '<div class="image-empty-state">没有匹配的会话</div>';
            if (byId('image-workspace-chat-more')) byId('image-workspace-chat-more').hidden = !state.chatSourceCursor;
        } catch (error) {
            if (error.name !== 'AbortError') toast(error.message, 'error');
        }
    }

    async function selectChatSource(conversationKey) {
        state.planningGeneration += 1;
        state.planningSourceSignature = '';
        state.selectedConversationKey = conversationKey;
        state.selectedMessageUids.clear();
        state.anchorMessageUid = '';
        state.participantDecisions.clear();
        state.participantsConfirmed = false;
        state.chatMessages = [];
        state.chatMessageCursor = '';
        await loadChatMessages(false);
        renderSelectedMessages();
        loadChatSources(false);
    }

    async function loadChatMessages(append = false) {
        if (!state.selectedConversationKey) return;
        const generation = ++state.sourceRequestGeneration;
        state.sourceRequestController?.abort();
        state.sourceRequestController = new AbortController();
        const params = new URLSearchParams({conversation_key: state.selectedConversationKey, q: value('image-workspace-message-search'), cursor: append ? state.chatMessageCursor : '', branch_id: state.selectedBranchId || 'active', limit: '50'});
        try {
            const payload = await api(`/image-workspace/chat-messages?${params}`, {signal: state.sourceRequestController.signal});
            if (generation !== state.sourceRequestGeneration) return;
            state.chatMessages = append ? state.chatMessages.concat(payload.items || []) : (payload.items || []);
            state.chatMessageCursor = payload.next_cursor || '';
            state.selectedBranchId = payload.active_branch_id || state.selectedBranchId;
            state.selectedViewRevision = String(payload.timeline_view_revision || '');
            renderChatMessages();
            renderParticipantDecisions();
        } catch (error) {
            if (error.name !== 'AbortError') toast(error.message, 'error');
        }
    }

    function renderChatMessages() {
        const list = byId('image-workspace-message-list');
        if (!list) return;
        list.innerHTML = state.chatMessages.length ? state.chatMessages.map((item, index) => `<button type="button" class="image-chat-message-card ${state.selectedMessageUids.has(item.message_uid) ? 'selected' : ''}" data-image-message-index="${index}" aria-pressed="${state.selectedMessageUids.has(item.message_uid)}"><span>${escapeHtml(item.sender || (item.is_scenario ? '情景' : '消息'))}</span><time>${escapeHtml(new Date(Number(item.timestamp || 0) * 1000).toLocaleString())}</time><p>${escapeHtml(item.preview || '无文本摘要')}</p></button>`).join('') : '<div class="image-empty-state">没有可用于生图的已落库消息</div>';
        if (byId('image-workspace-message-more')) byId('image-workspace-message-more').hidden = !state.chatMessageCursor;
    }

    function selectMessageAnchor(index) {
        const selected = state.chatMessages.slice(index, index + 6).map(item => item.message_uid).filter(Boolean);
        state.selectedMessageUids = new Set(selected.slice(0, 12));
        state.anchorMessageUid = String(state.chatMessages[index]?.message_uid || '');
        state.participantsConfirmed = false;
        state.planningGeneration += 1;
        state.planningSourceSignature = '';
        setPlanningStatus('', '');
        renderChatMessages();
        renderSelectedMessages();
    }

    function renderSelectedMessages() {
        const summary = byId('image-workspace-selected-summary');
        if (summary) summary.textContent = state.selectedMessageUids.size ? `已选择 ${state.selectedMessageUids.size} 条消息；锚点为当前点击消息，可继续增删（最多 12 条）` : '尚未选择消息';
        renderParticipantDecisions();
    }
    function detectedImageParticipants() {
        const detected = new Map();
        (state.workspaceOptions?.detectedParticipants || []).forEach(item => {
            const actorId = String(item?.actor_id || '').trim();
            if (!actorId) return;
            detected.set(actorId, {
                actor_id: actorId,
                role_type: String(item.role_type || 'operator'),
                display_name: String(item.display_name || actorId)
            });
        });
        const selected = state.selectedMessageUids;
        state.chatMessages.forEach(item => {
            if (!selected.has(String(item.message_uid || ''))) return;
            const sender = String(item.sender || '').trim();
            if (!sender || ['system', 'scenario', 'narrator'].includes(sender)) return;
            const isPersona = sender === 'doctor';
            const actorId = isPersona ? String(item.persona_id || currentPersona() || 'doctor') : sender;
            if (!actorId) return;
            detected.set(actorId, {
                actor_id: actorId,
                role_type: isPersona ? 'persona' : String(item.role_type || 'operator'),
                display_name: isPersona ? '当前人格' : sender
            });
        });
        if (state.selectedConversationKey.startsWith('private:')) {
            const actorId = state.selectedConversationKey.slice('private:'.length);
            if (actorId && !detected.has(actorId)) {
                detected.set(actorId, {actor_id: actorId, role_type: 'operator', display_name: actorId});
            }
            const personaId = currentPersona();
            if (personaId && !detected.has(personaId)) {
                detected.set(personaId, {actor_id: personaId, role_type: 'persona', display_name: '当前人格'});
            }
        }
        return [...detected.values()];
    }

    function renderParticipantDecisions() {
        const root = byId('image-workspace-participants');
        const status = byId('image-workspace-participant-status');
        if (!root) return;
        const detected = detectedImageParticipants();
        const next = new Map();
        detected.forEach(item => {
            const previous = state.participantDecisions.get(item.actor_id);
            next.set(item.actor_id, {...item, state: previous?.state || 'visible'});
        });
        if ([...next.keys()].join('|') !== [...state.participantDecisions.keys()].join('|')) {
            state.participantsConfirmed = false;
            state.planningSourceSignature = '';
        }
        state.participantDecisions = next;
        root.innerHTML = detected.length ? detected.map(item => {
            const decision = next.get(item.actor_id);
            return `<label class="image-participant-row">
                <span><strong>${escapeHtml(item.display_name)}</strong><small>${escapeHtml(item.role_type)}</small></span>
                <select data-image-participant="${escapeHtml(item.actor_id)}" aria-label="${escapeHtml(item.display_name)}的入镜状态">
                    <option value="visible" ${decision.state === 'visible' ? 'selected' : ''}>入镜</option>
                    <option value="offscreen" ${decision.state === 'offscreen' ? 'selected' : ''}>画外存在</option>
                    <option value="excluded" ${decision.state === 'excluded' ? 'selected' : ''}>排除</option>
                </select>
            </label>`;
        }).join('') : '<div class="image-empty-state">请先选择能够识别发言人的消息</div>';
        if (status) {
            status.textContent = state.participantsConfirmed ? '已确认本次入镜人物' : '请检查并确认人物状态后再规划';
            status.dataset.state = state.participantsConfirmed ? 'confirmed' : 'pending';
        }
    }

    function participantDecisionPayload() {
        return [...state.participantDecisions.values()].map(item => ({
            actor_id: item.actor_id,
            role_type: item.role_type,
            state: item.state
        }));
    }

    function confirmImageParticipants() {
        const decisions = participantDecisionPayload();
        if (!decisions.some(item => item.state === 'visible')) {
            toast('至少需要一名人物处于“入镜”状态', 'error');
            return;
        }
        state.participantsConfirmed = true;
        state.planningSourceSignature = '';
        renderParticipantDecisions();
        toast('本次入镜人物已确认', 'success');
    }


    async function savePromptPreset() {
        let replacements;
        try { replacements = JSON.parse(value('image-workspace-preset-replacements') || '[]'); } catch (_) { toast('替换规则必须是 JSON 数组', 'error'); return; }
        const selected = state.promptPresets.find(item => item.preset_id === value('image-workspace-prompt-preset'));
        const updating = Boolean(selected?.preset_id && !selected.built_in);
        const endpoint = updating ? `/image-workspace/prompt-presets/${encodeURIComponent(selected.preset_id)}` : '/image-workspace/prompt-presets';
        const payload = await api(endpoint, {method: updating ? 'PATCH' : 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: value('image-workspace-preset-name') || '自定义预设', prefix_positive: value('image-workspace-preset-prefix'), suffix_positive: value('image-workspace-preset-suffix'), fixed_negative: value('image-workspace-preset-negative'), quality_prompt: value('image-workspace-preset-quality'), replacements, expected_revision: updating ? selected.revision : undefined})});
        if (updating) state.promptPresets = state.promptPresets.map(item => item.preset_id === payload.preset.preset_id ? payload.preset : item);
        else state.promptPresets.push(payload.preset);
        renderPromptPresetOptions();
        byId('image-workspace-prompt-preset').value = payload.preset.preset_id;
        renderPromptPresetEditor();
        toast(updating ? '创作预设已更新' : '创作预设已保存', 'success');
    }

    async function deletePromptPreset() {
        const presetId = value('image-workspace-prompt-preset');
        const preset = state.promptPresets.find(item => item.preset_id === presetId);
        if (!preset || preset.built_in) return;
        await api(`/image-workspace/prompt-presets/${encodeURIComponent(presetId)}`, {method: 'DELETE'});
        state.promptPresets = state.promptPresets.filter(item => item.preset_id !== presetId);
        renderPromptPresetOptions();
        toast('创作预设已删除', 'success');
    }

    async function previewContext() {
        const sourceType = value('image-workspace-source-type') || 'free';
        const sourceId = value('image-workspace-source-id');
        try {
            const payload = await api('/image-workspace/contexts/preview', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({source_type: sourceType, source_id: state.selectedMessageUids.size ? [...state.selectedMessageUids].join(',') : sourceId, options: {...(state.workspaceOptions.contextOptions || {}), text: value('image-workspace-source-text'), message_uids: [...state.selectedMessageUids], conversation_key: state.selectedConversationKey, branch_id: state.selectedBranchId, expected_view_revision: state.selectedViewRevision}})
            });
            applyContext(payload.context);
            toast('来源快照已锁定，可继续编辑场景', 'success');
            setStep(2);
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    function readWorkflowInputs() {
        const raw = value('image-workspace-workflow-inputs');
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
            throw new Error('工作流参数必须是 JSON 对象');
        }
        return parsed;
    }

    function buildPlanPayload() {
        const destinationChoice = value('image-workspace-destination');
        const render = {
            width: value('image-workspace-width') ? Number(value('image-workspace-width')) : null,
            height: value('image-workspace-height') ? Number(value('image-workspace-height')) : null,
            quality: value('image-workspace-quality'),
            variant_count: Math.max(1, Math.min(Number(value('image-workspace-variants') || 1), 8)),
            seed_mode: value('image-workspace-seed-mode') || 'random',
            seed: value('image-workspace-seed') || null,
            sampler: value('image-workspace-sampler'),
            scheduler: value('image-workspace-scheduler'),
            steps: value('image-workspace-steps') ? Number(value('image-workspace-steps')) : null,
            cfg: value('image-workspace-cfg') ? Number(value('image-workspace-cfg')) : null,
            cfg_rescale: value('image-workspace-cfg-rescale') ? Number(value('image-workspace-cfg-rescale')) : null,
            variety: Boolean(byId('image-workspace-variety')?.checked),
            character_position: value('image-workspace-character-position') || 'auto',
            denoise: value('image-workspace-denoise') ? Number(value('image-workspace-denoise')) : null,
            workflow_inputs: readWorkflowInputs()
        };
        Object.keys(render).forEach(key => {
            if (render[key] === '' || render[key] === null) {
                delete render[key];
            }
        });
        return {
            source_type: value('image-workspace-source-type') || 'free',
            source_id: state.selectedMessageUids.size ? [...state.selectedMessageUids].join(',') : value('image-workspace-source-id'),
            context_options: {...(state.workspaceOptions.contextOptions || {}), text: value('image-workspace-source-text'), message_uids: [...state.selectedMessageUids], branch_id: state.selectedBranchId, expected_view_revision: state.selectedViewRevision},
            intent: value('image-workspace-intent') || 'free',
            operator_ids: splitIds(value('image-workspace-actors')),
            characters: splitIds(value('image-workspace-actors')),
            character_prompt_overrides: characterPromptOverridesPayload(),
            scene: value('image-workspace-scene'),
            positive_prompt: value('image-workspace-positive'),
            negative_prompt: value('image-workspace-negative'),
            prompt_input_positive: value('image-workspace-positive'),
            prompt_input_negative: value('image-workspace-negative'),
            prompt_preset_id: value('image-workspace-prompt-preset') || 'none',
            artist_style_chain_id: value('image-workspace-artist-chain'),
            pov: value('image-workspace-pov') || 'third_person',
            aspect_ratio: value('image-workspace-ratio') || '1:1',
            style: value('image-workspace-style'),
            camera: {
                shot: value('image-workspace-shot'),
                angle: value('image-workspace-angle'),
                lens: value('image-workspace-lens'),
                composition: value('image-workspace-composition'),
                pose_and_gaze: value('image-workspace-pose')
            },
            lighting: {lighting: value('image-workspace-lighting'), mood: value('image-workspace-mood')},
            render,
            include_zoot_context: (value('image-workspace-source-type') || '') === 'chat' ? false : Boolean(byId('image-workspace-continuity')?.checked),
            destination: state.workspaceOptions.destination || (destinationChoice === 'source' && state.context?.default_destination ? state.context.default_destination : {type: 'gallery'}),
            owner_persona_id: currentPersona(),
            proposal_id: state.proposalId || undefined,
            client_request_id: requestId('workspace-plan')
        };
    }

    function renderConfirmation(record) {
        const plan = record.plan || {};
        const summary = byId('image-workspace-confirm-summary');
        if (!summary) {
            return;
        }
        const source = plan.source || {};
        const privacy = plan.privacy || {};
        const preset = plan.prompt_preset_snapshot || {};
        const artistChain = plan.artist_style_chain_snapshot || {};
        const grounding = plan.scene_grounding || {};
        const fidelity = plan.fidelity_report || {};
        const snapshot = plan.planning_context_snapshot || {};
        const anchor = (snapshot.message_summaries || []).find(item => item.is_anchor) || {};
        const visiblePeople = (plan.participants || []).filter(item => item.state === 'visible').map(item => item.display_name || item.actor_id);
        const offscreenPeople = (plan.participants || []).filter(item => item.state === 'offscreen').map(item => item.display_name || item.actor_id);
        const fidelityChecks = (fidelity.checks || []).map(item => `${item.critical ? '关键' : '提示'}：${item.message}`);
        const generationProfile = state.manifest?.generation_profile || {};
        const supportedParameters = new Set((generationProfile.schema || []).map(item => item.id));
        if (generationProfile.protocol_id === 'comfyui_api') supportedParameters.add('workflow_inputs');
        const degradedParameters = Object.keys(plan.render || {}).filter(key => !supportedParameters.has(key) && key !== 'seed_mode');
        summary.innerHTML = `
            <div><strong>方案修订</strong><span>v${escapeHtml(record.revision)} / ImagePlan ${escapeHtml(plan.version || 2)}</span></div>
            <div><strong>来源</strong><span>${escapeHtml(source.type || 'free')} · ${escapeHtml(source.id || '用户描述')}</span></div>
            <div><strong>人物与衣装</strong><span>${escapeHtml((plan.characters || []).join('、') || '无指定人物')} · ${escapeHtml(value('image-workspace-outfit') || '按角色衣柜快照')}</span></div>
            <div><strong>场景与镜头</strong><span>${escapeHtml(plan.scene || '未填写')} · ${escapeHtml(plan.pov)} · ${escapeHtml(plan.aspect_ratio)}</span></div>
            <section class="image-fidelity-summary" data-state="${escapeHtml(fidelity.status || 'unknown')}">
                <h4>场景忠实度</h4>
                <div><strong>锚点消息</strong><span>${escapeHtml(anchor.summary || '未提供安全摘要')}</span></div>
                <div><strong>描绘时刻</strong><span>${escapeHtml(grounding.depicted_moment || plan.scene || '未确定')}</span></div>
                <div><strong>动作与地点</strong><span>${escapeHtml(grounding.action || '动作待确认')} · ${escapeHtml(grounding.location || '地点待确认')}</span></div>
                <div><strong>人物状态</strong><span>入镜：${escapeHtml(visiblePeople.join('、') || '无')}；画外：${escapeHtml(offscreenPeople.join('、') || '无')}</span></div>
                <div><strong>规划修复</strong><span>${escapeHtml(plan.planning_repair_count || 0)} 次；${escapeHtml(fidelity.status || '未检查')}</span></div>
                ${fidelityChecks.length ? `<ul>${fidelityChecks.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>未发现场景忠实度冲突。</p>'}
                <details><summary>Provider发送内容脱敏预览</summary><pre>${escapeHtml(JSON.stringify({positive_prompt: plan.positive_prompt || '', negative_prompt: plan.negative_prompt || '', continuity_facts: plan.continuity_facts || [], camera: plan.camera || {}, lighting: plan.lighting || {}}, null, 2))}</pre></details>
            </section>
            <div><strong>第三方数据</strong><span>${escapeHtml((privacy.blocks || state.context?.privacy_blocks || []).join('、') || '仅当前方案')}；连续性 ${plan.include_zoot_context ? '开启' : '关闭'}</span></div>
            <div><strong>用户/规划内容</strong><span>${escapeHtml(plan.prompt_input_positive || '未填写')}</span></div>
            <div><strong>创作预设</strong><span>${escapeHtml(preset.name || '无预设')} · ${escapeHtml(preset.preset_id || plan.prompt_preset_id || 'none')}</span></div>
            <div><strong>画师串</strong><span>${escapeHtml(artistChain.name || '未使用')} · ${escapeHtml((artistChain.entries || []).map(item => `${item.label} (${item.weight})`).join('、') || '无')}</span></div>
            <div><strong>图片生成服务</strong><span>${generationProfile.profile_id ? `${escapeHtml(generationProfile.profile_name || generationProfile.profile_id)} · ${escapeHtml(generationProfile.model || '未指定模型')}` : '尚未配置图片生成能力路由，提交时将无法生成'}</span></div>
            <div><strong>Provider 技术参数</strong><span>${escapeHtml(JSON.stringify(plan.render || {}))}</span></div>
            ${degradedParameters.length ? `<div><strong>本次降级</strong><span>${escapeHtml(degradedParameters.join('、'))} 不受当前协议支持，将不会发送</span></div>` : ''}
            <details><summary>查看完整确认方案</summary><pre>${escapeHtml(JSON.stringify(plan, null, 2))}</pre></details>`;
    }

    function generationIsActive() {
        return Boolean(state.generation && ['submitting', 'queued', 'running'].includes(state.generation.phase));
    }

    function persistGeneration() {
        if (!state.generation) {
            sessionStorage.removeItem(ACTIVE_GENERATION_STORAGE_KEY);
            return;
        }
        try {
            sessionStorage.setItem(ACTIVE_GENERATION_STORAGE_KEY, JSON.stringify(state.generation));
        } catch (_) {
            return;
        }
    }

    function updateGenerateButton() {
        const button = byId('image-workspace-generate');
        if (!button) return;
        if (state.generationSubmitting) {
            button.disabled = true;
            button.textContent = '正在提交…';
            button.setAttribute('aria-busy', 'true');
            return;
        }
        button.removeAttribute('aria-busy');
        button.textContent = state.planDirty ? '请先更新方案' : '确认并渲染';
        const criticalFidelity = Number(state.plan?.plan?.fidelity_report?.critical_count || 0) > 0;
        button.disabled = !state.plan || state.planDirty || criticalFidelity || !byId('image-workspace-final-confirm')?.checked || generationIsActive();
    }

    function markPlanDirty() {
        if (!state.plan || generationIsActive()) return;
        state.planDirty = true;
        if (byId('image-workspace-final-confirm')) byId('image-workspace-final-confirm').checked = false;
        updateGenerateButton();
    }

    function renderGenerationStatus() {
        const root = byId('image-workspace-render-status');
        if (!root) return;
        const generation = state.generation;
        root.hidden = !generation;
        if (!generation) return;
        const jobs = Array.isArray(generation.jobs) ? generation.jobs : [];
        const statusLabels = {pending: '等待执行', running: '正在生成', completed: '已完成', failed: '失败', cancelled: '已取消', unknown: '暂时无法读取'};
        const completed = jobs.filter(job => job.status === 'completed').length;
        const failed = jobs.filter(job => job.status === 'failed').length;
        const cancelled = jobs.filter(job => job.status === 'cancelled').length;
        const running = jobs.filter(job => ['pending', 'running'].includes(job.status)).length;
        const phaseLabels = {
            submitting: ['正在提交生成任务', '正在保存本次确认并创建任务，请勿重复点击。'],
            queued: ['任务已提交', `${jobs.length || generation.variantCount || 1} 个变体已进入生成队列。`],
            running: ['图片正在生成', `${running} 个处理中，${completed} 个已完成。可以离开本页，任务会继续运行。`],
            succeeded: ['图片生成完成', `${completed} 个变体已写入画廊${generation.destination === 'chat' ? '及原聊天时间线' : ''}。`],
            partial_failed: ['部分变体生成失败', `${completed} 个成功，${failed + cancelled} 个未完成；成功图片已经保留。`],
            failed: ['图片生成失败', '方案和配置均已保留，可以查看原因后重试。'],
        };
        const phase = phaseLabels[generation.phase] || phaseLabels.queued;
        root.dataset.state = generation.phase;
        byId('image-workspace-render-title').textContent = phase[0];
        byId('image-workspace-render-summary').textContent = phase[1];
        const elapsed = Math.max(0, Math.floor((Date.now() - Number(generation.startedAt || Date.now())) / 1000));
        byId('image-workspace-render-elapsed').textContent = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
        const progress = byId('image-workspace-render-progress');
        const terminalCount = completed + failed + cancelled;
        progress.style.width = jobs.length ? `${Math.round(terminalCount * 100 / jobs.length)}%` : '0%';
        progress.parentElement.classList.toggle('indeterminate', generation.phase === 'submitting' || running > 0);
        byId('image-workspace-render-jobs').innerHTML = jobs.map((job, index) => `
            <div data-job-status="${escapeHtml(job.status || 'unknown')}">
                <span>变体 ${index + 1}</span>
                <strong>${escapeHtml(statusLabels[job.status] || job.status || '等待状态')}</strong>
                <small>${escapeHtml(job.model || job.provider || '')}</small>
            </div>`).join('');
        const errors = jobs.map((job, index) => ({job, index})).filter(item => item.job.status === 'failed' || item.job.status_error).map(item => `变体 ${item.index + 1}：${item.job.error_message || item.job.error_code || item.job.status_error || '生成失败'}`);
        if (generation.submitError) errors.unshift(generation.submitError);
        const errorDetails = byId('image-workspace-render-error');
        errorDetails.hidden = !errors.length;
        errorDetails.querySelector('pre').textContent = errors.join('\n');
        byId('image-workspace-render-retry').hidden = failed === 0;
        const routeAction = byId('image-workspace-render-routes');
        if (routeAction) {
            const detail = generation.submitErrorDetail || {};
            routeAction.hidden = detail.action !== 'open_routes' && !String(detail.code || '').startsWith('route_');
        }
        byId('image-workspace-render-cancel').hidden = !generationIsActive() || !jobs.some(job => ['pending', 'running'].includes(job.status));
        persistGeneration();
        updateGenerateButton();
    }

    function stopGenerationTracking() {
        clearTimeout(state.generationPollTimer);
        clearInterval(state.generationElapsedTimer);
        state.generationPollTimer = null;
        state.generationElapsedTimer = null;
        state.generationPollController?.abort();
        state.generationPollController = null;
    }

    function startGenerationElapsedTicker() {
        clearInterval(state.generationElapsedTimer);
        if (!state.generation || !generationIsActive()) return;
        state.generationElapsedTimer = setInterval(() => {
            if (!byId('page-image-workspace')?.classList.contains('active-page')) return;
            renderGenerationStatus();
        }, 1000);
    }

    async function refreshGenerationStatus(scheduleNext = true) {
        const generation = state.generation;
        if (!generation?.jobs?.length) {
            renderGenerationStatus();
            return;
        }
        const requestGeneration = ++state.generationRequestGeneration;
        state.generationPollController?.abort();
        const controller = new AbortController();
        state.generationPollController = controller;
        const jobs = await Promise.all(generation.jobs.map(async previous => {
            try {
                const payload = await api(`/media/jobs/${encodeURIComponent(previous.id)}`, {signal: controller.signal});
                return payload.job || previous;
            } catch (error) {
                if (error.name === 'AbortError') return previous;
                return {...previous, status: previous.status || 'unknown', status_error: error.message};
            }
        }));
        if (requestGeneration !== state.generationRequestGeneration || state.generation !== generation) return;
        generation.jobs = jobs;
        const terminal = jobs.every(job => ['completed', 'failed', 'cancelled'].includes(job.status));
        const completed = jobs.filter(job => job.status === 'completed').length;
        const failed = jobs.filter(job => ['failed', 'cancelled'].includes(job.status)).length;
        if (terminal) {
            generation.phase = completed === jobs.length ? 'succeeded' : completed ? 'partial_failed' : 'failed';
            stopGenerationTracking();
            if (!generation.completionAnnounced) {
                generation.completionAnnounced = true;
                toast(completed ? `图片任务完成：${completed} 个成功${failed ? `，${failed} 个失败` : ''}` : '图片生成失败，方案已保留', completed ? 'success' : 'error');
                if (completed) loadGallery();
            }
        } else {
            generation.phase = jobs.some(job => job.status === 'running') ? 'running' : 'queued';
        }
        renderGenerationStatus();
        startGenerationElapsedTicker();
        if (!terminal && scheduleNext && byId('page-image-workspace')?.classList.contains('active-page')) {
            state.generationPollTimer = setTimeout(() => refreshGenerationStatus(true), 1200);
        }
    }

    async function retryFailedGenerationJobs() {
        if (!state.generation) return;
        const failedJobs = state.generation.jobs.filter(job => job.status === 'failed');
        if (!failedJobs.length) return;
        byId('image-workspace-render-retry').disabled = true;
        try {
            const retried = await Promise.all(failedJobs.map(job => api(`/media/jobs/${encodeURIComponent(job.id)}/retry`, {method: 'POST'})));
            const replacements = new Map(retried.map(payload => [String(payload.job.id), payload.job]));
            state.generation.jobs = state.generation.jobs.map(job => replacements.get(String(job.id)) || job);
            state.generation.phase = 'queued';
            state.generation.completionAnnounced = false;
            state.generation.startedAt = Date.now();
            renderGenerationStatus();
            startGenerationElapsedTicker();
            refreshGenerationStatus(true);
        } catch (error) {
            state.generation.submitError = error.message;
            renderGenerationStatus();
            toast(error.message, 'error');
        } finally {
            byId('image-workspace-render-retry').disabled = false;
        }
    }

    async function cancelGenerationJobs() {
        if (!state.generation?.jobs?.length || !window.confirm('确定取消仍在执行的图片生成任务吗？已完成的图片会保留。')) return;
        const activeJobs = state.generation.jobs.filter(job => ['pending', 'running'].includes(job.status));
        const button = byId('image-workspace-render-cancel');
        button.disabled = true;
        try {
            await Promise.all(activeJobs.map(job => api(`/media/jobs/${encodeURIComponent(job.id)}/cancel`, {method: 'POST'})));
            await refreshGenerationStatus(false);
            toast('已请求取消图片生成任务');
        } catch (error) {
            state.generation.submitError = error.message;
            renderGenerationStatus();
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    }

    function restoreGenerationStatus() {
        if (state.generation) return;
        try {
            const saved = JSON.parse(sessionStorage.getItem(ACTIVE_GENERATION_STORAGE_KEY) || 'null');
            if (saved?.planId) state.generation = saved;
        } catch (_) {
            sessionStorage.removeItem(ACTIVE_GENERATION_STORAGE_KEY);
        }
        renderGenerationStatus();
    }

    async function savePlan() {
        if (generationIsActive()) {
            toast('当前方案正在生成，请等待完成后再修改', 'error');
            return;
        }
        const button = byId('image-workspace-save-plan');
        const originalLabel = button?.textContent || '创建/更新方案';
        if (button) {
            button.disabled = true;
            button.textContent = '正在保存…';
        }
        try {
            const shouldPlanChat = (value('image-workspace-source-type') || '') === 'chat'
                && state.selectedMessageUids.size
                && !value('image-workspace-positive')
                && state.planningSourceSignature !== chatPlanningSignature();
            if (shouldPlanChat) {
                if (button) button.textContent = '正在规划聊天内容…';
                const planned = await planChatSource();
                if (!planned) return;
            }
            const body = buildPlanPayload();
            let payload;
            if (state.plan) {
                payload = await api(`/image-workspace/plans/${encodeURIComponent(state.plan.image_plan_id)}`, {
                    method: 'PUT', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({expected_revision: state.plan.revision, plan: body})
                });
            } else {
                payload = await api('/image-workspace/plans', {
                    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
                });
            }
            state.plan = payload.image_plan;
            state.planDirty = false;
            if (state.generation && !generationIsActive()) {
                state.generation = null;
                persistGeneration();
                renderGenerationStatus();
            }
            renderConfirmation(state.plan);
            setStep(4);
            updateGenerateButton();
            toast('方案已保存，尚未调用图片服务', 'success');
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = originalLabel;
            }
        }
    }

    async function generatePlan() {
        if (!state.plan || !byId('image-workspace-final-confirm')?.checked || state.generationSubmitting) {
            return;
        }
        if (state.planDirty) {
            toast('方案内容已改变，请先点击“更新方案”并重新确认', 'error');
            updateGenerateButton();
            return;
        }
        const button = byId('image-workspace-generate');
        state.generationSubmitting = true;
        state.generation = {phase: 'submitting', jobs: [], startedAt: Date.now(), variantCount: Math.max(1, Math.min(Number(value('image-workspace-variants') || 1), 8)), planId: state.plan.image_plan_id};
        renderGenerationStatus();
        updateGenerateButton();
        try {
            const count = Math.max(1, Math.min(Number(value('image-workspace-variants') || 1), 8));
            const payload = await api(`/image-workspace/plans/${encodeURIComponent(state.plan.image_plan_id)}/generate-variants`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    expected_revision: state.plan.revision,
                    client_request_id: requestId('workspace-render'),
                    count,
                    title: `${state.context?.title || '生图'} · ${value('image-workspace-intent')}`,
                    locks: {character: true, wardrobe: true, camera: value('image-workspace-seed-mode') === 'locked'}
                })
            });
            state.plan = payload.image_plan || state.plan;
            state.generation = {
                ...state.generation,
                phase: 'queued',
                jobs: Array.isArray(payload.jobs) ? payload.jobs : [],
                generationSetId: payload.generation_set?.set_id || '',
                variantCount: payload.variant_count || count,
                destination: state.plan?.plan?.destination?.type === 'chat' ? 'chat' : 'gallery'
            };
            renderGenerationStatus();
            toast(`已提交 ${payload.variant_count || count} 个变体，可在画廊查看进度`, 'success');
            byId('image-workspace-final-confirm').checked = false;
            startGenerationElapsedTicker();
            refreshGenerationStatus(true);
        } catch (error) {
            state.generation = {
                ...state.generation,
                phase: 'failed',
                submitError: error.message,
                submitErrorDetail: error.payload?.detail || {},
                jobs: []
            };
            renderGenerationStatus();
            toast(error.message, 'error');
        } finally {
            state.generationSubmitting = false;
            updateGenerateButton();
        }
    }

    function resetWorkspace(options = {}) {
        state.workspaceStep = 1;
        state.workspaceStepScrollTops.clear();
        const workspaceScroll = document.querySelector('#page-image-workspace > .image-studio-scroll');
        if (workspaceScroll) workspaceScroll.scrollTop = 0;
        state.workspaceOptions = {...options};
        state.context = null;
        state.plan = null;
        state.planDirty = false;
        state.planningGeneration += 1;
        state.planningActive = false;
        state.planningSourceSignature = '';
        setPlanningStatus('', '');
        state.selectedConversationKey = String(options.conversationKey || '');
        state.selectedBranchId = String(options.branchId || '');
        state.selectedViewRevision = String(options.timelineViewRevision || '');
        state.selectedMessageUids = new Set((options.selectedMessageUids || []).map(String).filter(Boolean).slice(0, 12));
        state.anchorMessageUid = String(options.anchorMessageUid || options.sourceId || '');
        if (state.anchorMessageUid && !state.selectedMessageUids.has(state.anchorMessageUid)) state.selectedMessageUids.add(state.anchorMessageUid);
        state.participantDecisions.clear();
        state.participantsConfirmed = false;
        const fields = ['image-workspace-source-id', 'image-workspace-source-text', 'image-workspace-actors', 'image-workspace-outfit', 'image-workspace-scene', 'image-workspace-positive', 'image-workspace-negative'];
        fields.forEach(id => {
            if (byId(id)) {
                byId(id).value = '';
            }
        });
        if (byId('image-workspace-context-preview')) {
            byId('image-workspace-context-preview').textContent = '尚未读取来源';
        }
        if (byId('image-workspace-confirm-summary')) {
            byId('image-workspace-confirm-summary').textContent = '请先完成来源预览并创建方案。';
        }
        updateGenerateButton();
        if (options.sourceType && byId('image-workspace-source-type')) {
            byId('image-workspace-source-type').value = options.sourceType;
        }
        if (options.sourceId && byId('image-workspace-source-id')) {
            byId('image-workspace-source-id').value = options.sourceId;
        }
        if (options.text && byId('image-workspace-source-text')) {
            byId('image-workspace-source-text').value = options.text;
        }
        if (options.intent && byId('image-workspace-intent')) {
            byId('image-workspace-intent').value = options.intent;
        }
        if (options.positivePrompt && byId('image-workspace-positive')) {
            byId('image-workspace-positive').value = options.positivePrompt;
        }
        if (options.scene && byId('image-workspace-scene')) {
            byId('image-workspace-scene').value = options.scene;
        }
        state.proposalId = options.proposalId || '';
        applyGenerationDefaults(state.manifest?.generation_profile || {});
        setSourceMode(options.sourceType === 'chat' ? 'current_chat' : (options.sourceType && options.sourceType !== 'free' ? 'other' : 'free'));
        renderSelectedMessages();
        setStep(1);
    }

    window.openImageWorkspace = async function openImageWorkspace(options = {}) {
        await loadManifest().catch(error => toast(error.message, 'error'));
        resetWorkspace(options);
        openPage('image-workspace');
        loadVisualProposals();
        if (state.selectedConversationKey) await loadChatMessages(false);
        if (options.autoPreview) requestAnimationFrame(() => previewContext());
    };
    window.openImageGallery = function openImageGallery() {
        openPage('image-gallery');
        loadGallery();
    };
    window.openGlobalWardrobe = function openGlobalWardrobe() {
        rememberWardrobeOwnerView();
        state.wardrobeGlobalRestoreScroll = true;
        openPage('wardrobe-global');
    };
    window.openWardrobe = function openWardrobe(ownerType = 'operator', ownerId = '') {
        rememberWardrobeOwnerView();
        state.wardrobeOwnerType = ownerType === 'persona' ? 'persona' : 'operator';
        state.wardrobeOwnerId = String(ownerId || (state.wardrobeOwnerType === 'persona' ? currentPersona() : currentOperator()) || '');
        if (!state.wardrobeOwnerId) {
            toast('没有可打开的衣柜对象', 'error');
            return;
        }
        const saved = state.wardrobeOwnerViews.get(`${state.wardrobeOwnerType}:${state.wardrobeOwnerId}`) || {query: '', scrollTop: 0};
        state.wardrobeOwnerQuery = saved.query;
        state.wardrobeOwnerRestoreScroll = true;
        if (byId('wardrobe-owner-search')) byId('wardrobe-owner-search').value = saved.query;
        openPage('wardrobe-owner');
    };

    function rememberWardrobeOwnerView() {
        if (!state.wardrobeOwnerId) return;
        state.wardrobeOwnerViews.set(`${state.wardrobeOwnerType}:${state.wardrobeOwnerId}`, {
            query: state.wardrobeOwnerQuery,
            scrollTop: byId('wardrobe-owner-scroll')?.scrollTop || 0
        });
    }

    function wardrobeTags(item) {
        return (item?.tags || []).map(tag => `<span class="wardrobe-tag">${escapeHtml(tag)}</span>`).join('');
    }

    function wardrobeCover(item, alt = '') {
        if (item?.cover_url) {
            return `<img class="wardrobe-cover" src="${escapeHtml(item.cover_url)}" alt="${escapeHtml(alt || item.name || '衣装参考图')}" loading="lazy" decoding="async">`;
        }
        return `<div class="wardrobe-cover wardrobe-cover-fallback"><span>WARDROBE</span><strong>${escapeHtml(item?.name || '暂无参考图')}</strong></div>`;
    }

    function wardrobePieceSummary(look, pieces) {
        const map = new Map((pieces || []).map(piece => [String(piece.piece_id), piece]));
        const selected = (look?.piece_ids || []).map(id => map.get(String(id))).filter(Boolean);
        if (!selected.length) {
            return `<p class="wardrobe-description">${escapeHtml(look?.description || '尚未填写衣装描述')}</p>`;
        }
        const slotLabels = {top: '上衣', bottom: '下装', dress: '连衣装', outerwear: '外套', shoes: '鞋履', socks: '袜装', accessory: '饰品', equipment: '装备', other: '其他'};
        return `<div class="wardrobe-piece-summary">${selected.map(piece => `<div><small>${slotLabels[piece.slot] || '单件'}</small><strong>${escapeHtml(piece.name)}</strong><span>${escapeHtml(piece.description || '')}</span></div>`).join('')}</div>${look.description ? `<p class="wardrobe-description wardrobe-description-supplement">${escapeHtml(look.description)}</p>` : ''}`;
    }

    async function loadGlobalWardrobe(append = false) {
        const root = byId('wardrobe-global-grid');
        if (!root) return;
        if (!append) {
            state.wardrobeGlobalRequestController?.abort();
            state.wardrobeGlobalRequestController = new AbortController();
            state.wardrobeGlobalCursor = '';
            state.wardrobeGlobalItems = [];
            root.innerHTML = '<div class="image-empty-state">正在读取全局衣柜…</div>';
        }
        const generation = ++state.wardrobeGlobalRequestGeneration;
        const params = new URLSearchParams({limit: '48'});
        if (state.wardrobeGlobalQuery) params.set('q', state.wardrobeGlobalQuery);
        if (state.wardrobeGlobalOwnerType) params.set('owner_type', state.wardrobeGlobalOwnerType);
        if (append && state.wardrobeGlobalCursor) params.set('cursor', state.wardrobeGlobalCursor);
        try {
            const response = await fetch(`/image-workspace/wardrobe/catalog?${params}`, {signal: state.wardrobeGlobalRequestController?.signal});
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.detail || '全局衣柜加载失败');
            if (generation !== state.wardrobeGlobalRequestGeneration) return;
            state.wardrobeGlobalItems = append ? [...state.wardrobeGlobalItems, ...(payload.items || [])] : (payload.items || []);
            state.wardrobeGlobalCursor = payload.next_cursor || '';
            state.wardrobeGlobalTotal = Number(payload.total || 0);
            renderGlobalWardrobe();
            if (state.wardrobeGlobalRestoreScroll) {
                state.wardrobeGlobalRestoreScroll = false;
                requestAnimationFrame(() => {
                    if (byId('wardrobe-global-scroll')) byId('wardrobe-global-scroll').scrollTop = state.wardrobeGlobalScrollTop;
                });
            }
        } catch (error) {
            if (error.name !== 'AbortError') root.innerHTML = `<div class="image-empty-state">${escapeHtml(error.message)}</div>`;
        }
    }

    function renderGlobalWardrobe() {
        const root = byId('wardrobe-global-grid');
        const summary = byId('wardrobe-global-summary');
        if (!root) return;
        if (summary) summary.textContent = state.wardrobeGlobalQuery ? `找到 ${state.wardrobeGlobalTotal} 个匹配角色` : `当前展示 ${state.wardrobeGlobalTotal} 个已有衣着的角色`;
        root.innerHTML = state.wardrobeGlobalItems.map(item => {
            const look = item.current || {};
            return `<button class="wardrobe-owner-card" type="button" data-wardrobe-open-owner="${escapeHtml(item.owner_type)}" data-owner-id="${escapeHtml(item.owner_id)}">${wardrobeCover(look, `${item.display_name} · ${look.name || '当前衣着'}`)}<span class="wardrobe-owner-card-body"><span class="wardrobe-owner-identity"><img src="${escapeHtml(item.avatar || '')}" alt="" loading="lazy"><span><strong>${escapeHtml(item.display_name)}</strong><small>${item.owner_type === 'persona' ? '博士人格' : '干员'}</small></span></span><b>${escapeHtml(look.name || '当前衣着')}</b><span class="wardrobe-card-tags">${wardrobeTags(look)}</span>${item.match_reason ? `<em>匹配到：${escapeHtml(item.match_reason.replace(/^[^：]+：/, ''))}</em>` : ''}${item.pending_proposal_count ? `<i>${item.pending_proposal_count} 项待审核</i>` : ''}</span></button>`;
        }).join('') || '<div class="image-empty-state">没有符合条件的当前衣着</div>';
        const more = byId('wardrobe-global-more');
        if (more) more.hidden = !state.wardrobeGlobalCursor;
    }

    async function loadWardrobe() {
        const ownerType = state.wardrobeOwnerType;
        const ownerId = state.wardrobeOwnerId;
        const generation = ++state.wardrobeRequestGeneration;
        state.wardrobeRequestController?.abort();
        state.wardrobeRequestController = new AbortController();
        const params = new URLSearchParams();
        if (state.wardrobeOwnerQuery) params.set('q', state.wardrobeOwnerQuery);
        try {
            const suffix = params.toString() ? `?${params}` : '';
            const [response, auditResponse] = await Promise.all([
                fetch(`/image-workspace/wardrobe/${encodeURIComponent(ownerType)}/${encodeURIComponent(ownerId)}${suffix}`, {signal: state.wardrobeRequestController.signal}),
                fetch(`/image-workspace/wardrobe/${encodeURIComponent(ownerType)}/${encodeURIComponent(ownerId)}/audit?limit=30`, {signal: state.wardrobeRequestController.signal})
            ]);
            const payload = await response.json().catch(() => ({}));
            const auditPayload = await auditResponse.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.detail || '专属衣柜加载失败');
            if (generation !== state.wardrobeRequestGeneration) return;
            state.wardrobe = payload;
            renderWardrobe(payload, auditPayload.audit || []);
            if (state.wardrobeOwnerRestoreScroll) {
                state.wardrobeOwnerRestoreScroll = false;
                const saved = state.wardrobeOwnerViews.get(`${ownerType}:${ownerId}`);
                requestAnimationFrame(() => {
                    if (byId('wardrobe-owner-scroll')) byId('wardrobe-owner-scroll').scrollTop = Number(saved?.scrollTop || 0);
                });
            }
        } catch (error) {
            if (error.name !== 'AbortError') toast(error.message, 'error');
        }
    }

    function renderWardrobe(payload, audit) {
        const current = payload.current?.look;
        const ownerName = payload.owner?.display_name || payload.owner_id;
        const title = byId('wardrobe-owner-page-title');
        if (title) title.textContent = `${ownerName}的衣柜`;
        const notices = [];
        if (!current) notices.push('<button type="button" data-wardrobe-notice="current">尚未选择当前衣着，先从下方衣装中选择一套。</button>');
        if ((payload.proposals || []).length) notices.push(`<button type="button" data-wardrobe-notice="proposals">有 ${payload.proposals.length} 项待审核提案，点击前往处理。</button>`);
        byId('wardrobe-owner-notices').innerHTML = notices.join('');
        byId('wardrobe-current').innerHTML = current ? `<article class="wardrobe-current-content" data-look-id="${escapeHtml(current.look_id)}"><div class="wardrobe-current-media">${wardrobeCover(current, `${ownerName} · ${current.name}`)}</div><div class="wardrobe-current-copy"><div class="wardrobe-current-title"><div><small>CURRENT</small><h4>${escapeHtml(current.name)}</h4></div><span>${current.is_default ? '档案默认' : '当前穿着'}</span></div>${wardrobePieceSummary(current, payload.pieces)}<div class="wardrobe-card-tags">${wardrobeTags(current)}</div><div class="wardrobe-current-actions"><button type="button" data-wardrobe-edit="${escapeHtml(current.look_id)}">编辑</button>${current.is_default ? '' : `<button type="button" data-wardrobe-default="${escapeHtml(current.look_id)}">设为档案默认</button>`}<button type="button" data-wardrobe-upload="${escapeHtml(current.look_id)}">上传参考图</button><button type="button" data-wardrobe-generate="${escapeHtml(current.look_id)}" data-render-mode="garment_only">生成纯衣物</button><button type="button" data-wardrobe-generate="${escapeHtml(current.look_id)}" data-render-mode="worn_by_owner">生成着衣图</button>${current.cover_url ? `<button type="button" data-wardrobe-view-cover="${escapeHtml(current.cover_url)}">查看图片</button>` : ''}</div></div></article>` : '<div class="wardrobe-empty-current"><strong>当前未选择衣装</strong><span>创建衣装或从“其他衣装”中选择。</span></div>';
        const others = (payload.looks || []).filter(look => !current || look.look_id !== current.look_id);
        byId('wardrobe-look-count').textContent = `${others.length} 套`;
        byId('wardrobe-look-list').innerHTML = others.map(look => `<article class="wardrobe-look-card ${look.status === 'pending' ? 'pending' : ''}" data-look-id="${escapeHtml(look.look_id)}">${wardrobeCover(look)}<div class="wardrobe-look-card-body"><header><strong>${escapeHtml(look.name)}</strong><span>${look.is_default ? '默认' : escapeHtml(look.status)}</span></header><p>${escapeHtml(look.description || '无描述')}</p><div class="wardrobe-card-tags">${wardrobeTags(look)}</div><footer><button type="button" data-wardrobe-select="${escapeHtml(look.look_id)}">快速穿着</button><button type="button" data-wardrobe-edit="${escapeHtml(look.look_id)}">编辑</button><button type="button" data-wardrobe-upload="${escapeHtml(look.look_id)}">上传图片</button><button type="button" data-wardrobe-generate="${escapeHtml(look.look_id)}" data-render-mode="worn_by_owner">生图</button></footer></div></article>`).join('') || '<div class="image-empty-state">没有其他衣装</div>';
        byId('wardrobe-proposal-list').innerHTML = (payload.proposals || []).map(proposal => `<article class="wardrobe-proposal-card"><strong>${escapeHtml(proposal.payload?.name || '新衣提案')}</strong><p>${escapeHtml(proposal.payload?.description || '')}</p><div><button type="button" data-proposal-review="approve" data-proposal-id="${escapeHtml(proposal.proposal_id)}" data-revision="${proposal.revision}">批准</button><button type="button" data-proposal-review="edit" data-proposal-id="${escapeHtml(proposal.proposal_id)}" data-revision="${proposal.revision}">编辑后批准</button><button type="button" data-proposal-review="temporary" data-proposal-id="${escapeHtml(proposal.proposal_id)}" data-revision="${proposal.revision}">临时使用</button><button type="button" data-proposal-review="merge" data-proposal-id="${escapeHtml(proposal.proposal_id)}" data-revision="${proposal.revision}">合并</button><button type="button" data-proposal-review="reject" data-proposal-id="${escapeHtml(proposal.proposal_id)}" data-revision="${proposal.revision}">拒绝</button></div></article>`).join('') || '<div class="image-empty-state">没有待审核提案</div>';
        byId('wardrobe-audit-list').innerHTML = audit.map(item => `<div><span>${escapeHtml(item.action)}</span><small>${new Date(item.created_at * 1000).toLocaleString()}</small></div>`).join('') || '<div class="image-empty-state">暂无审计记录</div>';
    }

    function editorLook(lookId) {
        return state.wardrobe?.looks?.find(item => item.look_id === lookId) || (state.wardrobe?.current?.look?.look_id === lookId ? state.wardrobe.current.look : null);
    }

    function renderWardrobeEditorImages(look = null) {
        const root = byId('wardrobe-editor-images');
        if (!root) return;
        const existing = (look?.custom_reference_images || []).map(image => `<article><img src="${escapeHtml(image.url || '')}" alt="衣装参考图" loading="lazy" decoding="async"><span>${Number(image.id) === Number(look.cover_custom_image_id) ? '当前封面' : '已关联'}</span></article>`);
        const queued = state.wardrobeEditorFiles.map((file, index) => `<article><img src="${escapeHtml(file.previewUrl)}" alt="待上传衣装参考图"><span>待上传 ${index + 1}</span></article>`);
        root.innerHTML = [...existing, ...queued].join('') || '<div class="image-empty-state">尚未添加参考图片</div>';
    }

    function openWardrobeLookEditor(look = null, proposal = null, proposalAction = 'approve') {
        const form = byId('wardrobe-look-form');
        if (!form) return;
        const source = proposal?.payload || look || {};
        const parts = source.attributes?.parts || {};
        state.wardrobeEditorMode = proposal ? 'proposal' : look ? 'edit' : 'create';
        state.wardrobeEditorLookId = String(look?.look_id || '');
        state.wardrobeEditorProposalId = String(proposal?.proposal_id || '');
        state.wardrobeEditorProposalRevision = Number(proposal?.revision || 0);
        state.wardrobeEditorFiles.forEach(item => URL.revokeObjectURL(item.previewUrl));
        state.wardrobeEditorFiles = [];
        form.reset();
        form.elements.name.value = source.name || '';
        form.elements.description.value = source.description || '';
        form.elements.tags.value = (source.tags || []).join(', ');
        form.elements.image_tag.value = source.image_tag || '';
        for (const key of ['top', 'bottom', 'outerwear', 'footwear', 'accessory', 'equipment']) form.elements[`part_${key}`].value = parts[key] || '';
        form.elements.is_current.checked = Boolean(look && state.wardrobe?.current?.look?.look_id === look.look_id);
        form.elements.is_default.checked = Boolean(source.is_default);
        byId('wardrobe-editor-proposal-options').hidden = !proposal;
        form.elements.proposal_action.value = proposalAction === 'merge' ? 'merge' : 'approve';
        form.elements.merge_target.innerHTML = (state.wardrobe?.looks || []).map(item => `<option value="${escapeHtml(item.look_id)}">${escapeHtml(item.name)}</option>`).join('');
        byId('wardrobe-editor-merge-target-row').hidden = form.elements.proposal_action.value !== 'merge';
        byId('wardrobe-editor-title').textContent = proposal ? '审核衣装提案' : look ? '编辑衣装' : '新建衣装';
        byId('wardrobe-editor-status').textContent = '';
        state.wardrobeEditorDirty = false;
        renderWardrobeEditorImages(look);
        openPage('wardrobe-look-editor');
    }

    function createLook() { openWardrobeLookEditor(); }

    function wardrobeEditorPayload(form) {
        const parts = {};
        for (const key of ['top', 'bottom', 'outerwear', 'footwear', 'accessory', 'equipment']) {
            const part = String(form.elements[`part_${key}`].value || '').trim();
            if (part) parts[key] = part;
        }
        return {name: String(form.elements.name.value || '').trim(), description: String(form.elements.description.value || '').trim(), image_tag: String(form.elements.image_tag.value || '').trim(), tags: splitIds(form.elements.tags.value), attributes: {parts}, is_default: Boolean(form.elements.is_default.checked), source_type: 'user'};
    }

    async function attachQueuedWardrobeImages(look) {
        let current = look;
        for (const item of state.wardrobeEditorFiles) {
            const upload = await CUSTOM_IMAGE_API.upload('wardrobe_reference', item.file, current.look_id);
            const attached = await api(`/image-workspace/wardrobe/looks/${encodeURIComponent(current.look_id)}/references`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'attach_custom', custom_image_id: upload.data.id, expected_revision: current.revision, set_cover: true})});
            current = attached.look;
        }
        return current;
    }

    async function saveWardrobeEditor(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const payload = wardrobeEditorPayload(form);
        const status = byId('wardrobe-editor-status');
        if (!payload.name) return void (status.textContent = '请填写衣装名称。');
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        status.textContent = '正在保存衣装…';
        try {
            let look;
            if (state.wardrobeEditorMode === 'proposal') {
                const action = form.elements.proposal_action.value;
                const edits = action === 'merge' ? {target_look_id: form.elements.merge_target.value} : payload;
                const result = await api(`/image-workspace/wardrobe/proposals/${encodeURIComponent(state.wardrobeEditorProposalId)}/review`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action, expected_revision: state.wardrobeEditorProposalRevision, edits})});
                look = result.proposal?.look || null;
            } else if (state.wardrobeEditorMode === 'edit') {
                const current = editorLook(state.wardrobeEditorLookId);
                const result = await api(`/image-workspace/wardrobe/looks/${encodeURIComponent(state.wardrobeEditorLookId)}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({expected_revision: current?.revision, look: payload})});
                look = result.look;
            } else {
                const result = await api(`/image-workspace/wardrobe/${encodeURIComponent(state.wardrobeOwnerType)}/${encodeURIComponent(state.wardrobeOwnerId)}/looks`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
                look = result.look;
            }
            if (look && state.wardrobeEditorFiles.length) {
                status.textContent = '衣装已保存，正在关联参考图片…';
                look = await attachQueuedWardrobeImages(look);
            }
            if (look && form.elements.is_current.checked) await api(`/image-workspace/wardrobe/${encodeURIComponent(state.wardrobeOwnerType)}/${encodeURIComponent(state.wardrobeOwnerId)}/select`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({look_id: look.look_id, selected_by: 'user', force: true})});
            state.wardrobeEditorDirty = false;
            toast('衣装已保存', 'success');
            openPage('wardrobe-owner');
            await loadWardrobe();
        } catch (error) {
            status.textContent = error.status === 409 ? '衣装已在其他位置更新。你的输入仍被保留，请返回衣柜重新载入后再保存。' : `保存失败：${error.message}`;
        } finally {
            submit.disabled = false;
        }
    }

    function leaveWardrobeEditor() {
        const leave = () => { state.wardrobeEditorDirty = false; openPage('wardrobe-owner'); };
        if (!state.wardrobeEditorDirty) return leave();
        if (typeof showConfirmDialog === 'function') showConfirmDialog('放弃未保存的衣装修改', '当前填写内容尚未保存，确定返回衣柜吗？', leave);
        else { toast('请先保存衣装，或再次点击取消以放弃修改。', 'warning'); state.wardrobeEditorDirty = false; }
    }

    function openWardrobeImageGenerator(look, renderMode) {
        const ownerName = state.wardrobe?.owner?.display_name || state.wardrobeOwnerId;
        const garmentOnly = renderMode === 'garment_only';
        const appearance = look.appearance_prompt || look.image_tag || look.description || look.name;
        const prompt = garmentOnly ? `clothing design sheet, garment only, no person, ${appearance}` : `${ownerName}, wearing ${appearance}, full body outfit reference`;
        window.openImageWorkspace({sourceType: state.wardrobeOwnerType, sourceId: state.wardrobeOwnerId, intent: 'outfit_sheet', positivePrompt: prompt, scene: garmentOnly ? '纯衣物设定图，不出现人物；可使用平铺、衣架或中性人台。' : `${ownerName}穿着“${look.name}”的全身衣装设定图。`, destination: {type: 'wardrobe_reference', owner_type: state.wardrobeOwnerType, owner_id: state.wardrobeOwnerId, look_id: look.look_id, render_mode: renderMode, replace_cover: true}});
    }

    function chooseWardrobeReference(lookId) {
        state.wardrobeUploadLookId = String(lookId || '');
        let input = byId('wardrobe-reference-upload');
        if (!input) {
            input = document.createElement('input');
            input.id = 'wardrobe-reference-upload';
            input.type = 'file';
            input.accept = 'image/png,image/jpeg,image/webp,image/gif';
            input.hidden = true;
            document.body.appendChild(input);
            input.addEventListener('change', uploadWardrobeReference);
        }
        input.value = '';
        input.click();
    }

    async function uploadWardrobeReference(event) {
        const file = event.target.files?.[0];
        const lookId = state.wardrobeUploadLookId;
        if (!file || !lookId) return;
        const look = state.wardrobe?.looks?.find(item => item.look_id === lookId)
            || (state.wardrobe?.current?.look?.look_id === lookId ? state.wardrobe.current.look : null);
        if (!look) return;
        try {
            toast('正在上传衣装参考图…');
            const upload = await CUSTOM_IMAGE_API.upload('wardrobe_reference', file, lookId);
            await api(`/image-workspace/wardrobe/looks/${encodeURIComponent(lookId)}/references`, {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    action: 'attach_custom',
                    custom_image_id: upload.data.id,
                    expected_revision: look.revision,
                    set_cover: true
                })
            });
            toast('参考图已上传并设为封面', 'success');
            await loadWardrobe();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            state.wardrobeUploadLookId = '';
            event.target.value = '';
        }
    }

    async function handleWardrobeAction(event) {
        const ownerCard = event.target.closest('[data-wardrobe-open-owner]');
        const select = event.target.closest('[data-wardrobe-select]');
        const edit = event.target.closest('[data-wardrobe-edit]');
        const setDefault = event.target.closest('[data-wardrobe-default]');
        const generate = event.target.closest('[data-wardrobe-generate]');
        const upload = event.target.closest('[data-wardrobe-upload]');
        const viewCover = event.target.closest('[data-wardrobe-view-cover]');
        const review = event.target.closest('[data-proposal-review]');
        const notice = event.target.closest('[data-wardrobe-notice]');
        if (ownerCard) return window.openWardrobe(ownerCard.dataset.wardrobeOpenOwner, ownerCard.dataset.ownerId);
        if (notice?.dataset.wardrobeNotice === 'proposals') return byId('wardrobe-proposals-section')?.scrollIntoView({behavior: 'smooth', block: 'start'});
        if (notice?.dataset.wardrobeNotice === 'current') return byId('wardrobe-look-list')?.scrollIntoView({behavior: 'smooth', block: 'start'});
        if (viewCover) {
            window.open(viewCover.dataset.wardrobeViewCover, '_blank', 'noopener');
            return;
        }
        if (upload) {
            chooseWardrobeReference(upload.dataset.wardrobeUpload);
            return;
        }
        try {
            if (select) {
                await api(`/image-workspace/wardrobe/${encodeURIComponent(state.wardrobeOwnerType)}/${encodeURIComponent(state.wardrobeOwnerId)}/select`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({look_id: select.dataset.wardrobeSelect, selected_by: 'user', force: true})});
                return loadWardrobe();
            }
            if (edit) {
                const look = state.wardrobe?.looks?.find(item => item.look_id === edit.dataset.wardrobeEdit) || state.wardrobe?.current?.look;
                if (!look) return;
                return openWardrobeLookEditor(look);
            }
            if (setDefault) {
                const look = state.wardrobe?.looks?.find(item => item.look_id === setDefault.dataset.wardrobeDefault)
                    || state.wardrobe?.current?.look;
                if (!look) return;
                await api(`/image-workspace/wardrobe/looks/${encodeURIComponent(look.look_id)}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({expected_revision: look.revision, look: {is_default: true}})});
                return loadWardrobe();
            }
            if (generate) {
                const look = state.wardrobe?.looks?.find(item => item.look_id === generate.dataset.wardrobeGenerate) || (state.wardrobe?.current?.look?.look_id === generate.dataset.wardrobeGenerate ? state.wardrobe.current.look : null);
                if (look) openWardrobeImageGenerator(look, generate.dataset.renderMode || 'worn_by_owner');
                return;
            }
            if (review) {
                const proposal = state.wardrobe?.proposals?.find(item => item.proposal_id === review.dataset.proposalId);
                const body = {action: review.dataset.proposalReview, expected_revision: Number(review.dataset.revision)};
                if (body.action === 'edit' || body.action === 'merge') return openWardrobeLookEditor(null, proposal, body.action);
                await api(`/image-workspace/wardrobe/proposals/${encodeURIComponent(review.dataset.proposalId)}/review`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
                return loadWardrobe();
            }
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    async function ensureGalleryBackfill() {
        if (localStorage.getItem('imageGalleryBackfill:v2') === 'complete') {
            return;
        }
        if (!state.galleryBackfillPromise) {
            state.galleryBackfillPromise = api('/image-workspace/gallery/backfill', {method: 'POST'})
                .then(() => localStorage.setItem('imageGalleryBackfill:v2', 'complete'))
                .catch(error => console.warn('旧图片画廊回填暂未完成', error))
                .finally(() => {
                    state.galleryBackfillPromise = null;
                });
        }
        await state.galleryBackfillPromise;
    }

    async function loadVisualProposals() {
        const root = byId('image-visual-proposal-list');
        if (!root) return;
        try {
            const payload = await api('/image-workspace/visual-proposals?status=proposed&limit=30');
            state.visualProposals = payload.proposals || [];
            root.innerHTML = state.visualProposals.map(proposal => `
                <article class="visual-proposal-item" data-visual-proposal-id="${escapeHtml(proposal.proposal_id)}">
                    <div><strong>${escapeHtml(proposal.title || '视觉提议')}</strong><small>${escapeHtml(proposal.intent)} · ${new Date(proposal.created_at * 1000).toLocaleString()}</small></div>
                    <p>${escapeHtml(proposal.context || '没有补充说明')}</p>
                    <footer><button type="button" data-visual-action="open">编辑方案</button><button type="button" data-visual-action="delay">明天再看</button><button type="button" data-visual-action="ignore">忽略</button></footer>
                </article>`).join('') || '<div class="image-empty-state">当前没有待处理的视觉提议</div>';
        } catch (error) {
            root.innerHTML = `<div class="image-empty-state">${escapeHtml(error.message)}</div>`;
        }
    }

    async function handleVisualProposal(event) {
        const button = event.target.closest('[data-visual-action]');
        const card = button?.closest('[data-visual-proposal-id]');
        if (!button || !card) return;
        const proposal = state.visualProposals.find(item => item.proposal_id === card.dataset.visualProposalId);
        if (!proposal) return;
        const action = button.dataset.visualAction;
        try {
            if (action === 'open') {
                resetWorkspace({sourceType: proposal.source_type, sourceId: proposal.source_id, text: proposal.context, intent: proposal.intent, proposalId: proposal.proposal_id});
                await api(`/image-workspace/visual-proposals/${encodeURIComponent(proposal.proposal_id)}`, {
                    method: 'PATCH',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({action: 'open', expected_revision: proposal.revision})
                });
                return;
            }
            await api(`/image-workspace/visual-proposals/${encodeURIComponent(proposal.proposal_id)}`, {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({action, expected_revision: proposal.revision, scheduled_for: action === 'delay' ? Date.now() / 1000 + 86400 : undefined})
            });
            toast(action === 'ignore' ? '已忽略，不会产生费用' : '已延后一天', 'success');
            loadVisualProposals();
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    function restoreGalleryPreferences() {
        try {
            const saved = JSON.parse(localStorage.getItem('galleryViewPreferences:v2') || '{}');
            state.galleryLayout = ['masonry', 'square', 'compact'].includes(saved.layout) ? saved.layout : 'masonry';
            state.gallerySort = ['created_desc', 'created_asc', 'updated_desc', 'favorite_first'].includes(saved.sort) ? saved.sort : 'created_desc';
            state.galleryGroup = ['none', 'source', 'operator', 'intent', 'date'].includes(saved.group) ? saved.group : 'none';
            state.galleryFilters = saved.filters && typeof saved.filters === 'object' ? saved.filters : {};
        } catch (_) {
            state.galleryFilters = {};
        }
        if (byId('image-gallery-sort')) byId('image-gallery-sort').value = state.gallerySort;
        if (byId('image-gallery-group')) byId('image-gallery-group').value = state.galleryGroup;
        Object.entries(state.galleryFilters).forEach(([key, stored]) => {
            const input = byId(`image-gallery-${key}`);
            if (!input) return;
            if (input.type === 'checkbox') input.checked = Boolean(stored);
            else input.value = String(stored || '');
        });
        document.querySelectorAll('[data-gallery-layout]').forEach(button => {
            button.classList.toggle('active', button.dataset.galleryLayout === state.galleryLayout);
            button.setAttribute('aria-pressed', String(button.dataset.galleryLayout === state.galleryLayout));
        });
    }

    function saveGalleryPreferences() {
        localStorage.setItem('galleryViewPreferences:v2', JSON.stringify({
            layout: state.galleryLayout,
            sort: state.gallerySort,
            group: state.galleryGroup,
            filters: state.galleryFilters
        }));
    }

    function readGalleryFilters() {
        const result = {};
        ['operator', 'source', 'intent', 'provider', 'wardrobe', 'tag', 'orientation', 'created-from', 'created-to'].forEach(key => {
            const current = value(`image-gallery-${key}`);
            if (current) result[key] = current;
        });
        if (byId('image-gallery-favorite')?.checked) result.favorite = true;
        if (byId('image-gallery-archived')?.checked) result.archived = true;
        return result;
    }

    function galleryLabel(kind, id) {
        if (!id) return '未分类';
        if (kind === 'intent') return state.manifest?.intents?.find(item => item.id === id)?.label || id;
        if (kind === 'source') return state.manifest?.context_providers?.find(item => item.id === id)?.label || id;
        return id;
    }

    function galleryQueryParams(cursor = '') {
        const params = new URLSearchParams({limit: '36', sort: state.gallerySort});
        const query = value('image-gallery-search');
        if (query) params.set('q', query);
        const filters = state.galleryFilters;
        if (filters.operator) params.set('operator_id', filters.operator);
        if (filters.source) params.set('source_type', filters.source);
        if (filters.intent) params.set('intent', filters.intent);
        if (filters.provider) params.set('provider', filters.provider);
        if (filters.wardrobe) params.set('wardrobe', filters.wardrobe);
        if (filters.tag) params.set('tag', filters.tag);
        if (filters.orientation) params.set('orientation', filters.orientation);
        if (filters.favorite) params.set('favorite', 'true');
        if (filters.archived) params.set('include_archived', 'true');
        if (filters['created-from']) params.set('created_from', String(new Date(`${filters['created-from']}T00:00:00`).getTime() / 1000));
        if (filters['created-to']) params.set('created_to', String(new Date(`${filters['created-to']}T23:59:59`).getTime() / 1000));
        if (cursor) params.set('cursor', cursor);
        return params;
    }

    async function loadGallery(options = {}) {
        const append = Boolean(options.append);
        if (!byId('image-gallery-grid')) return;
        if (!append && state.galleryLoading) {
            state.galleryRequestController?.abort();
            state.galleryLoading = false;
        }
        if (append && state.galleryLoading) return;
        await loadManifest().catch(() => null);
        await ensureGalleryBackfill();
        if (!append) {
            state.galleryRequestController?.abort();
            state.galleryRequestController = new AbortController();
            state.galleryRequestGeneration += 1;
            state.galleryNextCursor = '';
            state.gallerySelection.clear();
            state.gallery = [];
            renderGallerySkeletons();
        }
        if (append && !state.galleryNextCursor) return;
        const generation = state.galleryRequestGeneration;
        state.galleryLoading = true;
        updateGallerySentinel('正在读取图片…');
        try {
            const payload = await api(`/image-workspace/gallery?${galleryQueryParams(append ? state.galleryNextCursor : '')}`, {
                signal: state.galleryRequestController?.signal
            });
            if (generation !== state.galleryRequestGeneration) return;
            const known = new Set(state.gallery.map(item => item.asset_id));
            const incoming = (payload.items || []).filter(item => !known.has(item.asset_id));
            state.gallery = append ? state.gallery.concat(incoming) : incoming;
            state.galleryTotal = Number(payload.total || 0);
            state.galleryNextCursor = String(payload.next_cursor || '');
            state.galleryFacets = payload.facets || {};
            refreshGalleryFacetOptions();
            renderGallery();
        } catch (error) {
            if (error.name !== 'AbortError' && generation === state.galleryRequestGeneration) {
                byId('image-gallery-grid').innerHTML = `<div class="image-empty-state">画廊加载失败：${escapeHtml(error.message)}</div>`;
            }
        } finally {
            if (generation === state.galleryRequestGeneration) {
                state.galleryLoading = false;
                updateGallerySentinel(state.galleryNextCursor ? '继续滚动加载' : state.gallery.length ? '已经到底了' : '');
            }
        }
    }

    function renderGallerySkeletons() {
        byId('image-gallery-grid').innerHTML = Array.from({length: 8}, (_, index) => `<div class="gallery-card-skeleton" style="--skeleton-ratio:${index % 3 === 0 ? '3/4' : index % 3 === 1 ? '1/1' : '4/3'}"></div>`).join('');
        requestAnimationFrame(layoutGalleryMasonry);
    }

    function refreshGalleryFacetOptions() {
        const provider = byId('image-gallery-provider');
        if (!provider) return;
        const selected = provider.value;
        provider.innerHTML = '<option value="">全部 Provider</option>' + (state.galleryFacets.provider || []).map(item => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.value)} (${item.count})</option>`).join('');
        provider.value = selected;
    }

    function galleryGroupKey(asset) {
        if (state.galleryGroup === 'source') return galleryLabel('source', asset.source_type);
        if (state.galleryGroup === 'operator') return (asset.operator_ids || [])[0] || '未关联角色';
        if (state.galleryGroup === 'intent') return galleryLabel('intent', asset.intent);
        if (state.galleryGroup === 'date') return new Date(asset.created_at * 1000).toLocaleDateString(undefined, {year: 'numeric', month: 'long'});
        return '';
    }

    function galleryCard(asset) {
        const ratio = asset.width && asset.height ? `${asset.width}/${asset.height}` : '1/1';
        const tags = (asset.tags || []).slice(0, 3);
        const extra = Math.max(0, (asset.tags || []).length - tags.length);
        const selected = state.gallerySelection.has(asset.asset_id);
        return `<article class="image-gallery-card${selected ? ' selected' : ''}${asset.status === 'remote_pending' ? ' remote-placeholder' : ''}" data-gallery-id="${escapeHtml(asset.asset_id)}" tabindex="0" aria-selected="${selected}">
            <button type="button" class="gallery-card-image" aria-label="打开 ${escapeHtml(asset.title || 'AI 图片')}" style="--gallery-aspect:${ratio}"><img src="${escapeHtml(asset.thumbnail_url)}" alt="${escapeHtml(asset.title || 'AI 生成图片')}" loading="lazy" decoding="async"><span class="gallery-card-badges">${asset.favorite ? `<b title="已收藏">${ZootIcons.html('favorite')}</b>` : ''}${asset.archived ? '<b>已归档</b>' : ''}</span><span class="gallery-card-check" aria-hidden="true">${ZootIcons.html('check')}</span></button>
            <div class="gallery-card-copy"><strong>${escapeHtml(asset.title || galleryLabel('intent', asset.intent))}</strong><div class="gallery-card-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}${extra ? `<span>+${extra}</span>` : ''}</div><small>${escapeHtml(galleryLabel('source', asset.source_type))}${(asset.operator_ids || []).length ? ` · ${escapeHtml(asset.operator_ids[0])}` : ''}</small><time datetime="${new Date(asset.created_at * 1000).toISOString()}">${new Date(asset.created_at * 1000).toLocaleString()}</time></div>
        </article>`;
    }

    function renderGallery() {
        const root = byId('image-gallery-grid');
        root.dataset.layout = state.galleryLayout;
        root.classList.toggle('is-grouped', state.galleryGroup !== 'none');
        const grouped = new Map();
        state.gallery.forEach(asset => {
            const key = galleryGroupKey(asset);
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(asset);
        });
        if (!state.gallery.length) {
            const filtered = Boolean(value('image-gallery-search') || Object.keys(state.galleryFilters).length);
            root.innerHTML = `<div class="image-empty-state">${filtered ? '没有符合当前搜索与筛选条件的图片。' : '画廊中还没有图片。完成一次生图后会自动归档到这里。'}</div>`;
        } else if (state.galleryGroup === 'none') {
            root.innerHTML = state.gallery.map(galleryCard).join('');
        } else {
            root.innerHTML = Array.from(grouped, ([key, items]) => `<details class="gallery-group" data-gallery-group="${escapeHtml(key)}"${state.galleryCollapsedGroups.has(key) ? '' : ' open'}><summary>${escapeHtml(key)}<small>${items.length} 项</small></summary><div class="gallery-group-grid" data-layout="${state.galleryLayout}">${items.map(galleryCard).join('')}</div></details>`).join('');
        }
        root.querySelectorAll('img').forEach(image => image.addEventListener('error', hydrateGalleryThumbnail, {once: true}));
        byId('image-gallery-summary').textContent = `已显示 ${state.gallery.length} / ${state.galleryTotal} 项`;
        renderGalleryFilterChips();
        renderGallerySelection();
        requestAnimationFrame(() => {
            layoutGalleryMasonry();
            if (state.galleryRestoreScroll) {
                byId('image-gallery-scroll').scrollTop = state.galleryScrollTop;
                state.galleryRestoreScroll = false;
            }
        });
    }

    function layoutGalleryMasonry() {
        document.querySelectorAll('#image-gallery-grid, #image-gallery-grid .gallery-group-grid').forEach(grid => {
            if (grid.classList.contains('is-grouped')) return;
            const styles = getComputedStyle(grid);
            const row = Number.parseFloat(styles.gridAutoRows) || 1;
            const gap = Number.parseFloat(styles.rowGap) || 0;
            if (state.galleryLayout !== 'masonry') {
                grid.querySelectorAll('.image-gallery-card, .gallery-card-skeleton').forEach(card => card.style.removeProperty('grid-row-end'));
                return;
            }
            grid.querySelectorAll('.image-gallery-card, .gallery-card-skeleton').forEach(card => {
                card.style.gridRowEnd = `span ${Math.max(1, Math.ceil((card.getBoundingClientRect().height + gap) / (row + gap)))}`;
            });
        });
    }

    function renderGalleryFilterChips() {
        const host = byId('image-gallery-filter-chips');
        const labels = {operator: '角色', source: '来源', intent: '意图', provider: 'Provider', wardrobe: '衣装', tag: '标签', orientation: '方向', 'created-from': '开始', 'created-to': '结束', favorite: '收藏', archived: '归档'};
        const entries = Object.entries(state.galleryFilters);
        host.hidden = !entries.length;
        host.innerHTML = entries.map(([key, filterValue]) => `<button type="button" data-gallery-clear-filter="${escapeHtml(key)}">${escapeHtml(labels[key] || key)}：${escapeHtml(filterValue === true ? '是' : filterValue)} <span data-zoot-icon="close"></span></button>`).join('');
    }

    function updateGallerySentinel(text) {
        if (byId('image-gallery-sentinel')) byId('image-gallery-sentinel').textContent = text;
    }

    async function hydrateGalleryThumbnail(event) {
        const card = event.target.closest('[data-gallery-id]');
        if (!card || card.dataset.hydrating === '1') return;
        card.dataset.hydrating = '1';
        event.target.classList.add('unavailable');
        try {
            const payload = await api(`/image-workspace/gallery/${encodeURIComponent(card.dataset.galleryId)}/hydrate`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({original: false})
            });
            event.target.classList.remove('unavailable');
            event.target.src = `/media/attachments/${encodeURIComponent(payload.attachment.id)}/content?v=${Date.now()}`;
        } catch (_) {
            card.classList.add('remote-placeholder');
            event.target.alt = '原设备暂不可达，缩略图等待恢复';
        } finally {
            card.dataset.hydrating = '0';
        }
    }

    async function openGalleryDetail(assetId) {
        try {
            state.galleryScrollTop = byId('image-gallery-scroll')?.scrollTop || 0;
            state.galleryRestoreScroll = true;
            const payload = await api(`/image-workspace/gallery/${encodeURIComponent(assetId)}`);
            const asset = payload.asset;
            state.selectedGalleryId = assetId;
            state.galleryDetail = asset;
            openPage('image-gallery-detail');
            renderGalleryDetail(asset);
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    function renderGalleryDetail(asset) {
        if (!asset) return;
        const index = state.gallery.findIndex(item => item.asset_id === asset.asset_id);
        byId('image-gallery-detail-title').textContent = asset.title || galleryLabel('intent', asset.intent);
        byId('image-gallery-detail-position').textContent = index >= 0 ? `${index + 1} / ${state.galleryTotal}` : 'GALLERY';
        byId('image-gallery-detail-image').src = asset.content_url;
        byId('image-gallery-detail-image').style.transform = '';
        byId('image-gallery-detail-favorite').innerHTML = ZootIcons.html(asset.favorite ? 'favorite' : 'favoriteOutline');
        byId('image-gallery-detail-download').href = asset.content_url;
        byId('image-gallery-detail-meta').innerHTML = `<h3>${escapeHtml(asset.title || 'AI 图片')}</h3><p>${escapeHtml(asset.description || '没有补充说明')}</p><dl><div><dt>来源</dt><dd>${escapeHtml(galleryLabel('source', asset.source_type))} / ${escapeHtml(asset.source_id || '已不可用')}</dd></div><div><dt>角色</dt><dd>${escapeHtml((asset.operator_ids || []).join('、') || '未关联')}</dd></div><div><dt>衣装</dt><dd>${escapeHtml(Object.values(asset.wardrobe_snapshot || {}).map(item => item?.look?.name).filter(Boolean).join('、') || '未记录')}</dd></div><div><dt>模型</dt><dd>${escapeHtml(asset.provider || '未知')} · ${escapeHtml(asset.model || '默认模型')}</dd></div><div><dt>尺寸</dt><dd>${asset.width || '?'} × ${asset.height || '?'} · 种子 ${escapeHtml(asset.seed || '随机')}</dd></div><div><dt>创作时间</dt><dd>${new Date(asset.created_at * 1000).toLocaleString()}</dd></div></dl>`;
        byId('image-gallery-detail-tags').innerHTML = (asset.tags || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join('');
        byId('image-gallery-detail-history').textContent = JSON.stringify({plan: asset.confirmed_plan, attempts: asset.attempts}, null, 2);
        byId('image-gallery-detail-prev').disabled = index <= 0;
        byId('image-gallery-detail-next').disabled = index < 0 || (index >= state.gallery.length - 1 && !state.galleryNextCursor);
    }

    async function patchGalleryDetail(patch) {
        const asset = state.galleryDetail;
        if (!asset) return;
        const payload = await api(`/image-workspace/gallery/${encodeURIComponent(asset.asset_id)}`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({expected_revision: asset.revision, ...patch})
        });
        state.galleryDetail = {...asset, ...payload.asset};
        const index = state.gallery.findIndex(item => item.asset_id === asset.asset_id);
        if (index >= 0) state.gallery[index] = {...state.gallery[index], ...payload.asset};
        renderGalleryDetail(state.galleryDetail);
    }

    async function handleGalleryDetailAction(event) {
        const asset = state.galleryDetail;
        if (!asset) return;
        if (event.target.closest('#image-gallery-detail-favorite')) {
            await patchGalleryDetail({favorite: !asset.favorite});
            return;
        }
        const action = event.target.closest('[data-gallery-detail-action]')?.dataset.galleryDetailAction;
        if (action === 'source') {
            if (asset.source_deep_link) {
                location.hash = asset.source_deep_link;
            } else {
                toast('来源已不可用，图片与审计信息仍已保留', 'error');
            }
        }
        if (action === 'variant' || action === 'reference') {
            window.openImageWorkspace({sourceType: asset.source_type, sourceId: asset.source_id});
            if (action === 'reference') toast('已将该图片作为本次创作参考来源', 'success');
        }
        if (action === 'archive') {
            await patchGalleryDetail({archived: !asset.archived});
            toast(asset.archived ? '已恢复归档' : '已归档', 'success');
        }
        if (action === 'edit') {
            const title = window.prompt('图片标题', asset.title || '');
            if (title === null) return;
            const description = window.prompt('图片说明', asset.description || '');
            if (description === null) return;
            const tags = window.prompt('自定义标签（使用逗号分隔）', (asset.user_tags || []).join(', '));
            if (tags === null) return;
            await patchGalleryDetail({title, description, user_tags: splitIds(tags)});
            toast('图片信息已更新', 'success');
        }
    }

    async function navigateGalleryDetail(direction) {
        let index = state.gallery.findIndex(item => item.asset_id === state.selectedGalleryId);
        if (direction > 0 && index === state.gallery.length - 1 && state.galleryNextCursor) {
            await loadGallery({append: true});
            index = state.gallery.findIndex(item => item.asset_id === state.selectedGalleryId);
        }
        const target = state.gallery[index + direction];
        if (target) await openGalleryDetail(target.asset_id);
    }

    function renderGallerySelection() {
        const count = state.gallerySelection.size;
        byId('image-gallery-create-dock').hidden = count > 0;
        byId('image-gallery-batch-dock').hidden = count === 0;
        if (byId('image-gallery-selection-count')) byId('image-gallery-selection-count').textContent = `已选择 ${count} 项`;
        document.querySelectorAll('[data-gallery-id]').forEach(card => {
            const selected = state.gallerySelection.has(card.dataset.galleryId);
            card.classList.toggle('selected', selected);
            card.setAttribute('aria-selected', String(selected));
        });
    }

    function toggleGallerySelection(assetId, force) {
        const shouldSelect = force === undefined ? !state.gallerySelection.has(assetId) : force;
        if (shouldSelect) state.gallerySelection.add(assetId);
        else state.gallerySelection.delete(assetId);
        renderGallerySelection();
    }

    async function runGalleryBatch(action) {
        if (action === 'cancel') {
            state.gallerySelection.clear();
            return renderGallerySelection();
        }
        const ids = Array.from(state.gallerySelection);
        if (!ids.length) return;
        if (action === 'export') {
            ids.forEach((id, index) => {
                const asset = state.gallery.find(item => item.asset_id === id);
                if (!asset) return;
                setTimeout(() => {
                    const link = document.createElement('a');
                    link.href = asset.content_url;
                    link.download = `${asset.title || 'zoot-gallery'}-${index + 1}`;
                    link.click();
                }, index * 180);
            });
            return;
        }
        let tags = [];
        if (action === 'tags_add' || action === 'tags_remove') {
            const value = window.prompt(action === 'tags_add' ? '要添加的标签（使用逗号分隔）' : '要移除的标签（使用逗号分隔）');
            if (!value) return;
            tags = splitIds(value);
        }
        try {
            const payload = await api('/image-workspace/gallery/batch', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({asset_ids: ids, action, tags})
            });
            toast(`已更新 ${payload.updated || 0} 项，失败 ${payload.failed || 0} 项`, payload.failed ? 'error' : 'success');
            state.gallerySelection.clear();
            loadGallery();
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    function setGalleryFilterPanel(open) {
        const panel = byId('image-gallery-filter-panel');
        if (!panel) return;
        if (panel.classList.contains('sheet-layer') && typeof openBottomSheet === 'function') {
            if (open) openBottomSheet(panel.id);
            else closeBottomSheet(panel.id);
        } else {
            panel.classList.toggle('open', open);
        }
    }

    function applyGalleryFilters() {
        state.galleryFilters = readGalleryFilters();
        saveGalleryPreferences();
        setGalleryFilterPanel(false);
        loadGallery();
    }

    function resetGalleryFilters() {
        ['operator', 'source', 'intent', 'provider', 'wardrobe', 'tag', 'orientation', 'created-from', 'created-to'].forEach(key => {
            const input = byId(`image-gallery-${key}`);
            if (input) input.value = '';
        });
        if (byId('image-gallery-favorite')) byId('image-gallery-favorite').checked = false;
        if (byId('image-gallery-archived')) byId('image-gallery-archived').checked = false;
        state.galleryFilters = {};
        saveGalleryPreferences();
        loadGallery();
    }

    function clearGalleryFilter(key) {
        const input = byId(`image-gallery-${key}`);
        if (input?.type === 'checkbox') input.checked = false;
        else if (input) input.value = '';
        delete state.galleryFilters[key];
        saveGalleryPreferences();
        loadGallery();
    }

    function setupGalleryObservers() {
        state.galleryObserver?.disconnect();
        state.galleryObserver = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting) && state.galleryNextCursor && !state.galleryLoading) {
                loadGallery({append: true});
            }
        }, {root: byId('image-gallery-scroll'), rootMargin: '500px 0px'});
        if (byId('image-gallery-sentinel')) state.galleryObserver.observe(byId('image-gallery-sentinel'));
        state.galleryResizeObserver?.disconnect();
        state.galleryResizeObserver = new ResizeObserver(() => requestAnimationFrame(layoutGalleryMasonry));
        if (byId('image-gallery-grid')) state.galleryResizeObserver.observe(byId('image-gallery-grid'));
        const scroll = byId('image-gallery-scroll');
        if (scroll) {
            scroll.removeEventListener('scroll', state.galleryScrollHandler);
            state.galleryScrollHandler = () => {
                byId('page-image-gallery')?.classList.toggle('gallery-tools-condensed', scroll.scrollTop > 72);
            };
            scroll.addEventListener('scroll', state.galleryScrollHandler, {passive: true});
            state.galleryScrollHandler();
        }
    }

    function disposeGalleryObservers() {
        state.galleryObserver?.disconnect();
        state.galleryResizeObserver?.disconnect();
        if (state.galleryScrollHandler) byId('image-gallery-scroll')?.removeEventListener('scroll', state.galleryScrollHandler);
    }

    function bindGalleryCardGestures() {
        const root = byId('image-gallery-grid');
        if (!root) return;
        let pressTimer = null;
        let pressId = '';
        let suppressClickId = '';
        const clearPress = () => {
            clearTimeout(pressTimer);
            pressTimer = null;
            pressId = '';
        };
        root.addEventListener('pointerdown', event => {
            const card = event.target.closest('[data-gallery-id]');
            if (!card || event.pointerType === 'mouse' && event.button !== 0) return;
            pressId = card.dataset.galleryId;
            pressTimer = setTimeout(() => {
                toggleGallerySelection(pressId, true);
                navigator.vibrate?.(20);
                suppressClickId = pressId;
                pressId = '';
            }, 460);
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(name => root.addEventListener(name, clearPress));
        root.addEventListener('click', event => {
            const groupSummary = event.target.closest('.gallery-group > summary');
            if (groupSummary) {
                const group = groupSummary.parentElement;
                setTimeout(() => {
                    if (group.open) state.galleryCollapsedGroups.delete(group.dataset.galleryGroup);
                    else state.galleryCollapsedGroups.add(group.dataset.galleryGroup);
                });
                return;
            }
            const card = event.target.closest('[data-gallery-id]');
            if (!card) return;
            if (suppressClickId === card.dataset.galleryId) {
                suppressClickId = '';
                event.preventDefault();
                return;
            }
            if (state.gallerySelection.size || event.ctrlKey || event.metaKey) {
                event.preventDefault();
                toggleGallerySelection(card.dataset.galleryId);
            } else {
                openGalleryDetail(card.dataset.galleryId);
            }
        });
        root.addEventListener('keydown', event => {
            const card = event.target.closest('[data-gallery-id]');
            if (!card || !['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            if (state.gallerySelection.size || event.ctrlKey || event.metaKey) toggleGallerySelection(card.dataset.galleryId);
            else openGalleryDetail(card.dataset.galleryId);
        });
    }

    function bindGalleryViewerGestures() {
        const viewer = byId('image-gallery-viewer');
        const image = byId('image-gallery-detail-image');
        if (!viewer || !image) return;
        let startX = 0;
        let pinchDistance = 0;
        let scale = 1;
        viewer.addEventListener('touchstart', event => {
            if (event.touches.length === 1) startX = event.touches[0].clientX;
            if (event.touches.length === 2) pinchDistance = Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
        }, {passive: true});
        viewer.addEventListener('touchmove', event => {
            if (event.touches.length !== 2 || !pinchDistance) return;
            const distance = Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
            scale = Math.max(1, Math.min(4, scale * distance / pinchDistance));
            pinchDistance = distance;
            image.style.transform = `scale(${scale})`;
        }, {passive: true});
        viewer.addEventListener('touchend', event => {
            pinchDistance = 0;
            if (event.changedTouches.length !== 1 || scale > 1.02) return;
            const delta = event.changedTouches[0].clientX - startX;
            if (Math.abs(delta) > 70) navigateGalleryDetail(delta < 0 ? 1 : -1);
        }, {passive: true});
        image.addEventListener('dblclick', () => {
            scale = 1;
            image.style.transform = '';
        });
    }

    async function updateChatWardrobeCard() {
        const old = byId('chat-wardrobe-compact');
        old?.remove();
        if (!state.settings?.chat_wardrobe_enabled) return;
        const operatorId = currentOperator();
        const page = byId('page-chat-detail');
        if (!operatorId || !page?.classList.contains('active-page')) return;
        try {
            const payload = await api(`/image-workspace/wardrobe/operator/${encodeURIComponent(operatorId)}`);
            const look = payload.current?.look;
            if (!look) return;
            const card = document.createElement('button');
            card.id = 'chat-wardrobe-compact';
            card.className = 'chat-wardrobe-compact';
            card.type = 'button';
            card.innerHTML = `<span>当前衣装</span><strong>${escapeHtml(look.name)}</strong>`;
            card.addEventListener('click', () => window.openWardrobe('operator', operatorId));
            (page.querySelector('.chat-header') || page.querySelector('.page-header') || page).appendChild(card);
        } catch (_) {
            return;
        }
    }

    function updateRail() {
        const rail = byId('image-workspace-rail');
        if (!rail) return;
        const enabled = Boolean(state.settings?.floating_rail_enabled);
        rail.hidden = !enabled;
        rail.classList.toggle('collapsed', state.railCollapsed);
    }

    async function saveEntryPreferences() {
        try {
            const payload = await api('/image-workspace/settings', {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    ...state.settings,
                    floating_rail_enabled: Boolean(byId('image-workspace-rail-setting')?.checked),
                    chat_wardrobe_enabled: Boolean(byId('image-workspace-chat-wardrobe-setting')?.checked)
                })
            });
            state.settings = payload.settings;
            updateRail();
            updateChatWardrobeCard();
            toast('入口偏好已保存', 'success');
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    function installImagePlanningControls() {
        const summary = byId('image-workspace-selected-summary');
        if (summary && !byId('image-workspace-participants')) {
            const section = document.createElement('section');
            section.className = 'image-participant-picker';
            section.setAttribute('aria-labelledby', 'image-workspace-participant-title');
            section.innerHTML = `<div class="image-studio-title-row"><h4 id="image-workspace-participant-title">本次入镜人物</h4><button class="btn-secondary" id="image-workspace-participant-confirm" type="button">确认人物</button></div><div id="image-workspace-participants"><div class="image-empty-state">请先选择消息</div></div><p id="image-workspace-participant-status" data-state="pending">请检查并确认人物状态后再规划</p>`;
            summary.insertAdjacentElement('afterend', section);
        }
        const scenePanel = document.querySelector('#page-image-workspace [data-image-panel="2"]');
        const sceneGrid = scenePanel?.querySelector('.image-studio-grid');
        if (sceneGrid && !byId('image-workspace-character-prompts')) {
            const section = document.createElement('section');
            section.id = 'image-workspace-character-prompts';
            section.className = 'image-character-prompts';
            section.setAttribute('aria-labelledby', 'image-workspace-character-prompt-title');
            section.innerHTML = `<div class="image-studio-title-row"><div><h4 id="image-workspace-character-prompt-title">干员生图身份</h4><p>按干员选择英文名 Tag、完整外貌描述或融合使用；当前衣装始终保留。</p></div><button class="btn-secondary" type="button" data-character-prompt-refresh>刷新</button></div><div id="image-workspace-character-prompt-list"><div class="image-empty-state">填写相关干员后读取配置</div></div><p id="image-workspace-character-prompt-status" role="status" aria-live="polite"></p>`;
            sceneGrid.insertAdjacentElement('afterend', section);
        }
        const continuity = byId('image-workspace-continuity');
        if (continuity) {
            continuity.checked = true;
            continuity.disabled = true;
            const label = continuity.closest('label');
            if (label) {
                [...label.childNodes].forEach(node => {
                    if (node.nodeType === Node.TEXT_NODE) node.textContent = ' 仅使用本次确认的场景连续性快照';
                });
            }
        }
    }

    function bindEvents() {
        installImagePlanningControls();
        document.querySelectorAll('[data-image-step]').forEach(button => button.addEventListener('click', () => setStep(Number(button.dataset.imageStep))));
        document.querySelectorAll('[data-image-source-mode]').forEach(button => button.addEventListener('click', () => setSourceMode(button.dataset.imageSourceMode)));
        byId('image-workspace-chat-list')?.addEventListener('click', event => {
            const button = event.target.closest('[data-image-conversation]');
            if (button) selectChatSource(button.dataset.imageConversation);
        });
        byId('image-workspace-message-list')?.addEventListener('click', event => {
            const button = event.target.closest('[data-image-message-index]');
            if (!button) return;
            const index = Number(button.dataset.imageMessageIndex);
            const item = state.chatMessages[index];
            if (!item) return;
            state.planningGeneration += 1;
            state.planningSourceSignature = '';
            state.participantsConfirmed = false;
            setPlanningStatus('', '');
            if (!state.selectedMessageUids.size) {
                selectMessageAnchor(index);
            } else if (state.selectedMessageUids.has(item.message_uid)) {
                if (String(item.message_uid) === state.anchorMessageUid) {
                    toast('锚点消息必须保留；如需更换锚点，请先清空选择后点击另一条消息', 'error');
                    return;
                }
                state.selectedMessageUids.delete(item.message_uid);
                renderChatMessages();
                renderSelectedMessages();
            } else if (state.selectedMessageUids.size < 12) {
                state.selectedMessageUids.add(item.message_uid);
                renderChatMessages();
                renderSelectedMessages();
            } else {
                toast('最多选择 12 条消息', 'error');
            }
        });
        byId('image-workspace-chat-more')?.addEventListener('click', () => loadChatSources(true));
        byId('image-workspace-message-more')?.addEventListener('click', () => loadChatMessages(true));
        byId('image-workspace-chat-search')?.addEventListener('input', event => {
            clearTimeout(event.target._sourceTimer);
            event.target._sourceTimer = setTimeout(() => loadChatSources(false), 260);
        });
        byId('image-workspace-message-search')?.addEventListener('input', event => {
            clearTimeout(event.target._sourceTimer);
            event.target._sourceTimer = setTimeout(() => loadChatMessages(false), 260);
        });
        byId('image-workspace-prompt-preset')?.addEventListener('change', renderPromptPresetEditor);
        byId('image-workspace-preset-save')?.addEventListener('click', () => savePromptPreset().catch(error => toast(error.message, 'error')));
        byId('image-workspace-preset-delete')?.addEventListener('click', () => deletePromptPreset().catch(error => toast(error.message, 'error')));
        byId('image-workspace-preview')?.addEventListener('click', previewContext);
        byId('image-workspace-participants')?.addEventListener('change', event => {
            const select = event.target.closest('[data-image-participant]');
            if (!select) return;
            const item = state.participantDecisions.get(select.dataset.imageParticipant);
            if (!item) return;
            item.state = select.value;
            state.participantsConfirmed = false;
            state.planningSourceSignature = '';
            renderParticipantDecisions();
        });
        byId('image-workspace-participant-confirm')?.addEventListener('click', confirmImageParticipants);
        byId('image-workspace-actors')?.addEventListener('input', () => scheduleCharacterPromptLoad());
        byId('image-workspace-character-prompts')?.addEventListener('input', event => {
            const card = event.target.closest('[data-character-prompt-card]');
            if (card) updateCharacterPromptDraft(card);
        });
        byId('image-workspace-character-prompts')?.addEventListener('change', event => {
            const card = event.target.closest('[data-character-prompt-card]');
            if (card) updateCharacterPromptDraft(card);
        });
        byId('image-workspace-character-prompts')?.addEventListener('click', event => {
            if (event.target.closest('[data-character-prompt-refresh]')) scheduleCharacterPromptLoad(0);
            handleCharacterPromptAction(event).catch(error => toast(error.message, 'error'));
        });
        byId('image-workspace-ai-plan')?.addEventListener('click', planChatSource);
        byId('image-visual-proposal-refresh')?.addEventListener('click', loadVisualProposals);
        byId('image-visual-proposal-list')?.addEventListener('click', handleVisualProposal);
        byId('image-workspace-save-plan')?.addEventListener('click', savePlan);
        byId('image-workspace-generate')?.addEventListener('click', generatePlan);
        byId('image-workspace-final-confirm')?.addEventListener('change', event => {
            updateGenerateButton();
        });
        byId('image-workspace-render-refresh')?.addEventListener('click', () => refreshGenerationStatus(false));
        byId('image-workspace-render-cancel')?.addEventListener('click', cancelGenerationJobs);
        byId('image-workspace-render-retry')?.addEventListener('click', retryFailedGenerationJobs);
        byId('image-workspace-render-routes')?.addEventListener('click', openImageGenerationRoutes);
        byId('image-workspace-render-gallery')?.addEventListener('click', () => window.openImageGallery());
        document.querySelectorAll('#page-image-workspace [data-image-panel="1"] input, #page-image-workspace [data-image-panel="1"] select, #page-image-workspace [data-image-panel="1"] textarea, #page-image-workspace [data-image-panel="2"] input, #page-image-workspace [data-image-panel="2"] select, #page-image-workspace [data-image-panel="2"] textarea, #page-image-workspace [data-image-panel="3"] input, #page-image-workspace [data-image-panel="3"] select, #page-image-workspace [data-image-panel="3"] textarea').forEach(control => {
            control.addEventListener('input', markPlanDirty);
            control.addEventListener('change', markPlanDirty);
        });
        byId('image-workspace-expert')?.addEventListener('change', event => {
            byId('image-workspace-expert-fields').hidden = !event.target.checked;
        });
        byId('image-workspace-rail-setting')?.addEventListener('change', saveEntryPreferences);
        byId('image-workspace-chat-wardrobe-setting')?.addEventListener('change', saveEntryPreferences);
        byId('wardrobe-create-look')?.addEventListener('click', createLook);
        byId('wardrobe-look-form')?.addEventListener('submit', saveWardrobeEditor);
        byId('wardrobe-look-form')?.addEventListener('input', () => { state.wardrobeEditorDirty = true; });
        byId('wardrobe-editor-back')?.addEventListener('click', leaveWardrobeEditor);
        byId('wardrobe-editor-cancel')?.addEventListener('click', leaveWardrobeEditor);
        byId('wardrobe-editor-upload')?.addEventListener('change', event => {
            const file = event.target.files?.[0];
            if (!file) return;
            state.wardrobeEditorFiles.push({file, previewUrl: URL.createObjectURL(file)});
            state.wardrobeEditorDirty = true;
            renderWardrobeEditorImages(editorLook(state.wardrobeEditorLookId));
            event.target.value = '';
        });
        byId('wardrobe-look-form')?.elements.proposal_action?.addEventListener('change', event => { byId('wardrobe-editor-merge-target-row').hidden = event.target.value !== 'merge'; });
        byId('wardrobe-open-global')?.addEventListener('click', window.openGlobalWardrobe);
        byId('page-wardrobe-global')?.addEventListener('click', handleWardrobeAction);
        byId('page-wardrobe-owner')?.addEventListener('click', handleWardrobeAction);
        byId('wardrobe-global-more')?.addEventListener('click', () => loadGlobalWardrobe(true));
        byId('wardrobe-global-search')?.addEventListener('input', event => {
            clearTimeout(event.target._wardrobeTimer);
            event.target._wardrobeTimer = setTimeout(() => {
                state.wardrobeGlobalQuery = event.target.value.trim();
                loadGlobalWardrobe(false);
            }, 280);
        });
        document.querySelectorAll('[data-wardrobe-owner-filter]').forEach(button => button.addEventListener('click', () => {
            state.wardrobeGlobalOwnerType = button.dataset.wardrobeOwnerFilter || '';
            document.querySelectorAll('[data-wardrobe-owner-filter]').forEach(item => item.classList.toggle('active', item === button));
            loadGlobalWardrobe(false);
        }));
        byId('wardrobe-owner-search')?.addEventListener('input', event => {
            clearTimeout(event.target._wardrobeTimer);
            event.target._wardrobeTimer = setTimeout(() => {
                state.wardrobeOwnerQuery = event.target.value.trim();
                loadWardrobe();
            }, 240);
        });
        byId('image-gallery-search')?.addEventListener('input', event => {
            clearTimeout(event.target._galleryTimer);
            event.target._galleryTimer = setTimeout(loadGallery, 280);
        });
        byId('image-gallery-sort')?.addEventListener('change', event => {
            state.gallerySort = event.target.value;
            saveGalleryPreferences();
            loadGallery();
        });
        byId('image-gallery-group')?.addEventListener('change', event => {
            state.galleryGroup = event.target.value;
            saveGalleryPreferences();
            renderGallery();
        });
        document.querySelectorAll('[data-gallery-layout]').forEach(button => button.addEventListener('click', () => {
            state.galleryLayout = button.dataset.galleryLayout;
            saveGalleryPreferences();
            document.querySelectorAll('[data-gallery-layout]').forEach(item => {
                item.classList.toggle('active', item === button);
                item.setAttribute('aria-pressed', String(item === button));
            });
            renderGallery();
        }));
        byId('image-gallery-filter-toggle')?.addEventListener('click', () => setGalleryFilterPanel(true));
        document.querySelectorAll('[data-gallery-filter-close]').forEach(button => button.addEventListener('click', () => setGalleryFilterPanel(false)));
        byId('image-gallery-filter-apply')?.addEventListener('click', applyGalleryFilters);
        byId('image-gallery-filter-reset')?.addEventListener('click', resetGalleryFilters);
        byId('image-gallery-filter-chips')?.addEventListener('click', event => {
            const button = event.target.closest('[data-gallery-clear-filter]');
            if (button) clearGalleryFilter(button.dataset.galleryClearFilter);
        });
        byId('image-gallery-batch-dock')?.addEventListener('click', event => {
            const button = event.target.closest('[data-gallery-batch]');
            if (button) runGalleryBatch(button.dataset.galleryBatch);
        });
        byId('page-image-gallery-detail')?.addEventListener('click', handleGalleryDetailAction);
        byId('image-gallery-detail-prev')?.addEventListener('click', () => navigateGalleryDetail(-1));
        byId('image-gallery-detail-next')?.addEventListener('click', () => navigateGalleryDetail(1));
        bindGalleryCardGestures();
        bindGalleryViewerGestures();
        byId('image-workspace-rail')?.addEventListener('click', event => {
            if (event.target.closest('[data-image-rail-toggle]')) {
                state.railCollapsed = !state.railCollapsed;
                updateRail();
            } else if (event.target.closest('[data-image-rail-create]')) {
                window.openImageWorkspace(inferCurrentSource());
            } else if (event.target.closest('[data-image-rail-gallery]')) {
                window.openImageGallery();
            }
        });
        document.addEventListener('click', event => {
            if (event.target.closest('.profile-action-bar [data-action="gallery"]')) {
                window.openImageGallery();
            }
        });
        document.addEventListener('pageShown', event => {
            const pageId = event.detail?.pageId?.split('?')[0];
            if (pageId !== 'image-workspace') rememberWorkspaceStepScroll();
            if (pageId !== 'wardrobe-owner') rememberWardrobeOwnerView();
            if (pageId !== 'wardrobe-global') state.wardrobeGlobalScrollTop = byId('wardrobe-global-scroll')?.scrollTop || 0;
            if (pageId === 'image-gallery') {
                setupGalleryObservers();
                loadGallery();
            } else {
                disposeGalleryObservers();
            }
            if (pageId === 'image-workspace') {
                restoreWorkspaceStepScroll(state.workspaceStep);
                loadVisualProposals();
                restoreGenerationStatus();
                renderGenerationStatus();
                if (generationIsActive()) {
                    startGenerationElapsedTicker();
                    refreshGenerationStatus(true);
                }
            } else {
                stopGenerationTracking();
            }
            if (pageId === 'wardrobe-global') loadGlobalWardrobe(false);
            if (pageId === 'wardrobe-owner' && state.wardrobeOwnerId) loadWardrobe();
            if (pageId === 'chat-detail') updateChatWardrobeCard();
            if (pageId !== 'chat-detail') byId('chat-wardrobe-compact')?.remove();
        });
        document.addEventListener('keydown', event => {
            if (!byId('page-image-gallery-detail')?.classList.contains('active-page')) return;
            if (event.key === 'ArrowLeft') navigateGalleryDetail(-1);
            if (event.key === 'ArrowRight') navigateGalleryDetail(1);
        });
    }

    function inferCurrentSource() {
        const activeId = document.querySelector('.page.active-page')?.id || '';
        if (activeId === 'page-operator-detail' && currentOperator()) return {sourceType: 'operator', sourceId: currentOperator()};
        if (activeId.includes('diary')) return {sourceType: 'diary'};
        if (activeId.includes('dynamic')) return {sourceType: 'dynamic'};
        if (activeId.includes('story')) return {sourceType: 'story'};
        if (activeId.includes('assistant')) return {sourceType: 'assistant'};
        if (activeId.includes('ship')) return {sourceType: 'ship'};
        return {sourceType: 'free'};
    }

    async function init() {
        if (state.initialized) return;
        state.initialized = true;
        restoreGalleryPreferences();
        bindEvents();
        try {
            await loadManifest();
            restoreGalleryPreferences();
            restoreGenerationStatus();
        } catch (error) {
            console.warn('生图工作台清单暂不可用', error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, {once: true});
    } else {
        init();
    }
}());
