(() => {
    'use strict';

    const state = {
        revision: null,
        pending: new Map(),
        timer: 0,
        applyingRemote: false,
        ready: false,
    };
    const blockedPattern = /(api.?key|secret|token|password|credential|prompt|message|chat.?content|session.?key)/i;
    const transientPattern = /(^|[-_:])(cache|draft|scroll|cursor|temporary|pending-request)([-_:]|$)/i;
    let lastAppearanceSignature = '';

    function isPersistableKey(key, value) {
        if (!key || key.length > 180 || blockedPattern.test(key) || transientPattern.test(key)) return false;
        return value === null || (typeof value === 'string' && new TextEncoder().encode(value).length <= 32768);
    }

    function dispatchReady(values) {
        state.ready = true;
        window.dispatchEvent(new CustomEvent('zoot:device-preferences-ready', {
            detail: { values, revision: state.revision }
        }));
        const applyAppearance = () => {
            const theme = localStorage.getItem('theme') || 'light';
            const scheme = localStorage.getItem('colorScheme') || 'scheme1';
            const fontSize = Math.min(20, Math.max(12, Number(localStorage.getItem('fontSize') || 16)));
            const fontFamily = localStorage.getItem('fontFamily') || 'default';
            const signature = `${theme}|${scheme}|${fontSize}|${fontFamily}`;
            if (signature === lastAppearanceSignature) return;
            lastAppearanceSignature = signature;
            window.Android?.setDeviceTheme?.(theme, scheme);
            if (typeof window.applyTheme === 'function') {
                window.applyTheme(theme, scheme);
            } else {
                document.documentElement.classList.toggle('dark-mode', theme === 'dark');
                document.documentElement.classList.toggle('light-mode', theme !== 'dark');
            }
            if (typeof window.applyFontSize === 'function') window.applyFontSize(fontSize);
            else document.documentElement.style.setProperty('--zoot-user-font-scale', String(fontSize / 16));
            if (typeof window.applyFontFamily === 'function') window.applyFontFamily(fontFamily);
            document.dispatchEvent(new CustomEvent('themeChanged', {detail: {theme, scheme}}));
        };
        requestAnimationFrame(applyAppearance);
        setTimeout(applyAppearance, 500);
    }

    async function load() {
        try {
            const response = await fetch('/device-preferences', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            state.revision = Number(payload.revision || 0);
            state.applyingRemote = true;
            Object.entries(payload.values || {}).forEach(([key, value]) => {
                if (typeof value === 'string') {
                    localStorage.setItem(key, value);
                }
            });
            state.applyingRemote = false;
            dispatchReady(payload.values || {});
        } catch (error) {
            state.applyingRemote = false;
            console.debug('设备偏好暂时使用本地缓存', error);
            dispatchReady({});
        }
    }

    async function flush() {
        clearTimeout(state.timer);
        state.timer = 0;
        if (!state.pending.size) return;
        const values = Object.fromEntries(state.pending);
        state.pending.clear();
        try {
            const response = await fetch('/device-preferences', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ values, expected_revision: state.revision }),
                keepalive: true,
            });
            const payload = await response.json().catch(() => ({}));
            if (response.status === 409) {
                state.revision = Number(payload.detail?.current_revision ?? payload.current_revision ?? 0);
                Object.entries(values).forEach(([key, value]) => state.pending.set(key, value));
                state.timer = setTimeout(flush, 120);
                return;
            }
            if (!response.ok) throw new Error(payload.detail?.message || `HTTP ${response.status}`);
            state.revision = Number(payload.revision || state.revision || 0);
        } catch (error) {
            Object.entries(values).forEach(([key, value]) => state.pending.set(key, value));
            console.debug('设备偏好将在稍后重试', error);
        }
    }

    function queue(key, value) {
        if (state.applyingRemote || !isPersistableKey(key, value)) return;
        state.pending.set(key, value);
        if (key === 'theme' || key === 'colorScheme') {
            window.Android?.setDeviceTheme?.(
                key === 'theme' ? String(value || 'light') : (localStorage.getItem('theme') || 'light'),
                key === 'colorScheme' ? String(value || 'scheme1') : (localStorage.getItem('colorScheme') || 'scheme1')
            );
        }
        clearTimeout(state.timer);
        state.timer = setTimeout(flush, 250);
    }

    const nativeSetItem = Storage.prototype.setItem;
    const nativeRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key, value) {
        nativeSetItem.call(this, key, value);
        if (this === localStorage) queue(String(key), String(value));
    };
    Storage.prototype.removeItem = function (key) {
        nativeRemoveItem.call(this, key);
        if (this === localStorage && !blockedPattern.test(String(key))) queue(String(key), null);
    };

    window.ZootDevicePreferences = {
        get ready() { return state.ready; },
        get revision() { return state.revision; },
        flush,
        set(key, value) {
            localStorage.setItem(String(key), String(value));
        },
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
    });
    load();
})();
