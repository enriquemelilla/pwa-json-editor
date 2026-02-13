const DB_NAME = "json_pwa_editor_db";
const DB_VERSION = 1;
const STORE = "docs";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode = "readonly") {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function listDocs() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = req.result || [];
      // Orden por updatedAt DESC
      items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(items);
      db.close();
    };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

export async function getDoc(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db);
    const req = store.get(id);
    req.onsuccess = () => { resolve(req.result || null); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

export async function putDoc(doc) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db, "readwrite");
    const req = store.put(doc);
    req.onsuccess = () => { resolve(true); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

export async function deleteDoc(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db, "readwrite");
    const req = store.delete(id);
    req.onsuccess = () => { resolve(true); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}
