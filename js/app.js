// UI: σύνδεση (BLE/demo), live + γραφήματα, καταγραφή/αναπαραγωγή, κωδικοί + βάση γνώσης,
// αναφορά υγείας, ιστορικό (IndexedDB), βοηθός Claude, στοιχεία οχήματος, κονσόλα.
import { Elm } from './elm.js';
import { BleTransport } from './transport-ble.js';
import { SimTransport } from './transport-sim.js';
import { PIDS, LIVE_DEFAULT, decodePid, decodeDtcs } from './pids.js';
import { UnsafeCommand } from './safety.js';
import { LineChart } from './chart.js';
import { newSession, downloadCsv, fromCsv, SERIES_META } from './session.js';
import { saveSession, getSession, listSessions, deleteSession } from './db.js';
import { buildReport, compareReports } from './health.js';
import { lookup, KB_CODES } from './dtc-kb.js';
import * as AI from './assistant.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* χωρίς αποθήκευση */ } },
};

const S = {
  elm: null, transport: null, supported: [], vin: null,
  live: false, cur: null, rec: null, t0: 0,
  replay: null, // {session, t, playing, speed}
  diag: null, // {dtcs, status, freeze}
  report: null, reportSession: null,
  charts: new Map(),
  chartKeys: store.get('obd.charts', ['0C', '05', '06', '07', '14', 'RV']),
  aiAbort: null,
};

// ------------------------------------------------------------------ log / banner / status
function log(dir, text) {
  const box = $('log');
  box.append(el('span', dir === '>' ? 'tx' : dir === '!' ? 'err' : '', `${dir} ${text}\n`));
  while (box.childNodes.length > 600) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}
function banner(text, isErr = false) {
  const b = $('banner');
  b.hidden = !text;
  b.textContent = text || '';
  b.classList.toggle('err', isErr);
}
function setStatus(text, on) {
  $('status').textContent = text;
  $('status').classList.toggle('on', !!on);
}
function setConnected(on) {
  for (const id of ['btn-live', 'btn-dtc', 'btn-clear', 'console-in', 'console-send', 'btn-rec']) $(id).disabled = !on;
  $('btn-connect').textContent = on ? 'Αποσύνδεση' : 'Σύνδεση BLE';
  $('btn-demo').disabled = on;
}

// ------------------------------------------------------------------ σύνδεση
async function connect(kind) {
  if (S.elm) return disconnect();
  banner('');
  const t = kind === 'sim' ? new SimTransport() : new BleTransport();
  try {
    setStatus('Σύνδεση…');
    await t.connect();
    t.onDisconnect = () => { if (S.transport === t) cleanup('Η σύνδεση χάθηκε.'); };
    S.transport = t;
    S.elm = new Elm(t, { log });
    setStatus(`Αρχικοποίηση ${t.name}…`);
    const info = await S.elm.init();
    if (!/ELM/i.test(info.elm)) throw new Error('Ο adapter δεν απάντησε στο ATZ.');
    S.supported = await S.elm.supportedPids();
    S.vin = await S.elm.readVin();
    exitReplay();
    S.cur = newSession({ vin: S.vin, source: kind === 'sim' ? 'demo' : 'ble', pids: livePids() });
    setConnected(true);
    setStatus(`${t.name} · ${info.protocol || 'χωρίς πρωτόκολλο'}`, true);
    if (!S.supported.length) banner('Ο adapter συνδέθηκε, αλλά η ECU δεν απαντά. Είναι το κλειδί στο ON;', true);
    renderInfo();
    buildDashboard(livePids());
  } catch (e) {
    log('!', e.message);
    await t.disconnect().catch(() => {});
    cleanup();
    if (e.name !== 'NotFoundError') banner('Αποτυχία σύνδεσης: ' + e.message, true);
  }
}

function cleanup(msg) {
  S.live = false;
  if (S.rec) stopRecording().catch((e) => log('!', e.message));
  S.elm = null;
  S.transport = null;
  setConnected(false);
  setStatus('Αποσυνδεδεμένο');
  $('btn-live').textContent = 'Έναρξη';
  if (msg) banner(msg, true);
}

async function disconnect() {
  const t = S.transport;
  S.live = false;
  if (S.rec) await stopRecording();
  S.transport = null;
  cleanup();
  await t?.disconnect();
}

