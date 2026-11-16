import { balanceEquation, inspectBalance } from './balancer.js';
import { findSubstance } from './checker.js';
import { electrolyteRecord } from './electrolytes.js';
import { buildIonicEquations } from './ionic.js';
import { equationToUnicode, formatEquation, parseEquation, parseSide, parseSpecies } from './parser.js';
import { updateCommunityData } from './predictor.js';
import { getLocale, t } from './i18n.js';
import { createDraftStore } from './drafts.js';
import { SUBSTANCE_CLASSES, classLabel } from './classes.js';
import { ensureTelegramSdk, getTelegramInitData } from './telegram.js';

const $ = (selector) => document.querySelector(selector);
const SOURCES = ['glinka', 'lidine', 'textbook', 'lab', 'personal'];
const ISSUES = ['products', 'conditions', 'coefficients', 'ionic', 'substance', 'thermo', 'code', 'balance_engine'];
const MODERATORS = ['admin', 'admin+', 'GOD'];
const STATUSES = ['pending', 'approved', 'rejected', 'needs_evidence', 'changes_requested', 'withdrawn'];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, action, value, className = 'button ghost') {
  const node = element('button', className, text);
  node.type = 'button';
  if (action) node.dataset.action = action;
  if (value !== undefined) node.dataset.value = String(value);
  return node;
}

function conditionsKey(conditions = {}) {
  return {
    medium: conditions.medium || 'neutral',
    solvent: conditions.solvent || 'aqueous',
    acidConcentration: conditions.acidConcentration === 'diluted' ? 'dilute' : conditions.acidConcentration || 'unspecified',
    ratio: conditions.ratio || 'normal',
    catalyst: conditions.catalyst || '',
    heating: Boolean(conditions.heating),
    current: Boolean(conditions.current)
  };
}

function reactionKey(reactants, conditions) {
  return JSON.stringify([reactants.map((item) => item.formula).sort(), conditionsKey(conditions)]);
}

export function ruleEquation(rule) {
  if (!rule) return '';
  const reactants = rule.reactants || rule.left || [];
  if (rule.outcome === 'no-reaction') return `${reactants.join(' + ')} — ${t('noReaction')}`;
  try {
    const equation = {
      left: reactants.map((formula, index) => ({ ...parseSpecies(formula), coefficient: rule.coefficients?.[index] || rule.inputCoefficients?.[index] || 1 })),
      right: (rule.products || []).map((formula, index) => ({ ...parseSpecies(formula), coefficient: rule.coefficients?.[reactants.length + index] || 1 })),
      separator: rule.separator || '→'
    };
    const coefficients = rule.coefficients || balanceEquation(equation).coefficients;
    return equationToUnicode(equation, coefficients);
  } catch {
    return `${reactants.join(' + ')} → ${(rule.products || []).join(' + ')}`;
  }
}

