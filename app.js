'use strict';

/* ---------- Configuration ---------- */
const CONFIG = {
  CARAPI_JWT_TOKEN: 'YOUR_CARAPI_JWT_TOKEN_HERE', // optional: paste a ready-made JWT to skip the login step
  CARAPI_API_TOKEN: '83e6a5ce-f685-412c-b3ea-8141776fc28c',  // exchanged for a JWT via /api/auth/login
  CARAPI_API_SECRET: 'b3c04ee510e612d4d9a3816f52fb5f42',
  API_BASE: 'https://carapi.app/api',
  PAGE_LIMIT: 100,      // rows per API page
  MAX_PAGES: 15,        // safety cap per endpoint (15 x 100 rows)
  BATCH: 24,            // cards rendered per "show more"
  CHUNK: 50,            // trim ids resolved per request
  SITE_URL: 'https://spec-hunter.suvadipchakraborty.workers.dev/',
};

const DRIVE_VALUES = {
  RWD: ['rear wheel drive', 'RWD'],
  AWD: ['all wheel drive', 'four wheel drive', 'AWD', '4WD'],
  FWD: ['front wheel drive', 'FWD'],
};
const WEIGHT_OFF = 6000, HP_OFF = 0, YEAR_MIN = 1990, YEAR_MAX = 2024;

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const fmt = (n) => Number(n).toLocaleString('en-US');

const state = { run: 0, matches: [], cursor: 0, weights: new Map(), engines: new Map(), f: null, busy: false };

/* ---------- Tabs ---------- */
document.querySelectorAll('.bottom-nav button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.bottom-nav button').forEach((x) => {
      x.classList.toggle('active', x === b);
      x.toggleAttribute('aria-current', x === b);
    });
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${b.dataset.tab}`));
    closeDrawer();
    window.scrollTo({ top: 0 });
  })
);

/* ---------- Filters UI ---------- */
const ui = {
  yearMin: $('#yearMin'), yearMax: $('#yearMax'), yearOut: $('#yearOut'),
  drive: $('#drive'), hp: $('#hp'), hpOut: $('#hpOut'),
  weight: $('#weight'), wtOut: $('#wtOut'), cyl: $('#cyl'),
  status: $('#status'), grid: $('#grid'), more: $('#moreBtn'), btn: $('#huntBtn'),
  panel: $('#filters'), toggle: $('#filterToggle'),
};

function syncLabels(e) {
  let a = +ui.yearMin.value, b = +ui.yearMax.value;
  if (a > b) { if (e && e.target === ui.yearMin) { b = a; ui.yearMax.value = b; } else { a = b; ui.yearMin.value = a; } }
  ui.yearOut.textContent = `${a} to ${b}`;
  ui.hpOut.textContent = +ui.hp.value === HP_OFF ? 'Any' : `${ui.hp.value} HP`;
  ui.wtOut.textContent = +ui.weight.value >= WEIGHT_OFF ? 'No limit' : `${fmt(ui.weight.value)} lbs`;
}
['yearMin', 'yearMax', 'hp', 'weight'].forEach((id) => ui[id].addEventListener('input', syncLabels));

function openDrawer() { ui.panel.classList.add('open'); ui.toggle.setAttribute('aria-expanded', 'true'); }
function closeDrawer() { ui.panel.classList.remove('open'); ui.toggle.setAttribute('aria-expanded', 'false'); }
ui.toggle.addEventListener('click', () => (ui.panel.classList.contains('open') ? closeDrawer() : openDrawer()));

$('#resetBtn').addEventListener('click', () => {
  $('#filter-form').reset();
  ui.yearMin.value = YEAR_MIN; ui.yearMax.value = YEAR_MAX;
  syncLabels();
});

function readFilters() {
  return {
    yearMin: +ui.yearMin.value, yearMax: +ui.yearMax.value,
    drive: ui.drive.value, hp: +ui.hp.value,
    weight: +ui.weight.value, weightOn: +ui.weight.value < WEIGHT_OFF,
    cyl: ui.cyl.value,
  };
}

/* ---------- CarAPI client ---------- */
const hasJwtOverride = () => CONFIG.CARAPI_JWT_TOKEN && !CONFIG.CARAPI_JWT_TOKEN.startsWith('YOUR_');
const tokenReady = () => hasJwtOverride() || (CONFIG.CARAPI_API_TOKEN && CONFIG.CARAPI_API_SECRET);

const jwtExpired = (jwt) => {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000 < Date.now() + 60000;
  } catch { return true; }
};

let jwtPending = null;
/** Returns a valid JWT: the manual override, a cached one, or a fresh login with the API token and secret. */
async function getJwt(force = false) {
  if (hasJwtOverride()) return CONFIG.CARAPI_JWT_TOKEN;
  let cached = null;
  try { cached = localStorage.getItem('sh-jwt'); } catch { /* storage blocked */ }
  if (!force && cached && !jwtExpired(cached)) return cached;
  if (!jwtPending) {
    jwtPending = fetch(`${CONFIG.API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/plain' },
      body: JSON.stringify({ api_token: CONFIG.CARAPI_API_TOKEN, api_secret: CONFIG.CARAPI_API_SECRET }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('CarAPI login failed. Check the API token and secret in app.js.');
        const jwt = (await res.text()).trim();
        try { localStorage.setItem('sh-jwt', jwt); } catch { /* storage blocked */ }
        return jwt;
      })
      .finally(() => { jwtPending = null; });
  }
  return jwtPending;
}

