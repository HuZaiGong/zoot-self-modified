(function installStoryGraphWorkbench(global) {
    'use strict';

    const PAGE_ID = 'story-graph-workbench';
    const MAX_HISTORY = 100;
    const RELATION_LABELS = {
        related: '关联',
        depends_on: '依赖',
        conflicts_with: '冲突',
        reveals: '揭示',
        visible_to: '可见范围'
    };
    const state = {
        bound: false,
        active: false,
        kind: 'story',
        sourceId: '',
        draft: null,
        original: null,
        dirty: false,
        history: [],
        future: [],
        network: null,
        nodes: null,
        edges: null,
        scope: null,
        selectedNodes: [],
        selectedEdges: [],
        dragSnapshot: null,
        runtimeOverlay: null,
        clipboard: [],
        timeline: {scopeType: 'conversation', scopeKey: '', data: null}
    };

    const byId = id => document.getElementById(id);
    const clone = value => JSON.parse(JSON.stringify(value ?? null));
    const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
    const notify = (message, type) => {
        if (typeof global.toast === 'function') global.toast(message, type);
        else console[type === 'error' ? 'error' : 'log'](message);
    };
    async function api(path, options = {}) {
        const response = await (global.ZootRuntime?.apiFetch || global.fetch)(path, options);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || payload.message || `请求失败 (${response.status})`);
        return payload;
    }
    function stableId(prefix) {
        const random = global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        return `${prefix}-${random}`.slice(0, 100);
    }
    function sourceForms() {
        return {
            story: byId('story-editor-form'),
            lore: byId('lore-editor-form')
        };
    }
    function readJson(input, fallback = []) {
        try { return JSON.parse(input?.value || JSON.stringify(fallback)); }
        catch (_) { return clone(fallback); }
    }
    function captureEditorDraft(kind) {
        const form = sourceForms()[kind];
        if (!form) return null;
        if (kind === 'story') {
            return {
                ...clone(form._storyRawDraft || {}),
                template_id: form.dataset.templateId || undefined,
                name: form.elements.name.value.trim() || '未命名剧情',
                scope: form.elements.scope.value,
                owner_operator_id: form.elements.owner_operator_id.value.trim() || null,
                category: form.elements.category.value,
                mode: form.elements.mode.value,
                status: 'draft',
                nodes: readJson(form.elements.nodes),
                edges: readJson(form.elements.edges),
                acts: readJson(form.elements.acts),
                openings: readJson(form.elements.openings),
                editor_layout: clone(form._storyEditorLayout || {})
            };
        }
        return {
            ...clone(form._loreRawDraft || {}),
            deck_id: form.dataset.deckId || undefined,
            name: form.elements.name.value.trim() || '未命名 Lore Deck',
            description: form.elements.description.value.trim(),
            scope: form.elements.scope.value,
            scope_ref: form.elements.scope_ref.value.trim(),
            status: 'draft',
            settings: {token_budget: Number(form.elements.token_budget.value || 2400)},
            entries: readJson(form.elements.entries),
            groups: readJson(form.elements.groups),
            relations: readJson(form.elements.relations),
            editor_layout: clone(form._loreEditorLayout || {})
        };
    }
    function writeEditorDraft(kind, draft) {
        const form = sourceForms()[kind];
        if (!form || !draft) return;
        if (kind === 'story') {
            form.dataset.templateId = draft.template_id || '';
            ['name', 'scope', 'owner_operator_id', 'category', 'mode'].forEach(key => {
                if (form.elements[key]) form.elements[key].value = draft[key] ?? '';
            });
            form.elements.nodes.value = JSON.stringify(draft.nodes || [], null, 2);
            form.elements.edges.value = JSON.stringify(draft.edges || [], null, 2);
            form.elements.acts.value = JSON.stringify(draft.acts || [], null, 2);
            form.elements.openings.value = JSON.stringify(draft.openings || [], null, 2);
            form._storyRawDraft = clone(draft);
            form._storyEditorLayout = clone(draft.editor_layout || {});
        } else {
            form.dataset.deckId = draft.deck_id || '';
            ['name', 'description', 'scope', 'scope_ref'].forEach(key => {
                if (form.elements[key]) form.elements[key].value = draft[key] ?? '';
            });
            form.elements.token_budget.value = Number(draft.settings?.token_budget || 2400);
            form.elements.entries.value = JSON.stringify(draft.entries || [], null, 2);
            form.elements.groups.value = JSON.stringify(draft.groups || [], null, 2);
            form.elements.relations.value = JSON.stringify(draft.relations || [], null, 2);
            form._loreRawDraft = clone(draft);
            form._loreEditorLayout = clone(draft.editor_layout || {});
        }
    }
    function setDirty(value) {
        state.dirty = Boolean(value);
        const label = byId('story-graph-dirty-state');
        if (label) {
            label.textContent = state.dirty ? '未保存草稿' : '已同步';
            label.classList.toggle('dirty', state.dirty);
        }
    }
    function snapshot() {
        return clone(state.draft);
    }
    function pushHistory(previous = snapshot()) {
        if (!previous) return;
        state.history.push(previous);
        if (state.history.length > MAX_HISTORY) state.history.shift();
        state.future.length = 0;
        setDirty(true);
        refreshCommandState();
    }
    function restoreDraft(value) {
        state.draft = clone(value);
        setDirty(JSON.stringify(state.draft) !== JSON.stringify(state.original));
        renderGraph();
    }
    function undo() {
        if (!state.history.length || state.kind === 'timeline') return;
        state.future.push(snapshot());
        restoreDraft(state.history.pop());
    }
    function redo() {
        if (!state.future.length || state.kind === 'timeline') return;
        state.history.push(snapshot());
        restoreDraft(state.future.pop());
    }
    function layoutPositions() {
        return state.draft?.editor_layout?.positions || {};
    }
    function positionFor(id, fallback) {
        const position = layoutPositions()[id];
        return position ? {x: position.x, y: position.y, fixed: false} : fallback;
    }
    function hasAuthoredPositions() {
        if (state.kind === 'timeline') return Object.keys(readTimelineLayout()).length > 0;
        return Object.keys(layoutPositions()).length > 0;
    }
    function storyGraphData() {
        const draft = state.draft || {};
        const actByBeat = new Map();
        (draft.acts || []).forEach(act => (act.beat_ids || []).forEach(id => actByBeat.set(String(id), act)));
        const overlay = state.runtimeOverlay || {};
        const traversedNodes = new Set(overlay.traversed_node_ids || []);
        const checkpoints = new Set(overlay.checkpoint_node_ids || []);
        const current = String(overlay.current_node_id || '');
        const edgeState = new Map((overlay.edge_states || []).map(item => [String(item.edge_id), item]));
        const nodes = [];
        (draft.acts || []).forEach((act, index) => nodes.push({
            id: `act:${act.act_id}`,
            label: `幕 ${index + 1}\n${act.title || act.act_id}`,
            shape: 'box', group: 'act', physics: false,
            ...positionFor(`act:${act.act_id}`, {x: index * 420, y: -260}),
            _type: 'act', _source: act
        }));
        (draft.nodes || []).forEach((node, index) => {
            const id = String(node.id);
            const act = actByBeat.get(id);
            const markers = [node.ending ? '结局' : '', node.dynamic ? '动态' : '', checkpoints.has(id) ? '检查点' : ''].filter(Boolean);
            nodes.push({
                id,
                label: `${node.title || id}${markers.length ? `\n${markers.join(' · ')}` : ''}`,
                shape: node.ending ? 'diamond' : node.dynamic ? 'hexagon' : 'box',
                group: current === id ? 'current' : traversedNodes.has(id) ? 'traversed' : act ? `act-${act.act_id}` : 'beat',
                ...positionFor(id, {x: (index % 5) * 220, y: Math.floor(index / 5) * 160}),
                _type: 'story-node', _source: node
            });
        });
        (draft.openings || []).forEach((opening, index) => nodes.push({
            id: `opening:${opening.opening_id}`,
            label: `开场\n${opening.title || opening.opening_id}`,
            shape: 'triangleDown', group: 'opening', physics: false,
            ...positionFor(`opening:${opening.opening_id}`, {x: index * 180, y: -100}),
            _type: 'opening', _source: opening
        }));
        const edges = (draft.edges || []).map(edge => {
            const runtime = edgeState.get(String(edge.id));
            return {
                id: String(edge.id), from: String(edge.from), to: String(edge.to),
                label: edge.label || edge.condition || '', arrows: 'to',
                dashes: Boolean(edge.condition),
                color: runtime ? (runtime.eligible ? '#37a96b' : '#c98f34') : undefined,
                width: (overlay.traversed_edge_ids || []).includes(String(edge.id)) ? 4 : 2,
                _type: 'story-edge', _source: edge
            };
        });
        (draft.acts || []).forEach(act => (act.beat_ids || []).forEach(id => {
            if ((draft.nodes || []).some(node => String(node.id) === String(id))) {
                edges.push({id: `membership:${act.act_id}:${id}`, from: `act:${act.act_id}`, to: String(id), dashes: true, color: {opacity: 0.25}, physics: false, _type: 'membership'});
            }
        }));
        (draft.openings || []).forEach(opening => {
            if (opening.entry_node_id) edges.push({id: `opening-edge:${opening.opening_id}`, from: `opening:${opening.opening_id}`, to: String(opening.entry_node_id), arrows: 'to', dashes: true, _type: 'opening-edge'});
        });
        return {nodes, edges};
    }
    function loreGraphData() {
        const draft = state.draft || {};
        const groupByEntry = new Map();
        (draft.groups || []).forEach(group => (group.entry_ids || []).forEach(id => groupByEntry.set(String(id), group)));
        const nodes = [{id: 'deck:root', label: draft.name || 'Lore Deck', shape: 'box', group: 'deck', physics: false, ...positionFor('deck:root', {x: 0, y: -260}), _type: 'deck', _source: draft}];
        (draft.groups || []).forEach((group, index) => nodes.push({
            id: `group:${group.group_id}`, label: group.title || group.group_id,
            shape: 'box', group: 'lore-group', physics: false,
            ...positionFor(`group:${group.group_id}`, {x: (index - 2) * 260, y: -80}),
            _type: 'lore-group', _source: group
        }));
        (draft.entries || []).forEach((entry, index) => {
            const group = groupByEntry.get(String(entry.entry_id));
            nodes.push({
                id: String(entry.entry_id), label: `${entry.title || entry.entry_id}\n${entry.activation_mode || 'keyword'}`,
                shape: 'box', group: entry.enabled === false ? 'disabled' : `lore-${entry.activation_mode || 'keyword'}`,
                ...positionFor(String(entry.entry_id), {x: (index % 5) * 220, y: 160 + Math.floor(index / 5) * 150}),
                _type: 'lore-entry', _source: entry, _groupId: group?.group_id || ''
            });
        });
        const edges = [];
        (draft.groups || []).forEach(group => {
            edges.push({id: `deck-group:${group.group_id}`, from: 'deck:root', to: `group:${group.group_id}`, dashes: true, color: {opacity: 0.35}, _type: 'membership'});
            (group.entry_ids || []).forEach(id => edges.push({id: `group-entry:${group.group_id}:${id}`, from: `group:${group.group_id}`, to: String(id), dashes: true, color: {opacity: 0.3}, _type: 'membership'}));
        });
        (draft.entries || []).filter(entry => !groupByEntry.has(String(entry.entry_id))).forEach(entry => edges.push({id: `deck-entry:${entry.entry_id}`, from: 'deck:root', to: String(entry.entry_id), dashes: true, color: {opacity: 0.25}, _type: 'membership'}));
        (draft.relations || []).forEach(relation => edges.push({
            id: String(relation.relation_id), from: String(relation.source_entry_id), to: String(relation.target_entry_id),
            label: relation.label || RELATION_LABELS[relation.relation_type] || relation.relation_type,
            arrows: ['depends_on', 'reveals', 'visible_to'].includes(relation.relation_type) ? 'to' : '',
            color: relation.relation_type === 'conflicts_with' ? '#c15353' : undefined,
            dashes: relation.relation_type === 'related', _type: 'lore-relation', _source: relation
        }));
        return {nodes, edges};
    }
    function timelineGraphData() {
        const data = state.timeline.data || {};
        const stored = readTimelineLayout();
        const nodes = (data.nodes || []).map((branch, index) => ({
            id: String(branch.branch_id),
            label: `${branch.name || branch.branch_id}\n${branch.message_count || 0} 条消息`,
            shape: 'box',
            group: branch.is_current ? 'current' : branch.is_current_path ? 'traversed' : branch.archived || branch.status === 'archived' ? 'disabled' : 'timeline',
            ...(stored[String(branch.branch_id)] || {x: (index % 5) * 230, y: Math.floor(index / 5) * 170}),
            fixed: false, _type: 'timeline-branch', _source: branch
        }));
        const edges = (data.edges || []).map((edge, index) => ({
            id: `timeline:${edge.source}:${edge.target}:${index}`,
            from: String(edge.source), to: String(edge.target), arrows: 'to', dashes: true,
            width: (data.nodes || []).find(item => String(item.branch_id) === String(edge.target))?.is_current_path ? 3 : 1,
            _type: 'timeline-edge', _source: edge
        }));
        return {nodes, edges};
    }
    function networkOptions() {
        const authored = hasAuthoredPositions();
        return {
            autoResize: true,
            interaction: {hover: true, multiselect: true, navigationButtons: false, keyboard: {enabled: true}},
            physics: {enabled: !authored, solver: 'hierarchicalRepulsion', stabilization: {iterations: 220, fit: true}},
            layout: {hierarchical: {enabled: !authored, direction: 'UD', sortMethod: 'directed', levelSeparation: 150, nodeSpacing: 150, treeSpacing: 220}},
            nodes: {font: {face: 'system-ui', size: 14, multi: false}, margin: 12, borderWidth: 1, widthConstraint: {minimum: 120, maximum: 210}},
            edges: {font: {size: 11, align: 'middle'}, smooth: {type: 'cubicBezier', forceDirection: 'vertical', roundness: 0.35}},
            groups: {
                current: {color: {background: '#cfb9ff', border: '#7652b5'}},
                traversed: {color: {background: '#dceee4', border: '#4f8c68'}},
                opening: {color: {background: '#f5e7bc', border: '#a17d26'}},
                act: {color: {background: '#e7e9ee', border: '#737986'}},
                deck: {color: {background: '#d8c9f0', border: '#71549b'}},
                'lore-group': {color: {background: '#e3e6eb', border: '#6e7480'}},
                'lore-always': {color: {background: '#dceee4', border: '#4f8c68'}},
                'lore-keyword': {color: {background: '#e1e8f4', border: '#56759f'}},
                'lore-semantic': {color: {background: '#ece1f4', border: '#805d9d'}},
                'lore-state': {color: {background: '#f5e7bc', border: '#a17d26'}},
                disabled: {color: {background: '#dddddd', border: '#999999'}, font: {color: '#777777'}},
                timeline: {color: {background: '#e5e8ed', border: '#69717e'}}
            }
        };
    }
    async function renderGraph() {
        if (!state.active || !state.draft && state.kind !== 'timeline') return;
        if (state.kind !== 'timeline' && state.draft) writeEditorDraft(state.kind, state.draft);
        const vis = await global.ZootRuntime.ensureVendor('vis');
        const container = byId('story-graph-canvas');
        if (!container || !state.active) return;
        state.network?.destroy();
        const graph = state.kind === 'story' ? storyGraphData() : state.kind === 'lore' ? loreGraphData() : timelineGraphData();
        state.nodes = new vis.DataSet(graph.nodes);
        state.edges = new vis.DataSet(graph.edges);
        state.network = new vis.Network(container, {nodes: state.nodes, edges: state.edges}, networkOptions());
        byId('story-graph-canvas-empty').hidden = graph.nodes.length > 0;
        bindNetworkEvents();
        renderOutline(graph.nodes);
        renderInspector();
        updateMinimap();
        if (!hasAuthoredPositions()) {
            state.network.once('stabilizationIterationsDone', () => {
                state.network?.setOptions({physics: false});
                updateMinimap();
            });
        }
        refreshCommandState();
    }
    function bindNetworkEvents() {
        const network = state.network;
        network.on('select', params => {
            state.selectedNodes = params.nodes.map(String);
            state.selectedEdges = params.edges.map(String).filter(id => !id.startsWith('membership:') && !id.startsWith('opening-edge:') && !id.startsWith('deck-') && !id.startsWith('group-entry:'));
            renderInspector();
        });
        network.on('deselectNode', () => { state.selectedNodes = []; renderInspector(); });
        network.on('dragStart', () => { state.dragSnapshot = snapshot(); });
        network.on('dragEnd', params => {
            const positions = network.getPositions(params.nodes || []);
            if (state.kind === 'timeline') {
                saveTimelineLayout(positions);
            } else if (Object.keys(positions).length) {
                pushHistory(state.dragSnapshot || snapshot());
                const layout = state.draft.editor_layout ||= {schema_version: 1, positions: {}, collapsed_groups: []};
                layout.positions ||= {};
                Object.entries(positions).forEach(([id, point]) => layout.positions[id] = {x: point.x, y: point.y, fixed: true});
            }
            state.dragSnapshot = null;
            updateMinimap();
        });
        network.on('doubleClick', params => {
            if (!params.nodes.length && state.kind !== 'timeline') addNode(params.pointer.canvas);
        });
        network.on('zoom', updateMinimap);
        network.on('dragging', updateMinimap);
    }
    function renderOutline(nodes) {
        const root = byId('story-graph-outline');
        if (!root) return;
        const groups = new Map();
        nodes.forEach(node => {
            const key = node._type || 'other';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(node);
        });
        root.innerHTML = Array.from(groups.entries()).map(([type, items]) => `<section><strong>${escapeHtml(outlineGroupLabel(type))}</strong>${items.map(item => `<button type="button" role="treeitem" data-outline-node="${escapeHtml(item.id)}">${escapeHtml(String(item.label).replace(/\n/g, ' · '))}</button>`).join('')}</section>`).join('') || '<p>暂无节点</p>';
        root.querySelectorAll('[data-outline-node]').forEach(button => button.onclick = () => {
            const id = button.dataset.outlineNode;
            state.network?.selectNodes([id]);
            state.network?.focus(id, {scale: 1.15, animation: true});
            state.selectedNodes = [id];
            renderInspector();
        });
    }
    function outlineGroupLabel(type) {
        return ({act: '幕', 'story-node': '节拍', opening: '开场', deck: '设定集', 'lore-group': '分组', 'lore-entry': '条目', 'timeline-branch': '分支'})[type] || '其他';
    }
    function renderInspector() {
        const root = byId('story-graph-inspector');
        if (!root) return;
        if (state.kind === 'timeline') return renderTimelineInspector(root);
        const nodeId = state.selectedNodes[0];
        const edgeId = state.selectedEdges[0];
        const item = nodeId ? state.nodes?.get(nodeId) : edgeId ? state.edges?.get(edgeId) : null;
        if (!item) {
            root.innerHTML = state.kind === 'lore'
                ? '<p>选择条目、分组或关系以编辑。作者关系不参与自动激活。</p><div class="story-graph-inspector-actions"><button type="button" data-inspector-action="add-entry">新增条目</button><button type="button" data-inspector-action="add-group">新增分组</button><button type="button" data-inspector-action="simulate">模拟本轮激活</button></div>'
                : '<p>选择幕、节拍、开场或条件边以编辑。运行覆盖层不会修改草稿。</p><div class="story-graph-inspector-actions"><button type="button" data-inspector-action="add-beat">新增节拍</button><button type="button" data-inspector-action="add-act">新增幕</button><button type="button" data-inspector-action="add-opening">新增开场</button></div>';
            root.querySelector('[data-inspector-action="simulate"]')?.addEventListener('click', showLoreSimulation);
            root.querySelector('[data-inspector-action="add-entry"]')?.addEventListener('click', () => addNode(undefined, 'entry'));
            root.querySelector('[data-inspector-action="add-group"]')?.addEventListener('click', () => addNode(undefined, 'group'));
            root.querySelector('[data-inspector-action="add-beat"]')?.addEventListener('click', () => addNode(undefined, 'beat'));
            root.querySelector('[data-inspector-action="add-act"]')?.addEventListener('click', () => addNode(undefined, 'act'));
            root.querySelector('[data-inspector-action="add-opening"]')?.addEventListener('click', () => addNode(undefined, 'opening'));
            return;
        }
        root.innerHTML = inspectorForm(item);
        const form = root.querySelector('form');
        if (form) form.onsubmit = event => { event.preventDefault(); applyInspector(item, new FormData(form)); };
    }
    function inspectorForm(item) {
        const source = item._source || {};
        if (item._type === 'story-node') return `<form class="settings-form"><h3>节拍节点</h3><label>ID<input name="id" value="${escapeHtml(source.id)}" readonly></label><label>标题<input name="title" value="${escapeHtml(source.title || '')}"></label><label>摘要<textarea name="summary">${escapeHtml(source.summary || '')}</textarea></label><label>导演指导<textarea name="instruction">${escapeHtml(source.instruction || '')}</textarea></label><label>进入条件<input name="condition" value="${escapeHtml(source.condition || '')}"></label><label>访问上限<input name="visit_limit" type="number" min="0" value="${Number(source.visit_limit || 0)}"></label><label class="settings-checkbox"><input name="ending" type="checkbox" ${source.ending ? 'checked' : ''}>结局节点</label><label class="settings-checkbox"><input name="dynamic" type="checkbox" ${source.dynamic ? 'checked' : ''}>动态出口</label><button class="button-primary">应用到草稿</button></form>`;
        if (item._type === 'story-edge') return `<form class="settings-form"><h3>剧情边</h3><label>标签<input name="label" value="${escapeHtml(source.label || '')}"></label><label>条件<input name="condition" value="${escapeHtml(source.condition || '')}"></label><label>状态效果 JSON<textarea name="effects">${escapeHtml(JSON.stringify(source.effects || {}, null, 2))}</textarea></label><button class="button-primary">应用到草稿</button></form>`;
        if (item._type === 'act') return `<form class="settings-form"><h3>幕</h3><label>标题<input name="title" value="${escapeHtml(source.title || '')}"></label><label>阶段目标<textarea name="objective">${escapeHtml(source.objective || '')}</textarea></label><label>主要矛盾<textarea name="conflict">${escapeHtml(source.conflict || '')}</textarea></label><label>节拍 ID（逗号分隔）<input name="beat_ids" value="${escapeHtml((source.beat_ids || []).join(','))}"></label><button class="button-primary">应用到草稿</button></form>`;
        if (item._type === 'opening') return `<form class="settings-form"><h3>开场方案</h3><label>标题<input name="title" value="${escapeHtml(source.title || '')}"></label><label>内容<textarea name="content">${escapeHtml(source.content || '')}</textarea></label><label>POV<input name="pov" value="${escapeHtml(source.pov || 'third_person')}"></label><label>入口节点<input name="entry_node_id" value="${escapeHtml(source.entry_node_id || '')}"></label><button class="button-primary">应用到草稿</button></form>`;
        if (item._type === 'lore-entry') return `<form class="settings-form"><h3>Lore 条目</h3><label>ID<input name="entry_id" value="${escapeHtml(source.entry_id)}" readonly></label><label>标题<input name="title" value="${escapeHtml(source.title || '')}"></label><label>正文<textarea name="content" rows="7">${escapeHtml(source.content || '')}</textarea></label><label>激活方式<select name="activation_mode">${['always','keyword','semantic','state'].map(value => `<option value="${value}" ${source.activation_mode === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>关键词（逗号分隔）<input name="keywords" value="${escapeHtml((source.keywords || []).join(','))}"></label><label>条件<input name="condition" value="${escapeHtml(source.condition || '')}"></label><label>优先级<input name="priority" type="number" value="${Number(source.priority || 0)}"></label><label>互斥组<input name="exclusion_group" value="${escapeHtml(source.exclusion_group || '')}"></label><label>概率<input name="probability" type="number" min="0" max="1" step="0.01" value="${Number(source.probability ?? 1)}"></label><label>持续消息数<input name="sticky_turns" type="number" min="0" value="${Number(source.sticky_turns || 0)}"></label><label>冷却消息数<input name="cooldown_turns" type="number" min="0" value="${Number(source.cooldown_turns || 0)}"></label><label>可见范围（逗号分隔）<input name="visibility" value="${escapeHtml((source.visibility || []).join(','))}"></label><label class="settings-checkbox"><input name="enabled" type="checkbox" ${source.enabled !== false ? 'checked' : ''}>启用</label><button class="button-primary">应用到草稿</button></form>`;
        if (item._type === 'lore-relation') return `<form class="settings-form"><h3>Lore 关系</h3><label>类型<select name="relation_type">${Object.entries(RELATION_LABELS).map(([value,label]) => `<option value="${value}" ${source.relation_type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>标签<input name="label" value="${escapeHtml(source.label || '')}"></label><label>说明<textarea name="description">${escapeHtml(source.description || '')}</textarea></label><p class="form-hint">关系只用于表达和诊断，不参与激活。</p><button class="button-primary">应用到草稿</button></form>`;
        if (item._type === 'lore-group') return `<form class="settings-form"><h3>Lore 分组</h3><label>标题<input name="title" value="${escapeHtml(source.title || '')}"></label><label>说明<textarea name="description">${escapeHtml(source.description || '')}</textarea></label><label>条目 ID（逗号分隔）<input name="entry_ids" value="${escapeHtml((source.entry_ids || []).join(','))}"></label><button class="button-primary">应用到草稿</button></form>`;
        return `<pre>${escapeHtml(JSON.stringify(source, null, 2))}</pre>`;
    }
    function applyInspector(item, formData) {
        pushHistory();
        const data = Object.fromEntries(formData);
        const source = item._source;
        if (item._type === 'story-node') {
            Object.assign(source, data, {visit_limit: Number(data.visit_limit || 0), ending: formData.has('ending'), dynamic: formData.has('dynamic')});
        } else if (item._type === 'story-edge') {
            Object.assign(source, data, {effects: readJson({value: data.effects}, {})});
        } else if (item._type === 'act') {
            Object.assign(source, data, {beat_ids: String(data.beat_ids || '').split(',').map(value => value.trim()).filter(Boolean)});
        } else if (item._type === 'lore-entry') {
            Object.assign(source, data, {
                keywords: String(data.keywords || '').split(',').map(item => item.trim()).filter(Boolean),
                visibility: String(data.visibility || '').split(',').map(item => item.trim()).filter(Boolean),
                priority: Number(data.priority || 0), probability: Number(data.probability ?? 1),
                sticky_turns: Number(data.sticky_turns || 0), cooldown_turns: Number(data.cooldown_turns || 0),
                enabled: formData.has('enabled')
            });
        } else if (item._type === 'lore-group') {
            Object.assign(source, data, {entry_ids: String(data.entry_ids || '').split(',').map(value => value.trim()).filter(Boolean)});
        } else Object.assign(source, data);
        renderGraph();
    }
    function renderTimelineInspector(root) {
        const selected = state.selectedNodes.map(id => state.nodes?.get(id)).filter(Boolean);
        if (selected.length === 2) {
            const paths = selected.map(item => ancestorPath(item.id));
            const common = paths[0].filter(id => paths[1].includes(id));
            root.innerHTML = `<h3>分支比较</h3><p>${escapeHtml(selected[0]._source.name)} ↔ ${escapeHtml(selected[1]._source.name)}</p><p>共同路径 ${common.length} 层</p><p>消息差异 ${Math.abs(Number(selected[0]._source.message_count || 0) - Number(selected[1]._source.message_count || 0))} 条</p>`;
            return;
        }
        const item = selected[0];
        if (!item) { root.innerHTML = '<p>选择一个分支查看影响；多选两个分支可进行比较。</p>'; return; }
        const branch = item._source;
        const impact = branch.impact || {};
        const archived = branch.archived || branch.status === 'archived';
        root.innerHTML = `<h3>${escapeHtml(branch.name || branch.branch_id)}</h3><p>${branch.is_current ? '当前分支' : branch.is_current_path ? '当前路径' : '兄弟分支'} · ${archived ? '已归档' : '活动'}</p><p>${escapeHtml(branch.fork_message?.preview || '根分支')}</p><div class="story-graph-impact">${Object.entries(impact).map(([key,value]) => `<span>${escapeHtml(key)} ${Number(value || 0)}</span>`).join('') || '<span>暂无派生影响</span>'}</div><form class="settings-form" id="timeline-branch-edit"><label>分支名称<input name="name" value="${escapeHtml(branch.name || '')}"></label><button type="submit">保存名称</button></form><div class="story-graph-inspector-actions">${branch.is_current || archived ? '' : '<button data-timeline-action="switch">切换并预检</button>'}<button data-timeline-action="archive">${archived ? '恢复' : '归档'}</button>${branch.branch_id === 'main' ? '' : '<button data-timeline-action="delete" class="danger">删除并预检</button>'}${branch.fork_message_uid ? '<button data-timeline-action="fork">从分叉消息新建分支</button>' : ''}</div>`;
        root.querySelector('#timeline-branch-edit').onsubmit = async event => {
            event.preventDefault();
            await api(`/timeline/branches/${encodeURIComponent(branch.branch_id)}`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: new FormData(event.currentTarget).get('name')})});
            await loadTimeline();
        };
        root.querySelectorAll('[data-timeline-action]').forEach(button => button.onclick = () => timelineAction(button.dataset.timelineAction, branch));
    }
    function ancestorPath(branchId) {
        const map = new Map((state.timeline.data?.nodes || []).map(item => [String(item.branch_id), item]));
        const path = [];
        let current = map.get(String(branchId));
        while (current) { path.unshift(String(current.branch_id)); current = map.get(String(current.parent_branch_id || '')); }
        return path;
    }
    async function timelineAction(action, branch) {
        try {
            if (action === 'switch') {
                const impact = await api(`/timeline/branches/${encodeURIComponent(branch.branch_id)}/switch-impact?scope_type=${encodeURIComponent(state.timeline.scopeType)}&scope_key=${encodeURIComponent(state.timeline.scopeKey)}`);
                const total = Object.values(impact.categories || {}).reduce((sum, value) => sum + Number(value || 0), 0);
                if (!confirm(`切换到“${branch.name}”？目标路径包含 ${total} 项可见状态。`)) return;
                await api(`/timeline/branches/${encodeURIComponent(branch.branch_id)}/switch?scope_type=${encodeURIComponent(state.timeline.scopeType)}&scope_key=${encodeURIComponent(state.timeline.scopeKey)}`, {method: 'POST'});
            } else if (action === 'archive') {
                const archived = branch.archived || branch.status === 'archived';
                await api(`/timeline/branches/${encodeURIComponent(branch.branch_id)}`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({archived: !archived})});
            } else if (action === 'delete') {
                const impact = await api(`/timeline/branches/${encodeURIComponent(branch.branch_id)}/impact`);
                if (!impact.deletable) return notify('该时间线必须先归档，且不能有子分支、活动剧情或设备正在使用', 'error');
                if (!confirm(`删除“${branch.name}”？消息 ${impact.messages || 0} 条，子分支 ${impact.children || 0} 个。`)) return;
                await api(`/timeline/branches/${encodeURIComponent(branch.branch_id)}`, {method: 'DELETE'});
            } else if (action === 'fork') {
                const name = prompt('新分支名称', `${branch.name || '分支'}的分支`);
                if (!name) return;
                await api('/timeline/branches', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, scope_type: state.timeline.scopeType, scope_key: state.timeline.scopeKey, fork_message_uid: branch.fork_message_uid})});
            }
            await loadTimeline();
        } catch (error) { notify(error.message, 'error'); }
    }
    function addNode(point = {x: 0, y: 0}, entityType = '') {
        if (state.kind === 'timeline' || !state.draft) return;
        point ||= state.network?.getViewPosition?.() || {x: 0, y: 0};
        pushHistory();
        if (state.kind === 'story') {
            if (entityType === 'act') {
                const act_id = stableId('act');
                state.draft.acts ||= [];
                state.draft.acts.push({act_id, title: '新幕', objective: '', conflict: '', beat_ids: []});
                ensureLayoutPosition(`act:${act_id}`, point);
            } else if (entityType === 'opening') {
                const opening_id = stableId('opening');
                state.draft.openings ||= [];
                state.draft.openings.push({opening_id, title: '新开场', content: '', pov: 'third_person', entry_node_id: ''});
                ensureLayoutPosition(`opening:${opening_id}`, point);
            } else {
                const id = stableId('beat');
                state.draft.nodes ||= [];
                state.draft.nodes.push({id, title: '新节拍', summary: '', visit_limit: 1});
                ensureLayoutPosition(id, point);
            }
        } else {
            if (entityType === 'group') {
                const group_id = stableId('group');
                state.draft.groups ||= [];
                state.draft.groups.push({group_id, title: '新分组', description: '', entry_ids: [], sort_order: state.draft.groups.length});
                ensureLayoutPosition(`group:${group_id}`, point);
            } else {
                const id = stableId('lore');
                state.draft.entries ||= [];
                state.draft.entries.push({entry_id: id, title: '新设定', content: '请填写设定事实', activation_mode: 'keyword', keywords: ['关键词'], probability: 1, enabled: true});
                ensureLayoutPosition(id, point);
            }
        }
        renderGraph();
    }
    function ensureLayoutPosition(id, point) {
        const layout = state.draft.editor_layout ||= {schema_version: 1, positions: {}, collapsed_groups: []};
        layout.positions ||= {};
        layout.positions[id] = {x: Number(point.x || 0), y: Number(point.y || 0), fixed: true};
    }
    function addEdge() {
        if (state.kind === 'timeline') return;
        const expectedType = state.kind === 'story' ? 'story-node' : 'lore-entry';
        const ids = state.selectedNodes.filter(id => state.nodes?.get(id)?._type === expectedType);
        if (ids.length !== 2) return notify('请先按顺序选择两个普通节点', 'error');
        pushHistory();
        if (state.kind === 'story') {
            state.draft.edges ||= [];
            state.draft.edges.push({id: stableId('edge'), from: ids[0], to: ids[1], label: '', condition: '', effects: {}});
        } else {
            state.draft.relations ||= [];
            state.draft.relations.push({relation_id: stableId('relation'), source_entry_id: ids[0], target_entry_id: ids[1], relation_type: 'related', label: '', description: ''});
        }
        renderGraph();
    }
    function pasteClipboard() {
        if (!state.clipboard.length || state.kind === 'timeline') return;
        pushHistory();
        state.clipboard.forEach((item, index) => {
            if (state.kind === 'story') {
                const id = stableId('beat');
                state.draft.nodes ||= [];
                state.draft.nodes.push({...clone(item), id, title: `${item.title || '节拍'} 副本`});
                ensureLayoutPosition(id, {x: index * 28, y: index * 28});
            } else {
                const entry_id = stableId('lore');
                state.draft.entries ||= [];
                state.draft.entries.push({...clone(item), entry_id, title: `${item.title || '设定'} 副本`});
                ensureLayoutPosition(entry_id, {x: index * 28, y: index * 28});
            }
        });
        renderGraph();
    }
    function deleteSelection() {
        if (state.kind === 'timeline') return notify('时间线结构只能通过详情中的安全操作管理', 'error');
        const nodes = new Set(state.selectedNodes);
        const edges = new Set(state.selectedEdges);
        if (!nodes.size && !edges.size) return;
        pushHistory();
        if (state.kind === 'story') {
            const beatIds = new Set([...nodes].filter(id => !id.startsWith('act:') && !id.startsWith('opening:')));
            const actIds = new Set([...nodes].filter(id => id.startsWith('act:')).map(id => id.slice(4)));
            const openingIds = new Set([...nodes].filter(id => id.startsWith('opening:')).map(id => id.slice(8)));
            state.draft.nodes = (state.draft.nodes || []).filter(item => !beatIds.has(String(item.id)));
            state.draft.edges = (state.draft.edges || []).filter(item => !edges.has(String(item.id)) && !beatIds.has(String(item.from)) && !beatIds.has(String(item.to)));
            state.draft.acts = (state.draft.acts || []).filter(item => !actIds.has(String(item.act_id))).map(item => ({...item, beat_ids: (item.beat_ids || []).filter(id => !beatIds.has(String(id)))}));
            state.draft.openings = (state.draft.openings || []).filter(item => !openingIds.has(String(item.opening_id)));
        } else {
            const entryIds = new Set([...nodes].filter(id => !id.startsWith('group:') && id !== 'deck:root'));
            const groupIds = new Set([...nodes].filter(id => id.startsWith('group:')).map(id => id.slice(6)));
            state.draft.entries = (state.draft.entries || []).filter(item => !entryIds.has(String(item.entry_id)));
            state.draft.groups = (state.draft.groups || []).filter(item => !groupIds.has(String(item.group_id))).map(item => ({...item, entry_ids: (item.entry_ids || []).filter(id => !entryIds.has(String(id)))}));
            state.draft.relations = (state.draft.relations || []).filter(item => !edges.has(String(item.relation_id)) && !entryIds.has(String(item.source_entry_id)) && !entryIds.has(String(item.target_entry_id)));
        }
        state.selectedNodes = [];
        state.selectedEdges = [];
        renderGraph();
    }
    async function validateDraft() {
        if (state.kind === 'timeline') return notify('时间线由后端持续校验');
        try {
            const endpoint = state.kind === 'story' ? '/stories/templates/validate' : '/stories/lore/decks/validate';
            const result = await api(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(state.draft)});
            const validation = result.validation || {};
            byId('story-graph-status').textContent = validation.warnings?.length ? validation.warnings.join('；') : '校验通过，可以保存草稿。';
            notify('图谱校验通过');
            return result;
        } catch (error) {
            byId('story-graph-status').textContent = `校验失败：${error.message}`;
            notify(error.message, 'error');
            throw error;
        }
    }
    async function saveDraft(status = 'draft') {
        if (state.kind === 'timeline') return notify('时间线位置已保存在当前设备');
        if (status === 'published' && !confirm('发布后将创建一个新的内容版本。继续吗？')) return;
        try {
            const validated = await validateDraft();
            const endpoint = state.kind === 'story' ? '/stories/templates' : '/stories/lore/decks';
            const payload = {...state.draft, ...validated, status};
            delete payload.validation;
            const saved = await api(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
            state.draft = clone(saved);
            state.original = clone(saved);
            state.sourceId = String(saved.template_id || saved.deck_id || '');
            state.history.length = 0;
            state.future.length = 0;
            setDirty(false);
            writeEditorDraft(state.kind, saved);
            await refreshSourceList(state.sourceId);
            renderGraph();
            notify(status === 'published' ? '新版本已发布' : '图谱草稿已保存');
        } catch (_) {}
    }
    async function showLoreSimulation() {
        if (state.kind !== 'lore' || !state.draft) return;
        const text = prompt('输入用于模拟激活的本轮文本', '');
        if (text === null) return;
        try {
            const result = await api('/stories/lore/decks/simulate', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({deck: state.draft, conversation_text: text})});
            byId('story-graph-inspector').innerHTML = `<h3>模拟激活</h3><p>命中 ${result.included.length} 条 · 排除 ${result.excluded.length} 条 · ${result.estimated_tokens}/${result.budget} Token</p><div class="story-graph-diagnostic-list">${result.included.map(item => `<article><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.reason)}</small></article>`).join('') || '<p>没有条目命中</p>'}</div><p class="form-hint">语义条目会在真实会话中使用本地向量精确评分；作者关系不参与激活。</p>`;
        } catch (error) { notify(error.message, 'error'); }
    }
    function refreshCommandState() {
        document.querySelectorAll('#page-story-graph-workbench [data-graph-command]').forEach(button => {
            const command = button.dataset.graphCommand;
            if (command === 'undo') button.disabled = !state.history.length || state.kind === 'timeline';
            if (command === 'redo') button.disabled = !state.future.length || state.kind === 'timeline';
            if (['add-node','add-edge','delete','save','publish','validate','source-view'].includes(command)) button.disabled = state.kind === 'timeline';
        });
    }
    function updateMinimap() {
        const canvas = byId('story-graph-minimap');
        if (!canvas || !state.network || !state.nodes) return;
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
        const positions = state.network.getPositions();
        const values = Object.values(positions);
        if (!values.length) return;
        const xs = values.map(item => item.x), ys = values.map(item => item.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        const scale = Math.min((canvas.width - 12) / Math.max(1, maxX - minX), (canvas.height - 12) / Math.max(1, maxY - minY));
        context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim() || '#73559e';
        values.forEach(point => context.fillRect(6 + (point.x - minX) * scale - 1.5, 6 + (point.y - minY) * scale - 1.5, 3, 3));
    }
    function timelineStorageKey() {
        return `storyGraphTimelineLayout:v1:${state.timeline.scopeType}:${state.timeline.scopeKey || 'global'}`;
    }
    function readTimelineLayout() {
        try { return JSON.parse(localStorage.getItem(timelineStorageKey()) || '{}'); }
        catch (_) { return {}; }
    }
    function saveTimelineLayout(positions) {
        const current = readTimelineLayout();
        Object.entries(positions || {}).forEach(([id, point]) => current[id] = {x: point.x, y: point.y});
        const live = new Set((state.timeline.data?.nodes || []).map(item => String(item.branch_id)));
        Object.keys(current).forEach(id => { if (!live.has(id)) delete current[id]; });
        localStorage.setItem(timelineStorageKey(), JSON.stringify(current));
    }
    async function loadTimeline() {
        const scopeType = byId('story-graph-timeline-scope').value;
        const scopeKey = scopeType === 'global' ? 'global' : byId('story-graph-timeline-key').value.trim();
        if (scopeType === 'conversation' && !/^(private|group):/.test(scopeKey)) return notify('请输入有效会话标识', 'error');
        state.timeline.scopeType = scopeType;
        state.timeline.scopeKey = scopeKey;
        state.timeline.data = await api(`/timeline/tree?scope_type=${encodeURIComponent(scopeType)}&scope_key=${encodeURIComponent(scopeKey)}&include_archived=true`);
        state.draft = null;
        setDirty(false);
        renderGraph();
    }
    async function refreshSourceList(preferred = '') {
        const select = byId('story-graph-source');
        if (!select) return;
        if (state.kind === 'timeline') {
            select.innerHTML = '<option value="timeline">当前时间线范围</option>';
            select.disabled = true;
            return;
        }
        select.disabled = false;
        const endpoint = state.kind === 'story' ? '/stories/templates?include_archived=true' : '/stories/lore/decks?include_archived=true';
        const result = await api(endpoint);
        const items = state.kind === 'story' ? result.templates || [] : result.decks || [];
        const idKey = state.kind === 'story' ? 'template_id' : 'deck_id';
        select.innerHTML = `<option value="">新建${state.kind === 'story' ? '故事框架' : ' Lore Deck'}</option>${items.map(item => `<option value="${escapeHtml(item[idKey])}">${escapeHtml(item.name)} · v${Number(item.version || 1)}</option>`).join('')}`;
        select.value = preferred && items.some(item => String(item[idKey]) === String(preferred)) ? preferred : '';
    }
    async function loadSource(sourceId, initialDraft = null) {
        state.sourceId = String(sourceId || '');
        let draft = initialDraft;
        if (!draft && sourceId) {
            draft = await api(state.kind === 'story' ? `/stories/templates/${encodeURIComponent(sourceId)}` : `/stories/lore/decks/${encodeURIComponent(sourceId)}`);
        }
        if (!draft) draft = state.kind === 'story'
            ? {name: '未命名剧情', scope: 'global', category: 'custom', mode: 'hybrid', status: 'draft', nodes: [], edges: [], acts: [], openings: [], editor_layout: {schema_version: 1, positions: {}, collapsed_groups: []}}
            : {name: '未命名 Lore Deck', description: '', scope: 'global', scope_ref: '', status: 'draft', settings: {token_budget: 2400}, entries: [], groups: [], relations: [], editor_layout: {schema_version: 1, positions: {}, collapsed_groups: []}};
        state.draft = clone(draft);
        state.original = clone(draft);
        state.history.length = 0;
        state.future.length = 0;
        setDirty(false);
        state.runtimeOverlay = null;
        if (state.kind === 'story' && state.draft.template_id) {
            try {
                const sessions = await api('/stories/sessions');
                const active = (sessions.sessions || []).find(item => String(item.template_id) === String(state.draft.template_id) && ['active','paused'].includes(item.status));
                if (active) state.runtimeOverlay = await api(`/stories/sessions/${encodeURIComponent(active.session_id)}/graph-overlay`);
            } catch (_) {}
        }
        renderGraph();
    }
    async function switchKind(kind, options = {}) {
        if (state.dirty && !confirm('当前图谱草稿尚未保存，确认切换？')) return;
        state.kind = ['story','lore','timeline'].includes(kind) ? kind : 'story';
        document.querySelectorAll('#page-story-graph-workbench [data-graph-kind]').forEach(button => button.classList.toggle('active', button.dataset.graphKind === state.kind));
        byId('story-graph-scope-tools').hidden = state.kind !== 'timeline';
        byId('story-graph-source').hidden = state.kind === 'timeline';
        await refreshSourceList(options.sourceId || '');
        if (state.kind === 'timeline') {
            if (options.scopeType) byId('story-graph-timeline-scope').value = options.scopeType;
            if (options.scopeKey) byId('story-graph-timeline-key').value = options.scopeKey;
            if (options.scopeKey || options.scopeType === 'global') await loadTimeline();
            else { state.timeline.data = {nodes: [], edges: []}; renderGraph(); }
        } else {
            const editorDraft = options.draft || captureEditorDraft(state.kind);
            const sourceId = options.sourceId || editorDraft?.template_id || editorDraft?.deck_id || '';
            byId('story-graph-source').value = sourceId;
            await loadSource(sourceId, editorDraft);
        }
        refreshCommandState();
    }
    function command(name) {
        if (name === 'undo') return undo();
        if (name === 'redo') return redo();
        if (name === 'add-node') return addNode(state.network?.getViewPosition?.() || {x: 0, y: 0});
        if (name === 'add-edge') return addEdge();
        if (name === 'delete') return deleteSelection();
        if (name === 'focus') return state.selectedNodes[0] && state.network?.focus(state.selectedNodes[0], {scale: 1.2, animation: true});
        if (name === 'fit') return state.network?.fit({animation: true});
        if (name === 'reset-layout') {
            if (state.kind === 'timeline') localStorage.removeItem(timelineStorageKey());
            else { pushHistory(); state.draft.editor_layout = {schema_version: 1, positions: {}, collapsed_groups: []}; }
            return renderGraph();
        }
        if (name === 'export-png') {
            const canvas = byId('story-graph-canvas')?.querySelector('canvas');
            if (!canvas) return;
            const link = document.createElement('a');
            link.download = `zoot-${state.kind}-graph.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            return;
        }
        if (name === 'validate') return validateDraft();
        if (name === 'save') return saveDraft('draft');
        if (name === 'publish') return saveDraft('published');
        if (name === 'source-view') {
            writeEditorDraft(state.kind, state.draft);
            setDirty(false);
            return global.showPage?.(state.kind === 'story' ? 'story-editor' : 'lore-editor');
        }
        if (name === 'load-timeline') return loadTimeline();
        if (name === 'collapse-outline') return byId('page-story-graph-workbench').classList.toggle('outline-collapsed');
    }
    function bind() {
        if (state.bound) return;
        const page = byId('page-story-graph-workbench');
        if (!page) return;
        state.bound = true;
        page.querySelectorAll('[data-graph-kind]').forEach(button => button.addEventListener('click', () => switchKind(button.dataset.graphKind)));
        page.querySelectorAll('[data-graph-command]').forEach(button => button.addEventListener('click', () => command(button.dataset.graphCommand)));
        byId('story-graph-source').addEventListener('change', event => loadSource(event.target.value));
        byId('story-graph-search').addEventListener('input', event => {
            const query = event.target.value.trim().toLocaleLowerCase();
            if (!query || !state.nodes) return;
            const match = state.nodes.get().find(item => String(item.label || '').toLocaleLowerCase().includes(query));
            if (match) { state.network.selectNodes([match.id]); state.network.focus(match.id, {scale: 1.2, animation: true}); state.selectedNodes = [String(match.id)]; renderInspector(); }
        });
        byId('story-graph-current-path-only').addEventListener('change', event => {
            if (state.kind !== 'timeline' || !state.nodes) return;
            const allowed = new Set((state.timeline.data?.nodes || []).filter(item => !event.target.checked || item.is_current_path).map(item => String(item.branch_id)));
            state.nodes.update(state.nodes.get().map(item => ({id: item.id, hidden: !allowed.has(String(item.id))})));
        });
        byId('story-open-graph-workbench')?.addEventListener('click', () => global.openStoryGraphWorkbench('story', {draft: captureEditorDraft('story')}));
        byId('lore-open-graph-workbench')?.addEventListener('click', () => global.openStoryGraphWorkbench('lore', {draft: captureEditorDraft('lore')}));
        byId('timeline-open-graph-workbench')?.addEventListener('click', () => {
            const timelinePage = byId('page-timeline-tree');
            global.openStoryGraphWorkbench('timeline', {
                scopeType: timelinePage?.dataset.scopeType || 'conversation',
                scopeKey: timelinePage?.dataset.scopeKey || ''
            });
        });
        page.querySelector('.back-btn').addEventListener('click', event => {
            if (state.dirty && !confirm('图谱草稿尚未保存，确认离开？')) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        }, true);
        global.addEventListener('beforeunload', event => {
            if (!state.dirty) return;
            event.preventDefault();
            event.returnValue = '';
        });
        document.addEventListener('keydown', event => {
            if (!state.active) return;
            const modifier = event.ctrlKey || event.metaKey;
            if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
            if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
            const editableTarget = event.target.closest?.('input,textarea,select,button,[contenteditable="true"]');
            if (!editableTarget && modifier && event.key.toLowerCase() === 'c') state.clipboard = state.selectedNodes.map(id => clone(state.nodes?.get(id)?._source)).filter(Boolean);
            if (!editableTarget && modifier && event.key.toLowerCase() === 'v' && state.clipboard.length && state.kind !== 'timeline') { event.preventDefault(); pasteClipboard(); }
            if (!editableTarget && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); deleteSelection(); }
        });
    }
    async function activate(options = {}) {
        bind();
        state.active = true;
        state.scope = global.ZootRuntime?.createScope?.('story-graph-workbench') || null;
        try { await switchKind(options.kind || state.kind, options); }
        catch (error) { notify(error.message, 'error'); }
    }
    function deactivate() {
        if (state.dirty && state.kind !== 'timeline' && state.draft) writeEditorDraft(state.kind, state.draft);
        setDirty(false);
        state.active = false;
        state.network?.destroy();
        state.network = null;
        state.nodes = null;
        state.edges = null;
        global.ZootRuntime?.disposeScope?.('story-graph-workbench');
    }
    global.openStoryGraphWorkbench = async function openStoryGraphWorkbench(kind = 'story', options = {}) {
        if (state.active) return switchKind(kind, options);
        global.__storyGraphOpenOptions = {kind, ...options};
        await global.showPage?.(PAGE_ID);
    };
    document.addEventListener('pageShown', event => {
        const pageId = event.detail?.pageId || event.detail?.page;
        if (pageId === PAGE_ID) {
            const options = global.__storyGraphOpenOptions || {kind: state.kind};
            global.__storyGraphOpenOptions = null;
            activate(options);
        } else if (state.active) deactivate();
    });
    document.addEventListener('DOMContentLoaded', bind, {once: true});
})(window);
