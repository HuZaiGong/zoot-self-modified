// mobile/android/app/src/main/python/static/js/sync/sync_manager.js

class SyncManager {
    constructor(pcBaseUrl) {
        this.client = new window.SyncClient(pcBaseUrl);
        this.versionMgr = new window.VersionManager();
        this.pollingTimer = null;           // 改用 setTimeout 递归
        this.isSyncing = false;
        this.enabled = false;
        this.role = null;

        // 可达性缓存与退避
        this._pcReachable = false;
        this._lastReachabilityCheck = 0;
        this._reachabilityCacheTTL = 30;    // 缓存 30 秒
        this._backoffDelay = 30000;          // 当前退避延迟（毫秒）
        this._minBackoff = 30000;            // 最小间隔 30 秒
        this._maxBackoff = 300000;           // 最大间隔 5 分钟
        this._consecutiveFailures = 0;       // 连续失败次数
    }

    async start() {
        if (this.pollingTimer) return;

        // 首次检查可达性
        const reachable = await this._checkPcReachable();
        if (!reachable) {
            console.warn('[SyncManager] PC 不可达，同步未启动');
            // 启动后台检查，每 30 秒尝试重新连接
            this._schedulePolling();
            return;
        }

        // 获取角色
        const roleRes = await this.client.getRole();
        if (roleRes.role !== 'master') {
            console.log(`SyncManager: 角色为 ${roleRes.role}，不同步`);
            return;
        }

        // 获取 PC 端同步信息（包含协议版本）
        const info = await this.client.getInfo();
        if (!this._checkProtocolVersion(info)) {
            console.warn('同步协议版本不兼容，暂停同步');
            return;
        }

        this.enabled = true;
        this._pcReachable = true;
        this._consecutiveFailures = 0;
        this._backoffDelay = this._minBackoff;

        // 立即执行一次同步
        await this.syncAll();

        // 启动轮询（使用 setTimeout 递归）
        this._schedulePolling();
    }

    _schedulePolling() {
        if (this.pollingTimer) {
            clearTimeout(this.pollingTimer);
            this.pollingTimer = null;
        }

        const interval = this._backoffDelay;
        this.pollingTimer = setTimeout(() => {
            this.pollingTimer = null;
            this._pollingTick();
        }, interval);
    }

    async _pollingTick() {
        if (!this.enabled) {
            // 如果未启用，但仍在轮询，则检查可达性以尝试重新启用
            const reachable = await this._checkPcReachable();
            if (reachable) {
                const roleRes = await this.client.getRole();
                if (roleRes.role === 'master') {
                    this.enabled = true;
                    this._consecutiveFailures = 0;
                    this._backoffDelay = this._minBackoff;
                    console.log('[SyncManager] PC 可达，同步已恢复');
                }
            }
            // 无论如何，继续下一次轮询（保持定时循环）
            this._schedulePolling();
            return;
        }

        // 执行同步，但先检查可达性
        const reachable = await this._checkPcReachable();
        if (!reachable) {
            console.warn('[SyncManager] PC 不可达，跳过本轮同步，延长间隔');
            this._backoffDelay = Math.min(this._maxBackoff, this._backoffDelay * 1.5);
            this._schedulePolling();
            return;
        }

        // 执行同步
        if (!this.isSyncing) {
            try {
                await this.syncAll();
                // 同步成功，重置退避
                this._consecutiveFailures = 0;
                this._backoffDelay = this._minBackoff;
            } catch (e) {
                console.error('[SyncManager] 同步失败', e);
                this._consecutiveFailures++;
                this._backoffDelay = Math.min(this._maxBackoff, this._backoffDelay * 1.5);
            }
        }

        // 继续下一次轮询
        this._schedulePolling();
    }

    // 检查 PC 是否可达（带缓存）
    async _checkPcReachable() {
        const now = Date.now();
        if (now - this._lastReachabilityCheck < this._reachabilityCacheTTL * 1000) {
            return this._pcReachable;
        }
        try {
            const roleRes = await this.client.getRole();
            this._pcReachable = (roleRes.role === 'master');
        } catch (e) {
            this._pcReachable = false;
        }
        this._lastReachabilityCheck = now;
        return this._pcReachable;
    }