async function api(endpoint, filters, extra = {}, page = 1, retried = false) {
  const url = new URL(`${CONFIG.API_BASE}/${endpoint}`);
  url.searchParams.set('limit', CONFIG.PAGE_LIMIT);
  url.searchParams.set('page', page);
  if (filters && filters.length) url.searchParams.set('json', JSON.stringify(filters));
  Object.entries(extra).forEach(([k, v]) => url.searchParams.set(k, v));

  const jwt = await getJwt(retried);
  const res = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${jwt}` },
  });
  if (res.status === 401 && !retried && !hasJwtOverride()) return api(endpoint, filters, extra, page, true);
  if (res.status === 401 || res.status === 403) throw new Error('CarAPI rejected the credentials, or your plan does not cover this request.');
  if (res.status === 429) throw new Error('CarAPI rate limit reached. Wait a minute and hunt again.');
  if (!res.ok) throw new Error(`CarAPI returned ${res.status}. Try narrowing your filters.`);
  return res.json();
}

/** Walks every page of an endpoint (up to MAX_PAGES). */
async function fetchAll(endpoint, filters, { extra = {}, maxPages = CONFIG.MAX_PAGES, onProgress } = {}) {
  const rows = [];
  let page = 1, pages = 1;
  do {
    const json = await api(endpoint, filters, extra, page);
    rows.push(...(json.data || []));
    pages = (json.collection && json.collection.pages) || 1;
    if (onProgress) onProgress(page, Math.min(pages, maxPages));
    page++;
  } while (page <= pages && page <= maxPages);
  return { rows, truncated: pages > maxPages };
}

/* ---------- The hunt ---------- */
const cylVariants = (n) => [String(n), `I${n}`, `V${n}`, `H${n}`, `W${n}`, `L${n}`];
const driveLabel = (s = '') => (/rear|rwd/i.test(s) ? 'RWD' : /front|fwd/i.test(s) ? 'FWD' : /all|four|awd|4wd/i.test(s) ? 'AWD' : s || '');

function setStatus(msg, isError = false) {
  ui.status.textContent = msg;
  ui.status.classList.toggle('error', isError);
}

async function hunt() {
  if (state.busy) return;
  if (!tokenReady()) {
    setStatus('Add your CarAPI token and secret to CONFIG at the top of app.js, then hunt again.', true);
    return;
  }
  const run = ++state.run;
  state.busy = true; ui.btn.disabled = true;
  ui.grid.replaceChildren(); ui.more.hidden = true;
  state.matches = []; state.cursor = 0; state.weights.clear(); state.engines.clear();
  const f = (state.f = readFilters());
  closeDrawer();

  try {
    // 1) Engines: drive type, horsepower, cylinders
    const ef = [];
    if (f.drive !== 'any') ef.push({ field: 'drive_type', op: 'in', val: DRIVE_VALUES[f.drive] });
    if (f.hp > HP_OFF) ef.push({ field: 'horsepower_hp', op: '>=', val: f.hp });
    if (f.cyl !== 'any') ef.push({ field: 'cylinders', op: 'in', val: cylVariants(f.cyl) });

    const eng = await fetchAll('engines', ef, {
      onProgress: (p, t) => run === state.run && setStatus(`Scanning engines, page ${p} of ${t}`),
    });
    eng.rows.forEach((r) => {
      const id = r.make_model_trim_id;
      const prev = state.engines.get(id);
      if (id && (!prev || (r.horsepower_hp || 0) > (prev.horsepower_hp || 0))) state.engines.set(id, r);
    });
    let ids = [...state.engines.keys()];

    // 2) Bodies: curb weight (only when the weight cap is active)
    let truncated = eng.truncated;
    if (f.weightOn) {
      const bod = await fetchAll('bodies', [{ field: 'curb_weight', op: '<=', val: f.weight }], {
        onProgress: (p, t) => run === state.run && setStatus(`Cross-referencing curb weight, page ${p} of ${t}`),
      });
      bod.rows.forEach((r) => r.curb_weight && state.weights.set(r.make_model_trim_id, r.curb_weight));
      ids = ids.filter((id) => state.weights.has(id));
      truncated = truncated || bod.truncated;
    }
    if (run !== state.run) return;

    // 3) Strongest first
    ids.sort((a, b) => (state.engines.get(b).horsepower_hp || 0) - (state.engines.get(a).horsepower_hp || 0));
    state.matches = ids;
    state.truncated = truncated;

    if (!ids.length) return showEmpty();
    await loadMore(run);
  } catch (err) {
    if (run === state.run) setStatus(err.message || 'Something went wrong. Check your connection and try again.', true);
  } finally {
    if (run === state.run) { state.busy = false; ui.btn.disabled = false; }
  }
}

/** Resolves the next batch of trim ids into cards (trims endpoint + bodies for weights). */
async function loadMore(run = state.run) {
  const f = state.f;
  let added = 0;
  ui.more.disabled = true;
  setStatus('Identifying exact trims…');
  try {
    while (added < CONFIG.BATCH && state.cursor < state.matches.length) {
      const chunk = state.matches.slice(state.cursor, state.cursor + CONFIG.CHUNK);
      state.cursor += chunk.length;

      const tf = [
        { field: 'id', op: 'in', val: chunk },
        { field: 'year', op: '>=', val: f.yearMin },
        { field: 'year', op: '<=', val: f.yearMax },
      ];
      const needWeights = chunk.filter((id) => !state.weights.has(id));
      const [trims, bodies] = await Promise.all([
        api('trims', tf, { verbose: 'yes' }),
        needWeights.length ? api('bodies', [{ field: 'make_model_trim_id', op: 'in', val: needWeights }]) : { data: [] },
      ]);
      if (run !== state.run) return;
      (bodies.data || []).forEach((r) => r.curb_weight && state.weights.set(r.make_model_trim_id, r.curb_weight));

      const byId = new Map((trims.data || []).map((t) => [t.id, t]));
      chunk.forEach((id) => {
        const t = byId.get(id);
        if (!t) return;
        ui.grid.append(buildCard(t, state.engines.get(id), state.weights.get(id)));
        added++;
      });
    }
  } catch (err) {
    if (run === state.run) setStatus(err.message, true);
    ui.more.disabled = false;
    return;
  }
  ui.more.disabled = false;
  const left = state.cursor < state.matches.length;
  ui.more.hidden = !left;
  if (!ui.grid.children.length && !left) return showEmpty();
  const shown = ui.grid.children.length;
  setStatus(
    left
      ? `Showing ${shown} trims so far. ${fmt(state.matches.length - state.cursor)} more candidates to check.`
      : `${shown} matching trim${shown === 1 ? '' : 's'} found.` +
        (state.truncated ? ' Results were capped, so narrow the filters for a complete list.' : '')
  );
}

function showEmpty() {
  const box = el('div', 'empty');
  box.append(el('strong', null, 'No trims match those specs'), document.createTextNode('Loosen the weight cap, lower the horsepower floor, or widen the model years.'));
  ui.grid.replaceChildren(box);
  ui.more.hidden = true;
  setStatus('0 matching trims.');
}

/* ---------- Cards ---------- */
const SILHOUETTE = `<svg viewBox="0 0 200 80" fill="currentColor" aria-hidden="true"><path d="M8 58c0-6 3-9 9-10l22-5 26-20c3-2 6-3 10-3h50c6 0 10 2 14 6l16 15 28 5c7 2 10 5 10 11v4c0 2-1 3-3 3h-12a18 18 0 0 0-36 0H69a18 18 0 0 0-36 0H11c-2 0-3-1-3-3z"/><circle cx="51" cy="64" r="11" fill="#1A1A1A"/><circle cx="153" cy="64" r="11" fill="#1A1A1A"/><path d="M80 25h26v17H64zm34 0h18l14 17h-32z" fill="#1A1A1A" opacity=".55"/></svg>`;

const imgCache = new Map();
const imgStore = (() => { try { return JSON.parse(localStorage.getItem('sh-img') || '{}'); } catch { return {}; } })();

/** Builds a Wikipedia summary lookup for "Make Model" and resolves a thumbnail URL (or null). */
function wikiImage(make, model) {
  const key = `${make} ${model}`.toLowerCase();
  if (key in imgStore) return Promise.resolve(imgStore[key]);
  if (imgCache.has(key)) return imgCache.get(key);
  const title = encodeURIComponent(`${make} ${model}`.trim().replace(/\s+/g, '_'));
  const p = fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}?redirect=true`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && j.thumbnail && j.thumbnail.source) || null)
    .catch(() => null)
    .then((src) => {
      imgStore[key] = src;
      try { localStorage.setItem('sh-img', JSON.stringify(imgStore)); } catch { /* storage full */ }
      return src;
    });
  imgCache.set(key, p);
  return p;
}

