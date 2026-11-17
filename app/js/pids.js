// Αποκωδικοποίηση PID mode 01/02 (SAE J1979). d = πίνακας bytes δεδομένων (A, B, ...).

const u16 = (d) => d[0] * 256 + d[1];
const pct = (d) => (d[0] * 100) / 255;
const trim = (d) => (d[0] * 100) / 128 - 100;
const temp = (d) => d[0] - 40;

export const PIDS = {
  '04': { name: 'Φορτίο κινητήρα', unit: '%', f: pct, min: 0, max: 100 },
  '05': { name: 'Θερμ. ψυκτικού', unit: '°C', f: temp, min: -40, max: 130 },
  '06': { name: 'STFT B1', unit: '%', f: trim, min: -25, max: 25 },
  '07': { name: 'LTFT B1', unit: '%', f: trim, min: -25, max: 25 },
  '08': { name: 'STFT B2', unit: '%', f: trim, min: -25, max: 25 },
  '09': { name: 'LTFT B2', unit: '%', f: trim, min: -25, max: 25 },
  '0B': { name: 'MAP', unit: 'kPa', f: (d) => d[0], min: 0, max: 110 },
  '0C': { name: 'Στροφές', unit: 'rpm', f: (d) => u16(d) / 4, min: 0, max: 10000, dec: 0 },
  '0D': { name: 'Ταχύτητα', unit: 'km/h', f: (d) => d[0], min: 0, max: 200, dec: 0 },
  '0E': { name: 'Προπορεία', unit: '°', f: (d) => d[0] / 2 - 64, min: -20, max: 50 },
  '0F': { name: 'Θερμ. αέρα εισαγ.', unit: '°C', f: temp, min: -40, max: 100 },
  '10': { name: 'MAF', unit: 'g/s', f: (d) => u16(d) / 100, min: 0, max: 50 },
  '11': { name: 'Πεταλούδα', unit: '%', f: pct, min: 0, max: 100 },
  '14': { name: 'Λάμδα B1S1', unit: 'V', f: (d) => d[0] / 200, min: 0, max: 1.1, dec: 2 },
  '15': { name: 'Λάμδα B1S2', unit: 'V', f: (d) => d[0] / 200, min: 0, max: 1.1, dec: 2 },
  '1F': { name: 'Χρόνος λειτουργίας', unit: 's', f: u16, min: 0, max: 3600, dec: 0 },
  '21': { name: 'Απόσταση με MIL', unit: 'km', f: u16, dec: 0 },
  '2E': { name: 'EVAP purge (εντολή)', unit: '%', f: pct, min: 0, max: 100 },
  '2F': { name: 'Στάθμη καυσίμου', unit: '%', f: pct, min: 0, max: 100 },
  '30': { name: 'Warm-ups από σβήσιμο', unit: '', f: (d) => d[0], dec: 0 },
  '31': { name: 'Απόσταση από σβήσιμο DTC', unit: 'km', f: u16, dec: 0 },
  '33': { name: 'Βαρομετρική', unit: 'kPa', f: (d) => d[0], dec: 0 },
  '42': { name: 'Τάση ECU', unit: 'V', f: (d) => u16(d) / 1000, min: 10, max: 16, dec: 2 },
  '43': { name: 'Απόλυτο φορτίο', unit: '%', f: (d) => (u16(d) * 100) / 255, min: 0, max: 100 },
  '46': { name: 'Θερμ. περιβάλλοντος', unit: '°C', f: temp },
  '4D': { name: 'Χρόνος με MIL', unit: 'min', f: u16, dec: 0 },
  '5C': { name: 'Θερμ. λαδιού', unit: '°C', f: temp, min: -40, max: 150 },
};

export const LIVE_DEFAULT = ['0C', '05', '0F', '04', '11', '0B', '06', '07', '0E', '14', '15', '0D', '42'];

export function decodePid(pid, data) {
  const p = PIDS[pid];
  if (!p || !data) return null;
  try {
    const v = p.f(data);
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

export function formatValue(pid, v) {
  if (v == null) return '—';
  const dec = PIDS[pid]?.dec ?? 1;
  return v.toFixed(dec);
}

/** Αποκωδικοποίηση ζευγών bytes DTC σε κωδικούς τύπου P0123. */
export function decodeDtcs(bytes) {
  const out = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const a = bytes[i];
    const b = bytes[i + 1];
    if (a === 0 && b === 0) continue;
    out.push('PCBU'[a >> 6] + ((a >> 4) & 3) + (a & 0x0f).toString(16).toUpperCase()
      + b.toString(16).toUpperCase().padStart(2, '0'));
  }
  return out;
}
