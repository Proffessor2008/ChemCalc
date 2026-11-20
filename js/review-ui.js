import { t } from './i18n.js';
import { element, button } from './dom.js';

const FEATURES = ['calculations', 'redox', 'stoichiometry', 'references', 'reports', 'community', 'telegram', 'design'];
const PROMPT_KEY = 'chemcalc-review-prompted';
const SUBMITTED_KEY = 'chemcalc-review-submitted';

function featureLabel(key) {
  return t(`reviewFeature${key.charAt(0).toUpperCase()}${key.slice(1)}`);
}

function contextLabel(context) {
  return t({ calculator: 'reviewContextCalculator', stoichiometry: 'reviewContextStoichiometry', settings: 'reviewContextSettings' }[context] || 'reviewContextSettings');
}

export function initReviewUI({ showToast = () => {} } = {}) {
  const dialog = document.getElementById('review-dialog');
  const root = document.getElementById('review-app');
  if (!dialog || !root) return;
  let user = null;
  let csrf = '';
  let existing = null;
  let rating = 0;
  let usability = 0;
  let selectedFeatures = new Set();
  let context = 'settings';
  let prompt = false;
  let promptPending = false;
  let summary = null;
  const publicDialog = document.getElementById('review-public-dialog');
  const publicContent = document.getElementById('review-public-content');

  async function fetchSummary() {
    try { summary = await api('/api/reviews/summary'); } catch { summary = null; }
    return summary;
  }

  function renderDistribution(host, data) {
    host.replaceChildren();
    if (!data?.count) {
      host.append(element('p', 'help-text', t('reviewPublicEmpty')));
      return;
    }
    const top = element('div', 'review-public-top');
    top.append(element('strong', '', t('reviewPublicCount', { count: data.count })));
    top.append(element('span', '', t('reviewPublicAverage', { average: Number(data.average).toFixed(1) })));
    host.append(top);
    const list = element('div', 'review-distribution');
    for (let rating = 5; rating >= 1; rating -= 1) {
      const entry = data.distribution?.find((item) => Number(item.rating) === rating);
      const count = Number(entry?.count || 0);
      const percent = data.count ? Math.round(count / data.count * 100) : 0;
      const row = element('div', 'review-distribution-row');
      row.append(element('span', 'review-distribution-rating', `${rating} ★`));
      const track = element('div', 'review-distribution-track');
      const bar = element('span', 'review-distribution-bar');
      bar.style.width = `${percent}%`;
      track.append(bar);
      row.append(track, element('span', 'review-distribution-count', `${count} · ${percent}%`));
      list.append(row);
    }
    host.append(list);
  }

  async function refreshSummary() {
    const inline = document.getElementById('review-public-summary');
    if (!inline) return;
    inline.replaceChildren(element('p', 'help-text', t('reviewSending')));
    await fetchSummary();
    renderDistribution(inline, summary);
  }

  async function openPublicSummary() {
    if (!publicDialog || !publicContent) return;
    publicContent.replaceChildren(element('p', 'help-text', t('reviewSending')));
    publicDialog.showModal();
    await fetchSummary();
    publicContent.replaceChildren();
    const header = element('div', 'dialog-heading');
    const heading = element('h2', '', t('reviewPublicTitle'));
    heading.id = 'review-public-title';
    header.append(heading);
    const close = button('×', 'icon-button');
    close.setAttribute('aria-label', t('close'));
    close.addEventListener('click', () => publicDialog.close());
    header.append(close);
    const body = element('div', 'review-public-body');
    renderDistribution(body, summary);
    publicContent.append(header, body);
  }

  async function syncOwnLabel() {
    const trigger = document.getElementById('review-open');
    if (!trigger) return;
    try {
      const data = await api('/api/reviews/mine');
      const hasReview = Boolean(data.review);
      trigger.textContent = t(hasReview ? 'reviewEdit' : 'reviewOpen');
      trigger.dataset.i18n = hasReview ? 'reviewEdit' : 'reviewOpen';
    } catch { /* оставляем подпись по умолчанию */ }
  }

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

  async function loadSession() {
    try {
      const session = await api('/api/auth/me');
      user = session.user;
      csrf = session.csrfToken || '';
    } catch {
      user = null;
      csrf = '';
    }
  }

  function renderStars(host, value, onSelect, label) {
    host.replaceChildren();
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', label);
    for (let index = 1; index <= 5; index += 1) {
      const star = button('★', `review-star${index <= value ? ' active' : ''}`);
      star.setAttribute('aria-label', `${label}: ${index}`);
      star.setAttribute('aria-pressed', index <= value ? 'true' : 'false');
      star.addEventListener('click', () => {
        onSelect(index);
        [...host.children].forEach((child, childIndex) => {
          child.classList.toggle('active', childIndex < index);
          child.setAttribute('aria-pressed', childIndex < index ? 'true' : 'false');
        });
      });
      host.append(star);
    }
  }

  function renderForm() {
    root.replaceChildren();
    const header = element('div', 'dialog-heading');
    const heading = element('div');
    heading.append(element('h2', '', prompt ? t('reviewPromptTitle') : t('reviewTitle')));
    if (prompt) heading.append(element('p', 'help-text', t('reviewPromptText')));
    header.append(heading);
    const close = button('×', 'icon-button');
    close.setAttribute('aria-label', t('close'));
    close.addEventListener('click', () => closeDialog());
    header.append(close);
    root.append(header);

    const form = element('form', 'review-form');
    if (existing) form.append(element('p', 'review-existing', t('reviewAlready')));
    const ratingBlock = element('div', 'review-block');
    ratingBlock.append(element('span', 'review-label', t('reviewRatingLabel')));
    const stars = element('div', 'review-stars');
    ratingBlock.append(stars);
    renderStars(stars, rating, (value) => { rating = value; }, t('reviewRatingLabel'));
    form.append(ratingBlock);

    const usabilityBlock = element('div', 'review-block');
    usabilityBlock.append(element('span', 'review-label', t('reviewUsabilityLabel')));
    const usabilityStars = element('div', 'review-stars');
    usabilityBlock.append(usabilityStars);
    renderStars(usabilityStars, usability, (value) => { usability = value; }, t('reviewUsabilityLabel'));
    form.append(usabilityBlock);

    const featuresBlock = element('div', 'review-block');
    featuresBlock.append(element('span', 'review-label', t('reviewFeaturesLabel')));
    const features = element('div', 'review-features');
    for (const key of FEATURES) {
      const chip = button(featureLabel(key), `review-chip${selectedFeatures.has(key) ? ' active' : ''}`);
      chip.setAttribute('aria-pressed', selectedFeatures.has(key) ? 'true' : 'false');
      chip.addEventListener('click', () => {
        if (selectedFeatures.has(key)) selectedFeatures.delete(key); else selectedFeatures.add(key);
        chip.classList.toggle('active', selectedFeatures.has(key));
        chip.setAttribute('aria-pressed', selectedFeatures.has(key) ? 'true' : 'false');
      });
      features.append(chip);
    }
    featuresBlock.append(features);
    form.append(featuresBlock);

    const suggestionsBlock = element('div', 'review-block');
    const suggestionsLabel = element('label', 'review-label', t('reviewSuggestionsLabel'));
    const suggestions = element('textarea', 'review-suggestions');
    suggestions.rows = 4;
    suggestions.maxLength = 2000;
    suggestions.placeholder = t('reviewSuggestionsPlaceholder');
    suggestions.value = existing?.suggestions || '';
    suggestions.setAttribute('aria-label', t('reviewSuggestionsLabel'));
    suggestionsBlock.append(suggestionsLabel, suggestions);
    form.append(suggestionsBlock);

    form.append(element('p', 'help-text review-privacy', `${contextLabel(context)} · ${user ? user.nickname || user.login : t('reviewAnonymous')}`));
    const actions = element('div', 'dialog-actions');
    const later = button(t('cancel'), 'button ghost');
    later.addEventListener('click', () => closeDialog());
    const submit = button(existing ? t('reviewSubmit') : t('reviewSubmit'), 'button primary', 'submit');
    actions.append(later, submit);
    form.append(actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!rating) { showToast(t('reviewRatingRequired')); return; }
      submit.disabled = true;
      submit.textContent = t('reviewSending');
      try {
        const data = await api('/api/reviews', {
          method: 'POST',
          body: {
            rating,
            usability: usability || null,
            features: [...selectedFeatures],
            suggestions: suggestions.value,
            context
          }
        });
        existing = data.review;
        try { localStorage.setItem(SUBMITTED_KEY, '1'); localStorage.setItem(PROMPT_KEY, '1'); } catch { /* ignore */ }
        await refreshSummary();
        syncOwnLabel();
        root.replaceChildren();
        const thanks = element('div', 'review-thanks');
        thanks.append(element('div', 'review-thanks-icon', '✓'), element('h2', '', t('reviewThanks')));
        const done = button(t('close'), 'button primary');
        done.addEventListener('click', () => closeDialog());
        thanks.append(done);
        root.append(thanks);
        setTimeout(() => { if (dialog.open) closeDialog(); }, 1600);
        showToast(t('reviewThanks'));
      } catch (error) {
        showToast(error.message);
        submit.disabled = false;
        submit.textContent = t('reviewSubmit');
      }
    });
    root.append(form);
    setTimeout(() => stars.querySelector('button')?.focus(), 50);
  }

  async function open({ context: initialContext = 'settings', prompt: isPrompt = false } = {}) {
    prompt = isPrompt;
    context = ['calculator', 'stoichiometry', 'settings'].includes(initialContext) ? initialContext : 'settings';
    document.getElementById('settings-dialog')?.close();
    dialog.showModal();
    root.replaceChildren(element('p', 'help-text review-loading', t('reviewSending')));
    await loadSession();
    try {
      const data = await api('/api/reviews/mine');
      existing = data.review;
    } catch { existing = null; }
    rating = Number(existing?.rating || 0);
    usability = Number(existing?.usability || 0);
    selectedFeatures = new Set(Array.isArray(existing?.features) ? existing.features : []);
    renderForm();
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
    try { localStorage.setItem(PROMPT_KEY, '1'); } catch { /* ignore */ }
  }

  async function maybePrompt(nextContext) {
    if (promptPending || dialog.open) return;
    try {
      if (localStorage.getItem(PROMPT_KEY) || localStorage.getItem(SUBMITTED_KEY)) return;
    } catch { /* ignore */ }
    if (document.querySelector('dialog[open]')) return;
    promptPending = true;
    try { localStorage.setItem(PROMPT_KEY, '1'); } catch { /* ignore */ }
    setTimeout(() => {
      promptPending = false;
      open({ context: nextContext, prompt: true }).catch(() => {});
    }, 700);
  }

  document.getElementById('review-open')?.addEventListener('click', () => open({ context: 'settings' }));
  document.getElementById('review-float')?.addEventListener('click', () => open({ context: 'settings' }));
  document.getElementById('review-public-open')?.addEventListener('click', openPublicSummary);
  publicDialog?.addEventListener('click', (event) => { if (event.target === publicDialog) publicDialog.close(); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(); });
  window.addEventListener('chemcalc:successful-use', (event) => {
    maybePrompt(event?.detail?.context || 'settings');
  });
  refreshSummary();
  syncOwnLabel();
}
