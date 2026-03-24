import { isoDate } from "../db.js";
import { getSessionScopes, groupHasTrainingOnDate, setAttendance, setSessionScopes } from "../logic.js";
import { DAYS, bigListItem, btn, closeModal, el, fmtSchedule, iconToggle, openModal, setActions, setTitle, showToast } from "../ui.js";

function isoFromParts(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function dateLabelForGroup(group, dateISO) {
  const d = new Date(`${dateISO}T12:00:00`);
  const dow = ((d.getDay() + 6) % 7) + 1; // Mon=1..Sun=7
  const dayName = DAYS.find((x) => x.id === dow)?.label ?? "";
  const times = (group?.schedule ?? [])
    .filter((e) => Number(e.dayOfWeek) === dow && e.startTime)
    .map((e) => e.startTime)
    .sort((a, b) => String(a).localeCompare(String(b)));

  let timePart = "";
  if (times.length === 1) timePart = times[0];
  else if (times.length > 1) timePart = `${times[0]} (+${times.length - 1})`;

  return `${dateISO} · ${dayName}${timePart ? ` · ${timePart}` : ""}`.trim();
}

function addMonths(date, delta) {
  const d = new Date(date);
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  return d;
}

function monthTitle(date) {
  const months = [
    "styczeń",
    "luty",
    "marzec",
    "kwiecień",
    "maj",
    "czerwiec",
    "lipiec",
    "sierpień",
    "wrzesień",
    "październik",
    "listopad",
    "grudzień"
  ];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

function trainingDaysInMonth(group, viewMonthDate) {
  const scheduleDays = new Set((group?.schedule ?? []).map((e) => Number(e.dayOfWeek)).filter((x) => Number.isFinite(x)));
  const y = viewMonthDate.getFullYear();
  const m = viewMonthDate.getMonth() + 1;
  const daysInMonth = new Date(y, m, 0).getDate();
  const out = new Set();
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(y, m - 1, d, 12, 0, 0);
    const dow = ((dt.getDay() + 6) % 7) + 1; // Mon=1..Sun=7
    if (scheduleDays.has(dow)) out.add(isoFromParts(y, m, d));
  }
  return out;
}

function calendar({ group, selectedISO, onSelect }) {
  const selectedDate = new Date(`${selectedISO}T12:00:00`);
  let view = new Date(selectedDate);
  view.setDate(1);
  const root = el("div", { class: "cal" });
  const title = el("div", { class: "cal__title", text: monthTitle(view) });
  const grid = el("div", { class: "cal__grid" });

  function render() {
    title.textContent = monthTitle(view);
    grid.innerHTML = "";

    // DOW headers (Mon..Sun)
    for (const d of DAYS) grid.appendChild(el("div", { class: "cal__dow", text: d.label.slice(0, 2) }));

    const y = view.getFullYear();
    const m = view.getMonth() + 1;
    const daysInMonth = new Date(y, m, 0).getDate();
    const firstDow = new Date(y, m - 1, 1, 12, 0, 0).getDay(); // 0..6 Sun..Sat
    const firstIsoDow = firstDow === 0 ? 7 : firstDow; // Mon=1..Sun=7, but Sun becomes 7
    const pad = firstIsoDow - 1; // how many empty before day 1

    const training = trainingDaysInMonth(group, view);
    const todayISO = isoDate(new Date());

    for (let i = 0; i < pad; i++) grid.appendChild(el("div", { class: "cal__day empty" }));

    for (let d = 1; d <= daysInMonth; d++) {
      const iso = isoFromParts(y, m, d);
      const isTraining = training.has(iso);
      const isSelected = iso === selectedISO;
      const isToday = iso === todayISO;
      const cls = ["cal__day", isTraining ? "training" : "", isSelected ? "selected" : "", isToday ? "today" : ""].filter(Boolean).join(" ");
      grid.appendChild(
        el("div", {
          class: cls,
          role: "button",
          tabindex: "0",
          text: String(d),
          onclick: () => onSelect(iso),
          onkeydown: (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            onSelect(iso);
          }
        })
      );
    }
  }

  const head = el("div", { class: "cal__head" }, [
    btn("‹", () => {
      view = addMonths(view, -1);
      render();
    }),
    title,
    btn("›", () => {
      view = addMonths(view, 1);
      render();
    })
  ]);

  root.appendChild(head);
  root.appendChild(grid);
  render();
  return root;
}

export async function renderAttendance({ store, now, setNow, navigate }) {
  setTitle("Obecność");
  setActions([]);

  const main = el("div", { class: "container" });
  const dateISO = isoDate(now);

  const [groups, trainees] = await Promise.all([store.getAll("groups"), store.getAll("trainees")]);
  const todayGroups = groups.filter((g) => groupHasTrainingOnDate(g, now));
  const todayDow = ((now.getDay() + 6) % 7) + 1; // Mon=1..Sun=7

  function firstStartTimeForToday(group) {
    const times = (group?.schedule ?? [])
      .filter((e) => Number(e.dayOfWeek) === todayDow && e.startTime)
      .map((e) => String(e.startTime));
    if (times.length === 0) return null;
    times.sort((a, b) => a.localeCompare(b));
    return times[0];
  }

  main.appendChild(
    el("div", { class: "card card--hero" }, [
      el("div", { class: "row space" }, [
        el("div", { class: "stack" }, [
          el("div", { class: "title", text: "Obecność" })
        ]),
        el("input", {
          class: "input",
          type: "date",
          value: dateISO,
          style: "max-width: 180px",
          onchange: (e) => {
            const value = e.target.value;
            if (value) setNow(new Date(`${value}T12:00:00`));
            navigate("#/attendance");
          }
        })
      ]),
    ])
  );

  if (groups.length === 0) {
    main.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "title", text: "Brak grup" }),
        el("div", { class: "sub", text: "Dodaj pierwszą grupę, żeby szybko oznaczać obecności." }),
        el("div", { style: "margin-top:10px" }, [btn("Przejdź do Grup", () => navigate("#/groups"), "btn--primary")])
      ])
    );
    return main;
  }

  if (trainees.length === 0) {
    main.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "title", text: "Brak osób" }),
        el("div", { class: "sub", text: "Dodaj pierwszą osobę trenującą, a potem przypisz ją do grupy." }),
        el("div", { style: "margin-top:10px" }, [btn("Przejdź do Osób", () => navigate("#/people"), "btn--primary")])
      ])
    );
  }

  const list = el("div", { class: "list" });
  const useGroups = todayGroups.length > 0 ? todayGroups : groups;
  if (todayGroups.length === 0) {
    list.appendChild(
      el("div", { class: "pill" }, [
        el("span", { text: "Brak zajęć w harmonogramie na dziś — pokazuję wszystkie grupy." })
      ])
    );
  }
  const sortedGroups = useGroups.slice().sort((a, b) => {
    if (todayGroups.length > 0) {
      const ta = firstStartTimeForToday(a) ?? "99:99";
      const tb = firstStartTimeForToday(b) ?? "99:99";
      return ta.localeCompare(tb) || (a.name ?? "").localeCompare(b.name ?? "");
    }
    return (a.name ?? "").localeCompare(b.name ?? "");
  });

  for (const g of sortedGroups) {
    list.appendChild(
      bigListItem({
        title: g.name ?? "Grupa",
        subtitle: fmtSchedule(g.schedule),
        onClick: () =>
          navigate(
            `#/attendance/group?groupId=${encodeURIComponent(g.id)}&date=${encodeURIComponent(dateISO)}`
          )
      })
    );
  }
  main.appendChild(list);
  return main;
}

