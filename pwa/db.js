import { STORE_NAMES } from "./validation.js";

const DB_NAME_BASE = "klub_db";
const DB_VERSION = 2;
const createdDatabases = new WeakSet();

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) return [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, "0")).join("");
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function withRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB error"));
  });
}

function openDb(dbName) {
  const request = indexedDB.open(dbName, DB_VERSION);
  request.onupgradeneeded = (event) => {
    const db = request.result;
    if (event.oldVersion === 0) createdDatabases.add(db);
    const t = request.transaction;

    function getOrCreateStore(name, opts) {
      if (db.objectStoreNames.contains(name)) return t.objectStore(name);
      return db.createObjectStore(name, opts);
    }

    function ensureIndex(store, indexName, keyPath, options) {
      if (store.indexNames.contains(indexName)) return;
      store.createIndex(indexName, keyPath, options);
    }

    const trainees = getOrCreateStore("trainees", { keyPath: "id" });
    ensureIndex(trainees, "byName", ["lastName", "firstName"], { unique: false });

    const groups = getOrCreateStore("groups", { keyPath: "id" });
    ensureIndex(groups, "byName", "name", { unique: false });

    const memberships = getOrCreateStore("memberships", { keyPath: "id" });
    ensureIndex(memberships, "byGroup", "groupId", { unique: false });
    ensureIndex(memberships, "byTrainee", "traineeId", { unique: false });
    ensureIndex(memberships, "byGroupTrainee", ["groupId", "traineeId"], { unique: true });

    const attendance = getOrCreateStore("attendance", { keyPath: "id" });
    ensureIndex(attendance, "byDateGroup", ["dateISO", "groupId"], { unique: false });
    ensureIndex(attendance, "byDateGroupTrainee", ["dateISO", "groupId", "traineeId"], { unique: true });
    ensureIndex(attendance, "byTrainee", "traineeId", { unique: false });

    const payments = getOrCreateStore("payments", { keyPath: "id" });
    ensureIndex(payments, "byMonthTrainee", ["month", "traineeId"], { unique: true });
    ensureIndex(payments, "byMonth", "month", { unique: false });

    const scopes = getOrCreateStore("scopes", { keyPath: "id" });
    ensureIndex(scopes, "byName", "name", { unique: false });

    const sessionScopes = getOrCreateStore("sessionScopes", { keyPath: "id" });
    ensureIndex(sessionScopes, "byDateGroup", ["dateISO", "groupId"], { unique: true });

    getOrCreateStore("settings", { keyPath: "key" });
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Nie mogę otworzyć bazy danych. Zamknij inne karty z aplikacją i odśwież."));
    }, 8000);

    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      db.onversionchange = () => {
        try {
          db.close();
        } catch {
          // ignore
        }
      };
      resolve(db);
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error ?? new Error("IndexedDB error"));
    };
    request.onblocked = () => {
      clearTimeout(timer);
      reject(new Error("Aktualizacja bazy jest zablokowana (inna karta/urządzenie ma otwartą aplikację). Zamknij ją i odśwież."));
    };
  });
}

