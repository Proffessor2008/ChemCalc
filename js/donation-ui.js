import { t } from './i18n.js';
import { element, button } from './dom.js';

const DONATION_OPTIONS = [
  { key: 'boosty', url: 'https://boosty.to/chemcalc/donate', label: 'donateBoosty', hint: 'donateBoostyHint', mark: 'B', className: 'donation-option-boosty' },
  { key: 'yoomoney', url: 'https://yoomoney.ru/to/4100119690266585', label: 'donateYoomoney', hint: 'donateYoomoneyHint', mark: 'Ю', className: 'donation-option-yoomoney' }
];
const STORAGE_KEY = 'chemcalc-donation-shown-at';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function initDonationUI() {
  let shownAt = 0;
  try { shownAt = Number(localStorage.getItem(STORAGE_KEY) || 0); } catch { /* ignore */ }
  let card = null;
  let pending = false;
  const dialog = document.getElementById('donation-dialog');
  const root = document.getElementById('donation-app');

  function donationTarget(value) {
    const url = new URL(value);
    url.searchParams.set('utm_source', 'chemcalc');
    url.searchParams.set('utm_medium', 'app');
    url.searchParams.set('utm_campaign', 'donate');
    return url.toString();
  }

  function markShown() {
    shownAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, String(shownAt)); } catch { /* ignore */ }
  }

  function openDonation(value, event) {
    event?.preventDefault();
    markShown();
    const url = donationTarget(value);
    const webApp = window.Telegram?.WebApp;
    dialog?.close();
    if (webApp?.openLink) {
      try { webApp.openLink(url); return; } catch { /* fall through */ }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function dismiss() {
    card?.remove();
    card = null;
  }

  function canShow() {
    if (card) return false;
    if (Date.now() - shownAt < WEEK_MS) return false;
    if (document.visibilityState === 'hidden') return false;
    if (document.querySelector('dialog[open], .tour-card')) return false;
    return true;
  }

  function renderChoice() {
    if (!dialog || !root) {
      openDonation(DONATION_OPTIONS[0].url);
      return;
    }
    root.replaceChildren();
    const head = element('div', 'dialog-heading');
    const title = element('h2', '', t('donateChooseTitle'));
    title.id = 'donation-title';
    const close = button('×', 'icon-button');
    close.setAttribute('aria-label', t('close'));
    close.addEventListener('click', () => dialog.close());
    head.append(title, close);
    const body = element('div', 'donation-choose');
    body.append(element('p', 'help-text', t('donateChooseText')));
    const list = element('div', 'donation-options');
    for (const option of DONATION_OPTIONS) {
      const link = element('a', `donation-option ${option.className}`);
      link.href = option.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const mark = element('span', 'donation-option-mark', option.mark);
      mark.setAttribute('aria-hidden', 'true');
      const copy = element('span', 'donation-option-copy');
      copy.append(element('strong', '', t(option.label)), element('small', '', t(option.hint)));
      const arrow = element('span', 'donation-option-arrow', '→');
      arrow.setAttribute('aria-hidden', 'true');
      link.append(mark, copy, arrow);
      link.addEventListener('click', (event) => openDonation(option.url, event));
      list.append(link);
    }
    body.append(list);
    root.append(head, body);
    if (!dialog.open) dialog.showModal();
  }

  function openChoice(event) {
    event?.preventDefault();
    markShown();
    dismiss();
    renderChoice();
  }

  function showCard() {
    if (!canShow()) return;
    pending = false;
    markShown();
    card = element('aside', 'donation-card');
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', t('donateCardTitle'));
    const icon = element('span', 'donation-card-icon', '♥');
    icon.setAttribute('aria-hidden', 'true');
    const copy = element('div', 'donation-card-copy');
    copy.append(element('strong', '', t('donateCardTitle')), element('p', '', t('donateCardText')));
    const actions = element('div', 'donation-card-actions');
    const notNow = button(t('donateNotNow'), 'text-button');
    notNow.addEventListener('click', dismiss);
    const support = button(t('donateSupport'), 'button primary compact');
    support.addEventListener('click', openChoice);
    actions.append(notNow, support);
    card.append(icon, copy, actions);
    document.body.append(card);
    requestAnimationFrame(() => card?.classList.add('visible'));
  }

  for (const link of document.querySelectorAll('[data-donation-link]')) {
    link.addEventListener('click', openChoice);
  }
  dialog?.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

  function tryShow() {
    if (!pending || card) return;
    if (!canShow()) return;
    showCard();
  }

  window.addEventListener('chemcalc:successful-use', () => {
    pending = true;
    setTimeout(tryShow, 1400);
  });

  document.addEventListener('close', (event) => {
    if (event.target?.tagName === 'DIALOG') setTimeout(tryShow, 250);
  }, true);
}
