import { createStore } from "./db.js";
import { renderAttendance, renderAttendanceGroup } from "./pages/attendance.js";
import { renderGroups, renderGroupDetail } from "./pages/groups.js";
import { renderPayments } from "./pages/payments.js";
import { renderPeople } from "./pages/people.js";
import { renderStats } from "./pages/stats.js";
import { renderSettings } from "./pages/settings.js";
import { el, setActiveTab } from "./ui.js";
import { createSync } from "./sync.js";

const state = {
  store: null,
  now: new Date(),
  pricing: null,
  user: null,
  renderNonce: 0,
  sync: null
};

function routeParams() {
  const hash = location.hash || "#/attendance";
  const [path, qs] = hash.split("?");
  const params = new URLSearchParams(qs ?? "");
  return { path, params };
}

function navigate(hash) {
  if (location.hash === hash) {
    render().catch(showAppError);
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
    sync: state.sync,
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
  let response = await fetch("/api/me", { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (response.status === 404) response = await fetch("/api/me.php", { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (response.status === 401) { location.replace("/login.html"); return; }
  if (!response.ok) throw new Error("Nie można potwierdzić konta. Spróbuj ponownie.");
  const identity = await response.json();
  if (!identity.username || !identity.accountId) throw new Error("Zaktualizuj serwer i odśwież aplikację.");
  state.user = identity.username;
  state.store = await createStore({
    accountId: identity.accountId,
    legacyNamespace: identity.legacyNamespace,
    onBeforeWrite: () => state.sync?.changed(),
    onWrite: () => state.sync?.schedule()
  });
  state.pricing = await state.store.get("settings", "pricing");
  state.sync = createSync({
    store: state.store,
    accountId: identity.accountId,
    legacyNamespace: identity.legacyNamespace,
    legacyStateKey: identity.legacyNamespace ? identity.username.toLowerCase() : null,
    initialDirty: state.store.migratedLegacy,
    resetState: state.store.freshDatabase,
    onStatus: message => {
      const status = document.getElementById("syncStatus");
      if (status) { status.textContent = message; status.hidden = !message; }
    },
    onApplied: async () => {
      state.pricing = await state.store.get("settings", "pricing");
      await render();
    }
  });
  if (state.store.freshDatabase) await state.sync.pull({ force: true });
  else if (state.sync.dirty) await state.sync.push();
  else await state.sync.pull();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (state.sync.dirty) state.sync.push();
      else state.sync.pull();
    }
  });
  window.addEventListener("online", () => state.sync.dirty ? state.sync.push() : state.sync.pull());
  const pullTimer = setInterval(() => {
    if (document.visibilityState === "visible" && !state.sync.dirty) state.sync.pull();
  }, 12000);
  window.addEventListener("pagehide", () => { clearInterval(pullTimer); state.sync.stop(); }, { once: true });

  window.addEventListener("hashchange", () => render().catch(showAppError));

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

function showAppError(err) {
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
}

init().catch(showAppError);
