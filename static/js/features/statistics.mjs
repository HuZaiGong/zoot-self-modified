export default {
    id: 'statistics',
    pages: ['statistics-detail'],
    activate() {
        window.dispatchEvent(new CustomEvent('zoot:statistics-activate'));
    },
    deactivate() {
        if (typeof window.destroyAllCharts === 'function') window.destroyAllCharts();
    }
};
