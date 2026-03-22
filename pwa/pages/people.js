import { normalizeEmail, normalizePhone } from "../db.js";
import { computeTraineeFee } from "../logic.js";
import { bigListItem, btn, closeModal, el, fmtMoney, openModal, setActions, setTitle, showModalError, showToast } from "../ui.js";

export async function renderPeople({ store, pricing, navigate }) {
  setTitle("Osoby");
  setActions([]);

  const main = el("div", { class: "container" });
  const trainees = await store.getAll("trainees");
  let search = "";

  const list = el("div", { class: "list" });

  function renderList() {
    list.innerHTML = "";
    const q = (search ?? "").trim().toLowerCase();
    const filtered = trainees
      .slice()
      .sort(
        (a, b) =>
          (a.lastName ?? "").localeCompare(b.lastName ?? "") || (a.firstName ?? "").localeCompare(b.firstName ?? "")
      )
      .filter((t) => {
        if (!q) return true;
        return `${t.firstName ?? ""} ${t.lastName ?? ""}`.toLowerCase().includes(q);
      });

    if (filtered.length === 0) {
      list.appendChild(el("div", { class: "card" }, [el("div", { class: "sub", text: trainees.length ? "Brak wyników." : "Brak osób." })]));
      return;
    }
    for (const t of filtered) {
      list.appendChild(
        bigListItem({
          title: `${t.lastName ?? ""} ${t.firstName ?? ""}`.trim() || "Osoba",
          subtitle: t.phone || t.email ? `${t.phone ?? ""}${t.phone && t.email ? " · " : ""}${t.email ?? ""}` : null,
          onClick: () => openTraineeEditor({ store, pricing, navigate }, t.id)
        })
      );
    }
  }

  main.appendChild(
    el("div", { class: "card card--hero" }, [
      el("div", { class: "row space" }, [
        el("div", { class: "stack" }, [
          el("div", { class: "title", text: "Osoby" }),
          el("div", { class: "sub", text: "Imię, nazwisko, telefon, e-mail + kwota domyślna." })
        ]),
        btn("Dodaj", () => openTraineeEditor({ store, pricing, navigate }), "btn--primary")
      ]),
      el("div", { class: "hr" }),
      el("input", {
        class: "input",
        type: "search",
        placeholder: "Szukaj osoby…",
        oninput: (e) => {
          search = e.target.value ?? "";
          renderList();
        }
      })
    ])
  );

  renderList();
  main.appendChild(list);
  return main;
}

async function openTraineeEditor(ctx, traineeId) {
  const { store, pricing, navigate } = ctx;
  const trainee = traineeId ? await store.get("trainees", traineeId) : null;

  const fee = trainee
    ? await computeTraineeFee({ store, pricing }, trainee.id)
    : { totalSessionsPerWeek: 0, autoFee: 0, currency: pricing?.currency ?? "PLN" };

  const firstName = el("input", { class: "input", placeholder: "Imię", value: trainee?.firstName ?? "" });
  const lastName = el("input", { class: "input", placeholder: "Nazwisko", value: trainee?.lastName ?? "" });
  const phone = el("input", { class: "input", placeholder: "Telefon", inputmode: "tel", value: trainee?.phone ?? "" });
  const email = el("input", { class: "input", placeholder: "E-mail", inputmode: "email", value: trainee?.email ?? "" });

  const pricingMode = el("select", {}, [
    el("option", { value: "auto", text: "Kwota: automatycznie" }),
    el("option", { value: "manual", text: "Kwota: ręcznie" })
  ]);
  pricingMode.value = trainee?.pricingMode ?? "auto";

  const manualFee = el("input", {
    class: "input",
    type: "number",
    min: "0",
    step: "1",
    placeholder: `Kwota miesięczna (${fee.currency})`,
    value: trainee?.manualMonthlyFee ?? ""
  });
  const manualFeeWrap = el("div", {}, [manualFee]);
  manualFeeWrap.hidden = pricingMode.value !== "manual";
  pricingMode.onchange = () => {
    manualFeeWrap.hidden = pricingMode.value !== "manual";
  };

  const body = el("div", {}, [
    el("div", { class: "grid2" }, [firstName, lastName]),
    el("div", { class: "grid2" }, [phone, email]),
    el("div", { class: "hr" }),
    el("div", { class: "title", text: "Kwota domyślna" }),
    el("div", { class: "sub", text: `Treningi/tydzień (suma): ${fee.totalSessionsPerWeek} → auto: ${fmtMoney(fee.autoFee, fee.currency)}` }),
    pricingMode,
    manualFeeWrap,
    el("div", { class: "hint", text: "Kwota auto liczy się z przypisań do grup (treningi/tydzień). Możesz ją nadpisać ręcznie." })
  ]);

  const footer = [
    trainee
      ? btn("Usuń", async (e) => {
          e.preventDefault();
          await deleteTrainee(store, trainee.id);
          closeModal();
          showToast("Usunięto osobę");
          navigate("#/people");
        })
      : null,
    el("button", { class: "btn", value: "cancel", text: "Anuluj" }),
    btn(
      "Zapisz",
      async (e) => {
        e.preventDefault();
        const fn = (firstName.value ?? "").trim();
        const ln = (lastName.value ?? "").trim();
        if (!fn) {
          showModalError("Podaj imię");
          firstName.focus();
          return;
        }
        if (!ln) {
          showModalError("Podaj nazwisko");
          lastName.focus();
          return;
        }
        const row = trainee ?? { id: store.uuid(), createdAt: Date.now() };
        row.firstName = fn;
        row.lastName = ln;
        row.phone = normalizePhone(phone.value);
        row.email = normalizeEmail(email.value);
        row.pricingMode = pricingMode.value;
        row.manualMonthlyFee = pricingMode.value === "manual" ? Number(manualFee.value ?? 0) : null;
        row.updatedAt = Date.now();
        await store.put("trainees", row);
        closeModal();
        showToast("Zapisano osobę");
        navigate("#/people");
      },
      "btn--good"
    )
  ].filter(Boolean);

  openModal({ title: trainee ? "Edytuj osobę" : "Dodaj osobę", body, footer });
}

async function deleteTrainee(store, traineeId) {
  const memberships = await store.getAllByIndex("memberships", "byTrainee", traineeId);
  await store.runTx(["trainees", "memberships"], "readwrite", (t) => {
    t.objectStore("trainees").delete(traineeId);
    for (const m of memberships) t.objectStore("memberships").delete(m.id);
  });

  const attend = await store.getAllByIndex("attendance", "byTrainee", traineeId);
  for (const a of attend) await store.delete("attendance", a.id);

  const payments = await store.getAll("payments");
  for (const p of payments.filter((x) => x.traineeId === traineeId)) await store.delete("payments", p.id);
}
