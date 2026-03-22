import { isoMonth } from "../db.js";
import { computeTraineeFee, ensurePayment, setPaid } from "../logic.js";
import { bigListItem, btn, el, fmtMoney, iconToggle, setActions, setTitle } from "../ui.js";

export async function renderPayments({ store, pricing, now, navigate }) {
  setTitle("Płatności");
  setActions([]);

  const main = el("div", { class: "container" });
  const month = isoMonth(now);

  const trainees = await store.getAll("trainees");

  let filterUnpaid = true;
  let search = "";
  let selectedMonth = month;

  const list = el("div", { class: "list" });

  async function renderList() {
    list.innerHTML = "";
    const q = (search ?? "").trim().toLowerCase();

    const sorted = trainees
      .slice()
      .sort(
        (a, b) =>
          (a.lastName ?? "").localeCompare(b.lastName ?? "") || (a.firstName ?? "").localeCompare(b.firstName ?? "")
      );

    const rows = [];
    for (const t of sorted) {
      const fee = await computeTraineeFee({ store, pricing }, t.id);
      const mode = t.pricingMode ?? "auto";
      const amount = mode === "manual" ? Number(t.manualMonthlyFee ?? 0) : Number(fee.autoFee ?? 0);
      const p = await ensurePayment(store, selectedMonth, t.id, amount);
      rows.push({ t, p, amount });
    }

    const filtered = rows.filter(({ t, p }) => {
      if (filterUnpaid && p.paid) return false;
      if (!q) return true;
      return `${t.firstName ?? ""} ${t.lastName ?? ""}`.toLowerCase().includes(q);
    });

    if (filtered.length === 0) {
      list.appendChild(el("div", { class: "card" }, [el("div", { class: "sub", text: "Brak wyników." })]));
      return;
    }

    for (const { t, p, amount } of filtered) {
      const right = iconToggle(Boolean(p.paid));
      const subtitle = [`Kwota: ${fmtMoney(amount, pricing.currency)}`, t.pricingMode === "manual" ? "ręcznie" : "auto"].join(
        " · "
      );
      list.appendChild(
        bigListItem({
          title: `${t.lastName ?? ""} ${t.firstName ?? ""}`.trim() || "Osoba",
          subtitle,
          right,
          onClick: async () => {
            const next = !Boolean(p.paid);
            p.paid = next;
            right.classList.toggle("on", next);
            await setPaid(store, selectedMonth, t.id, next, amount);
          }
        })
      );
    }
  }

  main.appendChild(
    el("div", { class: "card card--hero" }, [
      el("div", { class: "row space wrap" }, [
        el("div", { class: "stack" }, [
          el("div", { class: "title", text: "Płatności" }),
        ]),
        el("input", {
          class: "input",
          type: "month",
          value: month,
          style: "max-width: 180px",
          onchange: (e) => {
            const value = e.target.value;
            if (value) {
              selectedMonth = value;
              renderList();
            }
          }
        })
      ]),
      el("div", { class: "hr" }),
      el("div", { class: "grid2" }, [
        el("input", {
          class: "input",
          type: "search",
          placeholder: "Szukaj osoby…",
          oninput: (e) => {
            search = e.target.value ?? "";
            renderList();
          }
        }),
        btn("Pokaż: nieopłacone", (e) => {
          filterUnpaid = !filterUnpaid;
          e.target.textContent = filterUnpaid ? "Pokaż: nieopłacone" : "Pokaż: wszystkie";
          renderList();
        })
      ])
    ])
  );

  if (trainees.length === 0) {
    list.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "title", text: "Brak osób" }),
        el("div", { class: "sub", text: "Dodaj pierwszą osobę, żeby śledzić płatności." }),
        el("div", { style: "margin-top:10px" }, [btn("Dodaj osobę", () => navigate("#/people"), "btn--primary")])
      ])
    );
  } else {
    await renderList();
  }

  main.appendChild(list);
  return main;
}
