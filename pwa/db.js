const DB_NAME_BASE = "klub_db";
const DB_VERSION = 2;

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
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
  request.onupgradeneeded = () => {
    const db = request.result;
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
    run(transaction);
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
  const ns = sanitizeNamespace(opts.namespace);
  const dbName = ns ? `${DB_NAME_BASE}__${ns}` : DB_NAME_BASE;
  const db = await openDb(dbName);
  await ensureDefaults(db);
  const onWrite = typeof opts.onWrite === "function" ? opts.onWrite : null;
  return {
    dbName,
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
      const transaction = db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      await withRequest(store.put(value));
      onWrite?.();
    },
    async delete(storeName, key) {
      const transaction = db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      await withRequest(store.delete(key));
      onWrite?.();
    },
    async clear(storeName) {
      const transaction = db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      await withRequest(store.clear());
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
    async runTx(storeNames, mode, runner) {
      await tx(db, storeNames, mode, runner);
      if (String(mode) === "readwrite") onWrite?.();
    },
    uuid
  };
}

async function ensureDefaults(db) {
  const transaction = db.transaction(["settings", "attendance", "payments", "scopes"], "readwrite");
  const settings = transaction.objectStore("settings");
  const scopes = transaction.objectStore("scopes");

  const existingPricing = await withRequest(settings.get("pricing")).catch(() => undefined);
  if (!existingPricing) {
    const pricing = {
      key: "pricing",
      currency: "PLN",
      feeBySessionsPerWeek: {
        "1": 120,
        "2": 200,
        "3": 260,
        "4": 320,
        "all": 320
      }
    };
    await withRequest(settings.put(pricing));
  }

  // Default scope catalog
  const scopesCount = await withRequest(scopes.count()).catch(() => 0);
  if (!scopesCount) {
    const defaults = [
      { name: "Rozgrzewka" },
      { name: "Technika" },
      { name: "Taktyka" },
      { name: "Sparing" },
      { name: "Motoryka" }
    ];
    for (const s of defaults) {
      await withRequest(scopes.put({ id: uuid(), name: s.name, createdAt: Date.now() }));
    }
  }

  // One-time maintenance: clear attendance + payments (keep people/groups/memberships).
  const maintenanceKey = "maintenance_clear_attendance_payments_v1";
  const done = await withRequest(settings.get(maintenanceKey)).catch(() => undefined);
  if (!done) {
    await withRequest(transaction.objectStore("attendance").clear());
    await withRequest(transaction.objectStore("payments").clear());
    await withRequest(
      settings.put({
        key: maintenanceKey,
        doneAt: Date.now()
      })
    );
  }

  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error("Settings tx error"));
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
