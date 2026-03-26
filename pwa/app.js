import { createStore } from "./db.js";
import { renderAttendance, renderAttendanceGroup } from "./pages/attendance.js";
import { renderGroups, renderGroupDetail } from "./pages/groups.js";
import { renderPayments } from "./pages/payments.js";
import { renderPeople } from "./pages/people.js";
import { renderStats } from "./pages/stats.js";
import { renderSettings } from "./pages/settings.js";
import { el, setActiveTab } from "./ui.js";
import { exportAll, replaceAll } from "./logic.js";

const state = {
  store: null,
  now: new Date(),
  pricing: null,
  user: null,
  renderNonce: 0,
  syncSuspended: false
};

let syncTimer = null;
let syncInFlight = false;
let syncDirty = false;
let syncLastAttemptAt = 0;
let pullTimer = null;
let lastAppliedUpdatedAt = 0;

function lastKey() {
  return state.user ? `klub_sync_updatedAt__${String(state.user).toLowerCase()}` : "klub_sync_updatedAt__anon";
}

function dirtyKey() {
  return state.user ? `klub_sync_dirty__${String(state.user).toLowerCase()}` : "klub_sync_dirty__anon";
}

function loadLastApplied() {
  try {
    lastAppliedUpdatedAt = Number(localStorage.getItem(lastKey()) ?? "0") || 0;
  } catch {
    lastAppliedUpdatedAt = 0;
  }
}

function saveLastApplied(v) {
  lastAppliedUpdatedAt = Number(v || 0) || 0;
  try {
    localStorage.setItem(lastKey(), String(lastAppliedUpdatedAt));
  } catch {
    // ignore
  }
}

function loadDirtyFlag() {
  try {
    syncDirty = localStorage.getItem(dirtyKey()) === "1";
  } catch {
    syncDirty = false;
  }
}

function saveDirtyFlag(v) {
  syncDirty = Boolean(v);
  try {
    localStorage.setItem(dirtyKey(), syncDirty ? "1" : "0");
  } catch {
    // ignore
  }
}

