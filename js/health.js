// Αυτόματη αναφορά υγείας από μια συνεδρία (κανόνες για βενζινοκίνητη μοτοσυκλέτα, narrowband λάμδα).
// Τα όρια είναι γενικά πρακτικά όρια συνεργείου, όχι προδιαγραφές CFMOTO.

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => {
  const m = mean(a);
  return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : 0;
};
const r1 = (v, d = 1) => (v == null ? null : +v.toFixed(d));
const col = (rows, k) => rows.map((r) => r.v[k]).filter((v) => v != null);

/** Κατηγοριοποίηση δειγμάτων: ζεστός κινητήρας, ρελαντί, ανεβασμένες στροφές. */
function segments(rows) {
  const running = rows.filter((r) => (r.v['0C'] ?? 0) > 500);
  const hasCoolant = rows.some((r) => r.v['05'] != null);
  const warm = running.filter((r) => !hasCoolant || (r.v['05'] ?? 0) >= 70);
  const idle = warm.filter((r) => r.v['0C'] < 2000 && (r.v['11'] == null || r.v['11'] < 12));
  const raised = warm.filter((r) => r.v['0C'] >= 2200 && r.v['0C'] <= 3500);
  const off = rows.filter((r) => r.v['0C'] != null && r.v['0C'] < 100);
  return { running, warm, idle, raised, off };
}

function trimTotal(rows) {
  const v = rows.filter((r) => r.v['06'] != null && r.v['07'] != null).map((r) => r.v['06'] + r.v['07']);
  return v.length ? mean(v) : null;
}

/** Αριθμός διασταυρώσεων 0,45 V ανά λεπτό (ενδεικτικό· περιορίζεται από τον ρυθμό δειγματοληψίας). */
function switchRate(rows, k) {
  const pts = rows.filter((r) => r.v[k] != null);
  if (pts.length < 5) return null;
  let n = 0;
  for (let i = 1; i < pts.length; i++) if ((pts[i - 1].v[k] - 0.45) * (pts[i].v[k] - 0.45) < 0) n++;
  const dur = pts[pts.length - 1].t - pts[0].t;
  return dur > 5 ? (n * 60) / dur : null;
}

const item = (area, status, title, detail) => ({ area, status, title, detail });