function livePids() {
  return LIVE_DEFAULT.filter((p) => S.supported.includes(p));
}

// ------------------------------------------------------------------ dashboard: κάρτες + γραφήματα
function buildDashboard(pids) {
  const tiles = $('tiles');
  tiles.replaceChildren();
  for (const key of [...pids, 'RV']) {
    const meta = SERIES_META(key);
    const tile = el('button', 'tile');
    tile.type = 'button';
    tile.dataset.key = key;
    tile.setAttribute('aria-pressed', S.chartKeys.includes(key));
    const head = el('div');
    head.append(el('span', 'val', '—'), el('span', 'unit', meta.unit));
    const bar = el('div', 'bar');
    bar.append(el('i'));
    tile.append(el('div', 'name', `${meta.name}${key === 'RV' ? '' : ' · ' + key}`), head, bar);
    tile.onclick = () => toggleChart(key);
    tiles.append(tile);
  }
  rebuildCharts([...pids, 'RV']);
}

function rebuildCharts(available) {
  const box = $('charts');
  box.replaceChildren();
  S.charts.clear();
  for (const key of S.chartKeys) {
    if (!available.includes(key)) continue;
    const c = new LineChart(key);
    S.charts.set(key, c);
    box.append(c.el);
  }
  requestDraw();
}

function toggleChart(key) {
  S.chartKeys = S.chartKeys.includes(key) ? S.chartKeys.filter((k) => k !== key) : [...S.chartKeys, key];
  store.set('obd.charts', S.chartKeys);
  const available = [...$('tiles').querySelectorAll('.tile')].map((t) => t.dataset.key);
  $('tiles').querySelectorAll('.tile').forEach((t) => t.setAttribute('aria-pressed', S.chartKeys.includes(t.dataset.key)));
  rebuildCharts(available);
}

function setTile(key, v) {
  const tile = $('tiles').querySelector(`[data-key="${key}"]`);
  if (!tile) return;
  const meta = SERIES_META(key);
  tile.querySelector('.val').textContent = v == null ? '—' : v.toFixed(meta.dec ?? 1);
  if (v != null && meta.max != null) {
    const p = Math.max(0, Math.min(1, (v - (meta.min ?? 0)) / (meta.max - (meta.min ?? 0))));
    tile.querySelector('.bar i').style.width = (p * 100).toFixed(0) + '%';
  }
}

let drawPending = false;
function requestDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    if (S.replay) {
      const { session, t } = S.replay;
      const rows = session.rows;
      const end = rows.length ? rows[rows.length - 1].t : 0;
      const t0 = rows.length ? rows[0].t : 0;
      for (const c of S.charts.values()) c.draw(rows, { t0, t1: Math.max(end, t0 + 1), cursorT: t });
      const row = nearestRow(rows, t);
      if (row) for (const k of Object.keys(row.v)) setTile(k, row.v[k]);
      $('rp-time').textContent = `${(t - t0).toFixed(1)} / ${(end - t0).toFixed(0)} s`;
      $('rp-pos').value = end > t0 ? ((t - t0) / (end - t0)) * 100 : 0;
    } else if (S.cur) {
      for (const c of S.charts.values()) c.draw(S.cur.rows, {});
    }
  });
}
window.addEventListener('resize', requestDraw);

function nearestRow(rows, t) {
  let lo = 0; let hi = rows.length - 1;
  if (hi < 0) return null;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].t < t) lo = mid + 1; else hi = mid; }
  return rows[lo];
}

