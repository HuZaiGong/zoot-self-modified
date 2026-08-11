/**
 * graph-viewer.js - 知识图谱线索墙渲染器
 * 支持静态知识库数据渲染，提供缩放、拖拽、点击查看详情功能。
 */

// ================================================================
//  1. 工具函数
// ================================================================

// 获取 URL 参数
function getUrlParams() {
    // 优先从 hash 中解析（支持 #embedded-graph?mode=static&id=xxx）
    let search = window.location.search;
    if (!search && window.location.hash.includes('?')) {
        const hashParts = window.location.hash.split('?');
        if (hashParts.length > 1) {
            search = '?' + hashParts[1];
        }
    }
    const params = new URLSearchParams(search);
    return {
        mode: params.get('mode') || 'static',
        id: params.get('id') || params.get('character') || params.get('operator_id'),
        embedded: params.get('embedded') === '1',
        thumbnail: params.get('thumbnail') === '1'
    };
}

// 全局静态图谱会在 DOMContentLoaded 的首次布局中立即入栈，因此必须先于布局初始化。
window.graphNavStack = window.graphNavStack || [];
window.pushGraphView = window.pushGraphView || function(viewType, viewData) {
    window.graphNavStack.push({ type: viewType, data: viewData || {} });
};

// 生成确定性随机种子（基于字符串）
function hashString(str) {
    if (!str) return 0;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash);
}

// 随机数生成器（基于种子）
function seededRandom(seed) {
    return function() {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    };
}

// 势力 Logo 映射表（与前端保持一致）
function getLogoImage(origin) {
    const map = {
        '阿戈尔': 'Logo_Ægir.png',
        '玻利瓦尔': 'Logo_Bolívar.png',
        '东': 'Logo_Higashi.png',
        '哥伦比亚': 'Logo_Columbia.png',
        '卡西米尔': 'Logo_Kazimierz.png',
        '拉特兰': 'Logo_Laterano.png',
        '莱塔尼亚': 'Logo_Leithanien.png',
        '雷姆必拓': 'Logo_RimBilliton.png',
        '米诺斯': 'Logo_Minos.png',
        '萨尔贡': 'Logo_Sargon.png',
        '萨米': 'Logo_Sami.png',
        '维多利亚': 'Logo_Victoria.png',
        '乌萨斯': 'Logo_Ursus.png',
        '谢拉格': 'Logo_Kjerag.png',
        '叙拉古': 'Logo_Siracusa.png',
        '炎': 'Logo_Yan.png',
        '炎-龙门': 'Logo_Lungmen.png',
        '伊比利亚': 'Logo_Iberia.png',
        '汐斯塔': 'Logo_Siesta.png',
        '罗德岛': 'Logo_Rhodes.png',
        '黑钢国际': 'Logo_BSW.png',
        '喀兰贸易': 'Logo_KarlanTrade.png',
        '莱茵生命': 'Logo_RhineLab.png',
        '雷神工业': 'Logo_Raythean.png',
        '鲤氏侦探事务所': 'Logo_Lee.png',
        '企鹅物流': 'Logo_PenguinLogistics.png',
        '巴别塔': 'Logo_Babel.png',
        '格拉斯哥帮': 'Logo_Glasgow.png',
        '龙门近卫局': 'Logo_LGD.png',
        '深海猎人': 'Logo_AbyssalHunters.png',
        '使徒': 'Logo_Followers.png',
        '乌萨斯学生自治团': 'Logo_USSG.png',
        '岁': 'Logo_Sui.png',
        '深池': 'Logo_Dublinn.png',
        '红松骑士团': 'Logo_PinusSylvestris.png'
    };
    return map[origin] || '';
}

// 获取干员头像 URL（安全）
function getOperatorAvatarUrl(operatorId) {
    if (!operatorId) return '/static/avatars/default.webp';
    if (operatorId === 'doctor') {
        return getDoctorAvatarUrl();
    }
    return `/character/avatar/${encodeURIComponent(String(operatorId))}`;
}

// 获取博士当前人格头像 URL
function getDoctorAvatarUrl() {
    var stored = null;
    try { stored = localStorage.getItem('doctorAvatar'); } catch(e) {}
    var filename = stored || 'avatar_1.webp';
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(filename)) filename = 'avatar_1.webp';
    return '/static/avatars/' + filename;
}

// ================================================================
//  2. API 调用
// ================================================================

const API_BASE = '/static_knowledge';

// ---------- 别名缓存（前端本地映射） ----------
let aliasCache = null;
let aliasCacheInitialized = false;

async function buildAliasCache() {
    if (aliasCacheInitialized) return;
    try {
        const res = await fetch('/operators');
        if (!res.ok) throw new Error('加载干员列表失败');
        const data = await res.json();
        aliasCache = new Map();
        for (const op of data) {
            const id = op.id;
            // 主名称
            if (op.codename) aliasCache.set(op.codename, id);
            aliasCache.set(id, id);
            // 别名
            if (op.aliases && Array.isArray(op.aliases)) {
                for (const alias of op.aliases) {
                    aliasCache.set(alias, id);
                }
            }
            if (op.name) aliasCache.set(op.name, id);
        }
        // 博士特殊处理
        aliasCache.set('博士', 'doctor');
        aliasCache.set('doctor', 'doctor');
        aliasCacheInitialized = true;
        console.log('[别名缓存] 构建完成，共', aliasCache.size, '个别名');
    } catch (e) {
        console.warn('[别名缓存] 构建失败，将降级使用后端接口', e);
        // 降级：仍使用后端接口
        aliasCacheInitialized = false;
    }
}

async function resolveAlias(alias) {
    if (!alias) return null;
    // 确保缓存已构建
    if (!aliasCacheInitialized) {
        await buildAliasCache();
    }
    // 优先使用本地缓存
    if (aliasCache && aliasCache.has(alias)) {
        return aliasCache.get(alias);
    }
    // 降级：调用后端接口（兼容旧逻辑）
    try {
        const res = await fetch(`/resolve_alias?alias=${encodeURIComponent(alias)}`);
        if (!res.ok) return null;
        const data = await res.json();
        // 将结果也加入缓存（可选）
        if (data.id && aliasCache) aliasCache.set(alias, data.id);
        return data.id;
    } catch (e) {
        console.warn('[别名解析] 失败:', alias, e);
        return null;
    }
}

// ---------- 获取关系 ----------
async function fetchRelationships(operatorId) {
    const res = await fetch(`${API_BASE}/relationships/${encodeURIComponent(operatorId)}/merged`);
    if (!res.ok) throw new Error(`获取关系失败: ${res.status}`);
    return res.json();
}

function normalizeRelationshipRecords(records) {
    return (Array.isArray(records) ? records : []).map(item => {
        if (!item || typeof item !== 'object') return null;
        const target = item.target_character_id
            || item.target_operator_id
            || item.target
            || item.display_name
            || item.target_name;
        if (!target) return null;
        return {
            ...item,
            target,
            target_name: item.display_name || item.target_name || item.target || String(target),
            type: item.type || item.relation_type || item.relationship_type || '',
            resolved: item.resolved === true || Boolean(item.target_character_id || item.target_operator_id)
        };
    }).filter(Boolean);
}

function chooseRelationshipRecords(primary, fallback) {
    const normalizedPrimary = normalizeRelationshipRecords(primary);
    return normalizedPrimary.length ? normalizedPrimary : normalizeRelationshipRecords(fallback);
}

