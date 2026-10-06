import { exportAll, replaceAll } from "./logic.js";

export function createSync({ store, accountId, legacyNamespace, legacyStateKey = legacyNamespace, initialDirty = false, resetState = false, onApplied = () => {}, onStatus = () => {},
  request = globalThis.fetch, storage = globalThis.localStorage, delay = globalThis.setTimeout, cancelDelay = globalThis.clearTimeout,
  token = () => [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, "0")).join(""), withLock = run => globalThis.navigator?.locks ?
    navigator.locks.request(`klub-sync-${accountId}`, run) : run() }) {
  const key = `klub_sync__${accountId}`;
  let memory = { revision: 0, pending: null };
  let timer = null;
  let running = false;
  let stopped = false;
  let conflict = false;
  let retryMs = 2500;
  let metadataUnavailable = false;
  let status = "";
  function parseMetadata(value) {
    const metadata = JSON.parse(value);
    if (!metadata || !Number.isSafeInteger(metadata.revision) || metadata.revision < 0 ||
      !(metadata.pending === null || typeof metadata.pending === "string")) throw new Error("Invalid sync metadata");
    return metadata;
  }
  function report(message) {
    status = metadataUnavailable ? "Nie można trwale zapisać stanu synchronizacji. Zachowaj backup; automatyczne pobieranie jest wstrzymane." : message;
    onStatus(status);
  }
  try {
    const existing = storage.getItem(key);
    if (existing) memory = parseMetadata(existing);
    else if (legacyNamespace) memory = {
      revision: Number(storage.getItem(`klub_sync_updatedAt__${legacyStateKey}`)) || 0,
      pending: storage.getItem(`klub_sync_dirty__${legacyStateKey}`) === "1" ? token() : null
    };
    memory = parseMetadata(JSON.stringify(memory));
  } catch { metadataUnavailable = true; report(""); }
  if (resetState) write({ revision: 0, pending: null });
  if (initialDirty) write({ ...memory, pending: token() });

  function read() {
    if (metadataUnavailable) return memory;
    try {
      const saved = storage.getItem(key);
      if (saved) memory = parseMetadata(saved);
    } catch { metadataUnavailable = true; report(""); }
    return memory;
  }
  function write(value) {
    memory = value;
    try { storage.setItem(key, JSON.stringify(value)); }
    catch { metadataUnavailable = true; report(""); }
  }
  function changed() {
    write({ ...read(), pending: token() });
    schedule();
  }
  function schedule(ms = 1200) {
    if (stopped || conflict) return;
    if (timer !== null) cancelDelay(timer);
    timer = delay(() => { timer = null; push(); }, ms);
  }
  async function api(path, options) {
    let response = await request(`/api/sync/${path}`, { ...options, signal: AbortSignal.timeout(15000) });
    if (response.status === 404) response = await request(`/api/sync_${path}.php`, { ...options, signal: AbortSignal.timeout(15000) });
    return response;
  }
  async function push() {
    if (stopped || running || conflict || !read().pending) return false;
    running = true;
    try {
      return await withLock(async () => {
        const before = { ...read() };
        if (!before.pending) return true;
        const payload = await exportAll(store);
        const response = await api("push", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, baseRevision: before.revision }) });
        if (response.status === 409 || response.status === 428) {
          conflict = true;
          if (timer !== null) { cancelDelay(timer); timer = null; }
          report("Konflikt synchronizacji. W Ustawieniach wyeksportuj lokalny backup, a następnie pobierz dane serwera.");
          return false;
        }
        if (!response.ok) throw new Error("Nie udało się wysłać danych");
        const result = await response.json();
        if (!Number.isSafeInteger(result.revision) || result.revision <= before.revision) throw new Error("Nieprawidłowe potwierdzenie synchronizacji");
        const current = read();
        write({ revision: result.revision, pending: current.pending === before.pending ? null : current.pending });
        retryMs = 2500;
        report("");
        return true;
      });
    } catch {
      report("Nie udało się zsynchronizować danych. Zmiany pozostają lokalnie; ponowię próbę.");
      retryMs = Math.min(retryMs * 2, 60000);
      return false;
    } finally {
      running = false;
      if (read().pending && !conflict) schedule(retryMs);
    }
  }
  async function pull({ force = false } = {}) {
    if (stopped || running || (!force && (read().pending || conflict || metadataUnavailable))) return false;
    running = true;
    try {
      return await withLock(async () => {
        const before = { ...read() };
        if (!force && before.pending) return false;
        const response = await api("pull", { cache: "no-store" });
        if (!response.ok) throw new Error("Nie udało się pobrać danych");
        const result = await response.json();
        if (!result.exists) {
          if (force) report("Na serwerze nie ma danych do pobrania. Dane lokalne zachowano.");
          return false;
        }
        const revision = result.revision ?? result.updatedAt;
        if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Nieprawidłowa rewizja");
        if (!force && revision <= before.revision) return false;
        const unchanged = () => read().pending === before.pending && read().revision === before.revision;
        if (!unchanged()) {
          if (force) report("Podczas pobierania zmieniły się dane lokalne. Spróbuj ponownie; dane lokalne zachowano.");
          return false;
        }
        await replaceAll(store, result.payload, { notify: false, shouldApply: unchanged });
        const current = read();
        write({ revision, pending: current.pending === before.pending ? null : current.pending });
        conflict = false;
        report("");
        await onApplied();
        return true;
      });
    } catch (error) {
      report(error.message || "Nie udało się pobrać danych. Dane lokalne zachowano.");
      return false;
    } finally { running = false; }
  }
  function stop() {
    stopped = true;
    if (timer !== null) cancelDelay(timer);
  }
  return { changed, schedule, push, pull, stop, get status() { return status; }, get conflicted() { return conflict; }, get dirty() { return Boolean(read().pending) || metadataUnavailable; }, get busy() { return running; } };
}
