// Μονάδες μέτρησης: μετρικό (προεπιλογή) ή imperial.
//
// Η μετατροπή γίνεται ΜΟΝΟ στην εμφάνιση, με βάση τη μονάδα του PID — έτσι
// καλύπτονται αυτόματα όλα τα PID χωρίς ξεχωριστή ρύθμιση για το καθένα.
// Τα δεδομένα (συνεδρίες, CSV, context του βοηθού) μένουν ΠΑΝΤΑ μετρικά,
// ώστε οι αποθηκευμένες καταγραφές να συγκρίνονται μεταξύ τους.

const KEY = 'obd.units';

// μονάδα → [νέα μονάδα, πολλαπλασιαστής, σταθερά, δεκαδικά]
const TO_IMPERIAL = {
  '°C': ['°F', 1.8, 32, 0],
  'km/h': ['mph', 0.621371, 0, 0],
  km: ['mi', 0.621371, 0, 0],
  kPa: ['psi', 0.145038, 0, 1],
  'L/h': ['gal/h', 0.264172, 0, 2],
  'g/s': ['lb/min', 0.132277, 0, 2],
  Nm: ['lb·ft', 0.737562, 0, 0],
  'mg/stroke': ['gr/stroke', 0.0154324, 0, 3],
};

let system = (() => {
  try { return localStorage.getItem(KEY) === 'imperial' ? 'imperial' : 'metric'; } catch { return 'metric'; }
})();

export const getSystem = () => system;

export function setSystem(s) {
  system = s === 'imperial' ? 'imperial' : 'metric';
  try { localStorage.setItem(KEY, system); } catch { /* χωρίς αποθήκευση */ }
  return system;
}

/** Μετατρέπει μια τιμή από τη μετρική της μονάδα στο τρέχον σύστημα. */
export function conv(v, unit) {
  if (v == null || system === 'metric') return v;
  const r = TO_IMPERIAL[unit];
  return r ? v * r[1] + r[2] : v;
}

/** Η μονάδα όπως θα εμφανιστεί. */
export function unitLabel(unit) {
  if (system === 'metric') return unit;
  return TO_IMPERIAL[unit]?.[0] ?? unit;
}

/** Δεκαδικά για την εμφάνιση (το imperial μπορεί να θέλει άλλα). */
export function decFor(unit, dec = 1) {
  if (system === 'metric') return dec;
  return TO_IMPERIAL[unit]?.[3] ?? dec;
}

/** Μετατρέπει μαζί τιμή, μονάδα και δεκαδικά (τα δεκαδικά από τον πίνακα). */
export function display(v, unit, dec = 1) {
  return { v: conv(v, unit), unit: unitLabel(unit), dec: decFor(unit, dec) };
}

/**
 * Σαν το display, αλλά κρατά τα δεκαδικά που ζητά ο καλών.
 * Για μεγέθη όπου ο πίνακας θα στρογγυλοποιούσε άσχημα — π.χ. απόσταση ταξιδιού
 * 0,71 km σε μίλια θα γινόταν «0» με τα δεκαδικά του χιλιομετρητή.
 */
export function displayExact(v, unit, dec = 1) {
  return { v: conv(v, unit), unit: unitLabel(unit), dec };
}

/** Κόστος ανά απόσταση: €/100 km ή €/100 mi, ανάλογα με το σύστημα. */
export function costPerDistance(eurPer100km) {
  if (eurPer100km == null) return null;
  return system === 'metric'
    ? { v: eurPer100km, label: '€/100 km' }
    : { v: eurPer100km / 0.621371, label: '€/100 mi' };
}

/** Κατανάλωση: L/100km στο μετρικό, mpg (US) στο imperial — αντίστροφη σχέση. */
export function consumption(lPer100km) {
  if (lPer100km == null || !(lPer100km > 0)) return { v: null, unit: system === 'metric' ? 'L/100km' : 'mpg', dec: 1 };
  if (system === 'metric') return { v: lPer100km, unit: 'L/100km', dec: 1 };
  return { v: 235.215 / lPer100km, unit: 'mpg', dec: 1 };
}

/** Όγκος καυσίμου: λίτρα ή γαλόνια (US). */
export function volume(liters) {
  if (liters == null) return { v: null, unit: system === 'metric' ? 'L' : 'gal', dec: 2 };
  return system === 'metric' ? { v: liters, unit: 'L', dec: 2 } : { v: liters * 0.264172, unit: 'gal', dec: 2 };
}

/** Ταχύτητα-στόχος για τη μέτρηση επιδόσεων: 100 km/h ή 60 mph. */
export function sprintTarget() {
  return system === 'metric' ? { kmh: 100, label: '0–100 km/h' } : { kmh: 96.5606, label: '0–60 mph' };
}