async function openRelationshipManager(operatorId, relationships) {
    document.getElementById('relationship-manager-layer')?.remove();
    const allOperators = await fetch('/operators').then(response => response.json());
    const existingTargets = new Set(relationships.map(item => String(item.target_operator_id || item.target || '')));
    const layer = document.createElement('div');
    layer.id = 'relationship-manager-layer';
    layer.innerHTML = `<div class="relationship-manager-card"><header><strong>管理关系图谱</strong><button data-close><span data-zoot-icon="close"></span></button></header><input data-search placeholder="搜索并批量选择干员"><div class="relationship-operator-list"></div><input data-type placeholder="关系类型"><textarea data-description placeholder="关系描述"></textarea><div class="relationship-manager-actions"><button data-add-operators>添加所选干员</button><button data-add-external>添加非干员节点</button></div><h4>已有节点</h4><div class="relationship-existing-list"></div></div>`;
    document.body.appendChild(layer);
    const operatorList = layer.querySelector('.relationship-operator-list');
    const renderOperators = keyword => {
        const query = keyword.trim().toLowerCase();
        operatorList.innerHTML = allOperators.filter(op => `${op.codename || ''} ${op.id}`.toLowerCase().includes(query)).map(op => {
            const disabled = String(op.id) === String(operatorId) || existingTargets.has(String(op.id));
            return `<label><input type="checkbox" value="${escapeHtml(String(op.id))}" ${disabled ? 'disabled' : ''}><span>${escapeHtml(op.codename || String(op.id))}<small>${disabled ? '已添加' : op.id}</small></span></label>`;
        }).join('');
    };
    const existingList = layer.querySelector('.relationship-existing-list');
    existingList.innerHTML = relationships.map(item => `<div><span><strong>${escapeHtml(item.display_name || item.target_name || item.target || item.target_operator_id || '未命名')}</strong><small>${escapeHtml(item.type || item.relation_type || '')} · ${escapeHtml(item.source || '')}</small></span><button data-edit-node="${escapeHtml(item.node_id || '')}">编辑</button><button data-delete-node="${escapeHtml(item.node_id || '')}">删除</button></div>`).join('') || '<p>暂无关系节点</p>';
    layer.querySelector('[data-search]').oninput = event => renderOperators(event.target.value);
    layer.querySelector('[data-close]').onclick = () => layer.remove();
    layer.querySelector('[data-add-operators]').onclick = async () => {
        const selected = Array.from(operatorList.querySelectorAll('input:checked')).map(input => input.value);
        if (!selected.length) return;
        const relationType = layer.querySelector('[data-type]').value.trim();
        const description = layer.querySelector('[data-description]').value.trim();
        const nodes = selected.map(id => ({ operator_id: operatorId, node_kind: 'operator', target_operator_id: id, display_name: allOperators.find(op => String(op.id) === id)?.codename || id, relation_type: relationType, description }));
        const response = await fetch(`${API_BASE}/relationship_nodes/batch`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({operator_id: operatorId, nodes}) });
        if (response.ok) location.reload();
    };
    layer.querySelector('[data-add-external]').onclick = async () => {
        const displayName = prompt('非干员节点名称：')?.trim();
        if (!displayName) return;
        const trauma = prompt('创伤（可选，多项用换行分隔）：') || '';
        const experiences = prompt('经历（可选，多项用换行分隔）：') || '';
        const response = await fetch(`${API_BASE}/relationship_nodes`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({operator_id:operatorId,node_kind:'external',display_name:displayName,relation_type:layer.querySelector('[data-type]').value.trim(),description:layer.querySelector('[data-description]').value.trim(),trauma:trauma.split('\n').filter(Boolean),experiences:experiences.split('\n').filter(Boolean)}) });
        if (response.ok) location.reload();
    };
    existingList.onclick = async event => {
        const edit = event.target.closest('[data-edit-node]');
        const remove = event.target.closest('[data-delete-node]');
        const nodeId = edit?.dataset.editNode || remove?.dataset.deleteNode;
        const item = relationships.find(value => String(value.node_id) === String(nodeId));
        if (!nodeId || !item) return;
        if (remove) {
            if (confirm('删除该关系节点？')) {
                const response = await fetch(`${API_BASE}/relationship_nodes/${encodeURIComponent(operatorId)}/${encodeURIComponent(nodeId)}`, {method:'DELETE'});
                if (response.ok) location.reload();
            }
            return;
        }
        const description = prompt('关系描述：', item.description || '')?.trim();
        if (description === undefined) return;
        const relationType = prompt('关系类型：', item.type || item.relation_type || '')?.trim() || '';
        const response = await fetch(`${API_BASE}/relationship_nodes/${encodeURIComponent(nodeId)}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({operator_id:operatorId,node_id:nodeId,base_fingerprint:item.base_fingerprint || '',node_kind:item.node_kind || (item.target_operator_id ? 'operator':'external'),target_operator_id:item.target_operator_id || '',display_name:item.display_name || item.target_name || item.target || '',relation_type:relationType,description,trauma:item.trauma || [],experiences:item.experiences || [],custom_fields:item.custom_fields || {}})});
        if (response.ok) location.reload();
    };
    renderOperators('');
}

// ---------- 获取干员数据（转换格式） ----------
async function fetchOperatorData(operatorId) {
    const res = await fetch(`${API_BASE}/operator/${encodeURIComponent(operatorId)}`);
    if (!res.ok) throw new Error(`获取干员数据失败: ${res.status}`);
    const raw = await res.json();

    const knowledge = raw.knowledge || {};
    const result = {
        id: raw.operator_id,
        codename: extractFirstValue(knowledge, 'codename'),
        origin: extractFirstValue(knowledge, 'basic_info.origin'),
        race: extractFirstValue(knowledge, 'basic_info.race'),
        gender: extractFirstValue(knowledge, 'basic_info.gender'),
        // 数组字段
        experiences: extractArrayValues(knowledge, 'experiences'),
        emotion_patterns: extractArrayValues(knowledge, 'emotion_patterns'),
        interaction_patterns: extractArrayValues(knowledge, 'interaction_patterns'),
        plot_hooks: extractArrayValues(knowledge, 'plot_hooks'),
        relationships: extractArrayValues(knowledge, 'relationships'),
    };
    return result;
}

// 辅助函数：提取第一个值（用于单值字段）
function extractFirstValue(knowledge, key) {
    const entry = knowledge[key];
    if (!entry || !Array.isArray(entry) || entry.length === 0) return '';
    return entry[0].content || '';
}

// 辅助函数：提取数组值（用于多值字段，如 experiences）
function extractArrayValues(knowledge, key) {
    const entry = knowledge[key];
    if (!entry || !Array.isArray(entry)) return [];
    return entry.map(item => {
        let result;
        if (typeof item.raw_data === 'string') {
            try {
                const parsed = JSON.parse(item.raw_data);
                if (typeof parsed === 'object' && parsed !== null) {
                    result = parsed;
                } else {
                    result = parsed;
                }
            } catch (e) {
                result = item.raw_data;
            }
        } else {
            result = item.raw_data;
        }
        // 如果 result 是对象，添加 id 字段
        if (result && typeof result === 'object') {
            result.id = item.id;
        } else {
            // 如果是字符串，包装为对象
            result = { content: result, id: item.id };
        }
        return result;
    });
}


// ---------- 获取世界设定数据 ----------
let worldsetDataCache = null;
async function fetchWorldsetData() {
    if (worldsetDataCache) return worldsetDataCache;
    try {
        const res = await fetch('/static_knowledge/worldset');
        if (res.ok) {
            const data = await res.json();
            worldsetDataCache = data.entries || [];
            console.log('[worldset] 加载', worldsetDataCache.length, '条世界设定');
        } else {
            worldsetDataCache = [];
        }
    } catch (e) {
        console.warn('[worldset] 加载失败', e);
        worldsetDataCache = [];
    }
    return worldsetDataCache;
}

// 世界设定分类中文映射
const WORLDSET_CATEGORY_NAMES = {
    'nations': '国家',
    'organizations': '组织',
    'races': '种族',
    'creatures': '生物',
    'locations': '地点',
    'cities': '城市',
    'settings': '设定',
    'originium': '源石',
    'industry': '工业',
    'artifacts': '化物',
    'civilization': '文明',
    'corrosion': '侵蚀',
};

function getWorldsetCategoryName(category) {
    const key = (category || '').replace('worldset/', '');
    return WORLDSET_CATEGORY_NAMES[key] || key || '未知';
}

// 世界设定分类颜色
const WORLDSET_CATEGORY_COLORS = {
    'nations': '#e74c3c',
    'organizations': '#3498db',
    'races': '#2ecc71',
    'creatures': '#9b59b6',
    'locations': '#1abc9c',
    'cities': '#f39c12',
    'settings': '#e67e22',
    'originium': '#c0392b',
    'industry': '#7f8c8d',
    'artifacts': '#d35400',
    'civilization': '#2980b9',
    'corrosion': '#8e44ad',
};

// ---------- 获取所有干员（用于全局模式） ----------
async function fetchAllOperators() {
    const res = await fetch(`${API_BASE}/all`);
    if (!res.ok) throw new Error(`获取所有干员失败: ${res.status}`);
    return res.json();
}

// ================================================================
//  3. 图形渲染引擎
// ================================================================

class GraphRenderer {
    // ---- 入场动画配置（可调试） ----
    static entranceConfig = {
        duration: 1000,          // 总时长（毫秒），默认1.2秒
        maxLines: 8,            // 最大线段数
        lineMinLength: 120,       // 线段最小长度
        lineMaxLength: 640,      // 线段最大长度
        lineStartDistMin: 80,    // 线段起始点距中心最小距离
        lineStartDistMax: 360,    // 线段起始点距中心最大距离
        appearTimeMax: 600,      // 线段出现最大延迟（毫秒）
        disappearTimeMin: 400,   // 线段消失最小延迟（毫秒）
        disappearTimeMax: 1200,  // 线段消失最大延迟（毫秒）
        keepProbability: 0.6,   // 线段保留概率
        scanlineAlpha: 0.5,     // 扫描线最大透明度（整体）
        lineAlpha: 0.25,          // 线段基本透明度
        numberFontSize: 14,      // 数字字体大小
        numberOffsetY: -12,      // 数字垂直偏移
    };

    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = 0;
        this.height = 0;
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        this.elements = [];
        this.clickableElements = [];
        this.onElementClick = null;
        this.onElementDblClick = null;
        this._lastPinchDist = null;
        this.imageCache = new Map();

        // ---- 触摸状态（移动端） ----
        this._touchStartX = 0;
        this._touchStartY = 0;
        this._wasDragging = false;

        // ---- 移动端双击检测 ----
        this._lastTapTime = 0;
        this._lastTapX = 0;
        this._lastTapY = 0;
        this._tapTimeout = null;

        // ---- 入场动画相关 ----
        this.entranceActive = false;
        this.entranceStartTime = 0;
        this.entranceDuration = GraphRenderer.entranceConfig.duration;
        this.entranceCanvas = null;
        this.entranceCtx = null;
        this.entranceLines = [];       // 放射线段
        this.entranceLineCount = 0;
        this.entranceMaxLines = 12;    // 最大线段数

        this.resize();
        this.bindEvents();
    }

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.width = rect.width;
        this.height = rect.height;
        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';
        this.ctx.scale(dpr, dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.centerX = this.width / 2;
        this.centerY = this.height / 2;

        // 同步调整入场 Canvas（如果存在）
        if (this.entranceCanvas) {
            this.entranceCanvas.width = this.width * dpr;
            this.entranceCanvas.height = this.height * dpr;
            this.entranceCanvas.style.width = this.width + 'px';
            this.entranceCanvas.style.height = this.height + 'px';
            this.entranceCtx.scale(dpr, dpr);
            this.entranceCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
    }

    loadImage(url) {
        if (!url) return Promise.resolve(null);
        if (this.imageCache.has(url)) {
            return Promise.resolve(this.imageCache.get(url));
        }
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                this.imageCache.set(url, img);
                resolve(img);
            };
            img.onerror = () => {
                // 失败时使用占位图
                const placeholder = new Image();
                placeholder.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="%234a7db5"/%3E%3C/svg%3E';
                this.imageCache.set(url, placeholder);
                resolve(placeholder);
            };
            img.src = url;
        });
    }

    bindEvents() {
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        window.addEventListener('mousemove', this.onMouseMove.bind(this));
        window.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
        this.canvas.addEventListener('click', this.onClick.bind(this));
        this.canvas.addEventListener('dblclick', this.onDblClick.bind(this));
        this.canvas.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
        this.canvas.addEventListener('touchcancel', this.onTouchCancel.bind(this), { passive: false });
        this.canvas.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
        this.canvas.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: false });
        window.addEventListener('resize', () => { this.resize(); this.render(); });
    }

    worldToScreen(wx, wy) {
        return {
            x: (wx - this.offsetX) * this.scale + this.centerX,
            y: (wy - this.offsetY) * this.scale + this.centerY
        };
    }

    screenToWorld(sx, sy) {
        return {
            x: (sx - this.centerX) / this.scale + this.offsetX,
            y: (sy - this.centerY) / this.scale + this.offsetY
        };
    }

    onMouseDown(e) {
        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragOffsetX = this.offsetX;
        this.dragOffsetY = this.offsetY;
        this.canvas.style.cursor = 'grabbing';
    }

    onMouseMove(e) {
        if (!this.isDragging) return;
        const dx = (e.clientX - this.dragStartX) / this.scale;
        const dy = (e.clientY - this.dragStartY) / this.scale;
        this.offsetX = this.dragOffsetX - dx;
        this.offsetY = this.dragOffsetY - dy;
        this.render();
    }

    onMouseUp() {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
    }

    onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.min(3, Math.max(0.3, this.scale * delta));
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const world = this.screenToWorld(mx, my);
        this.scale = newScale;
        this.offsetX = world.x - (mx - this.centerX) / this.scale;
        this.offsetY = world.y - (my - this.centerY) / this.scale;
        this.render();
        this.updateZoomLevel();
    }

    onClick(e) {
        // 如果正在拖动或刚刚拖动过，忽略点击
        if (this.isDragging || this._wasDragging) {
            this._wasDragging = false;
            return;
        }
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        this._handleClickAt(mx, my);
    }

    _handleClickAt(mx, my) {
        // 直接检测点击（不依赖事件）
        for (const el of this.clickableElements) {
            if (el.hitTest && el.hitTest(mx, my)) {
                if (this.onElementClick) this.onElementClick(el);
                break;
            }
        }
    }

    onDblClick(e) {
        if (this.isDragging || this._wasDragging) {
            this._wasDragging = false;
            return;
        }
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        for (const el of this.clickableElements) {
            if (el.hitTest && el.hitTest(mx, my)) {
                if (this.onElementDblClick) this.onElementDblClick(el);
                break;
            }
        }
    }

    onTouchStart(e) {
        const touch = e.touches[0];
        if (e.touches.length === 1) {
            // 记录触摸起始位置（用于判断点击/拖动）
            this._touchStartX = touch.clientX;
            this._touchStartY = touch.clientY;
            this._wasDragging = false;

            this.isDragging = true;
            this.dragStartX = touch.clientX;
            this.dragStartY = touch.clientY;
            this.dragOffsetX = this.offsetX;
            this.dragOffsetY = this.offsetY;
        }
        e.preventDefault();
    }

    onTouchCancel() {
        this.isDragging = false;
        this._lastPinchDist = null;
        this._wasDragging = false;
        this._touchStartX = 0;
        this._touchStartY = 0;
        this.canvas.style.cursor = 'grab';
    }

    onTouchMove(e) {
        if (e.touches.length === 1 && this.isDragging) {
            const touch = e.touches[0];
            // 如果移动距离超过 5px 才认为是拖动
            const dxMove = touch.clientX - this._touchStartX;
            const dyMove = touch.clientY - this._touchStartY;
            if (Math.hypot(dxMove, dyMove) > 5) {
                this._wasDragging = true;
            }
            const dx = (touch.clientX - this.dragStartX) / this.scale;
            const dy = (touch.clientY - this.dragStartY) / this.scale;
            this.offsetX = this.dragOffsetX - dx;
            this.offsetY = this.dragOffsetY - dy;
            this.render();
        } else if (e.touches.length === 2) {
            // 双指缩放逻辑不变
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
            if (this._lastPinchDist) {
                const delta = dist / this._lastPinchDist;
                const newScale = Math.min(3, Math.max(0.3, this.scale * delta));
                const rect = this.canvas.getBoundingClientRect();
                const mx = (t1.clientX + t2.clientX) / 2 - rect.left;
                const my = (t1.clientY + t2.clientY) / 2 - rect.top;
                const world = this.screenToWorld(mx, my);
                this.scale = newScale;
                this.offsetX = world.x - (mx - this.centerX) / this.scale;
                this.offsetY = world.y - (my - this.centerY) / this.scale;
                this.render();
                this.updateZoomLevel();
            }
            this._lastPinchDist = dist;
            // 双指操作视为拖动
            this._wasDragging = true;
        }
        e.preventDefault();
    }

    onTouchEnd(e) {
        const touch = e.changedTouches && e.changedTouches[0];
        // 如果触摸结束，重置拖拽状态
        this.isDragging = false;
        this._lastPinchDist = null;
        this.canvas.style.cursor = 'grab';

        // ---- 移动端双击检测 ----
        if (!this._wasDragging && touch) {
            const now = performance.now();
            const deltaX = Math.abs(touch.clientX - this._lastTapX);
            const deltaY = Math.abs(touch.clientY - this._lastTapY);
            if (now - this._lastTapTime < 300 && deltaX < 30 && deltaY < 30) {
                // 双击检测到，触发双击事件
                const rect = this.canvas.getBoundingClientRect();
                const mx = touch.clientX - rect.left;
                const my = touch.clientY - rect.top;
                for (const el of this.clickableElements) {
                    if (el.hitTest && el.hitTest(mx, my)) {
                        if (this.onElementDblClick) this.onElementDblClick(el);
                        break;
                    }
                }
                // 重置上一次点击记录，避免连续触发
                this._lastTapTime = 0;
                this._lastTapX = 0;
                this._lastTapY = 0;
                // 清除可能的超时
                if (this._tapTimeout) {
                    clearTimeout(this._tapTimeout);
                    this._tapTimeout = null;
                }
            } else {
                this._lastTapTime = now;
                this._lastTapX = touch.clientX;
                this._lastTapY = touch.clientY;
                // 延迟单击处理，给双击留出判断窗口，避免先弹详情再跳转
                if (this._tapTimeout) {
                    clearTimeout(this._tapTimeout);
                }
                this._tapTimeout = setTimeout(() => {
                    const rect = this.canvas.getBoundingClientRect();
                    this._handleClickAt(
                        touch.clientX - rect.left,
                        touch.clientY - rect.top
                    );
                    this._lastTapTime = 0;
                    this._lastTapX = 0;
                    this._lastTapY = 0;
                    this._tapTimeout = null;
                }, 300);
            }
        }

        // 重置触摸起始坐标
        this._touchStartX = 0;
        this._touchStartY = 0;
        this._wasDragging = false;
    }

    async setElements(elements) {
        this.elements = elements;
        this.clickableElements = elements.filter(el => el.clickable !== false);
        // 预加载图像
        const imageUrls = new Set();
        for (const el of elements) {
            if (el.image) imageUrls.add(el.image);
        }
        await Promise.all([...imageUrls].map(url => this.loadImage(url)));

        // 为所有可点击元素统一添加 hitTest（基于屏幕坐标）
        for (const el of this.clickableElements) {
            if (!el.hitTest) {
                // 保存 renderer 引用以获取动态 scale
                const renderer = this;
                el.hitTest = (sx, sy) => {
                    const pos = renderer.worldToScreen(el.x, el.y);
                    const dx = sx - pos.x;
                    const dy = sy - pos.y;
                    // 动态计算半径（考虑缩放）
                    const baseRadius = el.type === 'note' ? 60 : (el.size || 20);
                    const radius = baseRadius * renderer.scale;
                    return (dx * dx + dy * dy) <= (radius * radius);
                };
            }
        }
        this.render();
    }

    render() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        ctx.save();
        ctx.clearRect(0, 0, w, h);
        // 第一遍：绘制所有非连线元素
        for (const el of this.elements) {
            if (el.type !== 'line') {
                this.drawElement(el);
            }
        }
        // 第二遍：绘制所有连线元素（覆盖在头像之上）
        for (const el of this.elements) {
            if (el.type === 'line') {
                this.drawElement(el);
            }
        }
        // 第三遍：绘制图钉（在连线之上，最上层）
        for (const el of this.elements) {
            if (el.type === 'avatar' || el.type === 'relationship' || el.type === 'branch') {
                let posY;
                if (el.type === 'branch') {
                    posY = el.y;  // 分支点自身位置
                } else {
                    posY = el.y - el.size + 4;  // 头像顶部偏上
                }
                const pos = this.worldToScreen(el.x, posY);
                this.drawPin(el, pos.x, pos.y);
            }
        }
        ctx.restore();
    }

    drawElement(el) {
        // 确保 scale 有效
        if (isNaN(this.scale) || this.scale < 0) {
            this.scale = 1;
        }
        const ctx = this.ctx;
        const pos = this.worldToScreen(el.x, el.y);

        switch (el.type) {
            case 'avatar':
                this.drawAvatar(ctx, pos.x, pos.y, el.size || 40, el.image, el.label, true, el.clipRatio);
                break;
            case 'relationship':
                this.drawAvatar(ctx, pos.x, pos.y, el.size || 28, el.image, el.label, false, el.clipRatio);
                // 二级延申节点：虚线外圈
                if (el.isExtension) {
                    ctx.save();
                    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
                    ctx.lineWidth = 1.5 * this.scale;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, (el.size || 28) * this.scale + 4, 0, 2 * Math.PI);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.restore();
                }
                break;
            case 'logo': {
                const size = el.size || 60;
                ctx.save();
                ctx.globalAlpha = 0.3;
                if (el.image) {
                    const img = this.imageCache.get(el.image);
                    if (img) {
                        ctx.drawImage(img, pos.x - size/2, pos.y - size/2, size, size);
                    } else {
                        ctx.fillStyle = '#5f6a7a';
                        ctx.fillRect(pos.x - size/2, pos.y - size/2, size, size);
                    }
                }
                ctx.restore();
                break;
            }
            case 'random_image': {
                const baseSize = el.baseSize || 120;
                const rotation = el.rotation || 0;
                const opacity = el.opacity !== undefined ? el.opacity : 0.5;
                ctx.save();
                ctx.translate(pos.x, pos.y);
                ctx.rotate(rotation);
                ctx.globalAlpha = opacity;
                if (el.image) {
                    const img = this.imageCache.get(el.image);
                    if (img) {
                        const imgWidth = img.width;
                        const imgHeight = img.height;
                        let displayWidth = baseSize * this.scale;
                        let displayHeight = baseSize * this.scale;
                        if (imgWidth > 0 && imgHeight > 0) {
                            const aspectRatio = imgWidth / imgHeight;
                            if (aspectRatio >= 1) {
                                displayWidth = baseSize * this.scale;
                                displayHeight = (baseSize / aspectRatio) * this.scale;
                            } else {
                                displayHeight = baseSize * this.scale;
                                displayWidth = (baseSize * aspectRatio) * this.scale;
                            }
                        }
                        ctx.drawImage(img, -displayWidth/2, -displayHeight/2, displayWidth, displayHeight);
                    } else {
                        // 占位图（缩放）
                        const size = baseSize * this.scale;
                        ctx.fillStyle = 'rgba(100,150,200,0.2)';
                        ctx.fillRect(-size/2, -size/2, size, size);
                        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                        ctx.lineWidth = 1;
                        ctx.strokeRect(-size/2, -size/2, size, size);
                    }
                } else {
                    const size = baseSize * this.scale;
                    ctx.fillStyle = 'rgba(100,150,200,0.2)';
                    ctx.fillRect(-size/2, -size/2, size, size);
                }
                ctx.restore();
                break;
            }
            case 'text': {
                ctx.save();
                ctx.fillStyle = el.color || 'rgba(255,255,255,0.8)';
                ctx.font = `${el.size || 13}px "Segoe UI", sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowBlur = 6;
                ctx.fillText(el.data || el.label || '', pos.x, pos.y);
                ctx.restore();
                break;
            }
            case 'note': {
                const text = el.data || '';
                const rotation = el.rotation || 0;
                const fontSize = el.size || 13;
                // 便签宽度（160~320px）
                const minWidth = 160;
                const maxWidth = 320;
                const widthSeed = (el.category || 'note') + (el.data || '');
                const width = minWidth + (hashString(widthSeed) % (maxWidth - minWidth + 1));
                const padding = 12;
                ctx.save();
                ctx.translate(pos.x, pos.y);
                ctx.rotate(rotation);

                ctx.font = `${fontSize}px "Segoe UI", sans-serif`;
                const availableWidth = width - padding * 2;
                const words = text.split(' ');
                const lines = [];
                let currentLine = '';
                for (const word of words) {
                    const testLine = currentLine + (currentLine ? ' ' : '') + word;
                    const metrics = ctx.measureText(testLine);
                    if (metrics.width > availableWidth) {
                        if (currentLine) {
                            // 当前行已满，压入并开始新行
                            let finalLine = currentLine;
                            let finalMetrics = ctx.measureText(finalLine);
                            if (finalMetrics.width > availableWidth) {
                                while (ctx.measureText(finalLine + '…').width > availableWidth && finalLine.length > 1) {
                                    finalLine = finalLine.slice(0, -1);
                                }
                                finalLine += '…';
                            }
                            lines.push(finalLine);
                            currentLine = word;
                        } else {
                            // 单个词超长，强制截断
                            let truncated = word;
                            while (ctx.measureText(truncated + '…').width > availableWidth && truncated.length > 1) {
                                truncated = truncated.slice(0, -1);
                            }
                            lines.push(truncated + '…');
                            currentLine = '';
                        }
                    } else {
                        currentLine = testLine;
                    }
                }
                if (currentLine) {
                    let finalLine = currentLine;
                    let finalMetrics = ctx.measureText(finalLine);
                    if (finalMetrics.width > availableWidth) {
                        while (ctx.measureText(finalLine + '…').width > availableWidth && finalLine.length > 1) {
                            finalLine = finalLine.slice(0, -1);
                        }
                        finalLine += '…';
                    }
                    lines.push(finalLine);
                }

                // 限制最大行数，并截断最后一行
                const maxLines = 6;
                let displayLines = lines;
                if (lines.length > maxLines) {
                    displayLines = lines.slice(0, maxLines);
                    const lastLine = displayLines[displayLines.length - 1];
                    let truncatedLast = lastLine;
                    while (ctx.measureText(truncatedLast + '…').width > availableWidth && truncatedLast.length > 1) {
                        truncatedLast = truncatedLast.slice(0, -1);
                    }
                    displayLines[displayLines.length - 1] = truncatedLast + '…';
                }

                const lineHeight = fontSize * 1.5;
                const textHeight = displayLines.length * lineHeight;
                const boxHeight = textHeight + padding * 2;
                const w = width;
                const h = boxHeight;

                // 便签背景
                ctx.shadowColor = 'rgba(0,0,0,0.25)';
                ctx.shadowBlur = 10;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 3;
                ctx.fillStyle = el.color || '#fff8e7';
                ctx.beginPath();
                const radius = Math.max(0, 4);
                ctx.roundRect(-w/2, -h/2, w, h, radius);
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
                // 边框
                ctx.strokeStyle = 'rgba(0,0,0,0.05)';
                ctx.lineWidth = 1;
                ctx.strokeRect(-w/2, -h/2, w, h);

                // 绘制文本（每行绘制前二次检查宽度）
                ctx.fillStyle = el.textColor || '#333';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                const startY = -h/2 + padding;
                for (let i = 0; i < displayLines.length; i++) {
                    let displayLine = displayLines[i];
                    let metrics = ctx.measureText(displayLine);
                    if (metrics.width > availableWidth) {
                        while (ctx.measureText(displayLine + '…').width > availableWidth && displayLine.length > 1) {
                            displayLine = displayLine.slice(0, -1);
                        }
                        displayLine += '…';
                    }
                    ctx.fillText(displayLine, -w/2 + padding, startY + i * lineHeight);
                }

                ctx.restore();
                break;
            }
            case 'branch_tag': {
                const style = el.style || {};
                const bg = style.bg || '#f0f0f0';
                const textColor = style.textColor || '#333';
                const fontSize = (style.fontSize || 14) * this.scale;
                const padding = (style.padding || 6) * this.scale;
                const borderRadius = Math.max(0, (style.borderRadius || 4) * this.scale);
                const rotation = style.rotation || 0;

                ctx.save();
                ctx.translate(pos.x, pos.y);
                ctx.rotate(rotation);

                ctx.font = `${fontSize}px "Segoe UI", sans-serif`;
                const metrics = ctx.measureText(el.content);
                const textWidth = metrics.width;
                const textHeight = fontSize * 1.2;
                const w = textWidth + padding * 2;
                const h = textHeight + padding * 2;

                // 背景
                ctx.shadowColor = 'rgba(0,0,0,0.15)';
                ctx.shadowBlur = 6;
                ctx.shadowOffsetX = 1;
                ctx.shadowOffsetY = 2;
                ctx.fillStyle = bg;
                ctx.beginPath();
                ctx.roundRect(-w/2, -h/2, w, h, borderRadius);
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;

                // 边框（可选）
                ctx.strokeStyle = 'rgba(0,0,0,0.05)';
                ctx.lineWidth = 1;
                ctx.strokeRect(-w/2, -h/2, w, h);

                // 文本
                ctx.fillStyle = textColor;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(el.content, 0, 0);

                ctx.restore();
                break;
            }
            case 'line': {
                const from = this.worldToScreen(el.fromX, el.fromY);
                const to = this.worldToScreen(el.toX, el.toY);
                ctx.save();
                // 增强阴影：颜色更深，偏移右下方，模拟灯光从上至下
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowBlur = 8;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 3;
                ctx.beginPath();
                ctx.moveTo(from.x, from.y);
                ctx.lineTo(to.x, to.y);
                ctx.strokeStyle = el.color || 'rgba(74,125,181,0.4)';
                ctx.lineWidth = el.lineWidth || 2;
                ctx.stroke();
                ctx.restore();
                break;
            }
            case 'arc': {
                const from = this.worldToScreen(el.fromX, el.fromY);
                const to = this.worldToScreen(el.toX, el.toY);
                const ctrl = this.worldToScreen(el.controlX, el.controlY);
                const lineWidth = (el.lineWidth || 3) * this.scale;
                ctx.save();
                ctx.shadowColor = 'rgba(0,0,0,0.3)';
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.moveTo(from.x, from.y);
                ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
                ctx.strokeStyle = el.color || 'rgba(255,255,255,0.6)';
                ctx.lineWidth = lineWidth;
                ctx.stroke();
                // 箭头（在终点方向）
                const angle = Math.atan2(to.y - ctrl.y, to.x - ctrl.x);
                const arrowLen = (el.arrowSize || 12) * this.scale;
                const arrowAngle = 0.4;
                ctx.fillStyle = el.color || 'rgba(255,255,255,0.6)';
                ctx.beginPath();
                ctx.moveTo(to.x, to.y);
                ctx.lineTo(to.x - arrowLen * Math.cos(angle - arrowAngle), to.y - arrowLen * Math.sin(angle - arrowAngle));
                ctx.lineTo(to.x - arrowLen * Math.cos(angle + arrowAngle), to.y - arrowLen * Math.sin(angle + arrowAngle));
                ctx.closePath();
                ctx.fill();
                ctx.restore();
                break;
            }
            case 'line_with_label': {
                const from = this.worldToScreen(el.fromX, el.fromY);
                const to = this.worldToScreen(el.toX, el.toY);
                // 计算角度
                const angle = Math.atan2(to.y - from.y, to.x - from.x);
                // 绘制线段
                ctx.save();
                ctx.shadowColor = 'rgba(255,255,255,0.25)';
                ctx.shadowBlur = 6;
                ctx.beginPath();
                ctx.moveTo(from.x, from.y);
                ctx.lineTo(to.x, to.y);
                ctx.strokeStyle = el.color || 'rgba(255,255,255,0.3)';
                ctx.lineWidth = el.lineWidth || 1.5;
                ctx.stroke();
                ctx.restore();

                // 绘制数字（带旋转）
                if (el.number !== undefined) {
                    ctx.save();
                    ctx.fillStyle = 'rgba(255,255,255,0.25)';
                    const fontSize = Math.max(10, 14 * this.scale);
                    ctx.font = `${fontSize}px "Segoe UI", sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.shadowColor = 'rgba(0,0,0,0.4)';
                    ctx.shadowBlur = 4;
                    // 数字位置：末端沿线段方向偏移
                    const offsetDist = 12 * this.scale;
                    const numX = to.x + Math.cos(angle) * offsetDist;
                    const numY = to.y + Math.sin(angle) * offsetDist;
                    ctx.translate(numX, numY);
                    ctx.rotate(angle);
                    ctx.fillText(String(el.number), 0, 0);
                    ctx.restore();
                }
                break;
            }
            case 'worldset_cluster': {
                var wsDisplaySize = (el.size || 38) * this.scale;
                ctx.save();
                ctx.shadowColor = el.color || '#888';
                ctx.shadowBlur = 20 * this.scale;
                ctx.fillStyle = el.color || '#888';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, wsDisplaySize, 0, 2 * Math.PI);
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, wsDisplaySize * 0.6, 0, 2 * Math.PI);
                ctx.fill();
                var wsLabel = el.label || '';
                var wsSublabel = el.sublabel || '';
                var wsFontSize = Math.max(13, 16 * this.scale);
                ctx.fillStyle = '#fff';
                ctx.font = 'bold ' + wsFontSize + 'px "Segoe UI", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(wsLabel, pos.x, pos.y - 2);
                if (wsSublabel) {
                    var wsSubFontSize = Math.max(10, 11 * this.scale);
                    ctx.font = wsSubFontSize + 'px "Segoe UI", sans-serif';
                    ctx.fillStyle = 'rgba(255,255,255,0.7)';
                    ctx.fillText(wsSublabel, pos.x, pos.y + wsFontSize * 0.7);
                }
                ctx.restore();
                break;
            }
            case 'global_root_node': {
                var rtDisplaySize = (el.size || 72) * this.scale;
                ctx.save();
                ctx.shadowColor = el.color || '#1a5276';
                ctx.shadowBlur = 30 * this.scale;
                ctx.fillStyle = el.color || '#1a5276';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, rtDisplaySize, 0, 2 * Math.PI);
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.fillStyle = 'rgba(0,0,0,0.25)';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, rtDisplaySize * 0.75, 0, 2 * Math.PI);
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                ctx.lineWidth = 2 * this.scale;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, rtDisplaySize, 0, 2 * Math.PI);
                ctx.stroke();
                var rtFontSize = Math.max(16, 20 * this.scale);
                ctx.fillStyle = '#fff';
                ctx.font = 'bold ' + rtFontSize + 'px "Segoe UI", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(el.label || '', pos.x, pos.y - 2);
                if (el.sublabel) {
                    var rtSubFontSize = Math.max(10, 12 * this.scale);
                    ctx.font = rtSubFontSize + 'px "Segoe UI", sans-serif';
                    ctx.fillStyle = 'rgba(255,255,255,0.6)';
                    ctx.fillText(el.sublabel, pos.x, pos.y + rtFontSize * 0.6);
                }
                ctx.restore();
                break;
            }
            case 'global_cat_node': {
                var catDisplaySize = (el.size || 50) * this.scale;
                ctx.save();
                ctx.shadowColor = el.color || '#888';
                ctx.shadowBlur = 15 * this.scale;
                ctx.fillStyle = el.color || '#888';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, catDisplaySize, 0, 2 * Math.PI);
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.fillStyle = 'rgba(0,0,0,0.2)';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, catDisplaySize * 0.55, 0, 2 * Math.PI);
                ctx.fill();
                var catFontSize = Math.max(12, 15 * this.scale);
                ctx.fillStyle = '#fff';
                ctx.font = 'bold ' + catFontSize + 'px "Segoe UI", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(el.label || '', pos.x, pos.y - 1);
                if (el.sublabel) {
                    var catSubFontSize = Math.max(9, 11 * this.scale);
                    ctx.font = catSubFontSize + 'px "Segoe UI", sans-serif';
                    ctx.fillStyle = 'rgba(255,255,255,0.65)';
                    ctx.fillText(el.sublabel, pos.x, pos.y + catFontSize * 0.65);
                }
                ctx.restore();
                break;
            }

            case 'worldset_node': {
                var wsNodeSize = (el.size || 30) * this.scale;
                ctx.save();
                ctx.shadowColor = el.color || '#888';
                ctx.shadowBlur = 10 * this.scale;
                ctx.fillStyle = el.color || '#888';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, wsNodeSize, 0, 2 * Math.PI);
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.font = (Math.max(9, 10 * this.scale)) + 'px "Segoe UI", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                var wsNodeLabel = (el.label || '').slice(0, 8);
                ctx.fillText(wsNodeLabel, pos.x, pos.y);
                ctx.restore();
                break;
            }

            default:
                break;
        }
    }

    drawAvatar(ctx, x, y, radius, imageUrl, label, isCenter, clipRatio) {
        // 计算当前缩放后的显示半径
        const displayRadius = radius * this.scale;
        const size = displayRadius * 2;
        const ratio = clipRatio !== undefined ? clipRatio : 0.85;
        const clipWidth = size * ratio;
        const clipHeight = size;
        const clipX = x - clipWidth / 2;
        const clipY = y - displayRadius;

        // 1. 白色矩形边框（直角，无圆角）
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(clipX - 4, clipY - 4, clipWidth + 8, clipHeight + 8);
        ctx.shadowBlur = 0;
        ctx.restore();

        // 2. 头像图片（矩形裁剪）
        ctx.save();
        ctx.beginPath();
        ctx.rect(clipX, clipY, clipWidth, clipHeight);
        ctx.clip();
        if (imageUrl) {
            const img = this.imageCache.get(imageUrl);
            if (img) {
                const imgWidth = img.width || 200;
                const imgHeight = img.height || 200;
                const targetRatio = clipWidth / clipHeight;
                const imgRatio = imgWidth / imgHeight;
                let srcX, srcY, srcW, srcH;
                if (imgRatio > targetRatio) {
                    srcH = imgHeight;
                    srcW = imgHeight * targetRatio;
                    srcX = (imgWidth - srcW) / 2;
                    srcY = 0;
                } else {
                    srcW = imgWidth;
                    srcH = imgWidth / targetRatio;
                    srcX = 0;
                    srcY = (imgHeight - srcH) / 2;
                }
                ctx.drawImage(img, srcX, srcY, srcW, srcH, clipX, clipY, clipWidth, clipHeight);
            } else {
                ctx.fillStyle = '#4a7db5';
                ctx.fillRect(clipX, clipY, clipWidth, clipHeight);
            }
        } else {
            ctx.fillStyle = '#4a7db5';
            ctx.fillRect(clipX, clipY, clipWidth, clipHeight);
        }
        ctx.restore();

        // 3. 扫描线覆层
        ctx.save();
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = '#000';
        for (let yLine = clipY; yLine < clipY + clipHeight; yLine += 3) {
            ctx.fillRect(clipX, yLine, clipWidth, 1);
        }
        ctx.restore();

        // 4. 代号标签（字号随缩放变化）
        if (label) {
            const labelY = y + displayRadius + 4;
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            // 基础字号根据是否中心缩放，最小保留可读性
            const baseSize = isCenter ? 36 : 16;
            const fontSize = Math.max(baseSize * this.scale, isCenter ? 14 : 10);
            ctx.font = `${fontSize}px "Rage Italic", "Courier New", monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.shadowColor = 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = 6;
            ctx.fillText(label, x, labelY);
            ctx.restore();
        }
    }

    drawPin(el, screenX, screenY) {
        const ctx = this.ctx;
        const size = el.size || 32;
        const scale = this.scale;
        const baseRadius = size * scale * 0.18;
        const topRadius = baseRadius * 0.7;

        const dx = screenX - this.centerX;
        const dy = screenY - this.centerY;
        const dist = Math.hypot(dx, dy);
        const maxDist = Math.max(this.width, this.height) * 0.6;
        const factor = Math.min(dist / maxDist, 1);
        const offset = factor * topRadius * 0.8;
        let offsetX = 0, offsetY = 0;
        if (dist > 1) {
            offsetX = (dx / dist) * offset;
            offsetY = (dy / dist) * offset;
        }

        const pinColor = el.pinColor || '#555';

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        ctx.beginPath();
        ctx.arc(screenX, screenY, baseRadius, 0, Math.PI * 2);
        ctx.fillStyle = pinColor;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.restore();

        const topX = screenX + offsetX;
        const topY = screenY + offsetY;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = -1;
        ctx.shadowOffsetY = 1;
        ctx.beginPath();
        ctx.arc(topX, topY, topRadius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';  // 上层改为半透明白色
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.beginPath();
        ctx.arc(topX - topRadius*0.2, topY - topRadius*0.2, topRadius*0.3, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fill();
        ctx.restore();
    }

    updateZoomLevel() {
        const level = document.getElementById('zoom-level');
        if (level) {
            level.textContent = Math.round(this.scale * 100) + '%';
        }
    }

    zoomIn() {
        const newScale = Math.min(3, this.scale * 1.2);
        this.scale = newScale;
        this.render();
        this.updateZoomLevel();
    }
    zoomOut() {
        const newScale = Math.max(0.3, this.scale * 0.8);
        this.scale = newScale;
        this.render();
        this.updateZoomLevel();
    }
    resetView() {
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.render();
        this.updateZoomLevel();
    }

    // ---- 入场动画 ----
    startEntranceAnimation() {
        if (this.entranceActive) return;

        // 创建覆盖 Canvas（位于主 Canvas 之上）
        const container = this.canvas.parentElement;
        if (!container) return;

        // 移除旧 Canvas（如果有）
        if (this.entranceCanvas) {
            this.entranceCanvas.remove();
            this.entranceCanvas = null;
            this.entranceCtx = null;
        }

        const dpr = window.devicePixelRatio || 1;
        const canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = this.width + 'px';
        canvas.style.height = this.height + 'px';
        canvas.style.pointerEvents = 'none';  // 不阻挡交互
        canvas.style.zIndex = '10';
        canvas.width = this.width * dpr;
        canvas.height = this.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        container.appendChild(canvas);
        this.entranceCanvas = canvas;
        this.entranceCtx = ctx;
        this.entranceActive = true;
        this.entranceStartTime = performance.now();

        // 生成放射线段数据（在动画开始前固定）
        this._generateEntranceLines();

        // 启动主循环（使用 requestAnimationFrame）
        this._entranceLoop();
    }

    _generateEntranceLines() {
        const cfg = GraphRenderer.entranceConfig;
        const rand = seededRandom(hashString(`entrance:${window.location.search || 'root'}`));
        const lines = [];
        const count = Math.floor(rand() * (cfg.maxLines - 4)) + 4; // 4~maxLines
        const centerX = this.centerX;
        const centerY = this.centerY;

        for (let i = 0; i < count; i++) {
            const angle = rand() * 2 * Math.PI;
            const length = cfg.lineMinLength + rand() * (cfg.lineMaxLength - cfg.lineMinLength);
            const startDist = cfg.lineStartDistMin + rand() * (cfg.lineStartDistMax - cfg.lineStartDistMin);
            const startX = centerX + Math.cos(angle) * startDist;
            const startY = centerY + Math.sin(angle) * startDist;
            const endX = startX + Math.cos(angle) * length;
            const endY = startY + Math.sin(angle) * length;
            const number = Math.floor(rand() * 10);
            const appearTime = rand() * cfg.appearTimeMax;
            const disappearTime = cfg.disappearTimeMin + rand() * (cfg.disappearTimeMax - cfg.disappearTimeMin);
            const keep = rand() < cfg.keepProbability;

            // ---- 生成方块 ----
            const squares = [];
            const squareCount = 1 + Math.floor(rand() * 2); // 1~2 个方块
            const positions = [
                { x: startX, y: startY },           // 起始端
                { x: endX, y: endY },               // 末端
                { x: centerX + (rand()-0.5)*200, y: centerY + (rand()-0.5)*200 } // 中心周围随机
            ];
            // 随机选取位置（可重复）
            for (let s = 0; s < squareCount; s++) {
                const posIdx = Math.floor(rand() * positions.length);
                const pos = positions[posIdx];
                // 随机偏移 ±20px
                const offsetX = (rand() - 0.5) * 40;
                const offsetY = (rand() - 0.5) * 40;
                const size = 8 + rand() * 20;
                const filled = rand() < 0.5; // 50% 填充，50% 边框
                squares.push({
                    x: pos.x + offsetX,
                    y: pos.y + offsetY,
                    size: size,
                    filled: filled,
                    // 每个方块独立出现/消失时间（可在整体时间基础上微调）
                    appearOffset: rand() * 100,
                    disappearOffset: rand() * 150
                });
            }

            lines.push({
                startX, startY, endX, endY,
                number,
                appearTime,
                disappearTime,
                keep,
                alive: false,
                visible: true,
                squares: squares,   // 存储方块数据
                angle: angle        // 存储角度，用于数字旋转
            });
        }
        this.entranceLines = lines;
        this.entranceLineCount = lines.length;
    }

    _entranceLoop() {
        if (!this.entranceActive) return;

        const elapsed = performance.now() - this.entranceStartTime;
        const totalDuration = this.entranceDuration;

        // 绘制入场内容
        this._drawEntrance(elapsed);

        // 如果动画未结束，继续下一帧
        if (elapsed < totalDuration) {
            requestAnimationFrame(() => this._entranceLoop());
        } else {
            // 动画结束，移除覆盖 Canvas 并清理
            this._finishEntrance();
        }
    }

    _drawEntrance(elapsed) {
        const ctx = this.entranceCtx;
        if (!ctx) return;

        const w = this.width;
        const h = this.height;

        // 清除画布（透明背景）
        ctx.clearRect(0, 0, w, h);

        // 1. 扫描线效果（在整体上方半透明叠加）
        this._drawScanlines(ctx, elapsed);

        // 2. 放射线段
        this._drawRadialLines(ctx, elapsed);
    }

    _drawScanlines(ctx, elapsed) {
        const duration = this.entranceDuration;
        const progress = Math.min(elapsed / duration, 1);

        // 扫描线透明度：使用 sin + tan 控制闪烁
        // 第一阶段（0~0.5s）透明度快速上升并闪烁
        // 第二阶段（0.5~1.5s）稳定高亮，小间隔
        // 第三阶段（1.5~2.0s）切换到大间隔并闪烁，然后消失
        let alpha = 0;
        let spacing = 3; // 默认小间隔

        if (progress < 0.2) {
            // 0~0.2: 快速出现并闪烁
            const t = progress / 0.2;
            const sinVal = Math.sin(t * 20) * 0.5 + 0.5;
            const tanVal = Math.tan(t * 15) * 0.3;
            alpha = Math.min(1, Math.max(0, t * 0.8 + sinVal * 0.2 + tanVal * 0.1));
            spacing = 3 + Math.sin(t * 30) * 1;
        } else if (progress < 0.6) {
            // 0.2~0.6: 稳定高亮，小间隔
            const t = (progress - 0.2) / 0.4;
            const sinVal = Math.sin(t * 25 + 0.5) * 0.3 + 0.5;
            alpha = 0.7 + sinVal * 0.2;
            spacing = 3 + Math.sin(t * 20) * 0.5;
        } else if (progress < 0.8) {
            // 0.6~0.8: 切换到大间隔（立即变化）
            const t = (progress - 0.6) / 0.2;
            alpha = 0.6 + Math.sin(t * 30) * 0.3;
            spacing = 12 + Math.sin(t * 15) * 3; // 大间隔
        } else {
            // 0.8~1.0: 大间隔闪烁并消失
            const t = (progress - 0.8) / 0.2;
            const sinVal = Math.sin(t * 40) * 0.5 + 0.5;
            const tanVal = Math.tan(t * 25) * 0.2;
            alpha = Math.max(0, (1 - t) * 0.8 + sinVal * 0.2 + tanVal * 0.1);
            spacing = 12 + Math.sin(t * 20) * 2;
        }

        // 应用扫描线
        if (alpha > 0.01) {
            ctx.save();
            ctx.globalAlpha = alpha * GraphRenderer.entranceConfig.scanlineAlpha;
            ctx.fillStyle = '#000';
            const lineWidth = 1;
            // 绘制水平扫描线
            for (let y = 0; y < this.height; y += spacing) {
                ctx.fillRect(0, y, this.width, lineWidth);
            }
            ctx.restore();
        }
    }

    _drawRadialLines(ctx, elapsed) {
        const cfg = GraphRenderer.entranceConfig;
        const lines = this.entranceLines;
        const duration = this.entranceDuration;

        // 更新线段存活状态
        for (const line of lines) {
            if (elapsed < line.appearTime) {
                line.alive = false;
                line.visible = false;
            } else if (line.keep) {
                line.alive = true;
                line.visible = true;
            } else if (elapsed > line.disappearTime && elapsed < duration) {
                line.alive = true;
                line.visible = false;
            } else {
                line.alive = true;
                line.visible = true;
            }
        }

        // 统计当前可见线段数，确保至少保留 2~3 条
        let visibleCount = lines.filter(l => l.visible).length;
        if (visibleCount < 3 && elapsed < duration * 0.9) {
            const candidates = lines.filter(l => !l.visible && l.alive);
            for (const line of candidates) {
                if (visibleCount >= 3) break;
                line.visible = true;
                visibleCount++;
            }
        }

        // 绘制可见线段、方块、数字
        ctx.save();
        for (const line of lines) {
            if (!line.visible) continue;
            const baseAlpha = 0.6 + Math.sin(elapsed / 300 + line.startX) * 0.3;
            const globalAlpha = Math.min(1, Math.max(0.2, baseAlpha * cfg.lineAlpha));
            ctx.globalAlpha = globalAlpha;

            // 绘制线段
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.lineWidth = 2;
            ctx.shadowColor = 'rgba(255,255,255,0.3)';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.moveTo(line.startX, line.startY);
            ctx.lineTo(line.endX, line.endY);
            ctx.stroke();

            // ---- 绘制方块 ----
            for (const sq of line.squares) {
                // 方块的出现/消失时间（相对于线段）
                const sqAppear = line.appearTime + sq.appearOffset;
                const sqDisappear = line.disappearTime + sq.disappearOffset;
                if (elapsed < sqAppear || elapsed > sqDisappear) continue;

                const size = sq.size * this.scale;
                const x = sq.x;
                const y = sq.y;
                ctx.save();
                ctx.shadowColor = 'rgba(255,255,255,0.15)';
                ctx.shadowBlur = 4;
                ctx.translate(x, y);
                ctx.rotate(line.angle); // 与线段同轴
                if (sq.filled) {
                    ctx.fillStyle = 'rgba(255,255,255,0.15)';
                    ctx.fillRect(-size/2, -size/2, size, size);
                } else {
                    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(-size/2, -size/2, size, size);
                }
                ctx.restore();
            }

            // ---- 绘制数字（带旋转） ----
            const angle = line.angle;
            ctx.save();
            ctx.shadowBlur = 4;
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            const fontSize = Math.max(10, cfg.numberFontSize * this.scale);
            ctx.font = fontSize + 'px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            // 数字位置：线段末端，沿线段方向偏移一定距离
            const offsetDist = 14 * this.scale;
            const numX = line.endX + Math.cos(angle) * offsetDist;
            const numY = line.endY + Math.sin(angle) * offsetDist;
            // 旋转到与线段同轴
            ctx.translate(numX, numY);
            ctx.rotate(angle);
            ctx.fillText(String(line.number), 0, 0);
            ctx.restore();
        }
        ctx.restore();43
    }

    _finishEntrance() {
        this.entranceActive = false;

        // 1. 将保留的线段添加到主渲染器的元素中（永久存在）
        const keptLines = this.entranceLines.filter(line => line.keep === true);
        for (const line of keptLines) {
            this.elements.push({
                id: `entrance_line_${Math.abs(hashString(`${line.startX}:${line.startY}:${line.number}`))}`,
                type: 'line_with_label',  // 使用新类型同时绘制线段和数字
                fromX: line.startX,
                fromY: line.startY,
                toX: line.endX,
                toY: line.endY,
                color: 'rgba(255, 255, 255, 0.2)',
                lineWidth: 1.5,
                number: line.number,       // 保留数字
                clickable: false
            });
        }

        // 2. 移除覆盖 Canvas
        if (this.entranceCanvas) {
            this.entranceCanvas.remove();
            this.entranceCanvas = null;
            this.entranceCtx = null;
        }

        // 3. 重新渲染主画面（包含新添加的线段）
        this.render();
    }
}

// roundRect polyfill
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
        if (r > w/2) r = w/2;
        if (r > h/2) r = h/2;
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        return this;
    };
}

