// Αποκωδικοποίηση VIN (ISO 3779) — εντελώς offline, χωρίς δίκτυο.
//
// Ο VIN έχει 17 χαρακτήρες σε τρία μέρη:
//   1–3   WMI  ποιος τον έφτιαξε και πού
//   4–9   VDS  περιγραφή οχήματος (ελεύθερη ανά κατασκευαστή) — το 9 είναι check digit
//   10–17 VIS  το 10 είναι έτος μοντέλου, το 11 το εργοστάσιο, 12–17 ο αύξων αριθμός
//
// ΔΕΝ εφευρίσκουμε μοντέλα: το VDS είναι ιδιωτικό κάθε κατασκευαστή και
// διαφέρει ακόμη και μεταξύ εργοστασίων. Δίνουμε μόνο ό,τι είναι τυποποιημένο
// (χώρα, έτος, check digit) και τον κατασκευαστή όταν το WMI είναι γνωστό.

// ---------------------------------------------------------------- χώρα
// Πρώτος χαρακτήρας → περιοχή· οι δύο πρώτοι → χώρα (ISO 3780).
const REGION = [
  [/^[A-H]/, 'Αφρική'], [/^[J-R]/, 'Ασία'], [/^[S-Z]/, 'Ευρώπη'],
  [/^[1-5]/, 'Βόρεια Αμερική'], [/^[6-7]/, 'Ωκεανία'], [/^[8-9]/, 'Νότια Αμερική'],
];

const COUNTRY = [
  [/^1|^4|^5/, 'ΗΠΑ'], [/^2/, 'Καναδάς'], [/^3[A-W]/, 'Μεξικό'],
  [/^6[A-W]/, 'Αυστραλία'], [/^9[A-E]|^9[3-9]/, 'Βραζιλία'], [/^8[A-E]/, 'Αργεντινή'],
  [/^J/, 'Ιαπωνία'], [/^K[L-R]/, 'Νότια Κορέα'], [/^L/, 'Κίνα'],
  [/^M[A-E]/, 'Ινδία'], [/^M[L-R]/, 'Ταϊλάνδη'], [/^N[L-R]/, 'Τουρκία'],
  [/^P[A-E]/, 'Φιλιππίνες'], [/^R[F-K]/, 'Ταϊβάν'],
  [/^S[A-M]/, 'Ηνωμένο Βασίλειο'], [/^S[N-T]/, 'Γερμανία'], [/^S[U-Z]/, 'Πολωνία'],
  [/^T[A-H]/, 'Ελβετία'], [/^T[J-P]/, 'Τσεχία'], [/^T[R-V]/, 'Ουγγαρία'],
  [/^U[H-M]/, 'Δανία'], [/^U[N-T]/, 'Ιρλανδία'], [/^U[U-Z]/, 'Ρουμανία'],
  [/^V[A-E]/, 'Αυστρία'], [/^V[F-R]/, 'Γαλλία'], [/^V[S-W]/, 'Ισπανία'], [/^V[X-Z]/, 'Σερβία'],
  [/^W/, 'Γερμανία'], [/^X[0-9]/, 'Ρωσία'], [/^X[3-9]|^X[A-E]/, 'Ρωσία'],
  [/^X[L-M]/, 'Ολλανδία'], [/^X[S-W]/, 'Ουκρανία'],
  [/^Y[A-E]/, 'Βέλγιο'], [/^Y[F-K]/, 'Φινλανδία'], [/^Y[S-W]/, 'Σουηδία'],
  [/^Z[A-R]/, 'Ιταλία'],
];

