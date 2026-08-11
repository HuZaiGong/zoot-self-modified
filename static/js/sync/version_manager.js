// 管理本地同步单元版本号
class VersionManager {
    constructor() {
        this.storageKey = 'sync_versions';
        this.versions = this.load();
    }

    load() {
        const raw = localStorage.getItem(this.storageKey);
        if (!raw) return {};
        try {
            return JSON.parse(raw);
        } catch (e) {
            console.error('Failed to parse sync_versions', e);
            return {};
        }
    }

    save() {
        localStorage.setItem(this.storageKey, JSON.stringify(this.versions));
    }

    get(unit) {
        return this.versions[unit] || 0;
    }

    set(unit, version) {
        this.versions[unit] = version;
        this.save();
    }

    getAll() {
        return { ...this.versions };
    }
}

window.VersionManager = VersionManager;