// ================================================================
//  4. 布局生成器
// ================================================================

// ================================================================
//  全局根布局生成器 — mode=global_root
// ================================================================
async function generateGlobalRootLayout(width, height, renderer) {
    // 预获取 worldset 分类计数
    var wsCounts = {};
    try {
        var wsRes = await fetch('/static_knowledge/worldset/categories');
        if (wsRes.ok) {
            var wsData = await wsRes.json();
            var cats = wsData.categories || [];
            for (var ci = 0; ci < cats.length; ci++) {
                var catName = (cats[ci].category || '').replace('worldset/', '');
                wsCounts[catName] = cats[ci].count || 0;
            }
        }
    } catch(e) { /* 忽略计数错误 */ }

    var elements = [];
    var cx = width / 2;
    var cy = height / 2;

    elements.push({
        id: 'root', type: 'global_root_node',
        x: cx, y: cy, size: 72, label: '罗德岛', sublabel: '档案库',
        color: '#1a5276', clickable: true, data: { type: 'root' }
    });

    var categories = [
        { id: 'cat_operators', type: 'operators', label: '干员', color: '#e74c3c', count: '300+' },
        { id: 'cat_nations', type: 'worldset', worldsetKey: 'nations', label: '国家', color: '#c0392b', count: '' },
        { id: 'cat_organizations', type: 'worldset', worldsetKey: 'organizations', label: '组织', color: '#2980b9', count: '' },
        { id: 'cat_races', type: 'worldset', worldsetKey: 'races', label: '种族', color: '#27ae60', count: '' },
        { id: 'cat_creatures', type: 'worldset', worldsetKey: 'creatures', label: '生物', color: '#8e44ad', count: '' },
        { id: 'cat_locations', type: 'worldset', worldsetKey: 'locations', label: '地点', color: '#16a085', count: '' },
        { id: 'cat_cities', type: 'worldset', worldsetKey: 'cities', label: '城市', color: '#f39c12', count: '' },
        { id: 'cat_settings', type: 'worldset', worldsetKey: 'settings', label: '设定', color: '#d35400', count: '' },
        { id: 'cat_originium', type: 'worldset', worldsetKey: 'originium', label: '源石', color: '#e67e22', count: '' },
        { id: 'cat_industry', type: 'worldset', worldsetKey: 'industry', label: '工业', color: '#7f8c8d', count: '' },
        { id: 'cat_artifacts', type: 'worldset', worldsetKey: 'artifacts', label: '化物', color: '#e74c3c', count: '' },
        { id: 'cat_civilization', type: 'worldset', worldsetKey: 'civilization', label: '文明', color: '#3498db', count: '' },
        { id: 'cat_corrosion', type: 'worldset', worldsetKey: 'corrosion', label: '侵蚀', color: '#2c3e50', count: '' },
    ];

    // 更新分类节点的 count
    for (var ci2 = 0; ci2 < categories.length; ci2++) {
        if (categories[ci2].type === 'operators') {
            categories[ci2].count = '300+';
        } else if (categories[ci2].worldsetKey) {
            var cnt = wsCounts[categories[ci2].worldsetKey];
            categories[ci2].count = (cnt !== undefined) ? String(cnt) : '?';
        }
    }

    // 使用随机环形位置（复用干员图谱的随机点位方法）
    var ringSeed = hashString('global_root');
    var ringRand = seededRandom(ringSeed);
    var ringRadiusMin = 130;
    var ringRadiusMax = Math.min(width, height) * 0.42;

    function ringIsOverlapping(x, y, radius, existing, margin) {
        margin = margin || 15;
        for (var ei = 0; ei < existing.length; ei++) {
            var e = existing[ei];
            var dx = e.x - x;
            var dy = e.y - y;
            var minDist = (e.size || 50) + radius + margin;
            if (dx * dx + dy * dy < minDist * minDist) return true;
        }
        return false;
    }

    var catPositions = [];
    for (var attempts = 0; attempts < 500; attempts++) {
        var angle = ringRand() * 2 * Math.PI;
        var radius = ringRadiusMin + ringRand() * (ringRadiusMax - ringRadiusMin);
        var px = cx + Math.cos(angle) * radius * 1.15;
        var py = cy + Math.sin(angle) * radius * 0.85;
        if (px < 60 || px > width - 60 || py < 60 || py > height - 60) continue;
        if (Math.hypot(px - cx, py - cy) < 100) continue;
        if (ringIsOverlapping(px, py, 50, catPositions, 20)) continue;
        catPositions.push({ x: px, y: py, size: 50 });
    }

    for (var i = 0; i < categories.length; i++) {
        var cat = categories[i];
        var pos;
        if (i < catPositions.length) {
            pos = catPositions[i];
        } else {
            // 回退：等距环形
            var fallbackAngle = -Math.PI/2 + i * (2*Math.PI/categories.length);
            pos = {
                x: cx + Math.cos(fallbackAngle) * ringRadiusMax * 0.7,
                y: cy + Math.sin(fallbackAngle) * ringRadiusMax * 0.7
            };
        }
        elements.push({
            id: cat.id, type: 'global_cat_node',
            x: pos.x, y: pos.y, size: 50,
            label: cat.label, sublabel: cat.count, color: cat.color,
            catType: cat.type, worldsetKey: cat.worldsetKey || null, clickable: true,
            data: { type: 'category', catType: cat.type, catId: cat.id, worldsetKey: cat.worldsetKey || null }
        });
        elements.push({ type: 'line', fromX: cx, fromY: cy, toX: pos.x, toY: pos.y, color: cat.color + '66', lineWidth: 2 });
    }


    return { elements: elements, _categories: categories };
}

