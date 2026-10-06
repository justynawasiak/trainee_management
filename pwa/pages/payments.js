import { isoMonth } from "../db.js";
import { computeAutoFee, isMembershipActive, setPaid, setPaymentAmount } from "../logic.js";
import { bigListItem, btn, closeModal, el, fmtMoney, iconToggle, openModal, setActions, setTitle, showModalError, showToast } from "../ui.js";

export async function renderPayments({ store, pricing, now, navigate }) {
  setTitle("Płatności");
  setActions([]);

  const main = el("div", { class: "container" });
  const month = isoMonth(now);

  const [trainees, groups, memberships] = await Promise.all([
    store.getAll("trainees"),
    store.getAll("groups"),
    store.getAll("memberships")
  ]);

  let filterUnpaid = true;
  let search = "";
  let selectedMonth = month;
  let groupFilter = "__all__";
  let renderGeneration = 0;

  function getSelectedMonthParts() {
    const [year, monthNum] = String(selectedMonth).split("-").map((x) => Number(x));
    return { year, monthNum };
  }

  function setSelectedMonth(year, monthNum) {
    selectedMonth = `${year}-${String(monthNum).padStart(2, "0")}`;
    refreshList();
  }

  const traineesInGroup = new Map();
  const sessionsByTrainee = new Map();
  for (const m of memberships.filter(isMembershipActive)) {
    if (!m.groupId || !m.traineeId) continue;
    if (!traineesInGroup.has(m.groupId)) traineesInGroup.set(m.groupId, new Set());
    traineesInGroup.get(m.groupId).add(m.traineeId);
    sessionsByTrainee.set(m.traineeId, (sessionsByTrainee.get(m.traineeId) ?? 0) + m.sessionsPerWeek);
  }

  const list = el("div", { class: "list" });
  const monthParts = getSelectedMonthParts();
  const currentYear = new Date().getFullYear();
  const monthSelect = el(
    "select",
    {
      class: "input",
      onchange: (e) => setSelectedMonth(getSelectedMonthParts().year, Number(e.target.value))
    },
    [
      el("option", { value: "1", text: "Styczen" }),
      el("option", { value: "2", text: "Luty" }),
      el("option", { value: "3", text: "Marzec" }),
      el("option", { value: "4", text: "Kwiecien" }),
      el("option", { value: "5", text: "Maj" }),
      el("option", { value: "6", text: "Czerwiec" }),
      el("option", { value: "7", text: "Lipiec" }),
      el("option", { value: "8", text: "Sierpien" }),
      el("option", { value: "9", text: "Wrzesien" }),
      el("option", { value: "10", text: "Pazdziernik" }),
      el("option", { value: "11", text: "Listopad" }),
      el("option", { value: "12", text: "Grudzien" })
    ]
  );
  monthSelect.value = String(monthParts.monthNum);

  const yearOptions = [];
  for (let year = currentYear - 3; year <= currentYear + 3; year++) {
    yearOptions.push(el("option", { value: String(year), text: String(year) }));
  }
  const yearSelect = el(
    "select",
    {
      class: "input",
      onchange: (e) => setSelectedMonth(Number(e.target.value), getSelectedMonthParts().monthNum)
    },
    yearOptions
  );
  yearSelect.value = String(monthParts.year);

  function openAmountModal({ trainee, payment, defaultAmount, month }) {
    const input = el("input", {
      class: "input",
      type: "number",
      min: "0",
      step: "1",
      value: String(Number(payment?.amount ?? defaultAmount ?? 0))
    });

    openModal({
      title: `${trainee.firstName ?? ""} ${trainee.lastName ?? ""}`.trim() || "Kwota",
      body: el("div", { class: "stack" }, [
        el("div", { class: "sub", text: `Miesiąc: ${month}` }),
        el("div", { class: "sub", text: `Domyślna: ${fmtMoney(defaultAmount, pricing.currency)}` }),
        input
      ]),
      footer: [
        btn("Anuluj", () => closeModal(), "btn--ghost"),
        btn(
          "Zapisz",
          async () => {
            const raw = String(input.value ?? "").trim();
            const val = Number(raw);
            if (raw === "" || !Number.isFinite(val) || val < 0) {
              showModalError("Podaj poprawną kwotę.");
              return;
            }
            await setPaymentAmount(store, month, trainee.id, val);
            closeModal();
            refreshList();
          },
          "btn--good"
        )
      ]
    });
  }

  function refreshList() {
    renderList().catch(error => showToast(error.message || "Nie udało się odświeżyć płatności."));
  }

  async function renderList() {
    const generation = ++renderGeneration;
    const month = selectedMonth;
    const onlyUnpaid = filterUnpaid;
    const selectedGroup = groupFilter;
    list.innerHTML = "";
    const q = (search ?? "").trim().toLowerCase();

    const sorted = trainees
      .slice()
      .sort(
        (a, b) =>
          (a.firstName ?? "").localeCompare(b.firstName ?? "") || (a.lastName ?? "").localeCompare(b.lastName ?? "")
      );

    const payments = await store.getAllByIndex("payments", "byMonth", month);
    if (generation !== renderGeneration) return;
    const paymentByTrainee = new Map(payments.map(payment => [payment.traineeId, payment]));
    const rows = sorted.map(t => {
      const autoFee = computeAutoFee(sessionsByTrainee.get(t.id) ?? 0, pricing);
      const mode = t.pricingMode ?? "auto";
      const defaultAmount = mode === "manual" ? Number(t.manualMonthlyFee ?? 0) : autoFee;
      const p = paymentByTrainee.get(t.id) ?? { month, traineeId: t.id, paid: false, amount: defaultAmount };
      const paymentAmount = Number(p?.amount ?? defaultAmount ?? 0);
      return { t, p, defaultAmount, paymentAmount };
    });

    const filtered = rows.filter(({ t, p }) => {
      if (onlyUnpaid && p.paid) return false;
      if (!q) return true;
      return `${t.firstName ?? ""} ${t.lastName ?? ""}`.toLowerCase().includes(q);
    });

    const groupFiltered =
      selectedGroup === "__all__"
        ? filtered
        : filtered.filter(({ t }) => traineesInGroup.get(selectedGroup)?.has(t.id));

    if (groupFiltered.length === 0) {
      list.appendChild(el("div", { class: "card" }, [el("div", { class: "sub", text: "Brak wyników." })]));
      return;
    }

    for (const { t, p, defaultAmount, paymentAmount } of groupFiltered) {
      const rightToggle = iconToggle(Boolean(p.paid));
      const changed = Number(paymentAmount) !== Number(defaultAmount);
      const subtitle = [
        `Kwota: ${fmtMoney(paymentAmount, pricing.currency)}${changed ? " (zmieniona)" : ""}`,
        t.pricingMode === "manual" ? "ręcznie" : "auto"
      ].join(" · ");

      const editBtn = el("button", {
        type: "button",
        class: "btn btn--ghost",
        text: "✎",
        "aria-label": "Zmień kwotę",
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          openAmountModal({ trainee: t, payment: p, defaultAmount, month });
        }
      });

      const right = el("div", { class: "row", style: "gap:6px;align-items:center;justify-content:flex-end" }, [
        editBtn,
        rightToggle
      ]);
      list.appendChild(
        bigListItem({
          title: `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim() || "Osoba",
          subtitle,
          right,
          onClick: async () => {
            const next = !Boolean(p.paid);
            await setPaid(store, month, t.id, next, paymentAmount);
            p.paid = next;
            rightToggle.classList.toggle("on", next);
            await renderList();
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
        el("div", { class: "grid2", style: "flex:0 0 auto;min-width:min(320px,100%);width:min(360px,100%)" }, [
          monthSelect,
          yearSelect
        ])
      ]),
      el("div", { class: "hr" }),
      el("div", { class: "stack", style: "gap:8px" }, [
        el(
          "select",
          {
            class: "input",
            onchange: (e) => {
              groupFilter = e.target.value;
              refreshList();
            }
          },
          [
            el("option", { value: "__all__", text: "Wszystkie osoby" }),
            ...groups
              .slice()
              .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
              .map((g) => el("option", { value: g.id, text: g.name ?? "Grupa" }))
          ]
        ),
        el("div", { class: "grid2" }, [
          el("input", {
            class: "input",
            type: "search",
            placeholder: "Szukaj osoby…",
            oninput: (e) => {
              search = e.target.value ?? "";
              refreshList();
            }
          }),
          btn("Pokaż: nieopłacone", (e) => {
            filterUnpaid = !filterUnpaid;
            e.target.textContent = filterUnpaid ? "Pokaż: nieopłacone" : "Pokaż: wszystkie";
            refreshList();
          })
        ])
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