function badge(text) { return el('span', 'badge', text); }

function buildCard(t, eng = {}, weight) {
  const make = (t.make_model && t.make_model.make && t.make_model.make.name) || t.make || '';
  const model = (t.make_model && t.make_model.name) || t.model || '';
  const trim = [t.name, t.description].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' ');

  const card = el('article', 'card');
  const thumb = el('div', 'thumb');
  thumb.innerHTML = SILHOUETTE;
  wikiImage(make, model).then((src) => {
    if (!src) return;
    const img = new Image();
    img.alt = `${make} ${model}`;
    img.loading = 'lazy';
    img.onload = () => thumb.replaceChildren(img);
    img.src = src;
  });

  const info = el('div', 'info');
  info.append(el('div', 'make', make), el('h3', 'model', model));
  const tl = el('p', 'trim');
  tl.append(el('b', null, String(t.year)), document.createTextNode(trim || 'Base'));
  info.append(tl);

  const badges = el('div', 'badges');
  if (eng.horsepower_hp) badges.append(badge(`${fmt(eng.horsepower_hp)} HP`));
  const d = driveLabel(eng.drive_type); if (d) badges.append(badge(d));
  if (weight) badges.append(badge(`${fmt(weight)} lbs`));
  if (eng.cylinders) badges.append(badge(/^\d+$/.test(eng.cylinders) ? `${eng.cylinders}-cyl` : eng.cylinders));
  info.append(badges);

  const share = el('button', 'share');
  share.type = 'button';
  share.setAttribute('aria-label', `Share ${t.year} ${make} ${model}`);
  share.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/></svg>';
  share.addEventListener('click', () => shareCar(t.year, make, model));

  card.append(thumb, info, share);
  return card;
}

