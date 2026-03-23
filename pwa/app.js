import { createStore } from "./db.js";
import { renderAttendance, renderAttendanceGroup } from "./pages/attendance.js";
import { renderGroups, renderGroupDetail } from "./pages/groups.js";
import { renderPayments } from "./pages/payments.js";
import { renderPeople } from "./pages/people.js";
import { renderStats } from "./pages/stats.js";
import { renderSettings } from "./pages/settings.js";
import { el, setActiveTab } from "./ui.js";

const state = {
  store: null,
  now: new Date(),
  pricing: null,
  user: null,
  renderNonce: 0
};

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
      if (res.ok) {
        const json = await res.json();
        state.user = json?.username ?? null;
      }
    } catch {
      // ignore
    }
  }

  state.store = await createStore({ namespace: state.user });
  state.pricing = await state.store.get("settings", "pricing");

  // Auto-pull from server on a fresh device (no trainees yet).
  try {
    const existing = await state.store.getAll("trainees");
    if ((existing?.length ?? 0) === 0 && state.user) {
      let res = await fetch("/api/sync/pull", { cache: "no-store" });
      if (res.status === 404) res = await fetch("/api/sync_pull.php", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (json?.exists && json?.payload?.data) {
          const { replaceAll } = await import("./logic.js");
          await replaceAll(state.store, json.payload);
          state.pricing = await state.store.get("settings", "pricing");
        }
      }
    }
  } catch {
    // ignore
  }

  window.addEventListener("hashchange", () => render());

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
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
