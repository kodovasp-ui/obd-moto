// Βοηθός διάγνωσης μέσω Claude API (προαιρετικός).
// Το κλειδί API μένει μόνο σε αυτή τη συσκευή· τα δεδομένα στέλνονται μόνο στο api.anthropic.com
// όταν ο χρήστης πατήσει «Ανάλυση». Το SDK φορτώνεται από CDN μόνο τότε (χρειάζεται δίκτυο ούτως ή άλλως).
import { PIDS } from './pids.js';
import { margin } from './mode06.js';
import { lookup } from './dtc-kb.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.4.0/+esm';
export const MODEL = 'claude-opus-5-5';
const KEY_STORE = 'obd.anthropicKey';

const SYSTEM = `Είσαι έμπειρος μηχανικός μοτοσυκλετών και βοηθάς σε διάγνωση μέσω OBD-II.
Όχημα: CFMOTO 450MT (2025/2026), βενζίνη, ψεκασμός, narrowband αισθητήρες λάμδα, CAN 11bit/500k.
Σου δίνονται κωδικοί βλάβης, freeze frame, readiness, αυτόματη αναφορά υγείας και στατιστικά live τιμών.

Απάντησε στα ελληνικά, σύντομα και πρακτικά, με αυτή τη δομή:
1. Πιθανότερη αιτία (με αιτιολόγηση από τα δεδομένα)
2. Έλεγχοι με σειρά (από τον φθηνότερο/ευκολότερο)
3. Ποιες live τιμές να παρακολουθήσω και τι τιμές περιμένω
4. Πότε να πάει σε συνεργείο/αντιπρόσωπο

Κανόνες:
- Η εφαρμογή κάνει ΜΟΝΟ ανάγνωση. Μην προτείνεις προγραμματισμό, reflash, αλλαγές παραμέτρων ECU ή εντολές εγγραφής.
- Αν τα δεδομένα δεν αρκούν, πες ποια μέτρηση λείπει αντί να μαντεύεις.
- Οι τιμές αναφοράς (αντιστάσεις, πιέσεις, ρελαντί) είναι γενικές· πες να επιβεβαιωθούν με το εγχειρίδιο σέρβις του 450MT.
- Για θέματα ασφάλειας (φρένα, καύσιμο, υπερθέρμανση) πες καθαρά αν δεν πρέπει να οδηγηθεί η μοτοσυκλέτα.`;

const SYSTEM_LIVE_TEXT = `Είσαι έμπειρος μηχανικός μοτοσυκλετών σε ΖΩΝΤΑΝΗ συνεδρία διάγνωσης OBD-II.
Όχημα: CFMOTO 450MT (2025/2026), βενζίνη, ψεκασμός, narrowband αισθητήρες λάμδα, CAN 11bit/500k.
Λαμβάνεις περιοδικά στιγμιότυπα τρεχουσών τιμών (τρέχουσα τιμή + min/μέση/max των τελευταίων δευτερολέπτων) και ερωτήσεις από τον αναβάτη.
Στη βάση (system, πιο κάτω) έχεις — όταν υπάρχουν — κωδικούς βλάβης, readiness και αυτόματη αναφορά υγείας.

Απάντα στα ελληνικά, ΠΟΛΥ σύντομα (είναι ζωντανή συνομιλία, όχι έκθεση):
- Σε μήνυμα [auto]: 1-3 γραμμές. Αν όλα ομαλά, πες το σε μία γραμμή και ανέφερε την πιο κρίσιμη τιμή. Αν κάτι αποκλίνει, πες τι και πόσο σοβαρό.
- Σε ερώτηση του αναβάτη: στοχευμένη απάντηση — τι φταίει πιθανότερα, τι να κοιτάξει, ποιες live τιμές να προσέξει και τι να περιμένει.

Κανόνες:
- Η εφαρμογή κάνει ΜΟΝΟ ανάγνωση. Ποτέ μην προτείνεις προγραμματισμό, reflash, αλλαγές παραμέτρων ECU ή εντολές εγγραφής.
- Αν λείπει μια μέτρηση για ασφαλές συμπέρασμα, πες ποιο PID/κάρτα να ανοίξει αντί να μαντεύεις.
- Οι τιμές αναφοράς είναι γενικές — να επιβεβαιώνονται με το εγχειρίδιο σέρβις του 450MT.
- Για ασφάλεια (φρένα, καύσιμο, υπερθέρμανση) πες καθαρά αν δεν πρέπει να οδηγηθεί.`;

export const SYSTEM_LIVE = SYSTEM_LIVE_TEXT;

function mapErr(e, Anthropic) {
  if (e instanceof Anthropic.AuthenticationError) return new Error('Μη έγκυρο κλειδί API.');
  if (e instanceof Anthropic.PermissionDeniedError) return new Error('Το κλειδί δεν έχει πρόσβαση σε αυτό το μοντέλο.');
  if (e instanceof Anthropic.RateLimitError) return new Error('Όριο αιτημάτων — δοκίμασε σε λίγο.');
  if (e instanceof Anthropic.APIUserAbortError) return new Error('Ακυρώθηκε.');
  if (e instanceof Anthropic.APIConnectionError) return new Error('Δεν υπάρχει σύνδεση με το api.anthropic.com.');
  if (e instanceof Anthropic.APIError) return new Error(`Σφάλμα API ${e.status ?? ''}: ${e.message}`);
  return e;
}

