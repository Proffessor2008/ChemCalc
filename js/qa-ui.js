import { getLocale, t } from './i18n.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const formatTime = (iso) => {
  try {
    const date = new Date(iso);
    const now = Date.now();
    const diff = now - date.getTime();
    if (diff >= 0 && diff < 86400000) {
      return new Intl.DateTimeFormat(getLocale(), { timeStyle: 'short' }).format(date);
    }
    return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  } catch { return iso || ''; }
};
const formatDate = (iso) => { try { return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(new Date(iso)); } catch { return iso || ''; } };
const isModerator = (user) => Boolean(user && ['admin', 'admin+', 'GOD'].includes(user.privileges));
const countLabel = (count, singularKey, pluralKey) => `${count} ${Math.abs(Number(count)) === 1 ? t(singularKey) : t(pluralKey)}`;
const unitLabel = (count, singularKey, pluralKey) => (Math.abs(Number(count)) === 1 ? t(singularKey) : t(pluralKey));
const FORMATS = { bold: ['**', '**'], italic: ['*', '*'], code: ['`', '`'], list: ['\n- ', ''], quote: ['\n> ', ''] };

function renderMarkdown(text) {
  const source = escapeHtml(text);
  const inline = (line) => line
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
  const lines = source.split(/\r?\n/);
  const html = [];
  let list = null;
  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) {
      list = list || [];
      list.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (list) { html.push(`<ul>${list.join('')}</ul>`); list = null; }
    if (/^&gt;\s?/.test(line)) { html.push(`<blockquote>${inline(line.replace(/^&gt;\s?/, ''))}</blockquote>`); continue; }
    html.push(`<p>${inline(line)}</p>`);
  }
  if (list) html.push(`<ul>${list.join('')}</ul>`);
  return html.join('') || '<p></p>';
}

