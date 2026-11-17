// UI της εφαρμογής: σύνδεση (BLE ή demo), live τιμές, κωδικοί, στοιχεία οχήματος, κονσόλα.
import { Elm } from './elm.js';
import { BleTransport } from './transport-ble.js';
import { SimTransport } from './transport-sim.js';
import { PIDS, LIVE_DEFAULT, decodePid, formatValue } from './pids.js';
import { UnsafeCommand } from './safety.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const S = { elm: null, transport: null, supported: [], live: false, vin: null };

// ------------------------------------------------------------------ log / banner
function log(dir, text) {
  const line = el('span', dir === '>' ? 'tx' : dir === '!' ? 'err' : '', `${dir} ${text}\n`);
  const box = $('log');
  box.append(line);
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
  for (const id of ['btn-live', 'btn-dtc', 'btn-clear', 'console-in', 'console-send']) $(id).disabled = !on;
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
    setConnected(true);
    setStatus(`${t.name} · ${info.protocol || 'χωρίς πρωτόκολλο'}`, true);
    if (!S.supported.length) banner('Ο adapter συνδέθηκε, αλλά η ECU δεν απαντά. Είναι το κλειδί στο ON;', true);
    renderInfo();
    buildTiles();
  } catch (e) {
    log('!', e.message);
    await t.disconnect().catch(() => {});
    cleanup();
    if (e.name !== 'NotFoundError') banner('Αποτυχία σύνδεσης: ' + e.message, true);
  }
}

function cleanup(msg) {
  S.live = false;
  S.elm = null;
  S.transport = null;
  setConnected(false);
  setStatus('Αποσυνδεδεμένο');
  $('btn-live').textContent = 'Έναρξη';
  if (msg) banner(msg, true);
}

async function disconnect() {
  const t = S.transport;
  S.transport = null;
  cleanup();
  await t?.disconnect();
}

// ------------------------------------------------------------------ live
function livePids() {
  return LIVE_DEFAULT.filter((p) => S.supported.includes(p));
}

function buildTiles() {
  const box = $('tiles');
  box.replaceChildren();
  for (const pid of [...livePids(), 'RV']) {
    const meta = pid === 'RV' ? { name: 'Τάση (ATRV)', unit: 'V', min: 10, max: 15.5 } : PIDS[pid];
    const tile = el('div', 'tile');
    tile.dataset.pid = pid;
    const val = el('span', 'val', '—');
    const head = el('div');
    head.append(val, el('span', 'unit', meta.unit));
    const bar = el('div', 'bar');
    bar.append(el('i'));
    tile.append(el('div', 'name', `${meta.name}${pid === 'RV' ? '' : ' · ' + pid}`), head, bar);
    box.append(tile);
  }
}

function setTile(pid, v) {
  const tile = $('tiles').querySelector(`[data-pid="${pid}"]`);
  if (!tile) return;
  const meta = pid === 'RV' ? { min: 10, max: 15.5, dec: 1 } : PIDS[pid];
  tile.querySelector('.val').textContent = pid === 'RV' ? (v == null ? '—' : v.toFixed(1)) : formatValue(pid, v);
  if (v != null && meta.max != null) {
    const p = Math.max(0, Math.min(1, (v - (meta.min ?? 0)) / (meta.max - (meta.min ?? 0))));
    tile.querySelector('.bar i').style.width = (p * 100).toFixed(0) + '%';
  }
}

async function toggleLive() {
  if (S.live) { S.live = false; return; }
  S.live = true;
  $('btn-live').textContent = 'Διακοπή';
  const pids = livePids();
  let n = 0;
  let t0 = performance.now();
  try {
    while (S.live && S.elm) {
      for (const pid of pids) {
        if (!S.live || !S.elm) break;
        setTile(pid, decodePid(pid, await S.elm.pidData(pid)));
      }
      if (S.elm) setTile('RV', await S.elm.voltage());
      n++;
      const dt = (performance.now() - t0) / 1000;
      if (dt > 2) { $('live-rate').textContent = `${(n / dt).toFixed(1)} κύκλοι/s`; n = 0; t0 = performance.now(); }
    }
  } catch (e) {
    log('!', e.message);
  }
  S.live = false;
  $('btn-live').textContent = 'Έναρξη';
}

