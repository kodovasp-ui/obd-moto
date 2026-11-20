// Αποκωδικοποίηση PID mode 01/02 (SAE J1979). d = πίνακας bytes δεδομένων (A, B, ...).
//
// Κάθε PID έχει kind:
//   'num'  (προεπιλογή) → αριθμητική τιμή, μπαίνει σε κάρτα/γράφημα/CSV
//   'enum' → κατάσταση σε κείμενο (π.χ. βρόχος καυσίμου)
//   'raw'  → δεν γνωρίζουμε σίγουρα τον τύπο· δείχνουμε τα bytes όπως ήρθαν
// Ό,τι δεν γνωρίζουμε το δείχνουμε ως raw αντί να βγάλουμε λάθος νούμερο.

const u16 = (d) => d[0] * 256 + d[1];
const s16 = (d) => {
  const v = u16(d);
  return v > 32767 ? v - 65536 : v;
};
const u16at = (d, i) => d[i] * 256 + d[i + 1];
const pct = (d) => (d[0] * 100) / 255;
const trim = (d) => (d[0] * 100) / 128 - 100;
const pct128 = (d) => d[0] / 1.28 - 100;
const temp = (d) => d[0] - 40;
const tempAt = (d, i) => d[i] - 40;
const torque = (d) => d[0] - 125;

// Ομάδες για την επιλογή PID στο UI.
export const GROUPS = {
  eng: 'Κινητήρας',
  fuel: 'Καύσιμο & μείγμα',
  air: 'Αέρας & εισαγωγή',
  o2: 'Αισθητήρες λάμδα',
  exh: 'Καυσαέρια & καταλύτης',
  turbo: 'Υπερπλήρωση',
  dsl: 'Diesel / DPF / SCR',
  hev: 'Υβριδικό / μπαταρία',
  sys: 'Κατάσταση & μετρητές',
};

// Λεκτικά για PID κατάστασης.
const FUEL_SYS = {
  0: 'εκτός λειτουργίας', 1: 'open loop (κρύος)', 2: 'closed loop (λάμδα)',
  4: 'open loop (φορτίο/επιβράδυνση)', 8: 'open loop (βλάβη)', 16: 'closed loop με σφάλμα',
};
const FUEL_TYPE = {
  0: 'δεν υπάρχει', 1: 'βενζίνη', 2: 'μεθανόλη', 3: 'αιθανόλη', 4: 'diesel', 5: 'LPG',
  6: 'CNG', 7: 'προπάνιο', 8: 'ηλεκτρικό', 9: 'διθέσιο βενζίνη/CNG', 10: 'υβριδικό βενζίνη',
  11: 'υβριδικό αιθανόλη', 12: 'υβριδικό diesel', 13: 'υβριδικό ηλεκτρικό',
  14: 'υβριδικό μικτό', 15: 'υβριδικό αναγεννητικό',
};
const OBD_STD = {
  1: 'OBD-II (CARB)', 2: 'OBD (EPA)', 3: 'OBD & OBD-II', 4: 'OBD-I', 5: 'χωρίς OBD',
  6: 'EOBD', 7: 'EOBD & OBD-II', 8: 'EOBD & OBD', 9: 'EOBD, OBD & OBD-II',
  10: 'JOBD', 11: 'JOBD & OBD-II', 12: 'JOBD & EOBD', 13: 'JOBD, EOBD & OBD-II',
  17: 'EMD', 18: 'EMD+', 19: 'HD OBD-C', 20: 'HD OBD', 21: 'WWH-OBD',
  23: 'HD EOBD-I', 24: 'HD EOBD-I N', 25: 'HD EOBD-II', 26: 'HD EOBD-II N',
  28: 'OBDBr-1', 29: 'OBDBr-2', 30: 'KOBD', 31: 'IOBD-I', 32: 'IOBD-II', 33: 'HD EOBD-IV',
};
const enumOf = (map) => (d) => map[d[0]] ?? `κωδ. ${d[0]}`;

// Λάμδα wideband: equivalence ratio από τα δύο πρώτα bytes.
const lambda = (d) => u16(d) / 32768;

