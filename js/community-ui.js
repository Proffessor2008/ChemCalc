import { balanceEquation, inspectBalance } from './balancer.js';
import { findSubstance } from './checker.js';
import { electrolyteRecord } from './electrolytes.js';
import { buildIonicEquations } from './ionic.js';
import { equationToUnicode, formatEquation, parseEquation, parseSide, parseSpecies } from './parser.js';
import { updateCommunityData } from './predictor.js';
import { getLocale, t } from './i18n.js';

const $ = (selector) => document.querySelector(selector);
const CLASSES = ['salt', 'acid', 'base', 'oxide', 'acidic_oxide', 'basic_oxide', 'amphoteric_oxide', 'simple', 'metal', 'organic', 'binary', 'gas', 'complex', 'acidic_salt', 'basic_salt', 'organic_salt', 'peroxide', 'hydride', 'carbide', 'nitride', 'phosphide', 'sulfide', 'mineral', 'intermetallic', 'covalent_halide'];
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

export function initCommunityUI({ showToast, onNavigate, getAutoContext = () => null, getCheckContext = () => null }) {
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

  function renderAccount() {
    $('#community-auth-forms').hidden = Boolean(user);
    $('#community-account').hidden = !user;
    $('#community-own-section').hidden = !user;
    $('#community-users-section').hidden = user?.privileges !== 'GOD';
    $('#community-moderation-note').hidden = !MODERATORS.includes(user?.privileges);
    const account = $('#community-account');
    account.replaceChildren();
    if (!user) {
      ownProposals = [];
      $('#community-own').replaceChildren();
      $('#community-users').replaceChildren();
      return;
    }
    account.append(
      element('h3', 'community-login', user.login),
      element('p', `role-badge role-${user.privileges.toLowerCase()}`, `${t('role')}: ${user.privileges}`),
      element('p', 'help-text', `${t('registered')}: ${formatDate(user.created_at)}`),
      element('p', 'help-text', `${t('lastSession')}: ${formatDate(user.last_login_at)}`),
      element('p', 'help-text community-reputation', `${t('reputation')}: ${signedNumber(user.reputation)}`),
      element('p', 'help-text', `${t('pendingMine')}: ${ownProposals.filter((item) => item.status === 'pending').length}`)
    );
    account.append(button(t('signOut'), 'logout', undefined, 'button secondary'));
  }

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
        original.append(element('summary', '', t('originalAnswer')), element('p', 'proposal-equation', ruleEquation(proposal.original_rule_json)));
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
    return card;
  }

  function conditionText(conditions = {}) {
    return [t(conditions.medium || 'neutral'), t(conditions.solvent || 'aqueous'), conditions.acidConcentration !== 'unspecified' ? t(conditions.acidConcentration) : '', conditions.catalyst ? `${t('catalyst')}: ${conditions.catalyst}` : '', conditions.heating ? t('heating') : '', conditions.current ? t('electricCurrent') : '', conditions.ratio === 'deficit' ? t('deficitRatio') : ''].filter(Boolean).join(' · ');
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
    renderAccount();
  }

  async function refreshUsers() {
    if (user?.privileges !== 'GOD') return;
    const data = await api('/api/users');
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
      const feedRequest = api(`/api/proposals?status=pending&sort=${encodeURIComponent(sort)}`);
      const ownRequest = user ? api('/api/proposals?author=me') : Promise.resolve({ proposals: [] });
      const accountRequest = user ? api('/api/auth/me').then((session) => {
        if (generation === requestGeneration) {
          user = session.user;
          csrfToken = session.csrfToken;
        }
      }) : Promise.resolve();
      const [feed, own] = await Promise.all([feedRequest, ownRequest, accountRequest]);
      if (generation !== requestGeneration) return;
      proposals = feed.proposals;
      ownProposals = own.proposals;
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
  $('#community-account').addEventListener('click', async (event) => {
    if (!event.target.closest('[data-action="logout"]')) return;
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} });
    } catch (error) {
      if (error.status !== 401) return notifyError(error);
    }
    user = null;
    csrfToken = '';
    requestGeneration++;
    renderAccount();
    await refresh();
  });
  $('#community-sort').addEventListener('change', refresh);
  $('#community-new-proposal').addEventListener('click', () => openProposal());

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
        <div class="conditions-grid"><label><span>${t('substanceClass')}</span><select data-field="class">${selectOptions(CLASSES, record.class || knownName?.class || 'salt', (value) => value)}</select></label>
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
      onNavigate('community');
      $('#community-login').focus();
      showToast(t('loginToPropose'));
      return;
    }
    editing = prefill.proposal || null;
    prefillRule = editing ? null : prefill.originalRule || null;
    const rule = editing?.proposed_rule_json || prefill.originalRule || null;
    const kind = editing?.kind || prefill.kind || 'new';
    const conditions = conditionsKey(editing ? rule.when : prefill.conditions);
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
    substanceDraft = new Map((rule?.substances || []).map((item) => [item.formula, item]));
    form.elements.equation.value = editing ? plainEquation(rule) : prefill.equation || `${prefill.reactants || ''} = `;
    form.elements.outcome.value = editing?.proposed_rule_json?.outcome || prefill.outcome || 'products';
    form.elements.reactionType.value = rule?.type || t('communityRule');
    form.elements.sourceDetails.value = editing?.source_details || '';
    form.elements.comment.value = editing?.comment || prefill.comment || '';
    form.elements.phaseSpecific.checked = conditions.solvent !== 'aqueous' && form.elements.outcome.value === 'products';
    form.elements.specialCase.checked = Boolean(rule?.specialCase);
    form.elements.manualIonicFull.value = rule?.ionicOverride?.full || '';
    form.elements.manualIonicNet.value = rule?.ionicOverride?.net || '';
    for (const input of form.querySelectorAll('[name="issueTypes"]')) input.checked = Boolean(editing?.issue_types?.includes(input.value) || prefill.issueTypes?.includes(input.value));
    form.addEventListener('input', (event) => {
      if (event.target.name === 'equation') refreshSubstanceCards(rule);
      validatePreview();
    });
    form.addEventListener('change', (event) => {
      if (['solvent', 'outcome'].includes(event.target.name)) {
        if (event.target.name === 'outcome') form.elements.equation.value = event.target.value === 'no-reaction' ? (parseSideSafe(form.elements.equation.value)) : `${parseSideSafe(form.elements.equation.value)} = `;
        refreshSubstanceCards(rule);
      }
      updateManualIonicVisibility(form);
      validatePreview();
    });
    form.addEventListener('submit', submitProposal);
    for (const close of form.querySelectorAll('[data-close-proposal]')) close.addEventListener('click', () => dialog.close());
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

  for (const selector of ['#community-feed', '#community-own']) {
    $(selector).addEventListener('click', (event) => {
      const control = event.target.closest('[data-action]');
      if (!control) return;
      const id = control.dataset.proposal || control.dataset.value;
      act(control.dataset.action, id, control.dataset.value, control.closest('.proposal-card'));
    });
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

  async function restore() {
    try {
      const session = await api('/api/auth/me');
      user = session.user;
      csrfToken = session.csrfToken;
    } catch (error) {
      if (error.status !== 401) $('#community-status').textContent = t('communityOffline');
    }
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
  restore();

  return {
    refresh,
    refreshRules,
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
