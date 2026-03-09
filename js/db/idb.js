import { DB_NAME, DB_VERSION, onUpgrade } from './schema.js';

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => onUpgrade(e.target.result, e.oldVersion);
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return _db.transaction(store, mode).objectStore(store);
}

function req2p(r) {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export function getAll(store) {
  return req2p(tx(store).getAll());
}

export function getById(store, id) {
  return req2p(tx(store).get(id));
}

export function put(store, record) {
  return req2p(tx(store, 'readwrite').put(record));
}

export function remove(store, id) {
  return req2p(tx(store, 'readwrite').delete(id));
}

export function getByIndex(store, indexName, value) {
  return req2p(tx(store).index(indexName).getAll(value));
}

export function getByDateRange(store, indexName, lower, upper) {
  const range = IDBKeyRange.bound(lower, upper);
  return req2p(tx(store).index(indexName).getAll(range));
}

export function getAllByIndex(store, indexName) {
  return req2p(tx(store).index(indexName).getAll());
}

export function clearStore(store) {
  return req2p(tx(store, 'readwrite').clear());
}

// Insert many records in a single transaction (efficient bulk import)
export function putBulk(store, records) {
  return new Promise((resolve, reject) => {
    const transaction = _db.transaction(store, 'readwrite');
    const os = transaction.objectStore(store);
    records.forEach(r => os.put(r));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}
