class CoopManager {
    constructor() {
        this.enabled = false;
        this.baseUrl = '';
        this.proxyClient = null;
        this.embeddingClient = null;
        this.failureCount = 0;
        this.maxFailures = 3;
    }

    loadConfig() {
        const oldBaseUrl = this.baseUrl;
        this.enabled = localStorage.getItem('pcAccelerateEnabled') === 'true';
        this.baseUrl = localStorage.getItem('pcAddress') || '';
        if (this.enabled && this.baseUrl) {
            if (window.ProxyClient && window.EmbeddingClient) {
                this.proxyClient = new window.ProxyClient(this.baseUrl);
                // 验证 saveSilent 方法存在
                if (typeof this.proxyClient.saveSilent !== 'function') {
                    console.error('[CoopManager] ProxyClient 缺少 saveSilent 方法，重新创建');
                    // 尝试重新创建
                    this.proxyClient = new window.ProxyClient(this.baseUrl);
                }
                this.embeddingClient = new window.EmbeddingClient(this.baseUrl);
            } else {
                console.error('[CoopManager] ProxyClient 或 EmbeddingClient 未加载');
                this.proxyClient = null;
                this.embeddingClient = null;
            }
        } else {
            this.proxyClient = null;
            this.embeddingClient = null;
        }
        this.failureCount = 0;
        console.log('[CoopManager] 配置加载完成, enabled=', this.enabled, 'baseUrl=', this.baseUrl);

        // ---------- 同步管理器重启逻辑 ----------
        if (this.enabled && this.baseUrl) {
            if (!window.syncManager) {
                window.syncManager = new SyncManager(this.baseUrl);
                window.syncManager.start().catch(e => console.error('[SyncManager] 启动失败', e));
            } else if (this.baseUrl !== oldBaseUrl) {
                window.syncManager.stop();
                window.syncManager = new SyncManager(this.baseUrl);
                window.syncManager.start().catch(e => console.error('[SyncManager] 重启失败', e));
            }
        } else {
            if (window.syncManager) {
                window.syncManager.stop();
                window.syncManager = null;
            }
        }
    }

    // 消息发送
    async sendMessage({ operatorId, userMessage, isScenario, operatorScenario, history = [], ...identity }) {
        if (!this.enabled || !this.proxyClient) {
            return null;
        }
        try {
            const request = window.buildProxyChatRequest(operatorId, userMessage, isScenario, operatorScenario, history, identity);
            const resp = await this.proxyClient.chat(request);
            this.failureCount = 0;
            return window.normalizeProxyResponse(resp);
        } catch (err) {
            console.warn('[CoopManager] 代理调用失败', err);
            this.failureCount++;
            if (this.failureCount >= this.maxFailures) {
                console.error('[CoopManager] 连续失败，自动禁用协同加速');
                this.enabled = false;
                localStorage.setItem('pcAccelerateEnabled', 'false');
                if (window.dispatchEvent) {
                    window.dispatchEvent(new CustomEvent('coop-auto-disabled'));
                }
            }
            return null;
        }
    }

    // 群聊代理发送
    async sendGroupMessage({ groupId, userMessage, isScenario, operatorScenario, history = [], ...identity }) {
        if (!this.enabled || !this.proxyClient) {
            return null;
        }
        try {
            const request = window.buildProxyGroupChatRequest(groupId, userMessage, isScenario, operatorScenario, history, identity);
            const resp = await this.proxyClient.groupChat(request);
            this.failureCount = 0;
            return window.normalizeProxyGroupResponse(resp);
        } catch (err) {
            console.warn('[CoopManager] 群聊代理调用失败', err);
            this.failureCount++;
            if (this.failureCount >= this.maxFailures) {
                console.error('[CoopManager] 连续失败，自动禁用协同加速');
                this.enabled = false;
                localStorage.setItem('pcAccelerateEnabled', 'false');
                if (window.dispatchEvent) {
                    window.dispatchEvent(new CustomEvent('coop-auto-disabled'));
                }
            }
            return null;
        }
    }

    isAvailable() {
        return this.enabled && this.proxyClient !== null;
    }
}

// 创建全局单例
window.coopManager = new CoopManager();
