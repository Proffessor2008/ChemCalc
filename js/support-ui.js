import { t } from './i18n.js';

const MAX_PHOTOS = 3;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatDate(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label, className = 'button secondary', type = 'button') {
  const node = element('button', className, label);
  node.type = type;
  return node;
}

function statusLabel(status) {
  return t({ new: 'supportStatusNew', open: 'supportStatusOpen', waiting_user: 'supportStatusWaiting', resolved: 'supportStatusResolved', closed: 'supportStatusClosed', deleted: 'supportStatusDeleted' }[status] || 'supportStatusOpen');
}

function roleLabel(role) {
  return role === 'GOD' ? 'GOD' : role === 'admin+' ? 'admin+' : role === 'admin' ? 'admin' : '';
}

export function initSupportUI({ showToast = () => {} } = {}) {
  const dialog = document.getElementById('support-dialog');
  const root = document.getElementById('support-app');
  if (!dialog || !root) return { refresh: () => {} };

  let user = null;
  let csrf = '';
  let categories = [];
  let threads = [];
  let thread = null;
  let view = 'list';
  let scope = 'mine';
  let status = '';
  let query = '';
  let categoriesLoaded = false;
  let pendingPhotos = [];
  let loading = false;
  let badgeTimer = null;
  let lastFocused = null;

  const isStaff = () => Boolean(user && ['admin+', 'GOD'].includes(user.privileges));

  async function api(path, { method = 'GET', body } = {}) {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({ error: { message: t('serverUnavailable') } }));
    if (!response.ok) {
      const error = new Error(data?.error?.message || t('serverUnavailable'));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function toastError(error) {
    if (error?.status === 401) {
      user = null;
      renderLogin();
      return;
    }
    showToast(error?.message || t('supportAttachmentError'));
  }

  async function refreshBadge() {
    if (!user) {
      document.getElementById('support-badge')?.setAttribute('hidden', '');
      return;
    }
    try {
      const data = await api('/api/support/unread');
      const badge = document.getElementById('support-badge');
      if (!badge) return;
      const count = Number(data.unread || 0);
      badge.textContent = String(Math.min(count, 99));
      badge.hidden = count <= 0;
    } catch { /* не мешаем основному интерфейсу */ }
  }

  function setHeader(title, subtitle = '') {
    const header = element('div', 'support-head');
    const left = element('div', 'support-head-main');
    const back = button('←', 'icon-button support-back', 'button');
    back.setAttribute('aria-label', t('supportBack'));
    back.addEventListener('click', () => {
      if (view === 'thread' || view === 'new') {
        view = 'list';
        thread = null;
        loadThreads();
      } else {
        close();
      }
    });
    left.append(back);
    const heading = element('div');
    const titleNode = element('h2', '', title);
    titleNode.id = 'support-dialog-title';
    heading.append(titleNode);
    if (subtitle) heading.append(element('p', 'help-text', subtitle));
    left.append(heading);
    header.append(left);
    const right = element('div', 'support-head-actions');
    if (isStaff()) {
      const inbox = button(scope === 'inbox' ? t('supportMy') : t('supportInbox'), 'text-button');
      inbox.addEventListener('click', () => {
        scope = scope === 'inbox' ? 'mine' : 'inbox';
        view = 'list';
        thread = null;
        loadThreads();
      });
      right.append(inbox);
    }
    const closeButton = button('×', 'icon-button', 'button');
    closeButton.setAttribute('aria-label', t('close'));
    closeButton.addEventListener('click', close);
    right.append(closeButton);
    header.append(right);
    return header;
  }

  function renderShell(content, title = t('supportTitle'), subtitle = '') {
    root.replaceChildren();
    root.append(setHeader(title, subtitle));
    const body = element('div', 'support-body');
    body.append(content);
    root.append(body);
  }

  function renderLoading() {
    const loadingNode = element('div', 'support-empty');
    loadingNode.append(element('p', 'help-text', t('supportSending')));
    renderShell(loadingNode);
  }

  function renderLogin() {
    const box = element('div', 'support-empty');
    box.append(element('div', 'support-orb', '✳'), element('h3', '', t('supportLoginHint')));
    const login = button(t('supportLogin'), 'button primary');
    login.addEventListener('click', () => {
      close();
      document.querySelector('[data-tab="account"]')?.click();
    });
    box.append(login);
    renderShell(box);
  }

  function emptyState(text) {
    const box = element('div', 'support-empty');
    box.append(element('div', 'support-orb', '✦'), element('p', 'help-text', text));
    return box;
  }

  function statusChip(value) {
    const chip = element('span', `support-status support-status-${value}`, statusLabel(value));
    return chip;
  }

  function roleChip(role) {
    if (!role) return null;
    return element('span', `support-role${role === 'GOD' ? ' god' : ''}`, roleLabel(role));
  }

  function authorLine(author) {
    const line = element('div', 'support-author');
    line.append(element('strong', '', author?.nickname || author?.login || t('supportUser')));
    const role = roleChip(author?.privileges);
    if (role) line.append(role);
    return line;
  }

  function threadCard(item) {
    const card = element('article', `support-card${item.unread ? ' unread' : ''}`);
    const top = element('div', 'support-card-top');
    top.append(element('span', 'support-number', item.number), statusChip(item.status));
    card.append(top);
    card.append(element('h3', '', item.subject));
    const meta = element('div', 'support-card-meta');
    meta.append(element('span', '', item.category_label));
    if (scope === 'inbox') meta.append(element('span', '', item.author?.nickname || item.author?.login || ''));
    meta.append(element('span', '', formatDate(item.last_message_at)));
    if (item.unread) meta.append(element('span', 'support-unread', String(item.unread)));
    card.append(meta);
    card.addEventListener('click', () => openThread(item.id));
    return card;
  }

  function renderList() {
    const wrapper = element('div', 'support-list-wrap');
    const toolbar = element('div', 'support-toolbar');
    const filters = element('div', 'support-filters');
    const statuses = [
      ['', t('supportFilterAll')],
      ['new', statusLabel('new')],
      ['open', statusLabel('open')],
      ['waiting_user', statusLabel('waiting_user')],
      ['resolved', statusLabel('resolved')],
      ['closed', statusLabel('closed')]
    ];
    if (scope === 'inbox' && user?.privileges === 'GOD') statuses.push(['deleted', t('supportFilterDeleted')]);
    for (const [value, label] of statuses) {
      const chip = button(label, `support-filter${status === value ? ' active' : ''}`);
      chip.addEventListener('click', () => { status = value; loadThreads(); });
      filters.append(chip);
    }
    toolbar.append(filters);
    const newButton = button(`+ ${t('supportNew')}`, 'button primary');
    newButton.addEventListener('click', () => { view = 'new'; pendingPhotos = []; renderNew(); });
    const refresh = button('↻', 'icon-button');
    refresh.title = t('supportTime');
    refresh.addEventListener('click', () => loadThreads());
    toolbar.append(refresh, newButton);
    wrapper.append(toolbar);

    const search = element('input', 'support-search');
    search.type = 'search';
    search.placeholder = t('supportSearch');
    search.value = query;
    search.addEventListener('change', () => { query = search.value; loadThreads(); });
    wrapper.append(search);

    if (loading) wrapper.append(element('p', 'help-text', t('supportSending')));
    else if (!threads.length) wrapper.append(emptyState(scope === 'inbox' ? t('supportInboxEmpty') : t('supportEmpty')));
    else {
      const list = element('div', 'support-list');
      for (const item of threads) list.append(threadCard(item));
      wrapper.append(list);
    }
    renderShell(wrapper, scope === 'inbox' ? t('supportInbox') : t('supportMy'), isStaff() ? `${t('supportStaff')}: ${roleLabel(user.privileges)}` : '');
  }

  function renderCategoryField(selected = '') {
    const label = element('label', 'support-field');
    label.append(element('span', '', t('supportCategory')));
    const select = element('select');
    select.id = 'support-category';
    select.required = true;
    for (const category of categories) {
      const option = element('option', '', category.label);
      option.value = category.key;
      option.selected = category.key === selected;
      select.append(option);
    }
    label.append(select);
    const hint = element('small', 'help-text');
    hint.id = 'support-category-hint';
    hint.textContent = categories.find((item) => item.key === (selected || categories[0]?.key))?.hint || '';
    select.addEventListener('change', () => { hint.textContent = categories.find((item) => item.key === select.value)?.hint || ''; });
    label.append(hint);
    return label;
  }

  function photoPicker(kind = 'new') {
    const wrap = element('div', 'support-photo-field');
    wrap.append(element('span', 'support-label', t('supportPhotos')));
    const input = element('input', 'support-photo-input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.multiple = true;
    const preview = element('div', 'support-photo-preview');
    const hint = element('small', 'help-text', t('supportPhotoHint'));
    const add = button(`+ ${t('supportAddPhotos')}`, 'button ghost');
    add.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      for (const file of [...(input.files || [])]) {
        if (pendingPhotos.length >= MAX_PHOTOS) { showToast(t('supportMaxPhotos')); break; }
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { showToast(t('invalidAttachment')); continue; }
        try {
          const prepared = await preparePhoto(file);
          pendingPhotos.push(prepared);
          const image = element('img');
          image.src = URL.createObjectURL(prepared);
          image.alt = prepared.name;
          const item = element('span', 'support-photo');
          const remove = button('×', 'support-photo-remove');
          remove.addEventListener('click', () => {
            pendingPhotos = pendingPhotos.filter((photo) => photo !== prepared);
            URL.revokeObjectURL(image.src);
            item.remove();
          });
          item.append(image, remove);
          preview.append(item);
        } catch { showToast(t('supportAttachmentError')); }
      }
      input.value = '';
    });
    wrap.append(add, hint, input, preview);
    return wrap;
  }

  function renderNew() {
    const form = element('form', 'support-form');
    form.append(renderCategoryField());
    const subject = element('label', 'support-field');
    subject.append(element('span', '', t('supportSubject')));
    const subjectInput = element('input');
    subjectInput.id = 'support-subject';
    subjectInput.maxLength = 160;
    subjectInput.placeholder = t('supportSubjectPlaceholder');
    subjectInput.required = true;
    subject.append(subjectInput);
    form.append(subject);
    const body = element('label', 'support-field');
    body.append(element('span', '', t('supportBody')));
    const bodyInput = element('textarea');
    bodyInput.id = 'support-body';
    bodyInput.rows = 8;
    bodyInput.maxLength = 8000;
    bodyInput.placeholder = t('supportBodyPlaceholder');
    bodyInput.required = true;
    body.append(bodyInput);
    form.append(body, photoPicker('new'));
    const actions = element('div', 'support-form-actions');
    const cancel = button(t('cancel'), 'button ghost');
    cancel.addEventListener('click', () => { view = 'list'; pendingPhotos = []; renderList(); });
    const submit = button(t('supportSend'), 'button primary', 'submit');
    actions.append(cancel, submit);
    form.append(actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!subjectInput.value.trim() || !bodyInput.value.trim()) return;
      submit.disabled = true;
      submit.textContent = t('supportSending');
      try {
        const attachments = await uploadPhotos();
        const data = await api('/api/support/threads', {
          method: 'POST',
          body: {
            category: document.getElementById('support-category').value,
            subject: subjectInput.value,
            body: bodyInput.value,
            attachments
          }
        });
        pendingPhotos = [];
        thread = data.thread;
        view = 'thread';
        renderThread();
        await refreshBadge();
      } catch (error) {
        toastError(error);
        submit.disabled = false;
        submit.textContent = t('supportSend');
      }
    });
    renderShell(form, t('supportNew'));
  }

  function renderThread() {
    if (!thread) { renderList(); return; }
    const wrapper = element('div', 'support-thread');
    const head = element('div', 'support-thread-head');
    const title = element('div');
    title.append(element('span', 'support-number', thread.number), element('h3', '', thread.subject));
    head.append(title, statusChip(thread.status));
    wrapper.append(head);
    const meta = element('div', 'support-thread-meta');
    meta.append(element('span', '', `${thread.category_label} · ${formatDate(thread.created_at)}`));
    if (thread.assigned_nickname) meta.append(element('span', '', `${t('supportAssigned')}: ${thread.assigned_nickname}`));
    wrapper.append(meta);

    if (thread.status === 'deleted') {
      const notice = element('p', 'support-notice danger');
      notice.textContent = `${t('supportStatusDeleted')}: ${thread.delete_reason || ''}`;
      wrapper.append(notice);
    }
    if (thread.status === 'closed') {
      const notice = element('p', 'support-notice');
      notice.textContent = thread.resolution_note || t('supportStatusClosed');
      wrapper.append(notice);
    }

    const messages = element('div', 'support-messages');
    if (!thread.messages?.length) messages.append(element('p', 'help-text', t('supportNoMessages')));
    for (const message of thread.messages || []) {
      const item = element('article', `support-message${message.visibility === 'internal' ? ' internal' : ''}${message.author.id === user.id ? ' mine' : ''}`);
      const top = element('div', 'support-message-top');
      top.append(authorLine(message.author));
      top.append(element('span', 'support-time', formatDate(message.created_at)));
      item.append(top);
      const text = element('div', 'support-message-body');
      text.textContent = message.body;
      item.append(text);
      if (message.attachments?.length) {
        const attachments = element('div', 'support-attachments');
        for (const attachment of message.attachments) {
          const image = element('img');
          image.src = `/api/support/attachments/${encodeURIComponent(attachment.id)}`;
          image.alt = attachment.filename;
          image.loading = 'lazy';
          const link = element('a');
          link.href = image.src;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.append(image);
          attachments.append(link);
        }
        item.append(attachments);
      }
      if (message.visibility === 'internal') {
        item.append(element('span', 'support-internal-badge', t('supportInternal')));
      }
      messages.append(item);
    }
    wrapper.append(messages);

    if (thread.events?.length && isStaff()) {
      const events = element('details', 'support-events');
      events.append(element('summary', '', `${t('supportStaff')} · ${thread.events.length}`));
      for (const event of thread.events) events.append(element('p', 'help-text', `${formatDate(event.created_at)} · ${event.actor_nickname || 'system'} · ${event.action}${event.note ? ` — ${event.note}` : ''}`));
      wrapper.append(events);
    }

    if (thread.status !== 'closed' && thread.status !== 'deleted') {
      const reply = element('form', 'support-reply');
      const textarea = element('textarea');
      textarea.rows = 3;
      textarea.maxLength = 8000;
      textarea.placeholder = t('supportReply');
      reply.append(textarea, photoPicker('reply'));
      let internal = null;
      if (isStaff()) {
        const label = element('label', 'support-internal-toggle');
        internal = element('input');
        internal.type = 'checkbox';
        label.append(internal, element('span', '', t('supportInternal')));
        reply.append(label);
        reply.append(element('small', 'help-text', t('supportInternalHint')));
      }
      const actions = element('div', 'support-form-actions');
      const submit = button(t('supportSend'), 'button primary', 'submit');
      actions.append(submit);
      reply.append(actions);
      reply.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!textarea.value.trim()) return;
        submit.disabled = true;
        try {
          const attachments = await uploadPhotos();
          const data = await api(`/api/support/threads/${thread.id}/messages`, {
            method: 'POST',
            body: { body: textarea.value, attachments, internal: Boolean(internal?.checked) }
          });
          pendingPhotos = [];
          thread = data.thread;
          renderThread();
          await refreshBadge();
        } catch (error) {
          toastError(error);
        } finally {
          submit.disabled = false;
        }
      });
      wrapper.append(reply);
      if (thread.helpful_at) wrapper.append(element('p', 'help-text', t('supportHelpfulDone')));
      else if (!isStaff() && thread.status !== 'closed') {
        const helpful = button(t('supportHelpful'), 'text-button');
        helpful.addEventListener('click', async () => {
          try {
            await api(`/api/support/threads/${thread.id}/helpful`, { method: 'POST', body: {} });
            thread.helpful_at = new Date().toISOString();
            renderThread();
          } catch (error) { toastError(error); }
        });
        wrapper.append(helpful);
      }
    }

    if (isStaff()) {
      const actions = element('div', 'support-staff-actions');
      if (thread.status !== 'closed' && thread.status !== 'deleted') {
        const close = button(t('supportClose'), 'button primary');
        close.addEventListener('click', async () => {
          const note = await askText(t('supportCloseNote'), t('supportCloseNotePlaceholder'));
          if (note === null) return;
          try {
            const data = await api(`/api/support/threads/${thread.id}/close`, { method: 'POST', body: { note } });
            thread = data.thread;
            renderThread();
          } catch (error) { toastError(error); }
        });
        actions.append(close);
      }
      if (thread.status === 'closed') {
        const reopen = button(t('supportReopen'), 'button secondary');
        reopen.addEventListener('click', async () => {
          try {
            const data = await api(`/api/support/threads/${thread.id}/reopen`, { method: 'POST', body: {} });
            thread = data.thread;
            renderThread();
          } catch (error) { toastError(error); }
        });
        actions.append(reopen);
      }
      if (!thread.assigned_to && thread.status !== 'deleted') {
        const take = button(t('supportTake'), 'text-button');
        take.addEventListener('click', async () => {
          try {
            await api(`/api/support/threads/${thread.id}/assign`, { method: 'POST', body: { userId: user.id } });
            await openThread(thread.id);
          } catch (error) { toastError(error); }
        });
        actions.append(take);
      }
      if (thread.status !== 'deleted') {
        const remove = button(t('supportDelete'), 'text-button danger');
        remove.addEventListener('click', async () => {
          const reason = await askText(t('supportDeleteReason'), t('supportDeleteReasonPlaceholder'));
          if (reason === null) return;
          if (!reason.trim()) { showToast(t('supportReasonRequired')); return; }
          try {
            await api(`/api/support/threads/${thread.id}/delete`, { method: 'POST', body: { reason } });
            await loadThreads();
          } catch (error) { toastError(error); }
        });
        actions.append(remove);
      }
      if (thread.status === 'deleted' && user.privileges === 'GOD') {
        const restore = button(t('supportRestore'), 'button secondary');
        restore.addEventListener('click', async () => {
          try {
            const data = await api(`/api/support/threads/${thread.id}/restore`, { method: 'POST', body: {} });
            thread = data.thread;
            renderThread();
          } catch (error) { toastError(error); }
        });
        actions.append(restore);
      }
      if (actions.childNodes.length) wrapper.append(actions);
    }
    renderShell(wrapper, t('supportThread'));
  }

  async function askText(title, placeholder) {
    return new Promise((resolve) => {
      const promptDialog = document.createElement('dialog');
      promptDialog.className = 'dialog support-prompt';
      const heading = element('h2', '', title);
      const textarea = element('textarea');
      textarea.rows = 3;
      textarea.maxLength = 1000;
      textarea.placeholder = placeholder || '';
      const actions = element('div', 'dialog-actions');
      const cancel = button(t('cancel'), 'button ghost');
      const confirm = button(t('confirm'), 'button primary');
      actions.append(cancel, confirm);
      promptDialog.append(heading, textarea, actions);
      document.body.append(promptDialog);
      const finish = (value) => { promptDialog.close(); promptDialog.remove(); resolve(value); };
      cancel.addEventListener('click', () => finish(null));
      confirm.addEventListener('click', () => finish(textarea.value));
      promptDialog.addEventListener('cancel', () => finish(null));
      promptDialog.showModal();
      textarea.focus();
    });
  }

  async function openThread(id) {
    try {
      const data = await api(`/api/support/threads/${encodeURIComponent(id)}`);
      thread = data.thread;
      pendingPhotos = [];
      view = 'thread';
      renderThread();
      await refreshBadge();
    } catch (error) { toastError(error); }
  }

  async function loadThreads() {
    loading = true;
    renderList();
    try {
      const params = new URLSearchParams({ scope, ...(status ? { status } : {}), ...(query ? { q: query } : {}) });
      const data = await api(`/api/support/threads?${params}`);
      threads = data.threads || [];
      view = 'list';
      loading = false;
      renderList();
      await refreshBadge();
    } catch (error) {
      loading = false;
      toastError(error);
    }
  }

  async function loadCategories() {
    if (categoriesLoaded) return;
    const data = await api('/api/support/categories');
    categories = data.categories || [];
    categoriesLoaded = true;
  }

  async function preparePhoto(file) {
    const image = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('image'));
        img.onload = () => resolve(img);
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('blob');
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  }

  function readBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read'));
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.readAsDataURL(file);
    });
  }

  async function uploadPhotos() {
    const ids = [];
    for (const photo of pendingPhotos) {
      if (photo.size > 5_000_000) throw new Error(t('attachmentTooLarge'));
      const data = await readBase64(photo);
      const result = await api('/api/support/attachments', { method: 'POST', body: { filename: photo.name, type: photo.type, data } });
      ids.push(result.attachment.id);
    }
    return ids;
  }

  async function open() {
    lastFocused = document.activeElement;
    document.getElementById('settings-dialog')?.close();
    dialog.showModal();
    renderLoading();
    try {
      const session = await api('/api/auth/me');
      user = session.user;
      csrf = session.csrfToken;
      await loadCategories();
      await loadThreads();
    } catch (error) {
      if (error.status === 401) { user = null; csrf = ''; renderLogin(); return; }
      toastError(error);
      renderLogin();
    }
  }

  function close() {
    if (dialog.open) dialog.close();
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  document.getElementById('support-open')?.addEventListener('click', open);
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  dialog.addEventListener('close', () => { pendingPhotos = []; });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshBadge(); });
  window.addEventListener('pagehide', () => { if (badgeTimer) clearInterval(badgeTimer); });
  badgeTimer = setInterval(() => { if (!document.hidden) refreshBadge(); }, 60000);

  // Повторная проверка сессии при открытии страницы: бейдж не должен быть устаревшим.
  api('/api/auth/me').then((session) => { user = session.user; csrf = session.csrfToken; refreshBadge(); }).catch(() => {});
  return { refresh: refreshBadge };
}
