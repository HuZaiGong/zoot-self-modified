(() => {
    'use strict';

    const state = {
        profiles: [],
        templates: [],
        filter: 'active',
        editingProfileId: '',
        groupPermissions: new Map(),
        groups: [],
        loading: false
    };

    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[character]));

    async function request(path, options = {}) {
        const response = await fetch(path, {
            ...options,
            headers: options.body instanceof FormData
                ? {...(options.headers || {})}
                : {'Content-Type': 'application/json', ...(options.headers || {})}
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = payload.detail;
            throw new Error(detail?.message || detail?.code || detail || payload.message || `请求失败（${response.status}）`);
        }
        return payload;
    }

    function notify(message, type = 'info') {
        if (typeof showTemporaryToast === 'function') {
            showTemporaryToast(message, 3200, type);
        } else if (typeof showToast === 'function') {
            showToast(message, 3200, type);
        }
        setStatus(message);
    }

    function setStatus(message) {
        const node = document.getElementById('doctor-ai-status');
        if (node) node.textContent = message || '';
    }

    function currentPersonaId() {
        return String(window.currentPersonaId || 'doctor');
    }

    function profileById(profileId) {
        return state.profiles.find(profile => String(profile.profile_id) === String(profileId)) || null;
    }

    function templateDescription(value) {
        if (value.actor_kind === 'administrator_ai') {
            return `${value.display_label || value.presentation_gender || '管理员形态'} · 塔卫二世界`;
        }
        return `${value.gender || '博士模板'} · ${value.voice || '内置只读模板'}`;
    }

    function renderProfiles() {
        const root = document.getElementById('doctor-ai-profiles');
        if (!root) return;
        const profiles = state.profiles.filter(profile => (
            state.filter === 'archived' ? profile.status === 'archived' : profile.status !== 'archived'
        ));
        const profileCards = profiles.map(profile => {
            const profileData = profile.profile || {};
            const label = profile.actor_kind === 'administrator_ai' ? 'AI管理员' : 'AI博士';
            const world = profile.game_namespace === 'endfield' ? '塔卫二' : '明日方舟';
            const archived = profile.status === 'archived';
            const avatar = profile.avatar_url
                ? `<img src="${escapeHtml(profile.avatar_url)}" alt="" onerror="this.hidden=true">`
                : '<span data-zoot-icon="persona" aria-hidden="true"></span>';
            return `<article class="doctor-ai-instance-card" data-doctor-profile-card="${escapeHtml(profile.profile_id)}">
                <div class="doctor-ai-instance-heading">
                    <div class="doctor-ai-instance-avatar">${avatar}</div>
                    <div>
                        <span class="doctor-ai-instance-badge">${escapeHtml(label)}</span>
                        <h3>${escapeHtml(profile.display_name)}</h3>
                        <p>${escapeHtml(world)} · ${escapeHtml(profile.source_type)} · 修订 ${Number(profile.revision || 1)}</p>
                    </div>
                </div>
                <p class="doctor-ai-instance-summary">${escapeHtml(profileData.voice || profileData.inferred_profile?.language_style || '使用独立人格、会话和记忆命名空间。')}</p>
                <div class="doctor-ai-instance-stats">
                    <span>私聊 ${Number(profile.conversation_count || 0)}</span>
                    <span>群授权 ${Number(profile.group_participation_count || 0)}</span>
                    <span>${archived ? '历史只读' : '运行中'}</span>
                </div>
                <div class="doctor-ai-instance-actions">
                    <button type="button" data-doctor-action="chat" ${archived ? 'disabled' : ''}>打开聊天</button>
                    <button type="button" data-doctor-action="edit">实例设置</button>
                    <button type="button" data-doctor-action="memory">记忆诊断</button>
                    <button type="button" data-doctor-action="${archived ? 'restore' : 'archive'}">${archived ? '恢复' : '归档'}</button>
                </div>
            </article>`;
        }).join('');
        const templates = state.templates.map(template => `<article class="doctor-ai-template">
            <div>
                <strong>${escapeHtml(template.display_name)}</strong>
                <small>${escapeHtml(template.description)}</small>
            </div>
            <button type="button" data-doctor-template="${escapeHtml(template.template_id)}">克隆实例</button>
        </article>`).join('');
        root.innerHTML = `<section class="doctor-ai-instance-list">
            ${profileCards || '<div class="doctor-ai-empty">此分类下尚无实例</div>'}
        </section>
        <details class="doctor-ai-template-drawer">
            <summary>从只读模板创建实例</summary>
            <div class="doctor-ai-template-list">${templates}</div>
        </details>`;
        root.querySelectorAll('[data-doctor-profile-card]').forEach(card => {
            card.querySelectorAll('[data-doctor-action]').forEach(button => {
                button.addEventListener('click', () => handleProfileAction(
                    card.dataset.doctorProfileCard,
                    button.dataset.doctorAction
                ));
            });
        });
        root.querySelectorAll('[data-doctor-template]').forEach(button => {
            button.addEventListener('click', () => createProfile(button.dataset.doctorTemplate));
        });
        window.ZootIcons?.hydrateTree?.(root);
    }

    async function load() {
        if (state.loading) return;
        state.loading = true;
        setStatus('正在读取 AI 实例');
        try {
            const [templates, profiles] = await Promise.all([
                request('/doctor-agents/templates'),
                request('/doctor-agents/profiles')
            ]);
            state.templates = Object.entries(templates.templates || {}).map(([templateId, value]) => ({
                template_id: templateId,
                display_name: value.display_label || value.name || templateId,
                description: templateDescription(value)
            }));
            try {
                const personas = await request('/personas/list');
                const doctorPersona = (personas.personas || personas || []).find(item => String(item.persona_id) === 'doctor');
                if (doctorPersona) {
                    state.templates.push({
                        template_id: 'persona_snapshot:doctor',
                        display_name: '当前博士档案快照',
                        description: '创建时复制；以后由用户手动同步'
                    });
                }
            } catch (error) {
                console.debug('[AI博士] 用户博士快照暂不可用', error);
            }
            state.profiles = profiles.profiles || [];
            state.profiles.forEach(profile => window.registerChatTargetIdentity?.({
                id: profile.actor_id,
                target_id: profile.actor_id,
                actor_id: profile.actor_id,
                actor_kind: profile.actor_kind,
                role_type: 'doctor_agent',
                profile_id: profile.profile_id,
                display_name: profile.display_name,
                name: profile.display_name,
                game_namespace: profile.game_namespace,
                avatar_ref: profile.avatar_ref || '',
                avatar_url: profile.avatar_url || '',
                instance_status: profile.status,
                ai_label: profile.actor_kind === 'administrator_ai' ? 'AI管理员' : 'AI博士'
            }));
            renderProfiles();
            setStatus('');
        } catch (error) {
            setStatus(error.message);
        } finally {
            state.loading = false;
        }
    }

    async function createProfile(templateId) {
        setStatus('正在创建独立 AI 实例');
        try {
            const result = await request('/doctor-agents/profiles', {
                method: 'POST',
                body: JSON.stringify({source_type: templateId})
            });
            state.profiles.unshift(result);
            renderProfiles();
            await openEditor(result.profile_id);
            notify('实例已创建，请确认名称、外观与权限', 'success');
        } catch (error) {
            notify(error.message, 'error');
        }
    }

    async function openNormalChat(profileId) {
        if (currentPersonaId() === 'doctor') {
            notify('请先切换到非博士人格，再与 AI 博士或 AI 管理员建立私聊', 'warning');
            return;
        }
        setStatus('正在建立独立人格会话');
        try {
            const result = await request(`/doctor-agents/profiles/${encodeURIComponent(profileId)}/open-chat`, {
                method: 'POST',
                body: JSON.stringify({persona_id: currentPersonaId()})
            });
            const identity = {
                ...(result.identity || {}),
                name: result.identity?.display_name || 'AI 博士'
            };
            window.registerChatTargetIdentity?.(identity);
            if (typeof window.openChat !== 'function') throw new Error('普通聊天页尚未就绪');
            window.openChat('private', identity.target_id, identity);
            setStatus('');
        } catch (error) {
            notify(error.message, 'error');
        }
    }

    async function loadEditorGroups(profileId) {
        const root = document.getElementById('doctor-ai-group-permissions');
        if (!root) return;
        root.innerHTML = '<p>正在读取群聊权限…</p>';
        try {
            const [chatItems, permissions] = await Promise.all([
                request(`/chats?persona_id=${encodeURIComponent(currentPersonaId())}`),
                request(`/doctor-agents/profiles/${encodeURIComponent(profileId)}/group-participation`)
            ]);
            state.groups = (chatItems || []).filter(item => item.type === 'group');
            state.groupPermissions = new Map(
                (permissions.participation || []).map(item => [String(item.scope_id), Boolean(item.allowed)])
            );
            root.innerHTML = state.groups.map(group => `<label class="doctor-ai-group-permission">
                <span><strong>${escapeHtml(group.name || group.id)}</strong><small>${escapeHtml(group.id)}</small></span>
                <input type="checkbox" data-doctor-group="${escapeHtml(group.id)}" ${state.groupPermissions.get(String(group.id)) ? 'checked' : ''}>
            </label>`).join('') || '<p>尚无可授权的群聊。</p>';
        } catch (error) {
            root.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
        }
    }

    async function openEditor(profileId) {
        const profile = profileById(profileId);
        const form = document.getElementById('doctor-ai-editor');
        if (!profile || !form) return;
        state.editingProfileId = String(profileId);
        const data = profile.profile || {};
        form.elements.profile_id.value = profile.profile_id;
        form.elements.display_name.value = profile.display_name || '';
        form.elements.title.value = data.title || '';
        form.elements.appearance.value = data.appearance || '';
        form.elements.voice.value = data.voice || '';
        form.elements.background.value = data.background || '';
        form.elements.wardrobe.value = typeof data.wardrobe === 'string'
            ? data.wardrobe
            : JSON.stringify(data.wardrobe || '', null, 2).replace(/^""$/, '');
        form.elements.avatar_file.value = '';
        const status = document.getElementById('doctor-ai-editor-status');
        if (status) status.textContent = `${profile.actor_kind === 'administrator_ai' ? 'AI管理员' : 'AI博士'} · ${profile.game_namespace === 'endfield' ? '塔卫二' : '明日方舟'} · 世界类型不可编辑`;
        showPage('doctor-ai-editor');
        await loadEditorGroups(profile.profile_id);
    }

    async function saveEditor(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const profile = profileById(form.elements.profile_id.value);
        if (!profile) return;
        const submit = form.querySelector('button[type="submit"]');
        if (submit) submit.disabled = true;
        const editorStatus = document.getElementById('doctor-ai-editor-status');
        if (editorStatus) editorStatus.textContent = '正在保存并权威回读…';
        try {
            let avatarRef = profile.avatar_ref || '';
            const file = form.elements.avatar_file.files?.[0];
            if (file) {
                if (typeof CUSTOM_IMAGE_API === 'undefined') throw new Error('图片服务尚未就绪');
                const uploaded = await CUSTOM_IMAGE_API.upload('doctor_agent_avatar', file, profile.profile_id);
                avatarRef = uploaded.data?.image_uid || uploaded.data?.uid || '';
                if (!avatarRef) throw new Error('头像上传成功，但未返回稳定图片引用');
            }
            const changes = {
                display_name: form.elements.display_name.value.trim(),
                name: form.elements.display_name.value.trim(),
                title: form.elements.title.value.trim(),
                appearance: form.elements.appearance.value.trim(),
                voice: form.elements.voice.value.trim(),
                background: form.elements.background.value.trim(),
                wardrobe: form.elements.wardrobe.value.trim(),
                avatar_ref: avatarRef
            };
            const updated = await request(`/doctor-agents/profiles/${encodeURIComponent(profile.profile_id)}`, {
                method: 'PATCH',
                body: JSON.stringify({changes, expected_revision: profile.revision})
            });
            for (const checkbox of form.querySelectorAll('[data-doctor-group]')) {
                const groupId = checkbox.dataset.doctorGroup;
                const prior = Boolean(state.groupPermissions.get(String(groupId)));
                if (prior === checkbox.checked) continue;
                await request(`/doctor-agents/profiles/${encodeURIComponent(profile.profile_id)}/group-participation`, {
                    method: 'PUT',
                    body: JSON.stringify({scope_type: 'group', scope_id: groupId, allowed: checkbox.checked})
                });
            }
            const index = state.profiles.findIndex(item => item.profile_id === profile.profile_id);
            if (index >= 0) state.profiles[index] = updated;
            await load();
            showPage('doctor-ai');
            notify('AI 实例设置已保存', 'success');
        } catch (error) {
            if (editorStatus) editorStatus.textContent = error.message;
            notify(error.message, 'error');
        } finally {
            if (submit) submit.disabled = false;
        }
    }

    async function showMemoryDiagnostics(profileId) {
        try {
            const data = await request(`/doctor-agents/profiles/${encodeURIComponent(profileId)}/memory-diagnostics`);
            notify(`独立会话 ${Number(data.conversation_count || 0)} 个；私聊按实例×人格×会话隔离，群聊按实例×群组隔离`, 'info');
        } catch (error) {
            notify(error.message, 'error');
        }
    }

    function archiveProfile(profileId) {
        const profile = profileById(profileId);
        if (!profile) return;
        const run = async () => {
            try {
                await request(`/doctor-agents/profiles/${encodeURIComponent(profileId)}/archive`, {method: 'POST'});
                await load();
                notify('实例已归档，历史聊天保持只读', 'success');
            } catch (error) {
                notify(error.message, 'error');
            }
        };
        if (typeof showConfirmDialog === 'function') {
            showConfirmDialog('归档 AI 实例', `归档“${profile.display_name}”后将停止回复，但不会删除聊天、时间线或记忆。`, run);
        } else {
            run();
        }
    }

    async function restoreProfile(profileId) {
        try {
            await request(`/doctor-agents/profiles/${encodeURIComponent(profileId)}/restore`, {method: 'POST'});
            await load();
            notify('实例已恢复，可以继续原会话', 'success');
        } catch (error) {
            notify(error.message, 'error');
        }
    }

    function handleProfileAction(profileId, action) {
        if (action === 'chat') return openNormalChat(profileId);
        if (action === 'edit') return openEditor(profileId);
        if (action === 'memory') return showMemoryDiagnostics(profileId);
        if (action === 'archive') return archiveProfile(profileId);
        if (action === 'restore') return restoreProfile(profileId);
        return null;
    }

    function bind() {
        document.getElementById('doctor-ai-create')?.addEventListener('click', () => {
            document.querySelector('#doctor-ai-profiles .doctor-ai-template-drawer')?.setAttribute('open', '');
            document.querySelector('#doctor-ai-profiles .doctor-ai-template-drawer')?.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
        });
        document.querySelectorAll('[data-doctor-filter]').forEach(button => {
            button.addEventListener('click', () => {
                state.filter = button.dataset.doctorFilter || 'active';
                document.querySelectorAll('[data-doctor-filter]').forEach(item => {
                    item.classList.toggle('active', item === button);
                });
                renderProfiles();
            });
        });
        document.getElementById('doctor-ai-editor')?.addEventListener('submit', saveEditor);
        document.querySelector('[data-doctor-editor-cancel]')?.addEventListener('click', () => showPage('doctor-ai'));
    }

    document.addEventListener('DOMContentLoaded', bind);
    document.addEventListener('pageShown', event => {
        const pageId = event.detail?.pageId || event.detail?.page;
        if (pageId === 'doctor-ai') load();
    });
    window.loadDoctorAi = load;
    window.openDoctorAgentEditor = async profileId => {
        if (!profileById(profileId)) await load();
        return openEditor(profileId);
    };
})();
