import { exportAll, replaceAll } from "../logic.js";
import { nonnegativeNumber } from "../validation.js";
import { btn, closeModal, el, openModal, setActions, setTitle, showModalError, showToast } from "../ui.js";

async function doLogout(sync) {
  if (sync?.dirty && !(await sync.push())) {
    showToast("Najpierw zsynchronizuj lub wyeksportuj dane. Wylogowanie wstrzymano.");
    return;
  }
  try {
    let res = await fetch("/api/logout", { method: "POST" });
    if (res.status === 404) res = await fetch("/api/logout.php", { method: "POST" });
    if (!res.ok) throw new Error("Logout failed");
  } catch {
    showToast("Nie udało się wylogować. Spróbuj ponownie.");
    return;
  }
  sync?.stop();

  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.filter(registration => registration.scope === new URL("./", location.href).href).map(registration => registration.unregister()));
    }
  } catch {
    // ignore
  }

  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith("klub-cache-")).map(key => caches.delete(key)));
    }
  } catch {
    // ignore
  }

  location.href = "/";
}

export async function renderSettings({ store, pricing, setPricing, navigate, user, sync }) {
  setTitle("Ustawienia");
  setActions([]);

  const main = el("div", { class: "container" });

  if (user) {
    main.appendChild(
      el("div", { class: "card card--hero" }, [
        el("div", { class: "title", text: user }),
        el("div", { class: "row", style: "justify-content:flex-end;margin-top:10px;gap:8px;flex-wrap:wrap" }, [
          btn("Wyloguj", () => doLogout(sync), "btn--ghost")
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
            try {
              for (const [k, input] of inputs) next[String(k)] = nonnegativeNumber(input.value, "kwota");
              const all = (allInput.value ?? "").trim();
              if (all !== "") next.all = nonnegativeNumber(all, "kwota wszystkich treningów");
            } catch (error) { showToast(error.message); return; }
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
              await store.runTx(["scopes", "sessionScopes"], "readwrite", transaction => {
                transaction.objectStore("scopes").delete(scope.id);
                const sessions = transaction.objectStore("sessionScopes");
                const request = sessions.getAll();
                request.onsuccess = () => {
                  for (const row of request.result) {
                    if (row.scopeIds?.includes(scope.id)) sessions.put({ ...row, scopeIds: row.scopeIds.filter(id => id !== scope.id) });
                  }
                };
              });
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
              el("div", { class: "item", role: "button", tabindex: "0", onclick: () => openScopeEditor(s.id), onkeydown: event => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openScopeEditor(s.id); }
              } }, [
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
          downloadBackup(await exportAll(store));
        }),
        btn("Import", async () => {
          const input = el("input", { type: "file", accept: "application/json" });
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) { showToast("Backup przekracza 2 MB."); return; }
            const text = await file.text();
            let json;
            try {
              json = JSON.parse(text);
            } catch {
              showToast("Nieprawidłowy plik JSON");
              return;
            }
            try {
              downloadBackup(await exportAll(store));
              await replaceAll(store, json);
            } catch (err) {
              showToast(String(err?.message ?? err));
              return;
            }
            const updatedPricing = await store.get("settings", "pricing");
            setPricing(updatedPricing);
            if (sync) await sync.push();
            showToast("Zaimportowano dane z pliku");
            navigate("#/attendance");
          };
          input.click();
        })
      ])
    ])
  );

  if (user && sync) {
    async function syncPull() {
      if (sync.busy) { showToast("Synchronizacja trwa. Spróbuj ponownie za chwilę."); return; }
      const apply = async () => {
        if (sync.busy) { showToast("Synchronizacja trwa. Spróbuj ponownie za chwilę."); return; }
        if (await sync.pull({ force: true })) {
          setPricing(await store.get("settings", "pricing"));
          showToast("Pobrano dane");
        } else showToast(sync.status || "Nie pobrano danych. Dane lokalne zachowano; spróbuj ponownie.");
      };
      if (!sync.dirty) { await apply(); return; }
      openModal({
        title: "Pobrać dane serwera?",
        body: el("div", { class: "sub", text: "Lokalne zmiany zostaną zastąpione. Przed pobraniem zapiszę ich backup w pliku." }),
        footer: [
          btn("Anuluj", () => closeModal()),
          btn("Zapisz backup i pobierz", async () => {
            downloadBackup(await exportAll(store));
            closeModal();
            await apply();
          }, "btn--primary")
        ]
      });
    }
    async function syncPush() {
      if (sync.busy) { showToast("Synchronizacja trwa. Spróbuj ponownie za chwilę."); return; }
      if (sync.conflicted) { await syncPull(); return; }
      if (!sync.dirty) { showToast("Dane są już zsynchronizowane."); return; }
      if (await sync.push()) showToast("Wysłano dane");
      else showToast(sync.status || "Nie wysłano danych. Dane lokalne zachowano.");
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


function downloadBackup(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `klub-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}
