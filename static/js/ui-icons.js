(function () {
    'use strict';

    const ICONS = Object.freeze({
        attachment: ['attachment', '附件'],
        audio: ['audio', '音频'],
        analyze: ['chart', '分析'],
        archive: ['archive', '档案'],
        bank: ['bank', '账户'],
        book: ['book', '详情'],
        brain: ['brain', '智能'],
        calendar: ['calendar', '日期'],
        camera: ['camera', '图片'],
        chart: ['chart', '统计'],
        check: ['check', '选中'],
        close: ['close', '关闭'],
        cloud: ['cloud', '云端'],
        clipboard: ['clipboard', '记录'],
        database: ['database', '数据库'],
        device: ['device', '设备'],
        diary: ['diary', '日记'],
        edit: ['edit', '编辑'],
        error: ['error', '错误'],
        expand: ['expand', '展开'],
        favorite: ['favorite', '已收藏'],
        favoriteOutline: ['favorite-outline', '收藏'],
        filter: ['filter', '筛选'],
        gallery: ['gallery', '画廊'],
        globe: ['globe', '网络'],
        heart: ['heart', '喜欢'],
        inbound: ['inbound', '入库'],
        info: ['info', '提示'],
        link: ['link', '链接'],
        location: ['location', '位置'],
        menu: ['menu', '菜单'],
        message: ['message', '留言'],
        minus: ['minus', '减少'],
        more: ['more', '更多'],
        mute: ['mute', '静音'],
        next: ['chevron-right', '下一项'],
        notification: ['notification', '通知'],
        outbound: ['outbound', '出库'],
        persona: ['persona', '人格'],
        pharmacy: ['pharmacy', '制药'],
        pin: ['pin', '固定'],
        plugin: ['plugin', '插件'],
        plus: ['plus', '新增'],
        previous: ['chevron-left', '上一项'],
        refresh: ['refresh', '刷新'],
        save: ['save', '保存'],
        search: ['search', '搜索'],
        send: ['send', '发送'],
        settings: ['settings', '设置'],
        sparkle: ['sparkle', '完成'],
        success: ['success', '成功'],
        sync: ['sync', '同步'],
        target: ['target', '目标'],
        thinking: ['thinking', '思考中'],
        timeline: ['timeline', '时间线'],
        trash: ['trash', '删除'],
        trend: ['trend', '趋势'],
        user: ['user', '用户'],
        users: ['users', '群组'],
        wallet: ['wallet', '资金'],
        wardrobe: ['wardrobe', '衣柜'],
        warning: ['warning', '警告'],
        zoomIn: ['zoom-in', '放大'],
        zoomOut: ['zoom-out', '缩小']
    });

    const LEADING_MARKS = /^(?:✅|❌|⚠️?|💡|ℹ️?|🔍|📝|📋|📌|📊|🔄|✨|📍|📖|🌐|📘|🧠|⚙️|☁️|📤|📥|💬|🔔|👤|👥|💰|❤️?|🏆|🎯|💊|📈|🏦|🗑️|✏️?|✎|➕)\s*/u;
    const LEGACY_ICONS = Object.freeze({
        '✅': 'success',
        '❌': 'error',
        '⚠️': 'warning',
        '⚠': 'warning',
        '💡': 'info',
        '❓': 'info',
        '🔍': 'search',
        '📝': 'edit',
        '📋': 'clipboard',
        '📌': 'pin',
        '📊': 'chart',
        '🔄': 'refresh',
        '✨': 'sparkle',
        '📍': 'location',
        '📖': 'book',
        '📔': 'diary',
        '🌐': 'globe',
        '📘': 'book',
        '🧠': 'brain',
        '⚙️': 'settings',
        '⚙': 'settings',
        '☁️': 'cloud',
        '☁': 'cloud',
        '📤': 'outbound',
        '📥': 'inbound',
        '💬': 'message',
        '🔔': 'notification',
        '🔕': 'mute',
        '👤': 'user',
        '🧑': 'user',
        '👥': 'users',
        '💰': 'wallet',
        '❤️': 'heart',
        '❤': 'heart',
        '🏆': 'favorite',
        '🎯': 'target',
        '💊': 'pharmacy',
        '📈': 'trend',
        '🏦': 'bank',
        '🗑️': 'trash',
        '🗑': 'trash',
        '✏️': 'edit',
        '✏': 'edit',
        '✎': 'edit',
        '➕': 'plus',
        '☷': 'clipboard',
        '☰': 'menu',
        '➤': 'send',
        '✕': 'close',
        '×': 'close',
        '✓': 'check',
        '★': 'favorite',
        '☆': 'favoriteOutline',
        '‹': 'previous',
        '›': 'next',
        '📷': 'camera',
        '🔗': 'link',
        '📅': 'calendar',
        '📦': 'archive',
        '🎉': 'sparkle',
        '⚡': 'sparkle',
        '💭': 'thinking',
        '⏳': 'sync',
        '♪': 'audio',
        '▤': 'attachment',
        '▧': 'gallery',
        '☐': 'expand',
        '🗂️': 'archive',
        '🗂': 'archive',
        '🛠️': 'settings',
        '🛠': 'settings',
        '💾': 'save',
        '⋮': 'more',
    });
    const LEGACY_PATTERN = new RegExp(
        Object.keys(LEGACY_ICONS)
            .sort((left, right) => right.length - left.length)
            .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|'),
        'gu'
    );
    const LEGACY_UI_SELECTOR = [
        'button',
        '[role="button"]',
        '.settings-item-icon',
        '.settings-item',
        '.settings-hint',
        '.info-title',
        '.stats-title',
        '.empty-state',
        '.placeholder-icon',
        '.thinking-label',
        '.record-board-title',
        '.memory-section-title',
        '.briefing-stats',
        '.briefing-task-group',
        '.task-status',
        '.task-meta',
        '.status-text',
        '.cloud-status',
        '.timeline-choice-mark',
        '.timeline-popup-close',
        '.window-btn',
        '.clear-search',
        '.profile-close-btn',
        '.gallery-detail-header',
        '.gallery-detail-viewer',
        '.dynamic-placeholder',
        '.dynamic-location',
        '.thinking-indicator',
        '.settings-description',
        '.hint-text',
        '.operator-status',
        '.task-card',
        '.ops-task-card',
        '.record-card-title',
        '.task-title',
        '.menu-arrow',
        '.extension-arrow',
        '.settings-item-arrow',
        '.arrow-indicator',
        '.group-avatar-placeholder',
        '.index-item',
        '#openai-compat-hint',
        '.tooltip-close',
        '.toast-tip',
        '#global-toast'
    ].join(',');
    const USER_CONTENT_SELECTOR = [
        '.message-content',
        '.message-text',
        '.message-bubble',
        '.scenario-content',
        '.dynamic-content',
        '.comment-content',
        '.diary-content',
        '.story-content',
        '.wardrobe-description',
        '.gallery-card-copy',
        'textarea',
        'input',
        'pre',
        'code',
        '[contenteditable="true"]'
    ].join(',');
    const supportsMask = typeof CSS !== 'undefined' && (
        CSS.supports('mask-image', 'url("")') ||
        CSS.supports('-webkit-mask-image', 'url("")')
    );

    function definition(name) {
        return ICONS[name] || ICONS.info;
    }

    function url(name) {
        return `/static/icons/ui/${definition(name)[0]}.svg`;
    }

    function fallback(name) {
        return definition(name)[1].slice(0, 2).toUpperCase();
    }

    function hydrate(element) {
        if (!(element instanceof Element) || !element.matches('[data-zoot-icon]')) return element;
        const name = element.dataset.icon || element.dataset.zootIcon || 'info';
        element.classList.add('zoot-ui-icon');
        element.setAttribute('aria-hidden', 'true');
        if (supportsMask) {
            const iconUrl = `url("${url(name)}")`;
            element.style.setProperty('--zoot-icon-mask', iconUrl);
            element.textContent = '';
        } else {
            element.classList.add('zoot-ui-icon-fallback');
            element.textContent = fallback(name);
        }
        return element;
    }

    function hydrateTree(root) {
        if (!root) return;
        if (root instanceof Element && root.matches('[data-zoot-icon]')) hydrate(root);
        root.querySelectorAll?.('[data-zoot-icon]').forEach(hydrate);
    }

    function element(name, options = {}) {
        const node = document.createElement(options.tagName || 'span');
        node.dataset.zootIcon = name;
        if (options.className) node.className = options.className;
        if (options.label) node.title = options.label;
        return hydrate(node);
    }

    function html(name, className = '') {
        const safeName = Object.prototype.hasOwnProperty.call(ICONS, name) ? name : 'info';
        const safeClass = String(className).replace(/[^a-zA-Z0-9 _-]/g, '');
        return `<span class="zoot-ui-icon ${safeClass}" data-zoot-icon="${safeName}" data-icon="${safeName}" aria-hidden="true"></span>`;
    }

    function cleanText(value) {
        return String(value ?? '').replace(LEADING_MARKS, '');
    }

    function statusName(type, text = '') {
        if (type === 'success' || /^✅/u.test(text)) return 'success';
        if (type === 'error' || /^❌/u.test(text)) return 'error';
        if (type === 'warning' || /^⚠/u.test(text)) return 'warning';
        return 'info';
    }

    function replaceLegacyTextNode(textNode) {
        const parent = textNode.parentElement;
        if (!parent || !parent.closest(LEGACY_UI_SELECTOR) || parent.closest(USER_CONTENT_SELECTOR)) return;
        const source = textNode.nodeValue || '';
        if (!LEGACY_PATTERN.test(source)) return;
        LEGACY_PATTERN.lastIndex = 0;
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        let match;
        while ((match = LEGACY_PATTERN.exec(source))) {
            if (match.index > cursor) fragment.append(document.createTextNode(source.slice(cursor, match.index)));
            fragment.append(element(LEGACY_ICONS[match[0]] || 'info'));
            cursor = match.index + match[0].length;
        }
        if (cursor < source.length) fragment.append(document.createTextNode(source.slice(cursor)));
        textNode.replaceWith(fragment);
    }

    function upgradeLegacy(root) {
        if (!root) return;
        if (root.nodeType === Node.TEXT_NODE) {
            replaceLegacyTextNode(root);
            return;
        }
        if (!(root instanceof Element || root instanceof Document || root instanceof DocumentFragment)) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(replaceLegacyTextNode);
    }

    function observe() {
        hydrateTree(document);
        upgradeLegacy(document);
        const observer = new MutationObserver((records) => {
            records.forEach((record) => record.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) hydrateTree(node);
                upgradeLegacy(node);
            }));
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    window.ZootIcons = Object.freeze({
        cleanText,
        element,
        html,
        hydrate,
        hydrateTree,
        statusName,
        upgradeLegacy,
        url
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observe, { once: true });
    } else {
        observe();
    }
})();
