// Έλεγχος μπαταρίας και φόρτισης από την τάση που ήδη καταγράφουμε.
//
// Δύο πηγές τάσης:
//   RV   η τάση στην πρίζα OBD, όπως τη μετρά ο ίδιος ο adapter
//   42   η τάση που αναφέρει η ECU (Control module voltage)
// Η RV περιλαμβάνει την πτώση στα καλώδια ως την πρίζα, οπότε είναι λίγο
// χαμηλότερη. Όποια υπάρχει χρησιμοποιείται· αν υπάρχουν και οι δύο, η RV.
//
// ΔΕΝ είναι τεστ φορτίου (load test): χωρίς όργανο δεν μετριέται η
// εσωτερική αντίσταση ούτε τα CCA. Μετράμε τάση — και το λέμε.

// Όρια για μολύβδου-οξέος 12 V. Για λιθίου (LiFePO4) τα όρια διαφέρουν
// και δηλώνεται ρητά όταν επιλεγεί.
const LEAD = {
  label: 'Μολύβδου–οξέος (12 V)',
  rest: [
    [12.70, 'full', 'Πλήρως φορτισμένη (100%)'],
    [12.50, 'ok', 'Καλή (~75%)'],
    [12.35, 'warn', 'Μέτρια (~50%) — θέλει φόρτιση'],
    [12.10, 'warn', 'Χαμηλή (~25%) — φόρτισε σύντομα'],
    [0, 'bad', 'Αποφορτισμένη ή χαλασμένη'],
  ],
  charge: { low: 13.6, high: 14.8, ideal: [13.8, 14.6] },
  crankMin: 9.6, // κάτω από αυτό σε μίζα: αδύναμη μπαταρία (στους ~20 °C)
};

const LITHIUM = {
  label: 'Λιθίου LiFePO4 (12 V)',
  rest: [
    [13.30, 'full', 'Πλήρως φορτισμένη (100%)'],
    [13.10, 'ok', 'Καλή (~70%)'],
    [12.90, 'warn', 'Μέτρια (~40%)'],
    [12.60, 'warn', 'Χαμηλή — φόρτισε'],
    [0, 'bad', 'Πολύ χαμηλή — κίνδυνος ζημιάς'],
  ],
  charge: { low: 13.6, high: 14.6, ideal: [13.8, 14.4] },
  crankMin: 10.5, // το λιθίου κρατά πολύ καλύτερα την τάση στη μίζα
};

export const CHEMISTRY = { lead: LEAD, lithium: LITHIUM };

function restVerdict(v, chem) {
  for (const [min, level, text] of chem.rest) if (v >= min) return { level, text };
  return { level: 'bad', text: 'Αποφορτισμένη' };
}

/**
 * Αναλύει μια καταγραφή. rows: [{t, v:{RV, '42', '0C', '0D', ...}}]
 * Χωρίζει τη διαδρομή σε τρεις φάσεις από τις στροφές:
 *   μίζα    rpm μεταξύ 1 και ~400, ή η βουτιά της τάσης πριν ανάψει
 *   σβηστός rpm ~0
 *   φόρτιση rpm > 800
 */
