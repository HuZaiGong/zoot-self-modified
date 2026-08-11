(function () {
    'use strict';

    const state = {
        campaigns: [],
        actors: [],
        presets: [],
        rules: [],
        profiles: [],
        assetPacks: [],
        capabilities: {},
        selectedCampaignId: '',
        currentCampaignId: '',
        builderStage: 1,
        blueprint: {},
        pendingRequest: null,
        settings: {},
        bound: false,
        ruleSource: '',
        ruleDraft: null,
        operation: null,
        lifecycle: new Map(),
        presentationMode: 'terminal',
        performancePolicy: 'balanced',
        builderDraftId: '',
        builderDraftRevision: 0,
        draftRequestGeneration: 0,
        draftTimer: 0,
        activePageId: '',
        selectedStatus: 'all',
        favoriteOnly: false,
        activeView: 'narrative',
        playPayload: null,
        guideDismissed: false,
        homeRequestGeneration: 0,
        quickStartSubmitting: false,
        pendingAdjudications: [],
        visualProposals: [],
        visualAssets: new Map(),
        visualPolicy: null,
        visualFilter: 'all',
        sortMode: 'manual',
        managementMode: false,
        selectedCampaignIds: new Set(),
        cardGesture: null,
        suppressCardClickUntil: 0,
        batchSubmitting: false,
    };

    const JOURNEY_PAGES = new Set([
        'terra-journey', 'terra-journey-builder', 'terra-journey-play',
        'terra-journey-character', 'terra-journey-presets', 'terra-journey-rules',
        'terra-journey-settings', 'terra-journey-graph', 'terra-journey-sync',
        'terra-journey-visuals',
    ]);

    const STAGE_LABELS = {
        understanding: '理解行动', checking: '判断检定', context: '准备上下文',
        generating: '生成叙事', polishing: '正文润色', validating: '验证状态', saving: '保存节点',
        offline_fallback: '使用本地事件卡', completed: '已完成', failed: '失败', cancelled: '已取消',
    };

    const CAMPAIGN_SORT_MODES = [
        {id: 'manual', label: '自定义顺序', icon: 'menu'},
        {id: 'recent', label: '最近更新', icon: 'refresh'},
        {id: 'created', label: '新建时间', icon: 'calendar'},
        {id: 'title', label: '名称', icon: 'book'},
    ];

    const RENDER_FEATURES = {
        sprites: '可动小人', backgrounds: '动态背景', map_motion: '地图动画',
        blur: '模糊与阴影', hd_images: '高清图片', transitions: '页面过渡',
    };

    function pageScope(pageId) {
        if (!state.lifecycle.has(pageId)) {
            state.lifecycle.set(pageId, {controller: new AbortController(), cleanups: []});
        }
        return state.lifecycle.get(pageId);
    }

    function disposePage(pageId) {
        const scope = state.lifecycle.get(pageId);
        if (!scope) return;
        scope.controller.abort();
        scope.cleanups.splice(0).forEach(cleanup => {
            try { cleanup(); } catch (_error) { /* lifecycle cleanup must continue */ }
        });
        state.lifecycle.delete(pageId);
    }

    function activatePageScope(pageId) {
        JOURNEY_PAGES.forEach(id => {
            if (id !== pageId) disposePage(id);
        });
        return pageScope(pageId);
    }

    const journeyKeyboardViewportController = {
        bound: false,
        currentLift: 0,
        refreshFrame: 0,
        resolveOcclusion() {
            const page = document.getElementById('page-terra-journey-play');
            const active = Boolean(page) && (
                state.activePageId === 'terra-journey-play'
                || page.classList.contains('active-page')
                || page.classList.contains('active')
            );
            if (!active) return 0;
            const viewportApi = window.ZootViewport;
            if (viewportApi && typeof viewportApi.keyboardOcclusion === 'function') {
                const lift = Number(viewportApi.keyboardOcclusion() || 0);
                if (Number.isFinite(lift)) return Math.max(0, Math.round(lift));
            }
            const snapshot = viewportApi && typeof viewportApi.snapshot === 'function'
                ? viewportApi.snapshot()
                : null;
            if (snapshot || !window.visualViewport) return 0;
            const viewport = window.visualViewport;
            const visualCoverage = Math.max(
                0,
                window.innerHeight - viewport.height - viewport.offsetTop,
            );
            return visualCoverage > 96 ? Math.round(visualCoverage) : 0;
        },
        update() {
            const page = document.getElementById('page-terra-journey-play');
            if (!page) return;
            const nextLift = this.resolveOcclusion();
            if (Math.abs(nextLift - this.currentLift) <= 1) return;
            this.currentLift = nextLift;
            page.style.setProperty('--journey-ime-lift', `${nextLift}px`);
            page.classList.toggle('journey-ime-active', nextLift > 0);
        },
        refresh() {
            if (this.refreshFrame) return;
            this.refreshFrame = window.requestAnimationFrame(() => {
                this.refreshFrame = 0;
                this.update();
            });
        },
        reset() {
            const page = document.getElementById('page-terra-journey-play');
            this.currentLift = 0;
            page?.style.setProperty('--journey-ime-lift', '0px');
            page?.classList.remove('journey-ime-active');
        },
        init() {
            if (this.bound) return;
            this.bound = true;
            const refresh = () => this.refresh();
            window.addEventListener('zoot:viewport', refresh, {passive: true});
            window.visualViewport?.addEventListener('resize', refresh, {passive: true});
            window.visualViewport?.addEventListener('scroll', refresh, {passive: true});
            document.addEventListener('focusin', refresh, {passive: true});
            document.addEventListener('focusout', () => window.setTimeout(refresh, 0), {passive: true});
            document.addEventListener('pageShown', event => {
                const pageId = String(event.detail?.pageId || '').split('?')[0];
                if (pageId === 'terra-journey-play') this.refresh();
                else this.reset();
            });
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) this.reset();
                else this.refresh();
            });
        },
    };

    function safeStorageGet(key, fallback) {
        try {
            const value = window.localStorage.getItem(key);
            return value == null ? fallback : value;
        } catch (_error) {
            return fallback;
        }
    }

    function saveDevicePreference(key, value) {
        try { window.localStorage.setItem(key, String(value)); } catch (_error) { /* local cache unavailable */ }
        if (window.ZootDevicePreferences && typeof window.ZootDevicePreferences.set === 'function') {
            try {
                const result = window.ZootDevicePreferences.set(key, value);
                if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => null);
            } catch (_error) { /* native preference mirror is best effort */ }
        }
    }

    function readJsonPreference(key, fallback) {
        try {
            const value = JSON.parse(safeStorageGet(key, ''));
            return value && typeof value === 'object' ? value : fallback;
        } catch (_error) {
            return fallback;
        }
    }

    function saveJsonPreference(key, value) {
        saveDevicePreference(key, JSON.stringify(value || {}));
    }

    function showDevelopmentNotice() {
        const key = 'zoot-terra-journey-dev-notice-v1';
        try {
            if (window.sessionStorage.getItem(key)) return;
            window.sessionStorage.setItem(key, 'shown');
        } catch (_error) { /* session storage unavailable: showing again is safer */ }
        window.requestAnimationFrame(() => window.setTimeout(() => {
            const modal = document.getElementById('terraJourneyDevModal');
            if (modal && typeof window.showModal === 'function') window.showModal('terraJourneyDevModal');
            else if (modal) modal.classList.add('show');
        }, 80));
    }

    function effectivePerformancePolicy() {
        const campaignKey = state.currentCampaignId ? `journey-performance-policy:${state.currentCampaignId}` : '';
        const manual = campaignKey
            ? safeStorageGet(campaignKey, safeStorageGet('journey-performance-policy', 'auto'))
            : safeStorageGet('journey-performance-policy', 'auto');
        if (manual !== 'auto') return manual;
        const budget = window.ZootRuntime && typeof window.ZootRuntime.getResourceBudget === 'function'
            ? window.ZootRuntime.getResourceBudget()
            : 'balanced';
        if (budget === 'light') return 'smooth';
        if (budget === 'full') return 'full';
        return 'balanced';
    }

    function applyPresentation(root) {
        const host = root || document.querySelector('[data-journey-play]') || document.querySelector('[data-journey-home]');
        if (!host) return;
        const campaignKey = state.currentCampaignId ? `journey-presentation-mode:${state.currentCampaignId}` : '';
        state.presentationMode = campaignKey
            ? safeStorageGet(campaignKey, safeStorageGet('journey-presentation-mode', state.presentationMode))
            : safeStorageGet('journey-presentation-mode', state.presentationMode);
        state.performancePolicy = effectivePerformancePolicy();
        host.dataset.presentation = state.presentationMode;
        host.dataset.performance = state.performancePolicy;
        const profile = state.performancePolicy;
        host.style.setProperty('--journey-motion-factor', profile === 'smooth' || profile === 'safe' ? '0' : '1');
        const defaults = {
            sprites: profile === 'full',
            backgrounds: !['smooth', 'safe'].includes(profile),
            map_motion: !['smooth', 'safe'].includes(profile),
            blur: !['smooth', 'safe'].includes(profile),
            hd_images: !['smooth', 'safe'].includes(profile),
            transitions: !['smooth', 'safe'].includes(profile),
        };
        Object.keys(RENDER_FEATURES).forEach(name => {
            const suffix = state.currentCampaignId ? `:${state.currentCampaignId}` : '';
            const saved = safeStorageGet(`journey-render-feature:${name}${suffix}`, '');
            host.dataset[`feature${name.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase())}`] = saved === '' ? String(defaults[name]) : saved;
        });
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function errorMessage(error) {
        const detail = error && error.detail;
        if (typeof detail === 'string') return detail;
        if (detail && typeof detail.message === 'string') return detail.message;
        if (error && typeof error.message === 'string') return error.message;
        try {
            return JSON.stringify(detail || error);
        } catch (_error) {
            return '请求失败，请稍后重试';
        }
    }

    function toast(message, type) {
        if (typeof window.showToast === 'function') {
            window.showToast(String(message), type || 'info');
            return;
        }
        console.log(`[泰拉寻旅] ${message}`);
    }

    async function api(path, options) {
        const response = await fetch(path, options);
        const text = await response.text();
        let payload = {};
        try {
            payload = text ? JSON.parse(text) : {};
        } catch (_error) {
            payload = {detail: text || response.statusText};
        }
        if (!response.ok) {
            const error = new Error(errorMessage(payload));
            error.detail = payload.detail || payload;
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function go(pageId) {
        if (typeof window.showPage === 'function') window.showPage(pageId);
        window.setTimeout(() => {
            if (state.activePageId !== pageId) initializePage(pageId);
        }, 0);
    }

    function actorValue(actor) {
        return [actor.role_type, actor.character_id, actor.game_namespace || 'arknights'].join('|');
    }

    function parseActor(value) {
        const parts = String(value || '').split('|');
        if (parts.length < 3 || !parts[1]) return null;
        return {role_type: parts[0], character_id: parts[1], game_namespace: parts[2]};
    }

    function actorLabel(actor) {
        const labels = {persona: '人格', operator: '干员', character: '对外联络', journey_character: '寻旅角色'};
        return `${actor.display_name || actor.character_id} · ${labels[actor.role_type] || actor.role_type}`;
    }

    async function loadActors() {
        if (state.actors.length) return state.actors;
        const results = await Promise.allSettled([
            api('/operators'),
            api('/personas/identities'),
            api('/terra-journey/characters'),
        ]);
        const operators = results[0].status === 'fulfilled' && Array.isArray(results[0].value) ? results[0].value : [];
        const personas = results[1].status === 'fulfilled' ? (results[1].value.personas || []) : [];
        const journey = results[2].status === 'fulfilled' ? (results[2].value.items || []) : [];
        state.actors = [
            ...personas.map(item => ({
                role_type: 'persona',
                character_id: String(item.persona_id || item.id || ''),
                game_namespace: 'arknights',
                display_name: item.display_name || item.name || '人格',
            })),
            ...operators.filter(item => String(item.game_namespace || 'arknights') === 'arknights').map(item => ({
                role_type: item.role_type === 'character' ? 'character' : 'operator',
                character_id: String(item.id || ''),
                game_namespace: 'arknights',
                display_name: item.codename || item.name || item.id,
            })),
            ...journey.map(item => ({
                role_type: 'journey_character',
                character_id: String(item.character_id || ''),
                game_namespace: 'arknights',
                display_name: item.name || item.character_id,
            })),
        ].filter(item => item.character_id);
        return state.actors;
    }

    function fillActorSelect(select, selectedValue) {
        if (!select) return;
        const options = state.actors.map(item => `<option value="${escapeHtml(actorValue(item))}">${escapeHtml(actorLabel(item))}</option>`).join('');
        select.innerHTML = options || '<option value="">没有可用角色</option>';
        if (selectedValue) select.value = selectedValue;
    }

    async function loadCatalogs() {
        const results = await Promise.all([
            api('/terra-journey/presets'),
            api('/terra-journey/rule-packages'),
            api('/terra-journey/experience-profiles'),
            api('/terra-journey/asset-packs'),
            api('/terra-journey/capabilities'),
        ]);
        state.presets = results[0].items || [];
        state.rules = results[1].items || [];
        state.profiles = results[2].items || [];
        state.assetPacks = results[3].items || [];
        state.capabilities = results[4] || {};
    }

    function campaignCard(item) {
        const media = item.media || {};
        const background = media.background_url ? `style="background-image:url('${escapeHtml(media.background_url)}')"` : '';
        const run = item.active_run || {};
        const protagonist = item.protagonist || {};
        const selected = item.campaign_id === state.selectedCampaignId ? ' selected' : '';
        const checked = state.selectedCampaignIds.has(String(item.campaign_id));
        const deleted = item.deleted_at != null;
        const quickAction = deleted ? 'restore' : 'delete';
        const quickLabel = deleted ? `恢复《${item.title}》` : `删除《${item.title}》`;
        return `<article class="journey-card${selected}${checked ? ' batch-selected' : ''}${deleted ? ' deleted' : ''}" data-campaign-id="${escapeHtml(item.campaign_id)}" data-deleted="${deleted ? 'true' : 'false'}" tabindex="0">
            <div class="journey-card-background" ${background}></div>
            ${deleted ? '' : `<button type="button" class="journey-card-drag-handle" data-journey-drag-handle aria-label="拖动调整《${escapeHtml(item.title)}》的顺序"><span data-zoot-icon="menu" aria-hidden="true"></span></button>`}
            ${deleted ? '' : `<button type="button" class="journey-card-edit" data-journey-edit="${escapeHtml(item.campaign_id)}" aria-label="编辑故事"><span data-zoot-icon="edit" aria-hidden="true"></span></button><button type="button" class="journey-card-favorite" data-journey-favorite="${escapeHtml(item.campaign_id)}" aria-label="${item.favorite ? '取消收藏' : '收藏故事'}"><span data-zoot-icon="${item.favorite ? 'favorite' : 'favoriteOutline'}" aria-hidden="true"></span></button>`}
            <button type="button" class="journey-card-select" data-journey-card-select="${escapeHtml(item.campaign_id)}" aria-label="${checked ? '取消选择' : '选择故事'}" aria-pressed="${checked ? 'true' : 'false'}"><span data-zoot-icon="check" aria-hidden="true"></span></button>
            <button type="button" class="journey-card-quick-action ${quickAction}" data-journey-card-quick-action="${quickAction}" data-campaign-id="${escapeHtml(item.campaign_id)}" aria-label="${escapeHtml(quickLabel)}"><span data-zoot-icon="${deleted ? 'refresh' : 'trash'}" aria-hidden="true"></span></button>
            <div class="journey-card-content"><small>${deleted ? '已删除 · ' : ''}${escapeHtml(item.mode === 'tabletop' ? '跑团' : '叙事')} · 第${Number(run.chapter || 1)}章 · ${escapeHtml(item.sync_policy)}</small><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary || '等待旅程开始')}</p><small>主角 ${escapeHtml(protagonist.character_id || '未指定')} · 场景 ${Number(run.scene || 0)}</small></div>
        </article>`;
    }

    function createCampaignCard() {
        return `<button type="button" class="journey-card journey-create-card" data-journey-create-card aria-label="新建故事"><span data-zoot-icon="plus" aria-hidden="true"></span><strong>新建故事</strong><small>从主角、故事来源与世界边界开始</small></button>`;
    }

    function renderExplorerGuide(root, force) {
        if (!root) return;
        const storageKey = 'zoot-terra-journey-guide-v1';
        const dismissed = state.guideDismissed || safeStorageGet(storageKey, '') === 'dismissed';
        const existing = root.querySelector('[data-journey-guide-card]');
        if (existing) existing.remove();
        const links = root.querySelector('.journey-link-grid');
        if (links && !links.querySelector('[data-journey-guide-open]')) {
            links.insertAdjacentHTML('beforeend', '<button type="button" data-journey-guide-open><span data-zoot-icon="info" aria-hidden="true"></span> 探索指南</button>');
            if (window.ZootIcons && typeof window.ZootIcons.hydrate === 'function') window.ZootIcons.hydrate(links);
        }
        if (dismissed && !force) return;
        const guide = document.createElement('section');
        guide.className = 'journey-explorer-guide';
        guide.dataset.journeyGuideCard = 'true';
        guide.innerHTML = `<div class="journey-guide-heading"><span data-zoot-icon="info" aria-hidden="true"></span><div><strong>第一次寻旅，从三件事开始</strong><p>选择主角与体验方案，确认世界线边界，然后用自然语言描述行动。其余规则可以在需要时再展开。</p></div><button type="button" data-journey-guide-dismiss aria-label="关闭探索指南"><span data-zoot-icon="close" aria-hidden="true"></span></button></div><ol><li><strong>先快速开始</strong><span>系统会建立可修改的故事蓝图，不会自动产生付费调用。</span></li><li><strong>遇到风险再看检定</strong><span>骰子、状态和永久后果都由本地规则验证。</span></li><li><strong>章节结束再同步</strong><span>记忆、纪事和传闻均需逐项批准后才进入全局。</span></li></ol>`;
        const hero = root.querySelector('.journey-hero');
        if (hero) hero.insertAdjacentElement('afterend', guide);
        else root.prepend(guide);
        if (window.ZootIcons && typeof window.ZootIcons.hydrate === 'function') window.ZootIcons.hydrate(guide);
    }

    async function loadHome() {
        const root = document.querySelector('[data-journey-home]');
        if (!root) return;
        const generation = ++state.homeRequestGeneration;
        showDevelopmentNotice();
        applyPresentation(root);
        renderExplorerGuide(root, false);
        const status = state.selectedStatus || 'all';
        const query = root.querySelector('[data-journey-search]').value || '';
        const favoriteQuery = state.favoriteOnly ? '&favorite=true' : '';
        state.sortMode = safeStorageGet('journey-campaign-sort-v1', state.sortMode || 'manual');
        const deletedMode = status === 'deleted' ? 'only' : 'exclude';
        const statusQuery = status === 'deleted' ? 'all' : status;
        const data = await api(`/terra-journey/campaigns?status=${encodeURIComponent(statusQuery)}&q=${encodeURIComponent(query)}&deleted=${deletedMode}&sort=${encodeURIComponent(state.sortMode)}${favoriteQuery}`);
        if (generation !== state.homeRequestGeneration) return;
        state.campaigns = data.items || [];
        const search = root.querySelector('[data-journey-search]');
        if (search) search.placeholder = `搜索 ${Number(data.total || 0)} 个故事档案`;
        const counts = (data.facets && data.facets.status_counts) || {};
        root.querySelectorAll('[data-journey-status]').forEach(button => {
            const value = button.dataset.journeyStatus;
            button.classList.toggle('active', value === status);
            button.setAttribute('aria-selected', value === status ? 'true' : 'false');
            const label = button.textContent.replace(/\s+\d+$/, '');
            const count = value === 'deleted' ? Number((data.facets || {}).deleted_count || 0) : Number(counts[value] || 0);
            button.textContent = `${label} ${count}`;
        });
        const favorite = root.querySelector('[data-journey-favorite-only]');
        if (favorite) {
            favorite.classList.toggle('active', state.favoriteOnly);
            favorite.setAttribute('aria-pressed', state.favoriteOnly ? 'true' : 'false');
            favorite.setAttribute('aria-label', state.favoriteOnly ? '显示全部故事' : `仅显示收藏故事，共${Number((data.facets || {}).favorite_count || 0)}个`);
            favorite.innerHTML = `<span data-zoot-icon="${state.favoriteOnly ? 'favorite' : 'favoriteOutline'}" aria-hidden="true"></span>`;
        }
        const cards = root.querySelector('[data-journey-cards]');
        cards.classList.toggle('management-mode', state.managementMode);
        cards.innerHTML = state.campaigns.map(campaignCard).join('') + (status === 'deleted' || state.managementMode ? '' : createCampaignCard());
        const sort = CAMPAIGN_SORT_MODES.find(item => item.id === state.sortMode) || CAMPAIGN_SORT_MODES[0];
        const sortButton = root.querySelector('[data-journey-sort-cycle]');
        if (sortButton) {
            sortButton.dataset.sortMode = sort.id;
            sortButton.setAttribute('aria-label', `当前按${sort.label}排列；点击切换`);
            sortButton.innerHTML = `<span data-zoot-icon="${sort.icon}" aria-hidden="true"></span>`;
        }
        renderCampaignManagement(root);
        if (window.ZootIcons && typeof window.ZootIcons.hydrate === 'function') window.ZootIcons.hydrate(cards);
        if (window.ZootIcons && typeof window.ZootIcons.hydrate === 'function') window.ZootIcons.hydrate(root);
        updateEnterButton();
    }

    function updateEnterButton() {
        const button = document.querySelector('[data-journey-enter]');
        if (!button) return;
        button.hidden = state.managementMode || state.selectedStatus === 'deleted';
        button.textContent = state.selectedCampaignId ? '进入故事' : '新建故事';
    }

    function renderCampaignManagement(root) {
        const bar = (root || document).querySelector('[data-journey-batch-bar]');
        if (!bar) return;
        bar.hidden = !state.managementMode;
        const count = bar.querySelector('[data-journey-selected-count]');
        if (count) count.textContent = `已选择 ${state.selectedCampaignIds.size} 项`;
        const visibleIdentifiers = state.campaigns.map(item => String(item.campaign_id));
        const allVisibleSelected = visibleIdentifiers.length > 0 && visibleIdentifiers.every(identifier => state.selectedCampaignIds.has(identifier));
        const selectAll = bar.querySelector('[data-journey-select-all]');
        if (selectAll) selectAll.textContent = allVisibleSelected ? '取消全选' : '全选当前结果';
        const selectedItems = state.campaigns.filter(item => state.selectedCampaignIds.has(String(item.campaign_id)));
        const allFavorite = selectedItems.length > 0 && selectedItems.every(item => Boolean(item.favorite));
        const favorite = bar.querySelector('[data-journey-batch-action="favorite"], [data-journey-batch-action="unfavorite"]');
        if (favorite) {
            favorite.dataset.journeyBatchAction = allFavorite ? 'unfavorite' : 'favorite';
            favorite.innerHTML = `<span data-zoot-icon="${allFavorite ? 'favoriteOutline' : 'favorite'}" aria-hidden="true"></span><span data-journey-batch-favorite-label>${allFavorite ? '取消收藏' : '收藏'}</span>`;
        }
        const deletedMode = state.selectedStatus === 'deleted';
        bar.classList.toggle('deleted-mode', deletedMode);
        bar.querySelectorAll('[data-journey-batch-standard]').forEach(button => { button.hidden = deletedMode; });
        const restore = bar.querySelector('[data-journey-batch-action="restore"]');
        if (restore) restore.hidden = !deletedMode;
        bar.querySelectorAll('[data-journey-batch-action], [data-journey-status-menu]').forEach(button => {
            button.disabled = state.batchSubmitting || state.selectedCampaignIds.size === 0;
        });
        if (window.ZootIcons && typeof window.ZootIcons.hydrate === 'function') window.ZootIcons.hydrate(bar);
    }

    function toggleCampaignSelection(campaignId) {
        const identifier = String(campaignId || '');
        if (!identifier) return;
        if (state.selectedCampaignIds.has(identifier)) state.selectedCampaignIds.delete(identifier);
        else state.selectedCampaignIds.add(identifier);
        const root = document.querySelector('[data-journey-home]');
        const card = root && Array.from(root.querySelectorAll('.journey-card[data-campaign-id]')).find(item => item.dataset.campaignId === identifier);
        if (card) card.classList.toggle('batch-selected', state.selectedCampaignIds.has(identifier));
        const select = card && card.querySelector('[data-journey-card-select]');
        if (select) select.setAttribute('aria-pressed', state.selectedCampaignIds.has(identifier) ? 'true' : 'false');
        renderCampaignManagement(root);
    }

    async function persistCampaignOrder() {
        if (state.campaigns.length < 2) return;
        await api('/terra-journey/campaigns/reorder', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({campaign_ids: state.campaigns.map(item => String(item.campaign_id))}),
        });
    }

    async function moveCampaign(campaignId, direction) {
        const index = state.campaigns.findIndex(item => String(item.campaign_id) === String(campaignId));
        const nextIndex = direction === 'previous' ? index - 1 : index + 1;
        if (index < 0 || nextIndex < 0 || nextIndex >= state.campaigns.length) return;
        const [item] = state.campaigns.splice(index, 1);
        state.campaigns.splice(nextIndex, 0, item);
        try {
            await persistCampaignOrder();
            await loadHome();
        } catch (error) {
            toast(errorMessage(error), 'error');
            await loadHome();
        }
    }

    async function executeCampaignAction(action, campaignIds, options = {}) {
        const identifiers = Array.from(new Set((campaignIds || []).map(identifier => String(identifier || '')).filter(Boolean)));
        if (!identifiers.length || state.batchSubmitting) return;
        state.batchSubmitting = true;
        renderCampaignManagement(document.querySelector('[data-journey-home]'));
        try {
            const expected = {};
            state.campaigns.forEach(item => {
                if (state.selectedCampaignIds.has(String(item.campaign_id))) expected[String(item.campaign_id)] = Number(item.revision);
            });
            const result = await api('/terra-journey/campaigns/batch', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({campaign_ids: identifiers, action, deleted_reason: 'user_deleted', expected_revisions: expected}),
            });
            if (options.clearSelection === false) identifiers.forEach(identifier => state.selectedCampaignIds.delete(identifier));
            else state.selectedCampaignIds.clear();
            closeJourneySheet('journeyDetailSheet');
            toast(`已处理 ${Number(result.changed_count || 0)} 个故事`);
            await loadHome();
        } catch (error) {
            toast(errorMessage(error), 'error');
        } finally {
            state.batchSubmitting = false;
            renderCampaignManagement(document.querySelector('[data-journey-home]'));
        }
    }

    async function executeCampaignBatch(action) {
        await executeCampaignAction(action, Array.from(state.selectedCampaignIds));
    }

    function confirmCampaignDeletion() {
        const count = state.selectedCampaignIds.size;
        detailSheet('删除故事', `<div class="journey-delete-confirm"><span data-zoot-icon="trash" aria-hidden="true"></span><p>将 ${count} 个故事移入“已删除”。剧情正文、分支、图片和检定记录都会保留，可随时恢复。</p><button type="button" class="journey-danger-action" data-journey-batch-confirm="delete">确认移入已删除</button></div>`);
    }

    function confirmCampaignArchive() {
        const count = state.selectedCampaignIds.size;
        detailSheet('归档故事', `<div class="journey-delete-confirm"><span data-zoot-icon="archive" aria-hidden="true"></span><p>确认归档 ${count} 个故事？归档后不会出现在进行中的故事中，之后仍可恢复为进行中。</p><button type="button" data-journey-batch-confirm="archive">确认归档</button></div>`);
    }

    function confirmSingleCampaignDeletion(campaignId) {
        const campaign = state.campaigns.find(item => String(item.campaign_id) === String(campaignId));
        if (!campaign) return;
        detailSheet('删除故事', `<div class="journey-delete-confirm"><span data-zoot-icon="trash" aria-hidden="true"></span><p>将《${escapeHtml(campaign.title)}》移入“已删除”？剧情正文、分支、图片和检定记录都会保留，可随时恢复。</p><button type="button" class="journey-danger-action" data-journey-single-confirm="delete" data-campaign-id="${escapeHtml(campaign.campaign_id)}">确认移入已删除</button></div>`);
    }

    function openCampaignStatusMenu() {
        if (!state.selectedCampaignIds.size) return;
        detailSheet('修改故事状态', `<div class="journey-status-action-grid"><button type="button" data-journey-status-action="activate">设为进行中</button><button type="button" data-journey-status-action="pause">设为暂停</button><button type="button" data-journey-status-action="complete">设为已完成</button></div>`);
    }

    function openJourneySheet(sheetId) {
        if (typeof window.openBottomSheet === 'function') window.openBottomSheet(sheetId);
        else {
            const sheet = document.getElementById(sheetId);
            if (sheet) { sheet.classList.remove('hidden'); sheet.classList.add('show'); }
        }
    }

    function closeJourneySheet(sheetId) {
        if (typeof window.closeBottomSheet === 'function') window.closeBottomSheet(sheetId);
        else {
            const sheet = document.getElementById(sheetId);
            if (sheet) { sheet.classList.remove('show'); sheet.classList.add('hidden'); }
        }
    }

    function updateQuickStartSource(sheet) {
        if (!sheet) return;
        const source = sheet.querySelector('[data-journey-quick-source]');
        const presetField = sheet.querySelector('[data-journey-quick-preset]');
        if (presetField) presetField.hidden = !source || source.value !== 'preset_random';
    }

    async function prepareQuickStart() {
        const sheet = document.getElementById('journeyQuickStartSheet');
        if (!sheet) return;
        openJourneySheet('journeyQuickStartSheet');
        const status = sheet.querySelector('[data-journey-quick-status]');
        if (status) status.textContent = '正在读取可用主角与体验方案…';
        try {
            await Promise.all([loadActors(), state.profiles.length ? Promise.resolve() : loadCatalogs()]);
            const saved = readJsonPreference('journey-quick-start-defaults', {});
            const actor = sheet.querySelector('[data-journey-quick-actor]');
            const currentPersona = state.actors.find(item => item.role_type === 'persona' && item.character_id === String(window.currentPersonaId || 'doctor'));
            fillActorSelect(actor, saved.actor || (currentPersona ? actorValue(currentPersona) : ''));
            const profile = sheet.querySelector('[data-journey-quick-profile]');
            if (profile) {
                profile.innerHTML = state.profiles.map(item => `<option value="${escapeHtml(item.profile_id)}">${escapeHtml(item.name)}</option>`).join('') || '<option value="balanced_journey">平衡旅程</option>';
                profile.value = saved.profile || 'balanced_journey';
            }
            const preset = sheet.querySelector('[data-journey-quick-preset-select]');
            if (preset) {
                preset.innerHTML = state.presets.map(item => `<option value="${escapeHtml(item.preset_id)}">${escapeHtml(item.name)}</option>`).join('') || '<option value="">暂无可用预设</option>';
                if (saved.preset) preset.value = saved.preset;
            }
            ['source', 'mode', 'sync', 'canon'].forEach(name => {
                const input = sheet.querySelector(`[data-journey-quick-${name}]`);
                if (input && saved[name]) input.value = saved[name];
            });
            if (saved.seed != null) sheet.querySelector('[data-journey-quick-seed]').value = saved.seed;
            updateQuickStartSource(sheet);
            if (status) status.textContent = '';
        } catch (error) {
            if (status) status.textContent = errorMessage(error);
        }
    }

    async function quickStart() {
        const root = document.getElementById('journeyQuickStartSheet');
        if (!root || state.quickStartSubmitting) return;
        const protagonist = parseActor(root.querySelector('[data-journey-quick-actor]').value);
        if (!protagonist) {
            toast('请先选择主角', 'error');
            return;
        }
        const button = root.querySelector('[data-journey-quick-confirm]');
        const status = root.querySelector('[data-journey-quick-status]');
        const sourceType = root.querySelector('[data-journey-quick-source]').value;
        const presetId = sourceType === 'preset_random' ? root.querySelector('[data-journey-quick-preset-select]').value : '';
        const preset = state.presets.find(item => item.preset_id === presetId) || null;
        if (sourceType === 'preset_random' && !preset) {
            toast('请先选择故事预设', 'error');
            return;
        }
        const mode = root.querySelector('[data-journey-quick-mode]').value;
        const syncPolicy = root.querySelector('[data-journey-quick-sync]').value;
        const canonPolicy = root.querySelector('[data-journey-quick-canon]').value;
        const profileId = root.querySelector('[data-journey-quick-profile]').value || 'balanced_journey';
        const seedValue = root.querySelector('[data-journey-quick-seed]').value;
        const useLlm = Boolean(root.querySelector('[data-journey-quick-use-llm]').checked);
        state.quickStartSubmitting = true;
        button.disabled = true;
        button.textContent = '正在建立旅程…';
        if (status) status.textContent = '正在生成可编辑的故事蓝图';
        try {
            const generated = await api('/terra-journey/blueprints', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    protagonist,
                    source_type: sourceType,
                    preset_id: presetId || null,
                    preset_revision: preset ? Number(preset.revision) : null,
                    use_llm: useLlm,
                    acknowledge_cost: useLlm,
                    seed: seedValue === '' ? null : Number(seedValue),
                }),
            });
            const campaign = await api('/terra-journey/campaigns', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    protagonist,
                    source_type: sourceType,
                    preset_id: presetId || null,
                    preset_revision: preset ? Number(preset.revision) : null,
                    mode,
                    sync_policy: syncPolicy,
                    canon_policy: canonPolicy,
                    settings: {experience_profile_id: profileId},
                    blueprint: generated.blueprint,
                }),
            });
            saveJsonPreference('journey-quick-start-defaults', {actor: actorValue(protagonist), source: sourceType, preset: presetId, mode, sync: syncPolicy, canon: canonPolicy, profile: profileId, seed: seedValue});
            state.currentCampaignId = campaign.campaign_id;
            closeJourneySheet('journeyQuickStartSheet');
            await openCampaign(campaign.campaign_id);
        } catch (error) {
            if (status) status.textContent = errorMessage(error);
            toast(errorMessage(error), 'error');
        } finally {
            state.quickStartSubmitting = false;
            button.disabled = false;
            button.textContent = '确认并开始';
        }
    }

    async function initializeBuilder() {
        await Promise.all([loadActors(), loadCatalogs(), loadHome().catch(() => null)]);
        const root = document.querySelector('[data-journey-builder]');
        if (!root) return;
        fillActorSelect(root.querySelector('[data-builder-actor]'));
        root.querySelector('[data-builder-preset]').innerHTML = state.presets.map(item => `<option value="${escapeHtml(item.preset_id)}">${escapeHtml(item.name)}</option>`).join('');
        root.querySelector('[data-builder-rule]').innerHTML = state.rules.map(item => `<option value="${escapeHtml(item.rule_id)}|${escapeHtml(item.version)}">${escapeHtml(item.name)} · ${escapeHtml(item.version)}</option>`).join('');
        const profileSelect = root.querySelector('[data-builder-profile]');
        if (profileSelect) profileSelect.innerHTML = state.profiles.map(item => `<option value="${escapeHtml(item.profile_id)}">${escapeHtml(item.name)}</option>`).join('');
        root.querySelector('[data-builder-parent]').innerHTML = '<option value="">选择故事</option>' + state.campaigns.map(item => `<option value="${escapeHtml(item.campaign_id)}">${escapeHtml(item.title)}</option>`).join('');
        await restoreBuilderDraft(root);
        setBuilderStage(1);
    }

    function builderDraftPayload(root) {
        const field = selector => {
            const input = root.querySelector(selector);
            return input ? input.value : '';
        };
        return {
            schema_version: 2,
            actor: field('[data-builder-actor]'),
            source_type: sourceType(),
            preset_id: field('[data-builder-preset]'),
            parent_campaign_id: field('[data-builder-parent]'),
            join_node_id: field('[data-builder-join-node]'),
            blueprint: collectBlueprint(),
            seed: field('[data-builder-seed]'),
            use_llm: Boolean(root.querySelector('[data-builder-use-llm]') && root.querySelector('[data-builder-use-llm]').checked),
            mode: field('[data-builder-mode]'),
            canon_policy: field('[data-builder-canon]'),
            sync_policy: field('[data-builder-sync]'),
            rule: field('[data-builder-rule]'),
            experience_profile_id: field('[data-builder-profile]'),
            orchestration_mode: field('[data-builder-orchestration]'),
            narrative_polish: Boolean(root.querySelector('[data-builder-polish]') && root.querySelector('[data-builder-polish]').checked),
            narrative_polish_cost: Boolean(root.querySelector('[data-builder-polish-cost]') && root.querySelector('[data-builder-polish-cost]').checked),
            narrative_polish_corpus: field('[data-builder-polish-corpus]'),
            director_mode: Boolean(root.querySelector('[data-builder-director]') && root.querySelector('[data-builder-director]').checked),
            rules: field('[data-builder-rules]'),
            stage: state.builderStage,
        };
    }

    function scheduleBuilderDraftSave() {
        window.clearTimeout(state.draftTimer);
        state.draftTimer = window.setTimeout(saveBuilderDraft, 650);
    }

    async function saveBuilderDraft() {
        const root = document.querySelector('[data-journey-builder]');
        if (!root) return;
        const generation = ++state.draftRequestGeneration;
        const payload = builderDraftPayload(root);
        const path = state.builderDraftId
            ? `/terra-journey/drafts/${encodeURIComponent(state.builderDraftId)}`
            : '/terra-journey/drafts';
        const method = state.builderDraftId ? 'PATCH' : 'POST';
        try {
            const saved = await api(path, {
                method,
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({payload, expected_revision: state.builderDraftRevision || undefined}),
            });
            if (generation !== state.draftRequestGeneration) return;
            state.builderDraftId = saved.draft_id;
            state.builderDraftRevision = Number(saved.revision || 1);
            saveDevicePreference('journey-builder-draft-id', saved.draft_id);
            const status = root.querySelector('[data-builder-status]');
            if (status && !status.textContent.includes('正在创建')) status.textContent = '草稿已保存';
        } catch (error) {
            if (generation !== state.draftRequestGeneration) return;
            const status = root.querySelector('[data-builder-status]');
            if (status) status.textContent = `草稿保存失败：${errorMessage(error)}`;
        }
    }

    async function restoreBuilderDraft(root) {
        const draftId = safeStorageGet('journey-builder-draft-id', '');
        if (!draftId) return;
        try {
            const draft = await api(`/terra-journey/drafts/${encodeURIComponent(draftId)}`);
            const payload = draft.payload || {};
            state.builderDraftId = draft.draft_id;
            state.builderDraftRevision = Number(draft.revision || 1);
            const values = {
                '[data-builder-actor]': payload.actor,
                '[data-builder-preset]': payload.preset_id,
                '[data-builder-parent]': payload.parent_campaign_id,
                '[data-builder-join-node]': payload.join_node_id,
                '[data-builder-seed]': payload.seed,
                '[data-builder-mode]': payload.mode,
                '[data-builder-canon]': payload.canon_policy,
                '[data-builder-sync]': payload.sync_policy,
                '[data-builder-rule]': payload.rule,
                '[data-builder-profile]': payload.experience_profile_id,
                '[data-builder-orchestration]': payload.orchestration_mode,
                '[data-builder-rules]': payload.rules,
            };
            Object.entries(values).forEach(([selector, value]) => {
                const input = root.querySelector(selector);
                if (input && value != null && value !== '') input.value = value;
            });
            const source = Array.from(root.querySelectorAll('input[name="journey-source"]'))
                .find(input => input.value === String(payload.source_type || 'random'));
            if (source) source.checked = true;
            if (root.querySelector('[data-builder-use-llm]')) root.querySelector('[data-builder-use-llm]').checked = Boolean(payload.use_llm);
            if (root.querySelector('[data-builder-director]')) root.querySelector('[data-builder-director]').checked = Boolean(payload.director_mode);
            if (root.querySelector('[data-builder-polish]')) root.querySelector('[data-builder-polish]').checked = Boolean(payload.narrative_polish);
            if (root.querySelector('[data-builder-polish-cost]')) root.querySelector('[data-builder-polish-cost]').checked = Boolean(payload.narrative_polish_cost);
            if (root.querySelector('[data-builder-polish-corpus]') && payload.narrative_polish_corpus) root.querySelector('[data-builder-polish-corpus]').value = payload.narrative_polish_corpus;
            applyBlueprint(payload.blueprint || {});
        } catch (_error) {
            state.builderDraftId = '';
            state.builderDraftRevision = 0;
        }
    }

    function setBuilderStage(stage) {
        state.builderStage = Math.max(1, Math.min(4, Number(stage || 1)));
        document.querySelectorAll('[data-journey-builder] [data-stage]').forEach(button => button.classList.toggle('active', Number(button.dataset.stage) === state.builderStage));
        document.querySelectorAll('[data-journey-builder] [data-stage-panel]').forEach(panel => panel.classList.toggle('active', Number(panel.dataset.stagePanel) === state.builderStage));
        const previous = document.querySelector('[data-builder-prev]');
        const next = document.querySelector('[data-builder-next]');
        if (previous) previous.disabled = state.builderStage === 1;
        if (next) next.textContent = state.builderStage === 4 ? '创建并进入' : '下一步';
        if (state.builderStage === 4) renderConfirmation();
    }

    function sourceType() {
        const checked = document.querySelector('[data-journey-builder] input[name="journey-source"]:checked');
        return checked ? checked.value : 'random';
    }

    function collectBlueprint() {
        return {
            ...state.blueprint,
            title: document.querySelector('[data-builder-title]').value.trim(),
            summary: document.querySelector('[data-builder-summary]').value.trim(),
            opening: document.querySelector('[data-builder-opening]').value.trim(),
            region: document.querySelector('[data-builder-region]').value.trim(),
            era: document.querySelector('[data-builder-era]').value.trim(),
            tone: document.querySelector('[data-builder-tone]').value.trim(),
            objective: document.querySelector('[data-builder-objective]').value.trim(),
        };
    }

    function applyBlueprint(blueprint) {
        state.blueprint = blueprint || {};
        const fields = {title: 'title', summary: 'summary', opening: 'opening', region: 'region', era: 'era', tone: 'tone', objective: 'objective'};
        Object.entries(fields).forEach(([selector, key]) => {
            const input = document.querySelector(`[data-builder-${selector}]`);
            if (input) input.value = state.blueprint[key] || '';
        });
    }

    async function generateBlueprint() {
        const protagonist = parseActor(document.querySelector('[data-builder-actor]').value);
        if (!protagonist) throw new Error('请先选择主角');
        const useLlm = document.querySelector('[data-builder-use-llm]').checked;
        const presetId = document.querySelector('[data-builder-preset]').value;
        const preset = state.presets.find(item => item.preset_id === presetId);
        const payload = {
            seed: Number(document.querySelector('[data-builder-seed]').value) || null,
            protagonist,
            source_type: sourceType(),
            preset_id: presetId || null,
            preset_revision: preset ? Number(preset.revision) : null,
            use_llm: useLlm,
            acknowledge_cost: useLlm,
        };
        const data = await api('/terra-journey/blueprints', {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload),
        });
        applyBlueprint(data.blueprint);
        return data.blueprint;
    }

    function applySelectedPreset(overwrite) {
        const select = document.querySelector('[data-builder-preset]');
        const preset = state.presets.find(item => item.preset_id === (select && select.value));
        if (!preset) return;
        const definition = preset.definition || {};
        const constraints = definition.constraints && !Array.isArray(definition.constraints)
            ? definition.constraints
            : {};
        const proposed = {
            title: definition.title || definition.name || preset.name,
            summary: definition.summary || definition.description || '',
            opening: definition.opening || '',
            region: definition.region || constraints.region || '',
            era: definition.era || constraints.era || '',
            conflict: definition.conflict || constraints.conflict || '',
            objective: definition.objective || constraints.objective || '',
            tone: definition.tone || constraints.tone || '',
            preset_id: preset.preset_id,
            preset_revision: Number(preset.revision || 1),
        };
        const current = collectBlueprint();
        const merged = {...current};
        Object.entries(proposed).forEach(([key, value]) => {
            if (value !== '' && value != null && (overwrite || !merged[key])) merged[key] = value;
        });
        applyBlueprint(merged);
    }

    function renderConfirmation() {
        const target = document.querySelector('[data-builder-confirm]');
        const protagonist = parseActor(document.querySelector('[data-builder-actor]').value) || {};
        const blueprint = collectBlueprint();
        const polish = document.querySelector('[data-builder-polish]') && document.querySelector('[data-builder-polish]').checked;
        target.innerHTML = `<strong>${escapeHtml(blueprint.title || '未命名旅程')}</strong><p>${escapeHtml(blueprint.summary || '尚未填写摘要')}</p><small>主角 ${escapeHtml(protagonist.character_id || '未选择')} · ${escapeHtml(sourceType())} · 混合知识检索 · ${polish ? '每回合生成后再进行一次正文润色' : '直接使用首轮正文'} · 所有永久后果需确认</small>`;
    }

    async function createFromBuilder() {
        const root = document.querySelector('[data-journey-builder]');
        const status = root.querySelector('[data-builder-status]');
        const protagonist = parseActor(root.querySelector('[data-builder-actor]').value);
        if (!protagonist) throw new Error('请选择主角');
        if (root.querySelector('[data-builder-polish]').checked && !root.querySelector('[data-builder-polish-cost]').checked) {
            throw new Error('启用正文润色前，请确认每回合会额外调用一次模型并可能产生费用');
        }
        let blueprint = collectBlueprint();
        if (!blueprint.title || !blueprint.summary) blueprint = await generateBlueprint();
        const ruleParts = root.querySelector('[data-builder-rule]').value.split('|');
        const extraRule = root.querySelector('[data-builder-rules]').value.trim();
        const parentId = root.querySelector('[data-builder-parent]').value;
        const parent = state.campaigns.find(item => item.campaign_id === parentId);
        const presetId = root.querySelector('[data-builder-preset]').value;
        const preset = state.presets.find(item => item.preset_id === presetId);
        status.textContent = '正在创建故事与时间线…';
        const campaign = await api('/terra-journey/campaigns', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                protagonist,
                source_type: sourceType(),
                mode: root.querySelector('[data-builder-mode]').value,
                canon_policy: root.querySelector('[data-builder-canon]').value,
                sync_policy: root.querySelector('[data-builder-sync]').value,
                blueprint,
                preset_id: sourceType() === 'preset' || sourceType() === 'preset_random' ? presetId : null,
                preset_revision: preset ? Number(preset.revision) : null,
                rule_id: ruleParts[0] || 'zoot_narrative_light',
                rule_version: ruleParts[1] || '1.0.0',
                parent_campaign_id: parentId || null,
                parent_revision: parent ? parent.revision : null,
                join_node_id: root.querySelector('[data-builder-join-node]').value || null,
                director_mode: root.querySelector('[data-builder-director]').checked,
                settings: {
                    ...state.settings,
                    experience_profile_id: root.querySelector('[data-builder-profile]') ? root.querySelector('[data-builder-profile]').value : 'balanced_journey',
                    orchestration_mode: root.querySelector('[data-builder-orchestration]') ? root.querySelector('[data-builder-orchestration]').value : 'single_ensemble',
                    acknowledge_multi_call: Boolean(root.querySelector('[data-builder-multi-call]') && root.querySelector('[data-builder-multi-call]').checked),
                    offline_fallback: true,
                    knowledge_mode: 'hybrid_v2',
                    knowledge_budget: Number(root.querySelector('[data-builder-knowledge-budget]').value) || 9000,
                    narrative_polish: {
                        enabled: Boolean(root.querySelector('[data-builder-polish]') && root.querySelector('[data-builder-polish]').checked),
                        acknowledge_cost: Boolean(root.querySelector('[data-builder-polish-cost]') && root.querySelector('[data-builder-polish-cost]').checked),
                        corpus_mode: root.querySelector('[data-builder-polish-corpus]') ? root.querySelector('[data-builder-polish-corpus]').value : 'character_and_campaign',
                        max_corpus_chars: 6000,
                        preserve_length: true,
                    },
                },
                rules: extraRule ? [{type: 'campaign_rule', content: extraRule}] : [],
            }),
        });
        state.currentCampaignId = campaign.campaign_id;
        state.builderDraftId = '';
        state.builderDraftRevision = 0;
        saveDevicePreference('journey-builder-draft-id', '');
        status.textContent = '创建完成';
        await openCampaign(campaign.campaign_id);
    }

    async function openCampaign(campaignId) {
        state.currentCampaignId = campaignId;
        go('terra-journey-play');
    }

    function stateMarkup(run) {
        const data = run.state || {};
        const observations = Object.entries(data.relationship_observations || {}).slice(0, 8);
        const factions = Object.entries(data.faction_attitudes || {}).slice(0, 8);
        const injuries = Array.isArray(data.injuries) ? data.injuries : [];
        const threats = Array.isArray(data.threats) ? data.threats : [];
        const clues = Array.isArray(data.open_clues) ? data.open_clues : [];
        return `<h3>旅途状态</h3><p><strong>地点</strong><br>${escapeHtml(data.location || '未知')}</p><p><strong>时间</strong><br>${escapeHtml(data.time || '未指定')}</p><p><strong>天气</strong><br>${escapeHtml(data.weather || '未知')}</p><p><strong>目标</strong><br>${escapeHtml(data.objective || '继续旅程')}</p><p><strong>补给</strong> ${Number(data.supplies == null ? 100 : data.supplies)} · <strong>疲劳</strong> ${Number(data.fatigue || 0)}</p><p><strong>风险</strong> ${escapeHtml(data.risk || 'medium')} · <strong>警戒</strong> ${Number(data.region_alert || 0)}</p><p><strong>伤势</strong><br>${escapeHtml(injuries.join('；') || '无明确伤势')}</p><p><strong>感染状态</strong><br>${escapeHtml(data.infection || '未变化')}</p>${clues.length ? `<p><strong>开放线索</strong><br>${escapeHtml(clues.join('；'))}</p>` : ''}${threats.length ? `<p><strong>未解决威胁</strong><br>${escapeHtml(threats.join('；'))}</p>` : ''}${observations.length ? `<div class="journey-relationship-observations"><strong>可观察关系反应</strong>${observations.map(([name, value]) => `<p>${escapeHtml(name)}：${escapeHtml(value)}</p>`).join('')}</div>` : ''}${factions.length ? `<div class="journey-relationship-observations"><strong>势力态度</strong>${factions.map(([name, value]) => `<p>${escapeHtml(name)}：${escapeHtml(String(value))}</p>`).join('')}</div>` : ''}`;
    }

    function actorDisplayName(actor) {
        const roleType = String(actor.role_type || '');
        const characterId = String(actor.character_id || '');
        const catalogItem = state.actors.find(item => String(item.role_type) === roleType && String(item.character_id) === characterId)
            || state.actors.find(item => String(item.character_id) === characterId);
        return String((catalogItem && catalogItem.display_name) || actor.display_name || characterId || '未知角色');
    }

    function actorSceneState(actor, run, protagonistId) {
        const runState = (run && run.state) || {};
        const actorStates = runState.actor_states || {};
        const explicit = String(actorStates[actor.character_id] || '');
        if (['idle', 'move', 'talk', 'alert', 'injured', 'interact', 'exit'].includes(explicit)) return explicit;
        const injuries = Array.isArray(runState.injuries) ? runState.injuries : [];
        if (injuries.length && String(actor.character_id) === String(protagonistId || '')) return 'injured';
        if (['high', 'critical', 'severe'].includes(String(runState.risk || '').toLowerCase())) return 'alert';
        return 'idle';
    }

    function rendererLimit(root) {
        if (state.presentationMode === 'text' || state.performancePolicy === 'safe') return 'text';
        if (root && root.dataset.featureSprites === 'false') return 'avatar';
        if (state.performancePolicy === 'smooth') return 'avatar';
        if (state.performancePolicy === 'full') return 'animated_actor';
        return 'static_sprite';
    }

    function assetCharacterEntry(manifest, characterId) {
        const characters = manifest && (manifest.characters || manifest.actors);
        if (Array.isArray(characters)) {
            return characters.find(item => String(item.character_id || item.id || '') === String(characterId)) || null;
        }
        if (characters && typeof characters === 'object') return characters[characterId] || null;
        return null;
    }

    function assetStateEntry(entry, sceneState) {
        if (!entry || typeof entry !== 'object') return null;
        const states = entry.states && typeof entry.states === 'object' ? entry.states : {};
        const candidate = states[sceneState] || states.idle || states.default || entry;
        return typeof candidate === 'string' ? {resource: candidate} : candidate;
    }

    function journeyAssetUrl(pack, resource) {
        const raw = String(resource || '').replace(/\\/g, '/').replace(/^\.\//, '');
        if (!raw || raw.includes('..') || raw.includes(':') || raw.startsWith('/')) return '';
        if (!/^[\p{L}\p{N}_.\-/]+$/u.test(raw)) return '';
        const segments = raw.split('/').filter(Boolean).map(segment => encodeURIComponent(segment));
        return `/terra-journey/asset-packs/${encodeURIComponent(pack.pack_id)}/${encodeURIComponent(pack.version)}/files/${segments.join('/')}`;
    }

    function resolveActorVisual(actor, run, limit, protagonistId) {
        const rank = {text: 0, avatar: 1, static_sprite: 2, animated_actor: 3};
        const sceneState = actorSceneState(actor, run, protagonistId);
        let selected = null;
        state.assetPacks.forEach(pack => {
            if (String(pack.status || '') !== 'available') return;
            const manifest = pack.manifest || {};
            const entry = assetCharacterEntry(manifest, actor.character_id);
            const stateEntry = assetStateEntry(entry, sceneState);
            if (!stateEntry) return;
            const renderer = String(stateEntry.renderer || entry.renderer || manifest.renderer || 'static_sprite');
            if (!(renderer in rank) || rank[renderer] > rank[limit]) return;
            const resource = journeyAssetUrl(pack, stateEntry.resource || stateEntry.file || stateEntry.path);
            if (!resource) return;
            if (!selected || rank[renderer] > rank[selected.renderer]) selected = {renderer, resource, pack_id: pack.pack_id};
        });
        const avatar = typeof window.getCharacterAvatarUrl === 'function'
            ? window.getCharacterAvatarUrl(actor.character_id, actor.role_type || '')
            : '';
        if (selected) return {...selected, sceneState, fallbackAvatar: avatar};
        if (rank[limit] >= rank.avatar && avatar) return {renderer: 'avatar', resource: avatar, sceneState, fallbackAvatar: ''};
        return {renderer: 'text', resource: '', sceneState, fallbackAvatar: ''};
    }

    function renderActorStage(root, campaign, run) {
        const stage = root.querySelector('[data-journey-actor-stage]');
        if (!stage) return;
        const sourceActors = Array.isArray(campaign.actors) && campaign.actors.length ? campaign.actors : [campaign.protagonist].filter(Boolean);
        const protagonistId = String((campaign.protagonist || {}).character_id || '');
        const actorMap = new Map(sourceActors.map(actor => [String(actor.character_id || ''), actor]));
        const encounter = ((run || {}).state || {}).encounter_state || {};
        const initiative = encounter.active && Array.isArray(encounter.initiative_order)
            ? encounter.initiative_order.map(id => actorMap.get(String(id))).filter(Boolean)
            : [];
        const actors = [];
        const pushActor = actor => {
            if (!actor || actors.some(item => String(item.character_id) === String(actor.character_id))) return;
            actors.push(actor);
        };
        if (initiative.length) initiative.forEach(pushActor);
        else {
            pushActor(actorMap.get(protagonistId) || campaign.protagonist);
            sourceActors.forEach(pushActor);
        }
        const limit = rendererLimit(root);
        stage.dataset.rendererLimit = limit;
        stage.dataset.encounter = initiative.length ? 'true' : 'false';
        const acted = new Set(Array.isArray(encounter.acted_actor_ids) ? encounter.acted_actor_ids.map(String) : []);
        stage.innerHTML = actors.slice(0, 12).map((actor, index) => {
            const visual = resolveActorVisual(actor, run, limit, protagonistId);
            const name = actorDisplayName(actor);
            const actorId = String(actor.character_id || '');
            const current = initiative.length && actorId === String(encounter.current_actor_id || '');
            const media = visual.resource
                ? `<img src="${escapeHtml(visual.resource)}" alt="${escapeHtml(name)}" data-journey-stage-image data-fallback-avatar="${escapeHtml(visual.fallbackAvatar || '')}">`
                : `<span class="journey-actor-initial" aria-hidden="true">${escapeHtml(name.slice(0, 1))}</span>`;
            return `<button type="button" class="journey-stage-actor state-${escapeHtml(visual.sceneState)}${current ? ' current' : ''}${acted.has(actorId) ? ' acted' : ''}" data-renderer="${escapeHtml(visual.renderer)}" data-journey-actor-detail="${escapeHtml(actorId)}" aria-label="查看${escapeHtml(name)}的场景状态" title="${escapeHtml(name)}"><div class="journey-actor-visual">${media}${initiative.length ? `<span class="journey-initiative-index">${index + 1}</span>` : ''}</div><span class="journey-actor-name">${escapeHtml(name)}</span></button>`;
        }).join('');
        stage.hidden = !actors.length;
        stage.querySelectorAll('[data-journey-stage-image]').forEach(image => {
            image.addEventListener('error', () => {
                const card = image.closest('.journey-stage-actor');
                const fallback = String(image.dataset.fallbackAvatar || '');
                if (fallback && image.src !== fallback && !image.dataset.fallbackTried) {
                    image.dataset.fallbackTried = 'true';
                    image.src = fallback;
                    if (card) card.dataset.renderer = 'avatar';
                    return;
                }
                image.remove();
                if (card) {
                    card.dataset.renderer = 'text';
                    const initial = document.createElement('span');
                    initial.className = 'journey-actor-initial';
                    initial.setAttribute('aria-hidden', 'true');
                    initial.textContent = (card.querySelector('.journey-actor-name') || {}).textContent?.slice(0, 1) || '·';
                    card.querySelector('.journey-actor-visual').appendChild(initial);
                }
            });
        });
    }

    function statusPreferenceKey() {
        return state.currentCampaignId ? `journey-status-level:${state.currentCampaignId}` : 'journey-status-level';
    }

    function activeViewPreferenceKey() {
        return state.currentCampaignId ? `journey-active-view:${state.currentCampaignId}` : 'journey-active-view';
    }

    function statusLevel() {
        const value = safeStorageGet(statusPreferenceKey(), 'necessary');
        return ['concise', 'necessary', 'detailed'].includes(value) ? value : 'necessary';
    }

    function renderPlayContext(root, run) {
        const data = (run && run.state) || {};
        const level = statusLevel();
        root.dataset.statusLevel = level;
        const context = root.querySelector('[data-journey-inline-context]');
        const warnings = [...(Array.isArray(data.threats) ? data.threats : []), ...(Array.isArray(data.injuries) ? data.injuries : [])];
        const encounter = data.encounter_state || {};
        const contextParts = [data.location || '未知地点', data.time || data.local_time || '时间未定'];
        if (level === 'detailed' && data.weather) contextParts.push(data.weather);
        if (context) context.innerHTML = `<span>${contextParts.map(escapeHtml).join(' · ')}</span>${warnings[0] ? `<strong>${escapeHtml(warnings[0])}</strong>` : ''}`;
        const personal = root.querySelector('[data-journey-personal-status]');
        const objective = root.querySelector('[data-journey-objective]');
        if (personal) {
            const pieces = level === 'concise'
                ? [`风险 ${data.risk || '中'}`]
                : [`补给 ${Number(data.supplies == null ? 100 : data.supplies)}`, `疲劳 ${Number(data.fatigue || 0)}`, `风险 ${data.risk || '中'}`];
            if (level !== 'concise' && encounter.active) pieces.push(`行动 ${actorDisplayName({character_id: encounter.current_actor_id})}`);
            if (level === 'detailed') pieces.push(`警戒 ${Number(data.region_alert || 0)}`, data.infection || '感染未变化');
            personal.textContent = pieces.join(' · ');
        }
        if (objective) {
            const clueCount = Array.isArray(data.open_clues) ? data.open_clues.length : 0;
            objective.textContent = level === 'detailed' && clueCount
                ? `${data.objective || '继续旅程'} · ${clueCount}条线索`
                : data.objective || '继续旅程';
        }
    }

    function availableViews(data) {
        const run = data.run || {};
        const runState = run.state || {};
        const zones = ((data.zone_graph || {}).graph || data.zone_graph || {}).nodes || [];
        const views = [{id: 'narrative', label: '叙事'}];
        if (zones.length) views.push({id: 'map', label: '地图'});
        if ((runState.encounter_state || {}).active) views.push({id: 'encounter', label: '战斗'});
        if (Object.keys(runState.relationship_observations || {}).length) views.push({id: 'relations', label: '关系'});
        if ((data.turns || []).length > 4) views.push({id: 'journal', label: '日志'});
        return views;
    }

    function selectJourneyView(viewId, persist) {
        const root = document.querySelector('[data-journey-play]');
        if (!root) return;
        const available = state.playPayload
            ? availableViews(state.playPayload).map(item => item.id)
            : Array.from(root.querySelectorAll('[data-journey-view]')).map(button => button.dataset.journeyView);
        const next = available.includes(viewId) ? viewId : 'narrative';
        state.activeView = next;
        root.querySelectorAll('[data-journey-view]').forEach(button => {
            const active = button.dataset.journeyView === next;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        root.querySelectorAll('[data-journey-view-panel]').forEach(panel => {
            const active = panel.dataset.journeyViewPanel === next;
            panel.hidden = !active;
            panel.classList.toggle('active', active);
        });
        const primaryToggle = root.querySelector('[data-journey-primary-view-toggle]');
        if (primaryToggle) {
            primaryToggle.classList.toggle('map-active', next === 'map');
            primaryToggle.classList.toggle('secondary-active', !['narrative', 'map'].includes(next));
            primaryToggle.querySelectorAll('[data-journey-primary-view]').forEach(button => {
                const active = button.dataset.journeyPrimaryView === next;
                button.classList.toggle('active', active);
                button.setAttribute('aria-selected', active ? 'true' : 'false');
            });
        }
        if (persist) saveDevicePreference(activeViewPreferenceKey(), next);
    }

    function renderAdaptiveViews(root, data) {
        const views = availableViews(data).slice(0, 4);
        const tabs = root.querySelector('[data-journey-view-tabs]');
        tabs.innerHTML = '';
        const mapButton = root.querySelector('[data-journey-primary-view="map"]');
        if (mapButton) mapButton.disabled = !views.some(item => item.id === 'map');
        const toolGrid = document.querySelector('#journeyToolsSheet .journey-tool-grid');
        if (toolGrid) {
            toolGrid.querySelectorAll('[data-journey-secondary-view]').forEach(button => button.remove());
            const secondary = views.filter(item => ['encounter', 'journal'].includes(item.id));
            secondary.forEach(item => {
                const icon = item.id === 'encounter' ? 'warning' : 'book';
                toolGrid.insertAdjacentHTML('beforeend', `<button type="button" data-journey-view-target="${item.id}" data-journey-secondary-view><span data-zoot-icon="${icon}" aria-hidden="true"></span>${item.label}</button>`);
            });
        }
        const runState = (data.run || {}).state || {};
        const encounter = runState.encounter_state || {};
        const encounterTarget = root.querySelector('[data-journey-encounter]');
        if (encounterTarget) encounterTarget.innerHTML = encounter.active
            ? `<h3>第 ${Number(encounter.round || 0)} 轮</h3><p>当前行动：${escapeHtml(encounter.current_actor_id || '待裁定')}</p><ol>${(encounter.initiative_order || []).map(id => `<li>${escapeHtml(actorDisplayName({character_id: id}))}</li>`).join('')}</ol>`
            : '<div class="journey-empty">当前没有行动轮。</div>';
        const relations = root.querySelector('[data-journey-relations]');
        if (relations) relations.innerHTML = Object.entries(runState.relationship_observations || {}).map(([name, value]) => `<article><strong>${escapeHtml(name)}</strong><p>${escapeHtml(value)}</p></article>`).join('') || '<div class="journey-empty">当前场景没有可观察的关系变化。</div>';
        const journal = root.querySelector('[data-journey-journal]');
        if (journal) journal.innerHTML = (data.turns || []).map((turn, index) => `<article><small>第 ${index + 1} 回合</small><strong>${escapeHtml(turn.action_text)}</strong></article>`).join('');
        const preferred = safeStorageGet(activeViewPreferenceKey(), 'narrative');
        selectJourneyView(preferred, false);
    }

    async function loadPlay() {
        if (!state.currentCampaignId) return;
        if (!state.actors.length) await loadActors();
        if (!state.assetPacks.length) {
            try {
                const packs = await api('/terra-journey/asset-packs');
                state.assetPacks = packs.items || [];
            } catch (_error) {
                state.assetPacks = [];
            }
        }
        const data = await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/enter`, {method: 'POST'});
        const root = document.querySelector('[data-journey-play]');
        if (!root) return;
        state.playPayload = data;
        await loadVisualProposals().catch(() => {
            state.visualProposals = [];
            state.visualAssets = new Map();
        });
        applyPresentation(root);
        document.querySelector('[data-journey-play-title]').textContent = data.campaign.title;
        renderActorStage(root, data.campaign, data.run);
        renderPlayContext(root, data.run);
        const zones = root.querySelector('[data-journey-zones]');
        if (zones) zones.innerHTML = zoneMarkup(data.zone_graph || {});
        renderTurns(root, data.turns || []);
        renderAdaptiveViews(root, data);
        if (window.ZootIcons && typeof window.ZootIcons.hydrate === 'function') window.ZootIcons.hydrate(root);
        loadAdjudications().catch(() => null);
        return data;
    }

    function renderTurns(root, turns) {
        const target = root.querySelector('[data-journey-log]');
        target.innerHTML = turns.map(item => {
            const polish = (item.result || {}).narrative_polish || {};
            const badge = polish.status === 'succeeded'
                ? '<small class="journey-polish-badge">已结合人物语料润色</small>'
                : polish.fallback_used ? '<small class="journey-polish-badge fallback">润色失败，已保留原始正文</small>' : '';
            const generation = (item.result || {}).generation === 'offline_event_card'
                ? `<small class="journey-generation-badge fallback">本地叙事 · ${escapeHtml((((item.result || {}).fallback_reason || {}).message) || '模型暂时不可用')}</small>`
                : '';
            const visuals = state.visualProposals.filter(proposal => String(proposal.turn_id) === String(item.turn_id));
            return `<article class="journey-turn"><div class="journey-turn-action">${escapeHtml(item.action_text)}</div><div class="journey-turn-narrative">${escapeHtml(item.narrative)}</div>${generation}${badge}${visuals.map(visualProposalMarkup).join('')}</article>`;
        }).join('') || '<div class="journey-empty">故事尚未开始。描述主角的第一个行动。</div>';
        target.scrollTop = target.scrollHeight;
        const latest = turns.length ? (turns[turns.length - 1].result || {}) : {};
        renderSuggestions(latest.suggestions || []);
    }

    function renderSuggestions(items) {
        const target = document.querySelector('[data-journey-suggestions]');
        if (!target) return;
        target.innerHTML = items.slice(0, 6).map(item => `<button type="button" data-suggestion="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('');
    }

    const VISUAL_INTENT_LABELS = {
        journey_scene: '正文场景', journey_portrait: '人物肖像', journey_outfit: '衣装展示',
        journey_location: '地点背景', journey_clue: '线索物品', journey_battle: '战斗高光',
        journey_chapter_cover: '章节封面',
    };

    const VISUAL_STATUS_LABELS = {
        candidate: '可配图', planning: '正在整理方案', planned: '方案待确认',
        plan_failed: '方案整理失败', rendering: '正在生成图片', rendered: '已生成',
        render_failed: '图片生成失败', dismissed: '已忽略',
    };

    function visualAsset(assetId) {
        return state.visualAssets instanceof Map ? state.visualAssets.get(String(assetId)) : null;
    }

    function visualProposalMarkup(proposal) {
        const attachments = Array.isArray(proposal.attachments) ? proposal.attachments.filter(item => !item.removed_from_turn) : [];
        const assets = attachments.map(item => visualAsset(item.gallery_asset_id)).filter(Boolean);
        const lead = assets[0];
        const preview = lead
            ? `<img src="${escapeHtml(lead.thumbnail_url || lead.content_url || '')}" alt="${escapeHtml(VISUAL_INTENT_LABELS[proposal.intent] || '故事插图')}" loading="lazy" decoding="async">`
            : `<span data-zoot-icon="camera" aria-hidden="true"></span>`;
        const reasons = ((proposal.trigger || {}).reasons || []).map(item => item.label).filter(Boolean).join(' · ');
        return `<button type="button" class="journey-inline-visual ${lead ? 'has-image' : ''}" data-journey-visual-open="${escapeHtml(proposal.proposal_id)}"><span class="journey-inline-visual-preview">${preview}</span><span><strong>${escapeHtml(VISUAL_INTENT_LABELS[proposal.intent] || '本段配图')}</strong><small>${escapeHtml(VISUAL_STATUS_LABELS[proposal.status] || proposal.status || '可配图')}${assets.length > 1 ? ` · ${assets.length}个变体` : ''}</small>${reasons ? `<small>${escapeHtml(reasons)}</small>` : ''}</span><span data-zoot-icon="next" aria-hidden="true"></span></button>`;
    }

    async function loadVisualProposals() {
        if (!state.currentCampaignId) return [];
        const data = await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/visual-proposals?limit=100`);
        state.visualProposals = data.items || [];
        const ids = Array.from(new Set(state.visualProposals.flatMap(item => (item.attachments || []).map(link => String(link.gallery_asset_id || '')).filter(Boolean))));
        const entries = await Promise.all(ids.map(async assetId => {
            try {
                const payload = await api(`/image-workspace/gallery/${encodeURIComponent(assetId)}`);
                return [assetId, payload.asset || payload];
            } catch (_error) {
                return [assetId, null];
            }
        }));
        state.visualAssets = new Map(entries.filter(([, value]) => value));
        return state.visualProposals;
    }

    function latestTurnId() {
        const turns = (state.playPayload && state.playPayload.turns) || [];
        return turns.length ? String(turns[turns.length - 1].turn_id || '') : '';
    }

    function visualProposalById(proposalId) {
        return state.visualProposals.find(item => String(item.proposal_id) === String(proposalId));
    }

    function visualSheetMarkup(proposal) {
        if (!proposal) {
            return `<p class="journey-visual-help">选择希望为本段建立的配图类型。系统只建立候选，不会自动产生图片费用。</p><div class="journey-visual-intent-grid">${Object.entries(VISUAL_INTENT_LABELS).map(([id, label]) => `<button type="button" data-journey-visual-intent="${id}"><span data-zoot-icon="camera" aria-hidden="true"></span>${escapeHtml(label)}</button>`).join('')}</div><button type="button" data-journey-page="terra-journey-visuals">打开视觉档案</button>`;
        }
        const snapshot = (proposal.snapshot || {}).payload || {};
        const reasons = ((proposal.trigger || {}).reasons || []).map(item => item.label).filter(Boolean).join('、') || '用户手动请求';
        const attachments = (proposal.attachments || []).map(link => visualAsset(link.gallery_asset_id)).filter(Boolean);
        const images = attachments.map(asset => `<button type="button" class="journey-visual-variant" data-journey-visual-asset="${escapeHtml(asset.asset_id)}"><img src="${escapeHtml(asset.thumbnail_url || asset.content_url || '')}" alt="故事插图变体" loading="lazy"><small>${escapeHtml(asset.title || '视觉变体')}</small></button>`).join('');
        const planActions = proposal.status === 'candidate' || proposal.status === 'plan_failed'
            ? `<label class="journey-option-row"><input type="checkbox" data-journey-visual-plan-cost> 我确认自动整理方案会调用一次规划模型并可能计费</label><div class="journey-inline-actions"><button type="button" data-journey-visual-local-plan="${escapeHtml(proposal.proposal_id)}">仅建立本地草稿</button><button type="button" class="journey-primary" data-journey-visual-plan="${escapeHtml(proposal.proposal_id)}">自动整理方案</button></div>`
            : '';
        const renderActions = proposal.status === 'planned' || proposal.status === 'render_failed'
            ? `<label class="journey-option-row"><input type="checkbox" data-journey-visual-render-cost> 我确认本次出图可能产生图片费用</label><div class="journey-inline-actions"><button type="button" data-journey-open-image-workspace="${escapeHtml(proposal.image_plan_id || '')}">编辑完整方案</button><button type="button" class="journey-primary" data-journey-visual-render="${escapeHtml(proposal.proposal_id)}">确认出图</button></div>`
            : '';
        return `<section class="journey-visual-summary"><span>${escapeHtml(VISUAL_STATUS_LABELS[proposal.status] || proposal.status)}</span><strong>${escapeHtml(VISUAL_INTENT_LABELS[proposal.intent] || proposal.intent)}</strong><p>触发原因：${escapeHtml(reasons)}</p><dl><dt>地点</dt><dd>${escapeHtml(snapshot.location || '未明确')}</dd><dt>时间／天气</dt><dd>${escapeHtml([snapshot.time, snapshot.weather].filter(Boolean).join(' · ') || '未明确')}</dd><dt>入镜人物</dt><dd>${escapeHtml((snapshot.actors || []).map(item => item.display_name || item.actor_id).join('、') || '未指定')}</dd></dl></section>${images ? `<div class="journey-visual-variants">${images}</div>` : ''}${planActions}${renderActions}<div class="journey-inline-actions"><button type="button" data-journey-page="terra-journey-visuals">视觉档案</button>${attachments.length ? `<button type="button" data-journey-visual-review="${escapeHtml(proposal.proposal_id)}">智能复核</button>` : ''}<button type="button" data-journey-visual-dismiss="${escapeHtml(proposal.proposal_id)}">隐藏候选</button><button type="button" data-journey-visual-disable-chapter="${escapeHtml(proposal.proposal_id)}">本章不再建议此类图片</button></div>`;
    }

    async function openJourneyVisualSheet(proposalId) {
        if (!state.currentCampaignId) return;
        await loadVisualProposals();
        let proposal = proposalId ? visualProposalById(proposalId) : null;
        if (!proposal) {
            const turnId = latestTurnId();
            proposal = state.visualProposals.find(item => String(item.turn_id) === turnId) || null;
        }
        detailSheet('本段配图', visualSheetMarkup(proposal));
    }

    async function createVisualProposal(intent) {
        const turnId = latestTurnId();
        if (!turnId) {
            toast('完成第一个故事行动后才能建立本段配图', 'error');
            return;
        }
        const data = await api(`/terra-journey/turns/${encodeURIComponent(turnId)}/visual-proposals`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({intent, force: true}),
        });
        await loadVisualProposals();
        openJourneyVisualSheet((data.proposal || {}).proposal_id);
    }

    async function planVisualProposal(proposalId, useModel) {
        const confirmed = !useModel || Boolean(document.querySelector('[data-journey-visual-plan-cost]')?.checked);
        if (!confirmed) {
            toast('请先确认规划模型调用与费用风险', 'error');
            return;
        }
        await api(`/terra-journey/visual-proposals/${encodeURIComponent(proposalId)}/plan`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({use_model: Boolean(useModel), confirmed_planning_cost: Boolean(useModel)}),
        });
        await loadVisualProposals();
        openJourneyVisualSheet(proposalId);
    }

    async function renderVisualProposal(proposalId) {
        if (!document.querySelector('[data-journey-visual-render-cost]')?.checked) {
            toast('请先确认本次图片生成费用', 'error');
            return;
        }
        await api(`/terra-journey/visual-proposals/${encodeURIComponent(proposalId)}/render`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({confirmed_render_cost: true, client_request_id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}),
        });
        await loadVisualProposals();
        openJourneyVisualSheet(proposalId);
    }

    async function reviewVisualProposal(proposalId) {
        const proposal = visualProposalById(proposalId);
        const attachment = (proposal && proposal.attachments || [])[0];
        if (!attachment) return;
        const body = detailSheet('智能视觉复核', `<p>复核会调用一次图片理解模型，只输出问题清单与重试建议，不会自动删除或重画图片。</p><label class="journey-option-row"><input type="checkbox" data-journey-visual-review-cost> 我确认本次复核可能产生费用</label><button type="button" class="journey-primary" data-journey-visual-review-confirm="${escapeHtml(proposalId)}" data-gallery-asset-id="${escapeHtml(attachment.gallery_asset_id)}">开始复核</button>`);
        return body;
    }

    async function suppressVisualProposal(proposalId, chapterOnly) {
        const proposal = visualProposalById(proposalId);
        if (!proposal) return;
        if (chapterOnly) {
            const current = state.visualPolicy || await api(`/terra-journey/campaigns/${encodeURIComponent(proposal.campaign_id)}/visual-policy`);
            const policy = {...(current.policy || {})};
            const chapterRules = {...(policy.chapter_disabled_intents || {})};
            const key = String(proposal.chapter || 1);
            chapterRules[key] = Array.from(new Set([...(chapterRules[key] || []), proposal.intent]));
            policy.chapter_disabled_intents = chapterRules;
            state.visualPolicy = await api(`/terra-journey/campaigns/${encodeURIComponent(proposal.campaign_id)}/visual-policy`, {
                method: 'PUT', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({policy, expected_revision: current.revision}),
            });
        }
        await api(`/terra-journey/visual-proposals/${encodeURIComponent(proposalId)}`, {
            method: 'PATCH', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({status: 'dismissed', dismissed_reason: chapterOnly ? '本章已停用该配图类型' : '用户隐藏候选'}),
        });
        closeJourneySheet('journeyDetailSheet');
        await loadVisualProposals();
        renderTurns((state.playPayload && state.playPayload.turns) || []);
        toast(chapterOnly ? '本章不再自动建议此类图片' : '已隐藏视觉候选');
    }

    async function renderStoryboard() {
        const target = document.querySelector('[data-journey-storyboard]');
        if (!target) return;
        if (!state.currentCampaignId) {
            target.innerHTML = '<div class="journey-empty">请先进入一个故事</div>';
            return;
        }
        target.innerHTML = '<div class="journey-empty">正在整理章节分镜…</div>';
        const data = await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/storyboard`);
        state.visualProposals = Object.values(data.chapters || {}).flat();
        await loadVisualProposals();
        const filter = state.visualFilter || 'all';
        const chapters = Object.entries(data.chapters || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
        target.innerHTML = chapters.map(([chapter, proposals]) => {
            const visible = proposals.filter(item => filter === 'all' || item.intent === filter);
            if (!visible.length) return '';
            return `<section class="journey-storyboard-chapter"><h3>第 ${Number(chapter)} 章</h3><div class="journey-storyboard-grid">${visible.map(visualProposalMarkup).join('')}</div></section>`;
        }).join('') || '<div class="journey-empty">当前筛选下尚无视觉候选。纯文字故事不受影响。</div>';
        if (window.ZootIcons?.hydrate) window.ZootIcons.hydrate(target);
    }

    function zoneMarkup(graph) {
        const payload = graph && graph.graph ? graph.graph : graph;
        const current = String((payload && payload.current_zone_id) || '');
        const nodes = payload && Array.isArray(payload.nodes) ? payload.nodes : [];
        return nodes.map(node => `<article class="journey-zone${node.zone_id === current ? ' current' : ''}"><strong>${escapeHtml(node.name || node.zone_id)}</strong><small>${escapeHtml(node.risk || '未知风险')} · ${Number(node.travel_cost || 0)}补给</small><p>${escapeHtml(node.description || '')}</p></article>`).join('') || '<div class="journey-empty">当前场景尚未建立区域地图；纯文字行动仍可继续。</div>';
    }

    function renderOperationStatus(operation, startedAt) {
        const status = document.querySelector('[data-journey-generation]');
        if (!status) return;
        const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
        const stage = STAGE_LABELS[operation.stage] || operation.stage || '准备中';
        const detail = operation.detail && operation.detail.message ? operation.detail.message : stage;
        status.hidden = false;
        status.innerHTML = `<div class="journey-operation-progress"><span class="journey-operation-pulse" aria-hidden="true"></span><div><strong>${escapeHtml(stage)}</strong><small>${escapeHtml(detail)} · ${elapsed}秒</small></div><button type="button" data-journey-cancel-operation="${escapeHtml(operation.operation_id)}">取消</button></div>`;
    }

    function waitForOperation(operation, startedAt) {
        return new Promise((resolve, reject) => {
            const operationId = operation.operation_id;
            const scope = pageScope('terra-journey-play');
            let source = null;
            let pollTimer = 0;
            let done = false;
            const finish = payload => {
                if (done) return;
                done = true;
                if (source) source.close();
                if (pollTimer) window.clearTimeout(pollTimer);
                if (payload.status === 'completed') resolve(payload);
                else reject(new Error((payload.error && payload.error.message) || `任务${STAGE_LABELS[payload.status] || payload.status}`));
            };
            const consume = payload => {
                state.operation = payload;
                renderOperationStatus(payload, startedAt);
                if (['completed', 'failed', 'cancelled'].includes(payload.status)) finish(payload);
            };
            const poll = async () => {
                try {
                    const payload = await api(`/terra-journey/operations/${encodeURIComponent(operationId)}`);
                    consume(payload);
                    if (!done) pollTimer = window.setTimeout(poll, 500);
                } catch (error) {
                    if (!done) reject(error);
                }
            };
            if (typeof window.EventSource === 'function') {
                source = new EventSource(`/terra-journey/operations/${encodeURIComponent(operationId)}/events`);
                source.addEventListener('progress', event => {
                    try { consume(JSON.parse(event.data)); } catch (_error) { /* ignore malformed progress frame */ }
                });
                source.addEventListener('error', () => {
                    if (done) return;
                    source.close();
                    source = null;
                    poll();
                });
            } else {
                poll();
            }
            scope.cleanups.push(() => {
                if (source) source.close();
                if (pollTimer) window.clearTimeout(pollTimer);
            });
            consume(operation);
        });
    }

    function mergeCompletedOperation(operation, action, campaignId) {
        if (String(state.currentCampaignId || '') !== String(campaignId || '')) return false;
        const envelope = operation && operation.result && typeof operation.result === 'object' ? operation.result : {};
        const result = envelope.result && typeof envelope.result === 'object' ? envelope.result : {};
        const turnId = String(envelope.turn_id || operation.turn_id || '');
        const narrative = String(result.narrative || '').trim();
        if (!turnId || !narrative) return false;
        const turns = Array.isArray(state.playPayload && state.playPayload.turns)
            ? [...state.playPayload.turns]
            : [];
        const turn = {turn_id: turnId, action_text: action, narrative, result};
        const index = turns.findIndex(item => String(item.turn_id || '') === turnId);
        if (index >= 0) turns[index] = {...turns[index], ...turn};
        else turns.push(turn);
        state.playPayload = {...(state.playPayload || {}), turns};
        const root = document.querySelector('[data-journey-play]');
        if (root) renderTurns(root, turns);
        return true;
    }

    async function performAction(form) {
        if (state.pendingRequest) return;
        const textarea = form.querySelector('textarea[name="action"]');
        const action = textarea.value.trim();
        if (!action) return;
        const status = document.querySelector('[data-journey-generation]');
        const button = form.querySelector('button[type="submit"]');
        const startedAt = Date.now();
        const campaignId = String(state.currentCampaignId || '');
        state.pendingRequest = {status: 'submitting'};
        button.disabled = true;
        try {
            const operation = await api(`/terra-journey/campaigns/${encodeURIComponent(campaignId)}/actions`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    action,
                    observe: true,
                    client_request_id: window.crypto && typeof window.crypto.randomUUID === 'function'
                        ? window.crypto.randomUUID()
                        : `${Date.now()}-${Math.random()}`,
                }),
            });
            state.pendingRequest = operation;
            const completed = await waitForOperation(operation, startedAt);
            if (String(state.currentCampaignId || '') !== campaignId) return;
            const rendered = mergeCompletedOperation(completed, action, campaignId);
            let authoritative = null;
            try {
                authoritative = await loadPlay();
            } catch (reloadError) {
                if (!rendered) throw reloadError;
                toast('正文已保存，故事状态将在下次进入时重新同步', 'warning');
            }
            const canonicalTurns = Array.isArray(authoritative && authoritative.turns) ? authoritative.turns : [];
            const completedTurnId = String(((completed.result || {}).turn_id) || completed.turn_id || '');
            const authoritativeRendered = canonicalTurns.some(item => String(item.turn_id || '') === completedTurnId && String(item.narrative || '').trim());
            if (!rendered && !authoritativeRendered) throw new Error('故事回合已结束，但没有读取到可显示的正文；行动草稿已保留');
            textarea.value = '';
            textarea.style.height = '';
        } catch (error) {
            toast(errorMessage(error), 'error');
        } finally {
            state.pendingRequest = null;
            state.operation = null;
            status.hidden = true;
            status.textContent = '';
            button.disabled = false;
        }
    }

    async function loadTrace(targetOverride) {
        if (!state.currentCampaignId) return;
        const data = await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/knowledge-trace?limit=1`);
        const target = targetOverride || document.querySelector('[data-journey-trace]');
        if (!target) return;
        const snapshot = (data.items || [])[0];
        if (!snapshot) {
            target.innerHTML = '<p>完成一次行动后显示知识依据。</p>';
            return;
        }
        const payload = snapshot.payload || {};
        const version = payload.knowledge_version || {};
        const budget = payload.budget || {};
        const labels = {official: '官方事实', campaign_fact: '世界线事实', observed: '已观察状态', planned_setting: '策划设定', unverified: '未证实传闻', ai_proposal: '待确认提案'};
        const header = `<div class="journey-trace-summary"><strong>${escapeHtml(String(version.dimensions || '词法'))}维 · ${escapeHtml(version.platform || 'unknown')}</strong><small>${escapeHtml(String(version.vector_space_id || 'lexical'))}</small><small>使用 ${Number(budget.used_chars || 0)} / ${Number(budget.max_chars || 0)} 字符 · 裁剪 ${Number(budget.omitted_items || 0)} 条</small></div>`;
        target.innerHTML = header + (payload.items || []).map(item => `<article class="journey-trace-item"><small>${escapeHtml(labels[item.authority] || item.authority)} · ${escapeHtml(item.source)} · 相关度 ${Number(item.score || 0).toFixed(3)}</small><p>${escapeHtml(item.content)}</p></article>`).join('');
    }

    async function loadAdjudications() {
        if (!state.currentCampaignId) return;
        const data = await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/adjudications`);
        state.pendingAdjudications = data.items || [];
        const context = document.querySelector('[data-journey-inline-context]');
        if (context && state.pendingAdjudications.length) {
            context.insertAdjacentHTML('beforeend', `<button type="button" class="journey-critical-alert" data-journey-adjudications-open><span data-zoot-icon="warning" aria-hidden="true"></span>${state.pendingAdjudications.length}项永久后果待确认</button>`);
            if (window.ZootIcons && typeof window.ZootIcons.hydrate === 'function') window.ZootIcons.hydrate(context);
        }
    }

    function detailSheet(title, content, origin) {
        const sheet = document.getElementById('journeyDetailSheet');
        if (!sheet) return;
        sheet.dataset.journeySheetOrigin = origin === 'top' ? 'top' : 'bottom';
        const heading = sheet.querySelector('[data-journey-detail-title]');
        const body = sheet.querySelector('[data-journey-detail-body]');
        if (heading) heading.textContent = title;
        if (body) body.innerHTML = content;
        if (window.ZootIcons && typeof window.ZootIcons.hydrate === 'function') window.ZootIcons.hydrate(sheet);
        openJourneySheet('journeyDetailSheet');
        return body;
    }

    function openStatusDetail() {
        if (!state.playPayload) return;
        const body = stateMarkup(state.playPayload.run);
        const levels = `<div class="journey-status-levels" role="group" aria-label="状态显示层级">${[['concise','简洁'],['necessary','必要'],['detailed','详细']].map(([id, label]) => `<button type="button" data-journey-status-level-choice="${id}" class="${statusLevel() === id ? 'active' : ''}">${label}</button>`).join('')}</div>`;
        detailSheet('旅途状态', levels + body, 'top');
    }

    function openObjectiveDetail() {
        const runState = (((state.playPayload || {}).run || {}).state || {});
        const clues = Array.isArray(runState.open_clues) ? runState.open_clues : [];
        const threats = Array.isArray(runState.threats) ? runState.threats : [];
        detailSheet('目标与线索', `<h3>${escapeHtml(runState.objective || '继续旅程')}</h3><h4>开放线索</h4>${clues.map(item => `<p>${escapeHtml(item)}</p>`).join('') || '<p>暂无明确线索</p>'}<h4>未解决威胁</h4>${threats.map(item => `<p>${escapeHtml(item)}</p>`).join('') || '<p>暂无明确威胁</p>'}`);
    }

    function openActorDetail(actorId) {
        if (!state.playPayload) return;
        const campaign = state.playPayload.campaign || {};
        const actor = (campaign.actors || []).find(item => String(item.character_id) === String(actorId)) || (String((campaign.protagonist || {}).character_id) === String(actorId) ? campaign.protagonist : null);
        if (!actor) return;
        const runState = (state.playPayload.run || {}).state || {};
        const sceneState = actorSceneState(actor, state.playPayload.run, (campaign.protagonist || {}).character_id);
        const encounter = runState.encounter_state || {};
        const position = (encounter.initiative_order || []).indexOf(String(actorId));
        detailSheet(actorDisplayName(actor), `<p>场景状态：${escapeHtml(sceneState)}</p>${position >= 0 ? `<p>行动顺序：第 ${position + 1} 位 · 第 ${Number(encounter.round || 0)} 轮</p>` : ''}<p>${escapeHtml((runState.relationship_observations || {})[actorId] || '当前没有额外的可观察关系反应。')}</p>`, 'top');
    }

    function renderAdjudicationDetail() {
        const html = state.pendingAdjudications.map(item => `<article class="journey-proposal" data-adjudication="${escapeHtml(item.adjudication_id)}"><strong>永久后果待确认</strong><p>${escapeHtml(JSON.stringify(item.proposal.state_updates || {}))}</p><div class="journey-proposal-actions"><button data-decision="false">采用替代后果</button><button data-decision="true">确认生效</button></div></article>`).join('') || '<p>当前没有待确认裁定。</p>';
        detailSheet('永久后果裁定', html, 'top');
    }

    async function renderRules() {
        const [data, packs] = await Promise.all([
            api('/terra-journey/rule-packages'),
            api('/terra-journey/asset-packs'),
        ]);
        state.rules = data.items || [];
        state.assetPacks = packs.items || [];
        const target = document.querySelector('[data-journey-rule-list]');
        target.innerHTML = `<h3>已安装规则</h3>${state.rules.map(item => `<article class="journey-rule-card"><strong>${escapeHtml(item.name)} · ${escapeHtml(item.version)}</strong><p>${escapeHtml(item.status)}</p><small>${escapeHtml((item.manifest.modules || []).join(' · '))}</small></article>`).join('')}<h3>本地表现素材包</h3>${state.assetPacks.map(item => `<article class="journey-rule-card"><strong>${escapeHtml(item.name)} · ${escapeHtml(item.version)}</strong><p>${escapeHtml(item.status)}</p><small>${escapeHtml(item.performance_requirement || 'balanced')} · 无脚本本地资源</small></article>`).join('') || '<div class="journey-empty">尚未安装素材包；运行时将使用头像或纯文字。</div>'}`;
    }

    async function initializeSettings() {
        ensureVisualSettingsUi();
        const presentation = document.querySelector('[data-journey-presentation]');
        const performance = document.querySelector('[data-journey-performance]');
        const statusSelect = document.querySelector('[data-journey-status-level]');
        const presentationKey = state.currentCampaignId ? `journey-presentation-mode:${state.currentCampaignId}` : 'journey-presentation-mode';
        const performanceKey = state.currentCampaignId ? `journey-performance-policy:${state.currentCampaignId}` : 'journey-performance-policy';
        if (presentation) presentation.value = safeStorageGet(presentationKey, safeStorageGet('journey-presentation-mode', 'terminal'));
        if (performance) performance.value = safeStorageGet(performanceKey, safeStorageGet('journey-performance-policy', 'auto'));
        if (statusSelect) statusSelect.value = statusLevel();
        let featureGrid = document.querySelector('[data-journey-render-features]');
        if (!featureGrid) {
            featureGrid = document.createElement('section');
            featureGrid.className = 'journey-render-feature-grid';
            featureGrid.dataset.journeyRenderFeatures = 'true';
            featureGrid.innerHTML = `<h3>表现功能</h3>${Object.entries(RENDER_FEATURES).map(([name, label]) => `<label><input type="checkbox" data-journey-render-feature="${name}"> ${escapeHtml(label)}</label>`).join('')}`;
            const displayPanel = document.querySelector('#page-terra-journey-settings [data-settings-panel="display"]');
            if (displayPanel) displayPanel.appendChild(featureGrid);
        }
        featureGrid.querySelectorAll('[data-journey-render-feature]').forEach(input => {
            const suffix = state.currentCampaignId ? `:${state.currentCampaignId}` : '';
            const saved = safeStorageGet(`journey-render-feature:${input.dataset.journeyRenderFeature}${suffix}`, '');
            input.checked = saved === '' ? !['smooth', 'safe'].includes(effectivePerformancePolicy()) : saved === 'true';
        });
        if (!state.currentCampaignId) return;
        const campaign = await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}`);
        state.settings = {...(campaign.settings || {})};
        document.querySelectorAll('[data-journey-setting]').forEach(input => {
            const key = input.dataset.journeySetting;
            if (state.settings[key] != null) {
                if (input.type === 'checkbox') input.checked = Boolean(state.settings[key]);
                else input.value = state.settings[key];
            }
        });
        const polish = state.settings.narrative_polish || {};
        const polishEnabled = document.querySelector('[data-journey-polish-enabled]');
        const polishCost = document.querySelector('[data-journey-polish-cost]');
        const polishCorpus = document.querySelector('[data-journey-polish-corpus]');
        const polishBudget = document.querySelector('[data-journey-polish-budget]');
        if (polishEnabled) polishEnabled.checked = Boolean(polish.enabled);
        if (polishCost) polishCost.checked = Boolean(polish.acknowledge_cost);
        if (polishCorpus) polishCorpus.value = polish.corpus_mode || 'character_and_campaign';
        if (polishBudget) polishBudget.value = Number(polish.max_corpus_chars || 6000);
        const visualRecord = await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/visual-policy`);
        state.visualPolicy = visualRecord;
        const visualPolicy = visualRecord.policy || {};
        document.querySelectorAll('[data-journey-visual-policy]').forEach(input => {
            const key = input.dataset.journeyVisualPolicy;
            if (visualPolicy[key] == null) return;
            if (input.type === 'checkbox') input.checked = Boolean(visualPolicy[key]);
            else input.value = visualPolicy[key];
        });
    }

    function ensureVisualSettingsUi() {
        const tabs = document.querySelector('[data-journey-settings-tabs]');
        if (tabs && !tabs.querySelector('[data-settings-section="visual"]')) {
            tabs.insertAdjacentHTML('beforeend', '<button type="button" data-settings-section="visual">视觉</button>');
        }
        const page = document.querySelector('#page-terra-journey-settings .journey-settings-page');
        if (!page || page.querySelector('[data-settings-panel="visual"]')) return;
        const anchor = page.querySelector('[data-settings-panel="media"]');
        const section = document.createElement('section');
        section.className = 'journey-settings-section';
        section.dataset.settingsPanel = 'visual';
        section.innerHTML = `<h3>视觉生成</h3><div class="journey-visual-route-card"><strong>寻旅视觉导演</strong><p>关键场景先建立可编辑方案；图片始终需要逐次确认。没有可用路由时保留本地候选和ImagePlan。</p><button type="button" data-page="settings-api">检查生图与规划路由</button></div><div class="journey-settings-grid"><label>自动程度<select data-journey-visual-policy="automation"><option value="off">关闭</option><option value="candidate_only">仅候选</option><option value="auto_plan">自动方案</option></select></label><label class="journey-option-row"><input type="checkbox" data-journey-visual-policy="planning_authorized"> 授权关键场景自动调用一次规划模型</label><label>关键场景阈值<input type="number" min="0.2" max="1" step="0.05" data-journey-visual-policy="trigger_threshold"></label><label>冷却回合<input type="number" min="0" max="20" data-journey-visual-policy="cooldown_turns"></label><label>每章方案上限<input type="number" min="0" max="50" data-journey-visual-policy="max_plans_per_chapter"></label><label>每章图片上限<input type="number" min="0" max="50" data-journey-visual-policy="max_renders_per_chapter"></label><label>图片保存质量<select data-journey-visual-policy="image_quality"><option value="standard">标准</option><option value="high">高质量</option><option value="original">保留原图</option></select></label><label>离线保留<select data-journey-visual-policy="offline_retention"><option value="keep_originals">保留原图</option><option value="thumbnails_only">仅缩略图</option><option value="on_demand">按需下载</option></select></label><label>可信设备同步<select data-journey-visual-policy="sync_policy"><option value="metadata_only">仅元数据</option><option value="metadata_and_thumbnails">元数据与缩略图</option><option value="full_media">完整图片</option></select></label><label class="journey-option-row"><input type="checkbox" data-journey-visual-policy="use_actor_references"> 使用角色参考</label><label class="journey-option-row"><input type="checkbox" data-journey-visual-policy="use_outfit_references"> 使用衣装参考</label><label class="journey-option-row"><input type="checkbox" data-journey-visual-policy="use_pinned_references"> 使用手动钉选的视觉基准</label><label class="journey-option-row"><input type="checkbox" data-journey-visual-policy="allow_injury"> 允许表现伤势</label><label class="journey-option-row"><input type="checkbox" data-journey-visual-policy="allow_infection"> 允许表现感染状态</label><label class="journey-option-row"><input type="checkbox" data-journey-visual-policy="allow_battle"> 允许战斗画面</label><label class="journey-option-row"><input type="checkbox" data-journey-visual-policy="allow_text_in_image"> 允许图片文字</label></div><p class="journey-gate-note">授权自动方案不等于授权出图。渲染、变体、重试和智能复核仍会逐次确认。</p><button type="button" data-journey-page="terra-journey-visuals">打开视觉档案</button>`;
        if (anchor) page.insertBefore(section, anchor);
        else page.appendChild(section);
    }

    async function inspectRule() {
        const input = document.querySelector('[data-journey-rule-file]');
        const target = document.querySelector('[data-journey-rule-inspection]');
        if (!input.files || !input.files[0]) {
            target.textContent = '请选择规则文件';
            return;
        }
        const body = new FormData();
        body.append('file', input.files[0]);
        target.textContent = '正在安全检查…';
        try {
            const result = await api('/terra-journey/rule-packages/inspect', {method: 'POST', body});
            state.ruleSource = result.source_text || '';
            state.ruleDraft = result.draft || null;
            const transform = result.conversion_available ? '<label><input type="checkbox" data-rule-cost-confirm> 我确认本次会调用一次Chat模型并可能产生费用</label><button type="button" data-rule-transform>转换为规则草稿</button>' : '';
            const approve = result.draft && result.validation && result.validation.valid ? '<button type="button" class="journey-primary" data-rule-approve>批准写入规则库</button>' : '';
            target.innerHTML = `<p>格式：${escapeHtml(result.format || '声明式规则包')}</p><p>SHA-256：${escapeHtml(result.sha256)}</p><p>${escapeHtml((result.warnings || []).join('；') || '未发现结构风险')}</p>${transform}${approve}<pre>${escapeHtml(JSON.stringify(result.validation || result.draft || {}, null, 2))}</pre>`;
        } catch (error) {
            target.textContent = errorMessage(error);
        }
    }

    async function inspectAssetPack() {
        const input = document.querySelector('[data-journey-asset-file]');
        const target = document.querySelector('[data-journey-asset-inspection]');
        if (!input || !input.files || !input.files[0]) {
            target.textContent = '请选择素材包文件';
            return;
        }
        const body = new FormData();
        body.append('file', input.files[0]);
        target.textContent = '正在检查路径、图片与Manifest…';
        try {
            const result = await api('/terra-journey/asset-packs/inspect', {method: 'POST', body});
            const validation = result.validation || {};
            const issues = [...(validation.errors || []), ...(validation.warnings || [])];
            const action = validation.valid
                ? '<button type="button" class="journey-primary" data-journey-asset-install>安装素材包</button>'
                : '';
            target.innerHTML = `<p><strong>${escapeHtml((result.manifest || {}).name || result.filename)}</strong> · ${Number(result.resource_count || 0)} 个图片资源</p><p>${escapeHtml(issues.join('；') || '安全检查通过')}</p>${action}<details><summary>资源清单</summary><pre>${escapeHtml((result.resources || []).join('\n') || '无二进制资源')}</pre></details>`;
        } catch (error) {
            target.textContent = errorMessage(error);
        }
    }

    async function installAssetPack(button) {
        const input = document.querySelector('[data-journey-asset-file]');
        const target = document.querySelector('[data-journey-asset-inspection]');
        if (!input || !input.files || !input.files[0]) {
            target.textContent = '原素材包文件已不可用，请重新选择';
            return;
        }
        button.disabled = true;
        button.textContent = '正在原子安装…';
        const body = new FormData();
        body.append('file', input.files[0]);
        try {
            const result = await api('/terra-journey/asset-packs/import', {method: 'POST', body});
            target.innerHTML = `<p><strong>${escapeHtml((result.item || {}).name || '素材包')}</strong> 已安装 · ${Number(result.resource_count || 0)} 个资源</p>`;
            await renderRules();
        } catch (error) {
            target.textContent = errorMessage(error);
            button.disabled = false;
            button.textContent = '重试安装';
        }
    }

    async function renderCharacters() {
        const data = await api('/terra-journey/characters');
        const target = document.querySelector('[data-journey-character-list]');
        target.innerHTML = (data.items || []).map(item => `<article class="journey-list-card"><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml((item.profile || {}).background || '尚未填写经历')}</p><small>${escapeHtml(item.character_id)}</small></article>`).join('') || '<div class="journey-empty">尚无寻旅专用角色</div>';
    }

    async function saveCharacter(form) {
        const data = Object.fromEntries(new FormData(form));
        const status = document.querySelector('[data-journey-character-status]');
        status.textContent = '正在保存…';
        try {
            const character = await api('/terra-journey/characters', {
                method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data),
            });
            const file = document.querySelector('[data-journey-character-avatar]').files[0];
            if (file) {
                const body = new FormData();
                body.append('image_type', 'journey_avatar');
                body.append('owner_id', character.character_id);
                body.append('file', file);
                await api('/custom/image/upload', {method: 'POST', body});
            }
            state.actors = [];
            form.reset();
            status.textContent = '已保存；该角色默认仅属于寻旅Campaign';
            await renderCharacters();
        } catch (error) {
            status.textContent = errorMessage(error);
        }
    }

    async function renderPresets() {
        const data = await api('/terra-journey/presets');
        state.presets = data.items || [];
        const target = document.querySelector('[data-journey-preset-list]');
        target.innerHTML = state.presets.map(item => `<article class="journey-preset-card"><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml((item.definition || {}).summary || '')}</p><small>${escapeHtml(item.source)} · r${Number(item.revision)}</small></article>`).join('');
    }

    async function savePreset(form) {
        const fields = Object.fromEntries(new FormData(form));
        const status = document.querySelector('[data-journey-preset-status]');
        try {
            await api('/terra-journey/presets', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({definition: {
                    name: fields.name,
                    summary: fields.summary,
                    opening: fields.opening,
                    region: fields.region,
                    era: fields.era,
                    tone: fields.tone,
                    objective: fields.objective,
                    constraints: {rules: String(fields.constraints || '').split(/\r?\n/).filter(Boolean)},
                }}),
            });
            form.reset();
            status.textContent = '预设已保存为新修订';
            await renderPresets();
        } catch (error) {
            status.textContent = errorMessage(error);
        }
    }

    async function renderGraph() {
        const target = document.querySelector('[data-journey-graph]');
        if (!state.currentCampaignId) {
            target.innerHTML = '<div class="journey-empty">请先选择或进入一个故事</div>';
            return;
        }
        try {
            const [graph, zones, parentUpdate] = await Promise.all([
                api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/graph`),
                api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/zones`),
                api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/parent-update`),
            ]);
            const nodes = graph.nodes || graph.runtime_nodes || [];
            const parentHtml = parentUpdate.has_parent
                ? `<section class="journey-graph-section"><h3>父故事继承</h3><p>${parentUpdate.changed ? `父线已从 r${Number(parentUpdate.from_revision)} 更新到 r${Number(parentUpdate.to_revision)}；只会更新尚未发生的继承快照。` : '父线快照已是最新；已发生历史保持锁定。'}</p>${parentUpdate.changed ? '<button type="button" data-journey-apply-parent>查看差异后应用父线未来更新</button>' : ''}</section>`
                : '';
            target.innerHTML = `${parentHtml}<section class="journey-graph-section"><h3>语义区域地图</h3><div class="journey-zone-grid">${zoneMarkup(zones)}</div></section><section class="journey-graph-section"><h3>故事节点</h3>${nodes.map(item => `<article class="journey-graph-node"><strong>${escapeHtml(item.title || item.id)}</strong><p>${escapeHtml(item.summary || item.description || '')}</p></article>`).join('') || '<article class="journey-graph-node"><strong>动态故事线</strong><p>当前节点随行动逐步建立。检查点与分支仍由StoryRuntime保存。</p></article>'}</section>`;
        } catch (error) {
            target.textContent = errorMessage(error);
        }
    }

    async function renderSync() {
        const target = document.querySelector('[data-journey-sync-list]');
        if (!state.currentCampaignId) {
            target.innerHTML = '<div class="journey-empty">请先进入一个故事</div>';
            return;
        }
        const [data, summary] = await Promise.all([
            api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/sync-proposals`),
            api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/chapter-summary`),
        ]);
        const summaryPayload = summary.summary || summary;
        const summaryHtml = summary.status === 'not_created'
            ? '<section class="journey-summary"><h3>章节回顾</h3><p>结束当前章节时生成本地回顾；生成回顾不会写入静态知识库。</p><button type="button" data-journey-build-summary>生成章节回顾</button></section>'
            : `<section class="journey-summary"><h3>${escapeHtml(summaryPayload.title || '章节回顾')}</h3><p>${escapeHtml(summaryPayload.summary || '')}</p><dl><dt>关键决定</dt><dd>${escapeHtml((summaryPayload.key_decisions || []).join('；') || '暂无')}</dd><dt>未解线索</dt><dd>${escapeHtml((summaryPayload.rumors || []).join('；') || '暂无')}</dd></dl><button type="button" data-journey-next-chapter>开始下一章</button></section>`;
        target.innerHTML = summaryHtml + ((data.items || []).map(item => `<article class="journey-proposal" data-proposal="${escapeHtml(item.proposal_id)}"><strong>${escapeHtml(item.proposal_type)}</strong><p>${escapeHtml(item.payload.content || item.payload.title || '')}</p><small>${escapeHtml(item.status)}</small>${item.status === 'pending' ? '<div class="journey-proposal-actions"><button data-sync-decision="false">拒绝</button><button data-sync-decision="true">批准写入</button></div>' : ''}</article>`).join('') || '<div class="journey-empty">尚未生成章节同步提案</div>');
    }

    async function saveSettings() {
        const values = {};
        if (document.querySelector('[data-journey-polish-enabled]').checked && !document.querySelector('[data-journey-polish-cost]').checked) {
            const status = document.querySelector('[data-journey-settings-status]');
            status.textContent = '启用正文润色前，请先确认额外模型调用与费用风险';
            return;
        }
        document.querySelectorAll('[data-journey-setting]').forEach(input => {
            values[input.dataset.journeySetting] = input.type === 'number' ? Number(input.value) : input.type === 'checkbox' ? input.checked : input.value;
        });
        values.narrative_polish = {
            enabled: Boolean(document.querySelector('[data-journey-polish-enabled]') && document.querySelector('[data-journey-polish-enabled]').checked),
            acknowledge_cost: Boolean(document.querySelector('[data-journey-polish-cost]') && document.querySelector('[data-journey-polish-cost]').checked),
            corpus_mode: document.querySelector('[data-journey-polish-corpus]') ? document.querySelector('[data-journey-polish-corpus]').value : 'character_and_campaign',
            max_corpus_chars: Number(document.querySelector('[data-journey-polish-budget]') ? document.querySelector('[data-journey-polish-budget]').value : 6000),
            preserve_length: true,
        };
        state.settings = values;
        const presentation = document.querySelector('[data-journey-presentation]');
        const performance = document.querySelector('[data-journey-performance]');
        const presentationKey = state.currentCampaignId ? `journey-presentation-mode:${state.currentCampaignId}` : 'journey-presentation-mode';
        const performanceKey = state.currentCampaignId ? `journey-performance-policy:${state.currentCampaignId}` : 'journey-performance-policy';
        if (presentation) saveDevicePreference(presentationKey, presentation.value);
        if (performance) saveDevicePreference(performanceKey, performance.value);
        const statusLevelSelect = document.querySelector('[data-journey-status-level]');
        if (statusLevelSelect) saveDevicePreference(statusPreferenceKey(), statusLevelSelect.value);
        document.querySelectorAll('[data-journey-render-feature]').forEach(input => {
            const suffix = state.currentCampaignId ? `:${state.currentCampaignId}` : '';
            saveDevicePreference(`journey-render-feature:${input.dataset.journeyRenderFeature}${suffix}`, String(input.checked));
        });
        const status = document.querySelector('[data-journey-settings-status]');
        if (!state.currentCampaignId) {
            status.textContent = '已保存为下一份故事的本机草稿默认值';
            return;
        }
        try {
            let campaign = await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}`);
            if (state.visualPolicy) {
                const policy = {...(state.visualPolicy.policy || {})};
                document.querySelectorAll('[data-journey-visual-policy]').forEach(input => {
                    policy[input.dataset.journeyVisualPolicy] = input.type === 'checkbox'
                        ? input.checked
                        : input.type === 'number' ? Number(input.value) : input.value;
                });
                state.visualPolicy = await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/visual-policy`, {
                    method: 'PUT', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({policy, expected_revision: state.visualPolicy.revision}),
                });
                values.visual_generation = state.visualPolicy.policy;
            }
            const media = {...(campaign.media || {})};
            for (const [selector, imageType, key] of [
                ['[data-journey-campaign-avatar]', 'journey_avatar', 'avatar_url'],
                ['[data-journey-campaign-background]', 'journey_background', 'background_url'],
            ]) {
                const input = document.querySelector(selector);
                if (input.files && input.files[0]) {
                    const body = new FormData();
                    body.append('image_type', imageType);
                    body.append('owner_id', state.currentCampaignId);
                    body.append('file', input.files[0]);
                    const uploaded = await api('/custom/image/upload', {method: 'POST', body});
                    media[key] = uploaded.data.url;
                }
            }
            campaign = await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}`, {
                method: 'PATCH', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({expected_revision: campaign.revision, settings: values, media}),
            });
            status.textContent = `已保存 r${campaign.revision}`;
        } catch (error) {
            status.textContent = errorMessage(error);
        }
    }

    async function initializePage(pageId) {
        try {
            state.activePageId = pageId;
            activatePageScope(pageId);
            if (JOURNEY_PAGES.has(pageId)) showDevelopmentNotice();
            if (pageId === 'terra-journey') await loadHome();
            if (pageId === 'terra-journey-builder') await initializeBuilder();
            if (pageId === 'terra-journey-play') await loadPlay();
            if (pageId === 'terra-journey-rules') await renderRules();
            if (pageId === 'terra-journey-character') await renderCharacters();
            if (pageId === 'terra-journey-presets') await renderPresets();
            if (pageId === 'terra-journey-graph') await renderGraph();
            if (pageId === 'terra-journey-sync') await renderSync();
            if (pageId === 'terra-journey-settings') await initializeSettings();
            if (pageId === 'terra-journey-visuals') await renderStoryboard();
            applyPresentation(document.querySelector(`#page-${pageId} [data-journey-home], #page-${pageId} [data-journey-play], #page-${pageId} .journey-page-body`));
        } catch (error) {
            toast(errorMessage(error), 'error');
        }
    }

    function ensureVisualPlayUi() {
        const grid = document.querySelector('#journeyToolsSheet .journey-tool-grid');
        if (grid && !grid.querySelector('[data-journey-visual-camera]')) {
            grid.insertAdjacentHTML('beforeend', '<button type="button" data-journey-visual-camera><span data-zoot-icon="camera" aria-hidden="true"></span>本段配图</button><button type="button" data-journey-page="terra-journey-visuals"><span data-zoot-icon="gallery" aria-hidden="true"></span>视觉档案</button>');
        }
        if (window.ZootIcons?.hydrate) window.ZootIcons.hydrate(document);
    }

    document.addEventListener('click', async event => {
        const sheetClose = event.target.closest('[data-journey-sheet-close]');
        if (sheetClose) {
            const sheet = sheetClose.closest('.bottom-sheet');
            if (sheet && sheet.id) closeJourneySheet(sheet.id);
            return;
        }
        const pageButton = event.target.closest('[data-journey-page]');
        if (pageButton) {
            ['journeyQuickStartSheet', 'journeyToolsSheet', 'journeyDetailSheet'].forEach(closeJourneySheet);
            go(pageButton.dataset.journeyPage);
            return;
        }
        const exit = event.target.closest('[data-journey-exit]');
        if (exit) {
            if (typeof window.goBack === 'function') window.goBack();
            else go('terra-journey');
            return;
        }
        if (event.target.closest('[data-journey-quick-start]')) {
            await prepareQuickStart();
            return;
        }
        if (event.target.closest('[data-journey-quick-confirm]')) {
            await quickStart();
            return;
        }
        if (event.target.closest('[data-journey-create-card]')) {
            go('terra-journey-builder');
            return;
        }
        const statusTab = event.target.closest('[data-journey-status]');
        if (statusTab) {
            state.selectedStatus = statusTab.dataset.journeyStatus || 'all';
            state.selectedCampaignId = '';
            state.selectedCampaignIds.clear();
            state.managementMode = state.selectedStatus === 'deleted';
            await loadHome();
            return;
        }
        if (event.target.closest('[data-journey-favorite-only]')) {
            state.favoriteOnly = !state.favoriteOnly;
            await loadHome();
            return;
        }
        if (event.target.closest('[data-journey-sort-cycle]')) {
            const currentIndex = Math.max(0, CAMPAIGN_SORT_MODES.findIndex(item => item.id === state.sortMode));
            const next = CAMPAIGN_SORT_MODES[(currentIndex + 1) % CAMPAIGN_SORT_MODES.length];
            state.sortMode = next.id;
            saveDevicePreference('journey-campaign-sort-v1', next.id);
            toast(`已切换为${next.label}`);
            await loadHome();
            return;
        }
        if (event.target.closest('[data-journey-management-close]')) {
            state.managementMode = false;
            state.selectedCampaignIds.clear();
            if (state.selectedStatus === 'deleted') state.selectedStatus = 'all';
            await loadHome();
            return;
        }
        if (event.target.closest('[data-journey-select-all]')) {
            const visible = state.campaigns.map(item => String(item.campaign_id));
            if (visible.length && visible.every(identifier => state.selectedCampaignIds.has(identifier))) state.selectedCampaignIds.clear();
            else visible.forEach(identifier => state.selectedCampaignIds.add(identifier));
            await loadHome();
            return;
        }
        const cardQuickAction = event.target.closest('[data-journey-card-quick-action]');
        if (cardQuickAction) {
            event.stopPropagation();
            const campaignId = cardQuickAction.dataset.campaignId;
            if (cardQuickAction.dataset.journeyCardQuickAction === 'delete') confirmSingleCampaignDeletion(campaignId);
            else await executeCampaignAction('restore', [campaignId], {clearSelection: false});
            return;
        }
        const cardSelect = event.target.closest('[data-journey-card-select]');
        if (cardSelect) {
            event.stopPropagation();
            toggleCampaignSelection(cardSelect.dataset.journeyCardSelect);
            return;
        }
        if (event.target.closest('[data-journey-status-menu]')) {
            openCampaignStatusMenu();
            return;
        }
        const statusAction = event.target.closest('[data-journey-status-action]');
        if (statusAction) {
            await executeCampaignBatch(statusAction.dataset.journeyStatusAction);
            return;
        }
        const batch = event.target.closest('[data-journey-batch-action]');
        if (batch) {
            const action = batch.dataset.journeyBatchAction;
            if (action === 'delete') confirmCampaignDeletion();
            else if (action === 'archive') confirmCampaignArchive();
            else await executeCampaignBatch(action);
            return;
        }
        const batchConfirm = event.target.closest('[data-journey-batch-confirm]');
        if (batchConfirm) {
            await executeCampaignBatch(batchConfirm.dataset.journeyBatchConfirm);
            return;
        }
        const singleConfirm = event.target.closest('[data-journey-single-confirm]');
        if (singleConfirm) {
            await executeCampaignAction(singleConfirm.dataset.journeySingleConfirm, [singleConfirm.dataset.campaignId], {clearSelection: false});
            return;
        }
        if (event.target.closest('[data-journey-tools-open]')) {
            openJourneySheet('journeyToolsSheet');
            return;
        }
        const primaryView = event.target.closest('[data-journey-primary-view]');
        if (primaryView) {
            selectJourneyView(primaryView.dataset.journeyPrimaryView, true);
            return;
        }
        if (event.target.closest('[data-journey-visual-camera]')) {
            closeJourneySheet('journeyToolsSheet');
            await openJourneyVisualSheet();
            return;
        }
        const visualOpen = event.target.closest('[data-journey-visual-open]');
        if (visualOpen) {
            await openJourneyVisualSheet(visualOpen.dataset.journeyVisualOpen);
            return;
        }
        const visualIntent = event.target.closest('[data-journey-visual-intent]');
        if (visualIntent) {
            await createVisualProposal(visualIntent.dataset.journeyVisualIntent);
            return;
        }
        const localPlan = event.target.closest('[data-journey-visual-local-plan]');
        if (localPlan) {
            localPlan.disabled = true;
            try { await planVisualProposal(localPlan.dataset.journeyVisualLocalPlan, false); }
            catch (error) { toast(errorMessage(error), 'error'); localPlan.disabled = false; }
            return;
        }
        const modelPlan = event.target.closest('[data-journey-visual-plan]');
        if (modelPlan) {
            modelPlan.disabled = true;
            try { await planVisualProposal(modelPlan.dataset.journeyVisualPlan, true); }
            catch (error) { toast(errorMessage(error), 'error'); modelPlan.disabled = false; }
            return;
        }
        const renderVisual = event.target.closest('[data-journey-visual-render]');
        if (renderVisual) {
            renderVisual.disabled = true;
            try { await renderVisualProposal(renderVisual.dataset.journeyVisualRender); }
            catch (error) { toast(errorMessage(error), 'error'); renderVisual.disabled = false; }
            return;
        }
        const reviewVisual = event.target.closest('[data-journey-visual-review]');
        if (reviewVisual) {
            await reviewVisualProposal(reviewVisual.dataset.journeyVisualReview);
            return;
        }
        const dismissVisual = event.target.closest('[data-journey-visual-dismiss]');
        if (dismissVisual) {
            try { await suppressVisualProposal(dismissVisual.dataset.journeyVisualDismiss, false); }
            catch (error) { toast(errorMessage(error), 'error'); }
            return;
        }
        const disableChapterVisual = event.target.closest('[data-journey-visual-disable-chapter]');
        if (disableChapterVisual) {
            try { await suppressVisualProposal(disableChapterVisual.dataset.journeyVisualDisableChapter, true); }
            catch (error) { toast(errorMessage(error), 'error'); }
            return;
        }
        const confirmReview = event.target.closest('[data-journey-visual-review-confirm]');
        if (confirmReview) {
            if (!document.querySelector('[data-journey-visual-review-cost]')?.checked) {
                toast('请先确认图片理解调用与费用风险', 'error');
                return;
            }
            confirmReview.disabled = true;
            try {
                await api(`/terra-journey/visual-proposals/${encodeURIComponent(confirmReview.dataset.journeyVisualReviewConfirm)}/review`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({confirmed_review_cost: true, gallery_asset_id: confirmReview.dataset.galleryAssetId}),
                });
                detailSheet('智能视觉复核', '<p>复核任务已提交。结果只提供问题清单和重试建议，不会自动修改图片或故事。</p>');
            } catch (error) { toast(errorMessage(error), 'error'); confirmReview.disabled = false; }
            return;
        }
        const openWorkspace = event.target.closest('[data-journey-open-image-workspace]');
        if (openWorkspace) {
            safeStorageSet('zoot-image-workspace-plan-id', openWorkspace.dataset.journeyOpenImageWorkspace || '');
            closeJourneySheet('journeyDetailSheet');
            go('image-workspace');
            return;
        }
        const visualFilter = event.target.closest('[data-journey-visual-filter]');
        if (visualFilter) {
            state.visualFilter = visualFilter.dataset.journeyVisualFilter || 'all';
            document.querySelectorAll('[data-journey-visual-filter]').forEach(button => button.classList.toggle('active', button === visualFilter));
            await renderStoryboard();
            return;
        }
        const visualAssetButton = event.target.closest('[data-journey-visual-asset]');
        if (visualAssetButton) {
            const asset = visualAsset(visualAssetButton.dataset.journeyVisualAsset);
            if (!asset) return;
            const proposal = state.visualProposals.find(item => (item.attachments || []).some(link => String(link.gallery_asset_id) === String(asset.asset_id)));
            const actors = ((proposal || {}).snapshot || {}).payload?.actors || [];
            detailSheet('视觉基准与变体', `<img class="journey-visual-detail-image" src="${escapeHtml(asset.content_url || asset.thumbnail_url || '')}" alt="故事视觉变体"><p>只有手动钉选后，这张图才会参与后续视觉连续性。</p><div class="journey-inline-actions"><button type="button" data-journey-visual-apply="turn_primary" data-proposal-id="${escapeHtml((proposal || {}).proposal_id || '')}" data-asset-id="${escapeHtml(asset.asset_id)}">设为回合主图</button><button type="button" data-journey-visual-apply="chapter_cover" data-proposal-id="${escapeHtml((proposal || {}).proposal_id || '')}" data-asset-id="${escapeHtml(asset.asset_id)}">设为章节封面</button><button type="button" data-journey-visual-apply="campaign_background" data-proposal-id="${escapeHtml((proposal || {}).proposal_id || '')}" data-asset-id="${escapeHtml(asset.asset_id)}">设为故事卡背景</button></div><div class="journey-inline-actions">${actors.map(actor => `<button type="button" data-journey-visual-pin="actor" data-proposal-id="${escapeHtml((proposal || {}).proposal_id || '')}" data-asset-id="${escapeHtml(asset.asset_id)}" data-target-id="${escapeHtml(actor.actor_id || '')}">钉为${escapeHtml(actor.display_name || actor.actor_id)}外貌参考</button>`).join('')}<button type="button" data-journey-visual-pin="location" data-proposal-id="${escapeHtml((proposal || {}).proposal_id || '')}" data-asset-id="${escapeHtml(asset.asset_id)}" data-target-id="${escapeHtml((((proposal || {}).snapshot || {}).payload || {}).location || 'current')}">钉为地点参考</button><button type="button" data-journey-visual-pin="chapter_style" data-proposal-id="${escapeHtml((proposal || {}).proposal_id || '')}" data-asset-id="${escapeHtml(asset.asset_id)}" data-target-id="${Number((proposal || {}).chapter || 1)}">钉为本章风格</button></div>`);
            return;
        }
        const pinVisual = event.target.closest('[data-journey-visual-pin]');
        if (pinVisual) {
            try {
                await api(`/terra-journey/visual-assets/${encodeURIComponent(pinVisual.dataset.assetId)}/pin`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({proposal_id: pinVisual.dataset.proposalId, scope: pinVisual.dataset.journeyVisualPin, target_id: pinVisual.dataset.targetId}),
                });
                toast('已保存为当前分支的视觉基准');
                await renderStoryboard();
            } catch (error) { toast(errorMessage(error), 'error'); }
            return;
        }
        const applyVisual = event.target.closest('[data-journey-visual-apply]');
        if (applyVisual) {
            applyVisual.disabled = true;
            try {
                await api(`/terra-journey/visual-assets/${encodeURIComponent(applyVisual.dataset.assetId)}/apply`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({proposal_id: applyVisual.dataset.proposalId, target: applyVisual.dataset.journeyVisualApply}),
                });
                toast('故事图片应用位置已更新');
                await loadVisualProposals();
            } catch (error) { toast(errorMessage(error), 'error'); applyVisual.disabled = false; }
            return;
        }
        const view = event.target.closest('[data-journey-view]');
        if (view) {
            selectJourneyView(view.dataset.journeyView, true);
            return;
        }
        const viewTarget = event.target.closest('[data-journey-view-target]');
        if (viewTarget) {
            closeJourneySheet('journeyToolsSheet');
            selectJourneyView(viewTarget.dataset.journeyViewTarget, true);
            return;
        }
        if (event.target.closest('[data-journey-status-open]')) {
            closeJourneySheet('journeyToolsSheet');
            openStatusDetail();
            return;
        }
        if (event.target.closest('[data-journey-objective-open]')) {
            closeJourneySheet('journeyToolsSheet');
            openObjectiveDetail();
            return;
        }
        const actorDetail = event.target.closest('[data-journey-actor-detail]');
        if (actorDetail) {
            openActorDetail(actorDetail.dataset.journeyActorDetail);
            return;
        }
        const levelChoice = event.target.closest('[data-journey-status-level-choice]');
        if (levelChoice) {
            saveDevicePreference(statusPreferenceKey(), levelChoice.dataset.journeyStatusLevelChoice);
            if (state.playPayload) renderPlayContext(document.querySelector('[data-journey-play]'), state.playPayload.run);
            openStatusDetail();
            return;
        }
        if (event.target.closest('[data-journey-trace-open]')) {
            closeJourneySheet('journeyToolsSheet');
            const body = detailSheet('本段知识依据', '<p>正在读取本轮使用的来源…</p>');
            try { await loadTrace(body); } catch (error) { if (body) body.textContent = errorMessage(error); }
            return;
        }
        if (event.target.closest('[data-journey-adjudications-open]')) {
            renderAdjudicationDetail();
            return;
        }
        const settingsTab = event.target.closest('[data-settings-section]');
        if (settingsTab && settingsTab.closest('[data-journey-settings-tabs]')) {
            const section = settingsTab.dataset.settingsSection;
            document.querySelectorAll('[data-journey-settings-tabs] [data-settings-section]').forEach(button => button.classList.toggle('active', button.dataset.settingsSection === section));
            document.querySelectorAll('#page-terra-journey-settings [data-settings-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.settingsPanel === section));
            return;
        }
        const extension = event.target.closest('.extension-item[data-page="terra-journey"]');
        if (extension) window.setTimeout(() => initializePage('terra-journey'), 0);
        const guideOpen = event.target.closest('[data-journey-guide-open]');
        if (guideOpen) {
            renderExplorerGuide(document.querySelector('[data-journey-home]'), true);
            document.querySelector('[data-journey-guide-card]')?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
        }
        const guideDismiss = event.target.closest('[data-journey-guide-dismiss]');
        if (guideDismiss) {
            guideDismiss.closest('[data-journey-guide-card]')?.remove();
            state.guideDismissed = true;
            saveDevicePreference('zoot-terra-journey-guide-v1', 'dismissed');
            return;
        }
        const assetInstall = event.target.closest('[data-journey-asset-install]');
        if (assetInstall) await installAssetPack(assetInstall);
        const cancelOperation = event.target.closest('[data-journey-cancel-operation]');
        if (cancelOperation) {
            cancelOperation.disabled = true;
            try {
                await api(`/terra-journey/operations/${encodeURIComponent(cancelOperation.dataset.journeyCancelOperation)}/cancel`, {method: 'POST'});
            } catch (error) {
                toast(errorMessage(error), 'error');
                cancelOperation.disabled = false;
            }
        }
        const buildSummary = event.target.closest('[data-journey-build-summary]');
        if (buildSummary) {
            buildSummary.disabled = true;
            try {
                await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/chapter-summary`, {method: 'POST'});
                await renderSync();
            } catch (error) { toast(errorMessage(error), 'error'); buildSummary.disabled = false; }
        }
        const nextChapter = event.target.closest('[data-journey-next-chapter]');
        if (nextChapter) {
            nextChapter.disabled = true;
            try {
                const campaign = await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}`);
                await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/next-chapter`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({expected_revision: campaign.revision})});
                await openCampaign(state.currentCampaignId);
            } catch (error) { toast(errorMessage(error), 'error'); nextChapter.disabled = false; }
        }
        const applyParent = event.target.closest('[data-journey-apply-parent]');
        if (applyParent) {
            applyParent.disabled = true;
            try {
                const campaign = await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}`);
                await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/parent-update`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({expected_revision: campaign.revision})});
                toast('父线未来状态已更新；既有章节和检定未被改写');
                await renderGraph();
            } catch (error) { toast(errorMessage(error), 'error'); applyParent.disabled = false; }
        }
        const card = event.target.closest('.journey-card[data-campaign-id]');
        if (card && !event.target.closest('[data-journey-edit], [data-journey-favorite], [data-journey-card-select], [data-journey-card-quick-action], [data-journey-drag-handle]')) {
            if (Date.now() < Number(state.suppressCardClickUntil || 0)) return;
            if (state.managementMode || state.selectedStatus === 'deleted') {
                toggleCampaignSelection(card.dataset.campaignId);
                return;
            }
            state.selectedCampaignId = state.selectedCampaignId === card.dataset.campaignId ? '' : card.dataset.campaignId;
            document.querySelectorAll('.journey-card').forEach(item => item.classList.toggle('selected', item.dataset.campaignId === state.selectedCampaignId));
            updateEnterButton();
        }
        const edit = event.target.closest('[data-journey-edit]');
        if (edit) {
            event.stopPropagation();
            state.currentCampaignId = edit.dataset.journeyEdit;
            go('terra-journey-settings');
        }
        const favorite = event.target.closest('[data-journey-favorite]');
        if (favorite) {
            event.stopPropagation();
            favorite.disabled = true;
            try {
                const campaign = await api(`/terra-journey/campaigns/${encodeURIComponent(favorite.dataset.journeyFavorite)}`);
                await api(`/terra-journey/campaigns/${encodeURIComponent(campaign.campaign_id)}`, {
                    method: 'PATCH', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({expected_revision: campaign.revision, favorite: !campaign.favorite}),
                });
                await loadHome();
            } catch (error) { toast(errorMessage(error), 'error'); favorite.disabled = false; }
        }
        const suggestion = event.target.closest('[data-suggestion]');
        if (suggestion) document.querySelector('[data-journey-action-form] textarea').value = suggestion.dataset.suggestion;
        const adjudication = event.target.closest('[data-adjudication] [data-decision]');
        if (adjudication) {
            const owner = adjudication.closest('[data-adjudication]');
            await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/adjudications/${encodeURIComponent(owner.dataset.adjudication)}/decision`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({approve: adjudication.dataset.decision === 'true'})});
            await loadPlay();
        }
        const syncDecision = event.target.closest('[data-proposal] [data-sync-decision]');
        if (syncDecision) {
            const owner = syncDecision.closest('[data-proposal]');
            await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/sync-proposals/${encodeURIComponent(owner.dataset.proposal)}/decision`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({approve: syncDecision.dataset.syncDecision === 'true'})});
            await renderSync();
        }
        const transformRule = event.target.closest('[data-rule-transform]');
        if (transformRule) {
            const confirmed = document.querySelector('[data-rule-cost-confirm]');
            if (!confirmed || !confirmed.checked) {
                toast('请先确认一次模型调用与费用风险', 'error');
                return;
            }
            transformRule.disabled = true;
            transformRule.textContent = '正在转换，不会自动重试…';
            try {
                const file = document.querySelector('[data-journey-rule-file]').files[0];
                const result = await api('/terra-journey/rule-packages/transform', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({source_text: state.ruleSource, filename: file ? file.name : 'rules.pdf', acknowledge_cost: true}),
                });
                state.ruleDraft = result.draft;
                const target = document.querySelector('[data-journey-rule-inspection]');
                target.innerHTML = `<p>${result.validation.valid ? '转换完成，可批准写入' : '转换完成，但仍需修正规则'}</p><pre>${escapeHtml(JSON.stringify(result.validation, null, 2))}</pre>${result.validation.valid ? '<button type="button" class="journey-primary" data-rule-approve>批准写入规则库</button>' : ''}`;
            } catch (error) {
                toast(errorMessage(error), 'error');
                transformRule.disabled = false;
                transformRule.textContent = '转换为规则草稿';
            }
        }
        const approveRule = event.target.closest('[data-rule-approve]');
        if (approveRule && state.ruleDraft) {
            approveRule.disabled = true;
            try {
                await api('/terra-journey/rule-packages', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(state.ruleDraft)});
                toast('规则包已批准写入');
                await renderRules();
            } catch (error) {
                toast(errorMessage(error), 'error');
                approveRule.disabled = false;
            }
        }
    });

    function cancelCardGesture() {
        const gesture = state.cardGesture;
        if (!gesture) return;
        if (gesture.timer) window.clearTimeout(gesture.timer);
        if (gesture.card) gesture.card.classList.remove('dragging');
        document.querySelectorAll('.journey-card.drag-target').forEach(card => card.classList.remove('drag-target'));
        state.cardGesture = null;
    }

    function enterCampaignManagement(card) {
        if (!card || card.dataset.deleted === 'true') return;
        const identifier = String(card.dataset.campaignId || '');
        if (!identifier) return;
        state.managementMode = true;
        state.selectedCampaignId = '';
        state.selectedCampaignIds.add(identifier);
        state.suppressCardClickUntil = Date.now() + 700;
        const grid = card.closest('[data-journey-cards]');
        if (grid) {
            grid.classList.add('management-mode');
            const createCard = grid.querySelector('[data-journey-create-card]');
            if (createCard) createCard.hidden = true;
        }
        card.classList.add('batch-selected');
        const select = card.querySelector('[data-journey-card-select]');
        if (select) select.setAttribute('aria-pressed', 'true');
        renderCampaignManagement(document.querySelector('[data-journey-home]'));
        updateEnterButton();
    }

    function reorderCardElement(gesture, clientX, clientY) {
        const target = document.elementFromPoint(clientX, clientY)?.closest('.journey-card[data-campaign-id]');
        if (!target || target === gesture.card || target.dataset.deleted === 'true') return;
        const cards = Array.from(gesture.grid.querySelectorAll('.journey-card[data-campaign-id]'));
        const sourceIndex = cards.indexOf(gesture.card);
        const targetIndex = cards.indexOf(target);
        if (sourceIndex < 0 || targetIndex < 0) return;
        target.classList.add('drag-target');
        gesture.grid.querySelectorAll('.journey-card.drag-target').forEach(card => {
            if (card !== target) card.classList.remove('drag-target');
        });
        if (sourceIndex < targetIndex) gesture.grid.insertBefore(gesture.card, target.nextSibling);
        else gesture.grid.insertBefore(gesture.card, target);
        const scrollHost = gesture.grid.closest('.journey-page-body');
        if (scrollHost) {
            const bounds = scrollHost.getBoundingClientRect();
            if (clientY < bounds.top + 54) scrollHost.scrollBy({top: -18, behavior: 'auto'});
            else if (clientY > bounds.bottom - 54) scrollHost.scrollBy({top: 18, behavior: 'auto'});
        }
    }

    async function finishCardDrag(gesture) {
        const identifiers = Array.from(gesture.grid.querySelectorAll('.journey-card[data-campaign-id]'))
            .map(card => String(card.dataset.campaignId || ''))
            .filter(Boolean);
        const byId = new Map(state.campaigns.map(item => [String(item.campaign_id), item]));
        state.campaigns = identifiers.map(identifier => byId.get(identifier)).filter(Boolean);
        try {
            await persistCampaignOrder();
            await loadHome();
        } catch (error) {
            toast(errorMessage(error), 'error');
            await loadHome();
        }
    }

    function bindCampaignGestures() {
        document.addEventListener('pointerdown', event => {
            const card = event.target.closest && event.target.closest('.journey-card[data-campaign-id]');
            if (!card || !card.closest('[data-journey-home]')) return;
            const handle = event.target.closest('[data-journey-drag-handle]');
            const interactive = event.target.closest('button, input, select, textarea, a');
            if (handle) {
                event.preventDefault();
                state.cardGesture = {
                    type: 'drag', pointerId: event.pointerId, card,
                    grid: card.closest('[data-journey-cards]'), startX: event.clientX,
                    startY: event.clientY, active: false,
                };
                try { handle.setPointerCapture(event.pointerId); } catch (_error) { /* optional */ }
                return;
            }
            if (interactive || state.managementMode || state.selectedStatus === 'deleted') return;
            const gesture = {
                type: 'manage', pointerId: event.pointerId, card,
                startX: event.clientX, startY: event.clientY, timer: 0,
            };
            gesture.timer = window.setTimeout(() => {
                if (state.cardGesture !== gesture) return;
                gesture.longPressed = true;
                enterCampaignManagement(card);
            }, 550);
            state.cardGesture = gesture;
        });
        document.addEventListener('pointermove', event => {
            const gesture = state.cardGesture;
            if (!gesture || gesture.pointerId !== event.pointerId) return;
            const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
            if (gesture.type === 'manage') {
                if (distance > 8 && !gesture.longPressed) cancelCardGesture();
                return;
            }
            if (distance <= 6 && !gesture.active) return;
            event.preventDefault();
            if (!gesture.active) {
                gesture.active = true;
                gesture.card.classList.add('dragging');
                state.sortMode = 'manual';
                saveDevicePreference('journey-campaign-sort-v1', 'manual');
            }
            reorderCardElement(gesture, event.clientX, event.clientY);
        }, {passive: false});
        const finish = event => {
            const gesture = state.cardGesture;
            if (!gesture || gesture.pointerId !== event.pointerId) return;
            const shouldPersist = gesture.type === 'drag' && gesture.active;
            cancelCardGesture();
            if (shouldPersist) finishCardDrag(gesture);
        };
        document.addEventListener('pointerup', finish);
        document.addEventListener('pointercancel', finish);
        document.addEventListener('keydown', event => {
            const handle = event.target.closest && event.target.closest('[data-journey-drag-handle]');
            if (handle && ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
                event.preventDefault();
                const card = handle.closest('.journey-card[data-campaign-id]');
                state.sortMode = 'manual';
                saveDevicePreference('journey-campaign-sort-v1', 'manual');
                moveCampaign(card && card.dataset.campaignId, ['ArrowLeft', 'ArrowUp'].includes(event.key) ? 'previous' : 'next');
                return;
            }
            const card = event.target.closest && event.target.closest('.journey-card[data-campaign-id]');
            if (card && event.shiftKey && event.key === 'Enter') {
                event.preventDefault();
                enterCampaignManagement(card);
            }
        });
    }

    function bindJourneyUi() {
        if (state.bound) return;
        state.bound = true;
        bindCampaignGestures();
        if (!window.__zootJourneyBackWrapped && typeof window.handleBackPress === 'function') {
            const originalBackPress = window.handleBackPress;
            window.handleBackPress = function (...args) {
                const homePage = document.getElementById('page-terra-journey');
                if (state.managementMode && homePage && homePage.classList.contains('active')) {
                    state.managementMode = false;
                    state.selectedCampaignIds.clear();
                    if (state.selectedStatus === 'deleted') state.selectedStatus = 'all';
                    loadHome().catch(error => toast(errorMessage(error), 'error'));
                    return true;
                }
                return originalBackPress.apply(this, args);
            };
            window.__zootJourneyBackWrapped = true;
        }
        journeyKeyboardViewportController.init();
        ensureVisualPlayUi();
        document.addEventListener('pageShown', event => {
            const pageId = event.detail && event.detail.pageId;
            if (JOURNEY_PAGES.has(pageId)) {
                if (state.activePageId !== pageId) initializePage(pageId);
            } else {
                state.activePageId = '';
                JOURNEY_PAGES.forEach(disposePage);
            }
        });
        const home = document.querySelector('[data-journey-home]');
        if (home) {
            home.querySelector('[data-journey-enter]').addEventListener('click', () => state.selectedCampaignId ? openCampaign(state.selectedCampaignId) : go('terra-journey-builder'));
            let searchTimer = 0;
            home.querySelector('[data-journey-search]').addEventListener('input', () => {
                window.clearTimeout(searchTimer);
                searchTimer = window.setTimeout(loadHome, 220);
            });
        }
        const quickUseLlm = document.querySelector('[data-journey-quick-use-llm]');
        if (quickUseLlm) quickUseLlm.addEventListener('change', () => {
            const note = document.querySelector('[data-journey-quick-cost]');
            if (!note) return;
            note.textContent = quickUseLlm.checked
                ? '将通过当前Chat能力路由调用一次模型整理蓝图；确认后可能产生费用。'
                : '默认使用本地蓝图，不会产生模型费用。';
        });
        const quickSource = document.querySelector('[data-journey-quick-source]');
        if (quickSource) quickSource.addEventListener('change', () => updateQuickStartSource(document.getElementById('journeyQuickStartSheet')));
        document.querySelectorAll('[data-journey-builder] [data-stage]').forEach(button => button.addEventListener('click', () => setBuilderStage(button.dataset.stage)));
        const builder = document.querySelector('[data-journey-builder]');
        if (builder) {
            builder.addEventListener('input', scheduleBuilderDraftSave);
            builder.addEventListener('change', scheduleBuilderDraftSave);
        }
        const previous = document.querySelector('[data-builder-prev]');
        const next = document.querySelector('[data-builder-next]');
        if (previous) previous.addEventListener('click', () => setBuilderStage(state.builderStage - 1));
        if (next) next.addEventListener('click', async () => {
            try {
                if (state.builderStage === 4) await createFromBuilder();
                else setBuilderStage(state.builderStage + 1);
            } catch (error) {
                toast(errorMessage(error), 'error');
            }
        });
        const randomize = document.querySelector('[data-builder-randomize]');
        if (randomize) randomize.addEventListener('click', () => generateBlueprint().catch(error => toast(errorMessage(error), 'error')));
        const graphButton = document.querySelector('[data-builder-open-graph]');
        if (graphButton) graphButton.addEventListener('click', () => {
            state.currentCampaignId = document.querySelector('[data-builder-parent]').value;
            go('terra-journey-graph');
        });
        const actionForm = document.querySelector('[data-journey-action-form]');
        if (actionForm) {
            actionForm.addEventListener('submit', event => {event.preventDefault(); performAction(actionForm);});
            const textarea = actionForm.querySelector('textarea');
            let composing = false;
            let resizeFrame = 0;
            const resize = () => {
                if (composing) return;
                window.cancelAnimationFrame(resizeFrame);
                resizeFrame = window.requestAnimationFrame(() => {
                    textarea.style.height = 'auto';
                    textarea.style.height = `${Math.min(144, Math.max(40, textarea.scrollHeight))}px`;
                });
            };
            textarea.addEventListener('compositionstart', () => { composing = true; });
            textarea.addEventListener('compositionend', () => { composing = false; resize(); });
            textarea.addEventListener('input', resize);
        }
        const rollButton = document.querySelector('[data-journey-roll]');
        if (rollButton) rollButton.addEventListener('click', async () => {
            const expression = '1d20';
            try {
                const result = await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/roll`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({expression, reason: '用户主动检定'})});
                toast(`${expression} = ${result.total}`);
            } catch (error) { toast(errorMessage(error), 'error'); }
        });
        const checkpoint = document.querySelector('[data-journey-checkpoint]');
        if (checkpoint) checkpoint.addEventListener('click', async () => {
            try { await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/checkpoints`, {method: 'POST'}); toast('检查点已建立'); }
            catch (error) { toast(errorMessage(error), 'error'); }
        });
        const characterForm = document.querySelector('[data-journey-character-form]');
        if (characterForm) characterForm.addEventListener('submit', event => {event.preventDefault(); saveCharacter(characterForm);});
        const presetForm = document.querySelector('[data-journey-preset-form]');
        if (presetForm) presetForm.addEventListener('submit', event => {event.preventDefault(); savePreset(presetForm);});
        const builderPreset = document.querySelector('[data-builder-preset]');
        if (builderPreset) builderPreset.addEventListener('change', () => applySelectedPreset(true));
        document.querySelectorAll('[data-journey-builder] input[name="journey-source"]').forEach(input => {
            input.addEventListener('change', () => {
                if (input.checked && (input.value === 'preset' || input.value === 'preset_random')) {
                    applySelectedPreset(false);
                }
            });
        });
        const inspect = document.querySelector('[data-journey-rule-inspect]');
        if (inspect) inspect.addEventListener('click', inspectRule);
        const inspectAsset = document.querySelector('[data-journey-asset-inspect]');
        if (inspectAsset) inspectAsset.addEventListener('click', inspectAssetPack);
        const proposalButton = document.querySelector('[data-journey-create-proposals]');
        if (proposalButton) proposalButton.addEventListener('click', async () => {
            try { await api(`/terra-journey/campaigns/${encodeURIComponent(state.currentCampaignId)}/sync-proposals`, {method: 'POST'}); await renderSync(); }
            catch (error) { toast(errorMessage(error), 'error'); }
        });
        const settingsButton = document.querySelector('[data-journey-settings-save]');
        if (settingsButton) settingsButton.addEventListener('click', saveSettings);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindJourneyUi, {once: true});
    else bindJourneyUi();

    window.TerraJourney = {state, initializePage, openCampaign};
})();
