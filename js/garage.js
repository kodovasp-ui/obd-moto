// Γκαράζ: προφίλ ανά όχημα, ώστε να αλλάζεις μηχανή/αυτοκίνητο χωρίς ρυθμίσεις.
// Κλειδί το VIN. Αν η ECU δεν δίνει VIN (συχνό σε μοτοσυκλέτες), χρησιμοποιούμε
// το πρωτόκολλο + τα υποστηριζόμενα PID ως «δακτυλικό αποτύπωμα».

const KEY = 'obd.garage';

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
};
const write = (g) => {
  try { localStorage.setItem(KEY, JSON.stringify(g)); } catch { /* χωρίς αποθήκευση */ }
};

/** Σταθερό αναγνωριστικό όταν δεν υπάρχει VIN. */
export function fingerprint({ vin, protocolNum, supported }) {
  if (vin) return vin;
  const sig = (supported || []).join('');
  let h = 0;
  for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) | 0;
  return `NOVIN-${protocolNum || '?'}-${(h >>> 0).toString(36)}`;
}

export const listVehicles = () => Object.values(read())
  .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));

export const getVehicle = (id) => read()[id] || null;

/** Καταγράφει/ενημερώνει το όχημα που μόλις συνδέθηκε. Επιστρέφει το προφίλ. */
export function touchVehicle({ vin, protocol, protocolNum, supported, elm }) {
  const id = fingerprint({ vin, protocolNum, supported });
  const g = read();
  const prev = g[id] || {};
  const now = Date.now();
  g[id] = {
    id,
    vin: vin || prev.vin || null,
    name: prev.name || null,
    protocol: protocol || prev.protocol || null,
    protocolNum: protocolNum || prev.protocolNum || null,
    pidCount: supported?.length ?? prev.pidCount ?? 0,
    adapter: elm || prev.adapter || null,
    firstSeen: prev.firstSeen || now,
    lastSeen: now,
    visits: (prev.visits || 0) + 1,
    notes: prev.notes || '',
  };
  write(g);
  return g[id];
}

export function renameVehicle(id, name) {
  const g = read();
  if (!g[id]) return null;
  g[id].name = name?.trim() || null;
  write(g);
  return g[id];
}

export function setNotes(id, notes) {
  const g = read();
  if (!g[id]) return null;
  g[id].notes = notes || '';
  write(g);
  return g[id];
}

/** Σβήνει το όχημα και τις ρυθμίσεις του (επιλογή PID). */
export function deleteVehicle(id) {
  const g = read();
  const v = g[id];
  delete g[id];
  write(g);
  try {
    localStorage.removeItem('obd.pids.' + id);
    if (v?.vin) localStorage.removeItem('obd.pids.' + v.vin);
  } catch { /* χωρίς αποθήκευση */ }
}

export const vehicleLabel = (v) => v.name || v.vin || `Όχημα ${v.id.slice(0, 12)}`;