/* ---------- Share ---------- */
async function shareCar(year, make, model) {
  const data = {
    title: 'SpecHunter',
    text: `I just found out the ${year} ${make} ${model} matches my exact track-car specs on SpecHunter!`,
    url: CONFIG.SITE_URL,
  };
  try {
    if (navigator.share) return await navigator.share(data);
    await navigator.clipboard.writeText(`${data.text} ${data.url}`);
    toast('Link copied to clipboard');
  } catch (e) {
    if (e && e.name !== 'AbortError') toast('Sharing is not available here');
  }
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2400);
}

/* ---------- Events ---------- */
$('#filter-form').addEventListener('submit', (e) => { e.preventDefault(); hunt(); });
ui.more.addEventListener('click', () => loadMore());
syncLabels();

/* ---------- PWA ---------- */
let deferredPrompt = null;
const installBtn = $('#installBtn'), installHint = $('#installHint');
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

if (standalone) {
  installBtn.hidden = true;
  installHint.textContent = 'SpecHunter is installed on this device.';
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
installBtn.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    return;
  }
  installHint.textContent = /iphone|ipad|ipod/i.test(navigator.userAgent)
    ? 'On iPhone or iPad: tap Share, then Add to Home Screen.'
    : 'Open your browser menu and choose Install app or Add to Home Screen.';
});
window.addEventListener('appinstalled', () => { installBtn.hidden = true; installHint.textContent = 'Installed. Find SpecHunter on your home screen.'; });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