// 显示世界设定分类条目
async function showWorldsetCategory(renderer, worldsetKey, categoryLabel, width, height) {
    try {
        var res = await fetch('/static_knowledge/worldset?category=worldset/' + worldsetKey);
        var data = await res.json();
        var entries = data.entries || [];
        if (entries.length === 0) {
            window.__infoTitle.textContent = categoryLabel;
            window.__infoContent.textContent = '暂无条目';
            window.__infoLayer.classList.add('visible');
            return;
        }

        var seed = hashString('worldset:' + worldsetKey);
        var rand = seededRandom(seed);
        var cx = width / 2;
        var cy = height / 2;
        var elements = [];

        // 碰撞检测
        function isOverlapping(x, y, radius, existing, margin) {
            margin = margin || 8;
            for (var ei = 0; ei < existing.length; ei++) {
                var e = existing[ei];
                var dx = e.x - x;
                var dy = e.y - y;
                var minDist = (e.size || 20) + radius + margin;
                if (dx * dx + dy * dy < minDist * minDist) return true;
            }
            return false;
        }

        // 环绕位置池
        var ringPositions = [];
        var ringRmin = 100;
        var ringRmax = Math.min(width, height) * 0.40;
        for (var i = 0; i < 400; i++) {
            var angle = rand() * 2 * Math.PI;
            var radius = ringRmin + rand() * (ringRmax - ringRmin);
            var x = cx + Math.cos(angle) * radius * 1.15;
            var y = cy + Math.sin(angle) * radius * 0.85;
            if (x < 30 || x > width - 30 || y < 30 || y > height - 30) continue;
            if (Math.hypot(x - cx, y - cy) < 60) continue;
            if (isOverlapping(x, y, 25, ringPositions, 10)) continue;
            ringPositions.push({ x: x, y: y, size: 25 });
        }

        // 中心节点
        var wsColor = WORLDSET_CATEGORY_COLORS[worldsetKey] || '#888';
        elements.push({
            id: 'wscat_center', type: 'worldset_cluster',
            x: cx, y: cy, size: 50, label: categoryLabel,
            sublabel: entries.length + '条', color: wsColor,
            clickable: false, data: { type: 'category_center', key: worldsetKey }
        });

        // 放置条目节点
        var maxShow = Math.min(entries.length, 20);
        var ringIdx = 0;
        for (var ei = 0; ei < maxShow; ei++) {
            var entry = entries[ei];
            var pos;
            if (ringIdx < ringPositions.length) {
                pos = ringPositions[ringIdx++];
            } else {
                var a = rand() * 2 * Math.PI;
                var r = ringRmin + rand() * (ringRmax - ringRmin);
                pos = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
            }
            var title = (entry.content || '').replace(/^# .*?\n/, '').trim().slice(0, 40);
            elements.push({
                id: 'wsentry_' + entry.id, type: 'worldset_node',
                x: pos.x, y: pos.y, size: 30, label: title || '条目#' + entry.id,
                color: wsColor,
                clickable: true,
                data: { type: 'worldset_entry', entryId: entry.id, content: entry.content || '', key: worldsetKey }
            });
            elements.push({ type: 'line', fromX: cx, fromY: cy, toX: pos.x, toY: pos.y,
                color: wsColor + '44', lineWidth: 1 });
        }

        // 推入导航栈
        window.pushGraphView('worldset', { key: worldsetKey, label: categoryLabel });
        window.__currentView = 'worldset';
        renderer.setElements(elements);
    } catch (e) {
        console.error('[showWorldsetCategory]', e);
        window.__infoTitle.textContent = categoryLabel;
        window.__infoContent.textContent = '加载失败: ' + e.message;
        window.__infoLayer.classList.add('visible');
    }
}


// ================================================================
//  博士中心布局 — 随机干员关系图谱
// ================================================================
// ================================================================
//  博士中心布局 — 完全复用干员图谱，反向检索关系
// ================================================================
async function generateDoctorCenterLayout(width, height, renderer) {
    try {
        // 1. 获取所有干员 ID
        var allRes = await fetch(API_BASE + '/all');
        var allData = await allRes.json();
        var allIds = allData.operator_ids || [];
        var doctorRand = seededRandom(hashString('doctor_center'));
        if (allIds.length === 0) {
            window.__infoTitle.textContent = '干员档案';
            window.__infoContent.textContent = '暂无干员数据';
            window.__infoLayer.classList.add('visible');
            return;
        }

        // 2. 随机选取候选干员进行反向关系检索
        var maxProbe = Math.min(allIds.length, 30);
        var pool = allIds.slice();
        var candidates = [];
        for (var pi = 0; pi < maxProbe; pi++) {
            var ri = Math.floor(doctorRand() * pool.length);
            candidates.push(pool[ri]);
            pool.splice(ri, 1);
        }

        // 3. 反向检索：找出所有关系目标为 doctor 的干员
        var doctorRelations = [];
        for (var ci = 0; ci < candidates.length; ci++) {
            try {
                var relRes = await fetch(API_BASE + '/relationships/' + candidates[ci]);
                var relData = await relRes.json();
                var rels = relData.relationships || [];
                for (var rj = 0; rj < rels.length; rj++) {
                    var rel = rels[rj];
                    var targetId = (rel.target || '').toLowerCase();
                    if (targetId === 'doctor' || targetId === '博士') {
                        // 反转为：博士 → 该干员的关系
                        doctorRelations.push({
                            target: candidates[ci],
                            relation: rel.relation || rel.type || '关联',
                            description: (rel.relation || rel.type || '') + ': ' + (rel.description || '')
                        });
                    }
                }
            } catch (e) { /* 某些干员可能没有关系数据 */ }
        }

        // 同时加入一些随机干员作为额外环绕节点（即使它们和博士没有显式关系）
        // 从剩余池中随机选 5-10 个干员
        var extraPool = allIds.filter(function(id) {
            return !doctorRelations.some(function(r) { return r.target === id; });
        });
        var extraCount = Math.min(extraPool.length, 5 + Math.floor(doctorRand() * 6));
        for (var ei = 0; ei < extraCount; ei++) {
            var eri = Math.floor(doctorRand() * extraPool.length);
            doctorRelations.push({
                target: extraPool[eri],
                relation: '',
                description: ''
            });
            extraPool.splice(eri, 1);
        }

        // 4. 构建博士 operatorData
        var doctorData = {
            id: 'doctor',
            codename: '博士',
            origin: '罗德岛',
            race: '',
            gender: '',
            experiences: [],
            emotion_patterns: [],
            interaction_patterns: [],
            plot_hooks: [],
            relationships: doctorRelations
        };

        // 5. 直接复用 generateLayout（会使用 getOperatorAvatarUrl('doctor') → getDoctorAvatarUrl()）
        var layoutResult = await generateLayout(doctorData, doctorRelations, width, height, Math.min(doctorRelations.length, 15));

        // 水平散开：将所有节点横向拉伸 35%，增强左右分散感
        var spreadCenterX = width / 2;
        var spreadFactor = 1.35;
        for (var si = 0; si < layoutResult.elements.length; si++) {
            var elem = layoutResult.elements[si];
            if (elem.x !== undefined) {
                elem.x = spreadCenterX + (elem.x - spreadCenterX) * spreadFactor;
            }
            if (elem.fromX !== undefined) {
                elem.fromX = spreadCenterX + (elem.fromX - spreadCenterX) * spreadFactor;
            }
            if (elem.toX !== undefined) {
                elem.toX = spreadCenterX + (elem.toX - spreadCenterX) * spreadFactor;
            }
        }

        // 6. 二级延申：从已有干员节点中随机选 3-4 个，向外延申新干员
        var primaryOpIds = doctorRelations.map(function(r) { return r.target; });
        var extensionSources = [];
        var extPool = primaryOpIds.slice();
        if (extPool.length > 0) {
            // 随机选 3-4 个一级干员作为延申起点
            var extCount = Math.min(extPool.length, 3 + Math.floor(doctorRand() * 2));
            for (var exi = 0; exi < extCount; exi++) {
                var eri = Math.floor(doctorRand() * extPool.length);
                extensionSources.push(extPool[eri]);
                extPool.splice(eri, 1);
            }
        }

        // 对每个起点干员，查找其关系，向外延申 1-2 个新干员
        for (var esi = 0; esi < extensionSources.length; esi++) {
            var srcId = extensionSources[esi];
            try {
                var extRelRes = await fetch(API_BASE + '/relationships/' + srcId);
                var extRelData = await extRelRes.json();
                var extRels = extRelData.relationships || [];
                var extCandidates = [];
                for (var erj = 0; erj < extRels.length; erj++) {
                    var extTarget = extRels[erj].target || '';
                    // 排除已存在的节点 和 doctor
                    if (extTarget && extTarget.toLowerCase() !== 'doctor' &&
                        extTarget !== '博士' &&
                        primaryOpIds.indexOf(extTarget) < 0) {
                        extCandidates.push(extTarget);
                    }
                }
                // 随机选 1-2 个
                var extPick = Math.min(extCandidates.length, 1 + Math.floor(doctorRand() * 2));
                var extShuffled = extCandidates.slice();
                for (var shuffleIndex = extShuffled.length - 1; shuffleIndex > 0; shuffleIndex--) {
                    var swapIndex = Math.floor(doctorRand() * (shuffleIndex + 1));
                    var swapValue = extShuffled[shuffleIndex];
                    extShuffled[shuffleIndex] = extShuffled[swapIndex];
                    extShuffled[swapIndex] = swapValue;
                }
                for (var epi = 0; epi < extPick; epi++) {
                    var rawTarget = extShuffled[epi];
                    // 通过别名解析获取真实 operator ID
                    var resolvedId = rawTarget;
                    try {
                        resolvedId = await resolveAlias(rawTarget);
                        if (!resolvedId) resolvedId = rawTarget;
                    } catch (e) { resolvedId = rawTarget; }

                    // 找到源节点位置
                    var srcNode = null;
                    for (var sni = 0; sni < layoutResult.elements.length; sni++) {
                        var el = layoutResult.elements[sni];
                        if (el.type === 'relationship' && el.data && el.data.target === srcId) {
                            srcNode = el;
                            break;
                        }
                    }
                    // 在源节点外围放置二级节点
                    var extAngle = doctorRand() * 2 * Math.PI;
                    var extDist = 80 + doctorRand() * 100;
                    var extX = srcNode ? srcNode.x + Math.cos(extAngle) * extDist : width * 0.3 + doctorRand() * width * 0.4;
                    var extY = srcNode ? srcNode.y + Math.sin(extAngle) * extDist : height * 0.3 + doctorRand() * height * 0.4;

                    layoutResult.elements.push({
                        id: 'ext_op_' + resolvedId,
                        type: 'relationship',
                        x: extX, y: extY,
                        size: 24,
                        image: getOperatorAvatarUrl(resolvedId),
                        label: resolvedId,
                        clipRatio: 0.7,
                        clickable: true,
                        isOperator: true,
                        isExtension: true,
                        data: {
                            type: 'relationship',
                            target: resolvedId,
                            is_extension: true,
                            source: srcId
                        }
                    });
                    // 虚线连接（区别于一级的实线）
                    if (srcNode) {
                        layoutResult.elements.push({
                            type: 'line',
                            fromX: srcNode.x, fromY: srcNode.y,
                            toX: extX, toY: extY,
                            color: 'rgba(255,255,255,0.3)',
                            lineWidth: 1,
                            dash: [3, 5]
                        });
                    }
                }
            } catch (e) { /* ignore */ }
        }

        // 7. 推入导航栈
        window.pushGraphView('doctor', {});
        window.__currentView = 'doctor';
        window.__graphRenderer = renderer;
        renderer.setElements(layoutResult.elements);
    } catch (e) {
        console.error('[generateDoctorCenterLayout]', e);
        window.__infoTitle.textContent = '干员档案';
        window.__infoContent.textContent = '加载失败: ' + e.message;
        window.__infoLayer.classList.add('visible');
    }
}

function mergeRelationshipRecords(relationships) {
    const merged = new Map();
    for (const record of Array.isArray(relationships) ? relationships : []) {
        if (!record || !record.target) continue;
        const key = String(record.target_operator_id || record.target_character_id || record.target)
            .trim().toLowerCase();
        if (!key) continue;
        const relationType = String(record.type || record.relation_type || '').trim();
        const description = String(record.description || '').trim();
        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, {
                ...record,
                relationship_records: [record],
                relationship_types: relationType ? [relationType] : [],
                relationship_descriptions: description ? [description] : [],
            });
            continue;
        }
        existing.relationship_records.push(record);
        if (relationType && !existing.relationship_types.includes(relationType)) {
            existing.relationship_types.push(relationType);
        }
        if (description && !existing.relationship_descriptions.includes(description)) {
            existing.relationship_descriptions.push(description);
        }
    }
    return [...merged.values()].map(record => ({
        ...record,
        type: record.relationship_types.join(' / ') || record.type || '',
        description: record.relationship_descriptions.join('\n') || record.description || '',
    }));
}

