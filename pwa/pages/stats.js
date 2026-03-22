import { isoDate, isoMonth } from "../db.js";
import { computeTraineeFee } from "../logic.js";
import { bigListItem, btn, el, fmtMoney, setActions, setTitle } from "../ui.js";

function monthToParts(m) {
  const [y, mm] = String(m).split("-").map((x) => Number(x));
  return { y, m: mm };
}

function partsToMonth({ y, m }) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function addMonths(month, delta) {
  const p = monthToParts(month);
  let y = p.y;
  let m = p.m + delta;
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return partsToMonth({ y, m });
}

function cmpMonth(a, b) {
  return a.localeCompare(b);
}

function monthRange(from, toInclusive) {
  const out = [];
  let cur = from;
  while (cmpMonth(cur, toInclusive) <= 0) {
    out.push(cur);
    cur = addMonths(cur, 1);
    if (out.length > 240) break;
  }
  return out;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function svgBars({ labels, values, color }) {
  const w = 360;
  const h = 120;
  const pad = 10;
  const bw = (w - pad * 2) / Math.max(1, values.length);
  const max = Math.max(1, ...values);
  const bars = values
    .map((v, i) => {
      const x = pad + i * bw + 2;
      const barW = Math.max(2, bw - 4);
      const barH = ((h - pad * 2) * v) / max;
      const y = h - pad - barH;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="6" fill="${color}"></rect>`;
    })
    .join("");

  const ticks = labels
    .map((lab, i) => {
      const x = pad + i * bw + bw / 2;
      return `<text x="${x}" y="${h - 2}" text-anchor="middle" font-size="10" fill="rgba(255,255,255,0.65)">${lab}</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="120" role="img" aria-label="Wykres słupkowy">
  ${bars}
  ${ticks}
</svg>`;
}

function svgStackBar(present, total) {
  const w = 360;
  const h = 26;
  const pad = 2;
  const ratio = total <= 0 ? 0 : clamp(present / total, 0, 1);
  const pw = Math.round((w - pad * 2) * ratio);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="26" role="img" aria-label="Obecność">
  <rect x="${pad}" y="${pad}" width="${w - pad * 2}" height="${h - pad * 2}" rx="12" fill="rgba(255,255,255,0.10)"></rect>
  <rect x="${pad}" y="${pad}" width="${pw}" height="${h - pad * 2}" rx="12" fill="rgba(52,211,153,0.55)"></rect>
</svg>`;
}

export async function renderStats({ store, pricing, now, navigate }) {
  setTitle("Statystyki");
  setActions([]);

  const main = el("div", { class: "container" });
  const trainees = await store.getAll("trainees");

  if (trainees.length === 0) {
    main.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "title", text: "Brak osób" }),
        el("div", { class: "sub", text: "Dodaj osoby, żeby zobaczyć statystyki." }),
        el("div", { style: "margin-top:10px" }, [btn("Przejdź do Osób", () => navigate("#/people"), "btn--primary")])
      ])
    );
    return main;
  }

  const sorted = trainees
    .slice()
    .sort((a, b) => (a.lastName ?? "").localeCompare(b.lastName ?? "") || (a.firstName ?? "").localeCompare(b.firstName ?? ""));

  let selectedId = "__all__";
  let range = "30d";

  const personSelect = el(
    "select",
    {
      onchange: (e) => {
        selectedId = e.target.value;
        renderBody();
      }
    },
    [
      el("option", { value: "__all__", text: "Wszyscy" }),
      ...sorted.map((t) => el("option", { value: t.id, text: `${t.lastName ?? ""} ${t.firstName ?? ""}`.trim() || "Osoba" }))
    ]
  );

  const rangeSelect = el(
    "select",
    {
      onchange: (e) => {
        range = e.target.value;
        renderBody();
      }
    },
    [
      el("option", { value: "30d", text: "Ostatnie 30 dni" }),
      el("option", { value: "90d", text: "Ostatnie 90 dni" }),
      el("option", { value: "thisMonth", text: "Bieżący miesiąc" })
    ]
  );

  const bodyRoot = el("div", { class: "stack" });

  main.appendChild(
    el("div", { class: "card card--hero" }, [
      el("div", { class: "row space" }, [
        el("div", { class: "stack" }, [
          el("div", { class: "title", text: "Statystyki" }),
          el("div", { class: "sub", text: "Obecność oraz zaległe płatności w formie wykresów." })
        ]),
        el("div", { class: "stack", style: "gap:8px;min-width: 220px" }, [personSelect, rangeSelect])
      ])
    ])
  );

  main.appendChild(bodyRoot);

  async function renderBody() {
    bodyRoot.innerHTML = "";

    const rangeEnd = new Date(now);
    let rangeStart = new Date(now);
    if (range === "30d") rangeStart = new Date(rangeEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
    else if (range === "90d") rangeStart = new Date(rangeEnd.getTime() - 90 * 24 * 60 * 60 * 1000);
    else if (range === "thisMonth") {
      rangeStart = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1, 12, 0, 0);
    }
    const startISO = isoDate(rangeStart);
    const endISO = isoDate(rangeEnd);

    const currentMonth = isoMonth(now);
    const prevMonth = addMonths(currentMonth, -1);
    const payments = await store.getAll("payments");
    const payKey = (tid, m) => `${tid}|${m}`;
    const paymentMap = new Map(payments.map((p) => [payKey(p.traineeId, p.month), p]));

    const allMemberships = await store.getAll("memberships");
    const membershipByTrainee = new Map();
    const traineeIdsByGroup = new Map();
    for (const m of allMemberships) {
      const arr = membershipByTrainee.get(m.traineeId) ?? [];
      arr.push(m);
      membershipByTrainee.set(m.traineeId, arr);
      const set = traineeIdsByGroup.get(m.groupId) ?? new Set();
      set.add(m.traineeId);
      traineeIdsByGroup.set(m.groupId, set);
    }

    const groups = await store.getAll("groups");
    const groupById = new Map(groups.map((g) => [g.id, g]));

    const attendanceAll = (await store.getAll("attendance")).filter((r) => r.dateISO >= startISO && r.dateISO <= endISO);

    if (selectedId === "__all__") {
      // Overall attendance + by group
      const overallPresent = attendanceAll.filter((r) => r.present).length;
      const overallTotal = attendanceAll.length;
      const overallCard = el("div", { class: "card" }, [
        el("div", { class: "row space" }, [
          el("div", { class: "title", text: "Obecność (wszyscy)" }),
          el("div", { class: "pill", text: `${startISO} → ${endISO}` })
        ]),
        el("div", { class: "sub", text: `Zapisane wpisy: ${overallPresent}/${overallTotal} (${overallTotal ? Math.round((overallPresent / overallTotal) * 100) : 0}%).` }),
        el("div", { class: "hr" })
      ]);
      overallCard.insertAdjacentHTML("beforeend", svgStackBar(overallPresent, overallTotal));
      bodyRoot.appendChild(overallCard);

      const byGroup = new Map();
      for (const r of attendanceAll) {
        const agg = byGroup.get(r.groupId) ?? { present: 0, total: 0 };
        agg.total += 1;
        if (r.present) agg.present += 1;
        byGroup.set(r.groupId, agg);
      }
      const groupRows = Array.from(byGroup.entries())
        .map(([groupId, agg]) => ({
          groupId,
          name: groupById.get(groupId)?.name ?? "Grupa",
          present: agg.present,
          total: agg.total,
          pct: agg.total ? Math.round((agg.present / agg.total) * 100) : 0
        }))
        .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));

      const groupCard = el("div", { class: "card" }, [
        el("div", { class: "title", text: "Obecność wg grup" }),
        el("div", { class: "sub", text: "Wykres pokazuje % obecności (wg zapisanych wpisów w danym zakresie)." }),
        el("div", { class: "hr" })
      ]);
      if (groupRows.length === 0) {
        groupCard.appendChild(el("div", { class: "sub", text: "Brak wpisów obecności w wybranym zakresie." }));
      } else {
        const labs = groupRows.slice(0, 8).map((x) => (x.name.length > 10 ? `${x.name.slice(0, 10)}…` : x.name));
        const vals = groupRows.slice(0, 8).map((x) => x.pct);
        groupCard.insertAdjacentHTML("beforeend", svgBars({ labels: labs, values: vals, color: "rgba(96,165,250,0.55)" }));
        const list = el("div", { class: "list", style: "margin-top:10px" });
        groupRows.forEach((g) => {
          list.appendChild(
            bigListItem({
              title: g.name,
              subtitle: `Obecność: ${g.present}/${g.total} (${g.pct}%)`,
              onClick: () => navigate(`#/attendance/group?groupId=${encodeURIComponent(g.groupId)}&date=${encodeURIComponent(endISO)}`)
            })
          );
        });
        groupCard.appendChild(list);
      }
      bodyRoot.appendChild(groupCard);

      // Payments overdue: summary + by group
      const overdueCountByTrainee = new Map();
      let overdueMonthsTotal = 0;
      let overduePeople = 0;
      for (const t of sorted) {
        const ms = membershipByTrainee.get(t.id) ?? [];
        const startAt = Math.min(t.createdAt ?? Date.now(), ...(ms.map((x) => x.createdAt ?? Date.now())));
        const startMonth = isoMonth(new Date(startAt));
        const overdueMonths = monthRange(startMonth, prevMonth).filter((m) => {
          const p = paymentMap.get(payKey(t.id, m));
          return !p || !p.paid;
        }).length;
        overdueCountByTrainee.set(t.id, overdueMonths);
        overdueMonthsTotal += overdueMonths;
        if (overdueMonths > 0) overduePeople += 1;
      }

      const overdueCard = el("div", { class: "card" }, [
        el("div", { class: "row space" }, [
          el("div", { class: "title", text: "Zaległe płatności (wszyscy)" }),
          el("div", { class: "pill", text: `Osób z zaległością: ${overduePeople}` })
        ]),
        el("div", { class: "sub", text: `Suma zaległych miesięcy: ${overdueMonthsTotal}. Liczone do poprzedniego miesiąca (${prevMonth}).` }),
        el("div", { class: "hr" })
      ]);

      const top = sorted
        .map((t) => ({ id: t.id, name: `${t.lastName ?? ""} ${t.firstName ?? ""}`.trim(), overdue: overdueCountByTrainee.get(t.id) ?? 0 }))
        .sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name))
        .slice(0, 8)
        .filter((x) => x.overdue > 0);

      if (top.length === 0) {
        overdueCard.appendChild(el("div", { class: "sub", text: "Brak zaległości (wg danych w aplikacji)." }));
      } else {
        const labs = top.map((x) => x.name.split(" ")[0] ?? x.name).map((x) => (x.length > 8 ? `${x.slice(0, 8)}…` : x));
        const vals = top.map((x) => x.overdue);
        overdueCard.insertAdjacentHTML("beforeend", svgBars({ labels: labs, values: vals, color: "rgba(251,113,133,0.55)" }));
      }
      bodyRoot.appendChild(overdueCard);

      const groupPayRows = groups
        .map((g) => {
          const ids = traineeIdsByGroup.get(g.id) ?? new Set();
          let people = 0;
          let months = 0;
          for (const tid of ids) {
            const c = overdueCountByTrainee.get(tid) ?? 0;
            months += c;
            if (c > 0) people += 1;
          }
          return { groupId: g.id, name: g.name ?? "Grupa", people, months, members: ids.size };
        })
        .filter((x) => x.members > 0)
        .sort((a, b) => b.people - a.people || b.months - a.months || a.name.localeCompare(b.name));

      const groupPayCard = el("div", { class: "card" }, [
        el("div", { class: "title", text: "Zaległości wg grup" }),
        el("div", { class: "sub", text: "Wykres: liczba osób z zaległością w każdej grupie." }),
        el("div", { class: "hr" })
      ]);
      if (groupPayRows.length === 0) {
        groupPayCard.appendChild(el("div", { class: "sub", text: "Brak grup z przypisanymi osobami." }));
      } else {
        const labs = groupPayRows.slice(0, 8).map((x) => (x.name.length > 10 ? `${x.name.slice(0, 10)}…` : x.name));
        const vals = groupPayRows.slice(0, 8).map((x) => x.people);
        groupPayCard.insertAdjacentHTML("beforeend", svgBars({ labels: labs, values: vals, color: "rgba(251,113,133,0.55)" }));
        const list = el("div", { class: "list", style: "margin-top:10px" });
        groupPayRows.forEach((g) => {
          list.appendChild(
            bigListItem({
              title: g.name,
              subtitle: `Zaległości: ${g.people}/${g.members} osób · miesięcy: ${g.months}`,
              onClick: () => navigate(`#/groups/detail?groupId=${encodeURIComponent(g.groupId)}`)
            })
          );
        });
        groupPayCard.appendChild(list);
      }
      bodyRoot.appendChild(groupPayCard);

      return;
    }

    // Per-person view (existing)
    const trainee = await store.get("trainees", selectedId);
    if (!trainee) return;

    const attendanceRows = (await store.getAllByIndex("attendance", "byTrainee", selectedId))
      .filter((r) => r.dateISO >= startISO && r.dateISO <= endISO)
      .sort((a, b) => (a.dateISO ?? "").localeCompare(b.dateISO ?? ""));

    const present = attendanceRows.filter((r) => r.present).length;
    const total = attendanceRows.length;

    const attendanceCard = el("div", { class: "card" }, [
      el("div", { class: "row space" }, [
        el("div", { class: "title", text: "Obecność" }),
        el("div", { class: "pill", text: `${startISO} → ${endISO}` })
      ]),
      el("div", { class: "sub", text: `Zapisane wpisy: ${present}/${total} (${total ? Math.round((present / total) * 100) : 0}%).` }),
      el("div", { class: "hr" })
    ]);
    attendanceCard.insertAdjacentHTML("beforeend", svgStackBar(present, total));
    bodyRoot.appendChild(attendanceCard);

    const memberships = membershipByTrainee.get(selectedId) ?? [];
    const startAt = Math.min(trainee.createdAt ?? Date.now(), ...(memberships.map((m) => m.createdAt ?? Date.now())));
    const startMonth = isoMonth(new Date(startAt));

    const months = monthRange(addMonths(currentMonth, -5), currentMonth);
    const overdueMonths = monthRange(startMonth, prevMonth).filter((m) => {
      const p = paymentMap.get(payKey(selectedId, m));
      return !p || !p.paid;
    });

    const paymentCard = el("div", { class: "card" }, [
      el("div", { class: "row space" }, [
        el("div", { class: "title", text: "Zaległe płatności" }),
        el("div", { class: "pill", text: `Zaległe miesiące: ${overdueMonths.length}` })
      ]),
      el("div", { class: "sub", text: "Wykres: ostatnie 6 miesięcy (zielone = opłacone, czerwone = zaległe/brak)." }),
      el("div", { class: "hr" })
    ]);

    const labels = months.map((m) => m.slice(5));
    const values = months.map((m) => {
      const p = paymentMap.get(payKey(selectedId, m));
      if (p && p.paid) return 1;
      return 0;
    });
    const svg = `<svg viewBox="0 0 360 120" width="100%" height="120" role="img" aria-label="Płatności (6 miesięcy)">
${months
  .map((m, i) => {
    const paid = values[i] === 1;
    const x = 10 + i * ((360 - 20) / 6) + 2;
    const bw = ((360 - 20) / 6) - 4;
    const barH = paid ? 90 : 30;
    const y = 110 - barH;
    const fill = paid ? "rgba(52,211,153,0.55)" : "rgba(251,113,133,0.55)";
    return `<rect x="${x}" y="${y}" width="${bw}" height="${barH}" rx="6" fill="${fill}"></rect>`;
  })
  .join("\n")}
${labels
  .map((lab, i) => {
    const x = 10 + i * ((360 - 20) / 6) + ((360 - 20) / 6) / 2;
    return `<text x="${x}" y="118" text-anchor="middle" font-size="10" fill="rgba(255,255,255,0.65)">${lab}</text>`;
  })
  .join("\n")}
</svg>`;
    paymentCard.insertAdjacentHTML("beforeend", svg);

    if (overdueMonths.length > 0) {
      paymentCard.appendChild(
        el("div", {
          class: "sub",
          text: `Zaległe: ${overdueMonths.slice(-6).join(", ")}${overdueMonths.length > 6 ? "…" : ""}`
        })
      );
    } else {
      paymentCard.appendChild(el("div", { class: "sub", text: "Brak zaległości." }));
    }
    bodyRoot.appendChild(paymentCard);

    const fee = await computeTraineeFee({ store, pricing }, selectedId);
    const mode = trainee.pricingMode ?? "auto";
    const amount = mode === "manual" ? Number(trainee.manualMonthlyFee ?? 0) : Number(fee.autoFee ?? 0);
    bodyRoot.appendChild(
      el("div", { class: "pill" }, [
        el("span", { text: `Kwota domyślna: ${fmtMoney(amount, pricing.currency)} (${mode === "manual" ? "ręcznie" : "auto"})` })
      ])
    );
  }

  await renderBody();
  return main;
}
