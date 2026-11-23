// Προσομοιωτής ELM327 + ECU μονοκύλινδρης/δικύλινδρης μοτοσυκλέτας για δοκιμές χωρίς μοτό.
// Ίδιο interface με BleTransport. Οι τιμές βασίζονται σε πραγματικές μετρήσεις (docs/samples).

// Τι δηλώνει η «ECU» του προσομοιωτή. Απλώνεται σε 4 περιοχές (00/20/40/60) ώστε
// να δοκιμάζεται η ανακάλυψη PID σε πολλά bitmap, όπως σε αυτοκίνητο.
const SUPPORTED_01 = [
  // 01-20
  '01', '03', '04', '05', '06', '07', '08', '09', '0A', '0B', '0C', '0D', '0E', '0F', '10', '11',
  '12', '13', '14', '15', '18', '1C', '1F', '20',
  // 21-40
  '21', '24', '2C', '2E', '2F', '30', '31', '33', '34', '3C', '40',
  // 41-60
  '42', '43', '44', '45', '46', '47', '49', '4C', '4D', '4E', '51', '52', '5C', '5E', '60',
  // 61-80
  '61', '62', '63', '66', '67', '68', '78', '7C',
];
const SUPPORTED_02 = ['02', '04', '05', '06', '07', '0B', '0C', '0D', '0E', '0F', '11'];

// Mode 06 — on-board tests. Κάθε εγγραφή: [TID, UASID, τιμή, min, max].
// Οι τιμές είναι στην ωμή μορφή που στέλνει η ECU (πριν τον πολλαπλασιαστή).
// Τα bitmap 20/40/60/80/A0 είναι η «αλυσίδα» συνέχειας ως το A1.
const SUPPORTED_06 = ['01', '20', '21', '31', '40', '60', '80', 'A0', 'A1', 'A2'];
const TESTS_06 = {
  '01': [            // Αισθητήρας λάμδα B1S1
    [0x01, 0x0c, 45, 40, 50],    // τάση μετάβασης πλούσιο→φτωχό, 0.01 V
    [0x05, 0x10, 120, 0, 200],   // χρόνος απόκρισης, ms
    [0x07, 0x3d, 1234, 0, 5000], // άγνωστο UASID → δείχνεται ωμό
  ],
  21: [[0x01, 0x0f, 120, 50, 200]],            // ρεύμα θέρμανσης, 0.01 A
  31: [                                         // Καταλύτης Bank 1
    [0x80, 0x24, 920, 0, 1000],                 // περνά, αλλά οριακά
    [0x81, 0x03, 105, 0, 75],                   // ΑΠΟΤΥΓΧΑΝΕΙ
  ],
  A1: [[0x0b, 0x24, 3, 0, 200]],                // misfire γενικά
  A2: [[0x0b, 0x24, 1, 0, 200]],                // misfire κυλίνδρου 1
};
const VIN = 'SIMDEMO0000000001';

