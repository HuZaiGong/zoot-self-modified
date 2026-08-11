(function fieldReportsModule() {
    'use strict';

    const state = { reports: [], current: null };
    const byId = id => document.getElementById(id);
    const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    const notify = (message, type = 'info') => typeof showTemporaryToast === 'function' && showTemporaryToast(message, 2600, type);
    const storyboardStateLabel = value => ({ready: '已采用', candidates: '已有候选', blocked: '资料待补充', empty: '可规划'}[value] || value || '可规划');

    async function api(url, options = {}) {
        const response = await fetch(url, options);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.detail?.message || payload?.detail || payload?.message || `请求失败 (${response.status})`);
        return payload;
    }

    function renderList() {
        const host = byId('field-reports-list');
        if (!host) return;
        host.innerHTML = state.reports.map(report => `<button type="button" class="field-report-list-item${state.current?.report_id === report.report_id ? ' active' : ''}" data-field-report-id="${escapeHtml(report.report_id)}"><strong>${escapeHtml(report.title || '外勤报告')}</strong><span>任务 ${escapeHtml(report.mission_number || report.task_id)} · ${escapeHtml(report.status || 'draft')}</span></button>`).join('') || '<div class="empty-state">暂无已生成报告；完成外勤后会自动建立草稿。</div>';
    }

    function renderDetail(report) {
        const host = byId('field-report-detail');
        if (!host) return;
        const slots = Array.isArray(report.storyboards) && report.storyboards.length ? report.storyboards : (Array.isArray(report.images) ? report.images : []);
        const subjects = Array.isArray(report.encounter_subjects) ? report.encounter_subjects : [];
        const details = Array.isArray(report.participant_details) ? report.participant_details : [];
        host.innerHTML = `<section class="field-report-heading"><div><small>${escapeHtml(report.classification || '内部资料')}</small><h3>${escapeHtml(report.title || '外勤报告')}</h3><p>任务编号 ${escapeHtml(report.mission_number || report.task_id)}</p></div><div class="field-report-actions"><button type="button" data-field-report-export="png">导出 PNG</button><button type="button" data-field-report-export="pdf">打印 / PDF</button><button type="button" data-field-report-preview="${escapeHtml(report.report_id)}">预览排版</button></div></section>
            <section class="field-report-summary"><h4>任务摘要</h4><p>${escapeHtml(report.summary || '暂无摘要')}</p><h4>行动结果</h4><p>${escapeHtml(report.result || '等待复核')}</p><p class="field-report-team">${escapeHtml(details.map(item => `${item.is_leader ? '队长 ' : ''}${item.operator_id} · ${item.duty_label || item.duty}`).join('　') || '未记录参与干员')}</p></section>
            ${subjects.length ? `<section class="field-report-subjects"><h4>途中人物资料</h4>${subjects.map(subject => `<article class="field-report-subject" data-field-report-subject="${escapeHtml(subject.subject_id)}" data-revision="${Number(subject.revision || 1)}"><label>名称<input data-subject-field="display_name" value="${escapeHtml(subject.display_name || '')}"></label><label>身份与关系<input data-subject-field="relationship" value="${escapeHtml(subject.relationship || '')}"></label><label>外貌<textarea data-subject-field="appearance">${escapeHtml(subject.appearance || '')}</textarea></label><label>衣着<textarea data-subject-field="clothing">${escapeHtml(subject.clothing || '')}</textarea></label><label class="field-report-subject-appear"><input type="checkbox" data-subject-field="can_appear" ${subject.can_appear ? 'checked' : ''}>允许入镜</label><button type="button" data-field-report-save-subject="${escapeHtml(subject.subject_id)}">保存人物资料</button><small>${subject.visual_ready ? '资料完整，可在有证据的故事板中入镜' : '需补齐名称、外貌、衣着和证据后才能入镜'}</small></article>`).join('')}</section>` : ''}
            <section class="field-report-slots"><h4>任务影像故事板</h4>${slots.map(slot => { const board = slot.storyboard || {}; const candidates = Array.isArray(slot.candidate_asset_ids) ? slot.candidate_asset_ids : []; const blockers = Array.isArray(board.blocking_reasons) ? board.blocking_reasons : []; return `<article class="field-report-slot ${blockers.length ? 'is-blocked' : ''}"><div><strong>${escapeHtml(board.title || slot.caption || slot.slot_name)}</strong><span>${escapeHtml(storyboardStateLabel(slot.state))}</span></div><p>${escapeHtml(board.action || '')}</p><small>入镜：${escapeHtml([...(board.participant_ids || []), ...(board.subject_ids || [])].join('、') || '无')}</small>${(board.participant_ids || []).length > 1 ? `<div class="field-report-split-group"><span>本次规划的干员：</span>${board.participant_ids.map(operatorId => `<label><input type="checkbox" data-storyboard-participant="${escapeHtml(operatorId)}" checked>${escapeHtml(operatorId)}</label>`).join('')}<small>${board.participant_ids.length > 6 ? 'V4.5最多控制6人；请分组生成并分别采用。' : '可按需要生成分组合照。'}</small></div>` : ''}${blockers.map(value => `<div class="field-report-blocker">${escapeHtml(value)}</div>`).join('')}<div class="field-report-candidates">${candidates.map(assetId => `<button type="button" data-field-report-adopt="${escapeHtml(assetId)}" data-slot-name="${escapeHtml(slot.slot_name)}" data-slot-revision="${Number(slot.revision || 1)}"><span data-gallery-preview="${escapeHtml(assetId)}"></span>采用候选</button>`).join('')}</div><button type="button" data-field-report-image="${escapeHtml(slot.slot_name)}" ${blockers.length ? 'disabled' : ''}>${candidates.length ? '继续生成变体' : '准备生图'}</button></article>`; }).join('')}</section>`;
        hydrateCandidatePreviews();
    }

    async function hydrateCandidatePreviews() {
        await Promise.all([...document.querySelectorAll('[data-gallery-preview]')].map(async node => {
            try {
                const payload = await api(`/image-workspace/gallery/${encodeURIComponent(node.dataset.galleryPreview)}`);
                const asset = payload.asset || {};
                if (asset.thumbnail_url || asset.content_url) node.innerHTML = `<img src="${escapeHtml(asset.thumbnail_url || asset.content_url)}" alt="候选图片">`;
            } catch (_) { node.textContent = '候选图'; }
        }));
    }

    async function selectReport(id) {
        state.current = await api(`/field-reports/${encodeURIComponent(String(id))}`);
        renderList();
        renderDetail(state.current);
    }

    async function loadReports(id = '') {
        const payload = await api('/field-reports?limit=50');
        state.reports = Array.isArray(payload.items) ? payload.items : [];
        renderList();
        const target = id || state.current?.report_id || state.reports[0]?.report_id;
        if (target) await selectReport(target);
    }

    async function createForTask(taskId, templateId = 'prts_formal') {
        const report = await api('/field-reports', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({task_id: String(taskId), template_id: templateId})});
        showPage('field-reports');
        await loadReports(report.report_id);
        notify('外勤报告已就绪', 'success');
    }

    async function saveSubject(button) {
        const card = button.closest('[data-field-report-subject]');
        const field = name => card?.querySelector(`[data-subject-field="${name}"]`);
        if (!card || !state.current) return;
        state.current = await api(`/field-reports/${encodeURIComponent(state.current.report_id)}/subjects/${encodeURIComponent(card.dataset.fieldReportSubject)}`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({expected_revision: Number(card.dataset.revision || 1), patch: {display_name: field('display_name')?.value || '', relationship: field('relationship')?.value || '', appearance: field('appearance')?.value || '', clothing: field('clothing')?.value || '', can_appear: Boolean(field('can_appear')?.checked)}})});
        renderDetail(state.current);
        notify('途中人物资料已保存', 'success');
    }

    async function adoptCandidate(button) {
        if (!state.current) return;
        state.current = await api(`/field-reports/${encodeURIComponent(state.current.report_id)}/images/${encodeURIComponent(button.dataset.slotName)}/adopt`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({expected_revision: Number(button.dataset.slotRevision || 1), gallery_asset_id: button.dataset.fieldReportAdopt})});
        renderDetail(state.current);
        notify('已采用到外勤报告', 'success');
    }

    async function exportReport(format) {
        if (!state.current) return;
        const url = `/field-reports/${encodeURIComponent(state.current.report_id)}/render`;
        if (format === 'pdf') { const popup = window.open(url, '_blank', 'noopener'); notify(popup ? '已打开打印视图，可选择另存为 PDF' : '无法打开打印视图', popup ? 'success' : 'error'); return; }
        if (typeof html2canvas !== 'function') throw new Error('本地截图组件暂不可用');
        const host = document.createElement('div'); host.className = 'field-report-capture'; host.innerHTML = await fetch(url).then(response => response.text()); document.body.appendChild(host);
        try { const canvas = await html2canvas(host, {backgroundColor: '#ffffff', scale: 2}); const link = document.createElement('a'); link.download = `${state.current.title || 'field-report'}.png`; link.href = canvas.toDataURL('image/png'); link.click(); } finally { host.remove(); }
    }

    document.addEventListener('click', event => {
        const item = event.target.closest('[data-field-report-id]');
        const preview = event.target.closest('[data-field-report-preview]');
        const image = event.target.closest('[data-field-report-image]');
        const exportButton = event.target.closest('[data-field-report-export]');
        const saveButton = event.target.closest('[data-field-report-save-subject]');
        const adoptButton = event.target.closest('[data-field-report-adopt]');
        if (item) selectReport(item.dataset.fieldReportId).catch(error => notify(error.message, 'error'));
        if (preview) window.open(`/field-reports/${encodeURIComponent(preview.dataset.fieldReportPreview)}/render`, '_blank', 'noopener');
        if (exportButton) exportReport(exportButton.dataset.fieldReportExport).catch(error => notify(error.message, 'error'));
        if (saveButton) saveSubject(saveButton).catch(error => notify(error.message, 'error'));
        if (adoptButton) adoptCandidate(adoptButton).catch(error => notify(error.message, 'error'));
        if (image && state.current && typeof window.openImageWorkspace === 'function') {
            const card = image.closest('.field-report-slot');
            const participantIds = [...(card?.querySelectorAll('[data-storyboard-participant]:checked') || [])].map(input => input.dataset.storyboardParticipant);
            if (card?.querySelector('[data-storyboard-participant]') && !participantIds.length) { notify('至少选择一名参与干员', 'error'); return; }
            window.openImageWorkspace({sourceType: 'field_report', sourceId: String(state.current.report_id), intent: 'field_record', contextOptions: {slot_name: image.dataset.fieldReportImage, participant_ids: participantIds}, autoPreview: true, destination: {type: 'field_report_slot', report_id: state.current.report_id, slot_name: image.dataset.fieldReportImage}});
        }
    });
    byId('field-reports-refresh')?.addEventListener('click', () => loadReports().catch(error => notify(error.message, 'error')));
    document.addEventListener('pageShown', event => { if (event.detail?.pageId === 'field-reports') loadReports().catch(error => notify(error.message, 'error')); });
    window.openFieldReportForTask = (taskId, templateId) => createForTask(taskId, templateId).catch(error => notify(error.message, 'error'));
})();