// ------------------------------------------------------------------ live polling + καταγραφή
async function toggleLive() {
  if (S.live) { S.live = false; return; }
  exitReplay();
  S.live = true;
  $('btn-live').textContent = 'Διακοπή';
  $('btn-export').disabled = false;
  const pids = livePids();
  if (!S.t0) S.t0 = performance.now();
  let n = 0;
  let tRate = performance.now();
  try {
    while (S.live && S.elm) {
      const row = { t: (performance.now() - S.t0) / 1000, v: {} };
      for (const pid of pids) {
        if (!S.live || !S.elm) break;
        const v = decodePid(pid, await S.elm.pidData(pid));
        if (v != null) row.v[pid] = v;
        setTile(pid, v);
      }
      if (!S.elm) break;
      const rv = await S.elm.voltage();
      if (rv != null) row.v.RV = rv;
      setTile('RV', rv);
      S.cur.rows.push(row);
      if (S.cur.rows.length > 20000) S.cur.rows.splice(0, 5000);
      if (S.rec) S.rec.rows.push({ t: row.t - S.rec.tStart, v: row.v });
      requestDraw();
      n++;
      const dt = (performance.now() - tRate) / 1000;
      if (dt > 2) {
        $('live-rate').textContent = `${(n / dt).toFixed(1)} δείγματα/s${S.rec ? ` · καταγραφή ${S.rec.rows.length}` : ''}`;
        n = 0; tRate = performance.now();
      }
    }
  } catch (e) {
    log('!', e.message);
  }
  S.live = false;
  $('btn-live').textContent = 'Έναρξη';
}

async function toggleRecording() {
  if (S.rec) return stopRecording();
  const s = newSession({ vin: S.vin, source: S.cur?.source || 'live', pids: livePids() });
  s.tStart = S.t0 ? (performance.now() - S.t0) / 1000 : 0;
  S.rec = s;
  $('btn-rec').setAttribute('aria-pressed', 'true');
  $('btn-rec').textContent = '■ Διακοπή καταγραφής';
  if (!S.live) toggleLive();
}

async function stopRecording() {
  const s = S.rec;
  S.rec = null;
  $('btn-rec').setAttribute('aria-pressed', 'false');
  $('btn-rec').textContent = '● Καταγραφή';
  if (!s || !s.rows.length) return;
  delete s.tStart;
  if (S.diag) Object.assign(s, { dtcs: S.diag.dtcs, status: S.diag.status, freeze: S.diag.freeze });
  s.report = buildReport(s);
  await saveSession(s);
  banner(`Η καταγραφή αποθηκεύτηκε (${s.rows.length} δείγματα). Δες Υγεία / Ιστορικό.`);
  showReport(s);
  renderHistory();
}

function exportCurrent() {
  const s = S.replay?.session || S.rec || S.cur;
  if (!s?.rows.length) return banner('Δεν υπάρχουν δεδομένα για εξαγωγή.', true);
  downloadCsv(s);
}

// ------------------------------------------------------------------ αναπαραγωγή
function startReplay(session) {
  if (S.live) S.live = false;
  const keys = [...new Set([...session.pids, ...session.rows.flatMap((r) => Object.keys(r.v))])]
    .filter((k) => k !== 'RV' && PIDS[k]);
  S.replay = { session, t: session.rows[0]?.t || 0, playing: false, speed: +$('rp-speed').value };
  $('replay-bar').hidden = false;
  $('rp-title').textContent = sessionLabel(session);
  $('rp-play').textContent = '▶';
  buildDashboard(keys);
  showTab('live');
  requestDraw();
}

function exitReplay() {
  if (!S.replay) return;
  S.replay = null;
  $('replay-bar').hidden = true;
  if (S.elm) buildDashboard(livePids());
  else { $('tiles').replaceChildren(el('p', 'empty', 'Σύνδεσου, πάτα Demo ή άνοιξε μια συνεδρία από το Ιστορικό.')); $('charts').replaceChildren(); S.charts.clear(); }
}

function playLoop(prev) {
  const r = S.replay;
  if (!r?.playing) return;
  const now = performance.now();
  const rows = r.session.rows;
  const end = rows[rows.length - 1]?.t ?? 0;
  r.t = Math.min(end, r.t + ((now - prev) / 1000) * r.speed);
  if (r.t >= end) { r.playing = false; $('rp-play').textContent = '▶'; }
  requestDraw();
  requestAnimationFrame(() => playLoop(now));
}

