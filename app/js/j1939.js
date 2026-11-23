// J1939 — φορτηγά, λεωφορεία, αγροτικά, γεννήτριες (29-bit CAN, 250k).
//
// Το J1939 δεν χρησιμοποιεί OBD modes ούτε UDS. Οι ενεργοί κωδικοί βλάβης
// μεταδίδονται στο PGN 65226 (DM1) που ο ELM327 παρακολουθεί με `AT DM1`.
//
// ΜΟΝΟ ανάγνωση: παρακολουθούμε τον δίαυλο, δεν στέλνουμε τίποτα σε αυτόν.

// --------------------------------------------------- λυχνίες (DM1 byte 0-1)
// Κάθε λυχνία: 2 bits, 00/11 = σβηστή/μη διαθέσιμη, 01 = αναμμένη.
const LAMPS = [
  ['mil', 'Λυχνία βλάβης (MIL)', 6],
  ['rsl', 'Κόκκινη — σταμάτα (Red Stop)', 4],
  ['awl', 'Κίτρινη προειδοποίηση (Amber)', 2],
  ['pl', 'Προστασία κινητήρα (Protect)', 0],
];

function lamps(b) {
  const out = [];
  for (const [key, name, shift] of LAMPS) {
    if (((b >> shift) & 0x03) === 0x01) out.push({ key, name });
  }
  return out;
}

// --------------------------------------------------- FMI (είδος βλάβης)
// SAE J1939-73 Failure Mode Identifier — τι είδους είναι το σφάλμα.
export const FMI = {
  0: 'Τιμή πολύ ψηλά (πάνω από το κανονικό)',
  1: 'Τιμή πολύ χαμηλά (κάτω από το κανονικό)',
  2: 'Διακοπτόμενο ή λανθασμένο σήμα',
  3: 'Τάση πολύ ψηλά ή βραχυκύκλωμα στο +',
  4: 'Τάση πολύ χαμηλά ή βραχυκύκλωμα στη γείωση',
  5: 'Ρεύμα πολύ χαμηλά ή ανοιχτό κύκλωμα',
  6: 'Ρεύμα πολύ ψηλά ή βραχυκύκλωμα στη γείωση',
  7: 'Ο μηχανισμός δεν αποκρίνεται σωστά',
  8: 'Μη φυσιολογική συχνότητα / εύρος παλμού',
  9: 'Μη φυσιολογικός ρυθμός ενημέρωσης',
  10: 'Μη φυσιολογικός ρυθμός μεταβολής',
  11: 'Άγνωστη αιτία',
  12: 'Βλάβη εξαρτήματος / μονάδας',
  13: 'Εκτός βαθμονόμησης',
  14: 'Ειδική οδηγία — δες εγχειρίδιο',
  15: 'Υψηλά (ήπιο — ελάχιστη σοβαρότητα)',
  16: 'Υψηλά (μέτριο)',
  17: 'Χαμηλά (ήπιο — ελάχιστη σοβαρότητα)',
  18: 'Χαμηλά (μέτριο)',
  19: 'Σφάλμα δικτύου CAN',
  20: 'Παρεκκλίνει ψηλά',
  21: 'Παρεκκλίνει χαμηλά',
  31: 'Υπάρχει κατάσταση (δες εγχειρίδιο)',
};

export const fmiText = (fmi) => FMI[fmi] || `FMI ${fmi}`;

// --------------------------------------------------- λίγα γνωστά SPN
// Ο πλήρης κατάλογος SPN είναι τεράστιος και εν μέρει ιδιόκτητος· δεν τον
// εφευρίσκουμε. Δίνουμε μόνο μερικά πολύ κοινά ώστε να μην είναι όλα «άγνωστο».
const SPN_NAMES = {
  91: 'Θέση γκαζιού', 94: 'Πίεση καυσίμου', 100: 'Πίεση λαδιού',
  102: 'Πίεση υπερπλήρωσης (boost)', 105: 'Θερμ. αέρα εισαγωγής',
  108: 'Βαρομετρική πίεση', 110: 'Θερμ. ψυκτικού', 111: 'Στάθμη ψυκτικού',
  157: 'Πίεση ράμπας (common rail)', 158: 'Τάση συστήματος',
  168: 'Τάση μπαταρίας', 171: 'Θερμ. περιβάλλοντος', 174: 'Θερμ. καυσίμου',
  175: 'Θερμ. λαδιού κινητήρα', 190: 'Στροφές κινητήρα', 237: 'VIN',
  412: 'Θερμ. EGR', 441: 'Βοηθητική θερμ.', 513: 'Πραγματική ροπή κινητήρα',
  609: 'Μονάδα ελέγχου #1', 611: 'Σφάλμα συστήματος injection',
  625: 'Δίκτυο επικοινωνίας', 639: 'Δίαυλος J1939', 1136: 'Θερμ. ECU',
  3251: 'Πίεση DPF', 3719: 'Πλήρωση DPF (σωματίδια)', 4334: 'Πίεση DEF/AdBlue',
  4364: 'Απόδοση SCR', 5246: 'Στάθμη περιορισμού SCR',
};

