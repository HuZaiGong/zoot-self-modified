// 全局类定义
window.ProxyClient = class ProxyClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    async chat(request) {
        const response = await fetch(`${this.baseUrl}/proxy/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request)
        });
        if (!response.ok) throw new Error(`Proxy chat failed: ${response.status}`);
        return response.json();
    }

    async groupChat(request) {
        const response = await fetch(`${this.baseUrl}/proxy/group_chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request)
        });
        if (!response.ok) throw new Error(`Proxy group chat failed: ${response.status}`);
        return response.json();
    }

    async saveSilent(request) {
        const response = await fetch(`${this.baseUrl}/proxy/save_silent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request)
        });
        if (!response.ok) throw new Error(`Proxy save_silent failed: ${response.status}`);
        return response.json();
    }
};

window.EmbeddingClient = class EmbeddingClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    async encode(texts) {
        const response = await fetch(`${this.baseUrl}/v1/encode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: Array.isArray(texts) ? texts : [texts] })
        });
        if (!response.ok) throw new Error(`Embedding failed: ${response.status}`);
        const data = await response.json();
        return data.embeddings;
    }
};