// ---------------------------------------------------------------- WMI
// Μόνο κατασκευαστές που μπορούμε να δηλώσουμε με βεβαιότητα. Η λίστα είναι
// σκόπιμα μικρή: καλύτερα «άγνωστος κατασκευαστής» παρά λάθος όνομα.
const WMI = {
  LCE: 'CFMOTO (Zhejiang CFMOTO Power)',
  LAA: 'Jiangsu Linhai / Yamaha (Κίνα)', LBB: 'Zongshen', LBE: 'Qianjiang / Benelli',
  LBM: 'Piaggio (Κίνα)', LBP: 'Chongqing Jianshe', LFB: 'Jinan Qingqi',
  LHJ: 'Haojue', LPR: 'Loncin', LTM: 'Hunan Jiangnan', LXY: 'Zhejiang Yongkang',
  JYA: 'Yamaha', JH2: 'Honda (μοτοσυκλέτα)', JS1: 'Suzuki', JKA: 'Kawasaki',
  JKB: 'Kawasaki', MLH: 'Honda (Ταϊλάνδη)', ME4: 'Honda (Ινδία)', MD2: 'Bajaj',
  ZDM: 'Ducati', ZD4: 'Aprilia', ZAP: 'Piaggio / Moto Guzzi', ZKH: 'Husqvarna',
  WB1: 'BMW Motorrad', WB4: 'BMW Motorrad', VBK: 'KTM', VTT: 'Triumph',
  SMT: 'Triumph', VGA: 'Peugeot Motocycles', RFB: 'Kymco', RFV: 'SYM',
  VF1: 'Renault', VF3: 'Peugeot', VF7: 'Citroën', WVW: 'Volkswagen', WAU: 'Audi',
  WDB: 'Mercedes-Benz', WDD: 'Mercedes-Benz', WBA: 'BMW', WF0: 'Ford (Ευρώπη)',
  WP0: 'Porsche', ZFA: 'Fiat', ZAR: 'Alfa Romeo', TMB: 'Škoda', VSS: 'SEAT',
  JTD: 'Toyota', JTM: 'Toyota', JN1: 'Nissan', JMZ: 'Mazda', JHM: 'Honda',
  KMH: 'Hyundai', KNA: 'Kia', KNE: 'Kia', YV1: 'Volvo', VSK: 'Nissan (Ισπανία)',
  '1HG': 'Honda (ΗΠΑ)', '1G1': 'Chevrolet', '1GC': 'Chevrolet (φορτηγό)',
  '1FA': 'Ford', '1FT': 'Ford (φορτηγό)', '1N4': 'Nissan (ΗΠΑ)',
  '2T1': 'Toyota (Καναδάς)', '3VW': 'Volkswagen (Μεξικό)', '5YJ': 'Tesla',
  JF1: 'Subaru', JF2: 'Subaru', WMW: 'MINI', SAL: 'Land Rover', SAJ: 'Jaguar',
  TRU: 'Audi (Ουγγαρία)', TMA: 'Hyundai (Τσεχία)', NLH: 'Hyundai (Τουρκία)',
  SJN: 'Nissan (ΗΒ)', VNK: 'Toyota (Τουρκία)', ZFF: 'Ferrari', ZHW: 'Lamborghini',
};

// ---------------------------------------------------------------- έτος
// Ο 10ος χαρακτήρας είναι έτος μοντέλου, με κύκλο 30 ετών. Για να ξεχωρίσει
// ο κύκλος, ο 7ος χαρακτήρας είναι γράμμα στα οχήματα από το 2010 και μετά
// (για ελαφρά οχήματα κατά SAE).
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

export function modelYear(vin) {
  const c = vin[9];
  const i = YEAR_CODES.indexOf(c);
  if (i < 0) return null;
  const letter7 = /[A-Z]/.test(vin[6]);
  const base = letter7 ? 2010 : 1980;
  let y = base + i;
  // Ο κύκλος των 30 ετών: αν βγει έτος στο μέλλον, είναι ο προηγούμενος κύκλος.
  const nextYear = new Date().getFullYear() + 1;
  while (y > nextYear) y -= 30;
  return y;
}

// ---------------------------------------------------------------- check digit
// Η 9η θέση είναι άθροισμα ελέγχου. Υποχρεωτική σε Βόρεια Αμερική και Κίνα·
// αλλού συχνά είναι γέμισμα, οπότε η αποτυχία ΔΕΝ σημαίνει πλαστός VIN.
const TRANSLIT = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function checkDigit(vin) {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const v = /[0-9]/.test(c) ? Number(c) : TRANSLIT[c];
    if (v == null) return null;
    sum += v * WEIGHTS[i];
  }
  const r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

// ---------------------------------------------------------------- σύνολο
const VALID = /^[A-HJ-NPR-Z0-9]{17}$/; // χωρίς I, O, Q — μπερδεύονται με 1 και 0

/**
 * Επιστρέφει ό,τι ΕΙΝΑΙ τυποποιημένο στον VIN. Ό,τι δεν ξέρουμε μένει null —
 * δεν μαντεύουμε μοντέλο ή κινητήρα από το VDS.
 */
export function decodeVin(raw) {
  const vin = String(raw || '').toUpperCase().replace(/\s/g, '');
  if (!vin) return null;
  if (!VALID.test(vin)) {
    return {
      vin, valid: false,
      problem: vin.length !== 17
        ? `Έχει ${vin.length} χαρακτήρες αντί για 17.`
        : 'Περιέχει χαρακτήρες που δεν επιτρέπονται σε VIN (I, O, Q).',
    };
  }

  const wmi = vin.slice(0, 3);
  const expect = checkDigit(vin);
  const country = COUNTRY.find(([re]) => re.test(vin))?.[1] || null;

  return {
    vin,
    valid: true,
    wmi,
    maker: WMI[wmi] || null,
    region: REGION.find(([re]) => re.test(vin))?.[1] || null,
    country,
    vds: vin.slice(3, 8),
    checkDigit: vin[8],
    checkExpected: expect,
    // Το check digit επιβάλλεται σε Β. Αμερική και Κίνα· αλλού είναι προαιρετικό.
    checkRequired: /^[1-5L]/.test(vin),
    checkOk: expect != null && expect === vin[8],
    year: modelYear(vin),
    plant: vin[10],
    serial: vin.slice(11),
  };
}
