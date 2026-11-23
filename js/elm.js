// Οδηγός ELM327: ουρά εντολών, ανάλυση απαντήσεων, βασικές OBD ρουτίνες.
// ΚΑΘΕ εντολή περνά από τη whitelist του safety.js πριν σταλεί.
import { check } from './safety.js';
import { decodeDtcs, decodePid } from './pids.js';

const ERR_RE = /NO DATA|ERROR|UNABLE|STOPPED|\?|BUS INIT|CAN ERROR|BUFFER FULL/i;

export class Elm {
  constructor(transport, { log = () => {} } = {}) {
    this.t = transport;
    this.log = log;
    this.buf = '';
    this.waiter = null;
    this.queue = Promise.resolve();
    this.isCan = true;
    this.info = {};
    this.t.onData = (s) => {
      this.buf += s;
      if (this.waiter && this.buf.includes('>')) this.waiter();
    };
  }

  /** Στέλνει εντολή (σειριακά) και επιστρέφει τις γραμμές απάντησης. */
  cmd(command, { timeout = 5000, allowClear = false } = {}) {
    const c = check(command, { allowClear }); // πετά UnsafeCommand αν δεν επιτρέπεται
    const run = async () => {
      this.buf = '';
      const done = new Promise((resolve) => {
        const timer = setTimeout(() => { this.waiter = null; resolve(false); }, timeout);
        this.waiter = () => { clearTimeout(timer); this.waiter = null; resolve(true); };
      });
      this.log('>', c);
      await this.t.write(c + '\r');
      const ok = await done;
      const raw = this.buf;
      this.buf = '';
      const lines = raw.replace(/\r/g, '\n').split('\n')
        .map((l) => l.replace(/>/g, '').trim())
        .filter((l) => l && l.replace(/\s/g, '').toUpperCase() !== c && !/^SEARCHING/i.test(l));
      this.log('<', lines.join(' | ') + (ok ? '' : ' [timeout]'));
      return lines;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /**
   * protocol: '0' = αυτόματη ανίχνευση (προεπιλογή), αλλιώς ένα από τα 1–C του ELM327.
   * Τα non-CAN με 5 baud init θέλουν ~3 s μόνο για να ξεκινήσουν, γι' αυτό
   * το 0100 παίρνει μεγαλύτερο timeout όταν δεν είμαστε σε αυτόματο CAN.
   */
  async init({ protocol = '0' } = {}) {
    const info = {};
    info.elm = (await this.cmd('ATZ', { timeout: 5000 })).join(' ');
    for (const c of ['ATE0', 'ATL0', 'ATS1', 'ATH0', 'ATAT1', 'ATSP' + protocol]) await this.cmd(c);
    info.voltage = (await this.cmd('ATRV')).join(' ');
    info.forced = protocol !== '0' ? protocol : null;
    const probe = await this.cmd('0100', { timeout: 15000 });
    info.responded = probe.some((l) => /^41\s*00/i.test(l.trim()));
    info.protocol = (await this.cmd('ATDP')).join(' ').replace(/^AUTO,\s*/i, '');
    info.protocolNum = (await this.cmd('ATDPN')).join('').replace(/^A/, '');
    this.isCan = '6789ABC'.includes(info.protocolNum.slice(-1));
    this.info = info;
    return info;
  }

  /** Εντολή OBD → πίνακας απαντήσεων (Uint8 arrays), με συνένωση CAN multi-frame. */
  async obd(command, opts) {
    const lines = await this.cmd(command, opts);
    const resp = [];
    const multi = [];
    for (const ln of lines) {
      if (ERR_RE.test(ln)) continue;
      const m = ln.match(/^([0-9A-F]):\s*(.*)$/i);
      if (m) { multi.push(m[2]); continue; }
      const h = ln.replace(/\s/g, '').toUpperCase();
      if (!/^[0-9A-F]+$/.test(h)) continue;
      if (h.length <= 3) continue; // μήκος μηνύματος πριν τα frames
      resp.push(hexToBytes(h));
    }
    if (multi.length) resp.push(hexToBytes(multi.join('').replace(/\s/g, '')));
    return resp;
  }

  /** Δεδομένα PID (μετά το 41 xx) ή null. mode = '01' ή '02'. */
  async pidData(pid, mode = '01', suffix = '') {
    const want = [parseInt(mode, 16) + 0x40, parseInt(pid, 16)];
    for (const r of await this.obd(mode + pid + suffix)) {
      for (let i = 0; i + 1 < r.length; i++) {
        // mode 02: μετά το PID ακολουθεί ο αριθμός freeze frame
        if (r[i] === want[0] && r[i + 1] === want[1]) return Array.from(r.slice(i + (mode === '02' ? 3 : 2)));
      }
    }
    return null;
  }

  async readPid(pid, mode = '01') {
    return decodePid(pid, await this.pidData(pid, mode, mode === '02' ? '00' : ''));
  }

  async supportedPids(mode = '01') {
    const sup = [];
    for (let base = 0; base <= 0xc0; base += 0x20) {
      const b = base.toString(16).toUpperCase().padStart(2, '0');
      const d = await this.pidData(b, mode, mode === '02' ? '00' : '');
      if (!d || d.length < 4) break;
      const bits = ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0;
      for (let n = 0; n < 32; n++) {
        if (bits & (2 ** (31 - n))) sup.push((base + n + 1).toString(16).toUpperCase().padStart(2, '0'));
      }
      if (!(bits & 1)) break;
    }
    return sup;
  }

  async readDtcs(mode) {
    const respId = parseInt(mode, 16) + 0x40;
    const codes = new Set();
    for (const r of await this.obd(mode)) {
      const i = r.indexOf(respId);
      if (i < 0) continue;
      let body = r.slice(i + 1);
      if (this.isCan && body.length) body = body.slice(1); // byte πλήθους
      decodeDtcs(body).forEach((c) => codes.add(c));
    }
    return [...codes].sort();
  }

  async readVin() {
    let vin = '';
    for (const r of await this.obd('0902', { timeout: 10000 })) {
      for (let i = 0; i + 1 < r.length; i++) {
        if (r[i] === 0x49 && r[i + 1] === 0x02) {
          vin += Array.from(r.slice(i + 3)).filter((b) => b > 32 && b < 127)
            .map((b) => String.fromCharCode(b)).join('');
          break;
        }
      }
    }
    return vin ? vin.slice(-17) : null;
  }

  /** Mode 09 πληροφορία (π.χ. '04' CALID, '06' CVN) → bytes μετά το «49 xx NN». */
  async info09(pid) {
    for (const r of await this.obd('09' + pid, { timeout: 8000 })) {
      for (let i = 0; i + 2 < r.length; i++) {
        if (r[i] === 0x49 && r[i + 1] === parseInt(pid, 16)) return Array.from(r.slice(i + 3));
      }
    }
    return null;
  }

  /** UDS 0x22 (ReadDataByIdentifier) προς την ECU κινητήρα 7E0 — μόνο ανάγνωση. */
  async readEcuId(dids) {
    const out = {};
    await this.cmd('ATSH7E0');
    try {
      for (const did of dids) {
        const hi = parseInt(did.slice(0, 2), 16);
        const lo = parseInt(did.slice(2), 16);
        for (const r of await this.obd('22' + did, { timeout: 4000 })) {
          const i = r.findIndex((b, k) => b === 0x62 && r[k + 1] === hi && r[k + 2] === lo);
          if (i >= 0) { out[did] = Array.from(r.slice(i + 3)); break; }
        }
      }
    } finally {
      await this.cmd('ATSH7DF');
    }
    out.CALID = await this.info09('04');
    out.CVN = await this.info09('06');
    return out;
  }

  /** Κατάσταση MIL και readiness monitors από PID 0101. */
  async readStatus() {
    const d = await this.pidData('01');
    if (!d) return null;
    const spark = !(d[1] & 0x08);
    const cont = ['Misfire', 'Καύσιμο', 'Εξαρτήματα'].map((name, n) => ({
      name, supported: !!(d[1] & (1 << n)), complete: !(d[1] & (1 << (n + 4))),
    }));
    const nonCont = spark
      ? ['Καταλύτης', 'Θερμ. καταλύτη', 'EVAP', 'Δευτ. αέρας', '—', 'Αισθ. λάμδα', 'Θέρμανση λάμδα', 'EGR/VVT']
      : ['NMHC καταλ.', 'NOx/SCR', '—', 'Πίεση υπερπλ.', '—', 'Αισθ. καυσαερίων', 'PM φίλτρο', 'EGR/VVT'];
    const non = nonCont.map((name, n) => ({
      name, supported: !!(d[2] & (1 << n)), complete: !(d[3] & (1 << n)),
    })).filter((m) => m.name !== '—');
    return {
      mil: !!(d[0] & 0x80), dtcCount: d[0] & 0x7f, ignition: spark ? 'βενζίνη' : 'diesel',
      monitors: [...cont, ...non].filter((m) => m.supported),
    };
  }

  async voltage() {
    const l = await this.cmd('ATRV');
    const v = parseFloat((l[0] || '').replace(/V/i, ''));
    return Number.isFinite(v) ? v : null;
  }

  /** Σβήσιμο κωδικών — ΜΟΝΟ μετά από ρητή επιβεβαίωση του χρήστη στο UI. */
  async clearDtcsConfirmed() {
    return this.cmd('04', { timeout: 10000, allowClear: true });
  }
}

export function hexToBytes(h) {
  const out = new Uint8Array(h.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