async function generateLayout(operatorData, relationships, width, height, maxNotes = 12) {
    width = Math.max(320, Number(width) || 800);
    height = Math.max(360, Number(height) || 600);
    relationships = mergeRelationshipRecords(relationships);
    const seed = hashString(operatorData.id);
    const rand = seededRandom(seed);
    const elements = [];
    const clickable = [];
    const centerX = width / 2;
    const centerY = height / 2;

    // 工具：碰撞检测
    function isOverlapping(x, y, radius, existing, margin = 10) {
        for (const e of existing) {
            const dx = e.x - x;
            const dy = e.y - y;
            const minDist = (e.size || 20) + radius + margin;
            if (dx*dx + dy*dy < minDist * minDist) return true;
        }
        return false;
    }

    // 1. 生成环绕位置池
    const ringPositions = [];
    const drawableRadiusX = Math.max(90, width / 2 - 54);
    const drawableRadiusY = Math.max(100, height / 2 - 54);
    const ringRadiusMin = Math.min(120, drawableRadiusX * 0.38, drawableRadiusY * 0.38);
    const ringRadiusMax = Math.max(ringRadiusMin + 20, Math.min(drawableRadiusX, drawableRadiusY) * 0.86);
    for (let i = 0; i < 500; i++) {
        const angle = rand() * 2 * Math.PI;
        const radius = ringRadiusMin + rand() * (ringRadiusMax - ringRadiusMin);
        const x = centerX + Math.cos(angle) * Math.min(drawableRadiusX, radius * 1.15);
        const y = centerY + Math.sin(angle) * Math.min(drawableRadiusY, radius * 0.82);
        if (x < 40 || x > width - 40 || y < 40 || y > height - 40) continue;
        if (Math.hypot(x - centerX, y - centerY) < 80) continue;
        if (isOverlapping(x, y, 25, ringPositions, 15)) continue;
        ringPositions.push({ x, y, size: 25 });
    }

    // 2. 关系节点位置池（围绕中心的确定性散布）
    const relCount = relationships.length;
    function buildRelationshipPositions(count) {
        const result = [];
        const centerGap = Math.max(76, Math.min(132, width * 0.16));
        const maxHorizontalDistance = Math.max(centerGap, width / 2 - 48);
        const verticalRange = Math.max(70, height / 2 - 52);
        for (let index = 0; index < count; index++) {
            const side = index % 2 === 0 ? -1 : 1;
            let position = null;
            for (let attempt = 0; attempt < 48; attempt++) {
                const distance = centerGap + rand() * Math.max(0, maxHorizontalDistance - centerGap);
                const x = centerX + side * distance;
                const y = centerY + (rand() * 2 - 1) * verticalRange;
                if (isOverlapping(x, y, 30, result, 18)) continue;
                position = { x, y, size: 30 };
                break;
            }
            if (!position) {
                const sideIndex = Math.floor(index / 2);
                const fallbackY = 52 + ((sideIndex * 83 + rand() * 37) % Math.max(84, height - 104));
                const fallbackDistance = centerGap
                    + ((sideIndex * 61 + rand() * 43) % Math.max(1, maxHorizontalDistance - centerGap + 1));
                position = {
                    x: centerX + side * fallbackDistance,
                    y: fallbackY,
                    size: 30
                };
            }
            result.push({
                x: Math.max(40, Math.min(width - 40, position.x)),
                y: Math.max(48, Math.min(height - 48, position.y)),
                size: 30
            });
        }
        return result;
    }
    const relationshipPositions = buildRelationshipPositions(relCount);

    // 3. 分配元素
    let ringIdx = 0;
    function getNextRingPosition() {
        if (ringIdx >= ringPositions.length) {
            const angle = rand() * 2 * Math.PI;
            const radius = ringRadiusMin + rand() * (ringRadiusMax - ringRadiusMin);
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;
            return { x, y };
        }
        return ringPositions[ringIdx++];
    }

    // --- 中心头像 ---
    const avatarUrl = getOperatorAvatarUrl(operatorData.id);
    const centerEl = {
        id: 'center',
        type: 'avatar',
        x: centerX,
        y: centerY,
        size: 64,
        image: avatarUrl,
        label: operatorData.id,
        clipRatio: 0.7 + (hashString(operatorData.id + 'center') % 30) / 100,
        clickable: true,
        data: { type: 'center', operatorId: operatorData.id },
        pinColor: '#7c2119'  // 固定红色
    };
    elements.push(centerEl);
    clickable.push(centerEl);

    // --- 势力 Logo ---
    if (operatorData.origin) {
        const logoFile = getLogoImage(operatorData.origin);
        if (logoFile) {
            const pos = getNextRingPosition();
            const scale = 0.8 + rand() * 0.8;
            const logoEl = {
                id: 'logo',
                type: 'logo',
                x: pos.x,
                y: pos.y,
                size: 360 * scale,
                image: `/static/images/${logoFile}`,
                clickable: false
            };
            elements.push(logoEl);
        }
    }

    // --- 地图元素（预留） ---
    const mapPos = getNextRingPosition();
    const mapEl = {
        id: 'map',
        type: 'map',
        x: mapPos.x,
        y: mapPos.y,
        size: 50,
        color: 'rgba(100,150,200,0.2)',
        label: '地图',
        clickable: true,
        data: { type: 'map', content: '地图占位' }
    };
    elements.push(mapEl);
    clickable.push(mapEl);

    // --- 随机图像元素（1~3个） ---
    const imagePool = [
        'img_confidential.png',
        'spot.png',
        'img_AN_working_bk.png',
        'img_deco_top.png',
        'image_stage.png',
        'star_04.png',
        'star_25.png',
        'img_note_1.png',
        'img_note_2.png',
        'img_note_3.png',
        'img_note_4.png',
        'img_note_5.png',
        'img_note_6.png',
        'img_record_note_1.png',
        'img_record_note_2.png',
        'img_record_note_3.png',
        'img_record_note_4.png'
    ];
    const imgCount = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < imgCount; i++) {
        const pos = getNextRingPosition();
        const imgFile = imagePool[Math.floor(rand() * imagePool.length)];
        const imgPath = `/static/images/${imgFile}`;
        const baseSize = 80 + rand() * 80;
        const opacity = 0.3 + rand() * 0.4;
        const rotation = (rand() - 0.5) * 0.04;
        const imgEl = {
            id: `randimg_${i}`,
            type: 'random_image',
            x: pos.x,
            y: pos.y,
            baseSize: baseSize,
            image: imgPath,
            opacity: opacity,
            rotation: rotation,
            clickable: false
        };
        elements.push(imgEl);
    }

    // --- 便签（静态知识） ---
    const categories = ['experiences', 'emotion_patterns', 'interaction_patterns', 'plot_hooks'];
    const categoryData = {};
    for (const cat of categories) {
        if (operatorData[cat]) {
            categoryData[cat] = operatorData[cat];
        }
    }
    let textItems = [];
    for (const [cat, items] of Object.entries(categoryData)) {
        if (Array.isArray(items)) {
            // 遍历所有条目（不再限制数量）
            for (const item of items) {
                let content = '';
                if (typeof item === 'string') {
                    content = item;
                } else if (typeof item === 'object' && item !== null) {
                    // 根据 category 组合不同字段（排除 evidence）
                    switch (cat) {
                        case 'emotion_patterns':
                            if (item.trigger || item.reaction) {
                                content = (item.trigger || '') + ' ' + (item.reaction || '');
                            }
                            break;
                        case 'plot_hooks':
                            if (item.hook_desc || item.taboo_desc) {
                                content = (item.hook_desc || '') + ' ' + (item.taboo_desc || '');
                            }
                            break;
                        case 'experiences':
                            if (item.event || item.summary) {
                                content = (item.event || '') + ' ' + (item.summary || '');
                            }
                            break;
                        case 'interaction_patterns':
                            if (item.pattern_desc || item.target) {
                                content = (item.target ? '与' + item.target : '') + ' ' + (item.pattern_desc || '');
                            }
                            break;
                        default:
                            content = item.event || item.trigger || item.pattern_desc ||
                                      item.hook_desc || item.description || item.reaction ||
                                      item.trauma_desc || item.summary || '';
                    }
                    if (!content || content.trim() === '') {
                        content = JSON.stringify(item);
                    }
                }
                if (content && content.length > 0) {
                    const maxLen = 160;
                    const truncated = content.length > maxLen ? content.substring(0, maxLen) + '…' : content;
                    textItems.push({
                        content: truncated,
                        category: cat,
                        full: item,
                        id: item.id || null   // 保留数据库 ID
                    });
                }
            }
        }
    }

    // 限制便签数量（随机采样）
    let selectedItems = [];
    if (textItems.length > maxNotes) {
        // 使用哈希种子保证一致性
        const seed = hashString(operatorData.id + 'notes');
        const rand = seededRandom(seed);
        // 打乱后取前 maxNotes 个
        const shuffled = [...textItems];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        selectedItems = shuffled.slice(0, maxNotes);
    } else {
        selectedItems = textItems;
    }

    for (const item of selectedItems) {
        const pos = getNextRingPosition();
        const rotation = (rand() - 0.5) * 0.035;
        const noteColor = ['#fff8e7', '#f0f4ff', '#fef0e6'][Math.floor(rand() * 3)];
        const textEl = {
            id: `note_${Math.abs(hashString(`${operatorData.id}:${item.category}:${item.id || item.content}`))}`,
            type: 'note',
            x: pos.x,
            y: pos.y,
            data: item.content,
            label: item.content,
            color: noteColor,
            textColor: '#333',
            size: 12 + rand() * 4,
            rotation: rotation,
            clickable: true,
            category: item.category,
            fullData: { ...item.full, id: item.id }
        };
        elements.push(textEl);
        clickable.push(textEl);
    }

    // --- 关系节点 ---
    // 辅助函数：解析带括号的别名（优先括号外，再括号内）
    async function resolveAliasWithBrackets(aliasStr) {
        if (!aliasStr) return null;
        // 检查是否包含括号（中文或英文）
        const bracketMatch = aliasStr.match(/^([^(（]*)[(（]([^)）]*)[)）]/);
        if (bracketMatch) {
            const outside = bracketMatch[1].trim();
            const inside = bracketMatch[2].trim();
            // 优先尝试括号外
            let id = await resolveAlias(outside);
            if (id) return id;
            // 再尝试括号内
            id = await resolveAlias(inside);
            if (id) return id;
        }
        // 无括号或括号解析失败，直接尝试原字符串
        return await resolveAlias(aliasStr);
    }

    // 先解析所有目标别名
    const aliasSet = new Set();
    relationships.forEach(r => {
        if (r.target) aliasSet.add(r.target);
    });
    const aliasMap = {};
    await Promise.all([...aliasSet].map(async (alias) => {
        const id = await resolveAliasWithBrackets(alias);
        if (id) aliasMap[alias] = id;
    }));
    let unresolvedRelationships = 0;

    const leftNodes = [];
    const rightNodes = [];
    let relationshipIndex = 0;
    for (const rel of relationships) {
        const targetAlias = rel.target || 'unknown';
        const targetId = aliasMap[targetAlias] || targetAlias;
        const isOperator = !!aliasMap[targetAlias] || targetId === 'doctor';
        if (!isOperator) unresolvedRelationships += 1;
        const targetName = rel.target_name || targetAlias;
        const avatarUrl2 = isOperator ? getOperatorAvatarUrl(targetId) : '/static/avatars/default.webp';
        // 生成固定 clipRatio
        const relSeed = operatorData.id + targetAlias + rel.type;
        const clipRatio = 0.7 + (hashString(relSeed) % 30) / 100;
        const colorList = ['#7c2119', '#5d4037', '#212121'];  // 红、棕、黑
        const pinColor = colorList[Math.abs(hashString(relSeed)) % colorList.length];

        const node = {
            id: `rel_${Math.abs(hashString(`${operatorData.id}:${targetId}`))}`,
            type: 'relationship',
            x: 0,
            y: 0,
            size: 32,
            image: avatarUrl2,
            label: isOperator ? targetId : targetName,
            clipRatio: clipRatio,
            clickable: true,
            isOperator: isOperator,
            data: {
                type: 'relationship',
                target: targetId,
                targetAlias: targetAlias,
                description: rel.description,
                type_label: rel.type,
                relationship_types: rel.relationship_types || [],
                relationship_records: rel.relationship_records || [rel]
            },
            relData: rel,
            pinColor: pinColor   // 新增随机颜色
        };
        const pos = relationshipPositions[relationshipIndex++] || getNextRingPosition();
        node.x = pos.x;
        node.y = pos.y;
        if (node.x < centerX) leftNodes.push(node);
        else rightNodes.push(node);
        elements.push(node);
        clickable.push(node);
    }

    // --- 连线（树形结构）---
    const allRelNodes = [...leftNodes, ...rightNodes];
    function buildTreeConnections(nodes, side) {
        const connections = [];
        if (nodes.length === 0) return connections;

        const centerTopX = centerX;
        const centerTopY = centerY - 64;

        // 1. 节点数 <= 5，全部直连
        if (nodes.length <= 5) {
            for (const node of nodes) {
                let line_color;
                if (node.data.target === 'doctor') {
                    line_color = '#ba7f0e';
                } else if (node.data.target === 'priestess') {
                    line_color = '#060427';
                } else if (node.isOperator) {
                    line_color = '#7c2119';
                } else {
                    line_color = '#326194';
                }
                connections.push({
                    fromX: centerTopX,
                    fromY: centerTopY,
                    toX: node.x,
                    toY: node.y - node.size + 4,
                    color: line_color
                });
            }
            return connections;
        }

        // 2. 分支点数量
        const branchCount = Math.min(3, Math.max(1, Math.floor(nodes.length / 5)));

        // 3. 生成分支点（只向对应侧，矩形区域随机）
        const branchPoints = [];
        const xRange = 160 + rand() * 320;
        const yRange = 240;

        for (let i = 0; i < branchCount * 5; i++) {
            const offsetX = side === 'left' ? -(xRange * 0.6 + rand() * xRange * 0.4) : (xRange * 0.6 + rand() * xRange * 0.4);
            const offsetY = (rand() - 0.5) * yRange * 2;
            const bx = centerX + offsetX;
            const by = Math.max(80, Math.min(height - 80, centerY + offsetY));

            let tooClose = false;
            for (const bp of branchPoints) {
                if (Math.hypot(bx - bp.x, by - bp.y) < 60) {
                    tooClose = true;
                    break;
                }
            }
            if (!tooClose) {
                branchPoints.push({ x: bx, y: by });
                if (branchPoints.length === branchCount) break;
            }
        }

        while (branchPoints.length < branchCount) {
            const offsetX = side === 'left' ? -(120 + rand() * 150) : (120 + rand() * 150);
            const offsetY = (rand() - 0.5) * 300;
            const bx = centerX + offsetX;
            const by = Math.max(80, Math.min(height - 80, centerY + offsetY));
            branchPoints.push({ x: bx, y: by });
        }

        // 4. 分配叶节点
        const assignments = [];
        const remainingNodes = [...nodes];

        // 4a. 强制分配：每个分支点选一个垂直高度差最小的节点
        for (const bp of branchPoints) {
            let bestNode = null;
            let minHeightDiff = Infinity;
            for (const node of remainingNodes) {
                const heightDiff = Math.abs(node.y - bp.y);
                if (heightDiff < minHeightDiff) {
                    minHeightDiff = heightDiff;
                    bestNode = node;
                }
            }
            if (bestNode) {
                const idx = remainingNodes.indexOf(bestNode);
                if (idx !== -1) remainingNodes.splice(idx, 1);
                assignments.push({ node: bestNode, bp: bp, direct: false });
            }
        }

        // 4b. 其余节点根据距离判断，加入随机混合机制
        const directThreshold = 0.3 + rand() * 0.2;
        for (const node of remainingNodes) {
            let bestBp = null;
            let bestDist = Infinity;
            for (const bp of branchPoints) {
                const d = Math.hypot(node.x - bp.x, node.y - bp.y);
                if (d < bestDist) {
                    bestDist = d;
                    bestBp = bp;
                }
            }
            const toCenterDist = Math.hypot(node.x - centerTopX, node.y - centerTopY);
            if (rand() < directThreshold || !bestBp || bestDist > toCenterDist) {
                assignments.push({ node: node, bp: null, direct: true });
            } else {
                assignments.push({ node: node, bp: bestBp, direct: false });
            }
        }

        // 5. 统计每个分支点分配到的节点数，剔除未使用的分支点
        const bpCounts = new Map();
        for (const bp of branchPoints) bpCounts.set(bp, 0);
        for (const a of assignments) {
            if (!a.direct && a.bp) {
                bpCounts.set(a.bp, (bpCounts.get(a.bp) || 0) + 1);
            }
        }

        const usedBps = new Set();
        for (const a of assignments) {
            if (!a.direct && a.bp && bpCounts.get(a.bp) > 0) {
                usedBps.add(a.bp);
            }
        }

        // 为 usedBps 添加分支点元素（图钉）
        for (const bp of usedBps) {
            const branchEl = {
                id: `branch_${Math.abs(hashString(`${operatorData.id}:${side}:branch:${bp.x}:${bp.y}`))}`,
                type: 'branch',
                x: bp.x,
                y: bp.y,
                size: 32,               // 与关系节点大小一致
                clickable: false,
                pinColor: '#795548'     // 固定棕色
            };
            elements.push(branchEl);
        }

        // ---- 分支点标签（固定渲染，图钉位于纸条上方中部） ----
        // 交替标签类型计数器
        let tagCounter = 0;
        for (const bp of usedBps) {
            // 基于 bp 位置生成确定性随机（用于内容数字）
            const tagSeed = hashString(`branch_tag_${bp.x}_${bp.y}`);
            const randTag = seededRandom(tagSeed);

            // 交替决定标签类型：第一个 #数字，第二个 ID:数字，第三个 #数字...
            const tagType = tagCounter % 2;  // 0: #数字, 1: ID:数字
            tagCounter++;

            // 位置：分支点正下方偏移，使图钉位于纸条上方中部
            const offsetX = (randTag() - 0.5) * 40;      // 左右偏移 ±20px
            const offsetY = 12 + randTag() * 12;         // 下移 12~24px
            const posX = bp.x + offsetX;
            const posY = bp.y + offsetY;

            let content, style;
            if (tagType === 0) {
                // 方形纸条：# + 0~4 数字
                const num = Math.floor(randTag() * 5);
                content = `#${num}`;
                style = {
                    bg: '#dabb64',
                    textColor: '#333',
                    fontSize: 14,
                    padding: 10 + Math.floor(randTag() * 4),
                    borderRadius: 0,
                    rotation: (randTag() - 0.5) * 0.24,
                };
            } else {
                // 长条矩形纸条：ID: + 六位随机整数
                const idNum = Math.floor(randTag() * 900000 + 100000);
                content = `ID:${idNum}`;
                style = {
                    bg: '#dabb64',
                    textColor: '#1a3c6e',
                    fontSize: 12,
                    padding: 10 + Math.floor(randTag() * 4),
                    borderRadius: 0,
                    rotation: (randTag() - 0.5) * 0.24,
                };
            }

            const tagEl = {
                id: `branch_tag_${Math.abs(hashString(`${operatorData.id}:${side}:tag:${bp.x}:${bp.y}`))}`,
                type: 'branch_tag',
                x: posX,
                y: posY,
                content: content,
                style: style,
                clickable: false,
            };
            elements.push(tagEl);
        }

        // 6. 生成连线
        // 中心到分支点
        for (const bp of usedBps) {
            connections.push({
                fromX: centerTopX,
                fromY: centerTopY,
                toX: bp.x,
                toY: bp.y,
                color: '#7c2119',
                lineWidth: 1.5
            });
        }

        // 叶节点连线
        for (const a of assignments) {
            let fromX, fromY;
            if (a.direct || !a.bp || !usedBps.has(a.bp)) {
                fromX = centerTopX;
                fromY = centerTopY;
            } else {
                fromX = a.bp.x;
                fromY = a.bp.y;
            }
            let line_color;
            if (a.node.data.target === 'doctor') {
                line_color = '#ba7f0e';
            } else if (a.node.data.target === 'priestess') {
                line_color = '#060427';
            } else if (a.node.isOperator) {
                line_color = '#7c2119';
            } else {
                line_color = '#326194';
            }
            console.log('节点:', a.node.data.target, 'isOperator:', a.node.isOperator);
            connections.push({
                fromX: fromX,
                fromY: fromY,
                toX: a.node.x,
                toY: a.node.y - a.node.size + 4,
                color: line_color
            });
        }

        return connections;
    }

    const leftConnections = buildTreeConnections(leftNodes, 'left');
    const rightConnections = buildTreeConnections(rightNodes, 'right');
    for (const conn of [...leftConnections, ...rightConnections]) {
        const lineEl = {
            id: `line_${Math.abs(hashString(`${operatorData.id}:line:${conn.fromX}:${conn.fromY}:${conn.toX}:${conn.toY}`))}`,
            type: 'line',
            fromX: conn.fromX,
            fromY: conn.fromY,
            toX: conn.toX,
            toY: conn.toY,
            color: conn.color || 'rgba(74,125,181,0.4)',
            lineWidth: conn.lineWidth || 2,
            clickable: false
        };
        elements.push(lineEl);
    }



    return { elements, clickable, unresolvedRelationships, relationshipCount: relationships.length };
}