export const spnName = (spn) => SPN_NAMES[spn] || null;

// --------------------------------------------------- parsing
const hexToBytes = (h) => {
  const s = h.replace(/\s/g, '');
  const out = [];
  for (let i = 0; i + 1 < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16));
  return out;
};

/** Ένα DTC από 4 bytes (SPN 19-bit + FMI 5-bit + CM 1-bit + OC 7-bit). */
function decodeDtc(b) {
  const spn = b[0] | (b[1] << 8) | ((b[2] >> 5) << 16);
  const fmi = b[2] & 0x1f;
  const oc = b[3] & 0x7f;
  if (spn === 0 && fmi === 0) return null; // γέμισμα
  if (spn === 0x7ffff) return null;        // «δεν υπάρχει»
  return { spn, fmi, oc, name: spnName(spn), fmiText: fmiText(fmi) };
}

/**
 * Από τις γραμμές του ELM (ATH1: «<CAN-ID> <data>») βγάζει τα DM1 μηνύματα.
 * Το DM1 είναι PGN 0xFECA — το ψάχνουμε μέσα στο 29-bit ID (18FECAxx).
 *
 * Υποστηρίζεται το single-frame DM1 (ως 1 κωδικός ανά πλαίσιο, πολλά πλαίσια).
 * Το multi-packet (BAM) για πολλούς κωδικούς σε ένα μήνυμα δεν συναρμολογείται
 * — δηλώνεται όταν εντοπιστεί.
 */
export function parseDm1(lines) {
  const dtcs = [];
  const lampSet = new Map();
  let sawBam = false;

  for (const ln of lines) {
    const m = ln.match(/^([0-9A-F]{8})\s+(.+)$/i);
    if (!m) continue;
    const id = m[1].toUpperCase();
    const pgn = id.slice(2, 6); // priority(2) PGN(4) source(2)
    const src = id.slice(6, 8);
    const data = hexToBytes(m[2]);
    // BAM (transport) έρχεται στο PGN ECBB/ECFF — το σημειώνουμε αλλά δεν το δένουμε.
    if (pgn === 'ECBB' || pgn === 'ECFF' || pgn === 'EBFF' || pgn === 'EBBB') { sawBam = true; continue; }
    if (pgn !== 'FECA') continue;
    if (data.length < 2) continue;

    const ls = lamps(data[0]);
    if (ls.length) lampSet.set(src, ls);
    // Μετά τα 2 bytes λυχνιών, DTCs ανά 4 bytes.
    for (let p = 2; p + 3 < data.length; p += 4) {
      const d = decodeDtc(data.slice(p, p + 4));
      if (d) dtcs.push({ ...d, src });
    }
  }

  // Αφαίρεση διπλών (ίδιο SPN+FMI από πολλά πλαίσια).
  const seen = new Set();
  const unique = dtcs.filter((d) => {
    const k = `${d.src}-${d.spn}-${d.fmi}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { dtcs: unique, lamps: [...lampSet.entries()].map(([src, l]) => ({ src, lamps: l })), sawBam };
}

/**
 * Διαβάζει τους ενεργούς κωδικούς J1939. Μόνο ανάγνωση (DM1 monitor).
 * Προϋποθέτει ότι το όχημα είναι σε J1939 (protocol A).
 */
export async function readJ1939(elm, { seconds = 3, onProgress = () => {} } = {}) {
  try {
    await elm.cmd('ATH1');          // headers ON για να δούμε το PGN
    onProgress({ phase: 'listen' });
    const lines = await elm.monitor('ATDM1', { timeout: seconds * 1000 });
    const res = parseDm1(lines);
    onProgress({ phase: 'done', found: res.dtcs.length });
    return { ok: true, ...res, raw: lines.length };
  } finally {
    await elm.cmd('ATH0').catch(() => {});
  }
}
