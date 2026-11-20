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
const VIN = 'SIMDEMO0000000001';
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
  }

  static isSupported() { return true; }
  async connect() { this.t0 = performance.now(); }
  async disconnect() { this.onDisconnect(); }

  async write(text) {
    const c = text.replace(/\s/g, '').toUpperCase();
    const reply = this.respond(c);
    setTimeout(() => this.onData(reply + '\r\r>'), 25 + Math.random() * 30);
  }

  // Κατάσταση κινητήρα: ρελαντί που ζεσταίνεται, με περιοδικό «γκάζι» στις ~2500.
  state() {
    const t = (performance.now() - this.t0) / 1000;
    const coolant = Math.min(92, 25 + t * 1.2);
    const rev = (t % 40) > 28;
    const rpm = (rev ? 2500 : 1500 + Math.max(0, 300 - t * 5)) + (Math.random() - 0.5) * 120;
    const o2 = coolant > 50 ? (Math.sin(t * 6) > 0 ? 0.75 + Math.random() * 0.15 : 0.1 + Math.random() * 0.1) : 0.45;
    return {
      t, coolant, rpm,
      load: rev ? 31 : 28 + Math.random(), map: rev ? 35 : 40,
      iat: 20 + t * 0.05, throttle: rev ? 7.8 : 6.7, speed: 0,
      timing: rev ? 14 + Math.random() : 1 + Math.random() * 3.5,
      stft: coolant > 50 ? (Math.random() - 0.5) * 6 : 0, ltft: -2.3,
      o2a: o2, o2b: 0.78 + Math.random() * 0.03, volt: coolant > 30 ? 14 + Math.random() * 0.2 : 12.3,
      maf: rev ? 6.4 : 2.5 + Math.random() * 0.3,
      lam: coolant > 50 ? 1 + (Math.random() - 0.5) * 0.04 : 1.18,
      cat: Math.min(520, 30 + t * 9),
      egt: Math.min(430, 25 + t * 7.5),
      fuelRate: rev ? 2.9 : 0.9 + Math.random() * 0.1,
    };
  }

  pid(pid, s) {
    const tr = (v) => (v + 100) * 1.28;
    switch (pid) {
      case '01': return this.cleared ? bytes(0x00, 0x07, 0x65, 0x65) : bytes(0x81, 0x07, 0x65, 0x00);
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
      if (a === 'DP') return 'AUTO, ISO 15765-4 (CAN 11/500)';
      if (a === 'DPN') return 'A6';
      if (a === '@1') return 'SIMULATOR';
      if (a.startsWith('H')) this.headers = a === 'H1';
      return 'OK';
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
    if (c === '03') return this.cleared ? '43 00' : bytes(0x43, 1, ...STORED);
    if (c === '07') return this.cleared ? '47 00' : bytes(0x47, 1, ...PENDING);
    if (c === '0A') return '4A 00';
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
    if (mode === '06') return 'NO DATA';
    if (c === '1001') return '50 01 00 32 01 F4';
    if (mode === '22') {
      const did = c.slice(2, 6);
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