// ------------------------------------------------------------------ κωδικοί
async function readDtcs() {
  const out = $('dtc-out');
  out.replaceChildren(el('p', 'muted', 'Ανάγνωση…'));
  const st = await S.elm.readStatus();
  const lists = [];
  for (const [mode, label] of [['03', 'Αποθηκευμένοι (03)'], ['07', 'Εκκρεμείς (07)'], ['0A', 'Μόνιμοι (0A)']]) {
    lists.push([label, await S.elm.readDtcs(mode)]);
  }
  out.replaceChildren();

  if (st) {
    const c = el('div', 'card');
    const h = el('h2');
    h.append('Λυχνία MIL ', el('span', `pill ${st.mil ? 'bad' : 'ok'}`, st.mil ? 'ΑΝΑΜΜΕΝΗ' : 'σβηστή'));
    c.append(h, el('div', 'muted', `Αποθηκευμένοι κωδικοί: ${st.dtcCount} · κινητήρας: ${st.ignition}`));
    const mons = el('div', 'mons');
    for (const m of st.monitors) {
      const row = el('div');
      row.append(el('span', `pill ${m.complete ? 'ok' : 'warn'}`, m.complete ? 'OK' : 'μη ολοκλ.'), ' ', m.name);
      mons.append(row);
    }
    c.append(el('h2', '', 'Readiness monitors'), mons);
    out.append(c);
  }

  for (const [label, codes] of lists) {
    const c = el('div', 'card');
    c.append(el('h2', '', label));
    const box = el('div', 'codes');
    if (!codes.length) box.append(el('span', 'muted', 'κανένας'));
    codes.forEach((code) => box.append(el('span', 'code bad', code)));
    c.append(box);
    out.append(c);
  }

  // Freeze frame (mode 02, frame 0)
  const ffDtc = await S.elm.pidData('02', '02', '00');
  if (ffDtc && (ffDtc[0] || ffDtc[1])) {
    const sup = (await S.elm.supportedPids('02')).filter((p) => PIDS[p]);
    const c = el('div', 'card');
    const code = 'PCBU'[ffDtc[0] >> 6] + ((ffDtc[0] >> 4) & 3) + (ffDtc[0] & 15).toString(16).toUpperCase()
      + ffDtc[1].toString(16).toUpperCase().padStart(2, '0');
    c.append(el('h2', '', `Freeze frame — αιτία ${code}`));
    const tbl = el('table');
    for (const pid of sup) {
      const v = await S.elm.readPid(pid, '02');
      const tr = el('tr');
      tr.append(el('td', '', PIDS[pid].name), el('td', '', `${formatValue(pid, v)} ${PIDS[pid].unit}`));
      tbl.append(tr);
    }
    c.append(tbl);
    out.append(c);
  }
}

function askClear() {
  const dlg = $('confirm-clear');
  $('confirm-check').checked = false;
  $('confirm-ok').disabled = true;
  dlg.showModal();
}

async function onClearClosed() {
  if ($('confirm-clear').returnValue !== 'ok' || !$('confirm-check').checked || !S.elm) return;
  const r = await S.elm.clearDtcsConfirmed();
  banner(r.some((l) => /^44/.test(l.replace(/\s/g, ''))) ? 'Οι κωδικοί σβήστηκαν.' : 'Η ECU δεν επιβεβαίωσε το σβήσιμο: ' + r.join(' '));
  await readDtcs();
}

// ------------------------------------------------------------------ στοιχεία οχήματος
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

// ------------------------------------------------------------------ κονσόλα
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

// ------------------------------------------------------------------ tabs, PWA
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.id !== 'tab-' + name; });
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
    // Νέα έκδοση ενεργοποιήθηκε. Ανανέωση μόνο αν δεν υπάρχει ενεργή σύνδεση.
    if (!hadController || reloading) return;
    if (S.elm) { banner('Νέα έκδοση διαθέσιμη — θα εφαρμοστεί στην επόμενη ανανέωση.'); return; }
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
  $('btn-dtc').onclick = () => readDtcs().catch((e) => log('!', e.message));
  $('btn-clear').onclick = askClear;
  $('confirm-check').onchange = (e) => { $('confirm-ok').disabled = !e.target.checked; };
  $('confirm-clear').addEventListener('close', () => onClearClosed().catch((e) => log('!', e.message)));
  $('console-form').onsubmit = sendConsole;
  if (!BleTransport.isSupported()) {
    banner(window.isSecureContext
      ? 'Αυτός ο browser δεν υποστηρίζει Web Bluetooth. Χρησιμοποίησε Chrome ή Edge. Το Demo λειτουργεί.'
      : 'Web Bluetooth θέλει https ή localhost. Δες docs/README.md για Android. Το Demo λειτουργεί.');
  }
  setupPwa();
}

init();
