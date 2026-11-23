// Πρωτόκολλα OBD-II του ELM327.
//
// Το CAN (ISO 15765-4) είναι υποχρεωτικό μόνο από το 2008 στις ΗΠΑ και το
// 2008–2014 στην ΕΕ. Παλιότερα οχήματα μιλούν ISO 9141-2, KWP2000 ή J1850 —
// ο ELM327 τα υποστηρίζει όλα, αρκεί να επιλεγεί το σωστό.
//
// Το ATSP0 (αυτόματο) τα δοκιμάζει μόνο του, αλλά σε φτηνά κλώνα adapter
// αποτυγχάνει συχνά σε non-CAN. Γι' αυτό υπάρχει και χειροκίνητη επιλογή,
// και σάρωση ένα-ένα όταν το αυτόματο δεν βρει τίποτα.
//
// Όλες οι εντολές εδώ είναι ρυθμίσεις του adapter (ATSP), όχι της ECU.

export const PROTOCOLS = [
  { n: '0', name: 'Αυτόματη ανίχνευση', can: null, years: '—', note: 'Ο adapter δοκιμάζει μόνος του.' },
  { n: '1', name: 'SAE J1850 PWM (41.6 kbaud)', can: false, years: '1996–2007', note: 'Ford.' },
  { n: '2', name: 'SAE J1850 VPW (10.4 kbaud)', can: false, years: '1994–2007', note: 'GM, Chrysler.' },
  { n: '3', name: 'ISO 9141-2 (5 baud init)', can: false, years: '1996–2004', note: 'Ευρωπαϊκά και ασιατικά. Αργή εκκίνηση (~3 s).' },
  { n: '4', name: 'ISO 14230-4 KWP (5 baud init)', can: false, years: '2000–2006', note: 'KWP2000, αργή εκκίνηση.' },
  { n: '5', name: 'ISO 14230-4 KWP (fast init)', can: false, years: '2000–2006', note: 'KWP2000, γρήγορη εκκίνηση.' },
  { n: '6', name: 'ISO 15765-4 CAN 11-bit / 500k', can: true, years: '2003–σήμερα', note: 'Το πιο συνηθισμένο. Οι περισσότερες μοτοσυκλέτες.' },
  { n: '7', name: 'ISO 15765-4 CAN 29-bit / 500k', can: true, years: '2003–σήμερα', note: '' },
  { n: '8', name: 'ISO 15765-4 CAN 11-bit / 250k', can: true, years: '2003–σήμερα', note: '' },
  { n: '9', name: 'ISO 15765-4 CAN 29-bit / 250k', can: true, years: '2003–σήμερα', note: '' },
  { n: 'A', name: 'SAE J1939 CAN 29-bit / 250k', can: true, years: '—', note: 'Φορτηγά, λεωφορεία, αγροτικά, γεννήτριες.' },
  { n: 'B', name: 'USER1 CAN 11-bit / 125k', can: true, years: '—', note: 'Ρυθμιζόμενο.' },
  { n: 'C', name: 'USER2 CAN 11-bit / 50k', can: true, years: '—', note: 'Ρυθμιζόμενο.' },
];

const BY_N = Object.fromEntries(PROTOCOLS.map((p) => [p.n, p]));

/**
 * Το πρωτόκολλο από τον αριθμό του ATDPN. Το σκέτο «A» είναι το J1939· το «A»
 * ΜΠΡΟΣΤΑ από άλλο ψηφίο (π.χ. «A6») είναι το πρόθεμα της αυτόματης ανίχνευσης
 * και αφαιρείται.
 */
export function protocolInfo(num) {
  if (!num) return null;
  const s = String(num).toUpperCase();
  const key = s === 'A' ? 'A' : s.replace(/^A/, '').slice(-1);
  return BY_N[key] || null;
}

export function isCanNum(num) {
  return protocolInfo(num)?.can === true;
}

/** Σειρά δοκιμής όταν το αυτόματο αποτύχει: πρώτα τα πιθανότερα. */
export const SWEEP_ORDER = ['6', '8', '7', '9', '5', '4', '3', '2', '1', 'A'];

/**
 * Δοκιμάζει πρωτόκολλα ένα-ένα ώσπου να απαντήσει το 0100.
 * Επιστρέφει {num, info} ή null. Δεν αλλάζει τίποτα στην ECU — μόνο ATSP.
 */
export async function sweepProtocols(elm, { onProgress = () => {}, stop = () => false } = {}) {
  for (const n of SWEEP_ORDER) {
    if (stop()) break;
    const info = BY_N[n];
    onProgress({ n, name: info.name });
    try {
      await elm.cmd('ATSP' + n);
      // Τα non-CAN με slow init θέλουν χρόνο: 5 baud init είναι ~3 s.
      const lines = await elm.cmd('0100', { timeout: info.can ? 5000 : 12000 });
      const ok = lines.some((l) => /^41\s*00/i.test(l.replace(/\s/g, '').replace(/^(41)/, '41 ')) || /41\s*00/i.test(l));
      if (ok) return { num: n, info };
    } catch { /* δοκιμάζουμε το επόμενο */ }
  }
  return null;
}

/**
 * Τι ΔΕΝ δουλεύει εκτός CAN, ώστε το UI να το λέει αντί να αποτυγχάνει σιωπηλά.
 * Η σάρωση μονάδων και ο σαρωτής DID στηρίζονται σε UDS πάνω από ISO-TP (CAN).
 * Το mode 06 εκτός CAN έχει εντελώς άλλη μορφή απάντησης.
 */
export const CAN_ONLY = {
  scan: 'Η σάρωση μονάδων χρησιμοποιεί UDS πάνω από CAN.',
  did: 'Ο σαρωτής DID χρησιμοποιεί UDS πάνω από CAN.',
  m06: 'Τα on-board tests έχουν άλλη μορφή εκτός CAN και δεν αποκωδικοποιούνται σωστά εδώ.',
};
