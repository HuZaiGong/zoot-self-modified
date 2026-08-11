// mobile/android/app/src/main/python/static/js/sync/sync_client.js

class SyncClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        // 设置超时（30秒）
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...(options.headers || {})
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[Sync] HTTP ${response.status} - ${errorText}`);
                throw new Error(`Sync request failed: ${response.status} - ${errorText}`);
            }
            return response.json();
        } catch (e) {
            console.error(`[Sync] 请求 ${url} 失败:`, e);
            if (e.name === 'AbortError') {
                console.error('[Sync] 请求超时（30秒）');
            }
            throw e;
        }
    }

    async getInfo() {
        const data = await this.request('/sync/info');
        // 期望返回 { protocol_version, server_version, supported_units }
        return data;
    }

    async pull(units, lastVersions) {
        return this.request('/sync/pull', {
            method: 'POST',
            body: JSON.stringify({
                protocol_version: window.SYNC_PROTOCOL_VERSION || '1.0',
                client_version: window.APP_VERSION || '0.1.0',
                units: units,
                last_versions: lastVersions
            })
        });
    }

    async push(unit, changes) {
        return this.request('/sync/push', {
            method: 'POST',
            body: JSON.stringify({
                protocol_version: window.SYNC_PROTOCOL_VERSION || '1.0',
                client_version: window.APP_VERSION || '0.1.0',
                unit: unit,
                changes: changes
            })
        });
    }

    async getRole() {
        return this.request('/sync/role');
    }

    async pullAllMessages() {
        // 1. 从 PC 拉取所有消息
        const data = await this.request('/sync/pull_all_messages', { method: 'POST' });
        // 2. 先同步附件二进制和元数据，确保消息关联不会指向缺失文件
        const attachmentMap = new Map();
        Object.values(data.messages || {}).forEach(chatMessages => {
            (chatMessages || []).forEach(message => {
                (message.attachments || []).forEach(attachment => attachmentMap.set(String(attachment.id), attachment));
            });
        });
        for (const attachment of attachmentMap.values()) {
            const localCheck = await fetch(`/media/attachments/${encodeURIComponent(attachment.id)}`);
            if (localCheck.ok) continue;
            const remoteUrl = `${this.baseUrl}${attachment.content_url || `/media/attachments/${attachment.id}/content`}`;
            const remoteResponse = await fetch(remoteUrl);
            if (!remoteResponse.ok) {
                throw new Error(`Attachment download failed: ${attachment.id}`);
            }
            const blob = await remoteResponse.blob();
            const form = new FormData();
            form.append('file', blob, attachment.original_name || `attachment-${attachment.id}`);
            form.append('attachment_id', String(attachment.id));
            form.append('expected_sha256', attachment.sha256);
            form.append('kind', attachment.kind || 'file');
            form.append('owner_persona_id', attachment.owner_persona_id || 'doctor');
            const importResponse = await fetch('/media/attachments/import', { method: 'POST', body: form });
            if (!importResponse.ok) {
                throw new Error(`Attachment import failed: ${attachment.id} - ${await importResponse.text()}`);
            }
        }
        // 3. 将消息及附件关联发送到移动端后端
        const response = await fetch('/sync/apply_messages_batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: data.messages })
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Apply messages failed: ${response.status} - ${errorText}`);
        }
        return data.messages;
    }
}

window.SyncClient = SyncClient;
