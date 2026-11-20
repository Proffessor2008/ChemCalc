import { t } from './i18n.js';
import { element, button } from './dom.js';

const MAX_FILE_BYTES = 900_000;
const MAX_OUTPUT = 1600;
const MIN_FRAME_WIDTH = 60;
const MIN_FRAME_HEIGHT = 40;
const FRAME_HIT = 20;

function cameraIcon() {
  const wrapper = element('span', 'ocr-camera-icon');
  wrapper.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3l1.5-2h7L17 7h3v12H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  return wrapper;
}

function splitReactants(text) {
  return String(text || '').split(/\s*=\s*/)[0].trim();
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function prepareBlob(canvas) {
  let quality = 0.84;
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  while (blob && blob.size > MAX_FILE_BYTES && quality > 0.5) {
    quality -= 0.1;
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  }
  return blob;
}

export function initOcrUI({ showToast = () => {} } = {}) {
  const dialog = document.getElementById('ocr-dialog');
  const root = document.getElementById('ocr-app');
  if (!dialog || !root) return;

  let target = null;
  let csrf = '';
  let quota = { limit: 5, used: 0, remaining: 0, period: 'month' };
  let image = null;
  let imageUrl = '';
  let stage = null;
  let canvas = null;
  let frame = null;
  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;
  let drag = null;
  let lastBlob = null;
  let busy = false;
  let cameraStream = null;
  let videoElement = null;

  function stopCamera() {
    if (cameraStream) {
      for (const track of cameraStream.getTracks()) track.stop();
      cameraStream = null;
    }
    if (videoElement) {
      videoElement.srcObject = null;
      videoElement = null;
    }
  }

  function close() {
    stopCamera();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = '';
    image = null;
    if (dialog.open) dialog.close();
  }

  function header(title = t('ocrTitle'), subtitle = '') {
    const head = element('div', 'dialog-heading ocr-heading');
    const copy = element('div');
    const titleNode = element('h2', '', title);
    titleNode.id = 'ocr-title';
    copy.append(titleNode);
    if (subtitle) copy.append(element('p', 'help-text', subtitle));
    head.append(copy);
    const closeButton = button('×', 'icon-button');
    closeButton.setAttribute('aria-label', t('ocrClose'));
    closeButton.addEventListener('click', close);
    head.append(closeButton);
    return head;
  }

  function quotaLine() {
    if (quota.unlimited) return element('p', 'help-text ocr-quota', t('ocrUnlimited'));
    return element('p', 'help-text ocr-quota', t('ocrRemaining', { count: quota.remaining, limit: quota.limit }));
  }

  function accuracyWarning() {
    return element('p', 'ocr-warning', t('ocrAccuracyWarning'));
  }

  function renderLogin() {
    root.replaceChildren();
    const body = element('div', 'ocr-login');
    body.append(cameraIcon(), element('p', '', t('ocrLoginRequired')));
    const login = button(t('ocrLoginAction'), 'button primary');
    login.addEventListener('click', () => {
      close();
      document.querySelector('[data-tab="account"]')?.click();
      setTimeout(() => document.getElementById('community-auth')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 100);
    });
    const cancel = button(t('ocrCancel'), 'button ghost');
    cancel.addEventListener('click', close);
    const actions = element('div', 'dialog-actions');
    actions.append(cancel, login);
    body.append(actions);
    root.append(header(t('ocrTitle')), body);
  }

  function renderQuota() {
    root.replaceChildren();
    const body = element('div', 'ocr-login');
    body.append(cameraIcon(), element('p', '', t('ocrQuotaExceeded')), quotaLine());
    const closeButton = button(t('ocrClose'), 'button primary');
    closeButton.addEventListener('click', close);
    body.append(closeButton);
    root.append(header(t('ocrTitle')), body);
  }

  function renderSource() {
    stopCamera();
    root.replaceChildren();
    const body = element('div', 'ocr-source');
    body.append(cameraIcon());
    body.append(quotaLine());
    body.append(accuracyWarning());
    const take = button(t('ocrTakePhoto'), 'button primary');
    const upload = button(t('ocrChoosePhoto'), 'button secondary');
    take.addEventListener('click', () => startLiveCamera(() => pickFile(true), () => pickFile(false)));
    upload.addEventListener('click', () => pickFile(false));
    const actions = element('div', 'ocr-source-actions');
    actions.append(take, upload);
    body.append(actions);
    const cancel = button(t('ocrCancel'), 'button ghost');
    cancel.addEventListener('click', close);
    body.append(cancel);
    root.append(header(t('ocrTitle'), t('ocrHint')), body);
  }

  function resetCrop() {
    zoom = 1;
    offsetX = 0;
    offsetY = 0;
    drag = null;
  }

  function pickFile(capture = false) {
    const input = element('input', 'ocr-file-input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.capture = 'environment';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) loadFile(file);
      input.remove();
    });
    input.style.display = 'none';
    document.body.append(input);
    input.click();
  }

  async function loadBlob(blob) {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    resetCrop();
    imageUrl = URL.createObjectURL(blob);
    image = new Image();
    image.decoding = 'async';
    image.onload = () => renderCrop();
    image.onerror = () => showToast(t('ocrFailed'));
    image.src = imageUrl;
  }

  async function loadFile(file) {
    if (!file.type.startsWith('image/')) { showToast(t('ocrFailed')); return; }
    await loadBlob(file);
  }

  function renderCameraError(error, fallback, upload) {
    stopCamera();
    root.replaceChildren();
    const body = element('div', 'ocr-login');
    body.append(cameraIcon());
    const name = error?.name;
    const platform = window.Telegram?.WebApp?.platform;
    const telegramDesktop = platform === 'tdesktop' || platform === 'macos';
    const message = telegramDesktop ? t('ocrCameraTelegram')
      : name === 'NotAllowedError' ? t('ocrCameraDenied')
        : name === 'NotFoundError' ? t('ocrCameraNotFound')
          : name === 'NotReadableError' ? t('ocrCameraBusy')
            : t('ocrCameraUnavailable');
    body.append(element('p', 'ocr-error', message));
    const actions = element('div', 'dialog-actions ocr-actions');
    const cancel = button(t('ocrCancel'), 'button ghost');
    cancel.addEventListener('click', close);
    const system = button(t('ocrOpenSystemCamera'), 'button secondary');
    system.addEventListener('click', () => { stopCamera(); fallback(); });
    const choose = button(t('ocrChoosePhoto'), 'button primary');
    choose.addEventListener('click', () => { stopCamera(); upload(); });
    actions.append(cancel, system, choose);
    body.append(actions);
    root.append(header(t('ocrTitle')), body);
  }

  function renderCameraStage(fallback, upload) {
    root.replaceChildren();
    const body = element('div', 'ocr-live');
    body.append(accuracyWarning());
    videoElement = element('video', 'ocr-video');
    videoElement.autoplay = true;
    videoElement.playsInline = true;
    videoElement.muted = true;
    videoElement.setAttribute('playsinline', '');
    videoElement.setAttribute('muted', '');
    body.append(videoElement, element('p', 'help-text ocr-live-hint', t('ocrLiveHint')));
    const actions = element('div', 'dialog-actions ocr-actions');
    const cancel = button(t('ocrCancel'), 'button ghost');
    cancel.addEventListener('click', close);
    const system = button(t('ocrOpenSystemCamera'), 'button ghost');
    system.addEventListener('click', () => { stopCamera(); fallback(); });
    const capture = button(t('ocrCapture'), 'button primary');
    capture.disabled = true;
    videoElement.addEventListener('loadedmetadata', () => { capture.disabled = false; }, { once: true });
    capture.addEventListener('click', () => captureCamera());
    actions.append(cancel, system, capture);
    body.append(actions);
    root.append(header(t('ocrTitle'), t('ocrHint')), body);
  }

  async function startLiveCamera(fallback, upload) {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      renderCameraError({ name: 'Unavailable' }, fallback, upload);
      return;
    }
    renderCameraStage(fallback, upload);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      if (!videoElement || !dialog.open) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      cameraStream = stream;
      videoElement.srcObject = stream;
      await videoElement.play().catch(() => {});
    } catch (error) {
      renderCameraError(error, fallback, upload);
    }
  }

  async function captureCamera() {
    if (!videoElement || !videoElement.videoWidth || !videoElement.videoHeight) return;
    const output = document.createElement('canvas');
    output.width = videoElement.videoWidth;
    output.height = videoElement.videoHeight;
    output.getContext('2d').drawImage(videoElement, 0, 0, output.width, output.height);
    const blob = await new Promise((resolve) => output.toBlob(resolve, 'image/jpeg', 0.9));
    stopCamera();
    if (blob) await loadBlob(blob);
    else showToast(t('ocrFailed'));
  }

  function initialFrame(width, height) {
    const frameWidth = width * 0.82;
    const frameHeight = height * 0.58;
    return { x: (width - frameWidth) / 2, y: (height - frameHeight) / 2, w: frameWidth, h: frameHeight };
  }

  function frameHandles(value = frame) {
    return [
      { name: 'nw', x: value.x, y: value.y },
      { name: 'n', x: value.x + value.w / 2, y: value.y },
      { name: 'ne', x: value.x + value.w, y: value.y },
      { name: 'e', x: value.x + value.w, y: value.y + value.h / 2 },
      { name: 'se', x: value.x + value.w, y: value.y + value.h },
      { name: 's', x: value.x + value.w / 2, y: value.y + value.h },
      { name: 'sw', x: value.x, y: value.y + value.h },
      { name: 'w', x: value.x, y: value.y + value.h / 2 }
    ];
  }

  function frameHit(pointX, pointY) {
    let nearest = null;
    let distance = FRAME_HIT;
    for (const handle of frameHandles()) {
      const current = Math.hypot(handle.x - pointX, handle.y - pointY);
      if (current < distance) { distance = current; nearest = handle.name; }
    }
    return nearest;
  }

  function clampFrame(value, width, height) {
    value.w = Math.max(MIN_FRAME_WIDTH, Math.min(width, value.w));
    value.h = Math.max(MIN_FRAME_HEIGHT, Math.min(height, value.h));
    value.x = Math.max(0, Math.min(width - value.w, value.x));
    value.y = Math.max(0, Math.min(height - value.h, value.y));
    return value;
  }

  function resizeFrame(start, handle, deltaX, deltaY, width, height) {
    let x = start.x;
    let y = start.y;
    let w = start.w;
    let h = start.h;
    if (handle.includes('w')) {
      const right = start.x + start.w;
      x = Math.max(0, Math.min(start.x + deltaX, right - MIN_FRAME_WIDTH));
      w = right - x;
    }
    if (handle.includes('e')) {
      w = Math.max(MIN_FRAME_WIDTH, Math.min(width - start.x, start.w + deltaX));
    }
    if (handle.includes('n')) {
      const bottom = start.y + start.h;
      y = Math.max(0, Math.min(start.y + deltaY, bottom - MIN_FRAME_HEIGHT));
      h = bottom - y;
    }
    if (handle.includes('s')) {
      h = Math.max(MIN_FRAME_HEIGHT, Math.min(height - start.y, start.h + deltaY));
    }
    return clampFrame({ x, y, w, h }, width, height);
  }

  function cropCursor(pointX, pointY) {
    if (!frame) return 'grab';
    const handle = frameHit(pointX, pointY);
    if (handle === 'nw' || handle === 'se') return 'nwse-resize';
    if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
    if (handle === 'n' || handle === 's') return 'ns-resize';
    if (handle === 'e' || handle === 'w') return 'ew-resize';
    if (pointX >= frame.x && pointX <= frame.x + frame.w && pointY >= frame.y && pointY <= frame.y + frame.h) return 'move';
    return 'grab';
  }

  function imageGeometry() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const base = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const scale = base * zoom;
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    return { width, height, scale, drawWidth, drawHeight, base };
  }

  function clampOffsets() {
    if (!canvas || !image || !frame) return;
    const geometry = imageGeometry();
    const left = (geometry.width - geometry.drawWidth) / 2 + offsetX;
    const top = (geometry.height - geometry.drawHeight) / 2 + offsetY;
    if (left > frame.x) offsetX -= left - frame.x;
    if (top > frame.y) offsetY -= top - frame.y;
    const right = left + geometry.drawWidth;
    const bottom = top + geometry.drawHeight;
    if (right < frame.x + frame.w) offsetX += frame.x + frame.w - right;
    if (bottom < frame.y + frame.h) offsetY += frame.y + frame.h - bottom;
  }

  function drawCrop() {
    if (!canvas || !image || !frame) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#080d0c';
    ctx.fillRect(0, 0, width, height);
    clampOffsets();
    const geometry = imageGeometry();
    const left = (width - geometry.drawWidth) / 2 + offsetX;
    const top = (height - geometry.drawHeight) / 2 + offsetY;
    ctx.drawImage(image, left, top, geometry.drawWidth, geometry.drawHeight);
    ctx.fillStyle = 'rgba(0, 0, 0, .58)';
    ctx.fillRect(0, 0, width, frame.y);
    ctx.fillRect(0, frame.y + frame.h, width, height - frame.y - frame.h);
    ctx.fillRect(0, frame.y, frame.x, frame.h);
    ctx.fillRect(frame.x + frame.w, frame.y, width - frame.x - frame.w, frame.h);
    ctx.strokeStyle = '#63d6ae';
    ctx.lineWidth = 2;
    ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
    ctx.strokeStyle = '#b7ffe7';
    ctx.lineWidth = 3;
    for (const handle of frameHandles()) {
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#b7ffe7';
      ctx.fill();
      ctx.strokeStyle = '#0b1714';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function applyZoom(next) {
    zoom = Math.min(3, Math.max(1, next));
    clampOffsets();
    drawCrop();
    const label = root.querySelector('.ocr-zoom-value');
    if (label) label.textContent = `${Math.round(zoom * 100)}%`;
  }

  function renderCrop() {
    root.replaceChildren();
    const head = header(t('ocrTitle'), t('ocrCropHint'));
    root.append(head);
    const body = element('div', 'ocr-crop');
    body.append(accuracyWarning());
    stage = element('div', 'ocr-stage');
    canvas = element('canvas', 'ocr-canvas');
    canvas.setAttribute('aria-label', t('ocrPhoto'));
    stage.append(canvas);
    body.append(stage);
    const zoomWrap = element('label', 'ocr-zoom');
    const zoomText = element('span', '', t('ocrZoom'));
    const range = element('input');
    range.type = 'range';
    range.min = '1';
    range.max = '3';
    range.step = '0.01';
    range.value = '1';
    const value = element('span', 'ocr-zoom-value', '100%');
    zoomWrap.append(zoomText, range, value);
    range.addEventListener('input', () => applyZoom(Number(range.value)));
    body.append(zoomWrap);
    const actions = element('div', 'dialog-actions ocr-actions');
    const retake = button(t('ocrRetake'), 'button ghost');
    retake.addEventListener('click', () => { if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = ''; image = null; renderSource(); });
    const recognize = button(t('ocrRecognize'), 'button primary');
    recognize.addEventListener('click', () => recognizeCrop());
    actions.append(retake, recognize);
    body.append(actions);
    root.append(body);
    requestAnimationFrame(() => {
      if (!stage || !canvas || !image) return;
      canvas.style.height = `${Math.min(430, Math.max(250, Math.round(stage.clientWidth * 0.56)))}px`;
      frame = initialFrame(canvas.clientWidth, canvas.clientHeight);
      drawCrop();
    });
    stage.addEventListener('pointerdown', (event) => {
      if (!canvas || !frame) return;
      const rect = canvas.getBoundingClientRect();
      const pointX = event.clientX - rect.left;
      const pointY = event.clientY - rect.top;
      const handle = frameHit(pointX, pointY);
      if (handle) {
        drag = { mode: 'resize', handle, x: event.clientX, y: event.clientY, frame: { ...frame } };
      } else if (pointX >= frame.x && pointX <= frame.x + frame.w && pointY >= frame.y && pointY <= frame.y + frame.h) {
        drag = { mode: 'frame', x: event.clientX, y: event.clientY, frame: { ...frame } };
      } else {
        drag = { mode: 'image', x: event.clientX, y: event.clientY, offsetX, offsetY };
      }
      stage.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    stage.addEventListener('pointermove', (event) => {
      if (!canvas || !frame) return;
      if (!drag) {
        const rect = canvas.getBoundingClientRect();
        canvas.style.cursor = cropCursor(event.clientX - rect.left, event.clientY - rect.top);
        return;
      }
      const deltaX = event.clientX - drag.x;
      const deltaY = event.clientY - drag.y;
      if (drag.mode === 'resize') {
        frame = resizeFrame(drag.frame, drag.handle, deltaX, deltaY, canvas.clientWidth, canvas.clientHeight);
      } else if (drag.mode === 'frame') {
        frame = clampFrame({ x: drag.frame.x + deltaX, y: drag.frame.y + deltaY, w: drag.frame.w, h: drag.frame.h }, canvas.clientWidth, canvas.clientHeight);
      } else {
        offsetX = drag.offsetX + deltaX;
        offsetY = drag.offsetY + deltaY;
      }
      drawCrop();
    });
    const endDrag = () => { drag = null; };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('pointerleave', () => { drag = null; });
  }

  async function recognizeCrop() {
    if (busy || !canvas || !image || !frame) return;
    busy = true;
    const geometry = imageGeometry();
    const left = (geometry.width - geometry.drawWidth) / 2 + offsetX;
    const top = (geometry.height - geometry.drawHeight) / 2 + offsetY;
    const sourceX = Math.max(0, (frame.x - left) / geometry.scale);
    const sourceY = Math.max(0, (frame.y - top) / geometry.scale);
    const sourceWidth = Math.min(image.naturalWidth - sourceX, frame.w / geometry.scale);
    const sourceHeight = Math.min(image.naturalHeight - sourceY, frame.h / geometry.scale);
    const output = document.createElement('canvas');
    const scale = Math.min(1, MAX_OUTPUT / Math.max(sourceWidth, sourceHeight));
    output.width = Math.max(1, Math.round(sourceWidth * scale));
    output.height = Math.max(1, Math.round(sourceHeight * scale));
    output.getContext('2d').drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, output.width, output.height);
    const blob = await prepareBlob(output);
    if (!blob) { busy = false; showToast(t('ocrFailed')); return; }
    lastBlob = blob;
    await sendForRecognition(blob);
  }

  async function sendForRecognition(blob) {
    if (busy && !lastBlob) return;
    busy = true;
    root.replaceChildren();
    const body = element('div', 'ocr-loading');
    body.append(element('span', 'ocr-spinner'), element('p', '', t('ocrRecognizing')));
    root.append(header(t('ocrTitle')), body);
    try {
      const image64 = await blobToBase64(blob);
      const response = await fetch('/api/ocr', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        body: JSON.stringify({ image: image64, mime: 'image/jpeg', context: target === 'stoich-equation' ? 'stoichiometry' : target === 'auto-input' ? 'auto' : 'calculator' })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) { renderLogin(); return; }
        if (response.status === 429) {
          renderError(data?.error?.message || t('ocrQuotaExceeded'));
          return;
        }
        renderError(data?.error?.message || t('ocrFailed'));
        return;
      }
      quota = data.unlimited
        ? { ...quota, unlimited: true, limit: null, remaining: null, used: Number(quota.used || 0) + 1 }
        : { ...quota, used: quota.limit - (data.remaining ?? 0), remaining: Number(data.remaining ?? 0), limit: Number(data.limit || quota.limit) };
      renderResult(String(data.text || ''), data.provider, data.confidence);
    } catch {
      renderError(t('ocrFailed'));
    } finally {
      busy = false;
    }
  }

  function renderError(message) {
    root.replaceChildren();
    const body = element('div', 'ocr-login');
    body.append(element('p', 'ocr-error', message));
    const actions = element('div', 'dialog-actions');
    const cancel = button(t('ocrCancel'), 'button ghost');
    cancel.addEventListener('click', close);
    const retry = button(t('ocrRetry'), 'button primary');
    retry.addEventListener('click', () => { if (lastBlob) sendForRecognition(lastBlob); else renderSource(); });
    actions.append(cancel, retry);
    body.append(actions);
    root.append(header(t('ocrTitle')), body);
  }

  function renderResult(text, provider, confidence) {
    root.replaceChildren();
    const body = element('div', 'ocr-result');
    body.append(quotaLine(), accuracyWarning());
    const resultLabel = element('label', 'review-label', t('ocrResult'));
    const textarea = element('textarea', 'ocr-result-input');
    textarea.rows = 3;
    textarea.value = text;
    textarea.setAttribute('aria-label', t('ocrResult'));
    resultLabel.htmlFor = 'ocr-result-text';
    textarea.id = 'ocr-result-text';
    const meta = element('p', 'help-text');
    const confidenceValue = confidence === null || confidence === undefined ? null : Number(confidence);
    meta.textContent = `${provider === 'tesseract' ? t('ocrProviderTesseract') : t('ocrProviderSpace')}${Number.isFinite(confidenceValue) ? ` · ${t('ocrConfidence')}: ${Math.round(confidenceValue * 100)}%` : ''}`;
    body.append(resultLabel, textarea, element('p', 'help-text', t('ocrResultHint')), meta);
    const actions = element('div', 'dialog-actions ocr-actions');
    const retake = button(t('ocrRetake'), 'button ghost');
    retake.addEventListener('click', () => { if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = ''; image = null; renderSource(); });
    const cancel = button(t('ocrCancel'), 'button ghost');
    cancel.addEventListener('click', close);
    const insert = button(t('ocrInsert'), 'button primary');
    insert.addEventListener('click', () => insertText(textarea.value));
    actions.append(cancel, retake, insert);
    body.append(actions);
    root.append(header(t('ocrTitle')), body);
    textarea.focus();
  }

  function insertText(raw) {
    const input = document.getElementById(target);
    if (!input) return;
    let value = String(raw || '').trim();
    if (!value) return;
    if (target === 'auto-input') value = splitReactants(value);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
    close();
    showToast(t('ocrInserted'));
  }

  async function open(inputId) {
    target = inputId;
    busy = false;
    lastBlob = null;
    try {
      const session = await fetch('/api/auth/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!session.ok) { dialog.showModal(); renderLogin(); return; }
      const sessionData = await session.json();
      csrf = sessionData.csrfToken || '';
      const quotaResponse = await fetch('/api/ocr/quota', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!quotaResponse.ok) { dialog.showModal(); renderLogin(); return; }
      quota = await quotaResponse.json();
      dialog.showModal();
      if (!quota.unlimited && Number(quota.remaining) <= 0) renderQuota(); else renderSource();
    } catch {
      dialog.showModal();
      renderError(t('ocrFailed'));
    }
  }

  for (const trigger of document.querySelectorAll('.ocr-trigger')) {
    trigger.addEventListener('click', () => open(trigger.dataset.ocrTarget));
  }
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  dialog.addEventListener('close', stopCamera);
  dialog.addEventListener('cancel', stopCamera);
  window.addEventListener('beforeunload', () => { stopCamera(); if (imageUrl) URL.revokeObjectURL(imageUrl); });
}