// ------------------------------------------------------------------ κωδικοί + βάση γνώσης
function kbCard(code, open = false) {
  const e = lookup(code);
  const d = el('details', 'kb card');
  d.open = open;
  const sum = el('summary');
  sum.append(el('span', 'code bad', e.code), el('span', '', e.t));
  d.append(sum);
  if (e.causes.length) {
    d.append(el('h3', '', 'Πιθανές αιτίες'));
    const ul = el('ul');
    e.causes.forEach((c) => ul.append(el('li', '', c)));
    d.append(ul);
  }
  d.append(el('h3', '', 'Βήματα ελέγχου (με σειρά)'));
  const ol = el('ol');
  e.steps.forEach((s) => ol.append(el('li', '', s)));
  d.append(ol);
  if (e.live.length) {
    d.append(el('h3', '', 'Live τιμές για παρακολούθηση'));
    d.append(el('p', '', e.live.map((p) => `${PIDS[p]?.name || p} (${p})`).join(' · ')));
  }
  const src = el('p', 'src');
  src.append('Πηγές: ');
  e.sources.forEach((s, i) => {
    const a = el('a', '', s.name);
    a.href = s.url; a.target = '_blank'; a.rel = 'noopener';
    src.append(i ? ' · ' : '', a);
  });
  src.append(' — Τα βήματα είναι γενική καθοδήγηση· επιβεβαίωσε τιμές με το εγχειρίδιο σέρβις.');
  d.append(src);
  return d;
}

async function readDtcs() {
  const out = $('dtc-out');
  out.replaceChildren(el('p', 'muted', 'Ανάγνωση…'));
  const status = await S.elm.readStatus();
  const dtcs = {
    stored: await S.elm.readDtcs('03'),
    pending: await S.elm.readDtcs('07'),
    permanent: await S.elm.readDtcs('0A'),
  };
  let freeze = null;
  const ffDtc = await S.elm.pidData('02', '02', '00');
  if (ffDtc && (ffDtc[0] || ffDtc[1])) {
    const sup = (await S.elm.supportedPids('02')).filter((p) => PIDS[p]);
    const values = [];
    for (const pid of sup) values.push([pid, await S.elm.readPid(pid, '02')]);
    freeze = { code: decodeDtcs(ffDtc.slice(0, 2))[0], values };
  }
  S.diag = { dtcs, status, freeze };
  renderDtcs();
}

function renderDtcs() {
  const out = $('dtc-out');
  out.replaceChildren();
  const { dtcs, status, freeze } = S.diag;
  if (status) {
    const c = el('div', 'card');
    const h = el('h2');
    h.append('Λυχνία MIL ', el('span', `pill ${status.mil ? 'bad' : 'ok'}`, status.mil ? '⚠ ΑΝΑΜΜΕΝΗ' : '✓ σβηστή'));
    c.append(h, el('div', 'muted', `Αποθηκευμένοι κωδικοί: ${status.dtcCount} · κινητήρας: ${status.ignition}`));
    const mons = el('div', 'mons');
    for (const m of status.monitors) {
      const row = el('div');
      row.append(el('span', `pill ${m.complete ? 'ok' : 'warn'}`, m.complete ? '✓ OK' : '… μη ολοκλ.'), ' ', m.name);
      mons.append(row);
    }
    c.append(el('h2', '', 'Readiness monitors'), mons);
    out.append(c);
  }
  for (const [key, label] of [['stored', 'Αποθηκευμένοι (03)'], ['pending', 'Εκκρεμείς (07)'], ['permanent', 'Μόνιμοι (0A)']]) {
    const c = el('div', 'card');
    c.append(el('h2', '', label));
    if (!dtcs[key].length) c.append(el('span', 'muted', 'κανένας'));
    dtcs[key].forEach((code) => c.append(kbCard(code)));
    out.append(c);
  }
  if (freeze) {
    const c = el('div', 'card');
    c.append(el('h2', '', `Freeze frame — αιτία ${freeze.code}`));
    const tbl = el('table');
    for (const [pid, v] of freeze.values) {
      const tr = el('tr');
      tr.append(el('td', '', PIDS[pid].name), el('td', '', `${v == null ? '—' : v.toFixed(PIDS[pid].dec ?? 1)} ${PIDS[pid].unit}`));
      tbl.append(tr);
    }
    c.append(tbl);
    out.append(c);
  }
}

function kbSearch(ev) {
  ev.preventDefault();
  const code = $('kb-in').value.trim().toUpperCase();
  if (!/^[PCBU][0-9A-F]{4}$/.test(code)) { $('kb-out').replaceChildren(el('p', 'muted', 'Γράψε κωδικό της μορφής P0123.')); return; }
  $('kb-out').replaceChildren(kbCard(code, true));
}