function tx(db, storeNames, mode, run) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Transaction error"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Transaction abort"));
    try {
      const result = run(transaction);
      if (result?.then) throw new Error("Transaction runner must be synchronous");
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

function sanitizeNamespace(input) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function createStore(opts = {}) {
  if (opts.accountId !== undefined && !/^[a-f0-9]{64}$/.test(opts.accountId)) throw new Error("Nieprawidłowe konto");
  const ns = opts.accountId ? `account_${opts.accountId}` : sanitizeNamespace(opts.namespace);
  const dbName = ns ? `${DB_NAME_BASE}__${ns}` : DB_NAME_BASE;
  const db = await openDb(dbName);
  const migratedLegacy = opts.accountId && opts.legacyNamespace ? await migrateLegacyDatabase(db, opts.legacyNamespace) : false;
  await ensureDefaults(db);
  const onWrite = typeof opts.onWrite === "function" ? opts.onWrite : null;
  const beforeWrite = typeof opts.onBeforeWrite === "function" ? opts.onBeforeWrite : null;
  return {
    dbName,
    migratedLegacy,
    freshDatabase: createdDatabases.has(db) && !migratedLegacy,
    async removeLocalData() {
      db.close();
      const names = [dbName];
      if (opts.legacyNamespace) names.push(`${DB_NAME_BASE}__${sanitizeNamespace(opts.legacyNamespace)}`);
      for (const name of names) await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Zamknij inne karty aplikacji, aby usunąć dane lokalne."));
      });
    },
    async getAll(storeName) {
      const transaction = db.transaction([storeName], "readonly");
      const store = transaction.objectStore(storeName);
      return withRequest(store.getAll());
    },
    async get(storeName, key) {
      const transaction = db.transaction([storeName], "readonly");
      const store = transaction.objectStore(storeName);
      return withRequest(store.get(key));
    },
    async put(storeName, value) {
      beforeWrite?.();
      await tx(db, [storeName], "readwrite", transaction => transaction.objectStore(storeName).put(value));
      onWrite?.();
    },
    async delete(storeName, key) {
      beforeWrite?.();
      await tx(db, [storeName], "readwrite", transaction => transaction.objectStore(storeName).delete(key));
      onWrite?.();
    },
    async clear(storeName) {
      beforeWrite?.();
      await tx(db, [storeName], "readwrite", transaction => transaction.objectStore(storeName).clear());
      onWrite?.();
    },
    async getAllByIndex(storeName, indexName, query) {
      const transaction = db.transaction([storeName], "readonly");
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      return withRequest(index.getAll(query));
    },
    async getByIndex(storeName, indexName, query) {
      const transaction = db.transaction([storeName], "readonly");
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      return withRequest(index.get(query));
    },
    async getSnapshot(storeNames) {
      const transaction = db.transaction(storeNames, "readonly");
      const entries = await Promise.all(storeNames.map(async name => [name, await withRequest(transaction.objectStore(name).getAll())]));
      return Object.fromEntries(entries);
    },
    async runTx(storeNames, mode, runner, { notify = true } = {}) {
      if (mode === "readwrite" && notify) beforeWrite?.();
      await tx(db, storeNames, mode, runner);
      if (mode === "readwrite" && notify) onWrite?.();
    },
    uuid
  };
}

async function migrateLegacyDatabase(db, namespace) {
  const marker = await withRequest(db.transaction(["settings"], "readonly").objectStore("settings").get("accountMigration"));
  const pricing = await withRequest(db.transaction(["settings"], "readonly").objectStore("settings").get("pricing"));
  // Imports replace settings, so the presence of initialized data also prevents remigration.
  if (marker || pricing) return false;
  const legacyName = `${DB_NAME_BASE}__${sanitizeNamespace(namespace)}`;
  const databases = indexedDB.databases ? await indexedDB.databases() : null;
  let copied = false;
  if (!databases || databases.some(entry => entry.name === legacyName)) {
    const legacy = await openDb(legacyName);
    try {
      const transaction = legacy.transaction(STORE_NAMES, "readonly");
      const rows = await Promise.all(STORE_NAMES.map(name => withRequest(transaction.objectStore(name).getAll())));
      copied = rows.some(entries => entries.length > 0);
      await tx(db, STORE_NAMES, "readwrite", transaction => {
        rows.forEach((entries, index) => entries.forEach(row => transaction.objectStore(STORE_NAMES[index]).put(row)));
      });
    } finally {
      legacy.close();
    }
  }
  await tx(db, ["settings"], "readwrite", transaction => {
    transaction.objectStore("settings").put({ key: "accountMigration", doneAt: Date.now() });
  });
  return copied;
}

async function ensureDefaults(db) {
  await tx(db, ["settings", "scopes"], "readwrite", transaction => {
    const settings = transaction.objectStore("settings");
    const request = settings.get("pricing");
    request.onsuccess = () => {
      if (request.result) return;
      settings.put({
        key: "pricing",
        currency: "PLN",
        feeBySessionsPerWeek: {
          "1": 120,
          "2": 200,
          "3": 260,
          "4": 320,
          "all": 320
        }
      });
      const scopes = transaction.objectStore("scopes");
      for (const name of ["Rozgrzewka", "Technika", "Taktyka", "Sparing", "Motoryka"]) {
        scopes.put({ id: uuid(), name, createdAt: Date.now() });
      }
    };
  });
}

export function normalizePhone(input) {
  return (input ?? "").replace(/[^\d+]/g, "").trim();
}

export function normalizeEmail(input) {
  return (input ?? "").trim().toLowerCase();
}

export function isoDate(d) {
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isoMonth(d) {
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

export function dayOfWeekIso(d) {
  const js = d.getDay(); // 0..6 (Sun..Sat)
  return js === 0 ? 7 : js;
}