function plainEquation(rule) {
  if (!rule) return '';
  const reactants = rule.reactants || rule.left || [];
  if (rule.outcome === 'no-reaction') return reactants.join(' + ');
  const left = reactants.map((formula, index) => `${rule.coefficients?.[index] > 1 ? rule.coefficients[index] : ''}${formula}`);
  const right = (rule.products || []).map((formula, index) => `${rule.coefficients?.[index + reactants.length] > 1 ? rule.coefficients[index + reactants.length] : ''}${formula}`);
  return `${left.join(' + ')} = ${right.join(' + ')}`;
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function signedNumber(value) {
  const number = Number(value) || 0;
  return `${number > 0 ? '+' : ''}${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }).format(number)}`;
}

function selectOptions(values, selected, translate = (value) => t(value)) {
  return values.map((value) => `<option value="${value}"${value === selected ? ' selected' : ''}>${translate(value)}</option>`).join('');
}

export function initCommunityUI({ storage, showToast, onNavigate, getAutoContext = () => null, getCheckContext = () => null }) {
  let user = null;
  let csrfToken = '';
  let proposals = [];
  let ownProposals = [];
  let editing = null;
  let substanceDraft = new Map();
  let refreshTimer;
  let loading = false;
  let pendingRefresh = false;
  let requestGeneration = 0;
  let draftStore = null;
  let activeDraftId = null;
  let draftTimer = null;
  let feedPage = 1;
  let ownPage = 1;
  let usersPage = 1;
  let feedPagination = null;
  let ownPagination = null;
  let usersPagination = null;
  let notifications = [];
  let unreadNotifications = 0;
  let publicProfile = null;
  let qaController = null;
  let communityView = 'questions';
  let lastAuthSignature = '';
  let profileEditing = false;
  let profileDraft = { avatar: '', nickname: '', privacy: 'public' };

  function setDraftUser(account) {
    clearTimeout(draftTimer);
    draftStore = account ? createDraftStore(storage, account.id) : null;
    activeDraftId = null;
  }

  function draftData(form) {
    return {
      equation: form.elements.equation.value,
      outcome: form.elements.outcome.value,
      conditions: conditionsKey(Object.fromEntries(new FormData(form))),
      reactionType: form.elements.reactionType.value,
      sourceType: form.elements.sourceType.value,
      sourceDetails: form.elements.sourceDetails.value,
      comment: form.elements.comment.value,
      phaseSpecific: form.elements.phaseSpecific.checked,
      specialCase: form.elements.specialCase.checked,
      issueTypes: [...form.querySelectorAll('[name="issueTypes"]:checked')].map((input) => input.value),
      manualIonicFull: form.elements.manualIonicFull.value,
      manualIonicNet: form.elements.manualIonicNet.value,
      substances: substanceValues($('#community-substance-list')),
      proposal: editing,
      originalRule: prefillRule,
      kind: editing?.kind || prefillRule ? 'correction' : 'new'
    };
  }

  function saveDraft() {
    clearTimeout(draftTimer);
    const form = $('#community-proposal-form');
    if (!draftStore || !form || !$('#community-proposal-dialog').open) return;
    activeDraftId = draftStore.save(draftData(form), activeDraftId || undefined);
  }

  function scheduleDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 500);
  }

  async function api(path, { method = 'GET', body } = {}) {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(csrfToken && method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({ error: { message: t('serverUnavailable') } }));
    if (!response.ok) {
      const error = new Error(data.error?.message || t('serverUnavailable'));
      error.code = data.error?.code;
      error.status = response.status;
      error.details = data.error?.details;
      if (response.status === 401 && user) {
        user = null;
        csrfToken = '';
        setDraftUser(null);
        renderAccount();
      }
      throw error;
    }
    return data;
  }

  function notifyError(error) {
    showToast(error.message);
    $('#community-status').textContent = error.message;
  }

  async function refreshRules() {
    try {
      const data = await api('/api/rules');
      updateCommunityData(data);
      return data;
    } catch (error) {
      $('#community-status').textContent = t('communityOffline');
      return null;
    }
  }

  function renderPagination(selector, value, changePage) {
    const container = $(selector);
    container.replaceChildren();
    if (!value || value.pages <= 1) return;
    const previous = button(t('previousPage'), undefined, undefined, 'button ghost');
    previous.disabled = !value.hasPrev;
    previous.addEventListener('click', () => changePage(value.page - 1));
    const next = button(t('nextPage'), undefined, undefined, 'button ghost');
    next.disabled = !value.hasNext;
    next.addEventListener('click', () => changePage(value.page + 1));
    container.append(previous, element('span', 'help-text', t('pageOf', { page: value.page, pages: value.pages, total: value.total })), next);
  }

  function renderDrafts() {
    const container = $('#cabinet-drafts');
    container.replaceChildren();
    const drafts = draftStore?.list() || [];
    if (!drafts.length) container.append(element('p', 'help-text', t('noDrafts')));
    for (const draft of drafts) {
      const card = element('article', 'draft-item');
      card.append(element('p', 'proposal-equation', draft.data.equation || '—'), element('p', 'help-text', formatDate(draft.updatedAt)));
      const actions = element('div', 'proposal-actions');
      const resume = button(t('resumeDraft'), undefined, undefined, 'button secondary');
      resume.addEventListener('click', () => openProposal({ draft }));
      const remove = button(t('deleteDraft'), undefined, undefined, 'button ghost');
      remove.addEventListener('click', () => {
        if (!window.confirm(t('confirmDeleteDraft'))) return;
        draftStore.remove(draft.id);
        renderDrafts();
      });
      actions.append(resume, remove);
      card.append(actions);
      container.append(card);
    }
  }

  function renderNotifications() {
    const container = $('#cabinet-notifications');
    container.replaceChildren();
    $('#notifications-read-all').disabled = !unreadNotifications;
    if (!notifications.length) container.append(element('p', 'help-text', t('noNotifications')));
    for (const notification of notifications) {
      const card = element('article', `notification-item${notification.read_at ? '' : ' unread'}`);
      card.append(element('strong', '', t(`notification_${notification.kind}`)), element('p', 'help-text', formatDate(notification.created_at)), element('p', '', notification.message));
      if (!notification.read_at) {
        const read = button(t('markRead'), undefined, undefined, 'text-button');
        read.addEventListener('click', async () => {
          try {
            const data = await api(`/api/notifications/${encodeURIComponent(notification.id)}/read`, { method: 'POST', body: {} });
            notifications = data.notifications;
            unreadNotifications = data.unread;
            renderNotifications();
          } catch (error) { notifyError(error); }
        });
        card.append(read);
      }
      container.append(card);
    }
  }

  function renderAccount() {
    const authSignature = user ? `${user.id}:${user.nickname || user.login}:${user.login}:${user.avatar || ''}:${user.privileges}:${user.privacy || ''}:${user.telegram_linked}:${user.telegram_username}` : '';
    if (authSignature !== lastAuthSignature) {
      lastAuthSignature = authSignature;
      qaController?.onAuthChange({ reload: true });
    }
    $('#community-auth').hidden = Boolean(user) || Boolean(publicProfile);
    $('#community-auth-forms').hidden = false;
    $('#cabinet-new-proposal').hidden = !user || Boolean(publicProfile);
    $('#community-own-section').hidden = !user || Boolean(publicProfile);
    $('#community-users-section').hidden = user?.privileges !== 'GOD';
    $('#community-sidebar').hidden = user?.privileges !== 'GOD';
    $('#community-moderation-note').hidden = !MODERATORS.includes(user?.privileges);
    $('#cabinet-private').hidden = !user || Boolean(publicProfile);
    $('#profile-danger-zone').hidden = !user || Boolean(publicProfile);
    $('#cabinet-public').hidden = !publicProfile;
    if (!publicProfile) $('#cabinet-status').textContent = user ? '' : t('authRequired');
    const account = $('#cabinet-summary');
    account.replaceChildren();
    if (!user) {
      profileEditing = false;
      profileDraft = { avatar: '', nickname: '', privacy: 'public' };
      ownProposals = [];
      notifications = [];
      $('#community-own').replaceChildren();
      $('#community-users').replaceChildren();
      $('#cabinet-drafts').replaceChildren();
      $('#cabinet-notifications').replaceChildren();
      renderProfileSettings();
      return;
    }
    account.append(
      element('h3', 'community-login', user.nickname || user.login),
      element('p', 'help-text', `${t('loginForAuth')}: ${user.login}`),
      ...(user.telegram_linked ? [element('p', 'help-text', `Telegram: ${user.telegram_username ? `@${user.telegram_username}` : t('telegramLinked')}`)] : []),
      ...(user.telegram_linked && String(user.login).startsWith('tg_') ? [element('p', 'help-text', t('telegramAccountHint'))] : []),
      element('p', `role-badge role-${user.privileges.toLowerCase()}`, `${t('role')}: ${user.privileges}`),
      element('p', 'help-text', `${t('registered')}: ${formatDate(user.created_at)}`),
      element('p', 'help-text', `${t('lastSession')}: ${formatDate(user.last_login_at)}`),
      element('p', 'help-text community-reputation', `${t('reputation')}: ${signedNumber(user.reputation)}`),
      element('p', 'help-text', `${t('pendingMine')}: ${ownProposals.filter((item) => item.status === 'pending').length}`),
      element('p', 'help-text', `${t('unreadNotifications')}: ${unreadNotifications}`)
    );
    const link = element('a', 'help-text public-profile-link', `${location.origin}/${encodeURIComponent(user.login)}`);
    link.href = `/${encodeURIComponent(user.login)}`;
    account.append(link, button(t('signOut'), 'logout', undefined, 'button secondary'));
    renderProfileSettings();
    renderDrafts();
    renderNotifications();
  }

  function renderProfileAvatar(host, avatar, login) {
    if (!host) return;
    host.replaceChildren();
    if (avatar) {
      const image = element('img');
      image.src = avatar;
      image.alt = '';
      host.append(image);
    } else {
      host.append(element('span', '', String(login || '?').slice(0, 1).toUpperCase()));
    }
  }

  function privacyLabel(value) {
    return value === 'private' ? t('privacyPrivate') : t('privacyPublic');
  }

  function renderProfileSettings() {
    const view = $('#profile-view');
    const editor = $('#profile-editor');
    if (!view || !editor) return;
    if (!user) {
      profileEditing = false;
      view.hidden = false;
      editor.hidden = true;
      return;
    }
    if (profileEditing) {
      view.hidden = true;
      editor.hidden = false;
      $('#profile-edit').hidden = true;
      renderProfileAvatar($('#profile-avatar-preview'), profileDraft.avatar, profileDraft.nickname || user.login);
      const nickname = $('#profile-nickname');
      if (nickname) nickname.value = profileDraft.nickname;
      const loginReadonly = $('#profile-login-readonly');
      if (loginReadonly) loginReadonly.textContent = user.login;
      const telegramStatus = $('#profile-telegram-status');
      const linkTelegram = $('#profile-link-telegram');
      const mergeTelegram = $('#profile-telegram-merge');
      if (mergeTelegram) mergeTelegram.hidden = !(user.telegram_linked && String(user.login).startsWith('tg_'));
      if (telegramStatus && linkTelegram) {
        if (user.telegram_linked) {
          telegramStatus.hidden = false;
          telegramStatus.textContent = `${t('telegramLinked')}${user.telegram_username ? `: @${user.telegram_username}` : ''}`;
          linkTelegram.hidden = true;
        } else if (getTelegramInitData()) {
          telegramStatus.hidden = false;
          telegramStatus.textContent = t('telegramLinkHint');
          linkTelegram.hidden = false;
        } else {
          telegramStatus.hidden = true;
          linkTelegram.hidden = true;
        }
      }
      const privacy = $('#profile-privacy');
      if (privacy) privacy.value = profileDraft.privacy;
      const remove = $('#profile-avatar-remove');
      if (remove) remove.hidden = !profileDraft.avatar;
      return;
    }
    view.hidden = false;
    editor.hidden = true;
    $('#profile-edit').hidden = false;
    renderProfileAvatar($('#profile-avatar-view'), user.avatar, user.nickname || user.login);
    $('#profile-nickname-view').textContent = user.nickname || user.login;
    $('#profile-login-view').textContent = user.login;
    const telegramRow = $('#profile-telegram-row');
    if (telegramRow) {
      telegramRow.hidden = !user.telegram_linked;
      if (user.telegram_linked) $('#profile-telegram-view').textContent = user.telegram_username ? `@${user.telegram_username}` : t('telegramLinked');
    }
    $('#profile-privacy-view').textContent = privacyLabel(user.privacy || 'public');
    $('#profile-status').textContent = '';
  }

  function resizeAvatar(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type || !file.type.startsWith('image/')) {
        reject(new Error(t('invalidAvatar')));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(t('invalidAvatar')));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error(t('invalidAvatar')));
        image.onload = () => {
          const size = 128;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const context = canvas.getContext('2d');
          const scale = Math.max(size / image.width, size / image.height);
          const width = image.width * scale;
          const height = image.height * scale;
          context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  $('#profile-edit')?.addEventListener('click', () => {
    if (!user) return;
    profileEditing = true;
    profileDraft = { avatar: user.avatar || '', nickname: user.nickname || user.login, privacy: user.privacy || 'public' };
    $('#profile-status').textContent = '';
    renderProfileSettings();
    $('#profile-nickname')?.focus();
  });

  $('#profile-link-telegram')?.addEventListener('click', async () => {
    const initData = getTelegramInitData();
    if (!initData) return;
    try {
      const data = await api('/api/auth/telegram/link', { method: 'POST', body: { initData } });
      user = data.user;
      profileEditing = false;
      renderAccount();
      showToast(t('telegramLinked'));
    } catch (error) {
      notifyError(error);
    }
  });

  $('#profile-merge-submit')?.addEventListener('click', async () => {
    const login = $('#profile-merge-login')?.value.trim();
    const password = $('#profile-merge-password')?.value || '';
    const status = $('#profile-merge-status');
    if (!login || !password) {
      if (status) status.textContent = t('invalidCredentials');
      return;
    }
    try {
      const data = await api('/api/auth/telegram/merge', { method: 'POST', body: { login, password } });
      user = data.user;
      csrfToken = data.csrfToken;
      setDraftUser(user);
      profileEditing = false;
      renderAccount();
      showToast(t('accountMerged'));
    } catch (error) {
      if (status) status.textContent = error.message;
      notifyError(error);
    }
  });

  $('#profile-delete')?.addEventListener('click', () => {
    if (!user) return;
    $('#delete-account-password-row').hidden = !user.password_set;
    $('#delete-account-password').value = '';
    $('#delete-account-confirm').value = '';
    $('#delete-account-status').textContent = '';
    $('#delete-account-dialog').showModal();
  });
  $('#close-delete-account')?.addEventListener('click', () => $('#delete-account-dialog').close());
  $('#cancel-delete-account')?.addEventListener('click', () => $('#delete-account-dialog').close());
  $('#confirm-delete-account')?.addEventListener('click', async () => {
    const status = $('#delete-account-status');
    try {
      await api('/api/auth/account', {
        method: 'DELETE',
        body: { password: $('#delete-account-password')?.value || '', confirm: $('#delete-account-confirm')?.value || '' }
      });
      user = null;
      csrfToken = '';
      setDraftUser(null);
      profileEditing = false;
      $('#delete-account-dialog').close();
      renderAccount();
      showToast(t('accountDeleted'));
    } catch (error) {
      if (status) status.textContent = error.message;
    }
  });

  $('#profile-nickname')?.addEventListener('input', (event) => {
    if (profileEditing) profileDraft.nickname = event.target.value;
  });

  $('#profile-privacy')?.addEventListener('change', (event) => {
    if (profileEditing) profileDraft.privacy = event.target.value;
  });

  $('#profile-avatar-input')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      profileDraft.avatar = await resizeAvatar(file);
      renderProfileSettings();
    } catch (error) {
      const status = $('#profile-status');
      if (status) status.textContent = error.message;
    }
  });

  $('#profile-avatar-remove')?.addEventListener('click', () => {
    profileDraft.avatar = '';
    renderProfileSettings();
  });

  $('#profile-cancel')?.addEventListener('click', () => {
    profileEditing = false;
    profileDraft = { avatar: '', nickname: '', privacy: 'public' };
    renderProfileSettings();
  });

  $('#profile-save')?.addEventListener('click', async () => {
    if (!profileEditing) return;
    const nickname = profileDraft.nickname.trim();
    const status = $('#profile-status');
    if (!nickname) {
      if (status) status.textContent = t('nickname');
      return;
    }
    try {
      const data = await api('/api/auth/profile', {
        method: 'PATCH',
        body: { nickname, privacy: profileDraft.privacy, avatar: profileDraft.avatar }
      });
      user = data.user;
      profileEditing = false;
      profileDraft = { avatar: user.avatar || '', nickname: user.nickname || user.login, privacy: user.privacy || 'public' };
      renderAccount();
      showToast(t('profileSaved'));
    } catch (error) {
      if (status) status.textContent = error.message;
      notifyError(error);
    }
  });

  function proposalCard(proposal, compact = false) {
    const rule = proposal.proposed_rule_json;
    const card = element('article', `proposal-card status-${proposal.status}`);
    card.id = `proposal-${proposal.id}`;
    const heading = element('div', 'proposal-heading');
    const author = element('div');
    author.append(element('strong', '', proposal.author_login), element('small', 'help-text', `${t(`kind_${proposal.kind}`)} · ${formatDate(proposal.created_at)} · ${t('reputation')}: ${signedNumber(proposal.author_reputation)}`));
    const score = element('span', 'proposal-score', signedNumber(proposal.score));
    score.setAttribute('aria-label', `${t('rating')}: ${signedNumber(proposal.score)}`);
    heading.append(author, score);
    card.append(heading, element('p', 'proposal-equation', ruleEquation(rule)), element('p', 'proposal-conditions', conditionText(rule.when)));
    if (!compact) {
      card.append(element('p', 'proposal-comment', proposal.comment || '—'));
      card.append(element('p', 'source-note', `${t('source')}: ${t(`source_${proposal.source_type}`)} · ${proposal.source_details}`));
      if (proposal.issue_types?.length) card.append(element('p', 'help-text', `${t('issues')}: ${proposal.issue_types.map((issue) => t(`issue_${issue}`)).join(', ')}`));
      if (proposal.original_rule_json) {
        const original = element('details', 'original-rule');
        original.append(element('summary', '', t('originalAnswer')), element('p', 'proposal-equation', ruleEquation(proposal.original_rule_json)), renderRuleDiff(proposal.original_rule_json, rule));
        card.append(original);
      }
      if (rule.substances?.length) card.append(element('p', 'help-text', `${t('newSubstances')}: ${rule.substances.map((item) => `${item.formula} — ${item.name_ru}`).join('; ')}`));
      if (rule.specialCase) card.append(element('p', 'review-warning', t('specialCaseBadge')));
      if (rule.ionicOverride) {
        const manual = element('details', 'manual-ionic-card');
        manual.append(element('summary', '', t('manualIonicTitle')));
        for (const key of ['full', 'net']) if (rule.ionicOverride[key]) manual.append(element('p', 'proposal-equation', equationToUnicode(parseEquation(rule.ionicOverride[key]))));
        card.append(manual);
      }
    }
    if (proposal.review_note) card.append(element('p', 'notice', `${t('reviewNote')}: ${proposal.review_note}`));
    if (proposal.publishedBy) card.append(element('p', 'help-text', `${t('publishedBy')}: ${proposal.publishedBy}`));
    const actions = element('div', 'proposal-actions');
    if (proposal.status === 'pending' && !compact) {
      const own = proposal.author_id === user?.id;
      for (const value of [1, -1]) {
        const vote = button(value === 1 ? t('voteCorrect') : t('voteIncorrect'), 'vote', value, `button ${value === 1 ? 'secondary' : 'ghost'}`);
        vote.disabled = !user || own;
        vote.dataset.proposal = proposal.id;
        vote.setAttribute('aria-pressed', String(proposal.viewer_vote === value));
        actions.append(vote);
      }
      if ((own || MODERATORS.includes(user?.privileges))) actions.append(button(t('edit'), 'edit', proposal.id));
      if (own) actions.append(button(t('withdraw'), 'withdraw', proposal.id));
    }
    if (actions.children.length) card.append(actions);
    if (proposal.status === 'pending' && MODERATORS.includes(user?.privileges) && !compact) {
      const moderation = element('details', 'moderation-controls');
      moderation.append(element('summary', '', t('moderate')));
      const note = element('textarea', 'review-note');
      note.placeholder = t('reviewNotePlaceholder');
      note.maxLength = 2000;
      note.setAttribute('aria-label', t('reviewNote'));
      const buttons = element('div', 'proposal-actions');
      const approve = button(t('approve'), 'approve', proposal.id, 'button primary');
      const ownReview = proposal.author_id === user?.id && ['admin', 'admin+'].includes(user?.privileges);
      approve.disabled = ownReview;
      if (ownReview) moderation.append(element('p', 'help-text', t('selfReviewBlocked')));
      buttons.append(approve, button(t('needsEvidence'), 'needs_evidence', proposal.id), button(t('reject'), 'rejected', proposal.id));
      moderation.append(note, buttons);
      card.append(moderation);
    }
    if (compact) {
      const state = element('p', 'proposal-status', `${t(`status_${proposal.status}`)}${proposal.score ? ` · ${signedNumber(proposal.score)}` : ''}`);
      card.append(state);
      if (proposal.status === 'pending') card.append(button(t('edit'), 'edit', proposal.id));
    }
    if (proposal.review_history?.length) {
      const history = element('details', 'review-history');
      history.append(element('summary', '', t('reviewHistory')));
      const events = element('ol', 'review-history-list');
      for (const event of proposal.review_history) {
        events.append(element('li', '', `${formatDate(event.created_at)} · ${event.actor_login} · ${t(event.action === 'edited' ? 'review_edited' : `status_${event.action}`)} · v${event.proposal_version}${event.note ? ` — ${event.note}` : ''}`));
      }
      history.append(events);
      card.append(history);
    }
    if (proposal.status === 'approved') {
      const versions = element('details', 'version-details');
      versions.dataset.proposal = proposal.id;
      versions.append(element('summary', '', t('publishedVersions')), element('div', 'version-content'));
      card.append(versions);
    }
    return card;
  }

  function conditionText(conditions = {}) {
    return [t(conditions.medium || 'neutral'), t(conditions.solvent || 'aqueous'), conditions.acidConcentration !== 'unspecified' ? t(conditions.acidConcentration) : '', conditions.catalyst ? `${t('catalyst')}: ${conditions.catalyst}` : '', conditions.heating ? t('heating') : '', conditions.current ? t('electricCurrent') : '', conditions.ratio === 'deficit' ? t('deficitRatio') : ''].filter(Boolean).join(' · ');
  }

  function renderRuleDiff(current, proposed) {
    const fields = [
      ['autoTitle', (rule) => (rule?.reactants || rule?.left || []).join(' + ')],
      ['issue_products', (rule) => rule?.outcome === 'no-reaction' ? t('noReaction') : (rule?.products || []).join(' + ')],
      ['conditions', (rule) => conditionText(rule?.when)],
      ['coefficients', (rule) => rule?.coefficients?.join(', ') || t('automaticCoefficients')],
      ['reactionTypeLabel', (rule) => rule?.type || ''],
      ['ionicEquations', (rule) => rule?.ionicOverride ? `${rule.ionicOverride.full || ''}\n${rule.ionicOverride.net || ''}` : ''],
      ['source', (rule) => rule?.source || '']
    ];
    const table = element('table', 'diff-table');
    table.innerHTML = `<thead><tr><th>${t('field')}</th><th>${t('originalAnswer')}</th><th>${t('proposedAnswer')}</th></tr></thead>`;
    const body = element('tbody');
    for (const [label, read] of fields) {
      const before = String(read(current) ?? '');
      const after = String(read(proposed) ?? '');
      if (before === after) continue;
      const row = element('tr');
      row.append(element('th', '', t(label)), element('td', '', before || '—'), element('td', '', after || '—'));
      body.append(row);
    }
    if (!body.children.length) return element('p', 'help-text', t('noChanges'));
    table.append(body);
    const scroll = element('div', 'table-scroll');
    scroll.append(table);
    return scroll;
  }

  function renderFeed() {
    const feed = $('#community-feed');
    feed.replaceChildren();
    if (!proposals.length) feed.append(element('p', 'empty-state', t('noProposals')));
    for (const proposal of proposals) feed.append(proposalCard(proposal));
    const own = $('#community-own');
    own.replaceChildren();
    if (!ownProposals.length && user) own.append(element('p', 'help-text', t('noOwnProposals')));
    for (const proposal of ownProposals) own.append(proposalCard(proposal, true));
    renderPagination('#community-feed-pagination', feedPagination, (page) => { feedPage = page; refresh(); });
    renderPagination('#community-own-pagination', ownPagination, (page) => { ownPage = page; refresh(); });
    renderAccount();
  }

  async function refreshUsers() {
    if (user?.privileges !== 'GOD') return;
    const data = await api(`/api/users?page=${usersPage}&limit=50`);
    if (data.pagination.pages && usersPage > data.pagination.pages) {
      usersPage = data.pagination.pages;
      return refreshUsers();
    }
    usersPagination = data.pagination;
    const table = element('table', 'community-users-table');
    table.innerHTML = `<thead><tr><th>${t('login')}</th><th>${t('role')}</th><th>${t('reputation')}</th><th>${t('registered')}</th><th>${t('lastSession')}</th><th>${t('pendingMine')}</th></tr></thead>`;
    const body = element('tbody');
    for (const record of data.users) {
      const row = element('tr');
      row.append(element('th', '', record.login));
      const roleCell = element('td');
      if (record.privileges === 'GOD') roleCell.textContent = 'GOD';
      else {
        const select = document.createElement('select');
        select.dataset.userRole = String(record.id);
        select.setAttribute('aria-label', `${t('role')}: ${record.login}`);
        select.innerHTML = selectOptions(['basic', 'admin', 'admin+'], record.privileges, (value) => value);
        roleCell.append(select);
      }
      row.append(roleCell, element('td', '', signedNumber(record.reputation)), element('td', '', formatDate(record.created_at)), element('td', '', formatDate(record.last_login_at)), element('td', '', String(record.pending_count)));
      body.append(row);
    }
    table.append(body);
    const scroll = element('div', 'table-scroll');
    scroll.append(table);
    $('#community-users').replaceChildren(scroll);
    renderPagination('#community-users-pagination', usersPagination, (page) => { usersPage = page; refreshUsers(); });
  }

  async function refresh() {
    if (loading) {
      pendingRefresh = true;
      return;
    }
    loading = true;
    const generation = ++requestGeneration;
    try {
      const sort = $('#community-sort').value;
      const feedRequest = api(`/api/proposals?status=pending&sort=${encodeURIComponent(sort)}&page=${feedPage}&limit=50`);
      const ownRequest = user ? api(`/api/proposals?author=me&page=${ownPage}&limit=50`) : Promise.resolve({ proposals: [], pagination: null });
      const notificationRequest = user ? api('/api/notifications') : Promise.resolve({ notifications: [], unread: 0 });
      const accountRequest = user ? api('/api/auth/me').then((session) => {
        if (generation === requestGeneration) {
          user = session.user;
          csrfToken = session.csrfToken;
        }
      }) : Promise.resolve();
      const [feed, own, notificationData] = await Promise.all([feedRequest, ownRequest, notificationRequest, accountRequest]);
      if (generation !== requestGeneration) return;
      if ((feed.pagination.pages && feedPage > feed.pagination.pages) || (own.pagination?.pages && ownPage > own.pagination.pages)) {
        feedPage = Math.min(feedPage, feed.pagination.pages || 1);
        ownPage = Math.min(ownPage, own.pagination?.pages || 1);
        pendingRefresh = true;
        return;
      }
      proposals = feed.proposals;
      ownProposals = own.proposals;
      feedPagination = feed.pagination;
      ownPagination = own.pagination;
      notifications = notificationData.notifications;
      unreadNotifications = notificationData.unread;
      renderFeed();
      if (user?.privileges === 'GOD') await refreshUsers();
    } catch (error) {
      if (error.status !== 401) notifyError(error);
    } finally {
      loading = false;
      if (pendingRefresh) {
        pendingRefresh = false;
        refresh();
      }
    }
  }

  function scheduleRefresh(event) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (event?.type === 'user') restore();
      else {
        refresh();
        if (event?.type === 'review') refreshRules();
      }
    }, 150);
  }

  async function authenticate(path, form) {
    const data = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const response = await api(path, { method: 'POST', body: data });
      user = response.user;
      csrfToken = response.csrfToken;
      setDraftUser(user);
      form.reset();
      requestGeneration++;
      renderAccount();
      await refresh();
      showToast(t('signedIn'));
    } catch (error) {
      notifyError(error);
    } finally {
      submit.disabled = false;
    }
  }

  $('#community-login-form').addEventListener('submit', (event) => {
    event.preventDefault();
    authenticate('/api/auth/login', event.currentTarget);
  });
  $('#community-register-form').addEventListener('submit', (event) => {
    event.preventDefault();
    authenticate('/api/auth/register', event.currentTarget);
  });
  $('#cabinet-summary').addEventListener('click', async (event) => {
    if (!event.target.closest('[data-action="logout"]')) return;
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} });
    } catch (error) {
      if (error.status !== 401) return notifyError(error);
    }
    user = null;
    csrfToken = '';
    setDraftUser(null);
    requestGeneration++;
    renderAccount();
    await refresh();
  });
  $('#notifications-read-all').addEventListener('click', async () => {
    try {
      const data = await api('/api/notifications/read-all', { method: 'POST', body: {} });
      notifications = data.notifications;
      unreadNotifications = data.unread;
      renderNotifications();
    } catch (error) { notifyError(error); }
  });
  $('#community-sort').addEventListener('change', () => { feedPage = 1; refresh(); });
  $('#community-new-proposal').addEventListener('click', () => openProposal());
  $('#cabinet-new-proposal').addEventListener('click', () => openProposal());

  function substanceValues(container) {
    return [...container.querySelectorAll('.substance-editor')].map((card) => ({
      formula: card.dataset.formula,
      name_ru: card.querySelector('[data-field="name_ru"]').value.trim(),
      class: card.querySelector('[data-field="class"]').value,
      solubility: card.querySelector('[data-field="solubility"]').value,
      strong: card.querySelector('[data-field="strong"]').checked,
      ionsText: card.querySelector('[data-field="ions"]').value
    }));
  }

  function refreshSubstanceCards(rule) {
    const container = $('#community-substance-list');
    for (const item of substanceValues(container)) substanceDraft.set(item.formula, item);
    container.replaceChildren();
    const equation = readProposalEquation();
    if (!equation) return;
    for (const item of [...equation.left, ...equation.right]) {
      const formula = item.formula;
      const knownName = findSubstance(formula);
      const knownElectrolyte = electrolyteRecord(formula);
      if (knownName && knownElectrolyte) continue;
      const record = substanceDraft.get(formula) || rule?.substances?.find((entry) => entry.formula === formula) || {};
      const card = element('fieldset', 'substance-editor');
      card.dataset.formula = formula;
      card.innerHTML = `<legend>${formula}</legend>
        <label><span>${t('substanceName')}</span><input data-field="name_ru" maxlength="180" required></label>
        <div class="conditions-grid"><label><span>${t('substanceClass')}</span><select data-field="class">${selectOptions(SUBSTANCE_CLASSES, record.class || knownName?.class || 'salt', classLabel)}</select></label>
        <label><span>${t('solubility')}</span><select data-field="solubility">${selectOptions(['Р', 'М', 'Н', '—'], record.solubility || knownElectrolyte?.solubility || '—', (value) => value)}</select></label></div>
        <label class="check-control"><input data-field="strong" type="checkbox"><span>${t('strongElectrolyte')}</span></label>
        <label><span>${t('ionComposition')}</span><input data-field="ions"></label><p class="help-text ion-field-hint"></p>`;
      card.querySelector('[data-field="name_ru"]').value = record.name_ru || knownName?.name_ru || '';
      const strong = card.querySelector('[data-field="strong"]');
      strong.checked = record.strong ?? knownElectrolyte?.strong ?? false;
      const ions = card.querySelector('[data-field="ions"]');
      ions.value = record.ionsText || (record.ions || knownElectrolyte?.ions || []).map((ion) => `${ion.formula}:${ion.coefficient}`).join(', ');
      const hint = card.querySelector('.ion-field-hint');
      const updateIonField = () => {
        ions.placeholder = strong.checked ? 'Na^+:1, Cl^-:1' : '';
        hint.textContent = strong.checked ? t('ionsRequired') : t('ionsOptional');
        ions.setAttribute('aria-description', hint.textContent);
      };
      strong.addEventListener('change', updateIonField);
      updateIonField();
      container.append(card);
    }
  }

  function readProposalEquation() {
    const form = $('#community-proposal-form');
    if (!form) return null;
    try {
      return form.elements.outcome.value === 'no-reaction'
        ? { left: parseSide(form.elements.equation.value), right: [], separator: '→' }
        : parseEquation(form.elements.equation.value);
    } catch {
      return null;
    }
  }

  function readSubstances() {
    return substanceValues($('#community-substance-list')).map(({ ionsText, ...item }) => ({
      ...item,
      ions: ionsText ? ionsText.split(/[;,\n]+/).map((part) => {
        const match = part.trim().match(/^(.+):(\d+)$/);
        if (!match) throw new Error(t('ionsFormat', { formula: item.formula }));
        return { formula: match[1].trim(), coefficient: Number(match[2]) };
      }) : []
    }));
  }

  function canReviewWarnings(form) {
    return form.elements.specialCase.checked || ['admin+', 'GOD'].includes(user?.privileges);
  }

  function updateManualIonicVisibility(form) {
    const requested = form.elements.specialCase.checked || [...form.querySelectorAll('[name="issueTypes"]:checked')].some((input) => input.value === 'ionic');
    $('#community-manual-ionic').hidden = !requested;
  }

  function validatePreview() {
    const form = $('#community-proposal-form');
    const result = $('#community-balance-preview');
    const ionicResult = $('#community-ionic-preview');
    const bypass = canReviewWarnings(form);
    result.className = 'community-balance-preview';
    try {
      const equation = readProposalEquation();
      if (!equation) throw new Error(t('invalidEquation'));
      if (form.elements.outcome.value !== 'no-reaction') {
        const balance = inspectBalance(equation);
        const differences = balance.atomRows.filter((row) => !row.balanced).map((row) => `${row.symbol}: ${row.left} ≠ ${row.right}`).join('; ');
        result.textContent = balance.isBalanced ? `${t('atomsBalanced')}${balance.isMinimal ? '' : ` ${t('notMinimal')}`}` : `${t(bypass ? 'reviewWarning' : 'atomsUnbalanced')} ${differences}`;
        result.classList.add(balance.isBalanced ? 'balance-ok' : bypass ? 'review-warning' : 'balance-bad');
        const ionic = buildIonicEquations(equation, { solvent: form.elements.solvent.value });
        ionicResult.textContent = ionic.fullUnicode ? `${ionic.fullUnicode}\n${ionic.netUnicode || ionic.message}` : ionic.message;
        const manual = [form.elements.manualIonicFull.value.trim(), form.elements.manualIonicNet.value.trim()];
        if (manual.some(Boolean)) {
          try {
            for (const value of manual) if (value && !inspectBalance(parseEquation(value)).isBalanced) throw new Error(t('manualIonicUnbalanced'));
            ionicResult.textContent = manual.map((value) => value ? equationToUnicode(parseEquation(value)) : '').filter(Boolean).join('\n');
          } catch (error) {
            ionicResult.textContent = error.message;
            if (!bypass) return false;
          }
        }
        if (!balance.isBalanced && !bypass) return false;
      } else {
        result.textContent = t('noReactionProposal');
        ionicResult.textContent = '';
      }
      return true;
    } catch (error) {
      result.textContent = error.message;
      result.classList.add('balance-bad');
      ionicResult.textContent = '';
      return false;
    }
  }

  function openProposal(prefill = {}) {
    if (!user) {
      onNavigate('account');
      setTimeout(() => $('#community-login')?.focus(), 50);
      showToast(t('loginToPropose'));
      return;
    }
    const draft = prefill.draft?.data || null;
    activeDraftId = prefill.draft?.id || null;
    editing = prefill.proposal || draft?.proposal || null;
    prefillRule = editing ? null : prefill.originalRule || draft?.originalRule || null;
    const rule = editing?.proposed_rule_json || prefill.originalRule || draft?.originalRule || null;
    const kind = editing?.kind || draft?.kind || prefill.kind || 'new';
    const conditions = conditionsKey(draft?.conditions || (editing ? rule.when : prefill.conditions));
    const dialog = $('#community-proposal-dialog');
    $('#community-proposal-content').innerHTML = `<form id="community-proposal-form" novalidate>
      <div class="dialog-heading"><h2 id="community-proposal-title">${editing ? t('editProposal') : kind === 'correction' ? t('correctionProposal') : t('newProposal')}</h2><button class="icon-button" type="button" data-close-proposal aria-label="${t('close')}">×</button></div>
      <p class="help-text">${t('proposalValidationHelp')}</p>
      <label><span>${t('outcome')}</span><select name="outcome"><option value="products">${t('reactionProducts')}</option><option value="no-reaction">${t('noReaction')}</option></select></label>
      <label for="community-proposal-equation"><span>${t('proposedEquation')}</span><textarea id="community-proposal-equation" class="equation-input" name="equation" required maxlength="1500" spellcheck="false"></textarea></label>
      <p id="community-balance-preview" class="community-balance-preview" role="status"></p>
      <fieldset><legend>${t('conditions')}</legend><div class="conditions-grid">
        <label><span>${t('medium')}</span><select name="medium">${selectOptions(['neutral', 'acidic', 'alkaline'], conditions.medium)}</select></label>
        <label><span>${t('solvent')}</span><select name="solvent">${selectOptions(['aqueous', 'melt', 'gas', 'organic'], conditions.solvent)}</select></label>
        <label><span>${t('acidConcentration')}</span><select name="acidConcentration">${selectOptions(['unspecified', 'dilute', 'concentrated'], conditions.acidConcentration)}</select></label>
        <label><span>${t('ratio')}</span><select name="ratio">${selectOptions(['normal', 'deficit'], conditions.ratio, (value) => t(value === 'normal' ? 'normalRatio' : 'deficitRatio'))}</select></label>
        <label><span>${t('catalyst')}</span><select name="catalyst">${selectOptions(['', 'MnO2', 'Pt', 'Ni', 'Fe', 'V2O5'], conditions.catalyst, (value) => value || '—')}</select></label>
      </div><label class="check-control"><input name="heating" type="checkbox"${conditions.heating ? ' checked' : ''}><span>${t('heating')}</span></label><label class="check-control"><input name="current" type="checkbox"${conditions.current ? ' checked' : ''}><span>${t('electricCurrent')}</span></label></fieldset>
      <label><span>${t('reactionTypeLabel')}</span><input name="reactionType" maxlength="160" required value=""></label>
      <fieldset id="community-issue-types"${kind === 'correction' ? '' : ' hidden'}><legend>${t('issues')}</legend>${ISSUES.map((issue) => `<label class="check-control"><input type="checkbox" name="issueTypes" value="${issue}"><span>${t(`issue_${issue}`)}</span></label>`).join('')}</fieldset>
      <label><span>${t('source')}</span><select name="sourceType" required>${selectOptions(SOURCES, editing?.source_type || 'textbook', (value) => t(`source_${value}`))}</select></label>
      <label><span>${t('sourceDetails')}</span><textarea name="sourceDetails" required maxlength="2000"></textarea></label>
      <label><span>${t('comment')}</span><textarea name="comment" maxlength="2000"></textarea></label>
      <label class="check-control phase-specific-control"><input type="checkbox" name="phaseSpecific"><span>${t('phaseSpecific')}</span></label>
      <p class="help-text">${t('phaseSpecificHelp')}</p>
      <label class="check-control special-case-control"><input type="checkbox" name="specialCase"><span>${t('specialCase')}</span></label>
      <p class="help-text">${t('specialCaseHelp')}</p>
      <fieldset id="community-manual-ionic" hidden><legend>${t('manualIonicTitle')}</legend><p class="help-text">${t('manualIonicHelp')}</p><label><span>${t('manualFull')}</span><textarea name="manualIonicFull" maxlength="1500" spellcheck="false"></textarea></label><label><span>${t('manualNet')}</span><textarea name="manualIonicNet" maxlength="1500" spellcheck="false"></textarea></label></fieldset>
      <details class="substance-details-editor"><summary>${t('newSubstances')}</summary><p class="help-text">${t('newSubstancesHelp')}</p><div id="community-substance-list"></div></details>
      <details class="ionic-preview"><summary>${t('ionicPreview')}</summary><pre id="community-ionic-preview"></pre></details>
      <p id="community-proposal-error" class="inline-error" role="alert" hidden></p>
      <div class="dialog-actions"><button class="button ghost" type="button" data-close-proposal>${t('cancel')}</button><button class="button primary" type="submit">${editing ? t('saveChanges') : t('submitProposal')}</button></div>
    </form>`;
    const form = $('#community-proposal-form');
    substanceDraft = new Map((draft?.substances || rule?.substances || []).map((item) => [item.formula, item]));
    form.elements.equation.value = draft?.equation ?? (editing ? plainEquation(rule) : prefill.equation || `${prefill.reactants || ''} = `);
    form.elements.outcome.value = draft?.outcome || editing?.proposed_rule_json?.outcome || prefill.outcome || 'products';
    form.elements.reactionType.value = draft?.reactionType || rule?.type || t('communityRule');
    form.elements.sourceType.value = draft?.sourceType || editing?.source_type || 'textbook';
    form.elements.sourceDetails.value = draft?.sourceDetails ?? editing?.source_details ?? '';
    form.elements.comment.value = draft?.comment ?? editing?.comment ?? prefill.comment ?? '';
    form.elements.phaseSpecific.checked = draft?.phaseSpecific ?? (conditions.solvent !== 'aqueous' && form.elements.outcome.value === 'products');
    form.elements.specialCase.checked = draft?.specialCase ?? Boolean(rule?.specialCase);
    form.elements.manualIonicFull.value = draft?.manualIonicFull ?? rule?.ionicOverride?.full ?? '';
    form.elements.manualIonicNet.value = draft?.manualIonicNet ?? rule?.ionicOverride?.net ?? '';
    for (const input of form.querySelectorAll('[name="issueTypes"]')) input.checked = Boolean(draft?.issueTypes?.includes(input.value) || editing?.issue_types?.includes(input.value) || prefill.issueTypes?.includes(input.value));
    form.addEventListener('input', (event) => {
      if (event.target.name === 'equation') refreshSubstanceCards(rule);
      validatePreview();
      scheduleDraftSave();
    });
    form.addEventListener('change', (event) => {
      if (['solvent', 'outcome'].includes(event.target.name)) {
        if (event.target.name === 'outcome') form.elements.equation.value = event.target.value === 'no-reaction' ? (parseSideSafe(form.elements.equation.value)) : `${parseSideSafe(form.elements.equation.value)} = `;
        refreshSubstanceCards(rule);
      }
      updateManualIonicVisibility(form);
      validatePreview();
      scheduleDraftSave();
    });
    form.addEventListener('submit', submitProposal);
    for (const close of form.querySelectorAll('[data-close-proposal]')) close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', saveDraft);
    window.addEventListener('beforeunload', saveDraft);
    refreshSubstanceCards(rule);
    updateManualIonicVisibility(form);
    validatePreview();
    dialog.showModal();
    form.elements.equation.focus();
  }

  function parseSideSafe(value) {
    try { return formatEquation({ left: parseSide(value.split(/=|->|→|⇄/)[0]), right: [], separator: '→' }).replace(' →', ''); } catch { return value.split(/=|->|→|⇄/)[0]; }
  }

  async function submitProposal(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorNode = $('#community-proposal-error');
    errorNode.hidden = true;
    if (!validatePreview()) {
      errorNode.textContent = t('fixBalanceBeforeSubmit');
      errorNode.hidden = false;
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      data.heating = form.elements.heating.checked;
      data.current = form.elements.current.checked;
      data.phaseSpecific = form.elements.phaseSpecific.checked;
      data.specialCase = form.elements.specialCase.checked;
      data.issueTypes = [...form.querySelectorAll('[name="issueTypes"]:checked')].map((input) => input.value);
      data.conditions = conditionsKey(data);
      data.kind = editing?.kind || (form.querySelector('#community-issue-types:not([hidden])') ? 'correction' : 'new');
      data.substances = readSubstances();
      if (!editing && prefillRule) {
        data.kind = 'correction';
        data.baseRuleId = prefillRule.id;
        data.originalRule = prefillRule;
      } else if (editing) {
        data.kind = editing.kind;
        data.baseRuleId = editing.base_rule_id || '';
        data.originalRule = editing.original_rule_json;
      }
      const path = editing ? `/api/proposals/${encodeURIComponent(editing.id)}` : '/api/proposals';
      await api(path, { method: editing ? 'PATCH' : 'POST', body: data });
      clearTimeout(draftTimer);
      if (activeDraftId) draftStore?.remove(activeDraftId);
      activeDraftId = null;
      $('#community-proposal-dialog').close();
      showToast(t('proposalSubmitted'));
      await refresh();
    } catch (error) {
      errorNode.textContent = error.message;
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  let prefillRule = null;
  function openContextProposal(context, correction = false) {
    if (!context) return openProposal();
    const rule = correction ? context.originalRule : null;
    openProposal({
      kind: correction && rule ? 'correction' : 'new',
      reactants: context.reactants,
      equation: context.equation || `${context.reactants} = `,
      conditions: context.conditions,
      outcome: context.outcome,
      originalRule: rule,
      issueTypes: correction ? ['products'] : []
    });
  }

  async function act(action, id, value, card) {
    try {
      if (action === 'vote') {
        await api(`/api/proposals/${encodeURIComponent(id)}/vote`, { method: 'POST', body: { value: Number(value) } });
      } else if (action === 'withdraw') {
        await api(`/api/proposals/${encodeURIComponent(id)}/withdraw`, { method: 'POST', body: {} });
      } else if (action === 'approve' || ['needs_evidence', 'rejected'].includes(action)) {
        await api(`/api/proposals/${encodeURIComponent(id)}/review`, { method: 'POST', body: { action, note: card.querySelector('.review-note')?.value || '' } });
        if (action === 'approve') {
          await refreshRules();
          showToast(t('proposalApproved'));
        }
      } else if (action === 'edit') {
        const proposal = [...proposals, ...ownProposals].find((item) => item.id === id);
        if (proposal) openProposal({ proposal });
        return;
      }
      await refresh();
    } catch (error) {
      notifyError(error);
    }
  }

  async function loadVersions(details) {
    if (!details.open || details.dataset.loaded === 'true' || details.dataset.loading === 'true') return;
    const id = details.dataset.proposal;
    const content = details.querySelector('.version-content');
    details.dataset.loading = 'true';
    content.replaceChildren(element('p', 'help-text', t('loadingVersions')));
    try {
      const data = await api(`/api/proposals/${encodeURIComponent(id)}/versions`);
      content.replaceChildren();
      for (const version of data.versions) {
        const entry = element('article', 'version-entry');
        entry.append(element('p', 'help-text', `${t('packageVersion')} ${version.package_version} · ${version.publisher_login} · ${formatDate(version.published_at)}${version.current ? ` · ${t('currentVersion')}` : ''}`), element('p', 'proposal-equation', ruleEquation(version.rule)));
        const actions = element('div', 'proposal-actions');
        const compare = button(t('compareCurrent'), 'compare', version.id);
        compare.addEventListener('click', () => {
          entry.querySelector('.diff-output')?.remove();
          const difference = renderRuleDiff(data.currentRule, version.rule);
          difference.classList.add('diff-output');
          entry.append(difference);
        });
        actions.append(compare);
        if (!version.current && MODERATORS.includes(user?.privileges)) {
          const rollback = button(t('rollbackVersion'), 'rollback', version.id, 'button secondary');
          rollback.disabled = proposalOwns(user, id);
          rollback.addEventListener('click', async () => {
            if (!window.confirm(t('confirmRollback'))) return;
            try {
              await api(`/api/proposals/${encodeURIComponent(id)}/rollback`, { method: 'POST', body: { versionId: version.id } });
              await refreshRules();
              await refresh();
              showToast(t('rollbackComplete'));
            } catch (error) { notifyError(error); }
          });
          actions.append(rollback);
        }
        entry.append(actions);
        content.append(entry);
      }
      details.dataset.loaded = 'true';
    } catch (error) {
      content.replaceChildren(element('p', 'inline-error', error.message));
    } finally {
      details.dataset.loading = 'false';
    }
  }

  function proposalOwns(account, proposalId) {
    const proposal = [...proposals, ...ownProposals].find((item) => item.id === proposalId);
    return account?.privileges !== 'GOD' && proposal?.author_id === account?.id;
  }

  for (const selector of ['#community-feed', '#community-own']) {
    $(selector).addEventListener('click', (event) => {
      const control = event.target.closest('[data-action]');
      if (!control) return;
      const id = control.dataset.proposal || control.dataset.value;
      act(control.dataset.action, id, control.dataset.value, control.closest('.proposal-card'));
    });
    $(selector).addEventListener('toggle', (event) => {
      if (event.target.matches('.version-details')) loadVersions(event.target);
    }, true);
  }
  $('#community-users').addEventListener('change', async (event) => {
    const select = event.target.closest('[data-user-role]');
    if (!select) return;
    try {
      await api(`/api/users/${select.dataset.userRole}/role`, { method: 'PATCH', body: { privileges: select.value } });
      showToast(t('roleUpdated'));
      await refreshUsers();
    } catch (error) {
      notifyError(error);
      await refreshUsers();
    }
  });

  function renderPublicProfile() {
    const summary = $('#public-profile-summary');
    const list = $('#public-profile-proposals');
    summary.replaceChildren();
    list.replaceChildren();
    if (!publicProfile) return;
    const account = publicProfile.user;
    if (account.avatar) {
      const image = element('img', 'public-avatar');
      image.src = account.avatar;
      image.alt = '';
      summary.append(image);
    }
    summary.append(element('h2', 'community-login', account.nickname || account.login), element('p', 'help-text', `${t('loginForAuth')}: ${account.login}`), element('p', `role-badge role-${account.privileges.toLowerCase()}`, `${t('role')}: ${account.privileges}`), element('p', 'help-text', `${t('registered')}: ${formatDate(account.created_at)}`), element('p', 'community-reputation', `${t('reputation')}: ${signedNumber(account.reputation)}`));
    if (!publicProfile.proposals.length) list.append(element('p', 'help-text', t('noPublicProposals')));
    for (const proposal of publicProfile.proposals) {
      const card = element('article', `proposal-card status-${proposal.status}`);
      card.append(element('p', 'proposal-equation', ruleEquation(proposal.proposed_rule_json)), element('p', 'proposal-conditions', conditionText(proposal.proposed_rule_json.when)), element('p', 'proposal-status', `${t(`status_${proposal.status}`)} · ${formatDate(proposal.created_at)} · ${signedNumber(proposal.score)}`));
      if (proposal.review_note) card.append(element('p', 'notice', `${t('reviewNote')}: ${proposal.review_note}`));
      list.append(card);
    }
  }

  async function showPublicProfile(login) {
    try {
      publicProfile = await api(`/api/users/${encodeURIComponent(login)}/public`);
      $('#cabinet-status').textContent = '';
      renderAccount();
      renderPublicProfile();
      onNavigate('account');
    } catch (error) {
      $('#cabinet-status').textContent = error.message;
      onNavigate('account');
    }
  }

  async function restore() {
    try {
      const session = await api('/api/auth/me');
      user = session.user;
      csrfToken = session.csrfToken;
      if (draftStore?.userId !== user.id) setDraftUser(user);
    } catch (error) {
      if (error.status !== 401) $('#community-status').textContent = t('communityOffline');
      if (error.status === 401) {
        try {
          const webApp = await ensureTelegramSdk();
          const initData = webApp?.initData || getTelegramInitData();
          if (initData) {
            const session = await api('/api/auth/telegram', { method: 'POST', body: { initData } });
            user = session.user;
            csrfToken = session.csrfToken;
            setDraftUser(user);
          }
        } catch (telegramError) {
          if (telegramError.status === 401) showToast(t('telegramAuthError'));
        }
      }
    }
    if (!user && !publicProfile) $('#cabinet-status').textContent = t('authRequired');
    renderAccount();
    await Promise.all([refresh(), refreshRules()]);
  }

  if (typeof EventSource === 'function') {
    const events = new EventSource('/api/events');
    events.addEventListener('community-update', (event) => {
      let data = {};
      try { data = JSON.parse(event.data); } catch { /* ignore malformed heartbeat */ }
      scheduleRefresh(data);
    });
    events.onopen = () => { $('#community-status').textContent = ''; };
    events.onerror = () => { $('#community-status').textContent = t('pollingFallback'); };
  }
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);

  function renderCommunityView() {
    $('#community-proposals-view').hidden = communityView !== 'proposals';
    $('#community-questions-view').hidden = communityView !== 'questions';
    $('#community-new-proposal').hidden = communityView !== 'proposals';
    const askButton = $('#community-ask-question');
    if (askButton) askButton.hidden = communityView !== 'questions';
    document.querySelectorAll('[data-community-view]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.communityView === communityView));
    });
    if (communityView === 'questions') qaController?.activate();
  }

  function showQuestions() {
    communityView = 'questions';
    renderCommunityView();
  }
  document.querySelectorAll('[data-community-view]').forEach((button) => {
    button.addEventListener('click', () => {
      communityView = button.dataset.communityView;
      renderCommunityView();
    });
  });
  async function mountQuestions() {
    if (qaController) return qaController;
    const { initQAUI } = await import('./qa-ui.js');
    qaController = initQAUI({ container: $('#community-questions-view'), api, auth: () => ({ user }), showToast, onDeepLink: () => { onNavigate('community'); communityView = 'questions'; renderCommunityView(); }, onLoginRequired: () => { onNavigate('account'); setTimeout(() => $('#community-login')?.focus(), 50); } });
    return qaController;
  }
  $('#community-ask-question')?.addEventListener('click', async () => {
    if (!qaController) await mountQuestions();
    qaController?.showAsk();
  });
  renderCommunityView();
  mountQuestions().catch(() => {});

  const profileMatch = location.pathname.match(/^\/([^/]+)\/?$/);
  const initialWork = restore();
  ensureTelegramSdk().then(() => {
    if (user && !profileEditing) renderProfileSettings();
  });
  if (profileMatch && !location.pathname.includes('.')) {
    initialWork.then(() => {
      try { showPublicProfile(decodeURIComponent(profileMatch[1])); } catch { $('#cabinet-status').textContent = t('serverUnavailable'); }
    });
  }

  return {
    refresh,
    refreshRules,
    showQuestions,
    openProposal,
    openAutoProposal(correction = false) { openContextProposal(getAutoContext(), correction); },
    openCheckProposal() { openContextProposal(getCheckContext(), true); },
    async showAlternatives(container, context) {
      container.replaceChildren();
      if (!context?.reactants) return;
      try {
        const key = reactionKey(parseSide(context.reactants), context.conditions);
        const data = await api(`/api/proposals?status=pending&reactionKey=${encodeURIComponent(key)}`);
        if (!data.proposals.length) return;
        container.append(element('h3', '', t('pendingAlternatives')));
        for (const proposal of data.proposals.slice(0, 3)) {
          const card = element('div', 'community-alternative');
          card.append(element('p', 'help-text', `${t('unverifiedAnswer')} · ${proposal.author_login}`), element('p', 'proposal-equation', ruleEquation(proposal.proposed_rule_json)));
          const open = button(t('openInCommunity'), 'open-proposal', proposal.id);
          open.addEventListener('click', () => {
            onNavigate('community');
            refresh().then(() => document.getElementById(`proposal-${proposal.id}`)?.scrollIntoView({ block: 'center' }));
          });
          card.append(open);
          container.append(card);
        }
      } catch { /* local/static mode has no community API */ }
    },
    getUser: () => user
  };
}
