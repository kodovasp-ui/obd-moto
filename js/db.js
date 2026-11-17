// Ιστορικό συνεδριών σε IndexedDB (τοπικά στη συσκευή).
const DB_NAME = 'obd-moto';
const STORE = 'sessions';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
      s.createIndex('startedAt', 'startedAt');
      s.createIndex('vin', 'vin');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

export const saveSession = (s) => tx('readwrite', (st) => st.put(s));
export const getSession = (id) => tx('readonly', (st) => st.get(id));
export const deleteSession = (id) => tx('readwrite', (st) => st.delete(id));

/** Λίστα συνεδριών (χωρίς τα δείγματα), νεότερες πρώτα. */
export async function listSessions() {
  const all = await tx('readonly', (st) => st.getAll());
  return (all || []).map(({ rows, ...meta }) => ({ ...meta, samples: rows?.length || 0 }))
    .sort((a, b) => b.startedAt - a.startedAt);
}