export const PIDS = {
  '03': { name: 'Βρόχος καυσίμου', g: 'fuel', kind: 'enum', f: enumOf(FUEL_SYS) },
  '04': { name: 'Φορτίο κινητήρα', unit: '%', g: 'eng', f: pct, min: 0, max: 100 },
  '05': { name: 'Θερμ. ψυκτικού', unit: '°C', g: 'eng', f: temp, min: -40, max: 130 },
  '06': { name: 'STFT B1', unit: '%', g: 'fuel', f: trim, min: -25, max: 25 },
  '07': { name: 'LTFT B1', unit: '%', g: 'fuel', f: trim, min: -25, max: 25 },
  '08': { name: 'STFT B2', unit: '%', g: 'fuel', f: trim, min: -25, max: 25 },
  '09': { name: 'LTFT B2', unit: '%', g: 'fuel', f: trim, min: -25, max: 25 },
  '0A': { name: 'Πίεση καυσίμου', unit: 'kPa', g: 'fuel', f: (d) => d[0] * 3, min: 0, max: 765 },
  '0B': { name: 'MAP', unit: 'kPa', g: 'air', f: (d) => d[0], min: 0, max: 255 },
  '0C': { name: 'Στροφές', unit: 'rpm', g: 'eng', f: (d) => u16(d) / 4, min: 0, max: 10000, dec: 0 },
  '0D': { name: 'Ταχύτητα', unit: 'km/h', g: 'eng', f: (d) => d[0], min: 0, max: 255, dec: 0 },
  '0E': { name: 'Προπορεία', unit: '°', g: 'eng', f: (d) => d[0] / 2 - 64, min: -20, max: 50 },
  '0F': { name: 'Θερμ. αέρα εισαγ.', unit: '°C', g: 'air', f: temp, min: -40, max: 100 },
  '10': { name: 'MAF', unit: 'g/s', g: 'air', f: (d) => u16(d) / 100, min: 0, max: 100 },
  '11': { name: 'Πεταλούδα', unit: '%', g: 'air', f: pct, min: 0, max: 100 },
  '12': { name: 'Δευτ. αέρας', g: 'exh', kind: 'enum', f: enumOf({ 1: 'upstream', 2: 'downstream', 4: 'ατμόσφαιρα/off', 8: 'διάγνωση' }) },
  '13': { name: 'Παρόντες αισθ. λάμδα (2 bank)', g: 'o2', kind: 'raw' },
  '14': { name: 'Λάμδα B1S1', unit: 'V', g: 'o2', f: (d) => d[0] / 200, min: 0, max: 1.275, dec: 3 },
  '15': { name: 'Λάμδα B1S2', unit: 'V', g: 'o2', f: (d) => d[0] / 200, min: 0, max: 1.275, dec: 3 },
  '16': { name: 'Λάμδα B1S3', unit: 'V', g: 'o2', f: (d) => d[0] / 200, min: 0, max: 1.275, dec: 3 },
  '17': { name: 'Λάμδα B1S4', unit: 'V', g: 'o2', f: (d) => d[0] / 200, min: 0, max: 1.275, dec: 3 },
  '18': { name: 'Λάμδα B2S1', unit: 'V', g: 'o2', f: (d) => d[0] / 200, min: 0, max: 1.275, dec: 3 },
  '19': { name: 'Λάμδα B2S2', unit: 'V', g: 'o2', f: (d) => d[0] / 200, min: 0, max: 1.275, dec: 3 },
  '1A': { name: 'Λάμδα B2S3', unit: 'V', g: 'o2', f: (d) => d[0] / 200, min: 0, max: 1.275, dec: 3 },
  '1B': { name: 'Λάμδα B2S4', unit: 'V', g: 'o2', f: (d) => d[0] / 200, min: 0, max: 1.275, dec: 3 },
  '1C': { name: 'Πρότυπο OBD', g: 'sys', kind: 'enum', f: enumOf(OBD_STD) },
  '1D': { name: 'Παρόντες αισθ. λάμδα (4 bank)', g: 'o2', kind: 'raw' },
  '1E': { name: 'Βοηθητική είσοδος', g: 'sys', kind: 'enum', f: (d) => (d[0] & 1 ? 'PTO ενεργό' : 'PTO ανενεργό') },
  '1F': { name: 'Χρόνος λειτουργίας', unit: 's', g: 'sys', f: u16, min: 0, max: 3600, dec: 0 },
  '21': { name: 'Απόσταση με MIL', unit: 'km', g: 'sys', f: u16, dec: 0 },
  '22': { name: 'Πίεση ράμπας (σχετ.)', unit: 'kPa', g: 'fuel', f: (d) => u16(d) * 0.079, dec: 1 },
  '23': { name: 'Πίεση ράμπας (gauge)', unit: 'kPa', g: 'fuel', f: (d) => u16(d) * 10, dec: 0 },
  '24': { name: 'λ B1S1 (wideband)', unit: 'λ', g: 'o2', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '25': { name: 'λ B1S2 (wideband)', unit: 'λ', g: 'o2', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '26': { name: 'λ B1S3 (wideband)', unit: 'λ', g: 'o2', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '27': { name: 'λ B1S4 (wideband)', unit: 'λ', g: 'o2', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '28': { name: 'λ B2S1 (wideband)', unit: 'λ', g: 'o2', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '29': { name: 'λ B2S2 (wideband)', unit: 'λ', g: 'o2', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '2A': { name: 'λ B2S3 (wideband)', unit: 'λ', g: 'o2', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '2B': { name: 'λ B2S4 (wideband)', unit: 'λ', g: 'o2', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '2C': { name: 'EGR (εντολή)', unit: '%', g: 'exh', f: pct, min: 0, max: 100 },
  '2D': { name: 'Σφάλμα EGR', unit: '%', g: 'exh', f: pct128, min: -100, max: 100 },
  '2E': { name: 'EVAP purge (εντολή)', unit: '%', g: 'fuel', f: pct, min: 0, max: 100 },
  '2F': { name: 'Στάθμη καυσίμου', unit: '%', g: 'fuel', f: pct, min: 0, max: 100 },
  '30': { name: 'Warm-ups από σβήσιμο', unit: '', g: 'sys', f: (d) => d[0], dec: 0 },
  '31': { name: 'Απόσταση από σβήσιμο DTC', unit: 'km', g: 'sys', f: u16, dec: 0 },
  '32': { name: 'Πίεση ατμών EVAP', unit: 'Pa', g: 'fuel', f: (d) => s16(d) / 4, dec: 1 },
  '33': { name: 'Βαρομετρική', unit: 'kPa', g: 'air', f: (d) => d[0], dec: 0 },
  '34': { name: 'λ B1S1 (ρεύμα)', unit: 'λ', g: 'o2', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '35': { name: 'λ B1S2 (ρεύμα)', unit: 'λ', g: 'o2', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '36': { name: 'λ B1S3 (ρεύμα)', unit: 'λ', g: 'o2', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '37': { name: 'λ B1S4 (ρεύμα)', unit: 'λ', g: 'o2', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '38': { name: 'λ B2S1 (ρεύμα)', unit: 'λ', g: 'o2', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '39': { name: 'λ B2S2 (ρεύμα)', unit: 'λ', g: 'o2', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '3A': { name: 'λ B2S3 (ρεύμα)', unit: 'λ', g: 'o2', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '3B': { name: 'λ B2S4 (ρεύμα)', unit: 'λ', g: 'o2', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '3C': { name: 'Θερμ. καταλύτη B1S1', unit: '°C', g: 'exh', f: (d) => u16(d) / 10 - 40, min: 0, max: 900 },
  '3D': { name: 'Θερμ. καταλύτη B2S1', unit: '°C', g: 'exh', f: (d) => u16(d) / 10 - 40, min: 0, max: 900 },
  '3E': { name: 'Θερμ. καταλύτη B1S2', unit: '°C', g: 'exh', f: (d) => u16(d) / 10 - 40, min: 0, max: 900 },
  '3F': { name: 'Θερμ. καταλύτη B2S2', unit: '°C', g: 'exh', f: (d) => u16(d) / 10 - 40, min: 0, max: 900 },
  '42': { name: 'Τάση ECU', unit: 'V', g: 'sys', f: (d) => u16(d) / 1000, min: 10, max: 16, dec: 2 },
  '43': { name: 'Απόλυτο φορτίο', unit: '%', g: 'eng', f: (d) => (u16(d) * 100) / 255, min: 0, max: 100 },
  '44': { name: 'λ (εντολή)', unit: 'λ', g: 'fuel', f: lambda, min: 0.7, max: 1.3, dec: 3 },
  '45': { name: 'Πεταλούδα (σχετική)', unit: '%', g: 'air', f: pct, min: 0, max: 100 },
  '46': { name: 'Θερμ. περιβάλλοντος', unit: '°C', g: 'sys', f: temp },
  '47': { name: 'Πεταλούδα B', unit: '%', g: 'air', f: pct, min: 0, max: 100 },
  '48': { name: 'Πεταλούδα C', unit: '%', g: 'air', f: pct, min: 0, max: 100 },
  '49': { name: 'Πεντάλ γκαζιού D', unit: '%', g: 'air', f: pct, min: 0, max: 100 },
  '4A': { name: 'Πεντάλ γκαζιού E', unit: '%', g: 'air', f: pct, min: 0, max: 100 },
  '4B': { name: 'Πεντάλ γκαζιού F', unit: '%', g: 'air', f: pct, min: 0, max: 100 },
  '4C': { name: 'Πεταλούδα (ενεργοπ.)', unit: '%', g: 'air', f: pct, min: 0, max: 100 },
  '4D': { name: 'Χρόνος με MIL', unit: 'min', g: 'sys', f: u16, dec: 0 },
  '4E': { name: 'Χρόνος από σβήσιμο DTC', unit: 'min', g: 'sys', f: u16, dec: 0 },
  '4F': { name: 'Μέγιστες τιμές (λ/V/mA/MAP)', g: 'sys', kind: 'raw' },
  '50': { name: 'Μέγιστο MAF', unit: 'g/s', g: 'air', f: (d) => d[0] * 10, dec: 0 },
  '51': { name: 'Τύπος καυσίμου', g: 'fuel', kind: 'enum', f: enumOf(FUEL_TYPE) },
  '52': { name: 'Αιθανόλη', unit: '%', g: 'fuel', f: pct, min: 0, max: 100 },
  '53': { name: 'Απόλ. πίεση ατμών EVAP', unit: 'kPa', g: 'fuel', f: (d) => u16(d) / 200, dec: 2 },
  '54': { name: 'Πίεση ατμών EVAP (προσ.)', unit: 'Pa', g: 'fuel', f: s16, dec: 0 },
  '55': { name: 'Δευτ. STFT B1', unit: '%', g: 'fuel', f: pct128, min: -100, max: 100 },
  '56': { name: 'Δευτ. LTFT B1', unit: '%', g: 'fuel', f: pct128, min: -100, max: 100 },
  '57': { name: 'Δευτ. STFT B2', unit: '%', g: 'fuel', f: pct128, min: -100, max: 100 },
  '58': { name: 'Δευτ. LTFT B2', unit: '%', g: 'fuel', f: pct128, min: -100, max: 100 },
  '59': { name: 'Απόλ. πίεση ράμπας', unit: 'kPa', g: 'fuel', f: (d) => u16(d) * 10, dec: 0 },
  '5A': { name: 'Σχετικό πεντάλ γκαζιού', unit: '%', g: 'air', f: pct, min: 0, max: 100 },
  '5B': { name: 'Υπόλοιπο ζωής μπαταρίας', unit: '%', g: 'hev', f: pct, min: 0, max: 100 },
  '5C': { name: 'Θερμ. λαδιού', unit: '°C', g: 'eng', f: temp, min: -40, max: 150 },
  '5D': { name: 'Χρονισμός ψεκασμού', unit: '°', g: 'fuel', f: (d) => u16(d) / 128 - 210, dec: 1 },
  '5E': { name: 'Κατανάλωση καυσίμου', unit: 'L/h', g: 'fuel', f: (d) => u16(d) / 20, dec: 2 },
  '5F': { name: 'Απαιτήσεις εκπομπών', g: 'sys', kind: 'enum', f: enumOf({ 14: 'Euro IV/V (βαρέα)', 15: 'Euro VI (βαρέα)' }) },
  '61': { name: 'Ζητούμενη ροπή', unit: '%', g: 'eng', f: torque, min: -125, max: 130 },
  '62': { name: 'Πραγματική ροπή', unit: '%', g: 'eng', f: torque, min: -125, max: 130 },
  '63': { name: 'Ροπή αναφοράς', unit: 'Nm', g: 'eng', f: u16, dec: 0 },
  '64': { name: 'Ροπή (ρελαντί/σημεία)', g: 'eng', kind: 'raw' },
  '65': { name: 'Βοηθητικές είσοδοι/έξοδοι', g: 'sys', kind: 'raw' },
  '66': { name: 'MAF αισθ. A', unit: 'g/s', g: 'air', f: (d) => u16at(d, 1) / 32, dec: 2 },
  '67': { name: 'Θερμ. ψυκτικού 1', unit: '°C', g: 'eng', f: (d) => tempAt(d, 1), min: -40, max: 130 },
  '68': { name: 'Θερμ. αέρα αισθ. 1', unit: '°C', g: 'air', f: (d) => tempAt(d, 1), min: -40, max: 100 },
  '69': { name: 'EGR (εντολή/πραγμ.)', g: 'exh', kind: 'raw' },
  '6A': { name: 'Ροή αέρα diesel (εντολή)', g: 'dsl', kind: 'raw' },
  '6B': { name: 'Θερμ. EGR B1S1', unit: '°C', g: 'exh', f: (d) => tempAt(d, 1), min: -40, max: 500 },
  '6C': { name: 'Πεταλούδα (εντολή/θέση)', g: 'air', kind: 'raw' },
  '6D': { name: 'Έλεγχος πίεσης καυσίμου', g: 'fuel', kind: 'raw' },
  '6E': { name: 'Έλεγχος πίεσης ψεκασμού', g: 'fuel', kind: 'raw' },
  '6F': { name: 'Πίεση εισόδου συμπιεστή', g: 'turbo', kind: 'raw' },
  '70': { name: 'Έλεγχος πίεσης υπερπλήρωσης', g: 'turbo', kind: 'raw' },
  '71': { name: 'Έλεγχος VGT', g: 'turbo', kind: 'raw' },
  '72': { name: 'Έλεγχος wastegate', g: 'turbo', kind: 'raw' },
  '73': { name: 'Πίεση καυσαερίων', g: 'exh', kind: 'raw' },
  '74': { name: 'Στροφές turbo', unit: 'rpm', g: 'turbo', f: (d) => u16at(d, 1), dec: 0 },
  '75': { name: 'Θερμ. turbo A', g: 'turbo', kind: 'raw' },
  '76': { name: 'Θερμ. turbo B', g: 'turbo', kind: 'raw' },
  '77': { name: 'Θερμ. intercooler', unit: '°C', g: 'turbo', f: (d) => tempAt(d, 1), min: -40, max: 200 },
  '78': { name: 'Θερμ. καυσαερίων B1', unit: '°C', g: 'exh', f: (d) => u16at(d, 1) / 10 - 40, min: 0, max: 1000 },
  '79': { name: 'Θερμ. καυσαερίων B2', unit: '°C', g: 'exh', f: (d) => u16at(d, 1) / 10 - 40, min: 0, max: 1000 },
  '7A': { name: 'DPF B1 (πιέσεις)', g: 'dsl', kind: 'raw' },
  '7B': { name: 'DPF B2 (πιέσεις)', g: 'dsl', kind: 'raw' },
  '7C': { name: 'Θερμ. DPF', unit: '°C', g: 'dsl', f: (d) => u16at(d, 1) / 10 - 40, min: 0, max: 900 },
  '7D': { name: 'Κατάσταση NOx NTE', g: 'dsl', kind: 'raw' },
  '7E': { name: 'Κατάσταση PM NTE', g: 'dsl', kind: 'raw' },
  '7F': { name: 'Χρόνοι λειτουργίας', g: 'sys', kind: 'raw' },
  '81': { name: 'Χρόνος AECD #1', g: 'sys', kind: 'raw' },
  '82': { name: 'Χρόνος AECD #2', g: 'sys', kind: 'raw' },
  '83': { name: 'NOx αισθ. 1', unit: 'ppm', g: 'dsl', f: (d) => u16at(d, 1), dec: 0 },
  '84': { name: 'Θερμ. πολλαπλής', unit: '°C', g: 'air', f: temp, min: -40, max: 200 },
  '85': { name: 'Σύστημα AdBlue', g: 'dsl', kind: 'raw' },
  '86': { name: 'Αισθ. σωματιδίων', g: 'dsl', kind: 'raw' },
  '87': { name: 'Απόλ. πίεση πολλαπλής', g: 'air', kind: 'raw' },
  '8E': { name: 'Ροπή τριβών', unit: '%', g: 'eng', f: torque, min: -125, max: 130 },
  '9A': { name: 'Δεδομένα υβριδικού/EV', g: 'hev', kind: 'raw' },
  '9B': { name: 'Αισθ. AdBlue', g: 'dsl', kind: 'raw' },
  '9D': { name: 'Παροχή καυσίμου', g: 'fuel', kind: 'raw' },
  '9E': { name: 'Παροχή καυσαερίων', g: 'exh', kind: 'raw' },
  '9F': { name: 'Χρήση συστήματος καυσίμου', g: 'fuel', kind: 'raw' },
  A2: { name: 'Παροχή/κύλινδρο', unit: 'mg/stroke', g: 'fuel', f: (d) => u16(d) / 32, dec: 2 },
  A4: { name: 'Σχέση σασμάν', unit: '', g: 'eng', f: (d) => u16at(d, 1) / 1000, dec: 3 },
  A5: { name: 'Δοσομέτρηση AdBlue', g: 'dsl', kind: 'raw' },
  A6: { name: 'Χιλιόμετρα', unit: 'km', g: 'sys', f: (d) => ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) / 10, dec: 0 },
  B2: { name: 'Τάση/ρεύμα μπαταρίας', g: 'hev', kind: 'raw' },
};

/** Προεπιλεγμένες κάρτες, σε σειρά προτίμησης — κρατάμε όσες υποστηρίζει το όχημα. */
export const LIVE_DEFAULT = ['0C', '05', '0F', '04', '11', '0B', '06', '07', '0E', '14', '15', '0D', '42'];

/** Εφεδρική σειρά προτεραιότητας, αν το όχημα δεν υποστηρίζει τις προεπιλογές. */
const PRIORITY = [
  '0C', '0D', '05', '04', '11', '0B', '10', '0F', '0E', '06', '07', '14', '24', '2F',
  '42', '5C', '43', '33', '46', '45', '5E', '3C', '2C', '74', '7C', '83', '5B', '1F',
];

export const PID_KEYS = Object.keys(PIDS);

// PID υποδομής: bitmap υποστήριξης και κατάσταση monitors — τα χειρίζεται αλλού η εφαρμογή.
const META_PIDS = ['00', '01', '02', '20', '40', '60', '80', 'A0', 'C0'];
export const isMeta = (pid) => META_PIDS.includes(pid);

export const isNumeric = (pid) => !isMeta(pid) && (PIDS[pid]?.kind ?? 'num') === 'num';

export function pidName(pid) {
  return PIDS[pid]?.name || `Άγνωστο PID ${pid}`;
}

/**
 * Ποιες κάρτες να δείξουμε για ένα όχημα.
 * Κρατά τις προεπιλογές που υποστηρίζονται· αν βγουν λίγες, συμπληρώνει από το PRIORITY.
 */
export function defaultLivePids(supported, want = 8) {
  const ok = (p) => supported.includes(p) && isNumeric(p);
  const out = LIVE_DEFAULT.filter(ok);
  if (out.length < want) {
    for (const p of PRIORITY) {
      if (out.length >= want) break;
      if (ok(p) && !out.includes(p)) out.push(p);
    }
  }
  // Τελευταία επιλογή: ό,τι αριθμητικό υποστηρίζεται, με σειρά PID.
  if (!out.length) return supported.filter(isNumeric).slice(0, want);
  return out;
}

export function decodePid(pid, data) {
  const p = PIDS[pid];
  if (!p || !data || !isNumeric(pid)) return null;
  try {
    const v = p.f(data);
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

/** Κείμενο για PID κατάστασης ή άγνωστο/raw PID. */
export function describePid(pid, data) {
  if (!data || !data.length) return '—';
  const hex = Array.from(data).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  const p = PIDS[pid];
  if (p?.kind === 'enum') {
    try { return String(p.f(data)); } catch { return hex; }
  }
  return hex;
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