// Μονάδες του «οχήματος» για δοκιμή της σάρωσης. dtc = [b0, b1, failureType, status].
// Status: 0x08 επιβεβαιωμένος, 0x04 εκκρεμής, 0x89 επιβεβαιωμένος + ζητά λυχνία.
const SIM_ECUS = {
  '7E0': {
    resp: '7E8', engine: true, name: 'ECM-MSE60',
    ids: { F197: 'ECM-MSE60', F18C: 'SN7E0-00042', F187: '0261S23451' },
    dtcs: [[0x00, 0x53, 0x00, 0x89], [0x01, 0x31, 0x1a, 0x04]], // P0053-00, P0131-1A
  },
  '7E1': {
    resp: '7E9', name: 'TCM-SIM',
    ids: { F197: 'TCM-SIM', F18C: 'SN7E1-00013', F187: '0260S55512' },
    dtcs: [],
  },
  714: {
    resp: '71C', name: 'ABS-SIM',
    ids: { F197: 'ABS-SIM', F18C: 'SNABS-00777', F187: '0265S41200' },
    dtcs: [[0x50, 0x95, 0x08, 0x08]], // C1095-08
    // Ζωντανά δεδομένα κατασκευαστή: ταχύτητες τροχών και πίεση φρένου.
    live: {
      1000: (s) => w16(s.speed * 100),
      1001: (s) => w16(s.speed * 100 + (s.speed > 5 ? 7 : 0)),
      1002: (s) => w16(s.speed * 100),
      1003: (s) => w16(s.speed * 100 - (s.speed > 5 ? 11 : 0)),
      1010: (s) => [Math.round(s.speed > 60 ? 12 : 2)],
    },
    statics: { 1100: 'ABS-CFG-01' },
    secure: ['F1A0'],
  },
  715: {
    resp: '71D', name: 'SRS-SIM',
    ids: { F197: 'SRS-SIM', F18C: 'SNSRS-00901', F187: '0285S10033' },
    dtcs: [],
    statics: { 2000: [0x00], 2001: 'SRS-REV-C' },
    secure: ['F1A0', 'F1A1'],
  },
  720: {
    resp: '728', name: 'IPC-SIM',
    ids: { F197: 'IPC-SIM', F18C: 'SNIPC-00120', F187: '0263S70901' },
    dtcs: [[0xc1, 0x01, 0x00, 0x08]], // U0101-00
    live: {
      '0100': (s) => [0, 0, ...w16(14230 + Math.round(s.t))], // χιλιόμετρα
      '0101': (s) => [Math.round(78 - s.t / 10)],             // στάθμη καυσίμου %
    },
  },
  '18DA10F1': {
    resp: '18DAF110', engine: true, name: 'ECM-MSE60',
    ids: { F197: 'ECM-MSE60', F18C: 'SN7E0-00042', F187: '0261S23451' },
    dtcs: [[0x00, 0x53, 0x00, 0x89]],
  },
};
// Πρωτόκολλα που μπορεί να προσποιηθεί ο προσομοιωτής (αριθμός ELM → όνομα ATDP).
// Στα non-CAN οι μονάδες πέρα από τον κινητήρα δεν απαντούν, όπως στην πραγματικότητα.
// autoOk: αν η αυτόματη ανίχνευση (ATSP0) πετυχαίνει. Στο KWP την αφήνουμε να
// αποτυγχάνει επίτηδες — έτσι συμπεριφέρονται πολλοί φτηνοί adapter σε non-CAN,
// και δοκιμάζεται η σάρωση πρωτοκόλλων ένα-ένα.
const SIM_PROTO = {
  3: { name: 'ISO 9141-2', autoOk: true },
  5: { name: 'ISO 14230-4 KWP (fast init)', autoOk: false },
  6: { name: 'ISO 15765-4 (CAN 11/500)', autoOk: true },
  A: { name: 'SAE J1939 (CAN 29-bit/250k)', autoOk: false },
};

// Δύο ενεργοί κωδικοί J1939 (DM1, PGN FECA) για δοκιμή: SPN 110 θερμ. ψυκτικού
// «πολύ ψηλά» (FMI 0) και SPN 100 πίεση λαδιού «πολύ χαμηλά» (FMI 1). Το byte 0x04
// = κίτρινη προειδοποιητική λυχνία αναμμένη.
const SIM_DM1 = '18FECA00 04 FF 6E 00 00 03 FF FF\r18FECA00 04 FF 64 00 01 02 FF FF';

const STORED = [0x05, 0x62]; // P0562 τάση συστήματος χαμηλή (demo)
const PENDING = [0x01, 0x31]; // P0131 λάμδα B1S1 χαμηλή τάση (demo)

