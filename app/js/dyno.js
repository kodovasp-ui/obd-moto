// Εκτίμηση ισχύος από επιτάχυνση («δυναμόμετρο δρόμου»).
//
// Αρχή: η ισχύς στον τροχό είναι το έργο ανά χρόνο για να επιταχυνθεί η μάζα,
// συν ό,τι χάνεται σε αεροδυναμική και κύλιση.
//
//   P = v · (m·a + ½·ρ·Cd·A·v² + Crr·m·g·cosθ + m·g·sinθ)
//
// ΑΚΡΙΒΕΙΑ: αυτό ΔΕΝ είναι δυναμόμετρο. Εξαρτάται από τη μάζα που θα δώσεις,
// τον συντελεστή οπισθέλκουσας που είναι εκτίμηση, τον άνεμο, την κλίση του
// δρόμου και τη συχνότητα δειγματοληψίας του OBD (~2-5 Hz, πολύ αργή για
// καθαρή παράγωγο). Οι τιμές είναι ΕΝΔΕΙΞΗ τάσης και σύγκρισης «πριν/μετά»,
// όχι απόλυτο μέγεθος. Η εφαρμογή το δηλώνει παντού.

const G = 9.80665;
const RHO = 1.225;        // πυκνότητα αέρα στους 15 °C, επίπεδο θάλασσας
const KW_PER_HP = 0.7457;

/** Τυπικές τιμές CdA (m²) και Crr ανά είδος οχήματος — εκτιμήσεις. */
export const VEHICLE_KINDS = {
  moto_naked: { label: 'Μοτοσυκλέτα naked / enduro', cda: 0.60, crr: 0.015, mass: 230 },
  moto_sport: { label: 'Μοτοσυκλέτα sport (ξαπλωμένος)', cda: 0.35, crr: 0.015, mass: 250 },
  moto_tour: { label: 'Μοτοσυκλέτα touring με ζελατίνα', cda: 0.70, crr: 0.015, mass: 320 },
  car_small: { label: 'Μικρό αυτοκίνητο', cda: 0.62, crr: 0.012, mass: 1200 },
  car_mid: { label: 'Μεσαίο αυτοκίνητο', cda: 0.68, crr: 0.012, mass: 1500 },
  suv: { label: 'SUV / van', cda: 0.90, crr: 0.013, mass: 2000 },
};

const kmh2ms = (v) => v / 3.6;

/**
 * Εξομάλυνση με κινητό μέσο όρο. Η ταχύτητα του OBD είναι ακέραια km/h, άρα
 * η ωμή παράγωγος είναι σκάλες — χωρίς εξομάλυνση η «ισχύς» πηδάει άγρια.
 */
function smooth(arr, win) {
  if (win < 2) return arr.slice();
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    let s = 0; let n = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(arr.length - 1, i + win); j++) { s += arr[j]; n++; }
    out.push(s / n);
  }
  return out;
}

/**
 * Υπολογίζει καμπύλη ισχύος από ένα τμήμα πλήρους επιτάχυνσης.
 *
 * rows: [{t, v:{'0D': km/h, '0C': rpm}}]
 * opts: {mass kg, cda m², crr, gradePct, riderMass kg}
 *
 * Επιστρέφει {points:[{t, v, rpm, a, pWheel, pAero, pRoll}], peak, warnings}
 */
