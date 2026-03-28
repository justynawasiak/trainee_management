import { DAYS, bigListItem, btn, closeModal, el, fmtSchedule, openModal, setActions, setTitle, showToast } from "../ui.js";

export async function renderGroups({ store, navigate }) {
  setTitle("Grupy");
  setActions([]);

  const main = el("div", { class: "container" });
  const groups = await store.getAll("groups");
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
          subtitle: fmtSchedule(g.schedule),
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
    schedule.forEach((e, idx) => {
      const d = DAYS.find((x) => x.id === e.dayOfWeek)?.label ?? "?";
      scheduleList.appendChild(
        el("div", { class: "item" }, [
          el("div", { class: "stack" }, [
            el("div", { class: "title", text: `${d} ${e.startTime ?? "--:--"}` }),
            el("div", { class: "sub", text: `Czas: ${Number(e.durationMin ?? 60)} min` })
          ]),
          btn("Usuń", async () => {
            const next = (group.schedule ?? []).slice();
            next.splice(idx, 1);
            group.schedule = next;
            await store.put("groups", group);
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
              await store.delete("memberships", m.id);
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
        await store.put("groups", row);
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
  const memberships = await store.getAllByIndex("memberships", "byGroup", groupId);
  await store.runTx(["groups", "memberships"], "readwrite", (t) => {
    t.objectStore("groups").delete(groupId);
    for (const m of memberships) t.objectStore("memberships").delete(m.id);
  });
  const attendance = await store.getAll("attendance");
  for (const a of attendance.filter((x) => x.groupId === groupId)) await store.delete("attendance", a.id);
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
          dayOfWeek: Number(day.value),
          startTime: startTime.value ?? "18:00",
          durationMin: Number(durationMin.value ?? 60)
        };
        group.schedule = [...(group.schedule ?? []), entry];
        await store.put("groups", group);
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
  const existing = new Set(memberships.map((m) => m.traineeId));
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
        const toAdd = Array.from(selected);
        let added = 0;
        for (const traineeId of toAdd) {
          const m = { id: store.uuid(), groupId, traineeId, sessionsPerWeek: 1, createdAt: Date.now() };
          try {
            await store.put("memberships", m);
            added += 1;
          } catch {
            // ignore duplicates just in case
          }
        }
        closeModal();
        showToast(`Dodano: ${added}`);
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
        membership.sessionsPerWeek = Number(sessions.value ?? 0);
        membership.updatedAt = Date.now();
        await store.put("memberships", membership);
        closeModal();
        navigate(`#/groups/detail?groupId=${encodeURIComponent(membership.groupId)}`);
      },
      "btn--good"
    )
  ];
  openModal({ title: "Treningi/tydzień", body, footer });
}