const h2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).toUpperCase().padStart(2, '0');
const bytes = (...a) => a.flat().map(h2).join(' ');
// 16-bit big endian
const w16 = (v) => { const n = Math.max(0, Math.min(65535, Math.round(v))); return [(n >> 8) & 255, n & 255]; };

function bitmap(list, base) {
  let bits = 0;
  for (let n = 1; n <= 32; n++) {
    const pid = (base + n).toString(16).toUpperCase().padStart(2, '0');
    if (list.includes(pid)) bits |= 2 ** (32 - n);
  }
  return [(bits >>> 24) & 255, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255];
}

export class SimTransport {
  constructor() {
    this.onData = () => {};
    this.onDisconnect = () => {};
    this.name = 'Προσομοιωτής';
    this.t0 = performance.now();
    this.headers = false;
    this.cleared = false;
    this.hdr = '7DF'; // τρέχον ATSH
    // Ποιο πρωτόκολλο προσποιείται — ρυθμίζεται από τις Ρυθμίσεις για δοκιμές.
    try { this.proto = SIM_PROTO[localStorage.getItem('obd.sim.proto')] ? localStorage.getItem('obd.sim.proto') : '6'; } catch { this.proto = '6'; }
    this.spSet = false;    // έχει επιλεγεί σωστό πρωτόκολλο;
    this.wrongProto = false;
  }

  /** Εκτός CAN μιλάει μόνο ο κινητήρας — καμία UDS μονάδα, όπως στην πραγματικότητα. */
  get isCanSim() { return this.proto === '6'; }

  static isSupported() { return true; }
  async connect() { this.t0 = performance.now(); }
  async disconnect() { this.onDisconnect(); }

  async write(text) {
    const c = text.replace(/\s/g, '').toUpperCase();
    let reply = this.respond(c);
    // Με ATH1 ο ELM327 προθέτει το CAN ID του αποστολέα σε κάθε γραμμή.
    if (this.headers && !c.startsWith('AT')) {
      const id = this.target()?.resp;
      if (id) reply = reply.split('\r').map((l) => (l.trim() ? `${id} ${l.trim()}` : l)).join('\r');
    }
    setTimeout(() => this.onData(reply + '\r\r>'), 25 + Math.random() * 30);
  }

  /** Σε ποια μονάδα απευθύνεται το τρέχον ATSH. */
  target() {
    if (this.hdr === '7DF') return SIM_ECUS['7E0']; // functional broadcast → απαντά ο κινητήρας
    return SIM_ECUS[this.hdr] || null;
  }

