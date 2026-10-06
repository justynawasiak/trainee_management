import { DAYS, bigListItem, btn, closeModal, el, fmtSchedule, openModal, setActions, setTitle, showToast } from "../ui.js";

import { addGroupMembers, isMembershipActive, modifyGroup, setMembershipActive, updateGroupSchedule } from "../logic.js";
import { nonnegativeNumber } from "../validation.js";

export async function renderGroups({ store, navigate }) {
  setTitle("Grupy");
  setActions([]);

  const main = el("div", { class: "container" });
  const [groups, trainees, memberships] = await Promise.all([
    store.getAll("groups"),
    store.getAll("trainees"),
    store.getAll("memberships")
  ]);
  const traineeIds = new Set(trainees.map((t) => t.id));
  const membersByGroup = new Map(groups.map((g) => [g.id, new Set()]));
  for (const membership of memberships.filter(isMembershipActive)) {
    if (traineeIds.has(membership.traineeId)) {
      membersByGroup.get(membership.groupId)?.add(membership.traineeId);
    }
  }
  let search = "";

  const list = el("div", { class: "list" });

  function renderList() {
    list.innerHTML = "";
    const q = (search ?? "").trim().toLowerCase();
    const filtered = groups
      .slice()
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
      .filter((g) => {
        if (!q) return true;
        return (g.name ?? "").toLowerCase().includes(q);
      });

    if (filtered.length === 0) {
      list.appendChild(el("div", { class: "card" }, [el("div", { class: "sub", text: groups.length ? "Brak wyników." : "Brak grup." })]));
      return;
    }
    for (const g of filtered) {
      list.appendChild(
        bigListItem({
          title: g.name ?? "Grupa",
          subtitle: `${fmtSchedule(g.schedule)} · Liczba osób: ${membersByGroup.get(g.id).size}`,
          onClick: () => navigate(`#/groups/detail?groupId=${encodeURIComponent(g.id)}`)
        })
      );
    }
  }

  main.appendChild(
    el("div", { class: "card card--hero" }, [
      el("div", { class: "row space" }, [
        el("div", { class: "stack" }, [
          el("div", { class: "title", text: "Grupy" }),
        ]),
        btn("Dodaj", () => openGroupEditor({ store, navigate }), "btn--primary")
      ]),
      el("div", { class: "hr" }),
      el("input", {
        class: "input",
        type: "search",
        placeholder: "Szukaj grupy…",
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

export async function renderGroupDetail({ store, navigate, params }) {
  const main = el("div", { class: "container" });
  const groupId = params.get("groupId");

  const [group, trainees, memberships] = await Promise.all([
    store.get("groups", groupId),
    store.getAll("trainees"),
    store.getAllByIndex("memberships", "byGroup", groupId)
  ]);

  if (!group) {
    setTitle("Grupa");
    setActions([]);
    main.appendChild(el("div", { class: "card" }, [el("div", { class: "title", text: "Nie znaleziono grupy" })]));
    return main;
  }

  setTitle("Grupa");
  setActions([]);

  const traineeById = new Map(trainees.map((t) => [t.id, t]));
  const roster = memberships
    .filter(isMembershipActive)
    .slice()
    .sort((a, b) => {
      const ta = traineeById.get(a.traineeId);
      const tb = traineeById.get(b.traineeId);
      return (ta?.firstName ?? "").localeCompare(tb?.firstName ?? "") || (ta?.lastName ?? "").localeCompare(tb?.lastName ?? "");
    });

  main.appendChild(
    el("div", { class: "card card--hero" }, [
      el("div", { class: "row space" }, [
        el("div", { class: "stack" }, [
          el("div", { class: "title", text: group.name ?? "Grupa" }),
          el("div", { class: "sub", text: fmtSchedule(group.schedule) })
        ]),
        el("div", { class: "row", style: "gap:8px" }, [
          btn("←", () => navigate("#/groups"), "btn--back"),
          btn("Edytuj", () => openGroupEditor({ store, navigate }, group.id), "btn--primary")
        ])
      ])
    ])
  );

  main.appendChild(renderScheduleCard({ store, navigate, group }));
  main.appendChild(await renderMembersCard({ store, navigate, groupId, trainees, roster }));
  return main;
}

function renderScheduleCard({ store, navigate, group }) {
  const scheduleCard = el("div", { class: "card" }, [
    el("div", { class: "row space" }, [
      el("div", { class: "title", text: "Harmonogram" }),
      btn("Dodaj wpis", () => openScheduleEntryEditor({ store, navigate }, group.id), "")
    ]),
    el("div", { class: "hr" })
  ]);

  const scheduleList = el("div", { class: "list" });
  const schedule = (group.schedule ?? [])
    .slice()
    .sort((a, b) => (a.dayOfWeek ?? 0) - (b.dayOfWeek ?? 0) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));

  if (schedule.length === 0) {
    scheduleList.appendChild(el("div", { class: "sub muted", text: "Brak." }));
  } else {
    schedule.forEach((e) => {
      const d = DAYS.find((x) => x.id === e.dayOfWeek)?.label ?? "?";
      scheduleList.appendChild(
        el("div", { class: "item" }, [
          el("div", { class: "stack" }, [
            el("div", { class: "title", text: `${d} ${e.startTime ?? "--:--"}` }),
            el("div", { class: "sub", text: `Czas: ${Number(e.durationMin ?? 60)} min` })
          ]),
          btn("Usuń", async () => {
            await modifyGroup(store, group.id, current => {
              const next = (current.schedule ?? []).slice();
              const index = next.findIndex(entry => e.id ? entry.id === e.id : JSON.stringify(entry) === JSON.stringify(e));
              if (index === -1) throw new Error("Harmonogram zmienił się. Odśwież grupę.");
              next.splice(index, 1);
              return updateGroupSchedule(current, next);
            });
            navigate(`#/groups/detail?groupId=${encodeURIComponent(group.id)}`);
          })
        ])
      );
    });
  }
  scheduleCard.appendChild(scheduleList);
  return scheduleCard;
}

async function renderMembersCard({ store, navigate, groupId, trainees, roster }) {
  const membersCard = el("div", { class: "card" }, [
    el("div", { class: "row space" }, [
      el("div", { class: "title", text: "Osoby w grupie" }),
      btn("Dodaj osobę", () => openAddMember({ store, navigate }, groupId), "btn--primary")
    ]),
    el("div", { class: "sub", text: "Ustaw liczbę treningów/tydzień (wpływa na kwotę auto)." }),
    el("div", { class: "hr" })
  ]);

  const traineeById = new Map(trainees.map((t) => [t.id, t]));
  const membersList = el("div", { class: "list" });
  if (roster.length === 0) {
    membersList.appendChild(el("div", { class: "sub muted", text: "Brak." }));
  } else {
    for (const m of roster) {
      const t = traineeById.get(m.traineeId);
      if (!t) continue;
      membersList.appendChild(
        el("div", { class: "item" }, [
          el("div", { class: "stack" }, [
            el("div", { class: "title", text: `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim() }),
            el("div", { class: "sub", text: `Treningi/tydzień: ${Number(m.sessionsPerWeek ?? 0)}` })
          ]),
          el("div", { class: "row", style: "gap:8px;justify-content:flex-end" }, [
            btn("Zmień", () => openEditMemberSessions({ store, navigate }, m.id)),
            btn("Usuń", async () => {
              await setMembershipActive(store, m.id, false);
              navigate(`#/groups/detail?groupId=${encodeURIComponent(groupId)}`);
            })
          ])
        ])
      );
    }
  }
  membersCard.appendChild(membersList);

  if (trainees.length > 0 && roster.length === trainees.length) {
    membersCard.appendChild(el("div", { class: "pill" }, [el("span", { text: "Wszystkie osoby są już przypisane do tej grupy." })]));
  }

  return membersCard;
}

async function openGroupEditor(ctx, groupId) {
  const { store, navigate } = ctx;
  const group = groupId ? await store.get("groups", groupId) : null;

  const name = el("input", { class: "input", placeholder: "Nazwa grupy", value: group?.name ?? "" });
  const body = el("div", { class: "stack" }, [name]);

  const footer = [
    group
      ? btn("Usuń", async (e) => {
          e.preventDefault();
          await deleteGroup(store, group.id);
          closeModal();
          showToast("Usunięto grupę");
          navigate("#/groups");
        })
      : null,
    el("button", { class: "btn", value: "cancel", text: "Anuluj" }),
    btn(
      "Zapisz",
      async (e) => {
        e.preventDefault();
        const n = (name.value ?? "").trim();
        if (!n) {
          showToast("Podaj nazwę grupy");
          return;
        }
        const row = group ?? { id: store.uuid(), createdAt: Date.now(), schedule: [] };
        row.name = n;
        row.updatedAt = Date.now();
        if (group) await modifyGroup(store, row.id, current => ({ ...current, name: n, updatedAt: Date.now() }));
        else await store.put("groups", row);
        closeModal();
        showToast("Zapisano grupę");
        navigate(`#/groups/detail?groupId=${encodeURIComponent(row.id)}`);
      },
      "btn--good"
    )
  ].filter(Boolean);

  openModal({ title: group ? "Edytuj grupę" : "Dodaj grupę", body, footer });
}

async function deleteGroup(store, groupId) {
  await store.runTx(["groups", "memberships", "attendance", "sessionScopes"], "readwrite", (t) => {
    t.objectStore("groups").delete(groupId);
    for (const name of ["memberships", "attendance", "sessionScopes"]) {
      const target = t.objectStore(name);
      const request = target.getAll();
      request.onsuccess = () => {
        for (const row of request.result) if (row.groupId === groupId) target.delete(row.id);
      };
    }
  });
}

async function openScheduleEntryEditor(ctx, groupId) {
  const { store, navigate } = ctx;
  const group = await store.get("groups", groupId);
  if (!group) return;

  const day = el(
    "select",
    { class: "input" },
    DAYS.map((d) => el("option", { value: String(d.id), text: d.label }))
  );
  const startTime = el("input", { class: "input", type: "time", value: "18:00" });
  const durationMin = el("input", { class: "input", type: "number", min: "15", step: "5", value: "60" });

  const body = el("div", { class: "stack" }, [
    el("div", { class: "grid2", style: "gap:14px" }, [day, startTime]),
    durationMin,
  ]);

  const footer = [
    el("button", { class: "btn", value: "cancel", text: "Anuluj" }),
    btn(
      "Dodaj",
      async (e) => {
        e.preventDefault();
        const entry = {
          id: store.uuid(),
          dayOfWeek: Number(day.value),
          startTime: startTime.value ?? "18:00",
          durationMin: nonnegativeNumber(durationMin.value, "czas trwania", { integer: true, min: 15 })
        };
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.startTime)) throw new Error("Podaj poprawną godzinę");
        await modifyGroup(store, group.id, current => updateGroupSchedule(current, [...(current.schedule ?? []), entry]));
        closeModal();
        navigate(`#/groups/detail?groupId=${encodeURIComponent(groupId)}`);
      },
      "btn--good"
    )
  ];

  openModal({ title: "Dodaj wpis harmonogramu", body, footer });
}

async function openAddMember(ctx, groupId) {
  const { store, navigate } = ctx;
  const [trainees, memberships] = await Promise.all([store.getAll("trainees"), store.getAllByIndex("memberships", "byGroup", groupId)]);
  const existing = new Set(memberships.filter(isMembershipActive).map((m) => m.traineeId));
  const options = trainees
    .filter((t) => !existing.has(t.id))
    .sort((a, b) => (a.firstName ?? "").localeCompare(b.firstName ?? "") || (a.lastName ?? "").localeCompare(b.lastName ?? ""));

  if (options.length === 0) {
    showToast("Brak osób do dodania");
    return;
  }

  const selected = new Set();
  let search = "";

  const searchInput = el("input", {
    class: "input",
    type: "search",
    placeholder: "Szukaj osoby…",
    oninput: (e) => {
      search = e.target.value ?? "";
      renderList();
    }
  });

  const list = el("div", { class: "checklist" });
  function renderList() {
    list.innerHTML = "";
    const q = (search ?? "").trim().toLowerCase();
    const filtered = q
      ? options.filter((t) => `${t.firstName ?? ""} ${t.lastName ?? ""}`.toLowerCase().includes(q))
      : options;

    if (filtered.length === 0) {
      list.appendChild(el("div", { class: "sub muted", text: "Brak wyników." }));
      return;
    }

    for (const t of filtered) {
      const name = `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim();
      const cb = el("input", { type: "checkbox" });
      cb.checked = selected.has(t.id);
      const row = el("div", { class: "checkitem", role: "button", tabindex: "0" }, [
        cb,
        el("div", { class: "stack", style: "gap:4px" }, [
          el("div", { class: "title", text: name || "Osoba" }),
          t.phone || t.email ? el("div", { class: "sub", text: `${t.phone ?? ""}${t.phone && t.email ? " · " : ""}${t.email ?? ""}` }) : null
        ])
      ]);
      function sync() {
        if (cb.checked) selected.add(t.id);
        else selected.delete(t.id);
      }
      cb.addEventListener("change", () => sync());
      row.addEventListener("click", (e) => {
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        sync();
      });
      row.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        cb.checked = !cb.checked;
        sync();
      });
      list.appendChild(row);
    }
  }

  renderList();

  const quick = el("div", { class: "row", style: "gap:8px;flex-wrap:wrap;justify-content:flex-end" }, [
    btn("Zaznacz wszystko", () => {
      options.forEach((t) => selected.add(t.id));
      renderList();
    }),
    btn("Wyczyść", () => {
      selected.clear();
      renderList();
    })
  ]);

  const body = el("div", { class: "stack" }, [
    quick,
    searchInput,
    list
  ]);

  const footer = [
    el("button", { class: "btn", value: "cancel", text: "Anuluj" }),
    btn(
      "Dodaj zaznaczone",
      async (e) => {
        e.preventDefault();
        if (selected.size === 0) {
          showToast("Zaznacz przynajmniej jedną osobę");
          return;
        }
        await addGroupMembers(store, groupId, selected);
        closeModal();
        showToast("Zapisano przypisania do grupy");
        navigate(`#/groups/detail?groupId=${encodeURIComponent(groupId)}`);
      },
      "btn--good"
    )
  ];
  openModal({ title: "Dodaj osobę do grupy", body, footer });
}

async function openEditMemberSessions(ctx, membershipId) {
  const { store, navigate } = ctx;
  const membership = await store.get("memberships", membershipId);
  if (!membership) return;
  const trainee = await store.get("trainees", membership.traineeId);
  const sessions = el("input", { class: "input", type: "number", min: "0", step: "1", value: String(Number(membership.sessionsPerWeek ?? 0)) });
  const body = el("div", { class: "stack" }, [
    el("div", { class: "title", text: trainee ? `${trainee.firstName ?? ""} ${trainee.lastName ?? ""}`.trim() : "Osoba" }),
    sessions,
  ]);
  const footer = [
    el("button", { class: "btn", value: "cancel", text: "Anuluj" }),
    btn(
      "Zapisz",
      async (e) => {
        e.preventDefault();
        const sessionsPerWeek = nonnegativeNumber(sessions.value, "treningi/tydzień", { integer: true });
        await store.runTx(["memberships"], "readwrite", transaction => {
          const memberships = transaction.objectStore("memberships");
          const request = memberships.get(membership.id);
          request.onsuccess = () => {
            if (!request.result || !isMembershipActive(request.result)) { transaction.abort(); return; }
            memberships.put({ ...request.result, sessionsPerWeek, updatedAt: Date.now() });
          };
        });
        closeModal();
        navigate(`#/groups/detail?groupId=${encodeURIComponent(membership.groupId)}`);
      },
      "btn--good"
    )
  ];
  openModal({ title: "Treningi/tydzień", body, footer });
}

