import { getLocale, t } from './i18n.js';
import { filterHistoryEntries } from './history.js';
import { equationToUnicode, parseEquation } from './parser.js';

const $ = (selector) => document.querySelector(selector);

export function initHistoryUI({ store, confirmAction, onOpen }) {
  function equationLabel(value) {
    try { return equationToUnicode(parseEquation(value)); }
    catch { return value; }
  }

  function render() {
    const allItems = store.list();
    const items = filterHistoryEntries(allItems, $('#history-filter').value);
    const list = $('#history-list');
    list.replaceChildren();
    $('#history-empty').hidden = items.length > 0;
    $('#history-empty p').textContent = allItems.length ? t('historyNoFilter') : t('historyEmpty');
    $('#history-clear').disabled = allItems.length === 0;
    for (const entry of items) {
      const card = document.createElement('article');
      card.className = 'card history-card';
      card.dataset.historyId = entry.id;
      const meta = document.createElement('div');
      meta.className = 'history-meta';
      const mode = document.createElement('span');
      mode.className = 'mode-badge';
      mode.textContent = entry.mode === 'auto' ? t('autoMode') : t('checkMode');
      const date = document.createElement('time');
      date.dateTime = entry.createdAt;
      date.textContent = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(entry.createdAt));
      meta.append(mode, date);
      const equation = document.createElement('p');
      equation.className = 'history-equation';
      equation.textContent = equationLabel(entry.equation);
      const actions = document.createElement('div');
      actions.className = 'history-actions';
      const favorite = document.createElement('button');
      favorite.type = 'button';
      favorite.className = 'icon-button';
      favorite.dataset.historyFavorite = entry.id;
      favorite.setAttribute('aria-label', t(entry.favorite ? 'removeFavorite' : 'favorite'));
      favorite.setAttribute('aria-pressed', String(entry.favorite));
      favorite.textContent = entry.favorite ? '★' : '☆';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'button secondary';
      open.dataset.historyOpen = entry.id;
      open.textContent = t('open');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'button ghost';
      remove.dataset.historyDelete = entry.id;
      remove.textContent = t('delete');
      actions.append(favorite, open, remove);
      card.append(meta, equation, actions);
      list.append(card);
    }
  }

  $('#history-list').addEventListener('click', (event) => {
    const favorite = event.target.closest('[data-history-favorite]');
    const remove = event.target.closest('[data-history-delete]');
    const open = event.target.closest('[data-history-open]');
    if (favorite) store.toggleFavorite(favorite.dataset.historyFavorite);
    if (remove) store.remove(remove.dataset.historyDelete);
    if (open) {
      const entry = store.list().find((item) => item.id === open.dataset.historyOpen);
      if (entry) onOpen(entry);
      return;
    }
    if (favorite || remove) render();
  });
  $('#history-clear').addEventListener('click', async () => {
    if (!store.list().length || !await confirmAction(t('clearHistoryConfirm'))) return;
    store.clear();
    render();
  });
  $('#history-filter').addEventListener('change', render);
  render();
  return { render };
}
