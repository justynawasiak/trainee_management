import { normalizeEmail, normalizePhone } from "../db.js";
import { computeTraineeFee } from "../logic.js";
import { bigListItem, btn, closeModal, el, openModal, setActions, setTitle, showModalError, showToast } from "../ui.js";

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
          (a.firstName ?? "").localeCompare(b.firstName ?? "") || (a.lastName ?? "").localeCompare(b.lastName ?? "")
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
          title: `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim() || "Osoba",
          subtitle: t.phone || t.email ? `${t.phone ?? ""}${t.phone && t.email ? " · " : ""}${t.email ?? ""}` : null,
          onClick: () => openTraineeEditor({ store, pricing, navigate }, t.id)
        })
      );
    }
  }

  main.appendChild(
    el("div", { class: "card card--hero" }, [
      el("div", { class: "row space wrap" }, [
        el("div", { class: "stack" }, [el("div", { class: "title", text: "Osoby" })]),
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
  const [groups, memberships] = await Promise.all([
    store.getAll("groups"),
    traineeId ? store.getAllByIndex("memberships", "byTrainee", traineeId) : Promise.resolve([])
  ]);

  const fee = trainee
    ? await computeTraineeFee({ store, pricing }, trainee.id)
    : { totalSessionsPerWeek: 0, autoFee: 0, currency: pricing?.currency ?? "PLN" };

  const firstName = el("input", { class: "input", placeholder: "Imię", value: trainee?.firstName ?? "" });
  const lastName = el("input", { class: "input", placeholder: "Nazwisko", value: trainee?.lastName ?? "" });
  const phone = el("input", { class: "input", placeholder: "Telefon", inputmode: "tel", value: trainee?.phone ?? "" });
  const email = el("input", { class: "input", placeholder: "E-mail", inputmode: "email", value: trainee?.email ?? "" });

  const pricingMode = el("select", { class: "input" }, [
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

  const groupOptions = groups.slice().sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  const selectedGroupIds = new Set(memberships.map((membership) => membership.groupId));
  const groupsSection = el("div", { class: "stack", style: "gap:10px" }, []);
  const groupsHeader = el("div", { class: "row space wrap" }, [
    el("div", { class: "title", text: "Grupy" }),
    btn("Edytuj", () => openGroupsEditor(groupOptions, selectedGroupIds), "btn--primary")
  ]);
  const selectedInfo = el("div", { class: "list" });
  const renderSelectedInfo = () => {
    selectedInfo.innerHTML = "";
    const selectedGroups = groupOptions.filter((group) => selectedGroupIds.has(group.id));
    if (selectedGroups.length === 0) {
      selectedInfo.appendChild(el("div", { class: "sub muted", text: "Brak przypisanych grup." }));
      return;
    }
    for (const group of selectedGroups) {
      selectedInfo.appendChild(
        el("div", { class: "item item--static" }, [
          el("div", { class: "stack", style: "gap:4px" }, [el("div", { class: "title", text: group.name ?? "Grupa" })])
        ])
      );
    }
  };
  groupsSection.appendChild(groupsHeader);

  if (groupOptions.length === 0) {
    groupsSection.appendChild(el("div", { class: "sub muted", text: "Brak grup do przypisania." }));
  } else {
    renderSelectedInfo();
    groupsSection.appendChild(selectedInfo);
  }

  const body = el("div", { class: "stack" }, [
    el("div", { class: "grid2" }, [firstName, lastName]),
    el("div", { class: "grid2" }, [phone, email]),
    pricingMode,
    manualFeeWrap,
    groupsSection
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

        const existingByGroupId = new Map(memberships.map((membership) => [membership.groupId, membership]));
        const nextGroupIds = new Set(selectedGroupIds);
        await store.runTx(["memberships"], "readwrite", (t) => {
          const membershipStore = t.objectStore("memberships");
          for (const membership of memberships) {
            if (!nextGroupIds.has(membership.groupId)) membershipStore.delete(membership.id);
          }
          for (const groupId of nextGroupIds) {
            if (existingByGroupId.has(groupId)) continue;
            membershipStore.put({
              id: store.uuid(),
              groupId,
              traineeId: row.id,
              sessionsPerWeek: 1,
              createdAt: Date.now()
            });
          }
        });

        closeModal();
        showToast("Zapisano osobę");
        navigate("#/people");
      },
      "btn--good"
    )
  ].filter(Boolean);

  openModal({ title: trainee ? "Edytuj osobę" : "Dodaj osobę", body, footer });

  function openGroupsEditor(groupOptions, selectedGroupIds) {
    if (groupOptions.length === 0) {
      showToast("Brak grup do przypisania");
      return;
    }

    const draft = new Set(selectedGroupIds);
    const checklist = el("div", { class: "checklist" });
    for (const group of groupOptions) {
      const cb = el("input", { type: "checkbox" });
      cb.checked = draft.has(group.id);
      cb.addEventListener("change", () => {
        if (cb.checked) draft.add(group.id);
        else draft.delete(group.id);
      });

      checklist.appendChild(
        el("label", { class: "checkitem" }, [
          cb,
          el("div", { class: "stack", style: "gap:4px" }, [el("div", { class: "title", text: group.name ?? "Grupa" })])
        ])
      );
    }

    openModal({
      title: "Edytuj grupy",
      body: el("div", { class: "stack" }, [checklist]),
      footer: [
        el("button", { class: "btn", value: "cancel", text: "Anuluj" }),
        btn("Zapisz", () => {
          selectedGroupIds.clear();
          draft.forEach((groupId) => selectedGroupIds.add(groupId));
          renderSelectedInfo();
          closeModal();
        }, "btn--good")
      ]
    });
  }
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