export function getKey() {
  try { return localStorage.getItem(KEY_STORE) || sessionStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
}

export function setKey(key, remember) {
  try {
    localStorage.removeItem(KEY_STORE);
    sessionStorage.removeItem(KEY_STORE);
    if (key) (remember ? localStorage : sessionStorage).setItem(KEY_STORE, key);
  } catch { /* αποθήκευση μη διαθέσιμη */ }
}

const stat = (rows, k) => {
  const v = rows.map((r) => r.v[k]).filter((x) => x != null);
  if (!v.length) return null;
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return `min ${Math.min(...v).toFixed(2)}, μέση ${m.toFixed(2)}, max ${Math.max(...v).toFixed(2)} (n=${v.length})`;
};

/** Συγκεντρώνει τα διαθέσιμα δεδομένα σε κείμενο για το μοντέλο. */
/** Σύνοψη σάρωσης μονάδων: ποιες απάντησαν και τι κωδικούς έχει καθεμιά. */
function ecuSection(ecus) {
  if (!ecus?.length) return null;
  const lines = ecus.map((e) => {
    const who = e.name || e.hint || e.req;
    const codes = e.dtcs.length ? e.dtcs.map((d) => `${d.code}-${d.ftb}`).join(', ') : 'χωρίς κωδικούς';
    return `${who} (${e.req}): ${codes}`;
  });
  return `## Μονάδες οχήματος (σάρωση UDS 19 02)\n${lines.join('\n')}`;
}

/** On-board tests: δίνουμε στο μοντέλο τα απέτυχαν και τα οριακά, όχι όλα τα τεστ. */
function m06Section(groups) {
  if (!groups?.length) return null;
  const lines = [];
  for (const g of groups) {
    for (const t of g.tests) {
      if (!t.bounded) continue;
      const m = margin(t) ?? 0;
      if (t.pass && m <= 0.8) continue; // ομαλό, δεν το στέλνουμε
      lines.push(`${g.name} TID ${t.tid}: ${t.value}${t.unit ? ' ' + t.unit : ''} `
        + `(όρια ${t.min}–${t.max}) → ${t.pass ? `πέρασε οριακά, ${(m * 100).toFixed(0)}% προς το όριο` : 'ΑΠΕΤΥΧΕ'}`);
    }
  }
  if (!lines.length) return '## On-board tests (Mode 06)\nΌλα τα τεστ πέρασαν με άνεση.';
  return `## On-board tests (Mode 06) — απέτυχαν ή οριακά\n${lines.join('\n')}`;
}

export function buildContext({ info, vin, session, dtcs, status, freeze, report, symptoms, ecus, m06 }) {
  const out = [];
  out.push(`## Όχημα\nVIN: ${vin || '—'}\nΠρωτόκολλο: ${info?.protocol || '—'}\nAdapter: ${info?.elm || '—'}`);
  if (symptoms?.trim()) out.push(`## Συμπτώματα (από τον αναβάτη)\n${symptoms.trim()}`);
  if (status) {
    out.push(`## Κατάσταση\nMIL: ${status.mil ? 'αναμμένη' : 'σβηστή'}, αποθηκευμένοι: ${status.dtcCount}\nReadiness: ${status.monitors.map((m) => `${m.name}=${m.complete ? 'OK' : 'μη ολοκλ.'}`).join(', ')}`);
  }
  if (dtcs) {
    const fmt = (a) => (a?.length ? a.map((c) => `${c} (${lookup(c).t})`).join('; ') : 'κανένας');
    out.push(`## Κωδικοί\nΑποθηκευμένοι (03): ${fmt(dtcs.stored)}\nΕκκρεμείς (07): ${fmt(dtcs.pending)}\nΜόνιμοι (0A): ${fmt(dtcs.permanent)}`);
  }
  const ecuTxt = ecuSection(ecus);
  if (ecuTxt) out.push(ecuTxt);
  const m06Txt = m06Section(m06);
  if (m06Txt) out.push(m06Txt);
  if (freeze?.code) {
    out.push(`## Freeze frame (αιτία ${freeze.code})\n${freeze.values.map(([p, v]) => `${PIDS[p]?.name || p}: ${v == null ? '—' : v.toFixed(2)} ${PIDS[p]?.unit || ''}`).join('\n')}`);
  }
  if (report) {
    out.push(`## Αυτόματη αναφορά υγείας\n${report.items.map((i) => `[${i.status}] ${i.area}: ${i.title} — ${i.detail}`).join('\n')}`);
  }
  const rows = session?.rows || [];
  if (rows.length) {
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r.v)))];
    const dur = rows[rows.length - 1].t - rows[0].t;
    const lines = keys.map((k) => {
      const s = stat(rows, k);
      const name = k === 'RV' ? 'Τάση ATRV [V]' : `${PIDS[k]?.name || k} [${PIDS[k]?.unit || ''}]`;
      return s ? `${name}: ${s}` : null;
    }).filter(Boolean);
    out.push(`## Live καταγραφή (${dur.toFixed(0)} s, ${rows.length} δείγματα)\n${lines.join('\n')}`);
  }
  return out.join('\n\n');
}