function askClear() {
  $('confirm-check').checked = false;
  $('confirm-ok').disabled = true;
  $('confirm-clear').showModal();
}

async function onClearClosed() {
  if ($('confirm-clear').returnValue !== 'ok' || !$('confirm-check').checked || !S.elm) return;
  const r = await S.elm.clearDtcsConfirmed();
  banner(r.some((l) => /^44/.test(l.replace(/\s/g, ''))) ? 'Οι κωδικοί σβήστηκαν.' : 'Η ECU δεν επιβεβαίωσε το σβήσιμο: ' + r.join(' '));
  await readDtcs();
}

// ------------------------------------------------------------------ υγεία
function sessionLabel(s) {
  const d = new Date(s.startedAt);
  const dur = s.rows?.length ? s.rows[s.rows.length - 1].t - s.rows[0].t : 0;
  const src = { ble: 'BLE', demo: 'Demo', csv: 'CSV', live: 'Live' }[s.source] || s.source;
  return `${d.toLocaleString('el-GR')} · ${src}${s.note ? ' · ' + s.note : ''} · ${dur.toFixed(0)} s`;
}

function reportFromCurrent() {
  const s = S.replay?.session || S.rec || (S.cur && { ...S.cur, rows: S.cur.rows });
  if (!s) return banner('Δεν υπάρχουν δεδομένα — ξεκίνα Live ή άνοιξε συνεδρία.', true);
  const copy = { ...s, ...(S.diag && !S.replay ? { dtcs: S.diag.dtcs, status: S.diag.status, freeze: S.diag.freeze } : {}) };
  copy.report = buildReport(copy);
  showReport(copy);
}

async function showReport(s) {
  S.report = s.report;
  S.reportSession = s;
  $('report-src').textContent = sessionLabel(s);
  const out = $('report-out');
  out.replaceChildren();
  const icon = { ok: '✓', warn: '!', bad: '✕', info: 'i', na: '–' };
  const label = { ok: 'OK', warn: 'Προσοχή', bad: 'Πρόβλημα', info: 'Πληροφορία', na: 'Χωρίς δεδομένα' };
  const head = el('div', 'card');
  head.append(el('h2', '', 'Σύνοψη '), el('span', `pill ${s.report.summary}`, `${icon[s.report.summary]} ${label[s.report.summary]} · ${s.report.counts.bad} προβλήματα, ${s.report.counts.warn} προειδοποιήσεις`));
  out.append(head);
  const ul = el('ul', 'rep');
  for (const it of s.report.items) {
    const li = el('li');
    const left = el('div');
    left.append(el('span', `pill ${it.status}`, `${icon[it.status]} ${label[it.status]}`), el('div', 'area', it.area));
    const right = el('div');
    right.append(el('div', 'title', it.title), el('div', 'detail', it.detail));
    li.append(left, right);
    ul.append(li);
  }
  out.append(ul);
  await renderCompare(s);
}

async function renderCompare(s) {
  const box = $('compare-out');
  box.replaceChildren();
  const all = await listSessions().catch(() => []);
  const prevMeta = all.find((m) => m.id !== s.id && m.startedAt < s.startedAt && m.report && (!s.vin || !m.vin || m.vin === s.vin));
  if (!prevMeta) return;
  const rows = compareReports(s.report, prevMeta.report);
  if (!rows.length) return;
  const c = el('div', 'card');
  c.append(el('h2', '', 'Σύγκριση με προηγούμενη συνεδρία'), el('p', 'muted small', sessionLabel(prevMeta)));
  const tbl = el('table');
  const th = el('tr');
  ['Μέγεθος', 'Τώρα', 'Πριν', 'Μεταβολή'].forEach((h) => th.append(el('th', '', h)));
  tbl.append(th);
  for (const r of rows) {
    const tr = el('tr');
    const d = el('td', r.notable ? 'delta up' : '', `${r.delta > 0 ? '+' : ''}${r.delta} ${r.unit}${r.notable ? '  ! αξιοσημείωτη' : ''}`);
    tr.append(el('td', '', r.label), el('td', '', `${r.now} ${r.unit}`), el('td', '', `${r.before} ${r.unit}`), d);
    tbl.append(tr);
  }
  c.append(tbl);
  box.append(c);
}