// ================================================================
//  5. 主程序
// ================================================================

function waitForGraphViewport(container, timeoutMs = 2400) {
    const read = () => container.getBoundingClientRect();
    const initial = read();
    if (initial.width >= 160 && initial.height >= 160) return Promise.resolve(initial);
    return new Promise(resolve => {
        let settled = false;
        let observer = null;
        const finish = rect => {
            if (settled) return;
            settled = true;
            observer?.disconnect();
            resolve(rect);
        };
        observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
            const rect = read();
            if (rect.width >= 160 && rect.height >= 160) finish(rect);
        }) : null;
        observer?.observe(container);
        const started = performance.now();
        const poll = () => {
            if (settled) return;
            const rect = read();
            if (rect.width >= 160 && rect.height >= 160 || performance.now() - started >= timeoutMs) {
                finish(rect);
                return;
            }
            requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    const params = getUrlParams();
    const container = document.getElementById('graph-container');
    const canvas = document.getElementById('bg-canvas');
    const loading = document.getElementById('loading');
    const infoLayer = document.getElementById('info-layer');
    const infoTitle = document.getElementById('info-title');
    const infoContent = document.getElementById('info-content');
    const infoClose = document.getElementById('info-close');

    // 暴露信息面板到全局，供布局函数使用
    window.__infoLayer = infoLayer;
    window.__infoTitle = infoTitle;
    window.__infoContent = infoContent;
    const infoEdit = document.getElementById('info-edit');
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    const zoomLevel = document.getElementById('zoom-level');

    // 仅当 embedded=1 时才隐藏控件
    if (params.embedded) {
        document.body.classList.add('embedded');
    } else {
        document.body.classList.remove('embedded');
    }
    if (params.thumbnail) {
        document.body.classList.add('thumbnail');
    } else {
        document.body.classList.remove('thumbnail');
    }

    // 返回按钮 — 图谱内优先使用 graphGoBack，根页面时离开图谱
    var backBtn = document.getElementById('back-btn');
    if (backBtn) {
        if (!params.embedded) {
            backBtn.style.display = 'flex';
        }
        function handleGraphBack(e) {
            if (e) e.preventDefault();
            window.graphGoBack();
        }
        backBtn.addEventListener('click', handleGraphBack);
        backBtn.addEventListener('touchstart', function(e) {
            e.preventDefault();
            handleGraphBack(e);
        }, { passive: false });
        backBtn.addEventListener('contextmenu', function(e) { e.preventDefault(); });
    }

    // 缩放控件
    const zoomIn = document.getElementById('zoom-in');
    const zoomOut = document.getElementById('zoom-out');
    const zoomReset = document.getElementById('zoom-reset');

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === '=') {
            e.preventDefault();
            if (renderer) renderer.zoomIn();
        } else if (e.ctrlKey && e.key === '-') {
            e.preventDefault();
            if (renderer) renderer.zoomOut();
        } else if (e.ctrlKey && e.key === '0') {
            e.preventDefault();
            if (renderer) renderer.resetView();
        }
    });

    if (!params.id && params.mode !== 'global_root' && params.mode !== 'global_static') {
        loading.innerHTML = '<div style="color:#ff6b6b;">错误: 未指定干员 ID</div>';
        return;
    }

    let renderer = null;

    // 暴露配置到全局以便调试
    window.__entranceConfig = GraphRenderer.entranceConfig;
    console.log('[入场动画] 配置已加载，可在控制台修改 window.__entranceConfig 并刷新页面测试');
    // 启动入场动画（延迟100ms确保画面已绘制）
    setTimeout(() => {
        if (renderer) {
            renderer.startEntranceAnimation();
        }
    }, 100);

    try {
        const id = params.id ? params.id.trim() : '';
        console.log('[graph-viewer] 加载模式:', params.mode, 'id:', id || '(none)');

        let operatorData, relationships, layoutResult;
        let relationshipDiagnostics = null;
        const rect = await waitForGraphViewport(container);

        if (params.mode === 'global_root') {
            loading.style.display = 'none';
            renderer = new GraphRenderer(canvas);
            renderer.isThumbnail = params.thumbnail;
            renderer.isEmbedded = params.embedded;
            renderer.infoTitle = window.__infoTitle;
            renderer.infoContent = window.__infoContent;
            renderer.infoLayer = window.__infoLayer;
            renderer.resize();
            layoutResult = await generateGlobalRootLayout(rect.width || 800, rect.height || 600, renderer);
            // 初始化导航栈
            window.graphNavStack = [{ type: 'root', data: {} }];
            window.__currentView = 'root';
            window.__graphRenderer = renderer;
            window.__layoutResult = layoutResult;
        } else if (params.mode === 'global_static') {
            // 全局静态模式: 博士中心 + 随机干员图谱
            loading.style.display = 'none';
            renderer = new GraphRenderer(canvas);
            renderer.isThumbnail = params.thumbnail;
            renderer.isEmbedded = params.embedded;
            renderer.resize();
            await generateDoctorCenterLayout(rect.width || 800, rect.height || 600, renderer);
            // 跳过 generateLayout，直接设置 layoutResult 为空元素集
            layoutResult = { elements: renderer.elements || [] };
        } else {
            operatorData = await fetchOperatorData(id);
            let relationshipData = { relationships: [], diagnostics: null };
            try {
                relationshipData = await fetchRelationships(id);
            } catch (error) {
                relationshipData.diagnostics = { merged_endpoint_error: error.message };
                console.warn('[关系图谱] 合并关系接口不可用，改用档案知识回退', error);
            }
            relationships = chooseRelationshipRecords(
                relationshipData.relationships,
                operatorData.relationships
            );
            relationshipDiagnostics = {
                ...(relationshipData.diagnostics || {}),
                fallback_used: !(relationshipData.relationships || []).length && relationships.length > 0,
                fallback_count: relationships.length
            };
            if (!operatorData || !operatorData.id) {
                throw new Error('获取干员 "' + id + '" 的数据失败');
            }
            loading.style.display = 'none';
            renderer = new GraphRenderer(canvas);
            renderer.isThumbnail = params.thumbnail;
            renderer.isEmbedded = params.embedded;
            renderer.resize();
            layoutResult = await generateLayout(operatorData, relationships, rect.width || 800, rect.height || 600);
            window.__currentView = 'static';
            window.__graphRenderer = renderer;
            if (!params.thumbnail) {
                const manageButton = document.createElement('button');
                manageButton.className = 'relationship-manage-fab';
                manageButton.textContent = '管理关系';
                manageButton.onclick = () => openRelationshipManager(id, relationships);
                document.body.appendChild(manageButton);
            }
        }


        // 检测移动端（根据屏幕宽度或 User-Agent）
        const isMobile = window.innerWidth < 768 || /Mobi|Android|iPhone/i.test(navigator.userAgent);
        const maxNotes = isMobile ? 8 : 20;  // 移动端更少

        
        // 2. 在 global_static 模式下添加世界设定分类节点
        if (params.mode === 'global_static') {
            try {
                var wsData = await fetchWorldsetData();
                if (wsData && wsData.length > 0) {
                    var byCategory = {};
                    for (var wi = 0; wi < wsData.length; wi++) {
                        var wentry = wsData[wi];
                        var wcat = wentry.category || 'unknown';
                        if (!byCategory[wcat]) byCategory[wcat] = [];
                        byCategory[wcat].push(wentry);
                    }
                    var catKeys = Object.keys(byCategory);
                    var wsCX = rect.width / 2;
                    var wsCY = rect.height / 2;
                    var wsR = Math.min(rect.width, rect.height) * 0.42;
                    for (var ci = 0; ci < catKeys.length; ci++) {
                        var cat = catKeys[ci];
                        var angle = (ci / catKeys.length) * 2 * Math.PI - Math.PI / 2;
                        var nx = wsCX + Math.cos(angle) * wsR;
                        var ny = wsCY + Math.sin(angle) * wsR;
                        var catName = getWorldsetCategoryName(cat);
                        var color = WORLDSET_CATEGORY_COLORS[(cat || '').replace('worldset/', '')] || '#888';
                        var cnt = byCategory[cat].length;
                        layoutResult.elements.push({
                            id: 'worldset_' + cat,
                            type: 'worldset_cluster',
                            x: nx, y: ny,
                            size: 38 + Math.min(cnt, 30),
                            color: color,
                            label: catName,
                            sublabel: cnt + '条',
                            clickable: true,
                            data: {
                                type: 'worldset',
                                category: cat,
                                categoryName: catName,
                                count: cnt,
                                entries: byCategory[cat].slice(0, 5).map(function(e) {
                                    return { id: e.id, content: (e.content || '').replace(/^# .*?\n/, '').trim().slice(0, 60) };
                                })
                            }
                        });
                    }
                    console.log('[worldset] 已添加', catKeys.length, '个世界设定分类节点');
                }
            } catch (e) {
                console.warn('[worldset] 添加节点失败', e);
            }
        }

        // 3. 设置元素
        await renderer.setElements(layoutResult.elements);
        renderer.updateZoomLevel();
        document.querySelector('.graph-data-status')?.remove();
        const malformedRelationships = Number(relationshipDiagnostics?.malformed_relationships || 0);
        if (params.mode === 'static' && (!layoutResult.relationshipCount || layoutResult.unresolvedRelationships || malformedRelationships)) {
            const status = document.createElement('div');
            status.className = 'graph-data-status';
            status.textContent = !layoutResult.relationshipCount
                ? (malformedRelationships ? '关系数据存在，但暂时无法解析' : '当前干员暂无关系数据')
                : [
                    layoutResult.unresolvedRelationships
                        ? `${layoutResult.unresolvedRelationships} 个外部关系使用通用节点显示`
                        : '',
                    malformedRelationships
                        ? `${malformedRelationships} 条关系数据无法解析`
                        : ''
                ].filter(Boolean).join(' · ');
            container.appendChild(status);
        }

        // 查找中心头像元素，将视图中心对准中心头像的世界坐标
        const centerElement = layoutResult.elements.find(el => el.id === 'center');
        if (centerElement) {
            renderer.offsetX = centerElement.x;
            renderer.offsetY = centerElement.y;
        } else {
            // 降级：使用默认偏移
            renderer.offsetX = 0;
            renderer.offsetY = 0;
        }

        // 3. 入场动画：从 0.5 缩放至 1.0（500ms）
        renderer.scale = 0.5;
        renderer.render();
        const startTime = performance.now();
        const duration = 500;
        const startScale = 0.5;
        const endScale = 1.0;
        function animateScale(timestamp) {
            const progress = Math.min((timestamp - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const currentScale = startScale + (endScale - startScale) * eased;
            renderer.scale = currentScale;
            renderer.render();
            renderer.updateZoomLevel();
            if (progress < 1) {
                requestAnimationFrame(animateScale);
            }
        }
        requestAnimationFrame(animateScale);

        // 单击显示详情
        renderer.onElementClick = (el) => {
            let title = '详情';
            let content = '';
            let entryId = null;
            let category = '';
            let operatorId = '';

            if (el.data?.type === 'center') {
                title = operatorData.codename || operatorData.id;
                content = `ID: ${operatorData.id}\n出身: ${operatorData.origin || '未知'}\n种族: ${operatorData.race || '未知'}`;
                // 中心不可编辑
                entryId = null;
            } else if (el.data?.type === 'relationship') {
                const rel = el.relData || {};
                title = `与 ${rel.target_name || rel.target} 的关系`;
                content = `类型: ${rel.type || '未知'}\n描述: ${rel.description || '无'}`;
                // 关系编辑暂不支持（可后续扩展）
                entryId = null;
            } else if (el.category) {
                const catMap = {
                    'experiences': '经历',
                    'emotion_patterns': '情绪模式',
                    'interaction_patterns': '交互模式',
                    'plot_hooks': '情节钩'
                };
                title = catMap[el.category] || el.category;
                content = el.data || '无内容';
                // 对于便签，尝试从 fullData 获取 id
                if (el.fullData && el.fullData.id) {
                    entryId = el.fullData.id;
                    category = el.category;
                    operatorId = operatorData.id;
                } else {
                    entryId = null;
                }
            } else if (el.type === 'map') {
                title = '地图元素';
                content = '势力地图占位，待完善';
                entryId = null;
            } else if (el.type === 'worldset_cluster') {
                var wsD = el.data || {};
                title = '[世界设定] ' + (wsD.categoryName || wsD.category || '');
                var pw = (wsD.entries || []).map(function(e) { return e.content; });
                content = pw.join('\n\n') || ('共 ' + (wsD.count || 0) + ' 条条目');
                entryId = null;
            } else if (el.type === 'global_root_node') {
                title = '罗德岛档案库';
                content = '双击分类节点以浏览\n- 干员档案：查看所有干员\n- 世界设定：浏览世界设定分类';
                entryId = null;
            } else if (el.type === 'global_cat_node' && el.data && el.data.type === 'category') {
                title = el.label || '分类';
                var catType = el.data.catType;
                if (catType === 'operators') {
                    content = '双击以博士为中心查看随机干员关系图谱';
                } else {
                    content = '双击查看该分类下的所有条目\n条目数: ' + (el.sublabel || '?');
                }
                entryId = null;
            } else if (el.type === 'global_cat_node' && el.data && el.data.type === 'worldset_sub') {
                title = '[世界设定] ' + (el.data.label || '');
                content = '双击查看条目内容';
                entryId = null;
            } else if (el.type === 'avatar' && el.data && (
                el.data.type === 'doctor_center' ||
                (el.data.type === 'center' && el.data.operatorId === 'doctor')
            )) {
                title = '博士';
                content = '罗德岛的核心战术指挥官\n双击重新生成图谱';
                entryId = null;
            } else if (el.type === 'avatar' && el.data && (
                el.data.type === 'operator_node' ||
                (el.data.type === 'center' && el.data.operatorId && el.data.operatorId !== 'doctor')
            )) {
                title = el.label || '';
                content = '双击查看该干员的完整关系图谱';
                entryId = null;
            } else if (el.type === 'worldset_node' && el.data && el.data.type === 'worldset_entry') {
                title = el.label || '条目';
                var wsContent = (el.data.content || '').replace(/^# .*?\n/, '').trim().slice(0, 300);
                content = wsContent || '无内容';
                entryId = null;
            } else {
                content = el.data || el.label || '无信息';
                entryId = null;
            }

            // 存储当前元素信息以便编辑
            window.__currentElement = el;
            window.__currentEntryId = entryId;
            window.__currentCategory = category;
            window.__currentOperatorId = operatorId;
            window.__currentContent = content;

            infoTitle.textContent = title;
            infoContent.textContent = content;
            infoLayer.classList.add('visible');
        };

        // 双击跳转（关系节点 & 全局根模式分类节点）
        renderer.onElementDblClick = (el) => {
            // 全局根模式：分类节点双击
            if (el.type === 'global_cat_node' && el.data && el.data.type === 'category') {
                var catType = el.data.catType;
                var worldsetKey = el.worldsetKey || (el.data && el.data.worldsetKey) || '';
                if (catType === 'operators') {
                    // 干员档案: 生成博士中心 + 随机干员图谱
                    generateDoctorCenterLayout(renderer.width || 800, renderer.height || 600, renderer);
                } else if (catType === 'worldset' && worldsetKey) {
                    // 世界设定分类: 显示该分类条目
                    var catLabel = el.label || WORLDSET_CATEGORY_NAMES[worldsetKey] || worldsetKey;
                    showWorldsetCategory(renderer, worldsetKey, catLabel, renderer.width || 800, renderer.height || 600);
                }
                return;
            }
            // 世界设定子分类双击：显示该分类内容
            if (el.type === 'global_cat_node' && el.data && el.data.type === 'worldset_sub') {
                var wsKey = el.data.key;
                var wsLabel = el.data.label;
                infoTitle.textContent = '[世界设定] ' + wsLabel;
                fetch('/static_knowledge/worldset?category=worldset/' + wsKey)
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        var entries = data.entries || [];
                        if (entries.length === 0) {
                            infoContent.textContent = '暂无条目';
                        } else {
                            var texts = [];
                            for (var ei = 0; ei < entries.length; ei++) {
                                var txt = (entries[ei].content || '').replace(/^# .*?\n/, '').trim().slice(0, 120);
                                texts.push(txt);
                            }
                            infoContent.textContent = texts.join('\n\n---\n\n');
                        }
                        infoLayer.classList.add('visible');
                    })
                    .catch(function() {
                        infoContent.textContent = '加载失败';
                        infoLayer.classList.add('visible');
                    });
                return;
            }
            // 博士中心节点双击: 重新生成（兼容新旧 data 格式）
            if (el.type === 'avatar' && el.data && (
                el.data.type === 'doctor_center' ||
                (el.data.type === 'center' && el.data.operatorId === 'doctor')
            )) {
                generateDoctorCenterLayout(renderer.width || 800, renderer.height || 600, renderer);
                return;
            }
            // 干员节点双击: 跳转到该干员的关系图谱（generateLayout 生成的 operator_node）
            if (el.type === 'avatar' && el.data && (
                el.data.type === 'operator_node' ||
                (el.data.type === 'center' && el.data.operatorId !== 'doctor')
            )) {
                var opId = el.data.operatorId || el.data.id;
                if (opId && opId !== 'doctor') {
                    var isEmb = document.body.classList.contains('embedded');
                    if (isEmb && window.parent) {
                        window.parent.postMessage({ type: 'navigate_graph', id: opId, mode: 'static' }, '*');
                    } else {
                        window.location.href = window.location.pathname + '?mode=static&id=' + encodeURIComponent(opId);
                    }
                }
                return;
            }
            // 世界设定条目双击: 显示完整内容
            if (el.type === 'worldset_node' && el.data && el.data.type === 'worldset_entry') {
                var entryContent = (el.data.content || '无内容').slice(0, 500);
                window.__infoTitle.textContent = el.label || '条目';
                window.__infoContent.textContent = entryContent;
                window.__infoLayer.classList.add('visible');
                return;
            }
            // 关系节点双击跳转
            if (el.type === 'relationship' && el.data && el.data.target && el.data.resolved !== false) {
                const targetId = el.data.target;
                // 博士节点：跳转到博士中心图谱页
                if (targetId === 'doctor' || targetId === '博士') {
                    var isEmb = document.body.classList.contains('embedded');
                    if (isEmb && window.parent) {
                        window.parent.postMessage({ type: 'navigate_graph', id: '_doctor_center', mode: 'global_root' }, '*');
                    } else {
                        window.location.href = window.location.pathname + '?mode=global_root&embedded=1';
                    }
                    return;
                }
                // 二级延申节点：跳转到该干员图谱
                if (el.data.is_extension) {
                    var extOpId = targetId;
                    var isEmb2 = document.body.classList.contains('embedded');
                    if (isEmb2 && window.parent) {
                        window.parent.postMessage({ type: 'navigate_graph', id: extOpId, mode: 'static' }, '*');
                    } else {
                        window.location.href = window.location.pathname + '?mode=static&id=' + encodeURIComponent(extOpId);
                    }
                    return;
                }
                if (targetId && targetId !== 'unknown') {
                    const isEmbedded = document.body.classList.contains('embedded');
                    if (isEmbedded && window.parent) {
                        window.parent.postMessage({
                            type: 'navigate_character_detail',
                            id: targetId,
                            roleType: el.data.target_role_type || '',
                            gameNamespace: el.data.target_game_namespace || ''
                        }, '*');
                    } else {
                        const newUrl = `${window.location.pathname}?mode=static&id=${encodeURIComponent(targetId)}`;
                        window.location.href = newUrl;
                    }
                }
            }
        };

        infoClose.addEventListener('click', () => infoLayer.classList.remove('visible'));
        infoLayer.addEventListener('click', (e) => {
            if (e.target === infoLayer) infoLayer.classList.remove('visible');
        });

        zoomIn.addEventListener('click', () => renderer.zoomIn());
        zoomOut.addEventListener('click', () => renderer.zoomOut());
        zoomReset.addEventListener('click', () => renderer.resetView());

        // 启动入场动画（在渲染完成后延迟一小段时间，确保画面已绘制）
        setTimeout(() => {
            if (renderer) {
                renderer.startEntranceAnimation();
            }
        }, 100);

        // ---- 编辑功能 ----
        infoEdit.addEventListener('click', async () => {
            const entryId = window.__currentEntryId;
            if (!entryId) {
                alert('当前条目不支持编辑');
                return;
            }

            const currentContent = window.__currentContent || '';
            // 将内容区域替换为文本域
            const textarea = document.createElement('textarea');
            textarea.value = currentContent;
            textarea.style.width = '100%';
            textarea.style.height = '150px';
            textarea.style.padding = '8px';
            textarea.style.borderRadius = '8px';
            textarea.style.border = '1px solid rgba(255,255,255,0.2)';
            textarea.style.background = 'rgba(0,0,0,0.3)';
            textarea.style.color = '#fff';
            textarea.style.fontSize = '14px';
            textarea.style.resize = 'vertical';

            // 清空内容区并插入文本域
            infoContent.innerHTML = '';
            infoContent.appendChild(textarea);

            // 添加保存/取消按钮
            const btnContainer = document.createElement('div');
            btnContainer.style.marginTop = '10px';
            btnContainer.style.display = 'flex';
            btnContainer.style.gap = '10px';
            btnContainer.style.justifyContent = 'flex-end';

            const saveBtn = document.createElement('button');
            saveBtn.textContent = '保存';
            saveBtn.style.padding = '6px 16px';
            saveBtn.style.borderRadius = '6px';
            saveBtn.style.border = 'none';
            saveBtn.style.background = '#4a7db5';
            saveBtn.style.color = '#fff';
            saveBtn.style.cursor = 'pointer';

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = '取消';
            cancelBtn.style.padding = '6px 16px';
            cancelBtn.style.borderRadius = '6px';
            cancelBtn.style.border = 'none';
            cancelBtn.style.background = '#555';
            cancelBtn.style.color = '#fff';
            cancelBtn.style.cursor = 'pointer';

            btnContainer.appendChild(cancelBtn);
            btnContainer.appendChild(saveBtn);
            infoContent.appendChild(btnContainer);

            // 保存逻辑
            saveBtn.addEventListener('click', async () => {
                const newContent = textarea.value.trim();
                if (!newContent) {
                    alert('内容不能为空');
                    return;
                }
                // 调用后端更新 API
                try {
                    const payload = {
                        operator_id: window.__currentOperatorId,
                        category: window.__currentCategory,
                        content: newContent,
                        raw_data: { content: newContent },
                        level: 1
                    };
                    const res = await fetch(`/static_knowledge/entry/${entryId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (!res.ok) {
                        const err = await res.json();
                        alert('保存失败: ' + (err.detail || '未知错误'));
                        return;
                    }
                    alert('保存成功，正在刷新...');
                    // 关闭信息面板
                    infoLayer.classList.remove('visible');
                    // 重新加载当前干员的数据（刷新图谱）
                    const newData = await fetchOperatorData(operatorData.id);
                    const refreshedRelationships = await fetchRelationships(operatorData.id).catch(error => ({
                        relationships: [],
                        diagnostics: { merged_endpoint_error: error.message }
                    }));
                    // 更新布局
                    const newRect = container.getBoundingClientRect();
                    const newLayout = await generateLayout(
                        newData,
                        chooseRelationshipRecords(
                            refreshedRelationships.relationships,
                            newData.relationships
                        ),
                        newRect.width || 800,
                        newRect.height || 600
                    );
                    // 替换元素
                    await renderer.setElements(newLayout.elements);
                    // 保持缩放和偏移
                    renderer.render();
                    // 重新绑定点击事件（已绑定，无需重复）
                } catch (e) {
                    alert('保存失败: ' + e.message);
                }
            });

            // 取消逻辑
            cancelBtn.addEventListener('click', () => {
                // 恢复内容显示
                infoContent.textContent = currentContent;
                // 恢复可编辑状态标记
                window.__currentContent = currentContent;
            });
        });

        // 搜索功能
        let searchResultsData = [];
        searchInput.addEventListener('input', async (e) => {
            const query = e.target.value.trim().toLowerCase();
            if (query.length < 1) {
                searchResults.classList.add('hidden');
                return;
            }
            const allOps = await fetch('/operators').then(r => r.json());
            const matches = [];
            for (const op of allOps) {
                const name = op.codename || op.id;
                if (name.toLowerCase().includes(query) || op.id.toLowerCase().includes(query)) {
                    matches.push({ id: op.id, name: name, avatar: getOperatorAvatarUrl(op.id) });
                }
            }
            searchResultsData = matches.slice(0, 10);
            if (searchResultsData.length === 0) {
                searchResults.innerHTML = '<div class="search-result-item" style="color:#888;cursor:default;">无匹配结果</div>';
            } else {
                searchResults.innerHTML = searchResultsData.map(item => `
                    <div class="search-result-item" data-id="${item.id}">
                        <img src="${item.avatar}" class="result-avatar" onerror="this.src='/static/avatars/default.webp'">
                        <span class="result-name">${item.name}</span>
                        <span class="result-id">${item.id}</span>
                    </div>
                `).join('');
            }
            searchResults.classList.remove('hidden');
        });

        searchResults.addEventListener('click', (e) => {
            const item = e.target.closest('.search-result-item');
            if (!item) return;
            const targetId = item.dataset.id;
            if (targetId) {
                const newUrl = `${window.location.pathname}?mode=static&id=${encodeURIComponent(targetId)}`;
                window.location.href = newUrl;
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#search-container')) {
                searchResults.classList.add('hidden');
            }
        });

        // 窗口缩放重新布局
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (renderer && operatorData && window.__currentView === 'static') {
                    renderer.resize();
                    const newRect = container.getBoundingClientRect();
                    generateLayout(operatorData, relationships, newRect.width, newRect.height)
                        .then(result => {
                            renderer.setElements(result.elements);
                            renderer.updateZoomLevel();
                        });
                }
            }, 300);
        });

        
// ================================================================
//  图谱内导航栈
// ================================================================
window.graphNavStack = window.graphNavStack || [];

window.pushGraphView = function(viewType, viewData) {
    window.graphNavStack.push({ type: viewType, data: viewData || {} });
};

window.graphGoBack = function() {
    if (window.graphNavStack.length <= 1) {
        // 已在根页面，通知父页面返回
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'go_back' }, '*');
        }
        return;
    }
    // 弹出当前视图
    window.graphNavStack.pop();
    var prev = window.graphNavStack[window.graphNavStack.length - 1];
    // 重新渲染上一个视图
    var canvas = document.getElementById('graph-canvas');
    var loading = document.getElementById('loading');
    var rect = canvas.parentElement.getBoundingClientRect();
    var width = rect.width || 800;
    var height = rect.height || 600;

    if (prev.type === 'root') {
        // 重建渲染器并生成根布局
        var renderer = window.__graphRenderer;
        if (!renderer) {
            renderer = new GraphRenderer(canvas);
            window.__graphRenderer = renderer;
        }
        renderer.resize();
        generateGlobalRootLayout(width, height, renderer).then(function(layoutResult) {
            renderer.setElements(layoutResult.elements);
            window.__layoutResult = layoutResult;
            window.__currentView = 'root';
        });
    } else if (prev.type === 'doctor') {
        var renderer = window.__graphRenderer;
        if (renderer) {
            generateDoctorCenterLayout(width, height, renderer);
            window.__currentView = 'doctor';
        }
    } else if (prev.type === 'worldset') {
        var renderer = window.__graphRenderer;
        if (renderer) {
            showWorldsetCategory(renderer, prev.data.key, prev.data.label, width, height);
            window.__currentView = 'worldset';
        }
    }
}

// 处理父页面 postMessage（用于嵌入式跳转 + goBack）
window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'graph_go_back') {
        graphGoBack();
    }
});
        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'navigate_operator_detail') {
                const operatorId = e.data.operatorId;
                if (operatorId) {
                    // 跳转到干员档案页（使用 showOperatorDetail）
                    showOperatorDetail(operatorId);
                }
            } else if (e.data && e.data.type === 'navigate_graph') {
                const targetId = e.data.id;
                if (targetId) {
                    const newUrl = `${window.location.pathname}?mode=static&id=${encodeURIComponent(targetId)}`;
                    window.location.href = newUrl;
                }
            }
        });

        // ---- 更新 UI 文本 ----
        // 1. 设置干员 ID
        const agentSpan = document.getElementById('agent-id');
        if (agentSpan) agentSpan.textContent = id;

        // 2. 获取全局年份并更新时间
        async function updateDateTime() {
            try {
                // 获取全局年份
                const yearRes = await fetch('/global/year');
                let year = 1099;
                if (yearRes.ok) {
                    const data = await yearRes.json();
                    year = data.year || 1099;
                }

                const now = new Date();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');

                const datetimeStr = `${year}/${month}/${day} ${hours}:${minutes}`;
                const displayEl = document.getElementById('datetime-display');
                if (displayEl) displayEl.textContent = datetimeStr;
            } catch (e) {
                console.warn('更新时间失败', e);
            }
        }

        // 立即更新一次
        await updateDateTime();
        // 每分钟更新一次
        setInterval(updateDateTime, 60000);

    } catch (err) {
        console.error('[graph-viewer] 加载失败:', err);
        loading.innerHTML = `<div style="color:#ff6b6b;">加载失败: ${err.message}</div>`;
    }
});
