// Σάρωση όλων των μονάδων (ECU) του οχήματος — ΜΟΝΟ ανάγνωση.
//
// Χρησιμοποιεί αποκλειστικά υπηρεσίες της whitelist:
//   10 01  DiagnosticSessionControl → default session (ανίχνευση «υπάρχει κάποιος εδώ;»)
//   19 02  ReadDTCInformation → reportDTCByStatusMask
//   22 xxxx ReadDataByIdentifier → ταυτότητα μονάδας
// Καμία εγγραφή, κανένα security access, κανένα routine.

// ---------------------------------------------------------------- διευθύνσεις
// Τυπικές OBD μονάδες (ISO 15765-4, 11-bit): αίτημα 7E0-7E7 → απάντηση +8.
const OBD_11 = ['7E0', '7E1', '7E2', '7E3', '7E4', '7E5', '7E6', '7E7'];

// Συχνές μη-OBD μονάδες σε 11-bit. Διαφέρουν ανά κατασκευαστή, γι' αυτό
// ρωτάμε και διαβάζουμε το όνομα από την ίδια τη μονάδα (DID F197).
const EXTRA_11 = [
  '700', '701', '702', '703', '706', '708', '70A', '70E',
  '710', '711', '712', '713', '714', '715', '716', '717', '718', '719', '71A', '71E',
  '720', '721', '722', '724', '726', '72F',
  '730', '731', '732', '733', '737', '73F',
  '740', '741', '744', '745', '746', '74F',
  '750', '751', '752', '755', '757', '75A',
  '760', '762', '764', '765', '767', '76F',
  '770', '771', '772', '773', '774', '775', '776', '77F',
  '780', '783', '7A0', '7B0', '7C0', '7D0', '7D2',
];

// 29-bit (ISO 15765-4, 18DAxxF1). Τυπικές διευθύνσεις μονάδων κατά ISO 15031.
const TARGETS_29 = [
  '10', '11', '17', '18', '1E', '28', '29', '33', '37', '39', '3B', '40',
  '4A', '50', '58', '60', '6B', '7A', '7B', '7D', '7E',
];

/** Πιθανό όνομα μονάδας από τη διεύθυνση. Ενδεικτικό — το πραγματικό το δίνει το DID F197. */
const HINTS = {
  '7E0': 'Κινητήρας (ECM)', '7E1': 'Σασμάν / 2η ECM', '7E2': 'Μονάδα #3', '7E3': 'Μονάδα #4',
  '7E4': 'Μονάδα #5', '7E5': 'Μονάδα #6', '7E6': 'Μονάδα #7', '7E7': 'Μονάδα #8',
  710: 'ABS / φρένα', 713: 'Airbag (SRS)', 714: 'ABS / ESP', 715: 'Airbag (SRS)',
  720: 'Πίνακας οργάνων', 730: 'Κλιματισμός', 740: 'Πόρτες / BCM',
  745: 'Κεντρική ηλεκτρονική (BCM)', 750: 'Gateway', 760: 'Immobilizer / κλειδί',
  765: 'Τιμόνι / EPS', 770: 'Τηλεματική', 773: 'Αισθητήρες στάθμευσης',
  10: 'Κινητήρας (ECM)', 11: 'Σασμάν (TCM)', 28: 'ABS / φρένα', 29: 'ESP / ευστάθεια',
  40: 'Κεντρική ηλεκτρονική (BCM)', 50: 'Airbag (SRS)', 60: 'Πίνακας οργάνων',
};

export const SCAN_MODES = {
  quick: { label: 'Γρήγορη (OBD μονάδες)', list: OBD_11, wide: false },
  full: { label: 'Πλήρης 11-bit (~70 διευθύνσεις)', list: [...OBD_11, ...EXTRA_11], wide: false },
  wide: { label: '29-bit (βαρέα / νεότερα)', list: TARGETS_29, wide: true },
};

// ---------------------------------------------------------------- DTC (UDS)
const STATUS_BITS = [
  'απέτυχε τώρα', 'απέτυχε σε αυτόν τον κύκλο', 'εκκρεμής', 'επιβεβαιωμένος',
  'test ατελές από το σβήσιμο', 'απέτυχε από το σβήσιμο', 'test ατελές σε αυτόν τον κύκλο',
  'ζητά λυχνία',
];

/** 3 bytes UDS → κωδικός τύπου P0171 με failure type byte (P0171-00). */
export function decodeUdsDtc(b0, b1, b2) {
  const code = 'PCBU'[b0 >> 6]
    + ((b0 >> 4) & 3)
    + (b0 & 0x0f).toString(16).toUpperCase()
    + b1.toString(16).toUpperCase().padStart(2, '0');
  return { code, ftb: b2.toString(16).toUpperCase().padStart(2, '0') };
}

export function statusFlags(st) {
  return STATUS_BITS.filter((_, i) => st & (1 << i));
}

