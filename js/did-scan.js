// Σαρωτής DID — UDS 0x22 ReadDataByIdentifier, ΜΟΝΟ ανάγνωση.
//
// Το OBD-II δίνει μόνο ό,τι επιβάλλει ο νόμος (κινητήρας, καυσαέρια). Κάθε
// μονάδα όμως εκθέτει και δικά της δεδομένα σε «ταυτοποιητές» (DID) των 16 bit,
// που διαβάζονται με την υπηρεσία 0x22. Εδώ σαρώνουμε περιοχές DID και
// κρατάμε ό,τι απαντά.
//
// Καμία εγγραφή: ΜΟΝΟ 0x22. Κανένα 0x2E (WriteDataByIdentifier), κανένα
// security access, καμία αλλαγή session. Ό,τι ζητά security το σημειώνουμε
// και το αφήνουμε.

// ------------------------------------------------------------ ονόματα DID
// Τυποποιημένα από το ISO 14229-1 (περιοχή ταυτότητας F180–F19F).
const STD = {
  F180: 'Boot software ID', F181: 'Application software ID', F182: 'Application data ID',
  F183: 'Boot software fingerprint', F184: 'Application software fingerprint',
  F185: 'Application data fingerprint', F186: 'Ενεργή διαγνωστική session',
  F187: 'Κωδικός ανταλλακτικού (κατασκευαστής)', F188: 'ECU software number',
  F189: 'ECU software version', F18A: 'Προμηθευτής συστήματος',
  F18B: 'Ημ/νία κατασκευής ECU', F18C: 'Σειριακός αριθμός ECU',
  F18D: 'Υποστηριζόμενες λειτουργικές μονάδες', F18E: 'Kit assembly part number',
  F190: 'VIN', F191: 'ECU hardware number', F192: 'Hardware προμηθευτή',
  F193: 'Hardware version προμηθευτή', F194: 'Software προμηθευτή',
  F195: 'Software version προμηθευτή', F196: 'Αριθμός έγκρισης τύπου (καυσαέρια)',
  F197: 'Όνομα συστήματος / τύπος κινητήρα', F198: 'Κωδικός συνεργείου / tester',
  F199: 'Ημ/νία προγραμματισμού', F19A: 'Κωδικός εξοπλισμού calibration',
  F19B: 'Ημ/νία calibration', F19C: 'Software number εξοπλισμού calibration',
  F19D: 'Ημ/νία εγκατάστασης ECU', F19E: 'Αρχείο ODX', F19F: 'Entity',
};

/**
 * Το όνομα ενός DID όταν το ξέρουμε. Τα F4xx/F5xx/F6xx είναι τα OBD δεδομένα
 * «τυλιγμένα» σε DID: F4<PID> = mode 01, F6<InfoType> = mode 09. Έτσι παίρνεις
 * τυποποιημένα ζωντανά δεδομένα και από μονάδες εκτός κινητήρα.
 */
export function didName(did, pidName = null) {
  const d = did.toUpperCase();
  if (STD[d]) return STD[d];
  const hi = d.slice(0, 2);
  const lo = d.slice(2);
  if (hi === 'F4') return `OBD mode 01 · PID ${lo}${pidName ? ` — ${pidName(lo)}` : ''}`;
  if (hi === 'F5') return `OBD mode 06 · MID ${lo}`;
  if (hi === 'F6') return `OBD mode 09 · InfoType ${lo}`;
  if (hi === 'F8') return `Δεδομένα συστήματος ασφαλείας ${lo}`;
  if (d >= 'F200' && d <= 'F2FF') return 'Περιοδικό DID';
  if (d >= 'F300' && d <= 'F3FF') return 'Δυναμικά ορισμένο DID';
  return null;
}

// ------------------------------------------------------------ περιοχές σάρωσης
const range = (from, to) => ({ from: parseInt(from, 16), to: parseInt(to, 16) });

