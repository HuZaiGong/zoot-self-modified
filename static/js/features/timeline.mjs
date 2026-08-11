export default {
    id: 'timeline-feature',
    pages: ['settings-timeline', 'timeline-manager', 'timeline-tree'],
    activate() {
        requestAnimationFrame(() => window.refreshTimelineMessageActions?.());
    }
};
