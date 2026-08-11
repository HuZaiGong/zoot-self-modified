(function () {
    'use strict';

    const MAX_PENDING_ATTACHMENTS = 8;
    const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
    const FILE_ACCEPT = '.txt,.md,.json,.xml,.html,.csv,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.rtf,.zip';
    const AUDIO_ACCEPT = 'audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg,.mp3,.m4a,.wav,.webm,.ogg';
    const MAX_RECORDING_MS = 60 * 1000;
    const MIN_RECORDING_MS = 650;
    const RECORD_CANCEL_DISTANCE = 72;
    const JOB_POLL_INTERVAL_MS = 700;
    const JOB_TIMEOUT_MS = 180000;
    const state = {
        pending: [],
        uploading: 0,
        capabilitiesLoaded: null,
        toolMode: false,
        recorderMode: false,
        recorderPreparing: false,
        mediaStream: null,
        mediaRecorder: null,
        recorderChunks: [],
        recorderStartedAt: 0,
        recorderTimer: null,
        recorderPointerId: null,
        recorderStartY: 0,
        recorderCancelArmed: false,
        discardRecording: false,
        capabilities: {
            max_upload_bytes: DEFAULT_MAX_BYTES,
            upload_kinds: ['image', 'file', 'audio'],
            processing: { vision: false, transcription: false },
            image_generation: false,
            routes: {}
        }
    };

    const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));

    function formatBytes(value) {
        const bytes = Number(value || 0);
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1048576).toFixed(1)} MB`;
    }

    function notify(message, type = 'info') {
        if (typeof window.showTemporaryToast === 'function') {
            window.showTemporaryToast(message, 2200, type);
        } else {
            console.warn(`[chat-media] ${message}`);
        }
    }

    function currentPersonaId() {
        return String(window.currentPersonaId || 'doctor');
    }

    function getElements() {
        return {
            area: document.getElementById('input-area'),
            row: document.querySelector('#input-area .input-row'),
            input: document.getElementById('message'),
            inputButtons: document.querySelector('#input-area .input-buttons'),
            emojiButton: document.getElementById('emoji-btn'),
            dynamicButton: document.getElementById('dynamic-btn'),
            tools: document.getElementById('chat-media-tools')
        };
    }

    function getTray() {
        let tray = document.getElementById('chat-attachment-tray');
        if (tray) return tray;
        const area = document.getElementById('input-area');
        if (!area) return null;
        tray = document.createElement('div');
        tray.id = 'chat-attachment-tray';
        tray.className = 'chat-attachment-tray';
        tray.setAttribute('aria-live', 'polite');
        const anchor = area.querySelector('.input-row');
        area.insertBefore(tray, anchor || area.firstChild);
        return tray;
    }

    function hasAnySelection() {
        return state.pending.length > 0;
    }

    function hasReadySelection() {
        return state.pending.some(item => item.status === 'ready');
    }

    function getBlockReason() {
        if (state.recorderMode) return '请先完成或关闭录音';
        if (state.uploading > 0 || state.pending.some(item => item.status === 'processing')) return '附件仍在上传或解析，请稍候';
        if (state.pending.some(item => item.status === 'failed')) return '存在上传或解析失败的附件，请重试或移除';
        if (state.pending.some(item => String(item.owner_persona_id || 'doctor') !== currentPersonaId())) {
            return '附件属于另一个人格，请切回原人格或移除附件';
        }
        return '';
    }

    function syncScenarioLock() {
        const locked = hasAnySelection() || state.recorderMode;
        const sceneButton = document.querySelector('#scenario-toggle-group .toggle-option.scene');
        const group = document.getElementById('scenario-toggle-group');
        if (sceneButton) {
            sceneButton.disabled = locked;
            sceneButton.setAttribute('aria-disabled', locked ? 'true' : 'false');
            sceneButton.title = locked ? '发送或移除附件后才可切换到情景发言' : '';
        }
        group?.classList.toggle('attachment-locked', locked);
    }

    function notifyStateChanged() {
        syncScenarioLock();
        if (typeof window.updateDynamicButton === 'function') window.updateDynamicButton();
        if (typeof window.updateSendButtons === 'function') window.updateSendButtons();
    }

    function setToolMode(open, options = {}) {
        const elements = getElements();
        if (!elements.row || !elements.input || !elements.inputButtons || !elements.tools) return false;

        if (open) {
            const isScene = localStorage.getItem('scenarioMode') === 'true'
                && localStorage.getItem('scenarioRole') === 'scene';
            if (isScene || elements.input.value.trim() || hasAnySelection()) return false;
            document.getElementById('emoji-picker')?.classList.add('hidden');
        }

        state.toolMode = Boolean(open);
        elements.row.classList.toggle('media-tools-open', state.toolMode);
        elements.input.classList.toggle('media-tools-hidden', state.toolMode);
        elements.inputButtons.classList.toggle('media-tools-hidden', state.toolMode);
        elements.tools.classList.toggle('hidden', !state.toolMode);
        elements.dynamicButton?.setAttribute('aria-expanded', state.toolMode ? 'true' : 'false');

        if (!state.toolMode && options.focusInput) {
            window.setTimeout(() => elements.input?.focus(), 60);
        }
        return true;
    }

    function attachmentIcon(item) {
        if (item.kind === 'audio') return ZootIcons.html('audio');
        return ZootIcons.html(item.kind === 'image' ? 'gallery' : 'attachment');
    }

    function renderPending() {
        const tray = getTray();
        if (!tray) return;
        tray.innerHTML = state.pending.map(item => {
            const key = escapeHtml(item.id || item.localId);
            const preview = item.kind === 'image' && item.previewUrl
                ? `<img src="${escapeHtml(item.previewUrl)}" alt="">`
                : `<span class="pending-file-icon">${attachmentIcon(item)}</span>`;
            const status = item.status === 'uploading'
                ? '正在上传…'
                : item.status === 'processing'
                    ? (item.kind === 'audio' ? '正在转写…' : '正在理解图片…')
                : item.status === 'failed'
                    ? escapeHtml(item.error || '处理失败')
                    : item.analysisStatus === 'completed'
                        ? `${item.kind === 'audio' ? '转写完成' : '图片理解完成'}${item.analysisModel ? ` · ${escapeHtml(item.analysisModel)}` : ''}`
                    : formatBytes(item.file_size);
            const retry = item.status === 'failed'
                ? `<button type="button" class="pending-attachment-retry" data-retry-attachment="${key}">重试</button>`
                : '';
            const visualStatus = item.analysisStatus === 'completed' ? 'analyzed' : item.status;
            return `<div class="pending-attachment ${escapeHtml(visualStatus)}" data-attachment-id="${key}">
                ${preview}
                <span class="pending-attachment-info"><strong>${escapeHtml(item.original_name)}</strong><small>${status}</small></span>
                ${retry}
                <button type="button" class="pending-attachment-remove" data-remove-attachment="${key}" aria-label="取消选择"><span data-zoot-icon="close"></span></button>
            </div>`;
        }).join('');
        tray.classList.toggle('has-items', state.pending.length > 0);
        tray.querySelectorAll('[data-remove-attachment]').forEach(button => {
            button.addEventListener('click', () => remove(button.dataset.removeAttachment));
        });
        tray.querySelectorAll('[data-retry-attachment]').forEach(button => {
            button.addEventListener('click', () => retry(button.dataset.retryAttachment));
        });
        notifyStateChanged();
    }

    async function remove(id) {
        const index = state.pending.findIndex(item => String(item.id || item.localId) === String(id));
        if (index < 0) return;
        const [item] = state.pending.splice(index, 1);
        item.abortController?.abort();
        if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
        renderPending();

        if (item.id && item.status !== 'uploading') {
            const owner = item.owner_persona_id || currentPersonaId();
            fetch(`/media/attachments/${encodeURIComponent(item.id)}?persona_id=${encodeURIComponent(owner)}`, {
                method: 'DELETE'
            }).catch(error => console.warn('[chat-media] draft cleanup failed', error));
        }
    }

    async function retry(id) {
        const item = state.pending.find(entry => String(entry.id || entry.localId) === String(id));
        if (!item || item.status !== 'failed') return;
        if (item.sourceUrl) await ingestLink(item.sourceUrl, item);
        else if (item.id && ['image', 'audio'].includes(item.kind)) await analyzeAttachment(item);
        else if (item.file) await uploadItem(item);
    }

    const delay = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));

    async function waitForJob(jobId) {
        const deadline = Date.now() + JOB_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const response = await fetch(`/media/jobs/${encodeURIComponent(jobId)}`);
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.detail || '无法读取多模态任务状态');
            const job = payload.job || {};
            if (job.status === 'completed') return job;
            if (job.status === 'failed') throw new Error(job.error_message || '多模态服务处理失败');
            if (job.status === 'cancelled') throw new Error('任务已取消');
            await delay(JOB_POLL_INTERVAL_MS);
        }
        throw new Error('多模态处理超时，请稍后重试');
    }

    async function analyzeAttachment(item) {
        item.status = 'processing';
        item.error = '';
        renderPending();
        try {
            const operation = item.kind === 'audio' ? 'transcription' : 'vision';
            const response = await fetch(`/media/attachments/${encodeURIComponent(item.id)}/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ operation, category: 'chat' })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.detail || '无法提交多模态解析任务');
            const job = await waitForJob(payload.job.id);
            if (!job.result?.artifact_id) throw new Error('解析任务未生成可用于对话的内容，请重试');
            item.status = 'ready';
            item.analysis = operation;
            item.analysisStatus = 'completed';
            item.analysisProvider = job.provider || '';
            item.analysisModel = job.model || '';
            notify(item.kind === 'audio' ? '语音转写完成，可以发送' : '图片理解完成，可以发送', 'success');
        } catch (error) {
            item.status = 'failed';
            item.error = error.message || '多模态解析失败';
            notify(item.error, 'error');
        } finally {
            renderPending();
        }
        return item;
    }

    async function uploadItem(item) {
        item.status = 'uploading';
        item.error = '';
        item.abortController = new AbortController();
        state.uploading += 1;
        renderPending();
        try {
            const form = new FormData();
            form.append('file', item.file, item.file.name);
            form.append('kind', item.kind);
            form.append('owner_persona_id', item.owner_persona_id);
            const response = await fetch('/media/attachments', {
                method: 'POST',
                body: form,
                signal: item.abortController.signal
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.detail || '上传失败');

            const localPreview = item.previewUrl;
            Object.assign(item, payload.attachment, {
                status: 'ready',
                file: item.file,
                previewUrl: payload.attachment.content_url || localPreview
            });
            if (localPreview?.startsWith('blob:') && item.previewUrl !== localPreview) {
                URL.revokeObjectURL(localPreview);
            }
            if (['image', 'audio'].includes(item.kind)) {
                await refreshCapabilities();
                const capability = item.kind === 'audio' ? 'transcription' : 'vision';
                if (state.capabilities.processing?.[capability]) {
                    await analyzeAttachment(item);
                } else {
                    item.status = 'failed';
                    item.error = item.kind === 'audio'
                        ? '未识别到可用的语音转写配置，请在多模态服务 API 中配置后重试'
                        : '未识别到可用的图片理解配置，请在多模态服务 API 中配置后重试';
                    notify(item.error, 'error');
                }
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                item.status = 'failed';
                item.error = error.message || '上传失败';
                notify(item.error, 'error');
            }
        } finally {
            state.uploading = Math.max(0, state.uploading - 1);
            item.abortController = null;
            renderPending();
        }
    }

    async function addFile(file, requestedKind) {
        if (!file) return null;
        if (state.pending.length >= MAX_PENDING_ATTACHMENTS) {
            notify(`每条消息最多选择 ${MAX_PENDING_ATTACHMENTS} 个附件`);
            return null;
        }
        const maxBytes = Number(state.capabilities.max_upload_bytes || DEFAULT_MAX_BYTES);
        if (file.size > maxBytes) {
            notify(`文件不能超过 ${formatBytes(maxBytes)}`, 'error');
            return null;
        }
        const duplicate = state.pending.some(item => item.original_name === file.name && item.file_size === file.size);
        if (duplicate) {
            notify('该文件已经在待发送列表中');
            return null;
        }

        const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const item = {
            localId,
            file,
            original_name: file.name,
            file_size: file.size,
            kind: requestedKind,
            status: 'uploading',
            owner_persona_id: currentPersonaId(),
            previewUrl: requestedKind === 'image' ? URL.createObjectURL(file) : ''
        };
        state.pending.push(item);
        await uploadItem(item);
        return item;
    }

    function choose(kind) {
        if (!state.capabilities.upload_kinds?.includes(kind)) {
            notify('当前后端尚未启用该附件类型');
            setToolMode(false, { focusInput: true });
            return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = kind === 'image'
            ? 'image/jpeg,image/png,image/gif,image/webp,image/bmp'
            : kind === 'audio' ? AUDIO_ACCEPT : FILE_ACCEPT;
        input.addEventListener('change', () => {
            Array.from(input.files || []).forEach(file => addFile(file, kind));
            setToolMode(false, { focusInput: true });
        }, { once: true });
        setToolMode(false);
        input.click();
    }

    function recorderElements() {
        return {
            overlay: document.getElementById('chat-recorder-overlay'),
            button: document.getElementById('float-mic-btn'),
            close: document.getElementById('chat-recorder-close'),
            status: document.getElementById('chat-recorder-status'),
            timer: document.getElementById('chat-recorder-timer')
        };
    }

    function setRecorderText(status, elapsedMs = 0) {
        const elements = recorderElements();
        if (elements.status) elements.status.textContent = status;
        if (elements.timer) {
            const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
            elements.timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        }
    }

    function releaseRecorderStream() {
        state.mediaStream?.getTracks().forEach(track => track.stop());
        state.mediaStream = null;
    }

    function exitRecorderSession() {
        if (state.recorderTimer) window.clearInterval(state.recorderTimer);
        state.recorderTimer = null;
        state.recorderMode = false;
        state.recorderPreparing = false;
        state.recorderPointerId = null;
        state.recorderCancelArmed = false;
        releaseRecorderStream();
        const elements = recorderElements();
        elements.overlay?.classList.remove('visible', 'preparing', 'recording', 'cancel-armed');
        elements.overlay?.setAttribute('aria-hidden', 'true');
        setRecorderText('按住说话', 0);
        notifyStateChanged();
    }

    function preferredRecorderMime() {
        const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
        return candidates.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
    }

    async function completeRecording(blob, elapsedMs, discarded) {
        exitRecorderSession();
        if (discarded) {
            notify('已取消录音');
            return;
        }
        if (elapsedMs < MIN_RECORDING_MS || blob.size === 0) {
            notify('录音时间太短，请按住后说话');
            return;
        }

        const cleanType = (blob.type || 'audio/webm').split(';', 1)[0];
        const extension = cleanType === 'audio/mp4' ? 'm4a' : cleanType === 'audio/ogg' ? 'ogg' : 'webm';
        const filename = `voice-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
        const file = new File([blob], filename, { type: cleanType });
        const item = await addFile(file, 'audio');
        if (!item || item.status !== 'ready') {
            notify('语音上传失败，已保留在输入栏供重试', 'error');
            return;
        }
        if (typeof window.sendCurrentMessage === 'function') {
            await window.sendCurrentMessage(false);
        } else {
            notify('语音已加入待发送内容');
        }
    }

    function stopRecording(discarded = false) {
        const recorder = state.mediaRecorder;
        if (!recorder || recorder.state === 'inactive') return;
        state.discardRecording = Boolean(discarded);
        try {
            recorder.stop();
        } catch (error) {
            console.warn('[chat-media] recorder stop failed', error);
            exitRecorderSession();
        }
    }

    function startRecording(event) {
        if (!state.recorderMode || state.recorderPreparing || !state.mediaStream || state.mediaRecorder) return;
        event.preventDefault();
        const elements = recorderElements();
        const mimeType = preferredRecorderMime();
        try {
            state.recorderChunks = [];
            state.discardRecording = false;
            state.recorderCancelArmed = false;
            state.recorderPointerId = event.pointerId;
            state.recorderStartY = event.clientY;
            state.recorderStartedAt = Date.now();
            state.mediaRecorder = mimeType
                ? new MediaRecorder(state.mediaStream, { mimeType, audioBitsPerSecond: 96000 })
                : new MediaRecorder(state.mediaStream);
            state.mediaRecorder.addEventListener('dataavailable', dataEvent => {
                if (dataEvent.data?.size) state.recorderChunks.push(dataEvent.data);
            });
            state.mediaRecorder.addEventListener('stop', () => {
                const elapsed = Date.now() - state.recorderStartedAt;
                const blob = new Blob(state.recorderChunks, { type: state.mediaRecorder?.mimeType || mimeType || 'audio/webm' });
                const discarded = state.discardRecording;
                state.mediaRecorder = null;
                state.recorderChunks = [];
                completeRecording(blob, elapsed, discarded);
            }, { once: true });
            state.mediaRecorder.start(250);
            elements.button?.setPointerCapture?.(event.pointerId);
            elements.overlay?.classList.add('recording');
            setRecorderText('正在录音', 0);
            state.recorderTimer = window.setInterval(() => {
                const elapsed = Date.now() - state.recorderStartedAt;
                setRecorderText(state.recorderCancelArmed ? '松手取消' : '松开发送', elapsed);
                if (elapsed >= MAX_RECORDING_MS) stopRecording(false);
            }, 100);
        } catch (error) {
            state.mediaRecorder = null;
            notify(`无法开始录音：${error.message || '录音器不可用'}`, 'error');
            exitRecorderSession();
        }
    }

    function updateRecordingGesture(event) {
        if (!state.mediaRecorder || event.pointerId !== state.recorderPointerId) return;
        const cancelArmed = event.clientY <= state.recorderStartY - RECORD_CANCEL_DISTANCE;
        if (cancelArmed === state.recorderCancelArmed) return;
        state.recorderCancelArmed = cancelArmed;
        const overlay = recorderElements().overlay;
        overlay?.classList.toggle('cancel-armed', cancelArmed);
        setRecorderText(cancelArmed ? '松手取消' : '松开发送', Date.now() - state.recorderStartedAt);
    }

    function finishRecordingGesture(event) {
        if (!state.mediaRecorder || event.pointerId !== state.recorderPointerId) return;
        event.preventDefault();
        stopRecording(state.recorderCancelArmed);
    }

    function closeRecorder() {
        if (!state.recorderMode) return false;
        if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
            stopRecording(true);
        } else {
            exitRecorderSession();
        }
        return true;
    }

    async function openRecorder() {
        setToolMode(false);
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
            notify('当前系统 WebView 不支持录音，请更新 Android System WebView', 'error');
            return;
        }
        state.recorderMode = true;
        state.recorderPreparing = true;
        const elements = recorderElements();
        elements.overlay?.classList.add('visible', 'preparing');
        elements.overlay?.setAttribute('aria-hidden', 'false');
        setRecorderText('正在申请麦克风权限…', 0);
        notifyStateChanged();
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                video: false
            });
            if (!state.recorderMode) {
                stream.getTracks().forEach(track => track.stop());
                return;
            }
            state.mediaStream = stream;
            state.recorderPreparing = false;
            elements.overlay?.classList.remove('preparing');
            setRecorderText('按住说话', 0);
        } catch (error) {
            const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError';
            notify(denied ? '麦克风权限被拒绝，可在系统设置中重新授权' : `无法访问麦克风：${error.message || '未知错误'}`, 'error');
            exitRecorderSession();
        }
    }

    function triggerImageGeneration() {
        setToolMode(false, { focusInput: true });
        if (!state.capabilities.image_generation) {
            notify('当前后端尚未接入生图服务');
            return;
        }
        openImageGenerator();
    }

    function ensureLinkDialog() {
        let dialog = document.getElementById('chat-link-ingestor');
        if (dialog) return dialog;
        dialog = document.createElement('div');
        dialog.id = 'chat-link-ingestor';
        dialog.className = 'chat-image-generator hidden';
        dialog.innerHTML = `<div class="chat-image-generator-card" role="dialog" aria-modal="true" aria-labelledby="chat-link-ingestor-title">
            <div class="chat-image-generator-header"><strong id="chat-link-ingestor-title">添加网页链接</strong><button type="button" data-link-close aria-label="关闭"><span data-zoot-icon="close"></span></button></div>
            <input id="chat-link-ingestor-url" type="url" inputmode="url" placeholder="https://example.com/article">
            <p class="chat-link-ingestor-tip">将安全抓取网页、PDF 或 Office 文档并提取正文。不会执行网页脚本，也不允许访问本机或局域网地址。</p>
            <div class="chat-image-generator-actions"><button type="button" data-link-cancel>取消</button><button type="button" class="primary" data-link-submit>抓取并加入输入栏</button></div>
            <div class="chat-image-generator-status" aria-live="polite"></div>
        </div>`;
        document.body.appendChild(dialog);
        const close = () => { if (dialog.dataset.busy !== '1') dialog.classList.add('hidden'); };
        dialog.querySelector('[data-link-close]').addEventListener('click', close);
        dialog.querySelector('[data-link-cancel]').addEventListener('click', close);
        dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
        dialog.querySelector('[data-link-submit]').addEventListener('click', async () => {
            const input = dialog.querySelector('#chat-link-ingestor-url');
            const url = input.value.trim();
            if (!/^https?:\/\//i.test(url)) {
                notify('请输入完整的 HTTP 或 HTTPS 链接');
                input.focus();
                return;
            }
            dialog.dataset.busy = '1';
            dialog.querySelector('[data-link-submit]').disabled = true;
            dialog.querySelector('.chat-image-generator-status').textContent = '正在安全抓取并解析内容…';
            const item = await ingestLink(url);
            dialog.dataset.busy = '0';
            dialog.querySelector('[data-link-submit]').disabled = false;
            if (item?.status === 'ready') {
                input.value = '';
                dialog.classList.add('hidden');
            } else {
                dialog.querySelector('.chat-image-generator-status').textContent = item?.error || '链接解析失败';
            }
        });
        return dialog;
    }

    function openLinkDialog() {
        setToolMode(false);
        const dialog = ensureLinkDialog();
        dialog.classList.remove('hidden');
        dialog.querySelector('#chat-link-ingestor-url')?.focus();
    }

    async function ingestLink(url, existingItem = null) {
        if (!existingItem && state.pending.length >= MAX_PENDING_ATTACHMENTS) {
            notify(`每条消息最多选择 ${MAX_PENDING_ATTACHMENTS} 个附件`);
            return null;
        }
        const item = existingItem || {
            localId: `link-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            original_name: new URL(url).hostname,
            file_size: 0,
            kind: 'file',
            owner_persona_id: currentPersonaId(),
            sourceUrl: url
        };
        if (!existingItem) state.pending.push(item);
        item.status = 'uploading';
        item.error = '';
        state.uploading += 1;
        renderPending();
        try {
            const response = await fetch('/media/links', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, owner_persona_id: item.owner_persona_id })
            });
            const payload = await response.json().catch(() => ({}));
            const detail = typeof payload.detail === 'object' ? payload.detail.message : payload.detail;
            if (!response.ok) throw new Error(detail || '链接抓取失败');
            Object.assign(item, payload.attachment, { status: 'ready', sourceUrl: payload.final_url || url });
            notify('链接内容已解析并加入输入栏');
        } catch (error) {
            item.status = 'failed';
            item.error = error.message || '链接抓取失败';
            notify(item.error, 'error');
        } finally {
            state.uploading = Math.max(0, state.uploading - 1);
            renderPending();
        }
        return item;
    }

    function recentConversationContext() {
        const nodes = Array.from(document.querySelectorAll('#chat-messages .message, #chat-messages .chat-message')).slice(-12);
        return nodes.map(node => node.textContent.trim()).filter(Boolean).join('\n').slice(-6000);
    }

    function recentConversationUids() {
        return Array.from(document.querySelectorAll('#chat-messages [data-message-uid]'))
            .slice(-12).map(node => node.dataset.messageUid).filter(Boolean);
    }

    function recentConversationMessages() {
        const seen = new Set();
        return Array.from(document.querySelectorAll('#chat-messages [data-message-uid]'))
            .map(node => ({
                uid: String(node.dataset.messageUid || ''),
                text: node.textContent.trim().slice(0, 600),
                role: node.classList.contains('user') || Boolean(node.closest('.user-message, .message.user')) ? 'doctor' : 'operator',
            }))
            .filter(item => item.uid && item.text && !seen.has(item.uid) && seen.add(item.uid))
            .slice(-12);
    }

    function defaultImageSourceUids(messages) {
        if (!messages.length) return [];
        const completedRounds = [];
        let roundStart = -1;
        let hasReply = false;
        for (let index = 0; index < messages.length; index += 1) {
            if (messages[index].role === 'doctor') {
                if (roundStart >= 0 && hasReply) completedRounds.push([roundStart, index]);
                roundStart = index;
                hasReply = false;
            } else if (roundStart >= 0) {
                hasReply = true;
            }
        }
        if (roundStart >= 0 && hasReply) completedRounds.push([roundStart, messages.length]);
        if (!completedRounds.length) return messages.slice(-4).map(item => item.uid);
        const selected = completedRounds.slice(-2);
        return messages.slice(selected[0][0], selected[selected.length - 1][1]).map(item => item.uid);
    }

    function createClientRequestId() {
        if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
        return `image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function currentConversation() {
        const groupId = window.currentGroupId || null;
        const operatorId = window.currentOperatorId || window.currentChatOperatorId || null;
        return {
            chatType: groupId ? 'group' : 'private',
            chatId: String(groupId || operatorId || ''),
            operatorId: String(operatorId || ''),
        };
    }

    function ensureImageGeneratorDialog() {
        let dialog = document.getElementById('chat-image-generator');
        if (dialog) return dialog;
        dialog = document.createElement('div');
        dialog.id = 'chat-image-generator';
        dialog.className = 'chat-image-generator app-modal-overlay bottom-sheet hidden';
        dialog.innerHTML = `<div class="chat-image-generator-card bottom-sheet-body" role="dialog" aria-modal="true" aria-labelledby="chat-image-generator-title">
            <div class="chat-image-generator-header"><strong id="chat-image-generator-title">场景展示</strong><button type="button" data-image-generator-close aria-label="关闭"><span data-zoot-icon="close"></span></button></div>
            <div class="settings-info-card important">规划服务只读取下方勾选的消息。方案、ZOOT 连续性上下文、服务商与模型会在实际生图前完整展示；取消不会调用图片服务。</div>
            <div class="chat-image-proposal-summary hidden" data-image-proposal-summary></div>
            <div id="chat-image-generator-message-list" class="chat-image-message-list"></div>
            <label class="chat-image-context-option">视角 <select id="chat-image-generator-pov"><option value="first_person">第一人称（博士 POV，不出现博士）</option><option value="third_person">第三人称（博士与干员同框）</option></select></label>
            <label>人物<textarea id="chat-image-plan-characters" rows="2" maxlength="2000"></textarea></label>
            <label>场景<textarea id="chat-image-plan-scene" rows="3" maxlength="3000"></textarea></label>
            <label>正向提示词<textarea id="chat-image-generator-prompt" rows="5" maxlength="12000" placeholder="先选择记录并调用规划服务"></textarea></label>
            <label>负向提示词<textarea id="chat-image-plan-negative" rows="3" maxlength="6000"></textarea></label>
            <label>画面比例 <select id="chat-image-plan-ratio"><option value="1:1">1:1</option><option value="3:4">3:4</option><option value="4:3">4:3</option><option value="9:16">9:16</option><option value="16:9">16:9</option></select></label>
            <label>风格<textarea id="chat-image-plan-style" rows="2" maxlength="1000"></textarea></label>
            <label class="chat-image-context-toggle"><input id="chat-image-include-zoot" type="checkbox" checked><span>追加 ZOOT 连续性上下文</span></label>
            <label>将发送的 ZOOT 上下文<textarea id="chat-image-zoot-context" rows="4" readonly placeholder="完成规划后显示；关闭上方选项即可不发送"></textarea></label>
            <div class="chat-image-route-summary" data-image-route-summary></div>
            <div class="chat-image-generator-actions"><button type="button" data-image-generator-cancel>取消</button><button type="button" class="primary" data-image-generator-plan>生成方案</button><button type="button" class="primary" data-image-generator-submit disabled>确认并开始生图</button></div>
            <div class="chat-image-generator-status" aria-live="polite"></div>
        </div>`;
        document.body.appendChild(dialog);
        const close = async () => {
            if (dialog.dataset.busy === '1') {
                const jobIds = [
                    dialog.dataset.planJobId,
                    dialog.dataset.generationJobId,
                ].filter(Boolean);
                await Promise.allSettled(jobIds.map(jobId => fetch(
                    `/media/jobs/${encodeURIComponent(jobId)}/cancel`,
                    {method: 'POST'},
                )));
                if (dialog.dataset.planId) {
                    await fetch(`/image-interactions/plans/${encodeURIComponent(dialog.dataset.planId)}/cancel`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({expected_revision: Number(dialog.dataset.planRevision || 1)}),
                    }).catch(() => null);
                }
                dialog.dataset.busy = '0';
            }
            dialog.classList.add('hidden');
        };
        dialog.querySelector('[data-image-generator-close]').addEventListener('click', close);
        dialog.querySelector('[data-image-generator-cancel]').addEventListener('click', close);
        dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
        dialog.querySelector('[data-image-generator-plan]').addEventListener('click', () => planImage(dialog));
        dialog.querySelector('[data-image-generator-submit]').addEventListener('click', () => generateImageFromDialog(dialog));
        return dialog;
    }

    function applyImagePlanToDialog(dialog, record) {
        const plan = record?.plan || record || {};
        dialog.dataset.plan = JSON.stringify(plan);
        dialog.dataset.planId = String(record?.image_plan_id || plan.image_plan_id || '');
        dialog.dataset.planRevision = String(record?.revision || 1);
        dialog.querySelector('#chat-image-plan-characters').value = (plan.characters || []).join('\n');
        dialog.querySelector('#chat-image-plan-scene').value = plan.scene || '';
        dialog.querySelector('#chat-image-generator-prompt').value = plan.positive_prompt || '';
        dialog.querySelector('#chat-image-plan-negative').value = plan.negative_prompt || '';
        dialog.querySelector('#chat-image-generator-pov').value = plan.pov || 'first_person';
        dialog.querySelector('#chat-image-plan-ratio').value = plan.aspect_ratio || '1:1';
        dialog.querySelector('#chat-image-plan-style').value = plan.style || '';
        dialog.querySelector('#chat-image-zoot-context').value = plan.zoot_context || '';
        dialog.querySelector('#chat-image-include-zoot').checked = plan.include_zoot_context !== false;
        dialog.querySelector('[data-image-route-summary]').textContent =
            `规划：${plan.planning_provider || '当前规划路由'} / ${plan.planning_model || '默认模型'}；渲染：${plan.render_provider || '当前图片渲染路由'} / ${plan.render_model || '默认模型'}。`;
        dialog.querySelector('[data-image-generator-submit]').disabled = false;
        dialog.querySelector('.chat-image-generator-status').textContent =
            '已恢复待确认方案。请检查并编辑，确认后才会调用生图服务。';
    }

    function openImageGenerator(options = {}) {
        if (!state.capabilities.image_generation || !state.capabilities.image_prompt_planning) {
            notify('请先为生图提示词规划和图片渲染分别配置已验证的能力路由');
            if (typeof window.showPage === 'function') window.showPage('settings-api');
            return;
        }
        const dialog = ensureImageGeneratorDialog();
        const messages = recentConversationMessages();
        const defaultUids = new Set(options.sourceMessageUids || defaultImageSourceUids(messages));
        dialog.querySelector('#chat-image-generator-message-list').innerHTML = messages.map((item, index) => `
            <label><input type="checkbox" value="${escapeHtml(item.uid)}" ${defaultUids.has(item.uid) ? 'checked' : ''}>
            <span>${escapeHtml(item.text)}</span></label>`).join('') || '<p>当前没有可用于规划的已落库消息。</p>';
        dialog.dataset.plan = '';
        dialog.dataset.planId = '';
        dialog.dataset.planRevision = '';
        dialog.dataset.planJobId = '';
        dialog.dataset.generationJobId = '';
        dialog.dataset.proposalId = String(options.proposalId || '');
        dialog.dataset.proposalSubject = String(options.subject || '');
        dialog.dataset.proposalContext = String(options.context || '');
        dialog.querySelector('#chat-image-generator-pov').value = options.suggestedPov || 'first_person';
        const proposalSummary = dialog.querySelector('[data-image-proposal-summary]');
        proposalSummary.textContent = [options.subject, options.context].filter(Boolean).join('：');
        proposalSummary.classList.toggle('hidden', !proposalSummary.textContent);
        dialog.querySelector('[data-image-generator-submit]').disabled = true;
        const planningRoute = (state.capabilities.routes?.image_prompt_planning || []).find(item => item.enabled);
        const renderingRoute = (state.capabilities.routes?.image_generation || []).find(item => item.enabled);
        dialog.querySelector('[data-image-route-summary]').textContent =
            `规划将发送至：${planningRoute?.provider_id || '未解析'} / ${planningRoute?.model || '默认模型'}；`
            + `确认渲染后将发送至：${renderingRoute?.provider_id || '未解析'} / ${renderingRoute?.model || '默认模型'}。`
            + '两步均可能由第三方服务计费。';
        dialog.classList.remove('hidden');
        dialog.querySelector('#chat-image-generator-message-list input')?.focus();
        if (options.existingPlanRecord) {
            applyImagePlanToDialog(dialog, options.existingPlanRecord);
        } else if (options.autoPlan) {
            planImage(dialog);
        }
    }

    function selectedMessageUids(dialog) {
        return Array.from(dialog.querySelectorAll('#chat-image-generator-message-list input:checked'))
            .map(input => input.value).slice(0, 12);
    }

    async function planImage(dialog) {
        const uids = selectedMessageUids(dialog);
        if (!uids.length) {
            notify('请至少选择一条已落库消息');
            return;
        }
        const conversation = currentConversation();
        const planButton = dialog.querySelector('[data-image-generator-plan]');
        const status = dialog.querySelector('.chat-image-generator-status');
        dialog.dataset.busy = '1';
        planButton.disabled = true;
        status.textContent = '规划服务正在读取所选消息并生成方案…';
        try {
            const responses = await Promise.all([
                conversation.operatorId
                    ? fetch(`/image-interactions/tags/operator/${encodeURIComponent(conversation.operatorId)}`)
                    : Promise.resolve(null),
                fetch(`/image-interactions/tags/persona/${encodeURIComponent(currentPersonaId())}`),
            ]);
            const operatorTag = responses[0]?.ok ? (await responses[0].json()).tag : '';
            const doctorTag = responses[1].ok ? (await responses[1].json()).tag : '';
            const timeline = typeof window.getZootTimelineContext === 'function'
                ? window.getZootTimelineContext()
                : {};
            const response = await fetch('/media/images/plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_message_uids: uids,
                    chat_type: conversation.chatType,
                    chat_id: conversation.chatId,
                    owner_persona_id: currentPersonaId(),
                    operator_tag: operatorTag,
                    doctor_tag: doctorTag,
                    pov: dialog.querySelector('#chat-image-generator-pov').value,
                    proposal_id: dialog.dataset.proposalId || null,
                    proposal_subject: dialog.dataset.proposalSubject || '',
                    proposal_context: dialog.dataset.proposalContext || '',
                    include_zoot_context: dialog.querySelector('#chat-image-include-zoot').checked,
                    branch_id: timeline.activeBranchId || 'main',
                    timeline_view_revision: timeline.viewRevision || 0,
                    client_request_id: createClientRequestId(),
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.detail || '无法提交规划任务');
            dialog.dataset.planJobId = String(payload.job.id);
            const job = await waitForJob(payload.job.id);
            const plan = job.result?.image_plan;
            if (!plan) throw new Error('规划任务未返回有效方案');
            const record = job.result?.image_plan_record || {};
            dialog.dataset.plan = JSON.stringify(plan);
            dialog.dataset.planId = String(record.image_plan_id || plan.image_plan_id || '');
            dialog.dataset.planRevision = String(record.revision || 1);
            dialog.dataset.planJobId = '';
            applyImagePlanToDialog(dialog, {
                ...record,
                image_plan_id: record.image_plan_id || plan.image_plan_id,
                plan,
            });
            status.textContent = '方案已生成。请检查并编辑，确认后才会调用生图服务。';
        } catch (error) {
            status.textContent = error.message || '方案规划失败';
            notify(status.textContent, 'error');
        } finally {
            dialog.dataset.busy = '0';
            planButton.disabled = false;
        }
    }

    async function generateImageFromDialog(dialog) {
        const promptInput = dialog.querySelector('#chat-image-generator-prompt');
        const prompt = promptInput.value.trim();
        const imagePlanId = dialog.dataset.planId;
        if (!prompt || !imagePlanId) {
            notify('请先填写图片描述');
            promptInput.focus();
            return;
        }
        if (state.pending.length >= MAX_PENDING_ATTACHMENTS) {
            notify(`每条消息最多选择 ${MAX_PENDING_ATTACHMENTS} 个附件`);
            return;
        }
        const submit = dialog.querySelector('[data-image-generator-submit]');
        const status = dialog.querySelector('.chat-image-generator-status');
        if (!dialog.dataset.plan) {
            notify('请先调用规划服务生成方案');
            return;
        }
        if (!window.confirm('即将调用图片渲染服务，可能产生费用。确认使用当前页面展示的方案开始生成吗？')) return;
        dialog.dataset.busy = '1';
        submit.disabled = true;
        status.textContent = '正在保存已确认方案…';
        try {
            const conversation = currentConversation();
            const updateResponse = await fetch(`/image-interactions/plans/${encodeURIComponent(imagePlanId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    expected_revision: Number(dialog.dataset.planRevision || 1),
                    plan: {
                        characters: dialog.querySelector('#chat-image-plan-characters').value.split('\n').map(item => item.trim()).filter(Boolean),
                        scene: dialog.querySelector('#chat-image-plan-scene').value.trim(),
                        positive_prompt: prompt,
                        negative_prompt: dialog.querySelector('#chat-image-plan-negative').value.trim(),
                        pov: dialog.querySelector('#chat-image-generator-pov').value,
                        aspect_ratio: dialog.querySelector('#chat-image-plan-ratio').value,
                        style: dialog.querySelector('#chat-image-plan-style').value.trim(),
                        include_zoot_context: dialog.querySelector('#chat-image-include-zoot').checked,
                    },
                }),
            });
            const updated = await updateResponse.json().catch(() => ({}));
            if (!updateResponse.ok) throw new Error(updated.detail || '保存生图方案失败');
            dialog.dataset.planRevision = String(updated.image_plan?.revision || Number(dialog.dataset.planRevision || 1) + 1);
            status.textContent = '正在生成图片，请稍候…';
            const response = await fetch('/media/images/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image_plan_id: imagePlanId,
                    expected_revision: Number(dialog.dataset.planRevision || 1),
                    client_request_id: createClientRequestId(),
                    chat_type: conversation.chatType,
                    chat_id: conversation.chatId,
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.detail || '无法提交生图任务');
            dialog.dataset.generationJobId = String(payload.job.id);
            const job = await waitForJob(payload.job.id);
            const attachment = job.result?.attachment;
            if (!attachment) throw new Error('生图任务未返回图片附件');
            promptInput.value = '';
            dialog.dataset.plan = '';
            dialog.dataset.generationJobId = '';
            dialog.classList.add('hidden');
            if (conversation.chatType === 'group' && typeof window.loadGroupHistory === 'function') {
                window.loadGroupHistory(conversation.chatId);
            } else if (typeof window.loadPrivateHistory === 'function') {
                window.loadPrivateHistory(conversation.chatId);
            }
            notify('图片已生成并保存为 AI 图片卡片');
        } catch (error) {
            status.textContent = error.message || '图片生成失败';
            notify(status.textContent, 'error');
        } finally {
            dialog.dataset.busy = '0';
            submit.disabled = false;
        }
    }

    function onDynamicButtonCapture(event) {
        const elements = getElements();
        const isScene = localStorage.getItem('scenarioMode') === 'true'
            && localStorage.getItem('scenarioRole') === 'scene';
        const shouldOpen = !isScene
            && !state.toolMode
            && !state.recorderMode
            && !hasAnySelection()
            && !elements.input?.value.trim();
        if (!shouldOpen) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setToolMode(true);
    }

    function bindToolbar() {
        document.querySelectorAll('#chat-media-tools [data-media-action]').forEach(button => {
            if (button.dataset.mediaBound === '1') return;
            button.dataset.mediaBound = '1';
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const action = button.dataset.mediaAction;
                if (action === 'generate') triggerImageGeneration();
                else if (action === 'link') openLinkDialog();
                else if (action === 'audio') openRecorder();
                else choose(action);
            });
        });
    }

    function bindRecorder() {
        const elements = recorderElements();
        if (elements.button && elements.button.dataset.recorderBound !== '1') {
            elements.button.dataset.recorderBound = '1';
            elements.button.addEventListener('pointerdown', startRecording);
            elements.button.addEventListener('pointermove', updateRecordingGesture);
            elements.button.addEventListener('pointerup', finishRecordingGesture);
            elements.button.addEventListener('pointercancel', event => {
                if (event.pointerId === state.recorderPointerId) stopRecording(true);
            });
            elements.button.addEventListener('contextmenu', event => event.preventDefault());
        }
        if (elements.close && elements.close.dataset.recorderBound !== '1') {
            elements.close.dataset.recorderBound = '1';
            elements.close.addEventListener('click', closeRecorder);
        }
        if (document.documentElement.dataset.recorderVisibilityBound !== '1') {
            document.documentElement.dataset.recorderVisibilityBound = '1';
            document.addEventListener('visibilitychange', () => {
                if (document.hidden && state.mediaRecorder) closeRecorder();
            });
        }
    }

    async function loadCapabilities() {
        try {
            const response = await fetch('/media/capabilities');
            if (!response.ok) return false;
            state.capabilities = { ...state.capabilities, ...(await response.json()) };
            return true;
        } catch (error) {
            console.warn('[chat-media] capability check failed', error);
            return false;
        }
    }

    function refreshCapabilities() {
        state.capabilitiesLoaded = loadCapabilities();
        return state.capabilitiesLoaded;
    }

    function init() {
        getTray();
        bindToolbar();
        bindRecorder();
        const dynamicButton = document.getElementById('dynamic-btn');
        if (dynamicButton && dynamicButton.dataset.mediaCaptureBound !== '1') {
            dynamicButton.dataset.mediaCaptureBound = '1';
            dynamicButton.addEventListener('click', onDynamicButtonCapture, true);
        }
        const messages = document.getElementById('chat-messages');
        if (messages && messages.dataset.mediaCloseBound !== '1') {
            messages.dataset.mediaCloseBound = '1';
            messages.addEventListener('pointerdown', () => {
                if (state.toolMode) setToolMode(false);
            }, { passive: true });
        }
        refreshCapabilities();
        window.openChatImageGenerator = openImageGenerator;
        window.openExistingImagePlan = async imagePlanId => {
            const response = await fetch(`/image-interactions/plans/${encodeURIComponent(imagePlanId)}`);
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                notify(payload.detail || '无法读取待确认方案');
                return;
            }
            const record = payload.image_plan || {};
            openImageGenerator({
                sourceMessageUids: record.source_message_uids || [],
                proposalId: record.proposal_id || '',
                suggestedPov: record.plan?.pov || 'first_person',
                existingPlanRecord: record,
            });
        };
        renderPending();
    }

    function getReadyAttachments() {
        return state.pending
            .filter(item => item.status === 'ready')
            .map(({ file, abortController, ...item }) => ({ ...item }));
    }

    function consume(ids) {
        const idSet = new Set((ids || []).map(String));
        const removed = state.pending.filter(item => idSet.has(String(item.id)));
        removed.forEach(item => {
            if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
        });
        state.pending = state.pending.filter(item => !idSet.has(String(item.id)));
        renderPending();
    }

    function restore(items) {
        const existing = new Set(state.pending.map(item => String(item.id || item.localId)));
        for (const item of items || []) {
            const key = String(item?.id || item?.localId || '');
            if (!key || existing.has(key)) continue;
            state.pending.push({ ...item, status: item.status === 'failed' ? 'ready' : (item.status || 'ready') });
            existing.add(key);
        }
        renderPending();
    }

    function renderAttachments(attachments) {
        if (!Array.isArray(attachments) || attachments.length === 0) return '';
        return `<div class="message-attachments">${attachments.map(item => {
            const url = item.content_url || `/media/attachments/${encodeURIComponent(item.id)}/content`;
            if (item.kind === 'image') {
                return `<a class="message-image-attachment" href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="${escapeHtml(item.original_name)}" loading="lazy"></a>`;
            }
            const icon = ZootIcons.html(item.kind === 'audio' ? 'audio' : 'attachment');
            return `<a class="message-file-attachment" href="${escapeHtml(url)}" download="${escapeHtml(item.original_name)}"><span class="message-file-icon">${icon}</span><span><strong>${escapeHtml(item.original_name)}</strong><small>${escapeHtml(item.mime_type || '文件')} · ${formatBytes(item.file_size)}</small></span></a>`;
        }).join('')}</div>`;
    }

    window.chatMedia = {
        init,
        choose,
        openTools: () => setToolMode(true),
        closeTools: options => setToolMode(false, options),
        isToolMode: () => state.toolMode,
        openRecorder,
        closeRecorder,
        isRecorderMode: () => state.recorderMode,
        getReadyAttachments,
        consume,
        restore,
        remove,
        renderAttachments,
        hasPending: hasReadySelection,
        hasAny: () => hasAnySelection() || state.recorderMode,
        isUploading: () => state.uploading > 0,
        blocksScenarioMode: () => hasAnySelection() || state.recorderMode,
        getBlockReason,
        refreshCapabilities,
        canSend: () => hasReadySelection() && !getBlockReason()
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