export function initQAUI({ container, api, auth, showToast, onDeepLink = () => {}, onLoginRequired = () => {} }) {
  const state = {
    sort: 'score',
    selectedTags: new Set(),
    allTags: [],
    tagsOpen: false,
    tagsLoaded: false,
    myOnly: false,
    page: 1,
    pagination: null,
    questions: [],
    detail: null,
    view: 'list',
    commentDrafts: new Map(),
    answerDrafts: new Map(),
    openComments: new Set()
  };

  const user = () => auth().user;
  const moderator = () => isModerator(user());
  const $ = (selector) => container.querySelector(selector);
  const messageFor = (error) => (error && error.status === 404 ? t('serverOutdated') : error?.message || '');
  const MAX_DRAFT_ENTRIES = 100;
  const trimDrafts = (map) => {
    while (map.size > MAX_DRAFT_ENTRIES) map.delete(map.keys().next().value);
  };
  let toolbar = null;

  function voteMarkup(type, id, score, viewerVote) {
    const canVote = Boolean(user());
    return `<div class="qa-vote">
      <button type="button" data-qa-vote="${type}:${id}" data-value="1" class="qa-vote-up${viewerVote === 1 ? ' voted' : ''}" aria-label="+1" ${canVote ? '' : 'disabled'}>▲</button>
      <strong>${Number(score) || 0}</strong>
      <button type="button" data-qa-vote="${type}:${id}" data-value="-1" class="qa-vote-down${viewerVote === -1 ? ' voted' : ''}" aria-label="−1" ${canVote ? '' : 'disabled'}>▼</button>
    </div>`;
  }

  function tagChips(list, className = 'qa-tags') {
    if (!Array.isArray(list) || !list.length) return '';
    return `<div class="${className}">${list.map((tag) => `<button type="button" class="qa-tag" data-qa-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('')}</div>`;
  }

  function authorCard(login, reputation, avatar = '') {
    const face = avatar
      ? `<img src="${escapeHtml(avatar)}" alt="" loading="lazy" decoding="async">`
      : escapeHtml(String(login || '?').slice(0, 1).toUpperCase());
    return `<div class="qa-author"><span class="qa-avatar">${face}</span><div><strong>${escapeHtml(login || '')}</strong><small>${t('qaReputation')}: ${Number(reputation) || 0}</small></div></div>`;
  }

  function editsMarkup(edits) {
    if (!Array.isArray(edits) || !edits.length) return '';
    const items = edits.map((edit) => {
      const titleChange = edit.title_before !== null && edit.title_after !== null && edit.title_before !== edit.title_after
        ? `<br><small>${t('questionTitleLabel')}: ${escapeHtml(edit.title_before)} → ${escapeHtml(edit.title_after)}</small>` : '';
      return `<li><strong>${escapeHtml(edit.editor_login)}</strong> · ${formatTime(edit.created_at)}${edit.reason ? ` — ${escapeHtml(edit.reason)}` : ''}${titleChange}<br><small>${escapeHtml(String(edit.body_before || '').slice(0, 160))} → ${escapeHtml(String(edit.body_after || '').slice(0, 160))}</small></li>`;
    }).join('');
    return `<details class="qa-history"><summary>${t('editHistory')} · ${edits.length}</summary><ul>${items}</ul></details>`;
  }

  function commentList(comments, type, id) {
    const target = `${type}:${id}`;
    const rows = (comments || []).map((comment) => {
      const canDelete = Boolean(user() && (Number(comment.author_id) === Number(user().id) || ['admin', 'admin+', 'GOD'].includes(user().privileges)));
      return `<li class="qa-comment"><span class="qa-comment-author">${escapeHtml(comment.author_login)}</span> <span class="qa-comment-body">${escapeHtml(comment.body)}</span> <span class="qa-time">${formatTime(comment.created_at)}</span>${canDelete ? ` <button type="button" class="text-button danger-text qa-comment-delete" data-qa-delete-comment="${escapeHtml(comment.id)}">${t('delete')}</button>` : ''}</li>`;
    }).join('');
    const canComment = Boolean(user());
    if (!canComment) return `<div class="qa-comments">${rows ? `<ul>${rows}</ul>` : ''}</div>`;
    const draft = state.commentDrafts.get(target) || '';
    const remaining = Math.max(0, 5 - draft.trim().length);
    const hint = remaining > 0 ? t('commentMin', { count: remaining }) : t('commentReady');
    const open = state.openComments.has(target);
    return `<div class="qa-comments">
      ${rows ? `<ul>${rows}</ul>` : ''}
      <button type="button" class="text-button qa-comment-open" data-qa-comment="${target}">${t('addComment')}</button>
      <div class="qa-comment-editor" data-comment-form="${target}" ${open ? '' : 'hidden'}>
        <textarea rows="3" maxlength="1000" placeholder="${t('commentPlaceholder')}" data-comment-input="${target}">${escapeHtml(draft)}</textarea>
        <div class="qa-comment-hint${remaining > 0 ? '' : ' ready'}" data-comment-hint="${target}">${escapeHtml(hint)}</div>
        <div class="qa-form-actions">
          <button type="button" class="button ghost" data-qa-comment-cancel="${target}">${t('cancel')}</button>
          <button type="button" class="button primary" data-qa-submit-comment="${target}"${remaining > 0 ? ' disabled' : ''}>${t('addComment')}</button>
        </div>
      </div>
    </div>`;
  }

  function questionCard(question) {
    const answered = question.has_accepted ? ' accepted' : '';
    return `<article class="qa-row">
      <div class="qa-stats">
        <span><strong>${Number(question.score) || 0}</strong> ${unitLabel(question.score, 'voteSingular', 'votesLabel')}</span>
        <span class="qa-stat-answers${answered}">${countLabel(question.answers_count, 'answerSingular', 'answersLabel')}</span>
        <span><strong>${question.views || 0}</strong> ${unitLabel(question.views, 'viewSingular', 'viewsLabel')}</span>
      </div>
      <div class="qa-row-main">
        <button type="button" class="qa-row-title" data-qa-open="${question.id}">${escapeHtml(question.title)}${question.closed ? ` <span class="qa-closed-badge">${t('closedBy')}</span>` : ''}</button>
        ${tagChips(question.tags, 'qa-row-tags')}
      </div>
      <div class="qa-row-meta">
        ${authorCard(question.author_login, question.author_reputation, question.author_avatar)}
        <span class="qa-time">${t('qaEdited')} ${formatTime(question.updated_at)}</span>
      </div>
    </article>`;
  }

  function paginationMarkup() {
    const value = state.pagination;
    if (!value || value.pages <= 1) return '';
    return `<nav class="pagination"><button type="button" class="button ghost" data-qa-page="${value.page - 1}" ${value.hasPrev ? '' : 'disabled'}>${t('previousPage')}</button><span class="help-text">${t('pageOf', { page: value.page, pages: value.pages, total: value.total })}</span><button type="button" class="button ghost" data-qa-page="${value.page + 1}" ${value.hasNext ? '' : 'disabled'}>${t('nextPage')}</button></nav>`;
  }

  function renderList() {
    $('#qa-content').innerHTML = state.questions.length
      ? `<div class="qa-list">${state.questions.map(questionCard).join('')}</div>${paginationMarkup()}`
      : `<section class="card empty-state"><span class="empty-symbol">?</span><p>${t('noQuestions')}</p></section>`;
  }

  function renderDetail() {
    const question = state.detail.question;
    const answers = state.detail.answers;
    const answerDraft = state.answerDrafts.get(question.id) || '';
    const canMod = moderator();
    const isAuthor = Boolean(user() && user().id === question.author_id);
    const closedBanner = question.closed
      ? `<div class="qa-closed-banner"><strong>${t('questionClosed')}</strong>: ${escapeHtml(question.closed_reason)}${question.duplicate_of
        ? ` · <button type="button" class="text-button" data-qa-open="${question.duplicate_of}">${escapeHtml(question.duplicate_title || question.duplicate_of)}</button>` : ''}</div>`
      : '';
    const actions = `<div class="qa-actions">
      <button type="button" class="text-button" data-qa-share="${question.id}">${t('shareQuestion')}</button>
      ${canMod ? `<button type="button" class="text-button" data-qa-edit-question>${t('edit')}</button><button type="button" class="text-button danger" data-qa-delete-question>${t('deleteQuestion')}</button>` : ''}
      ${canMod ? (question.closed
        ? `<button type="button" class="text-button" data-qa-reopen>${t('reopenQuestion')}</button>`
        : `<button type="button" class="text-button" data-qa-close>${t('closeQuestion')}</button>`) : ''}
      ${!canMod ? `<button type="button" class="text-button danger" data-qa-flag>${t('flag')}</button>` : ''}
    </div>`;
    const answerBlocks = answers.map((answer) => {
      const canEdit = Boolean(user() && (answer.author_id === user().id || canMod));
      return `<article class="qa-answer${answer.accepted ? ' accepted' : ''}">
        ${voteMarkup('answer', answer.id, answer.score, answer.viewer_vote)}
        <div class="qa-answer-body">
          ${answer.accepted ? `<span class="qa-accepted-badge">${t('acceptedBadge')}</span>` : ''}
          <div class="qa-post-body">${renderMarkdown(answer.body)}</div>
          <div class="qa-actions">
            ${isAuthor ? `<button type="button" class="text-button" data-qa-accept="${answer.id}">${answer.accepted ? t('unmarkUseful') : t('markUseful')}</button>` : ''}
            ${canEdit ? `<button type="button" class="text-button" data-qa-edit-answer="${answer.id}">${t('edit')}</button>` : ''}
            ${canMod ? `<button type="button" class="text-button danger" data-qa-delete-answer="${answer.id}">${t('deleteAnswer')}</button>` : ''}
          </div>
          ${authorCard(answer.author_login, answer.author_reputation, answer.author_avatar)}
          ${editsMarkup(answer.edits)}
          ${commentList(answer.comments, 'answer', answer.id)}
        </div>
      </article>`;
    }).join('');
    const answerForm = question.closed
      ? `<p class="notice">${t('questionClosed')}${question.closed_reason ? `: ${escapeHtml(question.closed_reason)}` : ''}</p>`
      : user()
        ? `<section class="card qa-answer-form"><h3>${t('writeAnswer')}</h3><textarea id="qa-answer-text" rows="5" maxlength="8000">${escapeHtml(answerDraft)}</textarea><div class="qa-form-actions"><button type="button" class="button primary" data-qa-submit-answer>${t('postAnswer')}</button></div></section>`
        : `<p class="notice">${t('loginToParticipate')}</p>`;

    $('#qa-content').innerHTML = `<article class="card qa-detail">
      <div class="qa-detail-top">
        <button type="button" class="text-button" data-qa-list>← ${t('backToQuestions')}</button>
        <h2 class="qa-detail-title">${escapeHtml(question.title)}</h2>
        <div class="qa-meta">${t('qaAsked')} ${formatDate(question.created_at)} · ${t('qaEdited')} ${formatDate(question.updated_at)} · ${t('qaViews')}: ${question.views}</div>
      </div>
      ${closedBanner}
      <div class="qa-detail-grid">
        ${voteMarkup('question', question.id, question.score, question.viewer_vote)}
        <div class="qa-detail-body">
          ${tagChips(question.tags)}
          <div class="qa-post-body">${renderMarkdown(question.body)}</div>
          ${actions}
          <div class="qa-detail-footer">
            ${authorCard(question.author_login, question.author_reputation, question.author_avatar)}
            ${editsMarkup(question.edits)}
            ${commentList(question.comments, 'question', question.id)}
          </div>
        </div>
      </div>
    </article>
    <section class="qa-answers"><h3>${countLabel(answers.length, 'answerSingular', 'answersLabel')}</h3>${answerBlocks || `<p class="help-text">${t('noAnswers')}</p>`}</section>
    ${answerForm}`;
  }

  function formatButtons() {
    return `<div class="qa-editor-toolbar">
      <button type="button" data-qa-format="bold" title="${t('formatBold')}"><b>B</b></button>
      <button type="button" data-qa-format="italic" title="${t('formatItalic')}"><i>I</i></button>
      <button type="button" data-qa-format="code" title="${t('formatCode')}"><code>code</code></button>
      <button type="button" data-qa-format="list" title="${t('formatList')}">•</button>
      <button type="button" data-qa-format="quote" title="${t('formatQuote')}">❝</button>
    </div>`;
  }

  function suggestionsMarkup() {
    if (!state.allTags.length) return '';
    return `<div class="qa-suggestions"><span class="compact-label">${t('tagSuggestions')}</span>${state.allTags.map((tag) => `<button type="button" class="qa-tag" data-qa-suggest="${escapeHtml(tag.name)}">${escapeHtml(tag.name)}</button>`).join('')}</div>`;
  }

  function renderAsk() {
    toolbar.hidden = true;
    $('#qa-content').innerHTML = `<section class="qa-ask-page">
      <div class="card qa-ask-main">
        <button type="button" class="text-button" data-qa-list>← ${t('backToQuestions')}</button>
        <h2>${t('askPageTitle')}</h2>
        <p class="help-text">${t('bodyHint')}</p>
        <label class="qa-field"><span>${t('questionTitleLabel')} *</span><input id="qa-ask-title" maxlength="200" placeholder="${t('questionTitlePlaceholder')}"></label>
        <label class="qa-field"><span>${t('questionBodyLabel')} *</span></label>
        ${formatButtons()}
        <textarea id="qa-ask-body" rows="12" maxlength="8000"></textarea>
        <label class="qa-field"><span>${t('questionTagsLabel')}</span><input id="qa-ask-tags" maxlength="200" placeholder="овр, растворы"></label>
        ${suggestionsMarkup()}
        <div class="qa-form-actions"><button type="button" class="button ghost" data-qa-list>${t('cancel')}</button><button type="button" class="button primary" data-qa-publish>${t('askSubmit')}</button></div>
      </div>
      <aside class="card qa-ask-side">
        <h3>${t('askTipsTitle')}</h3>
        <ul><li>${t('askTip1')}</li><li>${t('askTip2')}</li><li>${t('askTip3')}</li></ul>
      </aside>
    </section>`;
  }

  function renderEditQuestion() {
    const question = state.detail.question;
    toolbar.hidden = true;
    $('#qa-content').innerHTML = `<section class="card qa-ask-main">
      <button type="button" class="text-button" data-qa-list>← ${t('backToQuestions')}</button>
      <h2>${t('editQuestion')}</h2>
      <label class="qa-field"><span>${t('questionTitleLabel')}</span><input id="qa-edit-title" maxlength="200" value="${escapeHtml(question.title)}"></label>
      <label class="qa-field"><span>${t('questionBodyLabel')}</span></label>
      ${formatButtons()}
      <textarea id="qa-edit-body" rows="10" maxlength="8000">${escapeHtml(question.body)}</textarea>
      <label class="qa-field"><span>${t('questionTagsLabel')}</span><input id="qa-edit-tags" maxlength="200" value="${escapeHtml((question.tags || []).join(', '))}"></label>
      <label class="qa-field"><span>${t('changeReason')}</span><input id="qa-edit-reason" maxlength="1000" placeholder="${t('changeReasonHint')}"></label>
      <div class="qa-form-actions"><button type="button" class="button ghost" data-qa-list>${t('cancel')}</button><button type="button" class="button primary" data-qa-save-question>${t('save')}</button></div>
    </section>`;
  }

  function renderEditAnswer(answer) {
    toolbar.hidden = true;
    $('#qa-content').innerHTML = `<section class="card qa-ask-main">
      <button type="button" class="text-button" data-qa-back>← ${t('backToQuestions')}</button>
      <h2>${t('editAnswer')}</h2>
      ${formatButtons()}
      <textarea id="qa-edit-answer-body" rows="10" maxlength="8000">${escapeHtml(answer.body)}</textarea>
      <label class="qa-field"><span>${t('changeReason')}</span><input id="qa-edit-answer-reason" maxlength="1000" placeholder="${t('changeReasonHint')}"></label>
      <div class="qa-form-actions"><button type="button" class="button ghost" data-qa-back>${t('cancel')}</button><button type="button" class="button primary" data-qa-save-answer="${answer.id}">${t('save')}</button></div>
    </section>`;
  }

  async function loadTags() {
    try { state.allTags = (await api('/api/tags')).tags || []; } catch { state.allTags = []; }
    state.tagsLoaded = true;
    renderTagCloud();
  }

  function renderTagCloud() {
    const host = $('#qa-tag-cloud');
    if (!host) return;
    const toggle = $('#qa-tags-toggle');
    if (toggle) toggle.textContent = `${t('tagsFilter')}${state.selectedTags.size ? ` (${state.selectedTags.size})` : ''}`;
    host.innerHTML = state.allTags.length
      ? state.allTags.map((tag) => `<button type="button" class="qa-tag${state.selectedTags.has(tag.name) ? ' active' : ''}" data-qa-tag="${escapeHtml(tag.name)}">${escapeHtml(tag.name)} · ${tag.count}</button>`).join('')
        + (state.selectedTags.size ? `<button type="button" class="text-button" data-qa-clear-tags>${t('clearTags')}</button>` : '')
      : `<span class="help-text">${t('noTags')}</span>`;
  }

  async function loadList({ refreshTags = false } = {}) {
    const query = new URLSearchParams();
    query.set('page', state.page);
    if (state.sort !== 'score') query.set('sort', state.sort);
    for (const tag of state.selectedTags) query.append('tag', tag);
    if (state.myOnly) query.set('author', 'me');
    try {
      const data = await api(`/api/questions?${query}`);
      state.questions = data.questions || [];
      state.pagination = data.pagination || null;
      if (!state.tagsLoaded || refreshTags) await loadTags();
      renderList();
      updateToolbar();
    } catch (error) {
      $('#qa-content').innerHTML = `<p class="notice">${escapeHtml(messageFor(error))}</p>`;
    }
  }

  async function openQuestion(id, { count = true } = {}) {
    try {
      const data = await api(`/api/questions/${id}${count ? '' : '?view=0'}`);
      state.detail = data;
      state.view = 'detail';
      toolbar.hidden = true;
      if (location.hash !== `#q/${id}`) history.replaceState(null, '', `#q/${id}`);
      renderDetail();
    } catch (error) {
      showToast(messageFor(error));
    }
  }

  function showList() {
    state.view = 'list';
    state.detail = null;
    toolbar.hidden = false;
    if (location.hash.startsWith('#q/')) history.replaceState(null, '', `${location.pathname}${location.search}`);
    updateToolbar();
    loadList();
  }

  function showAsk() {
    if (!user()) {
      onLoginRequired();
      showToast(t('loginToParticipate'));
      return;
    }
    state.view = 'ask';
    if (location.hash.startsWith('#q/')) history.replaceState(null, '', `${location.pathname}${location.search}`);
    renderAsk();
  }

  async function publishQuestion() {
    const title = $('#qa-ask-title')?.value.trim() || '';
    const body = $('#qa-ask-body')?.value.trim() || '';
    const tags = $('#qa-ask-tags')?.value || '';
    if (!title || !body) { showToast(`${t('questionTitleLabel')} / ${t('questionBodyLabel')}`); return; }
    try {
      const data = await api('/api/questions', { method: 'POST', body: { title, body, tags } });
      await openQuestion(data.question.id);
      loadTags();
    } catch (error) { showToast(messageFor(error)); }
  }

  async function saveQuestionEdit() {
    const question = state.detail?.question;
    if (!question) return;
    try {
      const data = await api(`/api/questions/${question.id}`, {
        method: 'PATCH',
        body: {
          title: $('#qa-edit-title').value,
          body: $('#qa-edit-body').value,
          tags: $('#qa-edit-tags').value,
          reason: $('#qa-edit-reason').value
        }
      });
      await openQuestion(data.question.id, { count: false });
    } catch (error) { showToast(messageFor(error)); }
  }

  async function saveAnswerEdit(id) {
    try {
      await api(`/api/answers/${id}`, {
        method: 'PATCH',
        body: { body: $('#qa-edit-answer-body').value, reason: $('#qa-edit-answer-reason').value }
      });
      await openQuestion(state.detail.question.id, { count: false });
    } catch (error) { showToast(messageFor(error)); }
  }

  async function submitAnswer() {
    if (!state.detail?.question?.id) return;
    const questionId = state.detail.question.id;
    const text = $('#qa-answer-text');
    if (!text) return;
    try {
      await api('/api/answers', { method: 'POST', body: { questionId, body: text.value } });
      state.answerDrafts.delete(questionId);
      text.value = '';
      await openQuestion(questionId, { count: false });
    } catch (error) { showToast(messageFor(error)); }
  }

  function updateCommentHint(target) {
    const textarea = container.querySelector(`[data-comment-input="${target}"]`);
    const hint = container.querySelector(`[data-comment-hint="${target}"]`);
    const submit = container.querySelector(`[data-qa-submit-comment="${target}"]`);
    if (!textarea || !hint || !submit) return;
    const length = textarea.value.trim().length;
    const remaining = Math.max(0, 5 - length);
    if (remaining > 0) {
      hint.textContent = t('commentMin', { count: remaining });
      hint.classList.remove('ready');
      submit.disabled = true;
    } else {
      hint.textContent = t('commentReady');
      hint.classList.add('ready');
      submit.disabled = false;
    }
  }

  async function deleteComment(id) {
    if (!id || !window.confirm(t('deleteCommentConfirm'))) return;
    try {
      await api(`/api/comments/${encodeURIComponent(id)}`, { method: 'DELETE' });
      showToast(t('commentDeleted'));
      if (state.detail?.question?.id) await openQuestion(state.detail.question.id, { count: false });
    } catch (error) {
      showToast(error.message);
    }
  }

  async function submitComment(target, textarea) {
    const [type, id] = target.split(':');
    const body = textarea.value.trim();
    if (body.length < 5) { updateCommentHint(target); return; }
    try {
      await api(`/api/${type}s/${id}/comment`, { method: 'POST', body: { body } });
      state.commentDrafts.delete(target);
      state.openComments.delete(target);
      await openQuestion(state.detail.question.id, { count: false });
    } catch (error) { showToast(messageFor(error)); }
  }

  async function handleVote(target, value) {
    if (!user()) { showToast(t('loginToParticipate')); return; }
    const [type, id] = target.split(':');
    try {
      if (type === 'question') {
        await api(`/api/questions/${id}/vote`, { method: 'POST', body: { value } });
        if (state.detail) await openQuestion(id, { count: false });
      } else {
        await api(`/api/answers/${id}/vote`, { method: 'POST', body: { value } });
        if (state.detail) await openQuestion(state.detail.question.id, { count: false });
      }
    } catch (error) { showToast(messageFor(error)); }
  }

  async function handleAccept(id) {
    try {
      await api(`/api/answers/${id}/accept`, { method: 'POST' });
      await openQuestion(state.detail.question.id, { count: false });
    } catch (error) { showToast(messageFor(error)); }
  }

  async function shareQuestion(id) {
    const url = `${location.origin}${location.pathname}#q/${id}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        showToast(t('copyLink'));
      } else {
        window.prompt(t('shareQuestion'), url);
      }
    } catch { window.prompt(t('shareQuestion'), url); }
  }

  function openReasonDialog({ title, label, placeholder = '', submitLabel = t('save'), withDuplicate = false, duplicateList = state.questions, onSubmit }) {
    const existing = document.querySelector('#qa-reason-dialog');
    if (existing) existing.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'qa-reason-dialog';
    dialog.className = 'dialog';
    const duplicateOptions = withDuplicate
      ? duplicateList.filter((question) => question.id !== state.detail?.question?.id)
        .map((question) => `<option value="${question.id}">${escapeHtml(question.title)}</option>`).join('')
      : '';
    dialog.innerHTML = `<div class="dialog-heading"><h2>${escapeHtml(title)}</h2><button type="button" class="icon-button" data-close>×</button></div>
      <form>
        <label class="qa-field"><span>${escapeHtml(label)}</span><textarea name="reason" rows="3" required placeholder="${escapeHtml(placeholder)}"></textarea></label>
        ${withDuplicate ? `<label class="qa-field"><span>${t('duplicateLabel')}</span><select name="duplicateOf"><option value="">${t('duplicateNone')}</option>${duplicateOptions}</select></label>` : ''}
        <div class="qa-form-actions"><button type="button" class="button ghost" data-close>${t('cancel')}</button><button type="submit" class="button primary">${escapeHtml(submitLabel)}</button></div>
      </form>`;
    document.body.append(dialog);
    dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => { dialog.close(); dialog.remove(); }));
    dialog.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      try {
        await onSubmit(data);
        dialog.close();
        dialog.remove();
      } catch (error) { showToast(messageFor(error)); }
    });
    dialog.showModal();
  }

  function deleteQuestion() {
    const id = state.detail?.question?.id;
    if (!id) return;
    openReasonDialog({
      title: t('deleteQuestion'),
      label: t('deleteReasonLabel'),
      submitLabel: t('delete'),
      onSubmit: async ({ reason }) => {
        await api(`/api/questions/${id}`, { method: 'DELETE', body: { reason } });
        showToast(t('questionDeleted'));
        showList();
      }
    });
  }

  async function closeQuestion() {
    const id = state.detail?.question?.id;
    if (!id) return;
    let duplicateList = state.questions;
    try { duplicateList = (await api('/api/questions?limit=100')).questions || duplicateList; } catch { /* keep the current page */ }
    openReasonDialog({
      title: t('closeTitle'),
      label: t('closeReasonLabel'),
      withDuplicate: true,
      duplicateList,
      submitLabel: t('closeQuestion'),
      onSubmit: async ({ reason, duplicateOf }) => {
        await api(`/api/questions/${id}/close`, { method: 'POST', body: { reason, duplicateOf: duplicateOf || undefined } });
        await openQuestion(id, { count: false });
      }
    });
  }

  async function reopenQuestion() {
    try {
      await api(`/api/questions/${state.detail.question.id}/reopen`, { method: 'POST' });
      await openQuestion(state.detail.question.id, { count: false });
    } catch (error) { showToast(messageFor(error)); }
  }

  function flagQuestion() {
    const id = state.detail?.question?.id;
    if (!id) return;
    if (!user()) { showToast(t('loginToParticipate')); return; }
    openReasonDialog({
      title: t('flagTitle'),
      label: t('flagReasonLabel'),
      placeholder: t('flagPlaceholder'),
      submitLabel: t('send'),
      onSubmit: async ({ reason }) => {
        await api(`/api/questions/${id}/flag`, { method: 'POST', body: { reason } });
        showToast(t('flagSent'));
      }
    });
  }

  function deleteAnswer(id) {
    openReasonDialog({
      title: t('deleteAnswer'),
      label: t('deleteReasonLabel'),
      submitLabel: t('delete'),
      onSubmit: async ({ reason }) => {
        await api(`/api/answers/${id}`, { method: 'DELETE', body: { reason } });
        showToast(t('answerDeleted'));
        await openQuestion(state.detail.question.id, { count: false });
      }
    });
  }

  function applyFormat(format) {
    const textarea = $('#qa-ask-body') || $('#qa-edit-body') || $('#qa-edit-answer-body');
    if (!textarea) return;
    const [before, after] = FORMATS[format] || ['', ''];
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    textarea.value = textarea.value.slice(0, start) + before + selected + after + textarea.value.slice(end);
    textarea.focus();
    textarea.selectionStart = start + before.length;
    textarea.selectionEnd = start + before.length + selected.length;
  }

  function addSuggestedTag(tag) {
    const input = $('#qa-ask-tags');
    if (!input) return;
    const values = input.value.split(',').map((value) => value.trim()).filter(Boolean);
    if (values.includes(tag)) return;
    if (values.length >= 5) { showToast(t('questionTagsLabel')); return; }
    input.value = [...values, tag].join(', ');
    input.focus();
  }

  function openAnswerEdit(id) {
    const answer = (state.detail?.answers || []).find((item) => item.id === id);
    if (!answer) return;
    renderEditAnswer(answer);
  }

  function ensureToolbar() {
    if ($('#qa-toolbar')) return;
    container.insertAdjacentHTML('afterbegin', `<section class="card qa-toolbar" id="qa-toolbar">
      <div class="section-inline">
        <h2>${t('qaFeedTitle')}</h2>
        <div class="qa-toolbar-row">
          <label class="compact-label"><span>${t('sort')}</span>
            <select id="qa-sort">
              <option value="score">${t('sortTop')}</option>
              <option value="recent">${t('sortNew')}</option>
              <option value="unanswered">${t('sortUnanswered')}</option>
            </select>
          </label>
          <button type="button" class="button ghost" id="qa-my" aria-pressed="false">${t('myQuestions')}</button>
        </div>
      </div>
      <p class="help-text">${t('askHint')}</p>
      <div class="qa-tag-filter"><button type="button" class="button ghost compact" id="qa-tags-toggle" aria-expanded="false">${t('tagsFilter')}</button><div id="qa-tag-cloud" class="qa-tag-cloud" hidden></div></div>
    </section>`);
    if (!$('#qa-content')) container.insertAdjacentHTML('beforeend', '<div id="qa-content"></div>');
    toolbar = $('#qa-toolbar');
    $('#qa-tags-toggle').addEventListener('click', () => {
      state.tagsOpen = !state.tagsOpen;
      const cloud = $('#qa-tag-cloud');
      if (cloud) cloud.hidden = !state.tagsOpen;
      $('#qa-tags-toggle').setAttribute('aria-expanded', String(state.tagsOpen));
    });
    $('#qa-sort').addEventListener('change', (event) => { state.sort = event.target.value; state.page = 1; loadList(); });
    $('#qa-my').addEventListener('click', () => {
      if (!user()) { showToast(t('loginToParticipate')); return; }
      state.myOnly = !state.myOnly;
      state.selectedTags.clear();
      state.page = 1;
      updateToolbar();
      loadList();
    });
  }

  function updateToolbar() {
    if (!$('#qa-toolbar')) return;
    const sort = $('#qa-sort');
    if (sort) sort.value = state.sort;
    const my = $('#qa-my');
    if (my) my.setAttribute('aria-pressed', String(state.myOnly));
    const cloud = $('#qa-tag-cloud');
    if (cloud) cloud.hidden = !(state.tagsOpen || state.selectedTags.size);
    renderTagCloud();
  }

  function renderToolbar() {
    ensureToolbar();
    updateToolbar();
  }

  container.addEventListener('click', (event) => {
    const open = event.target.closest('[data-qa-open]');
    if (open) { openQuestion(open.dataset.qaOpen); return; }
    const back = event.target.closest('[data-qa-back]');
    if (back) { if (state.view === 'edit-answer' && state.detail) { openQuestion(state.detail.question.id, { count: false }); return; } showList(); return; }
    const toList = event.target.closest('[data-qa-list]');
    if (toList) { showList(); return; }
    const tag = event.target.closest('[data-qa-tag]');
    if (tag) {
      const name = tag.dataset.qaTag;
      if (state.selectedTags.has(name)) state.selectedTags.delete(name); else state.selectedTags.add(name);
      state.page = 1;
      state.myOnly = false;
      if (state.view !== 'list') { state.view = 'list'; state.detail = null; toolbar.hidden = false; }
      renderTagCloud();
      loadList();
      return;
    }
    const clearTags = event.target.closest('[data-qa-clear-tags]');
    if (clearTags) { state.selectedTags.clear(); state.page = 1; renderTagCloud(); loadList(); return; }
    const vote = event.target.closest('[data-qa-vote]');
    if (vote) { handleVote(vote.dataset.qaVote, Number(vote.dataset.value)); return; }
    const pageButton = event.target.closest('[data-qa-page]');
    if (pageButton && !pageButton.disabled) { state.page = Number(pageButton.dataset.qaPage); loadList(); return; }
    const comment = event.target.closest('[data-qa-comment]');
    if (comment) {
      const target = comment.dataset.qaComment;
      state.openComments.add(target);
      trimDrafts(state.openComments);
      const form = container.querySelector(`[data-comment-form="${target}"]`);
      if (form) {
        form.hidden = false;
        const textarea = form.querySelector('textarea');
        if (textarea) textarea.focus();
        updateCommentHint(target);
      }
      return;
    }
    const deleteCommentButton = event.target.closest('[data-qa-delete-comment]');
    if (deleteCommentButton) {
      deleteComment(deleteCommentButton.dataset.qaDeleteComment);
      return;
    }
    const cancelComment = event.target.closest('[data-qa-comment-cancel]');    if (cancelComment) {
      const target = cancelComment.dataset.qaCommentCancel;
      state.openComments.delete(target);
      const form = container.querySelector(`[data-comment-form="${target}"]`);
      if (form) form.hidden = true;
      return;
    }
    const submitCommentButton = event.target.closest('[data-qa-submit-comment]');
    if (submitCommentButton) {
      const target = submitCommentButton.dataset.qaSubmitComment;
      const form = container.querySelector(`[data-comment-form="${target}"]`);
      const textarea = form?.querySelector('textarea');
      if (textarea) submitComment(target, textarea);
      return;
    }
    const accept = event.target.closest('[data-qa-accept]');
    if (accept) { handleAccept(accept.dataset.qaAccept); return; }
    const submitAnswerButton = event.target.closest('[data-qa-submit-answer]');
    if (submitAnswerButton) { submitAnswer(); return; }
    const share = event.target.closest('[data-qa-share]');
    if (share) { shareQuestion(share.dataset.qaShare); return; }
    const editQuestionButton = event.target.closest('[data-qa-edit-question]');
    if (editQuestionButton) { state.view = 'edit-question'; renderEditQuestion(); return; }
    const deleteQuestionButton = event.target.closest('[data-qa-delete-question]');
    if (deleteQuestionButton) { deleteQuestion(); return; }
    const closeButton = event.target.closest('[data-qa-close]');
    if (closeButton) { closeQuestion(); return; }
    const reopenButton = event.target.closest('[data-qa-reopen]');
    if (reopenButton) { reopenQuestion(); return; }
    const flagButton = event.target.closest('[data-qa-flag]');
    if (flagButton) { flagQuestion(); return; }
    const editAnswerButton = event.target.closest('[data-qa-edit-answer]');
    if (editAnswerButton) { openAnswerEdit(editAnswerButton.dataset.qaEditAnswer); return; }
    const deleteAnswerButton = event.target.closest('[data-qa-delete-answer]');
    if (deleteAnswerButton) { deleteAnswer(deleteAnswerButton.dataset.qaDeleteAnswer); return; }
    const formatButton = event.target.closest('[data-qa-format]');
    if (formatButton) { applyFormat(formatButton.dataset.qaFormat); return; }
    const publish = event.target.closest('[data-qa-publish]');
    if (publish) { publishQuestion(); return; }
    const saveQuestion = event.target.closest('[data-qa-save-question]');
    if (saveQuestion) { saveQuestionEdit(); return; }
    const saveAnswer = event.target.closest('[data-qa-save-answer]');
    if (saveAnswer) { saveAnswerEdit(saveAnswer.dataset.qaSaveAnswer); return; }
    const suggest = event.target.closest('[data-qa-suggest]');
    if (suggest) { addSuggestedTag(suggest.dataset.qaSuggest); return; }
  });

  container.addEventListener('input', (event) => {
    const input = event.target.closest('[data-comment-input]');
    if (input) {
      state.commentDrafts.set(input.dataset.commentInput, input.value);
    trimDrafts(state.commentDrafts);
      updateCommentHint(input.dataset.commentInput);
      return;
    }
    if (event.target.id === 'qa-answer-text' && state.detail?.question?.id) {
      state.answerDrafts.set(state.detail.question.id, event.target.value);
    trimDrafts(state.answerDrafts);
    }
  });

  function syncFromHash() {
    const match = location.hash.match(/^#q\/(.+)$/);
    if (!match) return;
    onDeepLink();
    openQuestion(decodeURIComponent(match[1]));
  }

  function refresh({ soft = false } = {}) {
    if (state.view === 'list') {
      if (soft) { renderList(); updateToolbar(); } else loadList();
    } else if (state.view === 'detail' && state.detail) {
      if (soft) renderDetail(); else openQuestion(state.detail.question.id, { count: false });
    }
  }

  function onAuthChange({ reload = false } = {}) {
    const active = document.activeElement;
    if (active && container.contains(active) && active.matches('textarea, input')) return;
    if (reload) {
      if (state.view === 'list') loadList();
      else if (state.view === 'detail' && state.detail) openQuestion(state.detail.question.id, { count: false });
      return;
    }
    refresh({ soft: true });
  }

  function activate() {
    if (state.view === 'detail') { showList(); return; }
    if (state.view === 'list') {
      if (!state.pagination && !state.questions.length) loadList();
      else { renderList(); updateToolbar(); }
    }
  }

  renderToolbar();
  loadList().then(() => { if (location.hash.startsWith('#q/')) syncFromHash(); });
  window.addEventListener('hashchange', syncFromHash);

  return {
    refresh,
    onAuthChange,
    activate,
    showAsk,
    loadList
  };
}