async function pushSyncNow() {
  if (!state.user) return;
  if (!state.store) return;
  if (state.syncSuspended) return;
  if (syncInFlight) {
    saveDirtyFlag(true);
    return;
  }
  const now = Date.now();
  // Basic backoff if server is down
  if (now - syncLastAttemptAt < 2500) return;
  syncLastAttemptAt = now;

  syncInFlight = true;
  try {
    const payload = await exportAll(state.store);
    let res = await fetch("/api/sync/push", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.status === 404) {
      res = await fetch("/api/sync_push.php", {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
    }
    if (res.ok) {
      try {
        const json = await res.json();
        if (json?.updatedAt) {
          saveLastApplied(Number(json.updatedAt) || 0);
          saveDirtyFlag(false);
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore (offline / server error)
  } finally {
    syncInFlight = false;
    if (syncDirty) {
      syncDirty = false;
      scheduleAutoSync();
    }
  }
}

function scheduleAutoSync() {
  if (!state.user) return;
  if (state.syncSuspended) return;
  saveDirtyFlag(true);
  if (syncTimer) clearTimeout(syncTimer);
  // debounce: push after a short idle
  syncTimer = setTimeout(() => {
    syncTimer = null;
    pushSyncNow();
  }, 1200);
}

async function pullSyncIfNewer() {
  if (!state.user) return;
  if (!state.store) return;
  if (state.syncSuspended) return;
  // Avoid overwriting local changes that haven't been pushed yet
  if (syncInFlight || syncDirty || syncTimer) return;

  try {
    let res = await fetch("/api/sync/pull", { cache: "no-store" });
    if (res.status === 404) res = await fetch("/api/sync_pull.php", { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    if (!json?.exists || !json?.payload?.data) return;
    const updatedAt = Number(json.updatedAt ?? 0) || 0;
    if (updatedAt <= lastAppliedUpdatedAt) return;

    state.syncSuspended = true;
    await replaceAll(state.store, json.payload);
    state.syncSuspended = false;
    state.pricing = await state.store.get("settings", "pricing");
    saveLastApplied(updatedAt);
    saveDirtyFlag(false);
    await render();
  } catch {
    // ignore
  } finally {
    state.syncSuspended = false;
  }
}

function startAutoPull() {
  if (pullTimer) clearInterval(pullTimer);
  pullTimer = setInterval(() => {
    if (document.visibilityState === "visible") pullSyncIfNewer();
  }, 12000);
}

function routeParams() {
  const hash = location.hash || "#/attendance";
  const [path, qs] = hash.split("?");
  const params = new URLSearchParams(qs ?? "");
  return { path, params };
}

function navigate(hash) {
  if (location.hash === hash) {
    render();
    return;
  }
  location.hash = hash;
}

function setNow(date) {
  state.now = date;
}

function setPricing(pricing) {
  state.pricing = pricing;
}

async function render() {
  const nonce = ++state.renderNonce;
  const { path, params } = routeParams();
  setActiveTab(path);

  const mainRoot = document.getElementById("main");
  mainRoot.innerHTML = "";

  let view;
  const ctx = {
    store: state.store,
    now: state.now,
    setNow,
    pricing: state.pricing,
    setPricing,
    user: state.user,
    navigate,
    params
  };

  if (path === "#/attendance") view = await renderAttendance(ctx);
  else if (path === "#/attendance/group") view = await renderAttendanceGroup(ctx);
  else if (path === "#/payments") view = await renderPayments(ctx);
  else if (path === "#/stats") view = await renderStats(ctx);
  else if (path === "#/people") view = await renderPeople(ctx);
  else if (path === "#/groups") view = await renderGroups(ctx);
  else if (path === "#/groups/detail") view = await renderGroupDetail(ctx);
  else if (path === "#/settings") view = await renderSettings(ctx);
  else {
    navigate("#/attendance");
    return;
  }

  // If a newer render started while we were awaiting, skip DOM updates to avoid duplicates.
  if (nonce !== state.renderNonce) return;
  mainRoot.appendChild(view ?? el("div", { class: "container" }));
}

async function init() {
  // Detect authenticated user (Node server: /api/me, OVH PHP session: /api/me.php)
  try {
    const res = await fetch("/api/me", { cache: "no-store" });
    if (res.status === 401) {
      location.replace("/login.html");
      return;
    }
    if (res.ok) {
      const json = await res.json();
      state.user = json?.username ?? null;
    }
  } catch {
    // ignore
  }

  if (!state.user) {
    try {
      let res = await fetch("/api/me.php", { cache: "no-store" });
      if (res.status === 401) {
        location.replace("/login.html");
        return;
      }
      if (res.ok) {
        const json = await res.json();
        state.user = json?.username ?? null;
      }
    } catch {
      // ignore
    }
  }

  state.store = await createStore({ namespace: state.user, onWrite: scheduleAutoSync });
  state.pricing = await state.store.get("settings", "pricing");
  loadLastApplied();
  loadDirtyFlag();

  // Auto-pull from server on a fresh device (no trainees yet).
  try {
    const existing = await state.store.getAll("trainees");
    if ((existing?.length ?? 0) === 0 && state.user) {
      let res = await fetch("/api/sync/pull", { cache: "no-store" });
      if (res.status === 404) res = await fetch("/api/sync_pull.php", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (json?.exists && json?.payload?.data) {
          state.syncSuspended = true;
          await replaceAll(state.store, json.payload);
          state.syncSuspended = false;
          state.pricing = await state.store.get("settings", "pricing");
          saveLastApplied(Number(json.updatedAt ?? 0) || 0);
          saveDirtyFlag(false);
        }
      }
    }
  } catch {
    // ignore
  }

  if (syncDirty) {
    await pushSyncNow();
  }

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") pushSyncNow();
    if (document.visibilityState === "visible") pullSyncIfNewer();
  });
  window.addEventListener("pagehide", () => {
    pushSyncNow();
  });
  startAutoPull();

  window.addEventListener("hashchange", () => render());

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        reg.update().catch(() => {});
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => {
            location.reload();
          },
          { once: true }
        );
      })
      .catch(() => {});
  }

  if (!location.hash) {
    location.hash = "#/attendance";
    return;
  }
  await render();
}

init().catch((err) => {
  console.error(err);
  const mainRoot = document.getElementById("main");
  mainRoot.innerHTML = "";
  mainRoot.appendChild(
    el("div", { class: "container" }, [
      el("div", { class: "card" }, [
        el("div", { class: "title", text: "Błąd aplikacji" }),
        el("div", { class: "sub", text: String(err?.message ?? err) })
      ])
    ])
  );
});