  // Προφίλ δοκιμής: 0–12 s ρελαντί που ζεσταίνεται, 12–28 s επιτάχυνση από στάση
  // ως ~110 km/h, μετά ταξίδι με διακυμάνσεις. Έτσι δοκιμάζονται και οι μετρήσεις
  // ταξιδιού και επιδόσεων, όχι μόνο το ρελαντί.
  state() {
    const t = (performance.now() - this.t0) / 1000;
    const coolant = Math.min(92, 25 + t * 1.2);

    // 0–4 s κλειδί ON με σβηστό κινητήρα, 4–5.5 s μίζα: έτσι δοκιμάζεται και
    // ο έλεγχος μπαταρίας (τάση ηρεμίας και βύθισμα στη μίζα).
    const keyOn = t < 4;
    const cranking = t >= 4 && t < 5.5;

    let speed; let throttle; let load;
    if (t < 12) {                       // ρελαντί
      speed = 0; throttle = 6.7; load = 28 + Math.random();
    } else if (t < 28) {                // επιτάχυνση από στάση
      const a = (t - 12) / 16;
      speed = 110 * a * a ** 0.4;       // πιο αργή αρχή, όπως στην πραγματικότητα
      throttle = 62 + Math.random() * 6;
      load = 78 + Math.random() * 8;
    } else {                            // ταξίδι
      speed = 92 + Math.sin((t - 28) / 7) * 9;
      throttle = 16 + Math.sin((t - 28) / 7) * 4;
      load = 34 + Math.sin((t - 28) / 7) * 6;
    }
    speed = Math.max(0, Math.min(130, speed));
    const accel = t >= 12 && t < 28;
    let rpm = (speed > 1 ? 1500 + speed * 52 : 1500 + Math.max(0, 300 - t * 5))
      + (Math.random() - 0.5) * 120;
    if (keyOn) rpm = 0;
    else if (cranking) rpm = 240 + Math.random() * 40;
    const o2 = coolant > 50 ? (Math.sin(t * 6) > 0 ? 0.75 + Math.random() * 0.15 : 0.1 + Math.random() * 0.1) : 0.45;

    return {
      t, coolant, rpm, load, throttle, speed,
      map: accel ? 88 : speed > 1 ? 52 : 40,
      iat: 20 + t * 0.05,
      timing: accel ? 24 + Math.random() : speed > 1 ? 18 + Math.random() * 2 : 1 + Math.random() * 3.5,
      stft: coolant > 50 ? (Math.random() - 0.5) * 6 : 0, ltft: -2.3,
      o2a: o2,
      o2b: 0.78 + Math.random() * 0.03,
      // 12.6 V στην ηρεμία, βουτιά στη μίζα, μετά φόρτιση από τον αλτερνέιτορ.
      volt: keyOn ? 12.62 - Math.random() * 0.04
        : cranking ? 10.1 + Math.random() * 0.3
          : 14.1 + Math.random() * 0.25,
      maf: accel ? 28 + Math.random() * 3 : speed > 1 ? 9.5 + Math.random() : 2.5 + Math.random() * 0.3,
      lam: coolant > 50 ? (accel ? 0.9 : 1) + (Math.random() - 0.5) * 0.04 : 1.18,
      cat: Math.min(620, 30 + t * 11),
      egt: Math.min(520, 25 + t * 9),
      fuelRate: accel ? 13 + Math.random() : speed > 1 ? 4.6 + Math.random() * 0.4 : 0.9 + Math.random() * 0.1,
    };
  }

  /** UDS μόνο-ανάγνωσης: 10 01, 19 02 (κωδικοί), 22 (ταυτότητα). null = δεν το χειρίζομαι. */
  uds(c, ecu) {
    if (c === '1001') return '50 01 00 32 01 F4';
    if (c.startsWith('1902')) {
      if (!ecu.dtcs.length) return bytes(0x59, 0x02, 0xff);
      return bytes(0x59, 0x02, 0xff, ...ecu.dtcs.flat());
    }
    if (c.startsWith('19')) return '7F 19 12'; // subFunctionNotSupported
    if (c.startsWith('22')) {
      const did = c.slice(2, 6);
      const head = [0x62, parseInt(did.slice(0, 2), 16), parseInt(did.slice(2), 16)];
      const asBytes = (v) => (typeof v === 'string' ? [...v].map((ch) => ch.charCodeAt(0)) : v);

      if (ecu.ids[did]) return bytes(...head, asBytes(ecu.ids[did]));
      if (ecu.secure?.includes(did)) return '7F 22 33';  // securityAccessDenied
      if (ecu.statics?.[did]) return bytes(...head, asBytes(ecu.statics[did]));
      if (ecu.live?.[did]) return bytes(...head, ecu.live[did](this.state()));

      if (!ecu.engine) return '7F 22 31'; // requestOutOfRange
      return null; // ο κινητήρας έχει κι άλλα DID πιο κάτω
    }
    return null;
  }

