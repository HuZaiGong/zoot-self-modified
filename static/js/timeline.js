(function () {
    'use strict';

    const escapeTimelineHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[character]));

    const timelineRequest = async (url, options = {}) => {
        const response = await fetch(url, options);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.detail || body.error || `HTTP ${response.status}`);
        return body;
    };

    const timelineToast = (message, kind = 'success') => {
        if (typeof showTemporaryToast === 'function') {
            showTemporaryToast(message, 2600, kind);
            return;
        }
        const item = document.createElement('div');
        item.className = `zoot-toast ${kind}`;
        item.textContent = message;
        document.body.appendChild(item);
        setTimeout(() => item.remove(), 2600);
    };

    const timelineContext = () => {
        const groupId = typeof currentGroupId !== 'undefined' ? currentGroupId : null;
        const operatorId = typeof currentOperatorId !== 'undefined' ? currentOperatorId : null;
        const chatId = String(groupId || operatorId || '');
        const chatType = groupId ? 'group' : 'private';
        return {
            chatId,
            chatType,
            conversationKey: `${chatType}:${chatId}`
        };
    };

    const timelineState = {
        forkPoints: new Map(),
        navigationPoints: new Map(),
        activeBranchId: '',
        viewRevision: '',
        queryTimer: 0,
        lastQueryKey: '',
        popover: null,
        busyMessageUids: new Set()
    };

    const branchIconSvg = () => `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 4v8a4 4 0 0 0 4 4h6"></path>
            <path d="M13 8l4-4 4 4"></path>
            <circle cx="7" cy="4" r="2"></circle>
            <circle cx="17" cy="16" r="2"></circle>
        </svg>`;

    const timelineChevronSvg = direction => `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="${direction === 'previous' ? 'm14.5 6-6 6 6 6' : 'm9.5 6 6 6-6 6'}"></path>
        </svg>`;

    const timelineMenuSvg = () => `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6v5a3 3 0 0 0 3 3h9"></path>
            <path d="M12 6v2a3 3 0 0 0 3 3h3"></path>
            <circle cx="6" cy="6" r="1.6"></circle>
            <circle cx="12" cy="6" r="1.6"></circle>
            <circle cx="18" cy="11" r="1.6"></circle>
            <circle cx="18" cy="14" r="1.6"></circle>
        </svg>`;

    const imageActionIcon = () => window.ZootIcons?.html?.('camera') || '<span data-zoot-icon="camera" aria-hidden="true"></span>';

    const openMessageImageWorkspace = message => {
        if (typeof window.openImageWorkspace !== 'function') {
            timelineToast('生图工作台尚未加载', 'error');
            return;
        }
        window.closeCurrentMessageMenu?.();
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
        const context = timelineContext();
        const list = typeof messages !== 'undefined' ? (messages[context.conversationKey] || []) : [];
        const index = list.findIndex(item => String(item.message_uid || '') === String(message.message_uid || ''));
        const selected = list.slice(Math.max(0, index - 5), index + 1).filter(item =>
            item?.message_uid && !item.isFailed && !item.is_memory_only && item.cls !== 'system'
        );
        const detectedParticipants = [...new Map(selected.map(item => {
            const sender = String(item.sender_eng || item.sender || '').trim();
            if (!sender || ['system', 'scenario', 'narrator'].includes(sender)) return ['', null];
            const isPersona = sender === 'doctor';
            const actorId = isPersona ? String(item.persona_id || 'doctor') : sender;
            return [actorId, {
                actor_id: actorId,
                role_type: isPersona ? 'persona' : String(item.role_type || item.sender_role_type || 'operator'),
                display_name: isPersona ? '当前人格' : String(item.sender_name || item.display_name || sender)
            }];
        }).filter(([actorId]) => actorId)).values()];
        window.openImageWorkspace({
            sourceType: 'chat',
            sourceId: String(message.message_uid),
            anchorMessageUid: String(message.message_uid),
            selectedMessageUids: selected.map(item => String(item.message_uid)),
            conversationKey: context.conversationKey,
            branchId: timelineState.activeBranchId || message.branch_id || 'main',
            timelineViewRevision: timelineState.viewRevision || '',
            detectedParticipants,
            autoPreview: true
        });
    };

    const timelineSheet = (title, html) => {
        let root = document.getElementById('timeline-overlay');
        if (!root) {
            root = document.createElement('div');
            root.id = 'timeline-overlay';
            root.className = 'app-modal-overlay hidden';
            root.innerHTML = '<section class="bottom-sheet" role="dialog" aria-modal="true"><header><strong></strong><button type="button" aria-label="关闭"><span data-zoot-icon="close"></span></button></header><div class="bottom-sheet-body"></div></section>';
            root.addEventListener('click', event => {
                if (event.target === root || event.target.closest('header button')) root.classList.add('hidden');
            });
            document.body.appendChild(root);
        }
        root.querySelector('header strong').textContent = title;
        root.querySelector('.bottom-sheet-body').innerHTML = html;
        root.classList.remove('hidden');
        return root;
    };

    const currentTimelineMessage = row => {
        const context = timelineContext();
        const list = typeof messages !== 'undefined' ? (messages[context.conversationKey] || []) : [];
        return list.find(item => String(item.id ?? item.dbId ?? item.db_id) === String(row.dataset.msgId || ''));
    };

    const messageForUid = uid => {
        const context = timelineContext();
        const list = typeof messages !== 'undefined' ? (messages[context.conversationKey] || []) : [];
        return list.find(item => String(item.message_uid || '') === String(uid || ''));
    };

    const rowForUid = uid => {
        const message = messageForUid(uid);
        if (!message) return null;
        const id = String(message.id ?? message.dbId ?? message.db_id ?? '');
        return [...document.querySelectorAll('#chat-messages .chat-message-row[data-msg-id]')]
            .find(row => String(row.dataset.msgId || '') === id) || null;
    };

    const markTimelineSuffix = (forkUid, className) => {
        const row = rowForUid(forkUid);
        if (!row) return;
        let sibling = row.nextElementSibling;
        while (sibling) {
            if (sibling.classList?.contains('chat-message-row')) sibling.classList.add(className);
            sibling = sibling.nextElementSibling;
        }
    };

    const reloadTimelineConversation = async forkUid => {
        const context = timelineContext();
        const anchor = rowForUid(forkUid);
        const anchorTop = anchor?.getBoundingClientRect().top;
        markTimelineSuffix(forkUid, 'timeline-switch-out');
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
            await new Promise(resolve => setTimeout(resolve, 120));
        }
        if (typeof messages !== 'undefined') {
            const current = messages[context.conversationKey] || [];
            const forkIndex = current.findIndex(item => String(item.message_uid || '') === String(forkUid || ''));
            messages[context.conversationKey] = forkIndex >= 0
                ? current.slice(0, forkIndex + 1)
                : [];
            if (typeof renderCurrentChat === 'function') renderCurrentChat();
        }
        let result;
        const historyOptions = {
            bypassCache: true,
            expectedBranchId: timelineState.activeBranchId,
            expectedViewRevision: timelineState.viewRevision,
            retryOnViewConflict: true
        };
        if (context.chatType === 'group' && typeof loadGroupHistory === 'function') {
            result = await loadGroupHistory(context.chatId, null, false, historyOptions);
        } else if (context.chatType === 'private' && typeof loadPrivateHistory === 'function') {
            result = await loadPrivateHistory(context.chatId, null, false, historyOptions);
        }
        else if (typeof refreshChatHistory === 'function') result = await refreshChatHistory(context.chatType, context.chatId);
        markTimelineSuffix(forkUid, 'timeline-switch-in');
        const nextAnchor = rowForUid(forkUid);
        if (nextAnchor && Number.isFinite(anchorTop)) {
            window.scrollBy(0, nextAnchor.getBoundingClientRect().top - anchorTop);
        }
        scheduleForkPointQuery(true);
        return result;
    };

    const confirmGlobalSwitch = impact => new Promise(resolve => {
        const categories = impact.categories || {};
        const root = timelineSheet('切换全局时间线', `
            <div class="timeline-impact-summary">
                <p>全局时间线会改变所有聊天共享的叙事世界状态。</p>
                <dl>
                    <div><dt>聊天消息</dt><dd>${Number(categories.messages || 0)}</dd></div>
                    <div><dt>相关会话</dt><dd>${Number(categories.conversations || 0)}</dd></div>
                    <div><dt>活动剧情</dt><dd>${Number(categories.active_stories || 0)}</dd></div>
                    <div><dt>记忆与信赖</dt><dd>${Number(categories.memory_trust || 0)}</dd></div>
                    <div><dt>事务与财务</dt><dd>${Number(categories.tasks || 0) + Number(categories.finance || 0)}</dd></div>
                </dl>
                <div class="timeline-confirm-actions">
                    <button type="button" data-timeline-cancel>取消</button>
                    <button type="button" class="button-primary" data-timeline-confirm>确认切换</button>
                </div>
            </div>`);
        const finish = value => {
            root.classList.add('hidden');
            resolve(value);
        };
        root.querySelector('[data-timeline-cancel]').onclick = () => finish(false);
        root.querySelector('[data-timeline-confirm]').onclick = () => finish(true);
    });

    const switchTimelineBranch = async (branch, forkUid) => {
        const context = timelineContext();
        const scopeType = branch.scope_type || 'conversation';
        const scopeKey = scopeType === 'global' ? 'global' : context.conversationKey;
        if (scopeType === 'global') {
            const impact = await timelineRequest(
                `/timeline/branches/${encodeURIComponent(branch.branch_id)}/switch-impact?scope_type=global&scope_key=global`
            );
            if (!await confirmGlobalSwitch(impact)) return;
        }
        document.dispatchEvent(new CustomEvent('zoot:timeline-will-switch', {
            detail: {conversationKey: context.conversationKey, branchId: branch.branch_id}
        }));
        const result = await timelineRequest(
            `/timeline/branches/${encodeURIComponent(branch.branch_id)}/switch?scope_type=${encodeURIComponent(scopeType)}&scope_key=${encodeURIComponent(scopeKey)}`,
            {method: 'POST'}
        );
        timelineState.activeBranchId = result.active_branch_id || branch.branch_id;
        timelineState.viewRevision = result.view_revision || '';
        timelineState.forkPoints = new Map();
        timelineState.navigationPoints = new Map();
        timelineState.lastQueryKey = '';
        closeBranchPopover();
        await reloadTimelineConversation(forkUid || branch.fork_message_uid);
        timelineToast(`已切换到「${branch.name || '时间线'}」`);
        document.dispatchEvent(new CustomEvent('zoot:timeline-did-switch', {detail: result}));
    };

    function openTimelineFork(message) {
        const summary = String(message.content || '').replace(/\s+/g, ' ').slice(0, 24);
        const label = `${new Date(Number(message.timestamp || Date.now() / 1000) * 1000).toLocaleString()} · ${summary || '新分支'}`;
        const root = timelineSheet('在新时间线中继续', `<form class="form-stack">
            <p class="form-hint">保留这条消息并隐藏后续消息，分叉位置由服务端按消息 UID 确定。</p>
            <label>名称<input name="name" maxlength="80" value="${escapeTimelineHtml(label)}" required></label>
            <label>范围<select name="scope_type"><option value="conversation">当前单聊天</option><option value="global">全局叙事世界</option></select></label>
            <p class="timeline-global-warning hidden">全局分支会隔离全部叙事世界状态。</p>
            <button class="button-primary">创建并切换</button>
        </form>`);
        const form = root.querySelector('form');
        form.elements.scope_type.value = localStorage.getItem('zoot_timeline_default_scope') || 'conversation';
        const updateWarning = () => root.querySelector('.timeline-global-warning').classList.toggle(
            'hidden',
            form.elements.scope_type.value !== 'global'
        );
        form.elements.scope_type.addEventListener('change', updateWarning);
        updateWarning();
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const submit = form.querySelector('button');
            submit.disabled = true;
            try {
                const branch = await timelineRequest('/timeline/branches', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        name: form.elements.name.value.trim(),
                        scope_type: form.elements.scope_type.value,
                        fork_message_uid: message.message_uid
                    })
                });
                root.classList.add('hidden');
                timelineState.activeBranchId = branch.active_branch_id || branch.branch_id;
                timelineState.viewRevision = branch.view_revision || branch.timeline_context?.view_revision || '';
                timelineState.forkPoints = new Map();
                timelineState.navigationPoints = new Map();
                timelineState.lastQueryKey = '';
                await reloadTimelineConversation(message.message_uid);
                timelineToast('已切换到新时间线');
            } catch (error) {
                timelineToast(error.message, 'error');
            } finally {
                submit.disabled = false;
            }
        });
    }

    function closeBranchPopover() {
        if (!timelineState.popover) return;
        timelineState.popover.remove();
        timelineState.popover = null;
        if (timelineState.outsideHandler) {
            document.removeEventListener('pointerdown', timelineState.outsideHandler);
            timelineState.outsideHandler = null;
        }
    }

    function positionBranchPopover(popover, anchor) {
        const rect = anchor.getBoundingClientRect();
        const width = Math.min(340, window.innerWidth - 24);
        popover.style.width = `${width}px`;
        popover.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width))}px`;
        const height = Math.min(popover.scrollHeight || 320, window.innerHeight - 24);
        const above = rect.top - height - 8;
        popover.style.top = `${above >= 12 ? above : Math.min(window.innerHeight - height - 12, rect.bottom + 8)}px`;
    }

    function openBranchPopover(message, anchor, point) {
        closeBranchPopover();
        const popover = document.createElement('section');
        popover.className = 'timeline-branch-popover';
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', '切换时间线');
        const group = (title, items) => !items?.length ? '' : `
            <section class="timeline-choice-group"><h4>${escapeTimelineHtml(title)}</h4>${items.map(item => `
                <button type="button" class="timeline-choice ${item.is_current ? 'active' : ''}" data-branch-id="${escapeTimelineHtml(item.branch_id)}" data-scope="${escapeTimelineHtml(item.scope_type)}">
                    <span class="timeline-choice-mark">${item.is_current ? ZootIcons.html('check') : item.is_current_path ? ZootIcons.html('pin') : ''}</span>
                    <span><strong>${escapeTimelineHtml(item.name || '未命名时间线')}</strong>
                    <small>${item.is_current ? '当前' : item.is_current_path ? '当前路径，后续仍有分叉' : item.choice_kind === 'parent' ? '原时间线' : '分支'} · ${Number(item.message_count || 0)} 条</small>
                    ${item.last_preview ? `<em>${escapeTimelineHtml(item.last_preview)}</em>` : ''}</span>
                </button>`).join('')}</section>`;
        popover.innerHTML = `
            <header><strong>选择时间线</strong><button type="button" data-close aria-label="关闭"><span data-zoot-icon="close"></span></button></header>
            <div class="timeline-choice-scroll">${group('当前会话', point.conversation)}${group('全局叙事世界', point.global)}</div>
            <footer><button type="button" data-create>在此创建新时间线</button><button type="button" data-open-tree>打开时间树</button></footer>`;
        document.body.appendChild(popover);
        timelineState.popover = popover;
        positionBranchPopover(popover, anchor);
        popover.querySelector('[data-close]').onclick = closeBranchPopover;
        popover.querySelector('[data-create]').onclick = () => {
            closeBranchPopover();
            openTimelineFork(message);
        };
        popover.querySelector('[data-open-tree]').onclick = () => {
            closeBranchPopover();
            openTimelineTree(
                'conversation',
                timelineContext().conversationKey,
                point?.navigation?.fork_message_uid || message.message_uid
            );
        };
        popover.querySelectorAll('[data-branch-id]').forEach(button => {
            button.onclick = async () => {
                const choices = [...(point.conversation || []), ...(point.global || [])];
                const branch = choices.find(item => item.branch_id === button.dataset.branchId
                    && item.scope_type === button.dataset.scope);
                if (!branch || branch.is_current) return;
                button.disabled = true;
                try {
                    await switchTimelineBranch(
                        branch,
                        point?.navigation?.fork_message_uid || message.message_uid
                    );
                } catch (error) {
                    timelineToast(error.message, 'error');
                    button.disabled = false;
                }
            };
        });
        const choices = [...popover.querySelectorAll('.timeline-choice')];
        popover.addEventListener('keydown', event => {
            const current = choices.indexOf(document.activeElement);
            if (event.key === 'Escape') closeBranchPopover();
            if (event.key === 'ArrowDown' && choices.length) {
                event.preventDefault();
                choices[(current + 1 + choices.length) % choices.length].focus();
            }
            if (event.key === 'ArrowUp' && choices.length) {
                event.preventDefault();
                choices[(current - 1 + choices.length) % choices.length].focus();
            }
        });
        (popover.querySelector('.timeline-choice.active') || choices[0] || popover.querySelector('[data-create]')).focus();
        timelineState.outsideHandler = event => {
            if (timelineState.popover && !timelineState.popover.contains(event.target)
                && event.target !== anchor) closeBranchPopover();
        };
        setTimeout(() => document.addEventListener('pointerdown', timelineState.outsideHandler), 0);
    }

    async function queryForkPoints() {
        const context = timelineContext();
        if (!context.chatId) return;
        const list = typeof messages !== 'undefined' ? (messages[context.conversationKey] || []) : [];
        const uids = [...new Set(list.map(item => item.message_uid).filter(Boolean))].slice(-100);
        if (!uids.length) return;
        const queryKey = `${context.conversationKey}:${uids.join(',')}`;
        if (queryKey === timelineState.lastQueryKey) return;
        timelineState.lastQueryKey = queryKey;
        try {
            const data = await timelineRequest('/timeline/fork-points/query', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({conversation_key: context.conversationKey, message_uids: uids})
            });
            if (timelineContext().conversationKey !== context.conversationKey) return;
            timelineState.forkPoints = new Map(Object.entries(data.fork_points || {}));
            timelineState.navigationPoints = new Map();
            timelineState.forkPoints.forEach((point, forkMessageUid) => {
                const displayMessageUid = point?.navigation?.display_message_uid;
                timelineState.navigationPoints.set(
                    String(displayMessageUid || forkMessageUid),
                    point
                );
            });
            timelineState.activeBranchId = data.active_branch_id || 'main';
            timelineState.viewRevision = data.view_revision || '';
            updateTimelineForkActions();
        } catch (error) {
            timelineState.lastQueryKey = '';
            console.warn('[timeline] 分叉点查询失败', error);
        }
    }

    function scheduleForkPointQuery(force = false) {
        if (force) timelineState.lastQueryKey = '';
        clearTimeout(timelineState.queryTimer);
        timelineState.queryTimer = setTimeout(queryForkPoints, 90);
    }

    function updateTimelineForkActions() {
        document.querySelectorAll('.timeline-message-actions[data-message-uid]').forEach(toolbar => {
            const messageUid = toolbar.dataset.messageUid;
            const point = timelineState.navigationPoints.get(messageUid);
            const navigation = point?.navigation || {};
            const busy = timelineState.busyMessageUids.has(String(messageUid));
            toolbar.classList.toggle('is-busy', busy);
            const previous = toolbar.querySelector('[data-timeline-previous]');
            const next = toolbar.querySelector('[data-timeline-next]');
            const menu = toolbar.querySelector('[data-timeline-menu]');
            const updateSwitch = (button, branchId) => {
                if (branchId) button.dataset.branchId = String(branchId);
                else delete button.dataset.branchId;
                button.disabled = busy || !branchId;
            };
            updateSwitch(previous, navigation.previous_branch_id);
            updateSwitch(next, navigation.next_branch_id);
            const count = (point?.conversation?.length || 0) + (point?.global?.length || 0);
            const hasNavigation = count > 0
                || Boolean(navigation.previous_branch_id)
                || Boolean(navigation.next_branch_id);
            toolbar.classList.toggle('create-only', !hasNavigation);
            toolbar.classList.toggle('has-navigation', hasNavigation);
            toolbar.closest('.chat-message-row')?.classList.toggle(
                'timeline-create-only-row',
                !hasNavigation
            );
            menu.disabled = busy || count === 0;
            menu.title = count > 0 ? `选择时间线（${count} 个选择）` : '暂无其他时间线';
            menu.setAttribute(
                'aria-label',
                count > 0 ? `选择时间线，${count} 个选择` : '暂无其他时间线'
            );
        });
        const rows = [...document.querySelectorAll('#chat-messages .chat-message-row')];
        rows.forEach(row => row.classList.remove('timeline-actions-latest'));
        const latest = [...rows].reverse().find(row => row.querySelector('.timeline-message-actions'));
        latest?.classList.add('timeline-actions-latest');
    }

    function timelineMessageActionItems(message) {
        const messageUid = String(message?.message_uid || '');
        if (!messageUid) return [];
        const point = timelineState.navigationPoints.get(messageUid);
        const navigation = point?.navigation || {};
        const count = (point?.conversation?.length || 0) + (point?.global?.length || 0);
        const busy = timelineState.busyMessageUids.has(messageUid);
        const items = [
            { id: 'image', label: '生图', icon: 'camera', enabled: !busy },
            { id: 'timeline-create', label: '新时间线', icon: 'timeline', enabled: !busy }
        ];
        if (navigation.previous_branch_id) {
            items.push({ id: 'timeline-previous', label: '上一线', icon: 'previous', enabled: !busy });
        }
        if (navigation.next_branch_id) {
            items.push({ id: 'timeline-next', label: '下一线', icon: 'next', enabled: !busy });
        }
        if (count > 0) {
            items.push({ id: 'timeline-menu', label: '时间线', icon: 'menu', enabled: !busy });
        }
        return items;
    }

    async function runTimelineMessageAction(action, message, anchor) {
        const messageUid = String(message?.message_uid || '');
        if (!messageUid || timelineState.busyMessageUids.has(messageUid)) return false;
        if (action === 'image') {
            openMessageImageWorkspace(message);
            return true;
        }
        if (action === 'timeline-create') {
            openTimelineFork(message);
            return true;
        }
        const point = timelineState.navigationPoints.get(messageUid);
        if (!point) return false;
        if (action === 'timeline-menu') {
            if (!anchor) return false;
            openBranchPopover(message, anchor, point);
            return true;
        }
        const branchId = action === 'timeline-previous'
            ? point.navigation?.previous_branch_id
            : action === 'timeline-next' ? point.navigation?.next_branch_id : '';
        const branch = point.conversation?.find(item => String(item.branch_id) === String(branchId || ''));
        if (!branch) return false;
        timelineState.busyMessageUids.add(messageUid);
        updateTimelineForkActions();
        try {
            await switchTimelineBranch(branch, point.navigation?.fork_message_uid || messageUid);
            return true;
        } finally {
            timelineState.busyMessageUids.delete(messageUid);
            updateTimelineForkActions();
        }
    }

    function installTimelineForkActions() {
        const container = document.getElementById('chat-messages');
        if (!container) return;
        container.querySelectorAll('.chat-message-row[data-msg-id]').forEach(row => {
            if (row.querySelector('.timeline-message-actions')) return;
            const message = currentTimelineMessage(row);
            const stableId = message?.dbId || message?.db_id || message?.id;
            if (!stableId || !message?.message_uid || message.isFailed || message.cls === 'system'
                || message.is_memory_only || message.isPending || message.pending
                || message.deleted_at || message.is_recalled || message.recalled) return;
            const anchor = row.querySelector('.message-content,.scenario-message-wrapper') || row;
            const toolbar = document.createElement('div');
            toolbar.className = 'timeline-message-actions create-only';
            toolbar.dataset.messageUid = message.message_uid;
            toolbar.innerHTML = `
                <button type="button" class="timeline-image-action" data-message-image title="以这条消息准备生图" aria-label="以这条消息准备生图">
                    ${imageActionIcon()}
                </button>
                <button type="button" class="timeline-fork-action timeline-create-action" data-timeline-create title="在新时间线中继续" aria-label="在新时间线中继续">
                    ${branchIconSvg()}
                </button>
                <span class="timeline-switch-actions" role="group" aria-label="快速切换时间线">
                    <button type="button" class="timeline-switch-action" data-timeline-previous title="上一条时间线" aria-label="上一条时间线" disabled>
                        ${timelineChevronSvg('previous')}
                    </button>
                    <button type="button" class="timeline-switch-action" data-timeline-next title="下一条时间线" aria-label="下一条时间线" disabled>
                        ${timelineChevronSvg('next')}
                    </button>
                </span>
                <button type="button" class="timeline-fork-count timeline-menu-action" data-timeline-menu title="暂无其他时间线" aria-label="暂无其他时间线" disabled>
                    ${timelineMenuSvg()}
                </button>`;
            toolbar.addEventListener('touchstart', event => event.stopPropagation(), {passive: true});
            toolbar.addEventListener('contextmenu', event => event.stopPropagation());
            toolbar.querySelector('[data-message-image]').addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                runTimelineMessageAction('image', message, event.currentTarget);
            });
            toolbar.querySelector('[data-timeline-create]').addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                runTimelineMessageAction('timeline-create', message, event.currentTarget);
            });
            toolbar.querySelectorAll('[data-timeline-previous],[data-timeline-next]').forEach(button => {
                button.addEventListener('click', async event => {
                    event.preventDefault();
                    event.stopPropagation();
                    try {
                        await runTimelineMessageAction(
                            button.hasAttribute('data-timeline-previous') ? 'timeline-previous' : 'timeline-next',
                            message,
                            button
                        );
                    } catch (error) {
                        timelineToast(error.message, 'error');
                    }
                });
            });
            const menu = toolbar.querySelector('[data-timeline-menu]');
            menu.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                if (menu.disabled) return;
                runTimelineMessageAction('timeline-menu', message, menu);
            });
            anchor.appendChild(toolbar);
        });
        updateTimelineForkActions();
        scheduleForkPointQuery();
    }

    let timelineInstallFrame = 0;
    function scheduleTimelineForkActions() {
        if (timelineInstallFrame) return;
        timelineInstallFrame = requestAnimationFrame(() => {
            timelineInstallFrame = 0;
            installTimelineForkActions();
        });
    }

    function initTimelineTreePage() {
        const page = document.getElementById('page-timeline-tree');
        if (!page || page.dataset.timelineTreeBound === '1') return page;
        page.dataset.timelineTreeBound = '1';
        page.querySelector('[data-tree-zoom]').oninput = event => {
            page.querySelector('[data-tree-canvas]').style.setProperty('--timeline-tree-scale', Number(event.target.value) / 100);
        };
        page.querySelector('[data-tree-fit]').onclick = () => {
            const zoom = page.querySelector('[data-tree-zoom]');
            zoom.value = '100';
            zoom.dispatchEvent(new Event('input'));
            page.querySelector('.timeline-tree-viewport').scrollTo({left: 0, top: 0, behavior: 'smooth'});
        };
        page.querySelector('[data-tree-current]').onclick = () => {
            page.querySelector('.timeline-tree-node.current')?.scrollIntoView({
                behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                block: 'center',
                inline: 'center'
            });
        };
        const applyFilters = () => {
            const keyword = page.querySelector('[data-tree-search]').value.trim().toLowerCase();
            const activeOnly = page.querySelector('[data-tree-active-only]').checked;
            page.querySelectorAll('.timeline-tree-node').forEach(node => {
                const hidden = (keyword && !node.textContent.toLowerCase().includes(keyword))
                    || (activeOnly && node.dataset.currentPath !== 'true');
                node.classList.toggle('filtered', hidden);
            });
        };
        page.querySelector('[data-tree-search]').oninput = applyFilters;
        page.querySelector('[data-tree-active-only]').onchange = applyFilters;
        return page;
    }

    const treeImpactBadges = impact => {
        const labels = {
            messages: '聊天',
            stories: '剧情',
            memory_trust: '记忆/信赖',
            tasks: '事务',
            finance: '财务',
            dynamics: '动态'
        };
        return Object.entries(labels)
            .filter(([key]) => Number(impact?.[key] || 0) > 0)
            .map(([key, label]) => `<span>${label} ${Number(impact[key])}</span>`)
            .join('');
    };

    function renderTimelineTree(page, data, focusMessageUid) {
        const canvas = page.querySelector('[data-tree-canvas]');
        const nodes = data.nodes || [];
        const activeCount = nodes.filter(node => node.status !== 'archived').length;
        const archivedCount = nodes.length - activeCount;
        const current = nodes.find(node => node.is_current);
        page.querySelector('[data-tree-summary]').innerHTML = `
            <span><strong>${nodes.length}</strong> 全部分支</span>
            <span><strong>${activeCount}</strong> 活动</span>
            <span><strong>${archivedCount}</strong> 归档</span>
            <span class="is-current">当前：${escapeTimelineHtml(current?.name || '主时间线')}</span>`;
        const byId = new Map(nodes.map(node => [String(node.branch_id), node]));
        const children = new Map();
        (data.edges || []).forEach(edge => {
            const list = children.get(String(edge.source)) || [];
            list.push(String(edge.target));
            children.set(String(edge.source), list);
        });
        const renderNode = (nodeId, seen = new Set()) => {
            if (seen.has(nodeId)) return '';
            seen.add(nodeId);
            const node = byId.get(nodeId);
            if (!node) return '';
            const fork = node.fork_message || {};
            const subtitle = data.scope_type === 'global'
                ? `${Number(node.conversation_count || 0)} 个会话 · ${Number(node.message_count || 0)} 条消息`
                : `${fork.sender_eng ? `${escapeTimelineHtml(fork.sender_eng)} · ` : ''}${escapeTimelineHtml(fork.preview || '起始时间线')}`;
            const descendants = (children.get(nodeId) || []).map(childId => renderNode(childId, new Set(seen))).join('');
            return `<div class="timeline-tree-branch">
                <button type="button" class="timeline-tree-node ${node.is_current ? 'current' : ''} ${node.is_current_path ? 'current-path' : ''}" data-tree-node="${escapeTimelineHtml(nodeId)}" data-current-path="${node.is_current_path ? 'true' : 'false'}" data-fork-uid="${escapeTimelineHtml(node.fork_message_uid || '')}">
                    <span class="timeline-tree-node-dot"></span>
                    <strong>${escapeTimelineHtml(node.name || '未命名时间线')}</strong>
                    <small>${subtitle}</small>
                    ${data.scope_type === 'global' ? `<span class="timeline-impact-badges">${treeImpactBadges(node.impact)}</span>` : ''}
                    <span class="timeline-status-tags">
                        ${node.is_current ? '<em class="is-current">当前</em>' : ''}
                        ${node.is_current_path && !node.is_current ? '<em class="is-path">路径</em>' : ''}
                        ${node.status === 'archived' ? '<em class="is-archived">归档</em>' : ''}
                        ${data.scope_type === 'global' ? '<em class="is-global">全局</em>' : ''}
                    </span>
                </button>
                ${descendants ? `<div class="timeline-tree-children">${descendants}</div>` : ''}
            </div>`;
        };
        const roots = nodes.filter(node => !node.parent_branch_id || !byId.has(String(node.parent_branch_id)));
        canvas.innerHTML = `<div class="timeline-tree-root">${roots.map(node => renderNode(String(node.branch_id))).join('') || '<div class="zoot-management-empty"><strong>还没有可显示的时间线</strong><p>返回聊天，在任意已保存消息下方选择“在新时间线中继续”。</p></div>'}</div>`;
        canvas.querySelectorAll('[data-tree-node]').forEach(button => {
            button.onclick = () => openTimelineTreeNode(data, byId.get(button.dataset.treeNode));
        });
        const focus = focusMessageUid
            ? canvas.querySelector(`[data-fork-uid="${String(focusMessageUid)}"]`)
            : canvas.querySelector('.timeline-tree-node.current');
        setTimeout(() => focus?.scrollIntoView({block: 'center'}), 0);
    }

    function openTimelineTreeNode(data, branch) {
        if (!branch) return;
        const fork = branch.fork_message || {};
        const root = timelineSheet(branch.name || '时间线详情', `
            <div class="timeline-node-detail">
                <p>${escapeTimelineHtml(fork.preview || '主时间线起点')}</p>
                <small>${Number(branch.message_count || 0)} 条消息 · ${branch.status || 'active'}</small>
                <div class="timeline-impact-badges">${treeImpactBadges(branch.impact)}</div>
                <div class="timeline-confirm-actions">
                    ${branch.is_current ? '<span>当前正在使用</span>' : '<button type="button" class="button-primary" data-tree-switch>切换到此时间线</button>'}
                    ${branch.branch_id !== 'main' && branch.status !== 'archived' ? '<button type="button" data-tree-archive>归档</button>' : ''}
                </div>
            </div>`);
        const switchButton = root.querySelector('[data-tree-switch]');
        if (switchButton) switchButton.onclick = async () => {
            switchButton.disabled = true;
            try {
                const switchTarget = branch.branch_id === 'main' && data.scope_type === 'conversation'
                    ? {...branch, scope_type: 'conversation', scope_key: data.scope_key}
                    : branch;
                await switchTimelineBranch(switchTarget, branch.fork_message_uid);
                root.classList.add('hidden');
                await openTimelineTree(data.scope_type, data.scope_key, branch.fork_message_uid);
            } catch (error) {
                timelineToast(error.message, 'error');
                switchButton.disabled = false;
            }
        };
        const archiveButton = root.querySelector('[data-tree-archive]');
        if (archiveButton) archiveButton.onclick = async () => {
            await timelineRequest(`/timeline/branches/${encodeURIComponent(branch.branch_id)}`, {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: '{"archived":true}'
            });
            root.classList.add('hidden');
            await openTimelineTree(data.scope_type, data.scope_key);
        };
    }

    async function openTimelineTree(scopeType = 'conversation', scopeKey = '', focusMessageUid = '') {
        const context = timelineContext();
        const normalizedScope = scopeType === 'global' ? 'global' : 'conversation';
        const normalizedKey = normalizedScope === 'global' ? 'global' : (scopeKey || context.conversationKey);
        if (normalizedScope === 'conversation' && !normalizedKey.match(/^(private|group):.+/)) {
            timelineToast('请先打开一个私聊或群聊', 'error');
            return;
        }
        const page = initTimelineTreePage();
        if (!page) {
            timelineToast('时间树页面未加载', 'error');
            return;
        }
        page.dataset.scopeType = normalizedScope;
        page.dataset.scopeKey = normalizedKey;
        page.querySelector('#timeline-tree-title').textContent = normalizedScope === 'global'
            ? '全局世界时间树'
            : `${normalizedKey.startsWith('group:') ? '群聊' : '私聊'}时间树`;
        page.querySelector('[data-tree-canvas]').textContent = '正在加载时间树…';
        if (typeof showPage === 'function') showPage('timeline-tree');
        try {
            const data = await timelineRequest(
                `/timeline/tree?scope_type=${encodeURIComponent(normalizedScope)}&scope_key=${encodeURIComponent(normalizedKey)}`
            );
            renderTimelineTree(page, data, focusMessageUid);
        } catch (error) {
            page.querySelector('[data-tree-canvas]').textContent = error.message;
        }
    }

    async function openTimelineManager() {
        const page = document.getElementById('page-timeline-manager');
        const summary = page?.querySelector('[data-timeline-manager-summary]');
        const list = page?.querySelector('[data-timeline-manager-list]');
        if (!page || !summary || !list) {
            timelineToast('时间线管理页面未加载', 'error');
            return;
        }
        if (typeof showPage === 'function') showPage('timeline-manager');
        list.innerHTML = '<div class="zoot-management-empty"><strong>正在加载时间线</strong><p>请稍候…</p></div>';
        try {
            const data = await timelineRequest('/timeline/branches?include_archived=true');
            const branches = data.branches || [];
            const rows = branches.map(branch => `<article class="timeline-node ${branch.branch_id === data.active_branch_id ? 'active' : ''}">
                <div><strong>${escapeTimelineHtml(branch.name)}</strong><small>${escapeTimelineHtml(branch.scope_type === 'global' ? '全局世界' : branch.scope_key)} · ${Number(branch.message_count || 0)} 条消息</small><span class="timeline-status-tags">${branch.branch_id === data.active_branch_id ? '<em class="is-current">当前</em>' : ''}${branch.status === 'archived' ? '<em class="is-archived">归档</em>' : '<em class="is-path">活动</em>'}${branch.scope_type === 'global' ? '<em class="is-global">全局</em>' : ''}</span></div>
                <div><button data-rename="${escapeTimelineHtml(branch.branch_id)}">重命名</button>${branch.status === 'archived' ? `<button data-restore="${escapeTimelineHtml(branch.branch_id)}">恢复</button><button data-delete="${escapeTimelineHtml(branch.branch_id)}">删除</button>` : `${branch.branch_id !== 'main' ? `<button data-archive="${escapeTimelineHtml(branch.branch_id)}">归档</button>` : ''}<button data-switch="${escapeTimelineHtml(branch.branch_id)}">切换</button>`}</div>
            </article>`).join('');
            const activeCount = branches.filter(branch => branch.status !== 'archived').length;
            summary.innerHTML = `<span><strong>${branches.length}</strong> 全部</span><span><strong>${activeCount}</strong> 活动</span><span><strong>${branches.length - activeCount}</strong> 归档</span>`;
            list.innerHTML = rows || '<div class="zoot-management-empty"><strong>暂无时间线</strong><p>请从聊天消息下方的分支按钮创建第一条时间线。</p></div>';
            page.querySelector('#timeline-filter').value = '';
            page.querySelector('#timeline-filter').oninput = event => {
                const keyword = event.target.value.trim().toLowerCase();
                list.querySelectorAll('.timeline-node').forEach(node => node.classList.toggle('hidden', !node.textContent.toLowerCase().includes(keyword)));
            };
            page.querySelector('#timeline-export').onclick = async () => {
                const payload = await timelineRequest('/timeline/export');
                const link = document.createElement('a');
                link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'}));
                link.download = `zoot-timeline-${Date.now()}.json`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(link.href), 1000);
            };
            const refresh = () => openTimelineManager();
            list.querySelectorAll('[data-rename]').forEach(button => button.onclick = async () => {
                const branch = data.branches.find(item => item.branch_id === button.dataset.rename);
                const name = prompt('时间线名称', branch?.name || '');
                if (!name?.trim()) return;
                await timelineRequest(`/timeline/branches/${button.dataset.rename}`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: name.trim()})});
                refresh();
            });
            list.querySelectorAll('[data-archive]').forEach(button => button.onclick = async () => {
                await timelineRequest(`/timeline/branches/${button.dataset.archive}`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: '{"archived":true}'});
                refresh();
            });
            list.querySelectorAll('[data-restore]').forEach(button => button.onclick = async () => {
                await timelineRequest(`/timeline/branches/${button.dataset.restore}`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: '{"archived":false}'});
                refresh();
            });
            list.querySelectorAll('[data-delete]').forEach(button => button.onclick = async () => {
                const impact = await timelineRequest(`/timeline/branches/${button.dataset.delete}/impact`);
                if (!impact.deletable || !confirm(`永久删除该时间线？消息 ${impact.messages} 条，活动剧情 ${impact.active_stories} 个。`)) return;
                await timelineRequest(`/timeline/branches/${button.dataset.delete}`, {method: 'DELETE'});
                refresh();
            });
            list.querySelectorAll('[data-switch]').forEach(button => button.onclick = async () => {
                const branch = data.branches.find(item => item.branch_id === button.dataset.switch);
                await switchTimelineBranch(branch, branch.fork_message_uid);
                refresh();
            });
        } catch (error) {
            list.innerHTML = `<div class="zoot-management-empty"><strong>加载失败</strong><p>${escapeTimelineHtml(error.message)}</p></div>`;
            timelineToast(error.message, 'error');
        }
    }

    function installTimelineSettings() {
        const page = document.getElementById('page-settings-timeline');
        if (!page || page.dataset.timelineSettingsBound === '1') return;
        page.dataset.timelineSettingsBound = '1';
        const scope = page.querySelector('#timeline-default-scope');
        scope.value = localStorage.getItem('zoot_timeline_default_scope') || 'conversation';
        scope.onchange = () => localStorage.setItem('zoot_timeline_default_scope', scope.value);
        const conversationButton = page.querySelector('#timeline-open-conversation-tree');
        const refreshConversationState = () => {
            const key = timelineContext().conversationKey;
            const available = /^(private|group):.+/.test(key);
            conversationButton.disabled = !available;
            page.querySelector('[data-conversation-reason]').textContent = available
                ? `当前：${key}`
                : '请先打开一个私聊或群聊';
        };
        refreshConversationState();
        page.addEventListener('click', refreshConversationState);
        conversationButton.onclick = () => openTimelineTree(
            'conversation', timelineContext().conversationKey
        );
        page.querySelector('#timeline-open-global-tree').onclick = () => openTimelineTree('global', 'global');
        page.querySelector('#timeline-open-manager').onclick = openTimelineManager;
    }

    document.addEventListener('DOMContentLoaded', () => {
        installTimelineSettings();
        initTimelineTreePage();
        installTimelineForkActions();
        const chat = document.getElementById('chat-messages');
        if (chat) {
            new MutationObserver(scheduleTimelineForkActions).observe(chat, {
                childList: true
            });
        }
    });

    window.openTimelineManager = openTimelineManager;
    window.openTimelineTree = openTimelineTree;
    window.refreshTimelineMessageActions = scheduleTimelineForkActions;
    window.ZootTimelineMessageActions = Object.freeze({
        items: timelineMessageActionItems,
        run: runTimelineMessageAction
    });
    window.getZootTimelineContext = () => ({
        conversationKey: timelineContext().conversationKey,
        activeBranchId: timelineState.activeBranchId || 'main',
        viewRevision: timelineState.viewRevision || '',
    });
    window.zootTimelineAcceptMessage = (payload, conversationKey) => {
        if (!payload?.branch_id || !timelineState.activeBranchId) return true;
        if (conversationKey && conversationKey !== timelineContext().conversationKey) return true;
        return String(payload.branch_id) === String(timelineState.activeBranchId);
    };
})();
