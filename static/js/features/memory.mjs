export default {
    id: 'memory-feature',
    pages: ['settings-memory', 'memory-center'],
    activate({pageId}) {
        const page = document.getElementById(`page-${pageId}`);
        requestAnimationFrame(() => window.initSettingsUI?.(page));
    }
};