/** Σώμα απάντησης 59 02 <mask> [3B DTC + 1B status]… → λίστα κωδικών. */
export function parseUdsDtcs(resp) {
  const out = [];
  for (const r of resp) {
    const i = r.findIndex((b, k) => b === 0x59 && r[k + 1] === 0x02);
    if (i < 0) continue;
    const body = r.slice(i + 3); // μετά το 59 02 <availabilityMask>
    for (let k = 0; k + 3 < body.length; k += 4) {
      if (!body[k] && !body[k + 1] && !body[k + 2]) continue;
      const { code, ftb } = decodeUdsDtc(body[k], body[k + 1], body[k + 2]);
      out.push({ code, ftb, status: body[k + 3], flags: statusFlags(body[k + 3]) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- βοηθητικά
const ascii = (b) => (b || []).filter((x) => x >= 32 && x < 127).map((x) => String.fromCharCode(x)).join('').trim();

/**
 * Αρνητική απάντηση (7F) σημαίνει ότι η μονάδα ΥΠΑΡΧΕΙ και απάντησε.
 * Με ATCAF1 ο ELM327 κόβει το byte μήκους (PCI), με ATCAF0 όχι — δεχόμαστε και τα δύο.
 */
function presence(lines) {
  for (const ln of lines) {
    const m = ln.match(/^([0-9A-F]{3}|[0-9A-F]{8})\s+(.*)$/i);
    if (!m) continue;
    const hex = m[2].replace(/\s/g, '').toUpperCase();
    if (!/^[0-9A-F]{4,}$/.test(hex)) continue;
    for (const payload of [hex, hex.slice(2)]) {
      if (payload.startsWith('5001') || payload.startsWith('7F10')) {
        return { resp: m[1].toUpperCase(), negative: payload.startsWith('7F') };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- σάρωση
/**
 * Σαρώνει διευθύνσεις και επιστρέφει τις μονάδες που απάντησαν, με κωδικούς και ταυτότητα.
 * onProgress({done, total, found, addr}) για το UI. stop() → true για διακοπή.
 */
export async function scanEcus(elm, {
  mode = 'quick', readDtcs = true, readIds = true, onProgress = () => {}, stop = () => false,
} = {}) {
  const { list, wide } = SCAN_MODES[mode] || SCAN_MODES.quick;
  const found = [];
  try {
    // --- προετοιμασία adapter: headers ON, χωρίς φίλτρο, γρήγορο timeout
    if (wide) await elm.cmd('ATSP7');
    await elm.cmd('ATH1');
    await elm.cmd('ATCRA');
    await elm.cmd('ATST20'); // ~128 ms ανά διεύθυνση, να μη σέρνεται η σάρωση

    // --- φάση Α: ποιος απαντά σε 10 01 (default session)
    for (let i = 0; i < list.length; i++) {
      if (stop()) break;
      const addr = list[i];
      const req = wide ? `18DA${addr}F1` : addr;
      onProgress({ done: i, total: list.length, found: found.length, addr: req });
      await elm.cmd('ATSH' + req);
      const hit = presence(await elm.cmd('1001', { timeout: 1200 }));
      if (hit) {
        found.push({
          req, resp: hit.resp, addr, wide, negative: hit.negative,
          hint: HINTS[addr] || null, name: null, ids: {}, dtcs: [], error: null,
        });
      }
    }

    // --- φάση Β: για κάθε μονάδα, κωδικοί + ταυτότητα (με headers OFF και σωστό flow control)
    await elm.cmd('ATH0');
    await elm.cmd('ATST64');
    for (const ecu of found) {
      if (stop()) break;
      onProgress({ done: list.length, total: list.length, found: found.length, addr: ecu.req, phase: 'read' });
      await elm.cmd('ATSH' + ecu.req);
      await elm.cmd('ATCRA' + ecu.resp);
      await elm.cmd('ATFCSH' + ecu.req);
      await elm.cmd('ATFCSD300000');
      await elm.cmd('ATFCSM1');
      try {
        if (readIds) {
          for (const [did, key] of [['F197', 'name'], ['F18C', 'serial'], ['F187', 'part'], ['F190', 'vin']]) {
            const r = await elm.obd('22' + did, { timeout: 3000 });
            const hi = parseInt(did.slice(0, 2), 16);
            const lo = parseInt(did.slice(2), 16);
            for (const f of r) {
              const k = f.findIndex((b, n) => b === 0x62 && f[n + 1] === hi && f[n + 2] === lo);
              if (k >= 0) { ecu.ids[key] = ascii(Array.from(f.slice(k + 3))); break; }
            }
          }
          ecu.name = ecu.ids.name || null;
        }
        if (readDtcs) {
          // 0x09 = επιβεβαιωμένοι + απέτυχαν· αν η μονάδα το απορρίψει, δοκιμάζουμε 0xFF
          let dtcs = parseUdsDtcs(await elm.obd('190209', { timeout: 4000 }));
          if (!dtcs.length) dtcs = parseUdsDtcs(await elm.obd('1902FF', { timeout: 4000 }));
          ecu.dtcs = dtcs;
        }
      } catch (e) {
        ecu.error = e.message;
      }
    }
  } finally {
    // --- επαναφορά adapter στην κατάσταση που τον βρήκαμε
    await elm.cmd('ATFCSM0').catch(() => {});
    await elm.cmd('ATCRA').catch(() => {});
    await elm.cmd('ATH0').catch(() => {});
    await elm.cmd('ATST64').catch(() => {});
    await elm.cmd('ATSH7DF').catch(() => {});
    if (wide) await elm.cmd('ATSP0').catch(() => {});
  }
  onProgress({ done: list.length, total: list.length, found: found.length, addr: null, phase: 'done' });
  return found;
}

export function ecuLabel(ecu) {
  return ecu.name || ecu.hint || `Μονάδα ${ecu.req}`;
}
