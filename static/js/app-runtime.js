(function bootstrapZootRuntime(global) {
    'use strict';

    if (global.ZootRuntime) return;

    const scopes = new Map();
    const modules = new Map();
    const vendorLoads = new Map();
    const lazyFeatures = new Map();
    const longTasks = [];
    const runtimeDiagnostics = [];
    const performanceMarks = new Map();
    const runtimeScriptUrl = document.currentScript?.src || location.href;
    const vendorDefinitions = Object.freeze({
        cropper: {globalName: 'Cropper', source: 'cropper-1.6.2.min.js'},
        html2canvas: {globalName: 'html2canvas', source: 'html2canvas-1.4.1.min.js'},
        vis: {globalName: 'vis', source: 'vis-network-9.1.9.min.js'},
        wordcloud: {globalName: 'WordCloud', source: 'wordcloud2-1.2.3.js'}
    });
    let activePageId = '';

    class ResourceScope {
        constructor(id) {
            this.id = String(id || 'anonymous');
            this.disposers = new Set();
            this.disposed = false;
        }

        add(disposer) {
            if (typeof disposer !== 'function') return disposer;
            if (this.disposed) {
                disposer();
                return disposer;
            }
            this.disposers.add(disposer);
            return disposer;
        }

        listen(target, type, listener, options) {
            if (!target?.addEventListener) return listener;
            target.addEventListener(type, listener, options);
            this.add(() => target.removeEventListener(type, listener, options));
            return listener;
        }

        interval(callback, delay) {
            const timer = global.setInterval(callback, delay);
            this.add(() => global.clearInterval(timer));
            return timer;
        }

        timeout(callback, delay) {
            const timer = global.setTimeout(() => {
                this.disposers.delete(cancel);
                callback();
            }, delay);
            const cancel = () => global.clearTimeout(timer);
            this.add(cancel);
            return timer;
        }

        observe(observer, target, options) {
            if (!observer || !target) return observer;
            observer.observe(target, options);
            this.add(() => observer.disconnect());
            return observer;
        }

        dispose() {
            if (this.disposed) return;
            this.disposed = true;
            Array.from(this.disposers).reverse().forEach(disposer => {
                try {
                    disposer();
                } catch (error) {
                    console.warn('[ZootRuntime] resource cleanup failed', this.id, error);
                }
            });
            this.disposers.clear();
        }
    }

    class OverlayManager {
        constructor() {
            this.stack = [];
        }

        open(element, options = {}) {
            if (!element) return false;
            const existing = this.stack.find(item => item.element === element);
            if (existing) return true;
            const entry = {
                element,
                restoreFocus: document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null
            };
            this.stack.push(entry);
            element.classList.remove('hidden');
            element.setAttribute('aria-hidden', 'false');
            const focusTarget = options.initialFocus
                || element.querySelector('[autofocus],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
            requestAnimationFrame(() => focusTarget?.focus?.({preventScroll: true}));
            return true;
        }

        close(element = this.stack[this.stack.length - 1]?.element) {
            const index = this.stack.findIndex(item => item.element === element);
            if (index < 0) return false;
            const [entry] = this.stack.splice(index, 1);
            entry.element.classList.add('hidden');
            entry.element.setAttribute('aria-hidden', 'true');
            entry.restoreFocus?.focus?.({preventScroll: true});
            return true;
        }

        closeAll() {
            Array.from(this.stack).reverse().forEach(entry => this.close(entry.element));
        }
    }

    const overlays = new OverlayManager();

    class MessageRendererRegistry {
        constructor() {
            this.renderers = new Map();
            this.fallbackRenderer = null;
        }

        register(type, renderer) {
            const key = String(type || '*');
            if (typeof renderer !== 'function') throw new TypeError('Message renderer must be a function');
            this.renderers.set(key, renderer);
            return () => {
                if (this.renderers.get(key) === renderer) this.renderers.delete(key);
            };
        }

        has(type) {
            return this.renderers.has(String(type || '*'));
        }

        setFallback(renderer) {
            if (typeof renderer !== 'function') throw new TypeError('Fallback renderer must be a function');
            this.fallbackRenderer = renderer;
        }

        hasFallback() {
            return typeof this.fallbackRenderer === 'function';
        }

        render(message, context = {}) {
            const type = String(message?.msgType || message?.msg_type || message?.unit_type || 'text');
            const renderer = this.renderers.get(type) || this.fallbackRenderer;
            if (!renderer) return false;
            return renderer(message, context) !== false;
        }
    }

    const messageRenderers = new MessageRendererRegistry();

    function createScope(id) {
        const key = String(id || 'anonymous');
        scopes.get(key)?.dispose();
        const scope = new ResourceScope(key);
        scopes.set(key, scope);
        return scope;
    }

    function disposeScope(id) {
        const key = String(id || 'anonymous');
        scopes.get(key)?.dispose();
        scopes.delete(key);
    }

    function ensureVendor(name) {
        const definition = vendorDefinitions[name];
        if (!definition) return Promise.reject(new Error(`Unknown vendor resource: ${name}`));
        if (global[definition.globalName]) return Promise.resolve(global[definition.globalName]);
        if (vendorLoads.has(name)) return vendorLoads.get(name);
        const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.async = true;
            script.src = new URL(`../vendor/${definition.source}`, runtimeScriptUrl).href;
            script.dataset.zootVendor = name;
            script.onload = () => {
                const exported = global[definition.globalName];
                if (!exported) {
                    vendorLoads.delete(name);
                    reject(new Error(`Vendor resource did not expose ${definition.globalName}`));
                    return;
                }
                resolve(exported);
            };
            script.onerror = () => {
                vendorLoads.delete(name);
                script.remove();
                reject(new Error(`Unable to load vendor resource: ${name}`));
            };
            document.head.appendChild(script);
        });
        vendorLoads.set(name, promise);
        return promise;
    }

    function registerFeature(feature) {
        if (!feature?.id) throw new Error('FeatureModule.id is required');
        const id = String(feature.id);
        const state = {
            id,
            mounted: false,
            active: false,
            feature,
            scope: null
        };
        modules.set(id, state);
        const pages = feature.pages || [];
        if (pages.includes(activePageId) || feature.shouldActivate?.(activePageId)) {
            activateFeature(state, {pageId: activePageId, previousPageId: ''});
        }
        return () => {
            const state = modules.get(id);
            if (!state) return;
            deactivateFeature(state);
            state.feature.dispose?.();
            modules.delete(id);
        };
    }

    function registerLazyFeature(definition) {
        if (!definition?.id || !definition?.source) {
            throw new Error('Lazy FeatureModule requires id and source');
        }
        lazyFeatures.set(String(definition.id), {
            ...definition,
            id: String(definition.id),
            pages: Array.from(definition.pages || [], String),
            loading: null,
            loaded: false
        });
    }

    function ensureFeaturesForPage(pageId) {
        lazyFeatures.forEach(state => {
            if (state.loaded || !state.pages.includes(pageId)) return;
            if (!state.loading) {
                const url = new URL(state.source, runtimeScriptUrl).href;
                state.loading = import(url)
                    .then(module => {
                        const feature = module.default || module.feature;
                        if (!feature) throw new Error(`Feature module ${state.id} has no default export`);
                        registerFeature(feature);
                        state.loaded = true;
                    })
                    .catch(error => {
                        state.loading = null;
                        console.error(`Unable to load feature module ${state.id}`, error);
                    });
            }
        });
    }

    function activateFeature(state, context) {
        if (!state || state.active) return;
        if (!state.mounted) {
            state.feature.mount?.(context);
            state.mounted = true;
        }
        state.scope = createScope(`feature:${state.id}`);
        state.feature.activate?.({...context, scope: state.scope});
        state.active = true;
    }

    function deactivateFeature(state) {
        if (!state?.active) return;
        state.feature.deactivate?.();
        disposeScope(`feature:${state.id}`);
        state.scope = null;
        state.active = false;
    }

    function pageIdFromElement(element) {
        return String(element?.id || '').replace(/^page-/, '');
    }

    function syncActivePage(explicitPageId) {
        const nextPageId = String(
            explicitPageId
            || pageIdFromElement(document.querySelector('.page.active-page'))
            || ''
        );
        ensureFeaturesForPage(nextPageId);
        if (nextPageId === activePageId) return;
        const previousPageId = activePageId;
        activePageId = nextPageId;
        modules.forEach(state => {
            const pages = state.feature.pages || [];
            const shouldActivate = pages.includes(nextPageId)
                || state.feature.shouldActivate?.(nextPageId);
            if (shouldActivate) {
                activateFeature(state, {pageId: nextPageId, previousPageId});
            } else {
                deactivateFeature(state);
            }
        });
        global.dispatchEvent(new CustomEvent('zoot:page-lifecycle', {
            detail: {pageId: nextPageId, previousPageId}
        }));
        saveRendererRecoverySnapshot();
    }

    function randomRequestId() {
        if (global.crypto?.randomUUID) return global.crypto.randomUUID();
        const data = new Uint32Array(4);
        global.crypto?.getRandomValues?.(data);
        return Array.from(data, value => value.toString(16).padStart(8, '0')).join('');
    }

    function recordRuntimeError(kind, error, detail = {}) {
        const raw = error instanceof Error ? error.message : String(error || 'Unknown runtime error');
        const message = raw
            .replace(/(api[_ -]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/ig, '$1=<redacted>')
            .slice(0, 300);
        const entry = {
            kind: String(kind || 'runtime'),
            message,
            page: activePageId,
            at: Date.now(),
            ...detail
        };
        runtimeDiagnostics.push(entry);
        if (runtimeDiagnostics.length > 80) runtimeDiagnostics.splice(0, runtimeDiagnostics.length - 80);
        global.dispatchEvent(new CustomEvent('zoot:runtime-error', {detail: {...entry}}));
        console.warn('[ZOOT runtime]', entry.kind, entry.message);
    }

    async function apiFetch(input, init = {}) {
        const requestInit = {...init};
        const timeoutMs = Math.max(1000, Number(requestInit.timeoutMs || 30000));
        delete requestInit.timeoutMs;
        const controller = new AbortController();
        const externalSignal = requestInit.signal;
        const abortExternal = () => controller.abort(externalSignal?.reason);
        if (externalSignal) {
            if (externalSignal.aborted) abortExternal();
            else externalSignal.addEventListener('abort', abortExternal, {once: true});
        }
        requestInit.signal = controller.signal;
        requestInit.headers = new Headers(requestInit.headers || {});
        if (!requestInit.headers.has('X-Request-ID')) {
            requestInit.headers.set('X-Request-ID', randomRequestId());
        }
        const timer = global.setTimeout(
            () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
            timeoutMs
        );
        const startedAt = performance.now();
        try {
            const response = await global.fetch(input, requestInit);
            global.dispatchEvent(new CustomEvent('zoot:request-complete', {
                detail: {
                    method: String(requestInit.method || 'GET').toUpperCase(),
                    path: typeof input === 'string' ? input.split('?')[0] : '',
                    status: response.status,
                    durationMs: performance.now() - startedAt
                }
            }));
            return response;
        } finally {
            global.clearTimeout(timer);
            externalSignal?.removeEventListener?.('abort', abortExternal);
        }
    }

    function mark(name) {
        const key = String(name);
        performanceMarks.set(key, performance.now());
        performance.mark?.(`zoot:${key}`);
    }

    function measure(name, startName) {
        const start = performanceMarks.get(String(startName));
        if (!Number.isFinite(start)) return null;
        const duration = performance.now() - start;
        global.dispatchEvent(new CustomEvent('zoot:performance-measure', {
            detail: {name: String(name), durationMs: duration}
        }));
        return duration;
    }

    let nativeCompatibility = null;
    try {
        if (global.Android?.getDeviceCompatibilitySnapshot) {
            nativeCompatibility = JSON.parse(global.Android.getDeviceCompatibilitySnapshot() || '{}');
        }
    } catch (_) {
        nativeCompatibility = null;
    }

    const RENDERER_RECOVERY_KEY = 'zoot-renderer-recovery-v1';
    let recoveryTimer = 0;

    function activeScrollContainer(page) {
        return page?.querySelector?.('[data-scroll-container],.settings-page-content,.chat-messages') || page;
    }

    function saveRendererRecoverySnapshot() {
        clearTimeout(recoveryTimer);
        recoveryTimer = setTimeout(() => {
            const page = document.querySelector('.page.active-page');
            if (!page) return;
            const drafts = {};
            page.querySelectorAll('textarea,input').forEach(control => {
                const type = String(control.type || '').toLowerCase();
                const identity = String(control.id || control.name || '');
                if (!identity || ['password', 'file', 'hidden', 'checkbox', 'radio'].includes(type)) return;
                if (/(api.?key|secret|token|password|credential)/i.test(identity)) return;
                if (!control.value) return;
                drafts[identity] = String(control.value).slice(0, 20000);
            });
            const scrollContainer = activeScrollContainer(page);
            try {
                localStorage.setItem(RENDERER_RECOVERY_KEY, JSON.stringify({
                    page_id: pageIdFromElement(page),
                    scroll_top: Number(scrollContainer?.scrollTop || 0),
                    drafts,
                    saved_at: Date.now()
                }));
            } catch (_) {
                // Storage can be unavailable in private WebView sessions.
            }
        }, 180);
    }

    function restoreRendererRecoverySnapshot() {
        const lastExit = Number(nativeCompatibility?.renderer_last_exit_at || 0);
        if (!lastExit || Date.now() - lastExit > 120000) return;
        let snapshot = null;
        try {
            snapshot = JSON.parse(localStorage.getItem(RENDERER_RECOVERY_KEY) || 'null');
        } catch (_) {
            snapshot = null;
        }
        if (!snapshot?.page_id || Date.now() - Number(snapshot.saved_at || 0) > 3600000) return;
        const page = document.getElementById(`page-${snapshot.page_id}`);
        if (!page) return;
        if (typeof global.showPage === 'function' && !page.classList.contains('active-page')) {
            global.showPage(snapshot.page_id);
        }
        setTimeout(() => {
            Object.entries(snapshot.drafts || {}).forEach(([identity, value]) => {
                const control = document.getElementById(identity)
                    || Array.from(page.querySelectorAll('[name]')).find((candidate) => candidate.name === identity);
                if (!control || control.value) return;
                control.value = value;
                control.dispatchEvent(new Event('input', {bubbles: true}));
            });
            const scrollContainer = activeScrollContainer(page);
            if (scrollContainer) scrollContainer.scrollTop = Number(snapshot.scroll_top || 0);
        }, 120);
    }

    function resourceBudget() {
        const nativeMemoryGb = Number(nativeCompatibility?.memory_class_mb || 0) / 1024;
        const memoryGb = nativeMemoryGb > 0 ? nativeMemoryGb : Number(navigator.deviceMemory || 6);
        const cores = Number(navigator.hardwareConcurrency || 4);
        const reducedMotion = global.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const forcedLight = localStorage.getItem('zoot-light-mode') === '1';
        const constrained = forcedLight || Boolean(nativeCompatibility?.low_ram_device) || memoryGb <= 4 || cores <= 4;
        return {
            tier: constrained ? 'light' : memoryGb >= 8 && cores >= 8 ? 'full' : 'balanced',
            maxLiveMessages: constrained ? 60 : 100,
            messageOverscan: constrained ? 10 : 16,
            imagePreloadCount: constrained ? 1 : 4,
            reducedMotion: Boolean(reducedMotion)
        };
    }

    function stabilizeTail(container, durationMs = 700) {
        if (!container) return () => {};
        let active = true;
        let observer = null;
        let frame = 0;
        const pin = () => {
            if (!active) return;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                if (active) container.scrollTop = container.scrollHeight;
            });
        };
        if ('ResizeObserver' in global) {
            observer = new ResizeObserver(pin);
            observer.observe(container);
            Array.from(container.children).slice(-3).forEach(child => observer.observe(child));
        }
        const timer = global.setTimeout(() => {
            active = false;
            observer?.disconnect();
            cancelAnimationFrame(frame);
            container.scrollTop = container.scrollHeight;
        }, Math.max(100, Number(durationMs) || 700));
        pin();
        return () => {
            active = false;
            global.clearTimeout(timer);
            observer?.disconnect();
            cancelAnimationFrame(frame);
        };
    }

    if ('PerformanceObserver' in global) {
        try {
            const observer = new PerformanceObserver(list => {
                list.getEntries().forEach(entry => {
                    longTasks.push({
                        startTime: entry.startTime,
                        duration: entry.duration
                    });
                });
                if (longTasks.length > 120) longTasks.splice(0, longTasks.length - 120);
            });
            observer.observe({entryTypes: ['longtask']});
        } catch (_) {
            // Long Task API is optional in older WebViews.
        }
    }

    global.addEventListener('pageShown', event => {
        syncActivePage(event.detail?.pageId || event.detail?.page);
    });
    global.addEventListener('error', event => {
        recordRuntimeError('error', event.error || event.message, {
            source: String(event.filename || '').split('/').pop().slice(0, 120),
            line: Number(event.lineno || 0)
        });
    });
    global.addEventListener('unhandledrejection', event => {
        recordRuntimeError('unhandledrejection', event.reason);
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            modules.forEach(deactivateFeature);
        } else {
            syncActivePage();
        }
    });
    global.addEventListener('zoot:native-visibility', event => {
        if (event.detail?.visible === false) {
            modules.forEach(deactivateFeature);
        } else {
            syncActivePage();
        }
    });
    global.addEventListener('zoot:native-memory-pressure', event => {
        const level = Number(event.detail?.level || 0);
        longTasks.splice(0, longTasks.length);
        document.documentElement.dataset.memoryPressure = level >= 10 ? 'high' : 'moderate';
        document.querySelectorAll('.page:not(.active-page) video,.page:not(.active-page) audio')
            .forEach(media => media.pause?.());
        global.dispatchEvent(new CustomEvent('zoot:resource-pressure', {
            detail: {level}
        }));
    });
    global.addEventListener('zoot:renderer-safe-mode', () => {
        document.documentElement.dataset.lightMode = 'true';
    });
    global.addEventListener('zoot:app-ready', () => {
        restoreRendererRecoverySnapshot();
        const lowResource = Boolean(nativeCompatibility?.low_ram_device || nativeCompatibility?.renderer_safe_mode);
        if (!lowResource || localStorage.getItem('zoot-light-mode-asked') === '1') return;
        localStorage.setItem('zoot-light-mode-asked', '1');
        const enabled = global.confirm('检测到当前设备内存较紧张或WebView曾被系统回收。是否启用轻量模式以减少卡顿？');
        if (enabled) {
            localStorage.setItem('zoot-light-mode', '1');
            document.documentElement.dataset.lightMode = 'true';
        }
    });
    document.addEventListener('DOMContentLoaded', () => {
        if (localStorage.getItem('zoot-light-mode') === '1') {
            document.documentElement.dataset.lightMode = 'true';
        }
        mark('dom-ready');
        document.querySelectorAll('img:not([loading])').forEach(image => {
            image.loading = image.closest('.active-page') ? 'eager' : 'lazy';
            image.decoding = 'async';
        });
        syncActivePage();
        document.addEventListener('input', saveRendererRecoverySnapshot, {passive: true});
        document.addEventListener('scroll', saveRendererRecoverySnapshot, {passive: true, capture: true});
    }, {once: true});

    [
        {id: 'monitoring', source: 'features/monitoring.mjs', pages: ['settings-system-center', 'zoot-runtime']},
        {id: 'statistics', source: 'features/statistics.mjs', pages: ['statistics-detail']},
        {id: 'device-fabric', source: 'features/device-fabric.mjs', pages: ['settings-multi-device']},
        {id: 'timeline', source: 'features/timeline.mjs', pages: ['settings-timeline', 'timeline-manager', 'timeline-tree']},
        {id: 'memory', source: 'features/memory.mjs', pages: ['settings-memory', 'memory-center']}
    ].forEach(registerLazyFeature);

    global.ZootRuntime = Object.freeze({
        apiFetch,
        createScope,
        disposeScope,
        ensureVendor,
        getActivePage: () => activePageId,
        getLongTasks: () => longTasks.slice(),
        getRuntimeDiagnostics: () => runtimeDiagnostics.slice(),
        getResourceBudget: resourceBudget,
        getDeviceCompatibility: () => nativeCompatibility ? {...nativeCompatibility} : null,
        mark,
        measure,
        messageRenderers,
        overlays,
        registerFeature,
        registerLazyFeature,
        stabilizeTail,
        syncActivePage
    });
})(window);
