import { t } from './i18n.js';
import { element, button } from './dom.js';

const DONATION_URL = 'https://yoomoney.ru/to/4100119690266585';
const STORAGE_KEY = 'chemcalc-donation-shown-at';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function initDonationUI() {
  let shownAt = 0;
  try { shownAt = Number(localStorage.getItem(STORAGE_KEY) || 0); } catch { /* ignore */ }
  let card = null;
  let pending = false;

  function donationTarget() {
    const url = new URL(DONATION_URL);
    url.searchParams.set('utm_source', 'chemcalc');
    url.searchParams.set('utm_medium', 'app');
    url.searchParams.set('utm_campaign', 'donate');
    return url.toString();
  }

  function markShown() {
    shownAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, String(shownAt)); } catch { /* ignore */ }
  }

  function openDonation(event) {
    event?.preventDefault();
    markShown();
    const url = donationTarget();
    const webApp = window.Telegram?.WebApp;
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
    support.addEventListener('click', openDonation);
    actions.append(notNow, support);
    card.append(icon, copy, actions);
    document.body.append(card);
    requestAnimationFrame(() => card?.classList.add('visible'));
  }

  for (const link of document.querySelectorAll('[data-donation-link]')) {
    link.addEventListener('click', openDonation);
  }

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
