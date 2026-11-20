// Υπολογιστής ταξιδιού και μετρήσεις επιδόσεων, από τις live γραμμές της συνεδρίας.
// rows: [{t, v:{pid: τιμή}}] με μετρικές τιμές (0D km/h, 5E L/h, 10 g/s).
//
// Η κατανάλωση προτιμά το PID 5E (η ECU δίνει L/h απευθείας). Αν δεν υπάρχει,
// εκτιμάται από το MAF (0x10) με τη στοιχειομετρική αναλογία — είναι ΕΚΤΙΜΗΣΗ
// και δηλώνεται ως τέτοια, γιατί εξαρτάται από λάμδα και πυκνότητα καυσίμου.

const AFR_STOICH = 14.7;      // βενζίνη
const FUEL_DENSITY = 745;     // g/L, βενζίνη ~0.745 kg/L

/** Εκτίμηση L/h από MAF g/s. */
export function fuelRateFromMaf(mafGs) {
  if (mafGs == null || !(mafGs > 0)) return null;
  const fuelGs = mafGs / AFR_STOICH;
  return (fuelGs / FUEL_DENSITY) * 3600;
}

/**
 * Σύνοψη ταξιδιού με ολοκλήρωση ανά διάστημα (τραπεζοειδής).
 * Επιστρέφει null αν δεν υπάρχουν αρκετά δεδομένα.
 */
export function tripSummary(rows) {
  if (!rows || rows.length < 2) return null;
  let dist = 0;        // km
  let fuel = 0;        // L
  let moving = 0;      // s
  let idle = 0;        // s
  let maxSpeed = 0;
  let maxRpm = 0;
  let estimated = false;
  let haveFuel = false;

  const rate = (r) => {
    if (r.v['5E'] != null) { haveFuel = true; return r.v['5E']; }
    const est = fuelRateFromMaf(r.v['10']);
    if (est != null) { haveFuel = true; estimated = true; }
    return est;
  };

  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    const dt = b.t - a.t;
    // Κενά μεγαλύτερα από 5 s σημαίνουν διακοπή καταγραφής — μη τα ολοκληρώνεις.
    if (!(dt > 0) || dt > 5) continue;

    const sa = a.v['0D'];
    const sb = b.v['0D'];
    if (sa != null && sb != null) {
      dist += ((sa + sb) / 2) * (dt / 3600);
      if ((sa + sb) / 2 > 1) moving += dt; else idle += dt;
      maxSpeed = Math.max(maxSpeed, sa, sb);
    }
    const ra = rate(a);
    const rb = rate(b);
    if (ra != null && rb != null) fuel += ((ra + rb) / 2) * (dt / 3600);
    if (a.v['0C'] != null) maxRpm = Math.max(maxRpm, a.v['0C']);
  }

  const dur = rows[rows.length - 1].t - rows[0].t;
  return {
    duration: dur,
    distance: dist,
    fuel: haveFuel ? fuel : null,
    estimated,
    moving,
    idle,
    maxSpeed,
    maxRpm,
    avgSpeed: moving > 0 ? dist / (moving / 3600) : null,
    // L/100km — μόνο αν κινήθηκε αρκετά, αλλιώς βγαίνουν τρελά νούμερα
    lPer100: haveFuel && dist > 0.2 ? (fuel / dist) * 100 : null,
    // Κατανάλωση στο ρελαντί (L/h) — χρήσιμο για σύγκριση
    idleRate: (() => {
      const vals = rows.filter((r) => (r.v['0D'] ?? 0) <= 1).map(rate).filter((x) => x != null);
      return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
    })(),
  };
}

/**
 * Βρίσκει την καλύτερη επιτάχυνση από στάση ως targetKmh.
 * Επιστρέφει {time, from, to} ή null. Απαιτεί αφετηρία ≤ 2 km/h.
 */
export function sprint(rows, targetKmh = 100) {
  if (!rows?.length) return null;
  let best = null;
  let start = null;
  for (const r of rows) {
    const v = r.v['0D'];
    if (v == null) continue;
    if (v <= 2) { start = r.t; continue; }
    if (start == null) continue;
    if (v >= targetKmh) {
      const dt = r.t - start;
      if (dt > 0 && (!best || dt < best.time)) best = { time: dt, from: start, to: r.t };
      start = null; // μέτρα την επόμενη εκκίνηση από την αρχή
    }
  }
  return best;
}

/** Καλύτερος χρόνος για δεδομένη απόσταση από στάση (π.χ. 402 m = 1/4 μίλι). */
export function standingDistance(rows, meters = 402) {
  if (!rows?.length) return null;
  let best = null;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i].v['0D'] ?? 99) > 2) continue; // ψάξε αφετηρίες από στάση
    let d = 0;
    for (let j = i + 1; j < rows.length; j++) {
      const dt = rows[j].t - rows[j - 1].t;
      if (!(dt > 0) || dt > 5) break;
      const sa = rows[j - 1].v['0D'];
      const sb = rows[j].v['0D'];
      if (sa == null || sb == null) break;
      d += ((sa + sb) / 2) * (dt / 3.6); // m
      if (d >= meters) {
        const t = rows[j].t - rows[i].t;
        if (!best || t < best.time) best = { time: t, exitSpeed: sb };
        break;
      }
      if (sb <= 2 && d > 5) break; // σταμάτησε πριν συμπληρώσει την απόσταση
    }
  }
  return best;
}

/** Κόστος ταξιδιού με δεδομένη τιμή καυσίμου (€/L). */
export function tripCost(trip, pricePerLiter) {
  if (!trip?.fuel || !(pricePerLiter > 0)) return null;
  return {
    total: trip.fuel * pricePerLiter,
    per100km: trip.lPer100 != null ? trip.lPer100 * pricePerLiter : null,
  };
}