export const DID_RANGES = {
  id: {
    label: 'Ταυτότητα μονάδας (F180–F1FF)',
    note: 'Τυποποιημένο από το ISO 14229. Σχεδόν κάθε μονάδα απαντά εδώ. Γρήγορο.',
    parts: [range('F180', 'F1FF')],
  },
  obd: {
    label: 'OBD δεδομένα σε DID (F400–F6FF)',
    note: 'Τα mode 01/06/09 τυλιγμένα σε DID — ζωντανά δεδομένα και από μονάδες εκτός κινητήρα.',
    parts: [range('F400', 'F4FF'), range('F600', 'F6FF')],
  },
  common: {
    label: 'Συχνές περιοχές κατασκευαστή',
    note: 'Εμπειρικές περιοχές όπου οι περισσότεροι βάζουν ζωντανά δεδομένα. Αργό.',
    parts: [range('0100', '01FF'), range('1000', '10FF'), range('2000', '20FF'), range('D000', 'D0FF')],
  },
  low: {
    label: 'Χαμηλή περιοχή (0000–0FFF)',
    note: 'Πολύ αργό (4096 ερωτήματα). Μόνο αν οι υπόλοιπες δεν έδωσαν τίποτα.',
    parts: [range('0000', '0FFF')],
  },
};

export function rangeCount(key) {
  const r = DID_RANGES[key];
  return r ? r.parts.reduce((n, p) => n + (p.to - p.from + 1), 0) : 0;
}

/** Λίστα DID (hex, 4 ψηφία) για μια περιοχή — ή για δική σου from/to. */
export function didList(key, custom = null) {
  const parts = custom ? [range(custom.from, custom.to)] : (DID_RANGES[key]?.parts || []);
  const out = [];
  for (const p of parts) {
    for (let v = p.from; v <= p.to; v++) out.push(v.toString(16).toUpperCase().padStart(4, '0'));
  }
  return out;
}

// ------------------------------------------------------------ απαντήσεις
// Αρνητικοί κωδικοί του UDS. Το 0x31 σημαίνει «δεν υπάρχει τέτοιο DID» και
// είναι η συνηθισμένη απάντηση — δεν το κρατάμε. Το 0x33 όμως σημαίνει
// «υπάρχει αλλά θέλει security access»: αυτό είναι χρήσιμη πληροφορία.
export const NRC = {
  0x10: 'γενική απόρριψη', 0x11: 'η υπηρεσία δεν υποστηρίζεται',
  0x12: 'μη υποστηριζόμενη υπο-λειτουργία', 0x13: 'λάθος μήκος αιτήματος',
  0x14: 'η απάντηση είναι πολύ μεγάλη', 0x21: 'απασχολημένη — επανάληψη',
  0x22: 'οι συνθήκες δεν επιτρέπουν την ανάγνωση', 0x24: 'λάθος σειρά αιτημάτων',
  0x31: 'δεν υπάρχει τέτοιο DID', 0x33: 'θέλει security access',
  0x78: 'η απάντηση καθυστερεί', 0x7E: 'δεν υποστηρίζεται σε αυτή τη session',
  0x7F: 'η υπηρεσία δεν υποστηρίζεται σε αυτή τη session',
};

const printable = (b) => b >= 32 && b < 127;

/** Σώμα απάντησης → {kind, data} ή null αν δεν αφορά αυτό το DID. */
export function parseDidReply(frames, did) {
  const hi = parseInt(did.slice(0, 2), 16);
  const lo = parseInt(did.slice(2), 16);
  for (const f of frames) {
    for (let k = 0; k + 2 < f.length; k++) {
      if (f[k] === 0x62 && f[k + 1] === hi && f[k + 2] === lo) {
        return { kind: 'ok', data: Array.from(f.slice(k + 3)) };
      }
      if (f[k] === 0x7f && f[k + 1] === 0x22) {
        return { kind: 'nrc', nrc: f[k + 2], text: NRC[f[k + 2]] || `κωδικός 0x${f[k + 2].toString(16)}` };
      }
    }
  }
  return null;
}

/** Πώς να δείξουμε την τιμή. Δεν εφευρίσκουμε κλίμακες: δίνουμε ωμά bytes και
 *  τις πιθανές αναγνώσεις, ώστε να αναγνωρίσεις μόνος σου τι είναι. */
