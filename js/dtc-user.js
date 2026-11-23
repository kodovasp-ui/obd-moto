// Κωδικοί βλάβης από αρχείο του χρήστη.
//
// Η βάση της εφαρμογής έχει μόνο τυποποιημένους κωδικούς (SAE J2012). Οι
// ειδικοί κωδικοί κάθε κατασκευαστή δεν είναι δημοσιευμένοι και ΔΕΝ τους
// εφευρίσκουμε. Αν όμως έχεις το εγχειρίδιο σέρβις, μπορείς να τους
// φορτώσεις εσύ — και τότε εμφανίζονται παντού όπως οι υπόλοιποι.
//
// Αποθηκεύονται τοπικά (localStorage). Δεν φεύγουν από τη συσκευή.

const KEY = 'obd.dtc.user';

let TABLE = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
})();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(TABLE)); } catch { /* χωρίς αποθήκευση */ }
}

export const userCount = () => Object.keys(TABLE).length;
export const userCodes = () => Object.keys(TABLE).sort();

/** Η εγγραφή για έναν κωδικό, ή null. */
export function userLookup(code) {
  return TABLE[String(code).toUpperCase()] || null;
}

export function clearUser() {
  TABLE = {};
  persist();
}

const CODE_RE = /^[PCBU][0-3][0-9A-F]{3}$/;

/**
 * Διαβάζει CSV ή TSV. Πρώτη στήλη ο κωδικός, δεύτερη η περιγραφή, και
 * προαιρετικά τρίτη με αιτίες και τέταρτη με βήματα ελέγχου (χωρισμένα με «;»).
 * Η πρώτη γραμμή αγνοείται αν δεν ξεκινά με έγκυρο κωδικό (επικεφαλίδα).
 *
 * Επιστρέφει {added, skipped, errors:[...]} — δεν γράφει τίποτα αν υπάρχουν
 * μόνο σφάλματα, ώστε ένα λάθος αρχείο να μη χαλάσει ό,τι έχεις ήδη.
 */
export function parseUserDtcs(text) {
  const out = {};
  const errors = [];
  let skipped = 0;
  const lines = String(text).split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith('#')) continue;
    // Χωρίζουμε με tab αν υπάρχει, αλλιώς με κόμμα ή ελληνικό ερωτηματικό.
    const sep = raw.includes('\t') ? '\t' : (raw.includes(';') && !raw.includes(',') ? ';' : ',');
    const cells = splitCsv(raw, sep);
    const code = (cells[0] || '').toUpperCase().replace(/\s/g, '');
    if (!CODE_RE.test(code)) {
      if (i === 0) continue; // επικεφαλίδα
      skipped++;
      if (errors.length < 5) errors.push(`Γραμμή ${i + 1}: «${cells[0] || raw}» δεν είναι κωδικός βλάβης.`);
      continue;
    }
    const title = (cells[1] || '').trim();
    if (!title) {
      skipped++;
      if (errors.length < 5) errors.push(`Γραμμή ${i + 1}: ο ${code} δεν έχει περιγραφή.`);
      continue;
    }
    const list = (s) => (s || '').split(/\s*;\s*/).map((x) => x.trim()).filter(Boolean);
    out[code] = { t: title, causes: list(cells[2]), steps: list(cells[3]) };
  }
  return { table: out, added: Object.keys(out).length, skipped, errors };
}

/** Προσθέτει (ή αντικαθιστά) τους κωδικούς του αρχείου. */
export function addUserDtcs(table) {
  TABLE = { ...TABLE, ...table };
  persist();
  return userCount();
}

/** Σωστός χωρισμός CSV με εισαγωγικά — οι περιγραφές συχνά έχουν κόμματα. */
function splitCsv(line, sep) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Το αρχείο-υπόδειγμα, για να ξέρει ο χρήστης τι σχήμα θέλουμε. */
export const SAMPLE = `# Κωδικός,Περιγραφή,Πιθανές αιτίες (;),Βήματα ελέγχου (;)
P1234,Αισθητήρας θέσης γκαζιού 2 — εκτός εύρους,Βύσμα;Καλωδίωση;Αισθητήρας,Μέτρησε τάση στο βύσμα;Σύγκρινε με TPS1
C1500,Βαλβίδα ABS εμπρός — ανοιχτό κύκλωμα,Βύσμα βαλβίδας;Μονάδα ABS,Έλεγξε αντίσταση πηνίου
`;
