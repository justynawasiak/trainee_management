import { exportAll, importAll } from "../logic.js";
import { btn, el, setActions, setTitle, showToast } from "../ui.js";

export async function renderSettings({ store, pricing, setPricing, navigate }) {
  setTitle("Ustawienia");
  setActions([]);

  const main = el("div", { class: "container" });

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
          el("div", { class: "title", text: `${k} trening/tydzień` }),
          el("div", { class: "sub", text: `Kwota miesięczna (${pricing.currency ?? "PLN"})` })
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
        el("div", { class: "sub", text: `Kwota dla > max treningów/tydzień (${pricing.currency ?? "PLN"})` })
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
              await importAll(store, json);
            } catch (err) {
              showToast(String(err?.message ?? err));
              return;
            }
            const updatedPricing = await store.get("settings", "pricing");
            setPricing(updatedPricing);
            showToast("Zaimportowano dane");
            navigate("#/attendance");
          };
          input.click();
        })
      ])
    ])
  );

  return main;
}