export async function renderAttendanceGroup({ store, now, navigate, params }) {
  const groupId = params.get("groupId");
  const dateISO = params.get("date") || isoDate(now);
  const date = new Date(`${dateISO}T12:00:00`);

  const [group, memberships, trainees] = await Promise.all([
    store.get("groups", groupId),
    store.getAllByIndex("memberships", "byGroup", groupId),
    store.getAll("trainees")
  ]);

  const main = el("div", { class: "container" });
  if (!group) {
    setTitle("Obecność");
    setActions([]);
    main.appendChild(el("div", { class: "card" }, [el("div", { class: "title", text: "Nie znaleziono grupy" })]));
    return main;
  }

  setTitle(groupHasTrainingOnDate(group, date) ? "Obecność (dziś)" : "Obecność");
  setActions([]);

  const dateLabel = dateLabelForGroup(group, dateISO);

  const traineeById = new Map(trainees.map((t) => [t.id, t]));
  const roster = memberships
    .map((m) => traineeById.get(m.traineeId))
    .filter(Boolean)
    .sort(
      (a, b) =>
        (a.firstName ?? "").localeCompare(b.firstName ?? "") || (a.lastName ?? "").localeCompare(b.lastName ?? "")
    );

  const attendanceRows = await store.getAllByIndex("attendance", "byDateGroup", [dateISO, groupId]);
  const presentByTrainee = new Map(attendanceRows.map((r) => [r.traineeId, Boolean(r.present)]));

  const month = String(dateISO).slice(0, 7);
  const paymentRows = await store.getAllByIndex("payments", "byMonth", month);
  const paidByTrainee = new Map(paymentRows.map((p) => [p.traineeId, Boolean(p.paid)]));

  const [scopeCatalog, sessionScopeRow] = await Promise.all([
    store.getAll("scopes"),
    getSessionScopes(store, dateISO, groupId)
  ]);
  const scopesById = new Map(scopeCatalog.map((s) => [s.id, s]));
  let selectedScopeIds = Array.isArray(sessionScopeRow?.scopeIds) ? sessionScopeRow.scopeIds.slice() : [];

  let search = "";
  const stats = el("div", { class: "pill pill--nowrap" });
  const list = el("div", { class: "list" });

  function updateStats() {
    const presentCount = roster.reduce((sum, t) => sum + (presentByTrainee.get(t.id) ? 1 : 0), 0);
    stats.textContent = `Obecni: ${presentCount}/${roster.length}`;
  }

  function renderList() {
    list.innerHTML = "";
    updateStats();

    const q = (search ?? "").trim().toLowerCase();
    const filtered = q
      ? roster.filter((t) => `${t.firstName ?? ""} ${t.lastName ?? ""}`.toLowerCase().includes(q))
      : roster;

    if (filtered.length === 0) {
      list.appendChild(el("div", { class: "card" }, [el("div", { class: "sub", text: "Brak wyników." })]));
      return;
    }

    for (const t of filtered) {
      const isOn = presentByTrainee.get(t.id) ?? false;
      const paid = paidByTrainee.get(t.id) ?? false;
      const rightToggle = iconToggle(isOn);
      const payDot = el("div", {
        class: `paydot ${paid ? "paydot--paid" : "paydot--unpaid"}`,
        title: paid ? "Opłacone" : "Nieopłacone",
        "aria-hidden": "true"
      });
      const right = el("div", { class: "row", style: "gap:8px;align-items:center;justify-content:flex-end" }, [
        payDot,
        rightToggle
      ]);
      list.appendChild(
        bigListItem({
          title: `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim() || "Osoba",
          subtitle: t.phone || t.email ? `${t.phone ?? ""}${t.phone && t.email ? " · " : ""}${t.email ?? ""}` : null,
          right,
          onClick: async () => {
            const next = !(presentByTrainee.get(t.id) ?? false);
            presentByTrainee.set(t.id, next);
            rightToggle.classList.toggle("on", next);
            updateStats();
            await setAttendance(store, dateISO, groupId, t.id, next);
          }
        })
      );
    }
  }

  const heroCard = el("div", { class: "card card--hero" }, [
      el("div", { class: "row space" }, [
        el("div", { class: "stack" }, [
          el("div", { class: "title", text: group.name ?? "Grupa" })
        ]),
        el("div", { class: "row", style: "gap:8px" }, [
          btn("Zakres", () => {
            const selected = new Set(selectedScopeIds);
            let searchScopes = "";
            const searchInput = el("input", {
              class: "input",
              type: "search",
              placeholder: "Szukaj…",
              oninput: (e) => {
                searchScopes = e.target.value ?? "";
                renderScopeList();
              }
            });
            const list = el("div", { class: "checklist" });

            const options = scopeCatalog.slice().sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
            function renderScopeList() {
              list.innerHTML = "";
              const q = (searchScopes ?? "").trim().toLowerCase();
              const filtered = q ? options.filter((s) => (s.name ?? "").toLowerCase().includes(q)) : options;
              if (filtered.length === 0) {
                list.appendChild(el("div", { class: "sub muted", text: "Brak wyników." }));
                return;
              }
              for (const s of filtered) {
                const cb = el("input", { type: "checkbox" });
                cb.checked = selected.has(s.id);
                const row = el("div", { class: "checkitem", role: "button", tabindex: "0" }, [
                  cb,
                  el("div", { class: "title", text: s.name ?? "Pozycja" })
                ]);
                function sync() {
                  if (cb.checked) selected.add(s.id);
                  else selected.delete(s.id);
                }
                cb.addEventListener("change", sync);
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

            renderScopeList();
            const body = el("div", { class: "stack" }, [searchInput, list]);
            openModal({
              title: "Zakres zajęć",
              body,
              footer: [
                btn("Anuluj", () => closeModal(), "btn--ghost"),
                btn(
                  "Zapisz",
                  async () => {
                    selectedScopeIds = Array.from(selected);
                    await setSessionScopes(store, dateISO, groupId, selectedScopeIds);
                    closeModal();
                    renderSelectedScopes();
                  },
                  "btn--good"
                )
              ]
            });
          }),
          btn("←", () => navigate("#/attendance"))
        ])
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
        el("button", {
          class: "input input--button",
          type: "button",
          text: dateLabel,
          onclick: () => {
            const body = el("div", { class: "stack" }, [
              calendar({
                group,
                selectedISO: dateISO,
                onSelect: (iso) => {
                  closeModal();
                  navigate(`#/attendance/group?groupId=${encodeURIComponent(groupId)}&date=${encodeURIComponent(iso)}`);
                }
              })
            ]);
            openModal({
              title: "Wybierz datę",
              body,
              footer: [
                btn("Zamknij", () => closeModal()),
                btn("Dzisiaj", () => {
                  const today = isoDate(new Date());
                  closeModal();
                  navigate(`#/attendance/group?groupId=${encodeURIComponent(groupId)}&date=${encodeURIComponent(today)}`);
                }, "btn--primary")
              ]
            });
          }
        })
      ])
    ])
  ;

  const scopesRow = el("div", { class: "row", style: "gap:8px;flex-wrap:wrap;margin-top:10px" });
  function renderSelectedScopes() {
    scopesRow.innerHTML = "";
    const names = selectedScopeIds.map((id) => scopesById.get(id)?.name).filter(Boolean);
    if (names.length === 0) return;
    for (const n of names.slice(0, 8)) scopesRow.appendChild(el("div", { class: "pill", text: n }));
    if (names.length > 8) scopesRow.appendChild(el("div", { class: "pill", text: `+${names.length - 8}` }));
  }
  renderSelectedScopes();
  heroCard.appendChild(scopesRow);

  main.appendChild(heroCard);

  main.appendChild(
    el("div", { class: "card" }, [
      el("div", { class: "row space wrap" }, [
        stats,
        el("div", { class: "row", style: "gap:8px;flex-wrap:wrap;justify-content:flex-end" }, [
          btn("Wszyscy obecni", async () => {
            await Promise.all(roster.map((t) => setAttendance(store, dateISO, groupId, t.id, true)));
            roster.forEach((t) => presentByTrainee.set(t.id, true));
            showToast("Zapisano: wszyscy obecni");
            renderList();
          }),
          btn("Wszyscy nieobecni", async () => {
            await Promise.all(roster.map((t) => setAttendance(store, dateISO, groupId, t.id, false)));
            roster.forEach((t) => presentByTrainee.set(t.id, false));
            showToast("Zapisano: wszyscy nieobecni");
            renderList();
          })
        ])
      ])
    ])
  );

  if (memberships.length === 0) {
    list.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "title", text: "Brak osób w tej grupie" }),
        el("div", { class: "sub", text: "Wejdź w Grupę i dodaj osoby." }),
        el("div", { style: "margin-top:10px" }, [
          btn("Otwórz grupę", () => navigate(`#/groups/detail?groupId=${encodeURIComponent(groupId)}`), "btn--primary")
        ])
      ])
    );
  } else {
    renderList();
  }

  main.appendChild(list);
  return main;
}
