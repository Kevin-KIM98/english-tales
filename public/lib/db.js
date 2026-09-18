// 휴대폰 안 저장소 (IndexedDB). 레슨처럼 큰 데이터를 보관한다 (localStorage 5MB 한도 회피)
const DB_NAME = 'english-tales';
const STORE = 'kv';
let dbp = null;

function open() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const db = {
  get: (key) => tx('readonly', (s) => s.get(key)).catch(() => undefined),
  set: (key, value) => tx('readwrite', (s) => s.put(value, key)),
  del: (key) => tx('readwrite', (s) => s.delete(key)),
  keys: () => tx('readonly', (s) => s.getAllKeys()).catch(() => []),
};