// ------------------------------------------------------------------ ιστορικό
async function renderHistory() {
  const out = $('hist-out');
  let list = [];
  try { list = await listSessions(); } catch (e) { out.replaceChildren(el('p', 'err', 'IndexedDB μη διαθέσιμο: ' + e.message)); return; }
  out.replaceChildren();
  if (!list.length) { out.append(el('p', 'empty', 'Καμία αποθηκευμένη συνεδρία.')); return; }
  const wrap = el('div', 'hist');
  for (const m of list) {
    const c = el('div', 'card');
    const meta = el('div', 'meta');
    meta.append(el('div', '', sessionLabel({ ...m, rows: [] }).replace(/ · 0 s$/, '')),
      el('div', 'muted small', `${m.samples} δείγματα · VIN ${m.vin || '—'}`));
    const pill = m.report ? el('span', `pill ${m.report.summary}`, { ok: '✓ OK', warn: '! Προσοχή', bad: '✕ Πρόβλημα' }[m.report.summary]) : el('span');
    const btns = el('div', 'btns');
    const mk = (label, fn, cls = '') => { const b = el('button', cls, label); b.onclick = fn; btns.append(b); };
    mk('Αναπαραγωγή', async () => startReplay(await getSession(m.id)));
    mk('Αναφορά', async () => { const s = await getSession(m.id); s.report = buildReport(s); await saveSession(s); showReport(s); showTab('health'); });
    mk('CSV', async () => downloadCsv(await getSession(m.id)), 'ghost');
    mk('Διαγραφή', async () => {
      if (!confirm('Διαγραφή αυτής της συνεδρίας από τη συσκευή; Δεν αναιρείται.')) return;
      await deleteSession(m.id);
      if (S.replay?.session.id === m.id) exitReplay();
      renderHistory();
    }, 'danger');
    c.append(meta, pill, btns);
    wrap.append(c);
  }
  out.append(wrap);
}

async function importCsv(ev) {
  const f = ev.target.files?.[0];
  ev.target.value = '';
  if (!f) return;
  try {
    const s = fromCsv(await f.text(), f.name);
    s.report = buildReport(s);
    await saveSession(s);
    banner(`Εισήχθη ${f.name} (${s.rows.length} δείγματα).`);
    renderHistory();
  } catch (e) {
    banner('Αποτυχία εισαγωγής: ' + e.message, true);
  }
}

// ------------------------------------------------------------------ βοηθός Claude
function aiContext() {
  const s = S.reportSession || S.replay?.session || S.cur;
  const diag = S.diag || (s && { dtcs: s.dtcs, status: s.status, freeze: s.freeze }) || {};
  return AI.buildContext({
    info: S.elm?.info, vin: S.vin || s?.vin, session: s, ...diag,
    report: S.report || (s?.rows?.length ? buildReport(s) : null), symptoms: $('ai-symptoms').value,
  });
}

async function runAi() {
  const key = $('ai-key').value.trim();
  if (!key) return banner('Βάλε κλειδί Anthropic API στον Βοηθό.', true);
  AI.setKey(key, $('ai-remember').checked);
  const out = $('ai-out');
  out.hidden = false;
  out.textContent = '';
  out.append(el('span', 'muted', `Ανάλυση με ${AI.MODEL}…\n\n`));
  S.aiAbort = new AbortController();
  $('ai-run').disabled = true; $('ai-stop').hidden = false;
  try {
    let first = true;
    await AI.diagnose({
      apiKey: key, context: aiContext(), signal: S.aiAbort.signal,
      onText: (t) => { if (first) { out.textContent = ''; first = false; } out.append(t); },
    });
  } catch (e) {
    out.append(el('p', 'err', '\n' + e.message));
  } finally {
    $('ai-run').disabled = false; $('ai-stop').hidden = true; S.aiAbort = null;
  }
}

// ------------------------------------------------------------------ όχημα / κονσόλα
function renderInfo() {
  const box = $('info-out');
  box.replaceChildren();
  const i = S.elm.info;
  const rows = [
    ['Adapter', i.elm], ['Σύνδεση', S.transport.name], ['Πρωτόκολλο', `${i.protocol} (${i.protocolNum})`],
    ['Τάση', i.voltage], ['VIN', S.vin || '—'], ['PID (01)', S.supported.join(' ') || '—'],
  ];
  for (const [k, v] of rows) box.append(el('dt', '', k), el('dd', '', v));
}

