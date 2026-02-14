const DB_NAME = "json_pwa_editor_db";
const DB_VERSION = 2;

const STORE_DOCS = "docs";
const STORE_RESULTS = "results";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      // Docs
      if (!db.objectStoreNames.contains(STORE_DOCS)) {
        const store = db.createObjectStore(STORE_DOCS, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      } else {
        // asegurar index updatedAt
        const s = req.transaction.objectStore(STORE_DOCS);
        if (!s.indexNames.contains("updatedAt")) s.createIndex("updatedAt", "updatedAt");
      }

      // Results (historial)
      if (!db.objectStoreNames.contains(STORE_RESULTS)) {
        const r = db.createObjectStore(STORE_RESULTS, { keyPath: "id" });
        r.createIndex("endedAt", "endedAt");
        r.createIndex("docId", "docId");
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function makeId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ===================== DOCS =====================

export async function listDocs() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db, STORE_DOCS);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = req.result || [];
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
    const store = tx(db, STORE_DOCS);
    const req = store.get(id);
    req.onsuccess = () => { resolve(req.result || null); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

export async function putDoc(doc) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db, STORE_DOCS, "readwrite");
    const req = store.put(doc);
    req.onsuccess = () => { resolve(true); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

export async function deleteDoc(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db, STORE_DOCS, "readwrite");
    const req = store.delete(id);
    req.onsuccess = () => { resolve(true); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

// ===================== RESULTS (HISTORIAL) =====================

export async function addResult(result) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db, STORE_RESULTS, "readwrite");
    const doc = { ...result };
    if (!doc.id) doc.id = makeId("res");
    const req = store.put(doc);
    req.onsuccess = () => { resolve(doc.id); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

export async function listResults(limit = 200) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db, STORE_RESULTS);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = req.result || [];
      items.sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
      resolve(items.slice(0, limit));
      db.close();
    };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

export async function clearResults() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db, STORE_RESULTS, "readwrite");
    const req = store.clear();
    req.onsuccess = () => { resolve(true); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}