/** Κλήση στο Claude με streaming. onText(δέλτα κειμένου). Επιστρέφει το τελικό μήνυμα. */
export async function diagnose({ apiKey, context, onText, signal }) {
  const { default: Anthropic } = await import(SDK_URL);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: SYSTEM,
      messages: [{ role: 'user', content: context }],
    }, { signal });
    stream.on('text', (t) => onText(t));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('Το μοντέλο αρνήθηκε να απαντήσει σε αυτό το αίτημα.');
    if (msg.stop_reason === 'max_tokens') onText('\n\n[Η απάντηση κόπηκε λόγω ορίου μήκους.]');
    return msg;
  } catch (e) {
    throw mapErr(e, Anthropic);
  }
}

/** Στατική «βάση» για live mode: όχημα, κωδικοί, freeze, αναφορά υγείας — χωρίς τα live stats. */
export function buildBaseline({ info, vin, dtcs, status, freeze, report, ecus, m06 }) {
  const out = [];
  out.push(`## Όχημα\nVIN: ${vin || '—'}\nΠρωτόκολλο: ${info?.protocol || '—'}\nAdapter: ${info?.elm || '—'}`);
  if (status) {
    out.push(`## Κατάσταση\nMIL: ${status.mil ? 'αναμμένη' : 'σβηστή'}, αποθηκευμένοι: ${status.dtcCount}\nReadiness: ${status.monitors.map((m) => `${m.name}=${m.complete ? 'OK' : 'μη ολοκλ.'}`).join(', ')}`);
  }
  if (dtcs) {
    const fmt = (a) => (a?.length ? a.map((c) => `${c} (${lookup(c).t})`).join('; ') : 'κανένας');
    out.push(`## Κωδικοί\nΑποθηκευμένοι (03): ${fmt(dtcs.stored)}\nΕκκρεμείς (07): ${fmt(dtcs.pending)}\nΜόνιμοι (0A): ${fmt(dtcs.permanent)}`);
  }
  if (freeze?.code) {
    out.push(`## Freeze frame (αιτία ${freeze.code})\n${freeze.values.map(([p, v]) => `${PIDS[p]?.name || p}: ${v == null ? '—' : v.toFixed(2)} ${PIDS[p]?.unit || ''}`).join('\n')}`);
  }
  const ecuTxt = ecuSection(ecus);
  if (ecuTxt) out.push(ecuTxt);
  const m06Txt = m06Section(m06);
  if (m06Txt) out.push(m06Txt);
  if (report) {
    out.push(`## Αυτόματη αναφορά υγείας\n${report.items.map((i) => `[${i.status}] ${i.area}: ${i.title} — ${i.detail}`).join('\n')}`);
  }
  return out.join('\n\n');
}

/** Συμπαγές στιγμιότυπο των τρεχουσών live τιμών + στατιστικά του τελευταίου παραθύρου. */
export function buildLiveSnapshot(rows, windowSec = 15) {
  if (!rows || !rows.length) return 'Καμία live τιμή ακόμα.';
  const last = rows[rows.length - 1];
  const tEnd = last.t;
  const win = rows.filter((r) => tEnd - r.t <= windowSec);
  const keys = [...new Set(win.flatMap((r) => Object.keys(r.v)))];
  const name = (k) => (k === 'RV' ? 'Τάση ATRV [V]' : `${PIDS[k]?.name || k} [${PIDS[k]?.unit || ''}]`);
  const lines = keys.map((k) => {
    const cur = last.v[k];
    const vs = win.map((r) => r.v[k]).filter((x) => x != null);
    if (!vs.length) return null;
    const mean = vs.reduce((s, x) => s + x, 0) / vs.length;
    return `${name(k)}: τώρα ${cur == null ? '—' : cur.toFixed(2)} (τελ. ${windowSec}s: min ${Math.min(...vs).toFixed(2)} / μ ${mean.toFixed(2)} / max ${Math.max(...vs).toFixed(2)})`;
  }).filter(Boolean);
  return `Χρόνος ${tEnd.toFixed(0)} s\n${lines.join('\n') || '—'}`;
}

/** Συνομιλία με streaming. Επιστρέφει { msg, text }. */
export async function chat({ apiKey, system, messages, onText, signal }) {
  const { default: Anthropic } = await import(SDK_URL);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system,
      messages,
    }, { signal });
    stream.on('text', (t) => onText(t));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('Το μοντέλο αρνήθηκε να απαντήσει.');
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { msg, text };
  } catch (e) {
    throw mapErr(e, Anthropic);
  }
}
