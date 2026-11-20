// Mode 06 — αποτελέσματα on-board tests (SAE J1979). ΜΟΝΟ ανάγνωση.
//
// Η ECU τρέχει μόνη της τεστ σε καταλύτη, λάμδα, EVAP, misfire κ.λπ. και κρατά
// για κάθε τεστ: τιμή, κατώτατο και ανώτατο όριο. Αν η τιμή είναι εντός ορίων
// το τεστ πέρασε. Έτσι βλέπεις εξάρτημα που «γερνάει» ΠΡΙΝ ανάψει η λυχνία.
//
// Μορφή απάντησης (ISO 15765-4): 46 και μετά διαδοχικές εγγραφές 9 bytes,
// όπου κάθε εγγραφή επαναλαμβάνει το MID της:
//   <MID> <TID> <UASID> <τιμή hi lo> <min hi lo> <max hi lo>
// Έτσι μία απάντηση μπορεί να περιέχει τεστ από πολλά MID.
//
// ΣΗΜΑΝΤΙΚΟ για την ακρίβεια: το πέρασε/απέτυχε βγαίνει από τη σύγκριση
// min ≤ τιμή ≤ max και ΔΕΝ εξαρτάται από την κλίμακα (UASID) — είναι πάντα σωστό.
// Τη μονάδα και τον πολλαπλασιαστή τα δείχνουμε μόνο για τα UASID που γνωρίζουμε
// σίγουρα· αλλιώς δείχνουμε την ωμή τιμή, χωρίς να μαντεύουμε.

// Μονάδα και πολλαπλασιαστής ανά UASID. [πολλαπλασιαστής, μονάδα, προσημασμένο]
const UAS = {
  0x01: [1, ''],
  0x02: [0.1, ''],
  0x03: [0.01, ''],
  0x04: [0.001, ''],
  0x05: [0.0000305, ''],
  0x06: [0.000305, ''],
  0x07: [0.25, 'rpm'],
  0x08: [0.01, 'km/h'],
  0x09: [1, 'km/h'],
  0x0a: [0.122, 'mV'],
  0x0b: [0.001, 'V'],
  0x0c: [0.01, 'V'],
  0x0d: [0.00390625, 'mA'],
  0x0e: [0.001, 'A'],
  0x0f: [0.01, 'A'],
  0x10: [1, 'ms'],
  0x11: [100, 'ms'],
  0x12: [1, 's'],
  0x24: [1, ''],
  0x25: [1, 'km'],
  0x2f: [0.01, '%'],
  0x81: [1, '', true],
  0x82: [0.1, '', true],
  0x83: [0.01, '', true],
  0x84: [0.001, '', true],
};

// Ονόματα monitor (MID). Ό,τι δεν ξέρουμε μένει «Monitor 0xNN».
const MID_NAMES = (() => {
  const m = {};
  for (let b = 1; b <= 4; b++) {
    for (let s = 1; s <= 4; s++) {
      m[0x01 + (b - 1) * 4 + (s - 1)] = `Αισθητήρας λάμδα B${b}S${s}`;
      m[0x21 + (b - 1) * 4 + (s - 1)] = `Θέρμανση λάμδα B${b}S${s}`;
    }
    m[0x31 + (b - 1)] = `Καταλύτης Bank ${b}`;
  }
  m[0xa1] = 'Αφλογιστία (misfire) — γενικά';
  for (let c = 1; c <= 12; c++) m[0xa1 + c] = `Αφλογιστία κυλίνδρου ${c}`;
  return m;
})();

const h2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');

export function midName(mid) {
  const n = parseInt(mid, 16);
  if (MID_NAMES[n]) return MID_NAMES[n];
  if (n >= 0xf1) return `Ειδικό τεστ κατασκευαστή (0x${h2(n)})`;
  return `Monitor 0x${h2(n)}`;
}

