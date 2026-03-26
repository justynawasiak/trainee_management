import { exportAll, replaceAll } from "../logic.js";
import { btn, closeModal, el, openModal, setActions, setTitle, showModalError, showToast } from "../ui.js";

async function doLogout() {
  try {
    let res = await fetch("/api/logout", { method: "POST" });
    if (res.status === 404) {
      await fetch("/api/logout.php", { method: "POST" });
    }
  } catch {
    // ignore
  }

  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    // ignore
  }

  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // ignore
  }

  location.href = "/";
}

export async function renderSettings({ store, pricing, setPricing, navigate, user }) {
  setTitle("Ustawienia");
  setActions([]);

  const main = el("div", { class: "container" });

  if (user) {
    main.appendChild(
      el("div", { class: "card card--hero" }, [
        el("div", { class: "title", text: user }),
        el("div", { class: "row", style: "justify-content:flex-end;margin-top:10px" }, [
          btn("Wyloguj", doLogout, "btn--ghost")
        ])
      ])
    );
  } else {
    main.appendChild(
      el("div", { class: "card card--hero" }, [
        el("div", { class: "title", text: "Logowanie" }),
        el("div", { class: "sub", text: "Jeśli jesteś na serwerze (PHP), zaloguj się tutaj." }),
        el("div", { class: "row", style: "justify-content:flex-end;margin-top:10px" }, [
          el("a", { class: "btn btn--primary", href: "/login.html", text: "Zaloguj" })
        ])
      ])
    );
  }

  const tiers = pricing.feeBySessionsPerWeek ?? {};
  const allValue = tiers.all !== undefined ? Number(tiers.all) : "";
  const keys = Array.from(new Set([...Object.keys(tiers), "1", "2", "3", "4"]))
    .map((k) => Number(k))
    .filter((k) => Number.isFinite(k))
    .sort((a, b) => a - b);

  const inputs = new Map();
  const list = el("div", { class: "list" });
  for (const k of keys) {
    const value = Number(tiers[String(k)] ?? 0);
    const input = el("input", { class: "input", type: "number", min: "0", step: "1", value: String(value) });
    inputs.set(k, input);
    list.appendChild(
      el("div", { class: "item" }, [
        el("div", { class: "stack" }, [
          el("div", { class: "title", text: `${k} trening${k === 1 ? "" : "i"}` }),
        ]),
        el("div", { style: "min-width:160px" }, [input])
      ])
    );
  }

  const allInput = el("input", { class: "input", type: "number", min: "0", step: "1", value: String(allValue) });
  list.appendChild(
    el("div", { class: "item" }, [
      el("div", { class: "stack" }, [
        el("div", { class: "title", text: "Wszystkie" }),
        el("div", { class: "sub", text: "Kwota dla > max treningów" })
      ]),
      el("div", { style: "min-width:160px" }, [allInput])
    ])
  );

  main.appendChild(
    el("div", { class: "card card--hero" }, [
      el("div", { class: "title", text: "Kwoty (auto)" }),
      el("div", { class: "sub", text: "Domyślne kwoty wg liczby treningów/tydzień." }),
      el("div", { class: "hr" }),
      list,
      el("div", { class: "row", style: "justify-content:flex-end;margin-top:10px" }, [
        btn(
          "Zapisz",
          async () => {
            const next = {};
            for (const [k, input] of inputs) next[String(k)] = Number(input.value ?? 0);
            const all = (allInput.value ?? "").trim();
            if (all !== "") next.all = Number(all);
            const updated = { ...pricing, feeBySessionsPerWeek: next };
            await store.put("settings", updated);
            setPricing(updated);
            showToast("Zapisano ustawienia");
          },
          "btn--good"
        )
      ])
    ])
  );

  async function openScopeEditor(scopeId) {
    const scope = scopeId ? await store.get("scopes", scopeId) : null;
    const name = el("input", { class: "input", placeholder: "Nazwa", value: scope?.name ?? "" });

    openModal({
      title: scope ? "Edytuj zakres" : "Dodaj zakres",
      body: el("div", { class: "stack" }, [name]),
      footer: [
        scope
          ? btn("Usuń", async () => {
              await store.delete("scopes", scope.id);
              closeModal();
              navigate("#/settings");
            })
          : null,
        el("button", { class: "btn", value: "cancel", text: "Anuluj" }),
        btn(
          "Zapisz",
          async (e) => {
            e.preventDefault();
            const n = (name.value ?? "").trim();
            if (!n) {
              showModalError("Podaj nazwę");
              name.focus();
              return;
            }
            const row = scope ?? { id: store.uuid(), createdAt: Date.now() };
            row.name = n;
            row.updatedAt = Date.now();
            await store.put("scopes", row);
            closeModal();
            navigate("#/settings");
          },
          "btn--good"
        )
      ].filter(Boolean)
    });
  }

  const scopes = (await store.getAll("scopes"))
    .slice()
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  main.appendChild(
    el("div", { class: "card card--hero" }, [
      el("div", { class: "row space" }, [
        el("div", { class: "title", text: "Zakres zajęć" }),
        btn("Dodaj", () => openScopeEditor(), "btn--primary")
      ]),
      el("div", { class: "hr" }),
      scopes.length
        ? el(
            "div",
            { class: "list" },
            scopes.map((s) =>
              el("div", { class: "item", role: "button", tabindex: "0", onclick: () => openScopeEditor(s.id) }, [
                el("div", { class: "title", text: s.name ?? "Pozycja" }),
                el("div", { class: "sub muted", text: "›" })
              ])
            )
          )
        : el("div", { class: "sub muted", text: "Brak." })
    ])
  );

  main.appendChild(
    el("div", { class: "card card--hero" }, [
      el("div", { class: "title", text: "Backup" }),
      el("div", { class: "sub", text: "Eksport/import JSON (przenoszenie danych między urządzeniami)." }),
      el("div", { class: "hr" }),
      el("div", { class: "row", style: "gap:8px;flex-wrap:wrap" }, [
        btn("Eksport", async () => {
          const payload = await exportAll(store);
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `klub-backup-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
        }),
        btn("Import", async () => {
          const input = el("input", { type: "file", accept: "application/json" });
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            const text = await file.text();
            let json;
            try {
              json = JSON.parse(text);
            } catch {
              showToast("Nieprawidłowy plik JSON");
              return;
            }
            try {
              await replaceAll(store, json);
            } catch (err) {
              showToast(String(err?.message ?? err));
              return;
            }
            const updatedPricing = await store.get("settings", "pricing");
            setPricing(updatedPricing);
            // Best-effort: push imported data to server (if sync API exists)
            try {
              const payload = await exportAll(store);
              let res = await fetch("/api/sync/push", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload)
              });
              if (res.status === 404) {
                await fetch("/api/sync_push.php", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(payload)
                });
              }
            } catch {
              // ignore
            }
            showToast("Zaimportowano dane z pliku");
            navigate("#/attendance");
          };
          input.click();
        })
      ])
    ])
  );

  if (user) {
    async function syncPull() {
      let res = await fetch("/api/sync/pull", { cache: "no-store" });
      if (res.status === 404) res = await fetch("/api/sync_pull.php", { cache: "no-store" });
      if (!res.ok) {
        showToast("Nie udało się pobrać danych");
        return;
      }
      const json = await res.json();
      if (!json?.exists || !json?.payload) {
        showToast("Brak danych na serwerze");
        return;
      }
      try {
        await replaceAll(store, json.payload);
      } catch (e) {
        showToast(String(e?.message ?? e));
        return;
      }
      try {
        const key = `klub_sync_updatedAt__${String(user).toLowerCase()}`;
        const v = Number(json.updatedAt ?? 0) || 0;
        if (v) localStorage.setItem(key, String(v));
      } catch {
        // ignore
      }
      const updatedPricing = await store.get("settings", "pricing");
      setPricing(updatedPricing);
      showToast("Pobrano dane");
      navigate("#/attendance");
    }

    async function syncPush() {
      const payload = await exportAll(store);
      let res = await fetch("/api/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.status === 404) {
        res = await fetch("/api/sync_push.php", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
      }
      if (!res.ok) {
        showToast("Nie udało się wysłać danych");
        return;
      }
      showToast("Wysłano dane");
    }

    main.appendChild(
      el("div", { class: "card card--hero" }, [
        el("div", { class: "title", text: "Synchronizacja" }),
        el("div", { class: "hr" }),
        el("div", { class: "row", style: "gap:8px;flex-wrap:wrap" }, [
          btn("Pobierz", syncPull),
          btn("Wyślij", syncPush, "btn--good")
        ])
      ])
    );
  }

  return main;
}
