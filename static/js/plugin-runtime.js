(function (global) {
    'use strict';

    const state = {
        initialized: false,
        plugins: new Map(),
        mounted: new Map(),
        frames: new Map(),
        installPreview: null,
        activePageFrameKey: null,
    };

    const permissionLabels = {
        'ui:navigation': '添加导航入口',
        'ui:notify': '显示应用内提示',
        'ui:settings': '添加设置内容',
        'ui:extension_page': '添加扩展页',
        'ui:chat_toolbar': '添加聊天工具按钮',
        'ui:message_card': '渲染自定义消息卡片',
        'ui:profile_widget': '在个人信息卡显示小组件',
        'ui:sandbox': '运行沙箱界面',
        'chat:read_current': '读取当前聊天',
        'chat:read_all': '读取全部聊天',
        'chat:write': '发送聊天消息',
        'chat:format_response': '整理成功回复末尾的声明式附加区块',
        'operator:read_public': '读取干员公开资料',
        'memory:read': '读取记忆',
        'todo:read': '读取事务状态',
        'todo:write': '创建或修改事务',
        'timeline:read': '读取时间线状态',
        'prompt:contribute': '向 Prompt 追加插件上下文',
        'tool:register': '注册模型工具',
        'network:fetch': '访问外部网络',
        'file:import': '导入文件',
        'file:export': '导出文件',
        'storage:plugin': '使用插件私有存储',
        'system:trusted_python': '运行可信 Python 代码',
    };

    function toast(message, type = 'info') {
        if (typeof global.showToast === 'function') {
            global.showToast(message, type);
        } else {
            console[type === 'error' ? 'error' : 'log']('[Plugin]', message);
        }
    }

    async function api(path, options = {}) {
        const response = await fetch(`/api/plugins${path}`, options);
        const text = await response.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        } catch (_) {
            data = { detail: text };
        }
        if (!response.ok) {
            throw new Error(data.detail || `插件请求失败：${response.status}`);
        }
        return data;
    }

    function requestJson(method, body) {
        return {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
        };
    }

    function statusLabel(plugin) {
        const labels = {
            installed: '已安装',
            disabled: '已停用',
            starting: '启动中',
            active: '运行中',
            error: '错误',
            quarantined: '已隔离',
            incompatible: '不兼容',
            update_pending: '待更新',
        };
        return labels[plugin.status] || plugin.status || '未知';
    }

    function riskLabel(risk) {
        return { low: '低', medium: '中', high: '高', critical: '极高' }[risk] || '中';
    }

    function clearMount(pluginId) {
        const mounted = state.mounted.get(pluginId) || [];
        mounted.forEach(element => element.remove());
        state.mounted.delete(pluginId);
        Array.from(state.frames.entries()).forEach(([key, record]) => {
            if (record.pluginId !== pluginId) return;
            record.frame.remove();
            state.frames.delete(key);
            if (state.activePageFrameKey === key) state.activePageFrameKey = null;
        });
    }

    function registerFrame(plugin, contribution, frame, surface) {
        const contributionId = contribution.id || contribution.entry || surface;
        const key = `${plugin.id}:${surface}:${contributionId}:${Date.now()}:${Math.random()}`;
        state.frames.set(key, {
            key,
            pluginId: plugin.id,
            contributionId,
            frame,
            surface,
        });
        return key;
    }

    function unregisterFrame(key) {
        const record = state.frames.get(key);
        if (record) record.frame.remove();
        state.frames.delete(key);
        if (state.activePageFrameKey === key) state.activePageFrameKey = null;
    }

    function frameRecordForSource(source) {
        return Array.from(state.frames.values()).find(record => record.frame.contentWindow === source) || null;
    }

    function broadcastPluginMessage(pluginId, message) {
        state.frames.forEach(record => {
            if (record.pluginId === pluginId && record.frame.contentWindow) {
                record.frame.contentWindow.postMessage(message, '*');
            }
        });
    }

    async function invoke(pluginId, action, payload = {}) {
        const result = await api(`/${encodeURIComponent(pluginId)}/actions/${encodeURIComponent(action)}`, requestJson('POST', { payload }));
        const command = result.client_command;
        if (command?.type === 'toast') toast(command.message || '插件操作已完成', 'success');
        if (command?.type === 'navigate' && typeof global.showPage === 'function') global.showPage(command.page);
        if (command?.type === 'open_plugin_page') {
            const plugin = state.plugins.get(command.plugin_id || pluginId);
            const page = (plugin?.contributions?.extension_pages || []).find(item => item?.id === command.page_id);
            if (plugin && page) openPluginPage(plugin, page);
        }
        if (command?.type === 'plugin_config_changed') {
            applyPluginConfigVisibility(pluginId, result.config || {});
            broadcastPluginMessage(pluginId, {
                zootPluginEvent: {
                    type: 'config_changed',
                    config: result.config || {},
                    revision: result.revision,
                },
            });
        }
        return result;
    }

    function openSandbox(plugin, contribution) {
        const overlay = document.createElement('div');
        overlay.className = 'app-modal-overlay plugin-sandbox-overlay';
        const sheet = document.createElement('section');
        sheet.className = 'bottom-sheet plugin-sandbox-sheet';
        const header = document.createElement('div');
        header.className = 'plugin-sandbox-header';
        const title = document.createElement('h3');
        title.textContent = contribution.label || plugin.name;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'button-secondary';
        close.textContent = '关闭';
        header.append(title, close);
        const frame = document.createElement('iframe');
        frame.className = 'plugin-sandbox-frame';
        frame.sandbox = 'allow-scripts';
        frame.referrerPolicy = 'no-referrer';
        frame.src = `/api/plugins/${encodeURIComponent(plugin.id)}/assets/${String(contribution.entry || '').replace(/^\/+/, '')}`;
        frame.title = `${plugin.name} 沙箱页面`;
        sheet.append(header, frame);
        overlay.appendChild(sheet);
        document.body.appendChild(overlay);
        const frameKey = registerFrame(plugin, contribution, frame, 'sheet');
        const dismiss = () => {
            overlay.remove();
            state.frames.delete(frameKey);
        };
        close.addEventListener('click', dismiss);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) dismiss();
        });
    }

    function openPluginPage(plugin, contribution) {
        const host = document.getElementById('plugin-page-frame-container');
        const title = document.getElementById('plugin-page-title');
        if (!host || !contribution?.entry) {
            toast('插件页面宿主不可用', 'error');
            return;
        }
        if (state.activePageFrameKey) unregisterFrame(state.activePageFrameKey);
        host.replaceChildren();
        const frame = document.createElement('iframe');
        frame.className = 'plugin-page-frame';
        frame.sandbox = 'allow-scripts';
        frame.referrerPolicy = 'no-referrer';
        frame.src = `/api/plugins/${encodeURIComponent(plugin.id)}/assets/${String(contribution.entry).replace(/^\/+/, '')}`;
        frame.title = contribution.label || plugin.name;
        host.appendChild(frame);
        state.activePageFrameKey = registerFrame(plugin, contribution, frame, 'page');
        if (title) title.textContent = contribution.label || plugin.name;
        if (typeof global.showPage === 'function') global.showPage('plugin-host');
    }

    function applyPluginConfigVisibility(pluginId, config) {
        document.querySelectorAll(`.plugin-profile-widget[data-plugin-id="${CSS.escape(pluginId)}"]`).forEach(wrapper => {
            const key = wrapper.dataset.configKey;
            const fallback = wrapper.dataset.defaultVisible !== 'false';
            wrapper.hidden = key ? Boolean(config[key] ?? fallback) === false : false;
        });
    }

    async function mountProfileWidgets(plugin, contributions, elements) {
        const slot = document.getElementById('plugin-profile-widget-slot');
        if (!slot || !contributions.length) return;
        let config = {};
        try {
            config = (await api(`/${encodeURIComponent(plugin.id)}/config`)).config || {};
        } catch (_) {
            config = {};
        }
        contributions.forEach(contribution => {
            if (!contribution?.entry || contribution.slot !== 'profile_card_below_ap') return;
            const wrapper = document.createElement('div');
            wrapper.className = 'plugin-profile-widget';
            wrapper.dataset.pluginId = plugin.id;
            wrapper.dataset.configKey = contribution.visible_config_key || '';
            wrapper.dataset.defaultVisible = String(contribution.default_visible !== false);
            const frame = document.createElement('iframe');
            frame.className = 'plugin-profile-widget-frame';
            frame.sandbox = 'allow-scripts';
            frame.referrerPolicy = 'no-referrer';
            frame.src = `/api/plugins/${encodeURIComponent(plugin.id)}/assets/${String(contribution.entry).replace(/^\/+/, '')}`;
            frame.title = contribution.label || `${plugin.name} 小组件`;
            wrapper.appendChild(frame);
            slot.appendChild(wrapper);
            registerFrame(plugin, contribution, frame, 'profile-widget');
            elements.push(wrapper);
        });
        applyPluginConfigVisibility(plugin.id, config);
    }

    async function mountContributions(plugin) {
        clearMount(plugin.id);
        if (plugin.status !== 'active') return;
        const contributions = plugin.contributions || {};
        const elements = [];
        const extensionPages = Array.isArray(contributions.extension_pages) ? contributions.extension_pages : [];
        const extensionList = document.getElementById('plugin-extension-list');
        extensionPages.forEach(page => {
            if (!extensionList || !page || !page.label) return;
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'extension-item plugin-contribution-item';
            item.dataset.pluginId = plugin.id;
            const icon = document.createElement('span');
            icon.className = 'extension-icon';
            icon.textContent = page.icon_text || '◇';
            const label = document.createElement('span');
            label.className = 'extension-title';
            label.textContent = page.label;
            item.append(icon, label);
            item.addEventListener('click', () => {
                if (page.kind === 'sandbox' && page.entry && page.presentation === 'page') openPluginPage(plugin, page);
                else if (page.kind === 'sandbox' && page.entry) openSandbox(plugin, page);
                else if (page.action) invoke(plugin.id, page.action).catch(error => toast(error.message, 'error'));
            });
            extensionList.appendChild(item);
            elements.push(item);
        });
        const toolbar = document.querySelector('.input-toolbar .toolbar-left, .chat-input-toolbar');
        const buttons = Array.isArray(contributions.chat_toolbar) ? contributions.chat_toolbar : [];
        buttons.forEach(config => {
            if (!toolbar || !config || !config.action) return;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'toolbar-btn plugin-toolbar-button';
            button.dataset.pluginId = plugin.id;
            button.textContent = config.icon_text || '◇';
            button.title = config.label || plugin.name;
            button.addEventListener('click', () => invoke(plugin.id, config.action, {
                page: global.currentPage || null,
                chat_type: global.currentGroupId ? 'group' : 'private',
                chat_id: global.currentGroupId || global.currentOperatorId || null,
            }).catch(error => toast(error.message, 'error')));
            toolbar.appendChild(button);
            elements.push(button);
        });
        const profileWidgets = Array.isArray(contributions.profile_widgets) ? contributions.profile_widgets : [];
        await mountProfileWidgets(plugin, profileWidgets, elements);
        state.mounted.set(plugin.id, elements);
    }

    function createButton(text, className, action, disabled = false) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = text;
        button.disabled = disabled;
        button.addEventListener('click', action);
        return button;
    }

    function openConfig(plugin) {
        const schema = plugin.config_schema;
        if (!schema || !schema.properties) {
            toast('该插件没有可配置项目');
            return;
        }
        api(`/${encodeURIComponent(plugin.id)}/config`).then(result => {
            const overlay = document.createElement('div');
            overlay.className = 'app-modal-overlay';
            const sheet = document.createElement('section');
            sheet.className = 'bottom-sheet plugin-config-sheet';
            const title = document.createElement('h3');
            title.textContent = `${plugin.name} 设置`;
            const form = document.createElement('form');
            form.className = 'settings-form plugin-config-form';
            const values = result.config || {};
            Object.entries(schema.properties).forEach(([key, definition]) => {
                if (definition.ui_hidden === true) return;
                const row = document.createElement('label');
                row.className = 'settings-row';
                const copy = document.createElement('span');
                copy.className = 'settings-row-copy';
                const name = document.createElement('strong');
                name.textContent = definition.title || key;
                const hint = document.createElement('small');
                hint.textContent = definition.description || (definition.secret ? '设备本地敏感配置' : '');
                copy.append(name, hint);
                let input;
                if (definition.type === 'boolean') {
                    input = document.createElement('input');
                    input.type = 'checkbox';
                    input.checked = Boolean(values[key] ?? definition.default);
                } else if (Array.isArray(definition.enum)) {
                    input = document.createElement('select');
                    definition.enum.forEach((option, index) => {
                        const node = document.createElement('option');
                        node.value = String(option);
                        node.textContent = Array.isArray(definition.enum_labels)
                            ? String(definition.enum_labels[index] ?? option)
                            : String(option);
                        input.appendChild(node);
                    });
                    input.value = String(values[key] ?? definition.default ?? '');
                } else {
                    input = document.createElement('input');
                    input.type = definition.secret ? 'password' : definition.type === 'number' || definition.type === 'integer' ? 'number' : 'text';
                    input.value = values[key] ?? definition.default ?? '';
                    if (definition.secret && result.secret_fields?.[key]) input.placeholder = '已安全保存，留空保持不变';
                    if (definition.minimum !== undefined) input.min = definition.minimum;
                    if (definition.maximum !== undefined) input.max = definition.maximum;
                }
                input.name = key;
                input.className = 'settings-control';
                input.dataset.valueType = definition.type || 'string';
                row.append(copy, input);
                form.appendChild(row);
            });
            const actions = document.createElement('div');
            actions.className = 'plugin-dialog-actions';
            const cancel = createButton('取消', 'button-secondary', () => overlay.remove());
            const save = createButton('保存', 'button-primary', async event => {
                event.preventDefault();
                const config = { ...values };
                form.querySelectorAll('[name]').forEach(input => {
                    const type = input.dataset.valueType;
                    if (type === 'boolean') config[input.name] = input.checked;
                    else if (type === 'number') config[input.name] = Number(input.value);
                    else if (type === 'integer') config[input.name] = Number.parseInt(input.value, 10);
                    else config[input.name] = input.value;
                });
                try {
                    await api(`/${encodeURIComponent(plugin.id)}/config`, requestJson('PUT', {
                        config,
                        expected_revision: result.revision,
                    }));
                    overlay.remove();
                    toast('插件设置已保存', 'success');
                    await loadPlugins();
                } catch (error) {
                    toast(error.message, 'error');
                }
            });
            actions.append(cancel, save);
            sheet.append(title, form, actions);
            overlay.appendChild(sheet);
            document.body.appendChild(overlay);
        }).catch(error => toast(error.message, 'error'));
    }

    async function pluginOperation(plugin, operation, body = null) {
        const options = body === null ? { method: 'POST' } : requestJson('POST', body);
        try {
            await api(`/${encodeURIComponent(plugin.id)}/${operation}`, options);
            toast('插件状态已更新', 'success');
            await loadPlugins();
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    function renderPlugin(plugin) {
        const card = document.createElement('article');
        card.className = `plugin-card plugin-status-${plugin.status || 'unknown'}`;
        const heading = document.createElement('div');
        heading.className = 'plugin-card-heading';
        const identity = document.createElement('div');
        const name = document.createElement('h4');
        name.textContent = plugin.name;
        const meta = document.createElement('p');
        meta.textContent = `${plugin.id} · v${plugin.version} · ${plugin.kind}`;
        identity.append(name, meta);
        const status = document.createElement('span');
        status.className = `plugin-status-badge status-${plugin.status}`;
        status.textContent = statusLabel(plugin);
        heading.append(identity, status);
        const description = document.createElement('p');
        description.className = 'plugin-description';
        description.textContent = plugin.description || '该插件没有提供说明。';
        const permissionList = document.createElement('div');
        permissionList.className = 'plugin-permissions';
        (plugin.permissions || []).forEach(permission => {
            const badge = document.createElement('span');
            const risk = plugin.permission_risks?.[permission] || 'medium';
            badge.className = `plugin-permission risk-${risk}`;
            badge.textContent = `${permissionLabels[permission] || permission} · ${riskLabel(risk)}`;
            permissionList.appendChild(badge);
        });
        const error = document.createElement('p');
        error.className = 'plugin-error';
        error.hidden = !plugin.last_error;
        error.textContent = plugin.last_error ? `最近错误：${plugin.last_error}` : '';
        const actions = document.createElement('div');
        actions.className = 'plugin-card-actions';
        if (plugin.status === 'active') {
            actions.appendChild(createButton('停用', 'button-secondary', () => pluginOperation(plugin, 'disable')));
        } else if (plugin.status === 'quarantined') {
            actions.appendChild(createButton('解除隔离', 'button-secondary', () => pluginOperation(plugin, 'recover')));
        } else if (plugin.status === 'starting') {
            actions.appendChild(createButton('正在启动', 'button-secondary', () => {}, true));
        } else {
            actions.appendChild(createButton('启用', 'button-primary', () => pluginOperation(plugin, 'enable'), !plugin.compatible));
        }
        if (plugin.config_schema) actions.appendChild(createButton('设置', 'button-secondary', () => openConfig(plugin)));
        if ((plugin.previous_versions || []).length) actions.appendChild(createButton('回滚', 'button-secondary', () => pluginOperation(plugin, 'rollback', {})));
        actions.appendChild(createButton('卸载', 'button-danger', async () => {
            if (!global.confirm(`确定卸载“${plugin.name}”吗？插件私有配置将保留。`)) return;
            try {
                await api(`/${encodeURIComponent(plugin.id)}`, { method: 'DELETE' });
                clearMount(plugin.id);
                await loadPlugins();
            } catch (error) {
                toast(error.message, 'error');
            }
        }));
        card.append(heading, description, permissionList, error, actions);
        return card;
    }

    async function loadPlugins() {
        const list = document.getElementById('plugin-list');
        if (!list) return;
        try {
            const result = await api('');
            const plugins = result.plugins || [];
            list.replaceChildren();
            Array.from(state.mounted.keys()).forEach(clearMount);
            state.plugins.clear();
            for (const plugin of plugins) {
                state.plugins.set(plugin.id, plugin);
                list.appendChild(renderPlugin(plugin));
                await mountContributions(plugin);
            }
            const extensionEmpty = document.getElementById('plugin-extension-empty');
            if (extensionEmpty) {
                extensionEmpty.hidden = Boolean(document.getElementById('plugin-extension-list')?.children.length);
            }
            const empty = document.getElementById('plugin-empty-state');
            if (empty) empty.hidden = plugins.length !== 0;
            const summary = document.getElementById('plugin-manager-summary');
            if (summary) summary.textContent = `${plugins.length} 个插件，${plugins.filter(item => item.status === 'active').length} 个正在运行`;
        } catch (error) {
            list.textContent = `读取失败：${error.message}`;
        }
    }

    function renderInstallPreview(preview) {
        const container = document.getElementById('plugin-install-preview');
        if (!container) return;
        container.hidden = false;
        container.replaceChildren();
        const title = document.createElement('h4');
        title.textContent = `${preview.manifest.name} · v${preview.manifest.version}`;
        const meta = document.createElement('p');
        meta.textContent = `${preview.manifest.kind} · SHA-256 ${preview.sha256.slice(0, 16)}… · ${preview.file_count} 个文件`;
        const warning = document.createElement('div');
        warning.className = preview.compatible ? 'settings-info-card warning' : 'settings-info-card danger';
        warning.textContent = preview.compatible
            ? (preview.unsigned ? '该插件未签名。确认来源和权限后再安装。' : '签名信息已包含在插件包中。')
            : preview.incompatible_reason;
        const permissions = document.createElement('div');
        permissions.className = 'plugin-install-permissions';
        (preview.manifest.permissions || []).forEach(permission => {
            const label = document.createElement('label');
            label.className = 'settings-checkbox plugin-permission-choice';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = permission;
            input.checked = true;
            const text = document.createElement('span');
            text.textContent = `${permissionLabels[permission] || permission}（风险：${riskLabel(preview.permission_risks?.[permission])}）`;
            label.append(input, text);
            permissions.appendChild(label);
        });
        const network = document.createElement('div');
        network.className = 'settings-info-card warning';
        network.hidden = !(preview.network_origins || []).length;
        network.textContent = network.hidden
            ? ''
            : `该插件将通过受控代理访问：${preview.network_origins.join('、')}`;
        const confirmations = document.createElement('div');
        confirmations.className = 'plugin-confirmations';
        const unsigned = document.createElement('label');
        unsigned.className = 'settings-checkbox';
        unsigned.innerHTML = '<input type="checkbox" data-confirm="unsigned"><span>我确认安装此未签名本地插件</span>';
        unsigned.hidden = !preview.unsigned;
        const trusted = document.createElement('label');
        trusted.className = 'settings-checkbox';
        trusted.innerHTML = '<input type="checkbox" data-confirm="trusted"><span>我理解可信 Python 插件可以运行任意代码</span>';
        trusted.hidden = !['trusted_python', 'legacy_v1'].includes(preview.manifest.kind);
        confirmations.append(unsigned, trusted);
        const actions = document.createElement('div');
        actions.className = 'plugin-dialog-actions';
        actions.append(
            createButton('取消', 'button-secondary', () => {
                container.hidden = true;
                container.replaceChildren();
                state.installPreview = null;
            }),
            createButton('确认安装', 'button-primary', async () => {
                const accepted = Array.from(permissions.querySelectorAll('input:checked')).map(input => input.value);
                try {
                    await api('/install/confirm', requestJson('POST', {
                        token: preview.token,
                        accepted_permissions: accepted,
                        accept_unsigned: Boolean(unsigned.querySelector('input')?.checked),
                        accept_trusted_python: Boolean(trusted.querySelector('input')?.checked),
                    }));
                    container.hidden = true;
                    state.installPreview = null;
                    toast('插件已安装，默认保持停用', 'success');
                    await loadPlugins();
                } catch (error) {
                    toast(error.message, 'error');
                }
            }, !preview.compatible),
        );
        container.append(title, meta, warning, network, permissions, confirmations, actions);
    }

    async function preflightFile(file) {
        const form = new FormData();
        form.append('package', file, file.name);
        const response = await fetch('/api/plugins/install/preflight', { method: 'POST', body: form });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.detail || '插件包预检失败');
        state.installPreview = result;
        renderInstallPreview(result);
    }

    async function loadDiagnostics() {
        const output = document.getElementById('plugin-diagnostics-output');
        if (!output) return;
        output.textContent = '正在读取…';
        try {
            output.textContent = JSON.stringify(await api('/diagnostics'), null, 2);
        } catch (error) {
            output.textContent = error.message;
        }
    }

    function handleSandboxMessage(event) {
        const message = event.data?.zootPlugin;
        if (!message || typeof message !== 'object') return;
        const plugin = state.plugins.get(String(message.plugin_id || ''));
        const record = frameRecordForSource(event.source);
        if (!plugin || !record || record.pluginId !== plugin.id) return;
        invoke(plugin.id, String(message.action || ''), message.payload || {}).then(result => {
            record.frame.contentWindow.postMessage({ zootPluginResult: { request_id: message.request_id, ok: true, result } }, '*');
        }).catch(error => {
            record.frame.contentWindow.postMessage({ zootPluginResult: { request_id: message.request_id, ok: false, error: error.message } }, '*');
        });
    }

    function init() {
        if (state.initialized) return;
        state.initialized = true;
        document.getElementById('plugin-select-package-btn')?.addEventListener('click', () => {
            document.getElementById('plugin-package-input')?.click();
        });
        document.getElementById('plugin-package-input')?.addEventListener('change', event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) preflightFile(file).catch(error => toast(error.message, 'error'));
        });
        document.getElementById('plugin-refresh-btn')?.addEventListener('click', loadPlugins);
        document.getElementById('plugin-diagnostics-btn')?.addEventListener('click', loadDiagnostics);
        document.addEventListener('pageShown', event => {
            if (['settings-plugins', 'page-settings-plugins'].includes(event.detail?.pageId)) loadPlugins();
        });
        global.addEventListener('message', handleSandboxMessage);
        loadPlugins();
    }

    global.ZOOT = global.ZOOT || {};
    global.ZOOT.PluginRuntime = { init, refresh: loadPlugins, invoke, openPluginPage };
    global.ZOOT.getPluginInterface = () => ({
        init,
        loadPlugin: async pluginId => pluginOperation(state.plugins.get(pluginId), 'enable'),
        unloadPlugin: async pluginId => pluginOperation(state.plugins.get(pluginId), 'disable'),
        enablePlugin: async pluginId => pluginOperation(state.plugins.get(pluginId), 'enable'),
        disablePlugin: async pluginId => pluginOperation(state.plugins.get(pluginId), 'disable'),
        getLoadedPlugins: () => Array.from(state.plugins.values()).filter(item => item.status === 'active').map(item => item.id),
        isPluginLoaded: pluginId => state.plugins.get(pluginId)?.status === 'active',
        triggerHook: async () => [],
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})(window);
