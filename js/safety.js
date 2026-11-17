// Whitelist εντολών προς ELM327 / ECU — ΜΟΝΟ ανάγνωση (βλ. CLAUDE.md).
// Ό,τι δεν ταιριάζει ρητά εδώ απορρίπτεται. Ίδια λίστα με tools/obd_safety.py
// (το tests/test_safety.py ελέγχει ότι συμφωνούν).

// --- SAFETY-RULES-BEGIN (κράτα ίδιο με tools/obd_safety.py)
export const OBD_READ_MODES = ['01', '02', '03', '06', '07', '09', '0A'];
export const UDS_READ_SERVICES = ['19', '22'];
export const EXACT_ALLOWED = ['1001'];
export const CLEAR_SERVICES = ['04', '14'];
export const AT_PATTERNS = [
  'Z', 'WS', 'D', 'I', '@1', 'RV', 'DP', 'DPN', 'PC',
  'E[01]', 'L[01]', 'S[01]', 'H[01]', 'M0', 'AT[012]',
  'ST[0-9A-F]{2}', 'SP[0-9A-C]', 'SPA[0-9A-C]', 'TP[0-9A-C]',
  'CAF[01]', 'CFC[01]', 'SH[0-9A-F]{3}', 'SH[0-9A-F]{6}',
  'CRA[0-9A-F]{3}', 'CRA', 'FCSH[0-9A-F]{3}', 'FCSD[0-9A-F]{2,10}', 'FCSM[012]',
  'CF[0-9A-F]{3}', 'CM[0-9A-F]{3}',
];
// --- SAFETY-RULES-END

const AT_RE = AT_PATTERNS.map((p) => new RegExp('^' + p + '$'));
const HEX_RE = /^(?:[0-9A-F]{2})+$/;

export class UnsafeCommand extends Error {}

export function normalize(cmd) {
  return String(cmd).replace(/\s+/g, '').toUpperCase();
}

/** Επιστρέφει την κανονικοποιημένη εντολή ή πετά UnsafeCommand. */
export function check(cmd, { allowClear = false } = {}) {
  const c = normalize(cmd);
  if (!c) throw new UnsafeCommand('κενή εντολή');
  if (c.startsWith('AT')) {
    if (AT_RE.some((r) => r.test(c.slice(2)))) return c;
    throw new UnsafeCommand(`η εντολή AT «${cmd}» δεν είναι στη whitelist`);
  }
  if (!HEX_RE.test(c)) throw new UnsafeCommand(`μη έγκυρη εντολή «${cmd}» (μόνο AT ή δεκαεξαδικά bytes)`);
  const svc = c.slice(0, 2);
  if (EXACT_ALLOWED.includes(c)) return c;
  if (OBD_READ_MODES.includes(svc) || UDS_READ_SERVICES.includes(svc)) return c;
  if (CLEAR_SERVICES.includes(svc)) {
    if (allowClear) return c;
    throw new UnsafeCommand('σβήσιμο κωδικών μόνο με ρητή επιβεβαίωση');
  }
  throw new UnsafeCommand(`η υπηρεσία 0x${svc} δεν επιτρέπεται (μόνο ανάγνωση)`);
}