  pid(pid, s) {
    const tr = (v) => (v + 100) * 1.28;
    switch (pid) {
      // MIL, πλήθος κωδικών, υποστηριζόμενα monitors, ποια είναι ΜΗ ολοκληρωμένα.
      // Μετά το σβήσιμο μηδενίζουν όλα· αλλιώς καταλύτης και λάμδα μένουν εκκρεμείς.
      case '01': return this.cleared ? bytes(0x00, 0x07, 0x65, 0x65) : bytes(0x81, 0x07, 0x65, 0x21);
      case '03': return bytes(coolantLoop(s), 0);
      case '04': return bytes(s.load * 2.55);
      case '05': return bytes(s.coolant + 40);
      case '06': case '08': return bytes(tr(s.stft));
      case '07': case '09': return bytes(tr(s.ltft));
      case '0A': return bytes(380 / 3);
      case '0B': return bytes(s.map);
      case '0C': return bytes(w16(s.rpm * 4));
      case '0D': return bytes(s.speed);
      case '0E': return bytes((s.timing + 64) * 2);
      case '0F': return bytes(s.iat + 40);
      case '10': return bytes(w16(s.maf * 100));
      case '11': return bytes(s.throttle * 2.55);
      case '12': return bytes(4); // ατμόσφαιρα / off
      case '13': return bytes(0x03);
      case '14': return bytes(s.o2a * 200, 0xff);
      case '15': return bytes(s.o2b * 200, 0xff);
      case '18': return bytes(0, 0xff);
      case '1C': return bytes(6); // EOBD
      case '1F': return bytes(w16(s.t));
      case '21': return bytes(0, this.cleared ? 0 : 12);
      case '24': return bytes(w16(s.lam * 32768), w16(s.o2a * 8192));
      case '2C': return bytes(0);
      case '2E': return bytes(0);
      case '2F': return bytes(0.62 * 255);
      case '30': return bytes(this.cleared ? 0 : 41);
      case '31': return bytes(0x1f, 0x59);
      case '33': return bytes(101);
      case '34': return bytes(w16(s.lam * 32768), w16((0.1 + 128) * 256));
      case '3C': return bytes(w16((s.cat + 40) * 10));
      case '42': return bytes(w16(s.volt * 1000));
      case '43': return bytes(w16(s.load * 2.55));
      case '44': return bytes(w16(32768), 0, 0);
      case '45': return bytes(s.throttle * 2.55);
      case '46': return bytes(18 + 40);
      case '47': return bytes(s.throttle * 2.55);
      case '49': return bytes(s.throttle * 2.2);
      case '4C': return bytes(s.throttle * 2.55);
      case '4D': return bytes(0, this.cleared ? 0 : 35);
      case '4E': return bytes(w16(this.cleared ? 0 : 1480));
      case '51': return bytes(1); // βενζίνη
      case '52': return bytes(0);
      case '5C': return bytes(Math.max(0, s.coolant - 8) + 40);
      case '5E': return bytes(w16(s.fuelRate * 20));
      case '61': return bytes(s.load * 0.9 + 125);
      case '62': return bytes(s.load + 125);
      case '63': return bytes(w16(44));
      case '66': return bytes(1, w16(s.maf * 32), 0, 0);
      case '67': return bytes(1, s.coolant + 40, 0);
      case '68': return bytes(1, s.iat + 40, 0);
      case '78': return bytes(1, w16((s.egt + 40) * 10), 0, 0, 0, 0, 0, 0);
      case '7C': return bytes(1, w16((s.cat + 40) * 10), 0, 0, 0, 0, 0, 0, 0);
      default: return null;
    }
  }