export function buildReport(session) {
  const rows = session.rows || [];
  const seg = segments(rows);
  const items = [];
  const m = {}; // βασικές μετρικές για σύγκριση

  // ---- Κωδικοί / MIL
  if (session.status || session.dtcs) {
    const all = [...(session.dtcs?.stored || []), ...(session.dtcs?.pending || []), ...(session.dtcs?.permanent || [])];
    if (session.status?.mil || session.dtcs?.stored?.length) {
      items.push(item('Κωδικοί', 'bad', 'Υπάρχουν αποθηκευμένοι κωδικοί / MIL αναμμένη', all.join(', ')));
    } else if (all.length) {
      items.push(item('Κωδικοί', 'warn', 'Εκκρεμείς κωδικοί', `${all.join(', ')} — η ECU έχει δει πρόβλημα, χωρίς επιβεβαίωση ακόμα.`));
    } else {
      items.push(item('Κωδικοί', 'ok', 'Κανένας κωδικός βλάβης', 'MIL σβηστή.'));
    }
    const inc = (session.status?.monitors || []).filter((x) => !x.complete).map((x) => x.name);
    if (inc.length) items.push(item('Κωδικοί', 'info', 'Μη ολοκληρωμένα readiness monitors', `${inc.join(', ')} — φυσιολογικό μετά από σβήσιμο κωδικών ή σύντομες διαδρομές.`));
  }

  if (!rows.length) {
    items.push(item('Δεδομένα', 'na', 'Δεν υπάρχουν live δεδομένα', 'Κάνε καταγραφή με ζεστό κινητήρα (ρελαντί και ~2500 rpm).'));
    return finish(items, m);
  }
  if (!seg.warm.length) {
    items.push(item('Δεδομένα', 'warn', 'Δεν υπάρχουν δεδομένα με ζεστό κινητήρα', 'Τα trims και η λάμδα κρίνονται μόνο με ψυκτικό ≥ 70 °C και κινητήρα σε λειτουργία.'));
  }

  // ---- Fuel trims
  const tIdle = trimTotal(seg.idle);
  const tRaised = trimTotal(seg.raised);
  const ltft = mean(col(seg.warm, '07'));
  m.trimIdle = r1(tIdle); m.trimRaised = r1(tRaised); m.ltft = r1(ltft);
  for (const [label, t] of [['ρελαντί', tIdle], ['~2500 rpm', tRaised]]) {
    if (t == null) continue;
    const a = Math.abs(t);
    const st = a <= 10 ? 'ok' : a <= 20 ? 'warn' : 'bad';
    items.push(item('Fuel trims', st, `Συνολική διόρθωση (STFT+LTFT) στο ${label}: ${t > 0 ? '+' : ''}${t.toFixed(1)}%`,
      st === 'ok' ? 'Εντός ±10%.' : t > 0 ? 'Η ECU προσθέτει καύσιμο: φτωχό μείγμα.' : 'Η ECU αφαιρεί καύσιμο: πλούσιο μείγμα.'));
  }
  if (tIdle != null && tRaised != null) {
    if (tIdle - tRaised > 8 && tIdle > 5) {
      items.push(item('Fuel trims', 'warn', 'Φτωχό στο ρελαντί, διορθώνεται με στροφές', 'Τυπικό εισροής αέρα (λάστιχο εισαγωγής, φλάντζα σώματος πεταλούδας, σωληνάκι MAP).'));
    } else if (tIdle > 10 && tRaised > 10) {
      items.push(item('Fuel trims', 'warn', 'Φτωχό σε όλες τις στροφές', 'Πιθανή χαμηλή πίεση καυσίμου, φραγμένο φίλτρο/μπεκ ή λάθος σήμα MAP.'));
    }
  }

  // ---- Λάμδα B1S1
  const o2 = col(seg.warm, '14');
  if (o2.length >= 5) {
    const lo = Math.min(...o2); const hi = Math.max(...o2);
    const rate = switchRate(seg.warm, '14');
    m.o2Min = r1(lo, 2); m.o2Max = r1(hi, 2); m.o2Rate = r1(rate, 0);
    const sw = lo < 0.3 && hi > 0.6;
    items.push(item('Λάμδα', sw ? 'ok' : 'bad', `B1S1: ${lo.toFixed(2)}–${hi.toFixed(2)} V${rate != null ? `, ~${rate.toFixed(0)} εναλλαγές/λεπτό` : ''}`,
      sw ? 'Εναλλάσσεται φτωχό/πλούσιο: closed loop λειτουργεί. (Ο ρυθμός είναι ενδεικτικός λόγω δειγματοληψίας.)'
        : 'Δεν εναλλάσσεται: αισθητήρας αργός/νεκρός, open loop, ή σοβαρό πρόβλημα μείγματος.'));
    const mo = mean(o2);
    if (sw && (mo > 0.65 || mo < 0.25)) {
      items.push(item('Λάμδα', 'warn', `Μέση τάση B1S1 ${mo.toFixed(2)} V`, mo > 0.65 ? 'Τάση προς πλούσιο.' : 'Τάση προς φτωχό.'));
    }
  }
  const o2b = col(seg.warm, '15');
  if (o2b.length >= 5) {
    const s = std(o2b);
    m.o2bStd = r1(s, 3);
    const tracks = s > 0.15 && Math.max(...o2b) - Math.min(...o2b) > 0.5;
    items.push(item('Λάμδα', tracks ? 'warn' : 'ok', `B1S2 (μετά τον καταλύτη): μέση ${mean(o2b).toFixed(2)} V, διακύμανση ${s.toFixed(3)}`,
      tracks ? 'Ακολουθεί τον B1S1: ο καταλύτης αποθηκεύει λίγο οξυγόνο (γήρανση).' : 'Σταθερή: ο καταλύτης δουλεύει.'));
  }

  // ---- Προπορεία
  const tmIdle = mean(col(seg.idle, '0E'));
  const tmRaised = mean(col(seg.raised, '0E'));
  m.timingIdle = r1(tmIdle); m.timingRaised = r1(tmRaised);
  if (tmIdle != null) {
    const odd = tmIdle < -5 || tmIdle > 25;
    items.push(item('Ανάφλεξη', odd ? 'warn' : 'ok', `Προπορεία ρελαντί ${tmIdle.toFixed(1)}°${tmRaised != null ? `, ~2500 rpm ${tmRaised.toFixed(1)}°` : ''}`,
      odd ? 'Ασυνήθιστη τιμή — έλεγξε για καθυστέρηση λόγω κρουστικής καύσης ή ρελαντί εκτός ελέγχου.'
        : 'Χαμηλή προπορεία στο ρελαντί είναι συνήθης (η ECU τη χρησιμοποιεί για έλεγχο στροφών).'));
    if (tmRaised != null && tmRaised <= tmIdle) {
      items.push(item('Ανάφλεξη', 'warn', 'Η προπορεία δεν αυξάνεται με τις στροφές', 'Πιθανή καθυστέρηση από knock ή λειτουργία προστασίας.'));
    }
  }

  // ---- Τάση
  const vRun = col(seg.running, 'RV');
  const vOff = col(seg.off, 'RV');
  if (vRun.length) {
    const v = mean(vRun);
    m.charge = r1(v, 2);
    const st = v < 13.0 ? 'bad' : v < 13.2 ? 'warn' : v <= 14.8 ? 'ok' : 'bad';
    items.push(item('Ηλεκτρικό', st, `Τάση φόρτισης ${v.toFixed(2)} V (${Math.min(...vRun).toFixed(1)}–${Math.max(...vRun).toFixed(1)})`,
      st === 'ok' ? 'Φυσιολογική φόρτιση (13,2–14,8 V).' : v > 14.8 ? 'Υπερφόρτιση: έλεγξε ανορθωτή/ρυθμιστή.' : 'Χαμηλή φόρτιση: έλεγξε ανορθωτή/ρυθμιστή, στάτορα, φις και μπαταρία.'));
  }
  if (vOff.length) {
    const v = mean(vOff);
    m.batteryOff = r1(v, 2);
    const st = v >= 12.4 ? 'ok' : v >= 12.0 ? 'warn' : 'bad';
    items.push(item('Ηλεκτρικό', st, `Μπαταρία με σβηστό κινητήρα ${v.toFixed(2)} V`,
      st === 'ok' ? 'Καλή κατάσταση φόρτισης.' : 'Μισοφορτισμένη ή κουρασμένη μπαταρία (γεμάτη ≈ 12,6–12,8 V). Μέτρησε μετά από ξεκούραση και κάνε τεστ φορτίου.'));
  }

  // ---- Θερμοκρασίες
  const cool = col(rows, '05');
  if (cool.length) {
    const max = Math.max(...cool);
    m.coolantMax = r1(max);
    const runTime = seg.running.length ? seg.running[seg.running.length - 1].t - seg.running[0].t : 0;
    if (max > 115) items.push(item('Θερμοκρασίες', 'bad', `Ψυκτικό έως ${max.toFixed(0)} °C`, 'Υπερθέρμανση: στάθμη υγρού, βεντιλατέρ, θερμοστάτης, αντλία νερού.'));
    else if (max > 108) items.push(item('Θερμοκρασίες', 'warn', `Ψυκτικό έως ${max.toFixed(0)} °C`, 'Υψηλή — έλεγξε αν ανάβει το βεντιλατέρ.'));
    else if (runTime > 600 && max < 70) items.push(item('Θερμοκρασίες', 'warn', `Ψυκτικό μόνο ${max.toFixed(0)} °C μετά από ${Math.round(runTime / 60)} λεπτά`, 'Πιθανός θερμοστάτης κολλημένος ανοιχτός ή αισθητήρας θερμοκρασίας.'));
    else items.push(item('Θερμοκρασίες', 'ok', `Ψυκτικό έως ${max.toFixed(0)} °C`, 'Εντός ορίων.'));
  }
  const iat = col(seg.running, '0F');
  if (iat.length && Math.max(...iat) > 60) {
    items.push(item('Θερμοκρασίες', 'warn', `Θερμ. αέρα εισαγωγής έως ${Math.max(...iat).toFixed(0)} °C`, 'Θερμική επιβάρυνση εισαγωγής — μειώνει απόδοση, μπορεί να προκαλέσει καθυστέρηση ανάφλεξης.'));
  }

  // ---- Ρελαντί
  const rpm = col(seg.idle, '0C');
  if (rpm.length >= 5) {
    const mu = mean(rpm); const cv = std(rpm) / mu;
    m.idleRpm = r1(mu, 0); m.idleCv = r1(cv * 100, 1);
    const st = cv > 0.08 ? 'bad' : cv > 0.05 ? 'warn' : 'ok';
    items.push(item('Ρελαντί', st, `Ρελαντί ${mu.toFixed(0)} rpm, διακύμανση ${(cv * 100).toFixed(1)}%`,
      st === 'ok' ? 'Σταθερό.' : 'Ασταθές ρελαντί: εισροή αέρα, βρόμικο σώμα πεταλούδας/βαλβίδα ρελαντί, μπουζί, misfire.'));
  }

  return finish(items, m);
}

