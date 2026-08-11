(function () {
    'use strict';

    async function request(path, options = {}) {
        const response = await fetch(`/api/cloud/v2${path}`, {
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options
        });
        const text = await response.text();
        let payload = {};
        if (text) {
            try {
                payload = JSON.parse(text);
            } catch (error) {
                throw new Error('云端本地代理返回了无效数据');
            }
        }
        if (!response.ok) {
            const detail = payload.detail;
            throw new Error(detail?.message || detail || payload.message || `HTTP ${response.status}`);
        }
        return payload;
    }

    function notify(message, type = 'info') {
        if (typeof window.showToast === 'function') window.showToast(message, 2600, type);
        else console.info(`[cloud] ${message}`);
    }

    function renderEvents(events) {
        const list = document.getElementById('cloud-event-list');
        if (!list) return;
        list.replaceChildren();
        if (!Array.isArray(events) || events.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'settings-empty-state';
            empty.textContent = '暂无云端消息';
            list.appendChild(empty);
            return;
        }
        events.forEach(event => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'settings-item cloud-event-item';
            const body = document.createElement('span');
            const title = document.createElement('strong');
            title.textContent = String(event.title || event.name || '云端消息');
            const summary = document.createElement('small');
            summary.textContent = String(event.summary || event.description || event.content || '').slice(0, 180);
            body.append(title, summary);
            const state = document.createElement('span');
            state.className = 'status-text';
            state.textContent = event.viewed ? '已查看' : '未读';
            item.append(body, state);
            item.addEventListener('click', async () => {
                if (!event.event_id || event.viewed) return;
                try {
                    await request(`/events/${encodeURIComponent(event.event_id)}/ack`, { method: 'POST', body: JSON.stringify({ state: 'viewed' }) });
                    event.viewed = true;
                    state.textContent = '已查看';
                } catch (error) {
                    notify(error.message || '更新消息状态失败', 'error');
                }
            });
            list.appendChild(item);
        });
    }

    async function refresh(refreshEvents = false) {
        try {
            const [status, consents, events] = await Promise.all([
                request('/status'), request('/consents'), request(`/events?refresh=${refreshEvents ? 'true' : 'false'}`)
            ]);
            const statusElement = document.getElementById('cloud-status');
            if (statusElement) {
                statusElement.innerHTML = `${ZootIcons.html(status.online ? 'success' : 'error')} ${status.online ? '正常' : '不可达'}`;
                statusElement.style.color = status.online ? 'var(--success-color)' : 'var(--danger-color)';
            }
            document.querySelectorAll('[data-cloud-consent]').forEach(input => {
                input.checked = Boolean(consents.categories?.[input.dataset.cloudConsent]?.enabled);
            });
            const usageToggle = document.getElementById('cloud-data-collection-toggle');
            if (usageToggle) usageToggle.checked = Boolean(consents.categories?.usage?.enabled);
            renderEvents(events.events || []);
        } catch (error) {
            console.warn('加载云端服务状态失败', error);
        }
    }

    function bind() {
        document.addEventListener('change', async event => {
            const input = event.target.closest?.('[data-cloud-consent], #cloud-data-collection-toggle');
            if (!input) return;
            const category = input.dataset.cloudConsent || 'usage';
            input.disabled = true;
            try {
                await request(`/consents/${category}`, { method: 'PUT', body: JSON.stringify({ enabled: input.checked }) });
                notify(input.checked ? '已启用该类诊断数据' : '已停止并清除未发送数据', 'success');
            } catch (error) {
                input.checked = !input.checked;
                notify(error.message || '保存授权失败', 'error');
            } finally {
                input.disabled = false;
            }
        });
        document.addEventListener('click', async event => {
            const button = event.target.closest?.('#cloud-events-refresh-btn, #cloud-telemetry-preview-btn, #cloud-telemetry-send-btn, #cloud-privacy-export-btn, #cloud-privacy-delete-btn');
            if (!button) return;
            try {
                if (button.id === 'cloud-events-refresh-btn') {
                    await refresh(true);
                    notify('云端消息已刷新', 'success');
                } else if (button.id === 'cloud-telemetry-preview-btn') {
                    const data = await request('/telemetry/preview');
                    const preview = document.getElementById('cloud-telemetry-preview');
                    if (preview) {
                        preview.textContent = JSON.stringify(data.items || [], null, 2);
                        preview.classList.remove('hidden');
                    }
                } else if (button.id === 'cloud-telemetry-send-btn') {
                    const data = await request('/telemetry/flush', { method: 'POST', body: '{}' });
                    notify(`已发送 ${data.sent || 0} 条授权数据`, 'success');
                } else if (button.id === 'cloud-privacy-export-btn') {
                    const data = await request('/privacy/export');
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `zoot-cloud-export-${Date.now()}.json`;
                    link.click();
                    URL.revokeObjectURL(url);
                } else if (button.id === 'cloud-privacy-delete-btn') {
                    if (!window.confirm('仅删除云端安装身份、授权、反馈与遥测记录；本地数据不会受影响。确定继续吗？')) return;
                    await request('/privacy/data', { method: 'DELETE' });
                    notify('云端数据删除请求已完成', 'success');
                    await refresh(false);
                }
            } catch (error) {
                notify(error.message || '云端操作失败', 'error');
            }
        });
        if (typeof EventSource !== 'undefined') {
            const stream = new EventSource('/api/cloud/v2/events/stream');
            stream.addEventListener('cloud_event', event => {
                refresh(false);
                if (document.hidden && window.Android?.sendNotificationOnce) {
                    try {
                        const payload = JSON.parse(event.data || '{}');
                        const eventId = String(payload.event_id || payload.id || '').trim();
                        if (!eventId) return;
                        window.Android.sendNotificationOnce(
                            eventId,
                            String(payload.title || payload.name || 'ZOOT 云端消息'),
                            String(payload.summary || payload.description || '').slice(0, 160),
                            'page',
                            'settings-api'
                        );
                    } catch (error) {
                        console.debug('[cloud] 无法解析事件通知', error);
                    }
                }
            });
            stream.addEventListener('error', () => console.debug('[cloud] 事件流暂时断开，浏览器将自动重连'));
            window.addEventListener('beforeunload', () => stream.close(), { once: true });
        }
        refresh(false);
    }


    window.compareVersions = function (left, right) {
        const parse = value => String(value || '').split(/[.+-]/).map(part => /^\d+$/.test(part) ? Number(part) : 0);
        const a = parse(left);
        const b = parse(right);
        const length = Math.max(a.length, b.length);
        for (let index = 0; index < length; index += 1) {
            const difference = (a[index] || 0) - (b[index] || 0);
            if (difference) return difference;
        }
        return 0;
    };

    window.renderUpdateDetail = function (data) {
        const version = document.getElementById('update-detail-version');
        if (version) version.textContent = data?.version ? `v${data.version}` : '版本信息不可用';
        const date = document.getElementById('update-release-date');
        if (date) date.textContent = data?.release_date ? `发布日期：${data.release_date}` : '';
        const description = document.getElementById('update-description');
        if (description) description.textContent = data?.description || data?.release_notes || '本次更新优化了性能和稳定性。';
        const track = document.getElementById('update-cards-track');
        if (track) {
            track.replaceChildren();
            const cards = Array.isArray(data?.cards) ? data.cards : [];
            if (!cards.length) {
                const empty = document.createElement('div');
                empty.className = 'settings-empty-state';
                empty.textContent = '暂无更新图片';
                track.appendChild(empty);
            } else {
                cards.forEach(card => {
                    const element = document.createElement('div');
                    element.className = 'update-card';
                    const title = document.createElement('div');
                    title.className = 'card-title';
                    title.textContent = String(card.title || '');
                    const summary = document.createElement('div');
                    summary.className = 'card-desc';
                    summary.textContent = String(card.desc || '');
                    element.append(title, summary);
                    track.appendChild(element);
                });
            }
        }
        const button = document.getElementById('update-action-btn');
        if (!button) return;
        if (data?.installable && data?.verified && data?.metadata) {
            button.textContent = '下载已签名完整安装包';
            button.disabled = false;
            button.onclick = () => window.performUpdate(data);
        } else {
            button.textContent = data?.security_reason || '更新包尚未通过安全验证';
            button.disabled = true;
        }
    };

    window.performUpdate = async function (data) {
        const button = document.getElementById('update-action-btn');
        if (!data?.installable || !data?.verified || !data?.metadata) {
            notify(data?.security_reason || '拒绝安装未签名更新', 'error');
            return;
        }
        if (button) {
            button.disabled = true;
            button.textContent = '正在校验并下载…';
        }
        try {
            const response = await fetch('/api/version/download_full', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ metadata: data.metadata })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail || result.message || '下载失败');
            if (window.Android && typeof window.Android.installApk === 'function') {
                window.Android.installApk(result.file_path);
            } else {
                notify(`安装包已验证并保存到：${result.file_path}`, 'success');
            }
        } catch (error) {
            notify(error.message || '更新失败', 'error');
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = '下载已签名完整安装包';
            }
        }
    };

    window.ZootCloudUI = { refresh };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
    else bind();
}());
