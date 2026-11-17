// Συνεδρίες: buffer δειγμάτων, εξαγωγή/εισαγωγή CSV.
import { PIDS } from './pids.js';

/** Νέα συνεδρία. rows: [{t: δευτερόλεπτα, v: {pid: τιμή, RV: τάση}}] */
export function newSession({ vin = null, source = 'live', pids = [] } = {}) {
  return {
    id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    startedAt: Date.now(), vin, source, pids, rows: [],
    dtcs: null, status: null, freeze: null, report: null, note: '',
  };
}

export const SERIES_META = (key) => (key === 'RV'
  ? { name: 'Τάση (ATRV)', unit: 'V', min: 10, max: 15.5, dec: 1 }
  : PIDS[key]);

export function toCsv(session) {
  const keys = [...session.pids, 'RV'].filter((k) => session.rows.some((r) => r.v[k] != null));
  const head = ['t', ...keys].join(',');
  const lines = session.rows.map((r) => [r.t.toFixed(2), ...keys.map((k) => (r.v[k] == null ? '' : +r.v[k].toFixed(4)))].join(','));
  return '﻿' + [head, ...lines].join('\r\n');
}

export function downloadCsv(session) {
  const blob = new Blob([toCsv(session)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const d = new Date(session.startedAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  a.href = URL.createObjectURL(blob);
  a.download = `obd-${stamp}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Αντιστοίχιση επικεφαλίδων του tools/obd_cli.py ("Στροφές [rpm]") σε PID.
const NAME_TO_PID = Object.fromEntries(Object.entries(PIDS).map(([pid, p]) => [p.name, pid]));
NAME_TO_PID['ATRV'] = 'RV';
NAME_TO_PID['O2 B1S1'] = '14'; // ονόματα του tools/obd_cli.py
NAME_TO_PID['O2 B1S2'] = '15';
NAME_TO_PID['Τάση (ATRV)'] = 'RV';

function headerKey(h) {
  const s = h.trim().replace(/^﻿/, '');
  if (/^(t|time)$/i.test(s)) return 't';
  if (/^RV$/i.test(s)) return 'RV';
  if (/^[0-9A-F]{2}$/i.test(s) && PIDS[s.toUpperCase()]) return s.toUpperCase();
  const name = s.replace(/\s*\[.*\]\s*$/, '');
  return NAME_TO_PID[name] || null;
}

/** Εισαγωγή CSV (μορφή της εφαρμογής ή του obd_cli.py). */
export function fromCsv(text, fileName = '') {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  // Το obd_cli.py μπορεί να γράψει γραμμές χωρίς επικεφαλίδα· απαιτούμε επικεφαλίδα.
  const headIdx = lines.findIndex((l) => /(^|,)\s*﻿?t\s*(,|$)/i.test(l));
  if (headIdx < 0) throw new Error('Το CSV δεν έχει επικεφαλίδα με στήλη "t".');
  const keys = lines[headIdx].split(',').map(headerKey);
  const s = newSession({ source: 'csv', pids: keys.filter((k) => k && k !== 't' && k !== 'RV') });
  s.note = fileName;
  for (const line of lines.slice(headIdx + 1)) {
    const cells = line.split(',');
    const r = { t: NaN, v: {} };
    keys.forEach((k, i) => {
      const x = parseFloat(cells[i]);
      if (!k || !Number.isFinite(x)) return;
      if (k === 't') r.t = x; else r.v[k] = x;
    });
    if (Number.isFinite(r.t)) s.rows.push(r);
  }
  if (!s.rows.length) throw new Error('Δεν βρέθηκαν δεδομένα στο CSV.');
  return s;
}