export function describeValue(data) {
  const hex = data.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  const out = { hex, len: data.length, text: null, nums: [] };

  // Κείμενο: μόνο αν ΟΛΑ τα bytes είναι εκτυπώσιμα (ή κενά στο τέλος).
  const trimmed = [...data];
  while (trimmed.length && (trimmed[trimmed.length - 1] === 0 || trimmed[trimmed.length - 1] === 0xff)) trimmed.pop();
  if (trimmed.length >= 2 && trimmed.every(printable)) {
    out.text = trimmed.map((b) => String.fromCharCode(b)).join('').trim() || null;
  }

  if (data.length === 1) out.nums.push(['u8', data[0]]);
  if (data.length === 2) {
    const u = (data[0] << 8) | data[1];
    out.nums.push(['u16', u]);
    if (u >= 0x8000) out.nums.push(['i16', u - 0x10000]);
  }
  if (data.length === 4) {
    out.nums.push(['u32', ((data[0] << 24) >>> 0) + (data[1] << 16) + (data[2] << 8) + data[3]]);
  }
  return out;
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ------------------------------------------------------------ σάρωση
/**
 * Σαρώνει DID σε μία μονάδα.
 *
 * ecu: {req, resp, wide} όπως το δίνει η σάρωση μονάδων.
 * probeLive: δεύτερο πέρασμα στα ευρεθέντα, για να ξεχωρίσουν τα ΖΩΝΤΑΝΑ
 *   (αλλάζει η τιμή) από τα στατικά στοιχεία ταυτότητας.
 */
export async function scanDids(elm, ecu, {
  dids, probeLive = true, onProgress = () => {}, stop = () => false, timeout = 900,
} = {}) {
  const found = [];
  const protectedIds = [];
  let asked = 0;

  try {
    await elm.cmd('ATH0');
    await elm.cmd('ATST20'); // ~128 ms: οι περισσότερες απαντήσεις είναι «δεν υπάρχει»
    await elm.cmd('ATSH' + ecu.req);
    if (ecu.resp) await elm.cmd('ATCRA' + ecu.resp);
    await elm.cmd('ATFCSH' + ecu.req);
    await elm.cmd('ATFCSD300000');
    await elm.cmd('ATFCSM1');

    for (let i = 0; i < dids.length; i++) {
      if (stop()) break;
      const did = dids[i];
      if (i % 8 === 0 || i === dids.length - 1) {
        onProgress({ done: i, total: dids.length, found: found.length, did, phase: 'scan' });
      }
      let r;
      try {
        r = parseDidReply(await elm.obd('22' + did, { timeout }), did);
      } catch { r = null; } // timeout / NO DATA → δεν υπάρχει
      asked++;
      if (!r) continue;
      if (r.kind === 'ok') {
        if (!r.data.length) continue;
        found.push({ did, name: didName(did), data: r.data, live: false, data2: null });
      } else if (r.nrc !== 0x31 && r.nrc !== 0x11 && r.nrc !== 0x12) {
        protectedIds.push({ did, name: didName(did), nrc: r.nrc, text: r.text });
      }
    }

    // --- δεύτερο πέρασμα: ποια άλλαξαν → ζωντανά δεδομένα
    if (probeLive && found.length && !stop()) {
      await elm.cmd('ATST64');
      for (let i = 0; i < found.length; i++) {
        if (stop()) break;
        onProgress({ done: i, total: found.length, found: found.length, did: found[i].did, phase: 'live' });
        try {
          const r = parseDidReply(await elm.obd('22' + found[i].did, { timeout: 2000 }), found[i].did);
          if (r?.kind === 'ok') {
            found[i].data2 = r.data;
            found[i].live = !same(found[i].data, r.data);
          }
        } catch { /* το αφήνουμε ως στατικό */ }
      }
    }
  } finally {
    await elm.cmd('ATFCSM0').catch(() => {});
    await elm.cmd('ATCRA').catch(() => {});
    await elm.cmd('ATST64').catch(() => {});
    await elm.cmd('ATSH7DF').catch(() => {});
  }

  onProgress({ done: dids.length, total: dids.length, found: found.length, did: null, phase: 'done' });
  return { found, protected: protectedIds, asked };
}

/** Διαβάζει ξανά συγκεκριμένα DID — για το «ζωντανή παρακολούθηση». */
export async function readDids(elm, ecu, dids, { timeout = 1500 } = {}) {
  const out = {};
  await elm.cmd('ATH0');
  await elm.cmd('ATSH' + ecu.req);
  if (ecu.resp) await elm.cmd('ATCRA' + ecu.resp);
  await elm.cmd('ATFCSH' + ecu.req);
  await elm.cmd('ATFCSD300000');
  await elm.cmd('ATFCSM1');
  try {
    for (const did of dids) {
      try {
        const r = parseDidReply(await elm.obd('22' + did, { timeout }), did);
        if (r?.kind === 'ok') out[did] = r.data;
      } catch { /* παραλείπεται */ }
    }
  } finally {
    await elm.cmd('ATFCSM0').catch(() => {});
    await elm.cmd('ATCRA').catch(() => {});
    await elm.cmd('ATSH7DF').catch(() => {});
  }
  return out;
}
