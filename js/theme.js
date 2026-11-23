// Θέμα εμφάνισης: αυτόματο (από το σύστημα), φωτεινό ή σκοτεινό.
//
// Το CSS έχει ήδη τρεις καταστάσεις: προεπιλογή = φωτεινό, @media
// prefers-color-scheme: dark = σκοτεινό, και ρητό [data-theme]. Εδώ απλώς
// γράφουμε το data-theme στο <html> και θυμόμαστε την επιλογή.
//
// Η εφαρμογή του θέματος γίνεται ΠΡΙΝ το πρώτο paint από ένα μικρό script
// στο <head> (δες index.html) — αλλιώς θα έβλεπες μια αναλαμπή σκοτεινού.

const KEY = 'obd.theme';
const MODES = ['auto', 'light', 'dark'];

// Χρώματα της γραμμής του browser / της PWA — ίδια με τα --bg του CSS.
const BAR = { light: '#f4f6f8', dark: '#0f1216' };

let mode = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return MODES.includes(v) ? v : 'auto';
  } catch { return 'auto'; }
})();

const media = window.matchMedia?.('(prefers-color-scheme: dark)');

/** Το θέμα που ισχύει τώρα στην πράξη: 'light' ή 'dark'. */
export function effective() {
  if (mode !== 'auto') return mode;
  return media?.matches ? 'dark' : 'light';
}

export const getMode = () => mode;

function paint() {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', BAR[effective()]);
}

export function setMode(m) {
  mode = MODES.includes(m) ? m : 'auto';
  try { localStorage.setItem(KEY, mode); } catch { /* χωρίς αποθήκευση */ }
  paint();
  onChange.forEach((f) => f(mode));
  return mode;
}

/** Κυκλικά: αυτόματο → φωτεινό → σκοτεινό. */
export function cycle() {
  return setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
}

const onChange = [];
export function subscribe(fn) { onChange.push(fn); }

export const LABEL = { auto: 'Αυτόματο', light: 'Φωτεινό', dark: 'Σκοτεινό' };
export const ICON = { auto: '◐', light: '☀', dark: '☾' };

// Όταν είμαστε σε «αυτόματο» και αλλάξει το σύστημα, ενημερώνουμε τη γραμμή
// και όποιον μας ακούει (τα γραφήματα ξαναδιαβάζουν χρώματα από το CSS).
media?.addEventListener?.('change', () => {
  if (mode === 'auto') { paint(); onChange.forEach((f) => f(mode)); }
});

paint();
