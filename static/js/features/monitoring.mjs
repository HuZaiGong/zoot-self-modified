export default {
    id: 'monitoring',
    pages: ['settings-system-center', 'zoot-runtime'],
    activate({pageId, scope}) {
        const page = document.getElementById(`page-${pageId}`);
        const notifyLayout = () => {
            window.dispatchEvent(new CustomEvent('zoot:monitoring-layout', {
                detail: {pageId}
            }));
        };
        if (page && 'ResizeObserver' in window) {
            scope.observe(new ResizeObserver(notifyLayout), page);
        }
        scope.listen(window, 'resize', notifyLayout, {passive: true});
        requestAnimationFrame(notifyLayout);
    },
    deactivate() {
        window.dispatchEvent(new CustomEvent('zoot:monitoring-suspend'));
    }
};