    _checkProtocolVersion(info) {
        const pcProtocol = info.protocol_version;
        if (!pcProtocol) return false;
        if (pcProtocol !== window.SYNC_PROTOCOL_VERSION) {
            console.warn(`协议版本不匹配: 移动端 ${window.SYNC_PROTOCOL_VERSION}, PC端 ${pcProtocol}`);
            return false;
        }
        return true;
    }

    stop() {
        if (this.pollingTimer) {
            clearTimeout(this.pollingTimer);
            this.pollingTimer = null;
        }
        this.enabled = false;
        this._backoffDelay = this._minBackoff;
        this._consecutiveFailures = 0;
    }

    async syncAll() {
        console.log('[SyncManager] syncAll 开始');
        if (!this.enabled || this.isSyncing) return;
        this.isSyncing = true;
        try {
            const units = ['mid_memories', 'long_memories', 'topics', 'events', 'id_mapping'];
            const lastVersions = {};
            for (const unit of units) {
                lastVersions[unit] = this.versionMgr.get(unit);
            }
            console.log('[SyncManager] 请求拉取单元:', units);
            console.log('[SyncManager] 本地版本:', lastVersions);
            const result = await this.client.pull(units, lastVersions);
            console.log('[SyncManager] pull 响应:', result);
            if (result.error) {
                console.error('[SyncManager] 同步拉取失败:', result.error);
                return;
            }
            for (const [unit, data] of Object.entries(result.units)) {
                console.log(`[SyncManager] ${unit} changes:`, data.changes);
                if (data.error) {
                    console.warn(`单元 ${unit} 同步出错:`, data.error);
                    continue;
                }
                if (data.changes && data.changes.length > 0) {
                    const ok = window.applyMemoryChanges(unit, data.changes);
                    if (!ok) {
                        console.error(`应用 ${unit} 变更失败`);
                    }
                }
                if (data.version > this.versionMgr.get(unit)) {
                    this.versionMgr.set(unit, data.version);
                    console.log(`[SyncManager] 更新 ${unit} 版本号: ${this.versionMgr.get(unit)} -> ${data.version}`);
                }
            }
        } catch (e) {
            console.error('[SyncManager] 同步过程异常:', e);
            console.error('[SyncManager] 异常堆栈:', e.stack);
            // 如果是网络错误，抛出以便上层处理退避
            throw e;
        } finally {
            this.isSyncing = false;
        }
    }

    _compareVersions(v1, v2) {
        const toNum = (v) => v.split('.').map(n => parseInt(n, 10));
        const arr1 = toNum(v1), arr2 = toNum(v2);
        for (let i = 0; i < Math.max(arr1.length, arr2.length); i++) {
            const n1 = arr1[i] || 0, n2 = arr2[i] || 0;
            if (n1 !== n2) return n1 - n2;
        }
        return 0;
    }

    updateBaseUrl(baseUrl) {
        this.client = new SyncClient(baseUrl);
    }

    async fullSync() {
        console.log('[SyncManager] 执行全量同步');
        const wasEnabled = this.enabled;
        if (!wasEnabled) {
            this.enabled = true;
        }
        try {
            if (this.isSyncing) {
                console.warn('[SyncManager] 同步任务进行中，稍后重试');
                return;
            }
            await this.syncAll();
            console.log('[SyncManager] 全量同步完成');
        } catch (err) {
            console.error('[SyncManager] 全量同步失败', err);
            throw err;
        } finally {
            if (!wasEnabled) {
                this.enabled = false;
            }
        }
    }

    async pullAllMessages() {
        try {
            const result = await this.client.pullAllMessages();
            if (window.Android && window.Android.applyMessagesBatch) {
                window.Android.applyMessagesBatch(JSON.stringify(result.messages));
            } else {
                console.warn('Android.applyMessagesBatch 未实现');
            }
        } catch (e) {
            console.error('全量消息拉取失败', e);
        }
    }
}

window.SyncManager = SyncManager;