function finish(items, metrics) {
  const order = { bad: 0, warn: 1, info: 2, ok: 3, na: 4 };
  items.sort((a, b) => order[a.status] - order[b.status]);
  const bad = items.filter((i) => i.status === 'bad').length;
  const warn = items.filter((i) => i.status === 'warn').length;
  return { items, metrics, summary: bad ? 'bad' : warn ? 'warn' : 'ok', counts: { bad, warn }, at: Date.now() };
}

// Μετρικές για σύγκριση με προηγούμενες συνεδρίες: [κλειδί, ετικέτα, μονάδα, όριο αλλαγής]
export const COMPARE_METRICS = [
  ['trimIdle', 'Trims ρελαντί', '%', 4], ['trimRaised', 'Trims ~2500', '%', 4], ['ltft', 'LTFT', '%', 3],
  ['charge', 'Τάση φόρτισης', 'V', 0.3], ['batteryOff', 'Μπαταρία (σβηστό)', 'V', 0.2],
  ['idleRpm', 'Ρελαντί', 'rpm', 150], ['idleCv', 'Διακύμανση ρελαντί', '%', 2],
  ['o2Rate', 'Εναλλαγές λάμδα', '/λεπτό', 10], ['timingIdle', 'Προπορεία ρελαντί', '°', 3],
  ['coolantMax', 'Μέγ. ψυκτικό', '°C', 6],
];

export function compareReports(cur, prev) {
  return COMPARE_METRICS.map(([k, label, unit, thr]) => {
    const a = cur?.metrics?.[k]; const b = prev?.metrics?.[k];
    if (a == null || b == null) return null;
    const d = a - b;
    return { label, unit, now: a, before: b, delta: +d.toFixed(2), notable: Math.abs(d) >= thr };
  }).filter(Boolean);
}