/** Εγγραφή 9 bytes → ένα τεστ. b = [MID, TID, UASID, v, v, min, min, max, max] */
function decodeTest(b) {
  const [mid, tid, uasId] = [h2(b[0]), b[1], b[2]];
  const raw = (hi, lo) => hi * 256 + lo;
  const sign = (v) => (v > 32767 ? v - 65536 : v);
  const u = UAS[uasId];
  const conv = u ? (v) => (u[2] ? sign(v) : v) * u[0] : null;

  const rv = raw(b[3], b[4]);
  const rmin = raw(b[5], b[6]);
  const rmax = raw(b[7], b[8]);
  // Το πέρασε/απέτυχε είναι ανεξάρτητο της κλίμακας.
  const cmp = u?.[2] ? [sign(rv), sign(rmin), sign(rmax)] : [rv, rmin, rmax];
  return {
    mid, tid: h2(tid), uasId: h2(uasId), known: !!u, unit: u ? u[1] : '',
    value: conv ? conv(rv) : rv,
    min: conv ? conv(rmin) : rmin,
    max: conv ? conv(rmax) : rmax,
    raw: { value: rv, min: rmin, max: rmax },
    pass: cmp[0] >= cmp[1] && cmp[0] <= cmp[2],
    // Όριο χωρίς νόημα (0..65535) σημαίνει ότι η ECU δεν δίνει πραγματικό όριο.
    bounded: !(cmp[1] === 0 && cmp[2] === 65535),
  };
}

/** Από τις απαντήσεις «46 …» βγάζει όλες τις εγγραφές τεστ, ομαδοποιημένες ανά MID. */
export function parseMode06(resp) {
  const byMid = new Map();
  for (const r of resp) {
    const start = r.indexOf(0x46);
    if (start < 0) continue;
    for (let p = start + 1; p + 8 < r.length; p += 9) {
      const rec = Array.from(r.slice(p, p + 9));
      if (!rec[0]) break; // padding
      const t = decodeTest(rec);
      if (!byMid.has(t.mid)) byMid.set(t.mid, []);
      byMid.get(t.mid).push(t);
    }
  }
  return byMid;
}

/**
 * Διαβάζει όλα τα διαθέσιμα on-board tests.
 * onProgress({done, total, mid}) για το UI, stop() για διακοπή.
 */
export async function readMode06(elm, { onProgress = () => {}, stop = () => false } = {}) {
  const BITMAPS = ['00', '20', '40', '60', '80', 'A0', 'C0'];
  const mids = (await elm.supportedPids('06')).filter((m) => !BITMAPS.includes(m));
  const all = new Map();
  for (let i = 0; i < mids.length; i++) {
    if (stop()) break;
    const mid = mids[i];
    onProgress({ done: i, total: mids.length, mid });
    if (all.has(mid)) continue; // ήρθε μαζί με προηγούμενη απάντηση
    for (const [k, v] of parseMode06(await elm.obd('06' + mid, { timeout: 4000 }))) {
      if (!all.has(k)) all.set(k, v);
    }
  }
  const groups = [...all.entries()]
    .sort((a, b) => parseInt(a[0], 16) - parseInt(b[0], 16))
    .map(([mid, tests]) => ({ mid, name: midName(mid), tests }));
  onProgress({ done: mids.length, total: mids.length, mid: null, phase: 'done' });
  return { groups, mids };
}

/** Σύνοψη: πόσα πέρασαν, πόσα απέτυχαν, πόσα χωρίς όρια. */
export function summarize(groups) {
  let pass = 0; let fail = 0; let unbounded = 0;
  for (const g of groups) {
    for (const t of g.tests) {
      if (!t.bounded) unbounded++;
      else if (t.pass) pass++;
      else fail++;
    }
  }
  return { pass, fail, unbounded, total: pass + fail + unbounded };
}

/**
 * Πόσο «κοντά στο όριο» είναι ένα τεστ: 0 = άνετα μέσα, 1 = πάνω στο όριο.
 * Χρήσιμο για να δεις εξάρτημα που γερνάει πριν αποτύχει.
 *
 * Προσοχή στα μονόπλευρα όρια: σε μετρητή με κάτω όριο 0 (π.χ. πλήθος misfire)
 * το 0 είναι το ΚΑΛΟ άκρο, όχι όριο — μετράμε μόνο προς το πάνω όριο.
 */
export function margin(t) {
  if (!t.bounded) return null;
  const span = t.max - t.min;
  if (!(span > 0)) return null;
  // Μόνο πάνω όριο έχει νόημα.
  if (t.min === 0) return Math.min(1, Math.max(0, t.value) / t.max);
  // Μόνο κάτω όριο έχει νόημα (το πάνω είναι η μέγιστη τιμή του πεδίου).
  if (t.raw.max === 65535) return Math.min(1, t.min / Math.max(t.value, 1e-9));
  // Δίπλευρο όριο: απόσταση από το μέσο.
  const mid = (t.max + t.min) / 2;
  return Math.min(1, Math.abs(t.value - mid) / (span / 2));
}