export function analyzeBattery(rows, chemistry = 'lead') {
  const chem = CHEMISTRY[chemistry] || LEAD;
  const volt = (r) => r.v.RV ?? r.v['42'] ?? null;
  const pts = rows.filter((r) => volt(r) != null);
  if (pts.length < 3) {
    return { ok: false, reason: 'Χρειάζεται καταγραφή με τάση — πρόσθεσε στο ταμπλό το «Τάση (ATRV)» ή το PID 42.' };
  }

  const source = rows.some((r) => r.v.RV != null) ? 'RV (adapter)' : 'PID 42 (ECU)';
  const rpmOf = (r) => r.v['0C'] ?? null;
  const haveRpm = pts.some((r) => rpmOf(r) != null);

  const out = { ok: true, chem: chem.label, source, haveRpm };

  // Χωρίς στροφές δεν ξέρουμε αν ο κινητήρας δούλευε. Τότε ΔΕΝ βγάζουμε
  // συμπέρασμα: 14.3 V είναι άριστη φόρτιση αλλά αδύνατη τάση ηρεμίας, και
  // το να την πούμε «πλήρως φορτισμένη μπαταρία» θα ήταν λάθος.
  if (!haveRpm) {
    const vs = pts.map(volt);
    out.rangeOnly = {
      min: Math.min(...vs), max: Math.max(...vs),
      avg: vs.reduce((a, b) => a + b, 0) / vs.length,
    };
    return out;
  }

  const off = pts.filter((r) => rpmOf(r) != null && rpmOf(r) < 50);
  const running = pts.filter((r) => (rpmOf(r) ?? 0) > 800);

  // --- ηρεμία
  if (off.length >= 2) {
    const v = Math.max(...off.map(volt)); // το ψηλότερο, αφού η μίζα βυθίζει
    out.rest = { v, ...restVerdict(v, chem) };
  }

  // --- βύθισμα μίζας: το χαμηλότερο σημείο πριν πάρει μπρος
  const firstRun = pts.findIndex((r) => (rpmOf(r) ?? 0) > 400);
  if (haveRpm && firstRun > 0) {
    const before = pts.slice(0, firstRun);
    const dip = Math.min(...before.map(volt));
    out.crank = {
      v: dip,
      level: dip >= chem.crankMin ? 'ok' : 'bad',
      text: dip >= chem.crankMin
        ? `Κράτησε ${dip.toFixed(2)} V στη μίζα — εντάξει.`
        : `Έπεσε στα ${dip.toFixed(2)} V (όριο ${chem.crankMin} V) — αδύναμη μπαταρία ή κακή επαφή.`,
    };
  }

  // --- φόρτιση
  if (running.length >= 3) {
    const vs = running.map(volt);
    const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
    const min = Math.min(...vs);
    const max = Math.max(...vs);
    const [lo, hi] = chem.charge.ideal;
    let level; let text;
    if (avg < chem.charge.low) {
      level = 'bad';
      text = `Δεν φορτίζει αρκετά (${avg.toFixed(2)} V). Έλεγξε αλτερνέιτορ, ρυθμιστή τάσης, ιμάντα και γειώσεις.`;
    } else if (avg > chem.charge.high) {
      level = 'bad';
      text = `Υπερφόρτιση (${avg.toFixed(2)} V). Χαλασμένος ρυθμιστής τάσης — καίει την μπαταρία.`;
    } else if (avg >= lo && avg <= hi) {
      level = 'ok';
      text = `Φόρτιση κανονική (${avg.toFixed(2)} V, ιδανικό ${lo}–${hi} V).`;
    } else {
      level = 'warn';
      text = `Φόρτιση οριακή (${avg.toFixed(2)} V, ιδανικό ${lo}–${hi} V).`;
    }
    // Μεγάλη διακύμανση = ρυθμιστής που «κυνηγάει» ή κακή επαφή.
    const ripple = max - min;
    out.charge = {
      avg, min, max, ripple, level, text,
      rippleWarn: ripple > 1.0
        ? `Η τάση κυμαίνεται ${ripple.toFixed(2)} V. Μεγάλη διακύμανση δείχνει ρυθμιστή που `
          + 'δυσκολεύεται, χαλαρή επαφή ή διόδους που περνούν — αλλά και απλή αλλαγή φορτίων '
          + '(φώτα, βεντιλατέρ).'
        : null,
    };
  }

  if (!out.rest && !out.charge && !out.crank && !out.rangeOnly) {
    out.ok = false;
    out.reason = 'Η καταγραφή δεν έχει ούτε σβηστό κινητήρα ούτε λειτουργία πάνω από 800 rpm.';
  }
  return out;
}

/** Τι να κάνει ο χρήστης για πλήρη έλεγχο — η σειρά έχει σημασία. */
export const HOWTO = [
  'Πρόσθεσε στο ταμπλό το «Τάση (ATRV)» και, αν υπάρχει, το PID 42.',
  'Ξεκίνα καταγραφή με τον κινητήρα ΣΒΗΣΤΟ και το κλειδί στο ON — 10 δευτερόλεπτα.',
  'Βάλε μπρος όσο καταγράφει: έτσι πιάνεται η βουτιά της μίζας.',
  'Άφησέ τον να δουλέψει 30 δευτερόλεπτα στο ρελαντί, μετά ανέβασε στις ~3000 rpm.',
  'Άναψε φώτα και φλας στο τέλος: η τάση δεν πρέπει να πέσει κάτω από 13 V.',
];