export function estimatePower(rows, opts = {}) {
  const {
    mass = 230, cda = 0.60, crr = 0.015, gradePct = 0, riderMass = 85,
  } = opts;
  const m = mass + riderMass;
  const theta = Math.atan(gradePct / 100);

  const pts = rows.filter((r) => r.v['0D'] != null).map((r) => ({ t: r.t, kmh: r.v['0D'], rpm: r.v['0C'] ?? null }));
  if (pts.length < 6) return { ok: false, reason: 'Χρειάζονται τουλάχιστον 6 δείγματα ταχύτητας.' };

  const dtAvg = (pts[pts.length - 1].t - pts[0].t) / (pts.length - 1);
  const hz = dtAvg > 0 ? 1 / dtAvg : 0;
  const warnings = [];
  if (hz < 2) warnings.push(`Δειγματοληψία ${hz.toFixed(1)} Hz — πολύ αργή. Κράτα λίγα PID στο ταμπλό για να ανέβει.`);

  // Παράθυρο εξομάλυνσης ~0.6 s σε κάθε πλευρά.
  const win = Math.max(1, Math.round(0.6 / Math.max(dtAvg, 1e-3)));
  const vs = smooth(pts.map((p) => kmh2ms(p.kmh)), win);

  const out = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const dt = pts[i + 1].t - pts[i - 1].t;
    if (dt <= 0) continue;
    const a = (vs[i + 1] - vs[i - 1]) / dt;   // κεντρική διαφορά
    const v = vs[i];
    if (v < 2) continue;                      // κάτω από ~7 km/h δεν βγάζει νόημα
    const fInertia = m * a;
    const fAero = 0.5 * RHO * cda * v * v;
    const fRoll = crr * m * G * Math.cos(theta);
    const fGrade = m * G * Math.sin(theta);
    const total = fInertia + fAero + fRoll + fGrade;
    out.push({
      t: pts[i].t, v, kmh: pts[i].kmh, rpm: pts[i].rpm, a,
      pWheel: (total * v) / 1000,             // kW στον τροχό
      pAero: (fAero * v) / 1000,
      pRoll: ((fRoll + fGrade) * v) / 1000,
      // Ροπή αναγμένη στις στροφές του κινητήρα: τ = P/ω. Αγνοεί τις απώλειες
      // μετάδοσης, άρα είναι κάτω όριο της πραγματικής ροπής στον στρόφαλο.
      torque: pts[i].rpm ? (total * v) / (2 * Math.PI * (pts[i].rpm / 60)) : null,
    });
  }
  if (!out.length) return { ok: false, reason: 'Δεν βρέθηκε τμήμα με ταχύτητα πάνω από ~7 km/h.' };

  const peak = out.reduce((b, p) => (p.pWheel > b.pWheel ? p : b), out[0]);
  if (peak.a <= 0) warnings.push('Δεν υπάρχει επιτάχυνση στο τμήμα — η εκτίμηση δεν έχει νόημα.');

  return {
    ok: true, points: out, peak, hz, mass: m, warnings,
    peakHp: peak.pWheel / KW_PER_HP,
  };
}

/**
 * Βρίσκει μόνο του το καλύτερο τμήμα πλήρους επιτάχυνσης: η μεγαλύτερη
 * συνεχής περίοδος όπου η ταχύτητα ανεβαίνει σταθερά.
 */
export function bestPull(rows, minSeconds = 3) {
  const pts = rows.filter((r) => r.v['0D'] != null);
  let best = null; let start = 0;
  for (let i = 1; i <= pts.length; i++) {
    const rising = i < pts.length && pts[i].v['0D'] >= pts[i - 1].v['0D'];
    if (!rising) {
      const dur = pts[i - 1].t - pts[start].t;
      const gain = pts[i - 1].v['0D'] - pts[start].v['0D'];
      if (dur >= minSeconds && gain >= 20 && (!best || dur * gain > best.score)) {
        best = { from: start, to: i - 1, score: dur * gain, dur, gain };
      }
      start = i;
    }
  }
  if (!best) return null;
  return { rows: pts.slice(best.from, best.to + 1), dur: best.dur, gain: best.gain };
}

export const HOWTO = [
  'Βάλε στο ταμπλό ΜΟΝΟ ταχύτητα (0D) και στροφές (0C): λιγότερα PID, πιο γρήγορη δειγματοληψία.',
  'Δήλωσε σωστά τη μάζα — είναι ο μεγαλύτερος παράγοντας λάθους.',
  'Ίσιος, επίπεδος δρόμος χωρίς άνεμο. Ανηφόρα ή κόντρα αέρας αλλοιώνουν σοβαρά το αποτέλεσμα.',
  'Μία σχέση, τέρμα γκάζι, από χαμηλές στροφές ως το κόκκινο. Χωρίς αλλαγή ταχύτητας μέσα στο τμήμα.',
  'Για σύγκριση «πριν/μετά» κάνε τις μετρήσεις στον ίδιο δρόμο, ίδια σχέση, ίδια μέρα.',
];
