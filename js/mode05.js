// OBD mode 05 — αποτελέσματα τεστ αισθητήρων λάμδα.
//
// Χρησιμοποιείται σε παλιότερα, non-CAN οχήματα (ISO 9141-2, KWP2000). Στα
// CAN το αντικατέστησε το mode 06. Μόνο ανάγνωση.
//
// Κάθε TID (Test ID) είναι μια τυποποιημένη μέτρηση (SAE J1979) με δική της
// κλίμακα και μονάδα — αυτές είναι γνωστές, δεν τις εφευρίσκουμε.

// TID → [όνομα, μονάδα, κλίμακα]. Οι κλίμακες από το SAE J1979.
export const TID = {
  0x01: ['Τάση κατωφλίου πλούσιο→φτωχό', 'V', 0.005],
  0x02: ['Τάση κατωφλίου φτωχό→πλούσιο', 'V', 0.005],
  0x03: ['Χαμηλή τάση για χρόνο εναλλαγής', 'V', 0.005],
  0x04: ['Υψηλή τάση για χρόνο εναλλαγής', 'V', 0.005],
  0x05: ['Χρόνος εναλλαγής πλούσιο→φτωχό', 's', 0.004],
  0x06: ['Χρόνος εναλλαγής φτωχό→πλούσιο', 's', 0.004],
  0x07: ['Ελάχιστη τάση στον κύκλο τεστ', 'V', 0.005],
  0x08: ['Μέγιστη τάση στον κύκλο τεστ', 'V', 0.005],
  0x09: ['Χρόνος μεταξύ εναλλαγών', 's', 0.04],
  0x0a: ['Περίοδος αισθητήρα', 's', 0.04],
};

// Αισθητήρας λάμδα ανά «O2 sensor id» (0x01-0x08 → bank/sensor).
export const O2 = {
  0x01: 'B1S1', 0x02: 'B1S2', 0x03: 'B1S3', 0x04: 'B1S4',
  0x05: 'B2S1', 0x06: 'B2S2', 0x07: 'B2S3', 0x08: 'B2S4',
};

export function tidName(tid) { return TID[tid]?.[0] || `TID 0x${tid.toString(16).toUpperCase()}`; }

/** Αποκωδικοποιεί μια απάντηση «45 TID O2 V1 V2» σε τιμή με μονάδα. */
export function decodeResult(bytes) {
  // bytes μετά το 0x45: [TID, O2id, hi, lo]
  const [tid, o2, hi, lo] = bytes;
  const meta = TID[tid];
  const raw = (hi << 8) | lo;
  return {
    tid,
    o2: O2[o2] || `#${o2}`,
    name: meta ? meta[0] : tidName(tid),
    unit: meta ? meta[1] : '',
    value: meta ? raw * meta[2] : raw,
    dec: meta && meta[2] < 0.01 ? 3 : 2,
    raw,
  };
}

/**
 * Διαβάζει mode 05. Ρωτά πρώτα τα υποστηριζόμενα TID (0500) και μετά διαβάζει
 * το καθένα. Πολλά οχήματα δεν υποστηρίζουν το mode 05 καθόλου (NO DATA).
 */
export async function readMode05(elm) {
  const supportedLines = await elm.obd('0500');
  const supported = [];
  for (const r of supportedLines) {
    const i = r.findIndex((b, k) => b === 0x45 && r[k + 1] === 0x00);
    if (i < 0) continue;
    const bits = r.slice(i + 2); // bitmap 4 bytes: TID 01-20
    for (let n = 0; n < bits.length * 8; n++) {
      if (bits[n >> 3] & (0x80 >> (n & 7))) supported.push(n + 1);
    }
  }
  if (!supported.length) return { ok: false, supported: [] };

  const results = [];
  for (const tid of supported) {
    const hx = tid.toString(16).toUpperCase().padStart(2, '0');
    const r = await elm.obd('05' + hx).catch(() => []);
    for (const frame of r) {
      const i = frame.findIndex((b, k) => b === 0x45 && frame[k + 1] === tid);
      if (i >= 0 && frame.length >= i + 5) results.push(decodeResult(Array.from(frame.slice(i + 1, i + 5))));
    }
  }
  return { ok: true, supported, results };
}
