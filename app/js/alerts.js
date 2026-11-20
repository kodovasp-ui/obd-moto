// Ειδοποιήσεις σε live τιμές: υπερθέρμανση, τάση φόρτισης, λάδι, καυσαέρια, στροφές.
// Η ειδοποίηση είναι ΜΟΝΟ ενημερωτική — καμία ενέργεια στην ECU.
//
// Τα όρια είναι γενικά. Το 450MT και κάθε όχημα έχει τα δικά του: επιβεβαίωσε με
// το εγχειρίδιο σέρβις και προσάρμοσέ τα από την καρτέλα.

const KEY = 'obd.alerts';

// key = PID ή 'RV'. op: 'gt' πάνω από, 'lt' κάτω από.
export const DEFAULT_RULES = [
  { key: '05', op: 'gt', value: 110, label: 'Υπερθέρμανση ψυκτικού', level: 'bad' },
  { key: '05', op: 'gt', value: 102, label: 'Ψυκτικό ψηλά', level: 'warn' },
  { key: '5C', op: 'gt', value: 130, label: 'Θερμοκρασία λαδιού ψηλά', level: 'warn' },
  { key: 'RV', op: 'lt', value: 12.2, label: 'Χαμηλή τάση — δεν φορτίζει', level: 'bad' },
  { key: 'RV', op: 'gt', value: 15.0, label: 'Υπερφόρτιση — ρυθμιστής', level: 'bad' },
  { key: '78', op: 'gt', value: 900, label: 'Θερμοκρασία καυσαερίων πολύ ψηλά', level: 'bad' },
  { key: '3C', op: 'gt', value: 850, label: 'Θερμοκρασία καταλύτη πολύ ψηλά', level: 'warn' },
  { key: '0C', op: 'gt', value: 9500, label: 'Στροφές στο κόκκινο', level: 'warn' },
  { key: '06', op: 'gt', value: 20, label: 'STFT πολύ θετικό (φτωχό μείγμα)', level: 'warn' },
  { key: '06', op: 'lt', value: -20, label: 'STFT πολύ αρνητικό (πλούσιο μείγμα)', level: 'warn' },
];

const load = () => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!s) return null;
    return { enabled: !!s.enabled, sound: !!s.sound, rules: Array.isArray(s.rules) ? s.rules : DEFAULT_RULES };
  } catch { return null; }
};

export const config = load() || { enabled: true, sound: true, rules: DEFAULT_RULES };

export function saveConfig(c) {
  Object.assign(config, c);
  try { localStorage.setItem(KEY, JSON.stringify(config)); } catch { /* χωρίς αποθήκευση */ }
}

export function resetRules() {
  saveConfig({ rules: DEFAULT_RULES.map((r) => ({ ...r })) });
}

const fired = new Map(); // key+op+value → πότε ειδοποιήσαμε τελευταία
const REARM_MS = 60000;  // μη ξανακτυπάς για το ίδιο πριν περάσει ένα λεπτό

/** Ελέγχει μια γραμμή live τιμών. Επιστρέφει τις νέες ειδοποιήσεις. */
export function check(row) {
  if (!config.enabled || !row?.v) return [];
  const out = [];
  const now = Date.now();
  for (const r of config.rules) {
    const v = row.v[r.key];
    if (v == null) continue;
    const hit = r.op === 'gt' ? v > r.value : v < r.value;
    const id = `${r.key}|${r.op}|${r.value}`;
    if (!hit) { fired.delete(id); continue; }
    if (now - (fired.get(id) || 0) < REARM_MS) continue;
    fired.set(id, now);
    out.push({ ...r, actual: v });
  }
  return out;
}

export function resetFired() {
  fired.clear();
}

// --- ήχος: μικρό μπιπ με WebAudio, χωρίς αρχείο
let ctx = null;
export function beep(level = 'warn') {
  if (!config.sound) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const n = level === 'bad' ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const t0 = ctx.currentTime + i * 0.22;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = level === 'bad' ? 880 : 620;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.18);
    }
  } catch { /* χωρίς ήχο */ }
}
