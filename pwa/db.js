const DB_NAME_BASE = "klub_db";
const DB_VERSION = 1;

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

    const trainees = db.createObjectStore("trainees", { keyPath: "id" });
    trainees.createIndex("byName", ["lastName", "firstName"], { unique: false });

    const groups = db.createObjectStore("groups", { keyPath: "id" });
    groups.createIndex("byName", "name", { unique: false });

    const memberships = db.createObjectStore("memberships", { keyPath: "id" });
    memberships.createIndex("byGroup", "groupId", { unique: false });
    memberships.createIndex("byTrainee", "traineeId", { unique: false });
    memberships.createIndex("byGroupTrainee", ["groupId", "traineeId"], { unique: true });

    const attendance = db.createObjectStore("attendance", { keyPath: "id" });
    attendance.createIndex("byDateGroup", ["dateISO", "groupId"], { unique: false });
    attendance.createIndex("byDateGroupTrainee", ["dateISO", "groupId", "traineeId"], { unique: true });
    attendance.createIndex("byTrainee", "traineeId", { unique: false });

    const payments = db.createObjectStore("payments", { keyPath: "id" });
    payments.createIndex("byMonthTrainee", ["month", "traineeId"], { unique: true });
    payments.createIndex("byMonth", "month", { unique: false });

    db.createObjectStore("settings", { keyPath: "key" });
  };

  return withRequest(request);
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
    },
    async delete(storeName, key) {
      const transaction = db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      await withRequest(store.delete(key));
    },
    async clear(storeName) {
      const transaction = db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      await withRequest(store.clear());
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
    },
    uuid
  };
}

async function ensureDefaults(db) {
  const transaction = db.transaction(["settings", "attendance", "payments"], "readwrite");
  const settings = transaction.objectStore("settings");

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
