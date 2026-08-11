(function () {
    'use strict';
    let loading = null;

    function ensureStyles() {
        if (document.querySelector('link[data-terra-journey-style]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'css/terra-journey.css?v=20260810-100-0865';
        link.dataset.terraJourneyStyle = 'true';
        document.head.appendChild(link);
    }

    function pageIdFromElement(element) {
        const page = element && element.closest ? element.closest('.page[id^="page-terra-journey"]') : null;
        return page ? page.id.replace(/^page-/, '') : 'terra-journey';
    }

    function load(pageId) {
        ensureStyles();
        if (window.TerraJourney) {
            const targetPage = pageId || 'terra-journey';
            if (window.TerraJourney.state.activePageId !== targetPage) {
                window.TerraJourney.initializePage(targetPage);
            }
            return Promise.resolve();
        }
        if (!loading) {
            loading = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'js/terra-journey.js?v=20260810-100-0865';
                script.async = true;
                script.onload = resolve;
                script.onerror = () => reject(new Error('泰拉寻旅模块加载失败'));
                document.head.appendChild(script);
            });
        }
        return loading.then(() => {
            const targetPage = pageId || 'terra-journey';
            if (window.TerraJourney && window.TerraJourney.state.activePageId !== targetPage) {
                return window.TerraJourney.initializePage(targetPage);
            }
            return undefined;
        });
    }

    document.addEventListener('click', event => {
        const target = event.target.closest('[data-page^="terra-journey"], [data-journey-page]');
        if (!target) return;
        const pageId = target.dataset.journeyPage || target.dataset.page || pageIdFromElement(target);
        load(pageId).catch(error => console.error('[泰拉寻旅]', error));
    }, true);

    document.addEventListener('DOMContentLoaded', () => {
        const active = document.querySelector('.page.active[id^="page-terra-journey"]');
        if (active) load(pageIdFromElement(active));
    }, {once: true});
})();