  respond(c) {
    if (c.startsWith('AT')) {
      const a = c.slice(2);
      if (a === 'Z' || a === 'WS') return '\rELM327 v2.1 (sim)';
      if (a === 'I') return 'ELM327 v2.1 (sim)';
      if (a === 'RV') return this.state().volt.toFixed(1) + 'V';
      // Το πρωτόκολλο του προσομοιωτή αλλάζει από τις Ρυθμίσεις, ώστε να
      // δοκιμάζεται και η συμπεριφορά σε οχήματα πριν το CAN.
      if (a === 'DP') return SIM_PROTO[this.proto].name;
      if (a === 'DPN') return (this.spSet ? '' : 'A') + this.proto;
      if (a === '@1') return 'SIMULATOR';
      // J1939: monitor ενεργών κωδικών (DM1). Μόνο όταν είμαστε σε protocol A.
      if (a === 'DM1') return this.proto === 'A' ? SIM_DM1 : 'NO DATA';
      if (a.startsWith('SP')) {
        // ATSPA (σκέτο) = protocol A, δηλ. J1939. ATSPA6 = auto+6. ATSP6 = protocol 6.
        const rest = a.slice(2);
        const n = rest === 'A' ? 'A' : (rest[0] === 'A' ? '0' : rest);
        // ATSP0 = αυτόματο: «πιάνει» μόνο αν το πρωτόκολλο το επιτρέπει.
        this.spSet = n === this.proto ? true : (n === '0' ? SIM_PROTO[this.proto].autoOk : false);
        this.wrongProto = n !== '0' && n !== this.proto;
        return 'OK';
      }
      if (a.startsWith('SH')) { this.hdr = a.slice(2); return 'OK'; }
      if (a.startsWith('H')) this.headers = a === 'H1';
      return 'OK';
    }

    // --- μονάδες πέρα από τον κινητήρα: μόνο UDS (10 01, 19 02, 22) όπως στην πραγματικότητα
    // Λάθος πρωτόκολλο ή αποτυχημένη αυτόματη ανίχνευση: ο δίαυλος σωπαίνει.
    if (this.wrongProto || !this.spSet) return 'UNABLE TO CONNECT';

    const ecu = this.target();
    if (!ecu) return 'NO DATA';
    // J1939: κανένα OBD mode / UDS στον δίαυλο — τα δεδομένα έρχονται μόνο με DM1 (AT).
    if (this.proto === 'A') return 'NO DATA';
    if (!this.isCanSim) {
      // ISO 9141-2 / KWP2000: μόνο τα OBD modes, καμία υπηρεσία UDS.
      if (!ecu.engine || /^(10|19|22)/.test(c)) return 'NO DATA';
    } else {
      if (!ecu.engine) return this.uds(c, ecu) ?? 'NO DATA';
      const udsReply = this.uds(c, ecu);
      if (udsReply) return udsReply;
    }

    const s = this.state();
    const mode = c.slice(0, 2);
    const pid = c.slice(2, 4);
    if (mode === '01') {
      if (['00', '20', '40', '60'].includes(pid)) return bytes(0x41, parseInt(pid, 16), ...bitmap(SUPPORTED_01, parseInt(pid, 16)));
      if (['80', 'A0', 'C0'].includes(pid)) return 'NO DATA';
      const d = this.pid(pid, s);
      return d ? `41 ${pid} ${d}` : 'NO DATA';
    }
    if (mode === '02') {
      if (this.cleared) return 'NO DATA';
      if (pid === '00') return bytes(0x42, 0, 0, ...bitmap(SUPPORTED_02, 0));
      if (pid === '02') return bytes(0x42, 0x02, 0, ...STORED);
      const frozen = { ...s, rpm: 3120, coolant: 78, load: 46, map: 62, throttle: 18, timing: 18, speed: 54, stft: 4.7, ltft: -1.6 };
      const d = this.pid(pid, frozen);
      return d ? `42 ${pid} 00 ${d}` : 'NO DATA';
    }
    // Το byte πλήθους κωδικών υπάρχει ΜΟΝΟ στο CAN (ISO 15765-4). Στα ISO 9141-2
    // και KWP2000 οι κωδικοί ακολουθούν κατευθείαν το 43/47/4A.
    const n = (count) => (this.isCanSim ? [count] : []);
    // Mode 05 (τεστ λάμδα) — μόνο σε non-CAN οχήματα (στα CAN ισχύει το mode 06).
    if (mode === '05' && !this.isCanSim) {
      if (pid === '00') return '45 00 8F 00 00 00'; // υποστηρίζονται TID 01,05,06,07,08
      const M05 = { '01': '01 00 A0', '05': '01 00 0A', '06': '01 00 14', '07': '01 00 14', '08': '01 00 96' };
      return M05[pid] ? `45 ${pid} ${M05[pid]}` : 'NO DATA';
    }
    if (c === '03') return this.cleared ? bytes(0x43, ...n(0)) : bytes(0x43, ...n(1), ...STORED);
    if (c === '07') return this.cleared ? bytes(0x47, ...n(0)) : bytes(0x47, ...n(1), ...PENDING);
    if (c === '0A') return bytes(0x4a, ...n(0));
    if (c === '04') { this.cleared = true; return '44'; }
    if (c === '0902') {
      const v = [...VIN].map((ch) => ch.charCodeAt(0));
      return `014\r0: 49 02 01 ${bytes(...v.slice(0, 3))}\r1: ${bytes(...v.slice(3, 10))}\r2: ${bytes(...v.slice(10, 17))}`;
    }
    if (c === '0904') {
      const v = [...'SIMCALID00000001'].map((ch) => ch.charCodeAt(0));
      return `013\r0: 49 04 01 ${bytes(...v.slice(0, 3))}\r1: ${bytes(...v.slice(3, 10))}\r2: ${bytes(...v.slice(10, 16))}`;
    }
    if (c === '0906') return '49 06 01 12 34 56 78';
    if (mode === '09') return 'NO DATA';
    if (mode === '06') {
      if (['00', '20', '40', '60', '80', 'A0'].includes(pid)) {
        return bytes(0x46, parseInt(pid, 16), ...bitmap(SUPPORTED_06, parseInt(pid, 16)));
      }
      const t = TESTS_06[pid];
      if (!t) return 'NO DATA';
      // 46 + εγγραφές 9 bytes: MID TID UASID τιμή(2) min(2) max(2)
      return bytes(0x46, ...t.flatMap(([tid, uas, v, lo, hi]) => [
        parseInt(pid, 16), tid, uas, ...w16(v), ...w16(lo), ...w16(hi),
      ]));
    }
    if (mode === '22') {
      const did = c.slice(2, 6);
      // F4xx = τα OBD PID «τυλιγμένα» σε DID (ISO 15031-5 / 14229). Ο κινητήρας
      // τα δίνει και από τους δύο δρόμους — καλό για δοκιμή του σαρωτή DID.
      if (did.startsWith('F4')) {
        const inner = this.pid(did.slice(2), this.state());
        if (!inner || inner === 'NO DATA') return '7F 22 31';
        return bytes(0x62, 0xf4, parseInt(did.slice(2), 16),
          inner.split(' ').map((h) => parseInt(h, 16)));
      }
      if (did === 'F190') {
        const v = [...VIN].map((ch) => ch.charCodeAt(0));
        return `014\r0: 62 F1 90 ${bytes(...v.slice(0, 3))}\r1: ${bytes(...v.slice(3, 10))}\r2: ${bytes(...v.slice(10, 17))}`;
      }
      const SIM_DIDS = { F188: 'MSE6.0', F18A: 'UAES', F189: 'ECM', F194: 'SIMSW0001', F195: 'SW:0.0.0' };
      if (SIM_DIDS[did]) {
        const v = [...SIM_DIDS[did]].map((ch) => ch.charCodeAt(0));
        return bytes(0x62, parseInt(did.slice(0, 2), 16), parseInt(did.slice(2), 16), ...v);
      }
      return '7F 22 31';
    }
    if (mode === '19') return '7F 19 11';
    return '?';
  }
}

// PID 03 (κατάσταση συστήματος καυσίμου): open loop όσο είναι κρύο, μετά closed loop.
function coolantLoop(s) { return s.coolant > 50 ? 0x02 : 0x01; }
