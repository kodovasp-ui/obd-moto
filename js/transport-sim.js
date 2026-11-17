// Προσομοιωτής ELM327 + ECU μονοκύλινδρης/δικύλινδρης μοτοσυκλέτας για δοκιμές χωρίς μοτό.
// Ίδιο interface με BleTransport. Οι τιμές βασίζονται σε πραγματικές μετρήσεις (docs/samples).

const SUPPORTED_01 = ['01', '03', '04', '05', '06', '07', '08', '09', '0B', '0C', '0D', '0E', '0F', '11',
  '12', '13', '14', '15', '18', '1C', '1F', '20', '21', '2E', '30', '31', '40', '43', '4D'];
const SUPPORTED_02 = ['02', '04', '05', '06', '07', '0B', '0C', '0D', '0E', '0F', '11'];
const VIN = 'SIMDEMO0000000001';
const STORED = [0x05, 0x62]; // P0562 τάση συστήματος χαμηλή (demo)
const PENDING = [0x01, 0x31]; // P0131 λάμδα B1S1 χαμηλή τάση (demo)

const h2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).toUpperCase().padStart(2, '0');
const bytes = (...a) => a.map(h2).join(' ');

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
      case '0B': return bytes(s.map);
      case '0C': { const v = Math.round(s.rpm * 4); return bytes(v >> 8, v & 255); }
      case '0D': return bytes(s.speed);
      case '0E': return bytes((s.timing + 64) * 2);
      case '0F': return bytes(s.iat + 40);
      case '11': return bytes(s.throttle * 2.55);
      case '12': return bytes(0);
      case '13': return bytes(0x03);
      case '14': return bytes(s.o2a * 200, 0xff);
      case '15': return bytes(s.o2b * 200, 0xff);
      case '18': return bytes(0, 0xff);
      case '1C': return bytes(0x22);
      case '1F': { const v = Math.round(s.t); return bytes(v >> 8, v & 255); }
      case '21': return bytes(0, this.cleared ? 0 : 12);
      case '2E': return bytes(0);
      case '30': return bytes(this.cleared ? 0 : 41);
      case '31': return bytes(0x1f, 0x59);
      case '43': return bytes(0, s.load * 2.55);
      case '4D': return bytes(0, this.cleared ? 0 : 35);
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
      if (['00', '20', '40'].includes(pid)) return bytes(0x41, parseInt(pid, 16), ...bitmap(SUPPORTED_01, parseInt(pid, 16)));
      if (['60', '80', 'A0', 'C0'].includes(pid)) return 'NO DATA';
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