async function sendConsole(ev) {
  ev.preventDefault();
  const cmd = $('console-in').value.trim();
  if (!cmd || !S.elm) return;
  try {
    await S.elm.cmd(cmd, { timeout: 8000 });
    $('console-in').value = '';
  } catch (e) {
    log('!', e instanceof UnsafeCommand ? 'ΑΠΟΡΡΙΦΘΗΚΕ: ' + e.message : e.message);
  }
}

// ------------------------------------------------------------------ tabs, PWA, init
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.id !== 'tab-' + name; });
  store.set('obd.tab', name);
  if (name === 'live') requestDraw();
  if (name === 'history') renderHistory();
}

function setupPwa() {
  $('version').textContent = 'v' + self.APP_VERSION;
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('btn-install').hidden = false; });
  $('btn-install').onclick = async () => { deferred?.prompt(); deferred = null; $('btn-install').hidden = true; };
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    if (S.elm || S.rec) { banner('Νέα έκδοση διαθέσιμη — θα εφαρμοστεί στην επόμενη ανανέωση.'); return; }
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch((e) => log('!', 'Service worker: ' + e.message));
}

function init() {
  document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
  $('btn-connect').onclick = () => connect('ble');
  $('btn-demo').onclick = () => connect('sim');
  $('btn-live').onclick = toggleLive;
  $('btn-rec').onclick = () => toggleRecording().catch((e) => log('!', e.message));
  $('btn-export').onclick = exportCurrent;
  $('btn-dtc').onclick = () => readDtcs().catch((e) => log('!', e.message));
  $('btn-clear').onclick = askClear;
  $('confirm-check').onchange = (e) => { $('confirm-ok').disabled = !e.target.checked; };
  $('confirm-clear').addEventListener('close', () => onClearClosed().catch((e) => log('!', e.message)));
  $('console-form').onsubmit = sendConsole;
  $('kb-form').onsubmit = kbSearch;
  $('kb-list').append(...KB_CODES.map((c) => { const o = el('option'); o.value = c; return o; }));
  $('btn-report').onclick = reportFromCurrent;
  $('csv-in').onchange = importCsv;
  $('rp-play').onclick = () => {
    const r = S.replay; if (!r) return;
    const rows = r.session.rows;
    if (r.t >= (rows[rows.length - 1]?.t ?? 0)) r.t = rows[0]?.t ?? 0;
    r.playing = !r.playing;
    $('rp-play').textContent = r.playing ? '❚❚' : '▶';
    if (r.playing) requestAnimationFrame(() => playLoop(performance.now()));
  };
  $('rp-pos').oninput = (e) => {
    const r = S.replay; if (!r) return;
    const rows = r.session.rows; const t0 = rows[0]?.t ?? 0; const end = rows[rows.length - 1]?.t ?? 0;
    r.t = t0 + (e.target.value / 100) * (end - t0);
    requestDraw();
  };
  $('rp-speed').onchange = (e) => { if (S.replay) S.replay.speed = +e.target.value; };
  $('rp-exit').onclick = exitReplay;
  $('ai-key').value = AI.getKey();
  $('ai-remember').checked = (() => { try { return !!localStorage.getItem('obd.anthropicKey'); } catch { return false; } })();
  $('ai-forget').onclick = () => { AI.setKey('', false); $('ai-key').value = ''; banner('Το κλειδί διαγράφηκε από τη συσκευή.'); };
  $('ai-run').onclick = runAi;
  $('ai-stop').onclick = () => S.aiAbort?.abort();
  $('ai-preview').onclick = () => { const p = $('ai-context'); p.hidden = !p.hidden; p.textContent = aiContext(); };
  if (!BleTransport.isSupported()) {
    banner(window.isSecureContext
      ? 'Αυτός ο browser δεν υποστηρίζει Web Bluetooth. Χρησιμοποίησε Chrome ή Edge. Το Demo λειτουργεί.'
      : 'Web Bluetooth θέλει https ή localhost. Δες docs/README.md για Android. Το Demo λειτουργεί.');
  }
  showTab(store.get('obd.tab', 'live'));
  setupPwa();
}

init();
