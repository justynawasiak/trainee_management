import { isoDate, isoMonth } from "../db.js";
import { computeTraineeFee, groupHasTrainingOnDate } from "../logic.js";
import { bigListItem, btn, el, fmtMoney, setActions, setTitle } from "../ui.js";

function monthToParts(month) {
  const [year, monthNum] = String(month).split("-").map((x) => Number(x));
  return { year, month: monthNum };
}

function partsToMonth({ year, month }) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function addMonths(month, delta) {
  const parts = monthToParts(month);
  let year = parts.year;
  let monthNum = parts.month + delta;
  while (monthNum <= 0) {
    monthNum += 12;
    year -= 1;
  }
  while (monthNum > 12) {
    monthNum -= 12;
    year += 1;
  }
  return partsToMonth({ year, month: monthNum });
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

function monthsInDateRange(startISO, endISO) {
  return monthRange(isoMonth(new Date(`${startISO}T12:00:00`)), isoMonth(new Date(`${endISO}T12:00:00`)));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function dateRange(startISO, endISO) {
  const out = [];
  let cur = new Date(`${startISO}T12:00:00`);
  const end = new Date(`${endISO}T12:00:00`);
  while (cur <= end) {
    out.push(isoDate(cur));
    cur.setDate(cur.getDate() + 1);
    if (out.length > 370) break;
  }
  return out;
}

function buildMembershipMaps(memberships) {
  const byTrainee = new Map();
  const byGroup = new Map();

  for (const membership of memberships) {
    const traineeRows = byTrainee.get(membership.traineeId) ?? [];
    traineeRows.push(membership);
    byTrainee.set(membership.traineeId, traineeRows);

    const groupRows = byGroup.get(membership.groupId) ?? [];
    groupRows.push(membership);
    byGroup.set(membership.groupId, groupRows);
  }

  return { byTrainee, byGroup };
}

function buildAttendanceMaps(rows) {
  const presentByKey = new Map();
  const rowsByTrainee = new Map();

  for (const row of rows) {
    if (!row?.dateISO || !row?.groupId || !row?.traineeId) continue;

    const key = `${row.dateISO}|${row.groupId}|${row.traineeId}`;
    presentByKey.set(key, Boolean(row.present));

    const traineeRows = rowsByTrainee.get(row.traineeId) ?? [];
    traineeRows.push(row);
    rowsByTrainee.set(row.traineeId, traineeRows);
  }

  return { presentByKey, rowsByTrainee };
}

function computeGroupAttendanceStats({ groups, membershipsByGroup, presentByKey, startISO, endISO }) {
  const stats = new Map();
  const dates = dateRange(startISO, endISO);

  for (const group of groups) {
    let total = 0;
    let present = 0;
    const memberships = membershipsByGroup.get(group.id) ?? [];

    for (const dateISO of dates) {
      const date = new Date(`${dateISO}T12:00:00`);
      if (!groupHasTrainingOnDate(group, date)) continue;

      total += memberships.length;
      for (const membership of memberships) {
        const key = `${dateISO}|${group.id}|${membership.traineeId}`;
        if (presentByKey.get(key)) present += 1;
      }
    }

    stats.set(group.id, { present, total });
  }

  return stats;
}

function computeTraineeAttendanceStats({ traineeId, memberships, groupById, presentRows, startISO, endISO }) {
  const dates = dateRange(startISO, endISO);
  let total = 0;

  for (const membership of memberships) {
    const group = groupById.get(membership.groupId);
    if (!group) continue;

    for (const dateISO of dates) {
      const date = new Date(`${dateISO}T12:00:00`);
      if (!groupHasTrainingOnDate(group, date)) continue;
      total += 1;
    }
  }

  const present = (presentRows ?? []).filter((row) => row.traineeId === traineeId && row.present).length;
  return { present, total };
}

function svgBars({ labels, values, color }) {
  const width = 360;
  const height = 120;
  const pad = 10;
  const barWidth = (width - pad * 2) / Math.max(1, values.length);
  const max = Math.max(1, ...values);

  const bars = values
    .map((value, index) => {
      const x = pad + index * barWidth + 2;
      const w = Math.max(2, barWidth - 4);
      const h = ((height - pad * 2) * value) / max;
      const y = height - pad - h;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${color}"></rect>`;
    })
    .join("");

  const ticks = labels
    .map((label, index) => {
      const x = pad + index * barWidth + barWidth / 2;
      return `<text x="${x}" y="${height - 2}" text-anchor="middle" font-size="11" fill="rgba(255,255,255,0.72)">${label}</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="120" role="img" aria-label="Wykres slupkowy">
  ${bars}
  ${ticks}
</svg>`;
}

function svgStackBar(present, total) {
  const width = 360;
  const height = 26;
  const pad = 2;
  const ratio = total <= 0 ? 0 : clamp(present / total, 0, 1);
  const presentWidth = Math.round((width - pad * 2) * ratio);

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="26" role="img" aria-label="Obecnosc">
  <rect x="${pad}" y="${pad}" width="${width - pad * 2}" height="${height - pad * 2}" rx="12" fill="rgba(255,255,255,0.10)"></rect>
  <rect x="${pad}" y="${pad}" width="${presentWidth}" height="${height - pad * 2}" rx="12" fill="rgba(52,211,153,0.55)"></rect>
</svg>`;
}

function appendPaymentCard(bodyRoot, title, description, rows, color) {
  const card = el("div", { class: "card" }, [
    el("div", { class: "stack" }, [
      el("div", { class: "title", text: title }),
      el("div", { class: "sub", text: description })
    ]),
    el("div", { class: "hr" })
  ]);

  const visibleRows = rows.filter((row) => row.active > 0);
  if (visibleRows.length === 0) {
    card.appendChild(el("div", { class: "sub", text: "Brak danych w wybranym zakresie." }));
    bodyRoot.appendChild(card);
    return;
  }

  card.insertAdjacentHTML(
    "beforeend",
    svgBars({
      labels: visibleRows.map((row) => row.month.slice(5)),
      values: visibleRows.map((row) => row.pct),
      color
    })
  );

  const list = el("div", { class: "list", style: "margin-top:10px" });
  visibleRows
    .slice()
    .reverse()
    .forEach((row) => {
      list.appendChild(
        bigListItem({
          title: row.month,
          subtitle: `Oplacone: ${row.paid}/${row.active} (${row.pct}%) · nieoplacone: ${row.unpaid}`
        })
      );
    });

  card.appendChild(list);
  bodyRoot.appendChild(card);
}

export async function renderStats({ store, pricing, now, navigate }) {
  setTitle("Statystyki");
  setActions([]);

  const main = el("div", { class: "container stats" });
  const trainees = await store.getAll("trainees");

  if (trainees.length === 0) {
    main.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "title", text: "Brak osob" }),
        el("div", { class: "sub", text: "Dodaj osoby, aby zobaczyc statystyki." }),
        el("div", { style: "margin-top:10px" }, [btn("Przejdz do Osob", () => navigate("#/people"), "btn--primary")])
      ])
    );
    return main;
  }

  const sorted = trainees
    .slice()
    .sort((a, b) => (a.firstName ?? "").localeCompare(b.firstName ?? "") || (a.lastName ?? "").localeCompare(b.lastName ?? ""));

  let selectedId = "__all__";
  let range = "30d";

  const personSelect = el(
    "select",
    {
      class: "input",
      onchange: (e) => {
        selectedId = e.target.value;
        renderBody();
      }
    },
    [
      el("option", { value: "__all__", text: "Wszyscy" }),
      ...sorted.map((trainee) =>
        el("option", {
          value: trainee.id,
          text: `${trainee.firstName ?? ""} ${trainee.lastName ?? ""}`.trim() || "Osoba"
        })
      )
    ]
  );

  const rangeSelect = el(
    "select",
    {
      class: "input",
      onchange: (e) => {
        range = e.target.value;
        renderBody();
      }
    },
    [
      el("option", { value: "30d", text: "Ostatnie 30 dni" }),
      el("option", { value: "90d", text: "Ostatnie 90 dni" }),
      el("option", { value: "thisMonth", text: "Biezacy miesiac" })
    ]
  );

  const bodyRoot = el("div", { class: "stack" });

  main.appendChild(
    el("div", { class: "card card--hero" }, [
      el("div", { class: "row space wrap" }, [
        el("div", { class: "stack" }, [el("div", { class: "title", text: "Statystyki" })]),
        el("div", { class: "stack", style: "gap:8px" }, [personSelect, rangeSelect])
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
    else if (range === "thisMonth") rangeStart = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1, 12, 0, 0);

    const startISO = isoDate(rangeStart);
    const endISO = isoDate(rangeEnd);
    const currentMonth = isoMonth(now);
    const prevMonth = addMonths(currentMonth, -1);

    const payments = await store.getAll("payments");
    const payKey = (traineeId, month) => `${traineeId}|${month}`;
    const paymentMap = new Map(payments.map((payment) => [payKey(payment.traineeId, payment.month), payment]));

    const allMemberships = await store.getAll("memberships");
    const { byTrainee: membershipsByTrainee, byGroup: membershipsByGroup } = buildMembershipMaps(allMemberships);

    const groups = await store.getAll("groups");
    const groupById = new Map(groups.map((group) => [group.id, group]));

    const attendanceRows = (await store.getAll("attendance")).filter((row) => row.dateISO >= startISO && row.dateISO <= endISO);
    const { presentByKey, rowsByTrainee } = buildAttendanceMaps(attendanceRows);
    const groupAttendanceStats = computeGroupAttendanceStats({
      groups,
      membershipsByGroup,
      presentByKey,
      startISO,
      endISO
    });

    if (selectedId === "__all__") {
      const overallPresent = Array.from(groupAttendanceStats.values()).reduce((sum, item) => sum + item.present, 0);
      const overallTotal = Array.from(groupAttendanceStats.values()).reduce((sum, item) => sum + item.total, 0);

      const overallCard = el("div", { class: "card" }, [
        el("div", { class: "row space wrap" }, [
          el("div", { class: "title", text: "Obecnosc (wszyscy)" }),
          el("div", { class: "pill", text: `${startISO} -> ${endISO}` })
        ]),
        el("div", {
          class: "sub",
          text: `Obecnosc: ${overallPresent}/${overallTotal} (${overallTotal ? Math.round((overallPresent / overallTotal) * 100) : 0}%).`
        }),
        el("div", { class: "hr" })
      ]);
      overallCard.insertAdjacentHTML("beforeend", svgStackBar(overallPresent, overallTotal));
      bodyRoot.appendChild(overallCard);

      const groupRows = Array.from(groupAttendanceStats.entries())
        .map(([groupId, item]) => ({
          groupId,
          name: groupById.get(groupId)?.name ?? "Grupa",
          present: item.present,
          total: item.total,
          pct: item.total ? Math.round((item.present / item.total) * 100) : 0
        }))
        .filter((item) => item.total > 0)
        .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));

      const attendanceByGroupCard = el("div", { class: "card" }, [
        el("div", { class: "stack" }, [
          el("div", { class: "title", text: "Obecnosc wg grup" }),
          el("div", { class: "sub", text: "Wykres pokazuje frekwencje we wszystkich zaplanowanych zajeciach." })
        ]),
        el("div", { class: "hr" })
      ]);

      if (groupRows.length === 0) {
        attendanceByGroupCard.appendChild(el("div", { class: "sub", text: "Brak zajec lub brak przypisanych osob w wybranym zakresie." }));
      } else {
        const labels = groupRows.slice(0, 8).map((item) => (item.name.length > 10 ? `${item.name.slice(0, 10)}...` : item.name));
        const values = groupRows.slice(0, 8).map((item) => item.pct);
        attendanceByGroupCard.insertAdjacentHTML("beforeend", svgBars({ labels, values, color: "rgba(96,165,250,0.55)" }));

        const list = el("div", { class: "list", style: "margin-top:10px" });
        groupRows.forEach((item) => {
          list.appendChild(
            bigListItem({
              title: item.name,
              subtitle: `Obecnosc: ${item.present}/${item.total} (${item.pct}%)`
            })
          );
        });
        attendanceByGroupCard.appendChild(list);
      }
      bodyRoot.appendChild(attendanceByGroupCard);

      const paymentMonths = monthsInDateRange(startISO, endISO);
      const allTraineeIds = sorted.map((trainee) => trainee.id);
      const allByMonth = new Map();
      for (const month of paymentMonths) allByMonth.set(month, new Set(allTraineeIds));

      const presentByMonth = new Map();
      for (const month of paymentMonths) presentByMonth.set(month, new Set());
      attendanceRows
        .filter((row) => row.present)
        .forEach((row) => {
          const month = String(row.dateISO ?? "").slice(0, 7);
          if (presentByMonth.has(month)) presentByMonth.get(month).add(row.traineeId);
        });

      const paymentRowsAll = paymentMonths.map((month) => {
        const activeIds = allByMonth.get(month) ?? new Set();
        let paid = 0;
        for (const traineeId of activeIds) {
          if (paymentMap.get(payKey(traineeId, month))?.paid) paid += 1;
        }
        return {
          month,
          active: activeIds.size,
          paid,
          unpaid: Math.max(0, activeIds.size - paid),
          pct: activeIds.size ? Math.round((paid / activeIds.size) * 100) : 0
        };
      });

      const paymentRowsPresent = paymentMonths.map((month) => {
        const activeIds = presentByMonth.get(month) ?? new Set();
        let paid = 0;
        for (const traineeId of activeIds) {
          if (paymentMap.get(payKey(traineeId, month))?.paid) paid += 1;
        }
        return {
          month,
          active: activeIds.size,
          paid,
          unpaid: Math.max(0, activeIds.size - paid),
          pct: activeIds.size ? Math.round((paid / activeIds.size) * 100) : 0
        };
      });

      appendPaymentCard(
        bodyRoot,
        "Platnosci wszyscy",
        "Wszystkie osoby z aplikacji, w miesiacach mieszczacych sie w wybranym zakresie.",
        paymentRowsAll,
        "rgba(251,113,133,0.55)"
      );

      appendPaymentCard(
        bodyRoot,
        "Platnosci obecni",
        "Tylko osoby, ktore byly obecne przynajmniej raz w danym miesiacu z wybranego zakresu.",
        paymentRowsPresent,
        "rgba(52,211,153,0.55)"
      );

      const groupPaymentRows = groups
        .map((group) => {
          const memberships = membershipsByGroup.get(group.id) ?? [];
          const traineeIds = new Set(memberships.map((membership) => membership.traineeId));
          let active = 0;
          let paid = 0;

          for (const month of paymentMonths) {
            for (const traineeId of traineeIds) {
              active += 1;
              if (paymentMap.get(payKey(traineeId, month))?.paid) paid += 1;
            }
          }

          return {
            name: group.name ?? "Grupa",
            active,
            paid,
            unpaid: Math.max(0, active - paid),
            pct: active ? Math.round((paid / active) * 100) : 0
          };
        })
        .filter((item) => item.active > 0)
        .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));

      const paymentsByGroupCard = el("div", { class: "card" }, [
        el("div", { class: "stack" }, [
          el("div", { class: "title", text: "Platnosci wg grup" }),
          el("div", { class: "sub", text: "Osoby przypisane do grup, w miesiacach mieszczacych sie w wybranym zakresie." })
        ]),
        el("div", { class: "hr" })
      ]);

      if (groupPaymentRows.length === 0) {
        paymentsByGroupCard.appendChild(el("div", { class: "sub", text: "Brak grup z przypisanymi osobami." }));
      } else {
        paymentsByGroupCard.insertAdjacentHTML(
          "beforeend",
          svgBars({
            labels: groupPaymentRows.slice(0, 8).map((item) => (item.name.length > 10 ? `${item.name.slice(0, 10)}...` : item.name)),
            values: groupPaymentRows.slice(0, 8).map((item) => item.pct),
            color: "rgba(251,191,36,0.55)"
          })
        );

        const list = el("div", { class: "list", style: "margin-top:10px" });
        groupPaymentRows.forEach((item) => {
          list.appendChild(
            bigListItem({
              title: item.name,
              subtitle: `Oplacone: ${item.paid}/${item.active} (${item.pct}%) · nieoplacone: ${item.unpaid}`
            })
          );
        });
        paymentsByGroupCard.appendChild(list);
      }
      bodyRoot.appendChild(paymentsByGroupCard);
      return;
    }

    const trainee = await store.get("trainees", selectedId);
    if (!trainee) return;

    const memberships = membershipsByTrainee.get(selectedId) ?? [];
    const personalAttendance = computeTraineeAttendanceStats({
      traineeId: selectedId,
      memberships,
      groupById,
      presentRows: rowsByTrainee.get(selectedId) ?? [],
      startISO,
      endISO
    });

    const attendanceCard = el("div", { class: "card" }, [
      el("div", { class: "row space" }, [
        el("div", { class: "title", text: "Obecnosc" }),
        el("div", { class: "pill", text: `${startISO} -> ${endISO}` })
      ]),
      el("div", {
        class: "sub",
        text: `Obecnosc: ${personalAttendance.present}/${personalAttendance.total} (${personalAttendance.total ? Math.round((personalAttendance.present / personalAttendance.total) * 100) : 0}%).`
      }),
      el("div", { class: "hr" })
    ]);
    attendanceCard.insertAdjacentHTML("beforeend", svgStackBar(personalAttendance.present, personalAttendance.total));
    bodyRoot.appendChild(attendanceCard);

    const startMonth = addMonths(currentMonth, -5);
    const months = monthRange(addMonths(currentMonth, -5), currentMonth);
    const overdueMonths = monthRange(startMonth, prevMonth).filter((month) => {
      const payment = paymentMap.get(payKey(selectedId, month));
      return !payment || !payment.paid;
    });

    const paymentCard = el("div", { class: "card" }, [
      el("div", { class: "row space wrap" }, [
        el("div", { class: "title", text: "Zalegle platnosci" }),
        el("div", { class: "pill", text: `Zalegle miesiace: ${overdueMonths.length}` })
      ]),
      el("div", { class: "sub", text: "Wykres pokazuje ostatnie 6 miesiecy. Zielone = oplacone, czerwone = brak platnosci." }),
      el("div", { class: "hr" })
    ]);

    const labels = months.map((month) => month.slice(5));
    const values = months.map((month) => (paymentMap.get(payKey(selectedId, month))?.paid ? 1 : 0));
    const svg = `<svg viewBox="0 0 360 120" width="100%" height="120" role="img" aria-label="Platnosci">
${months
  .map((month, index) => {
    const paid = values[index] === 1;
    const x = 10 + index * ((360 - 20) / 6) + 2;
    const w = (360 - 20) / 6 - 4;
    const h = paid ? 90 : 30;
    const y = 110 - h;
    const fill = paid ? "rgba(52,211,153,0.55)" : "rgba(251,113,133,0.55)";
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}"></rect>`;
  })
  .join("\n")}
${labels
  .map((label, index) => {
    const x = 10 + index * ((360 - 20) / 6) + (360 - 20) / 12;
    return `<text x="${x}" y="118" text-anchor="middle" font-size="11" fill="rgba(255,255,255,0.72)">${label}</text>`;
  })
  .join("\n")}
</svg>`;
    paymentCard.insertAdjacentHTML("beforeend", svg);

    if (overdueMonths.length > 0) {
      paymentCard.appendChild(
        el("div", {
          class: "sub",
          text: `Zalegle: ${overdueMonths.slice(-6).join(", ")}${overdueMonths.length > 6 ? "..." : ""}`
        })
      );
    } else {
      paymentCard.appendChild(el("div", { class: "sub", text: "Brak zaleglosci." }));
    }
    bodyRoot.appendChild(paymentCard);

    const fee = await computeTraineeFee({ store, pricing }, selectedId);
    const mode = trainee.pricingMode ?? "auto";
    const amount = mode === "manual" ? Number(trainee.manualMonthlyFee ?? 0) : Number(fee.autoFee ?? 0);
    bodyRoot.appendChild(
      el("div", { class: "pill" }, [
        el("span", { text: `Kwota domyslna: ${fmtMoney(amount, pricing.currency)} (${mode === "manual" ? "recznie" : "auto"})` })
      ])
    );
  }

  await renderBody();
  return main;
}
