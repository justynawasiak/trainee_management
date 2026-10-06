import { dayOfWeekIso, isoDate } from "./db.js";
import { STORE_NAMES, nonnegativeNumber, validDate, validateBackup } from "./validation.js";

export function isMembershipActive(membership) { return membership.endedAt === undefined || membership.endedAt === null; }

function membershipPeriods(membership) {
  return membership.periods ?? [{
    fromISO: membership.createdAt ? isoDate(new Date(membership.createdAt)) : "1900-01-01",
    toISO: membership.endedAt ? isoDate(new Date(membership.endedAt)) : null
  }];
}

export function membershipIncludesDate(membership, dateISO) {
  return membershipPeriods(membership).some(period => period.fromISO <= dateISO && (!period.toISO || dateISO <= period.toISO));
}

export function membershipOverlapsRange(membership, startISO, endISO) {
  return membershipPeriods(membership).some(period => period.fromISO <= endISO && (!period.toISO || period.toISO >= startISO));
}

function changeMembership(membership, active, now = Date.now()) {
  const periods = structuredClone(membershipPeriods(membership));
  if (active && !isMembershipActive(membership)) periods.push({ fromISO: isoDate(new Date(now)), toISO: null });
  if (!active && isMembershipActive(membership)) periods[periods.length - 1].toISO = isoDate(new Date(now));
  return { ...membership, periods, endedAt: active ? null : now, updatedAt: now };
}

export function scheduleForDate(group, date) {
  const dateISO = isoDate(date);
  const entries = (group?.scheduleHistory ?? []).filter(entry => entry.fromISO <= dateISO).sort((a, b) => b.fromISO.localeCompare(a.fromISO));
  return entries[0]?.schedule ?? group?.schedule ?? [];
}

export function updateGroupSchedule(group, schedule, now = new Date()) {
  const fromISO = isoDate(now);
  const history = group.scheduleHistory ?? [{ fromISO: "1900-01-01", schedule: group.schedule ?? [] }];
  return { ...group, schedule, scheduleHistory: [...history.filter(entry => entry.fromISO !== fromISO), { fromISO, schedule }], updatedAt: now.getTime() };
}

export function groupHasScheduledTrainingOnDate(group, date) {
  const dow = dayOfWeekIso(date);
  return scheduleForDate(group, date).some((e) => Number(e.dayOfWeek) === dow);
}

export function isGroupSessionCancelled(group, dateISO) {
  return Array.isArray(group?.cancelledDates) && group.cancelledDates.includes(dateISO);
}

export function groupHasTrainingOnDate(group, date) {
  return groupHasScheduledTrainingOnDate(group, date) && !isGroupSessionCancelled(group, isoDate(date));
}

export async function setGroupSessionCancelled(store, groupId, dateISO, cancelled) {
  if (!validDate(dateISO)) {
    throw new Error("Nieprawidłowa data zajęć");
  }
  if (typeof cancelled !== "boolean") throw new Error("Nieprawidłowy status zajęć");
  // Read and write in one transaction so simultaneous date changes are preserved.
  await store.runTx(["groups"], "readwrite", (transaction) => {
    const groups = transaction.objectStore("groups");
    const request = groups.get(groupId);
    request.onsuccess = () => {
      const group = request.result;
      if (!group) {
        transaction.abort();
        return;
      }
      const cancelledDates = new Set(Array.isArray(group.cancelledDates) ? group.cancelledDates : []);
      if (cancelled) cancelledDates.add(dateISO);
      else cancelledDates.delete(dateISO);
      groups.put({ ...group, cancelledDates: [...cancelledDates].sort(), updatedAt: Date.now() });
    };
  });
}

export function computeAutoFee(totalSessionsPerWeek, pricing) {
  nonnegativeNumber(totalSessionsPerWeek, "treningi/tydzień", { integer: true });
  if (totalSessionsPerWeek === 0) return 0;
  const tiers = pricing?.feeBySessionsPerWeek ?? {};
  const all = tiers.all;
  const direct = tiers[String(totalSessionsPerWeek)];
  if (direct !== undefined) return Number(direct);

  const keys = Object.keys(tiers)
    .map((k) => Number(k))
    .filter((k) => Number.isFinite(k))
    .sort((a, b) => a - b);
  if (keys.length === 0) return all !== undefined ? Number(all) : 0;

  const max = keys[keys.length - 1];
  if (all !== undefined && totalSessionsPerWeek > max) return Number(all);
  const best = keys.filter((k) => k <= totalSessionsPerWeek).pop() ?? keys[0];
  return Number(tiers[String(best)] ?? 0);
}

export async function computeTraineeFee({ store, pricing }, traineeId) {
  const memberships = await store.getAllByIndex("memberships", "byTrainee", traineeId);
  const totalSessionsPerWeek = memberships.filter(isMembershipActive).reduce((sum, m) => sum + Number(m.sessionsPerWeek ?? 0), 0);
  return {
    totalSessionsPerWeek,
    autoFee: computeAutoFee(totalSessionsPerWeek, pricing),
    currency: pricing?.currency ?? "PLN"
  };
}

export async function ensurePayment(store, month, traineeId, suggestedAmount) {
  return writePayment(store, month, traineeId, undefined, suggestedAmount);
}

export async function setPaid(store, month, traineeId, paid, amount) {
  if (typeof paid !== "boolean") throw new Error("Nieprawidłowy status płatności");
  return writePayment(store, month, traineeId, paid, amount);
}

export async function setPaymentAmount(store, month, traineeId, amount) {
  return writePayment(store, month, traineeId, undefined, amount, true);
}

async function writePayment(store, month, traineeId, paid, amount, changeAmount = false) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Nieprawidłowy miesiąc");
  const value = amount === undefined ? undefined : nonnegativeNumber(amount, "kwota");
  let row;
  await store.runTx(["payments", "trainees"], "readwrite", transaction => {
    const person = transaction.objectStore("trainees").get(traineeId);
    person.onsuccess = () => {
      if (!person.result) { transaction.abort(); return; }
      const payments = transaction.objectStore("payments");
      const request = payments.index("byMonthTrainee").get([month, traineeId]);
      request.onsuccess = () => {
        row = request.result ?? { id: store.uuid(), month, traineeId, paid: false, amount: value ?? 0, paidAt: null, createdAt: Date.now() };
        if (paid !== undefined) {
          row.paid = paid;
          row.paidAt = paid ? Date.now() : null;
        }
        if (value !== undefined && (paid !== undefined || changeAmount)) row.amount = value;
        row.updatedAt = Date.now();
        payments.put(row);
      };
    };
  });
  return row;
}

export async function setAttendance(store, dateISO, groupId, traineeId, present) {
  const rows = await setGroupAttendance(store, dateISO, groupId, [traineeId], present);
  return rows[0];
}

export async function setGroupAttendance(store, dateISO, groupId, traineeIds, present) {
  if (!validDate(dateISO) || typeof present !== "boolean") throw new Error("Nieprawidłowa obecność");
  const rows = [];
  await store.runTx(["attendance", "groups", "trainees"], "readwrite", transaction => {
    const group = transaction.objectStore("groups").get(groupId);
    group.onsuccess = () => {
      if (!group.result || isGroupSessionCancelled(group.result, dateISO)) { transaction.abort(); return; }
      for (const traineeId of new Set(traineeIds)) {
        const person = transaction.objectStore("trainees").get(traineeId);
        person.onsuccess = () => {
          if (!person.result) { transaction.abort(); return; }
          const attendance = transaction.objectStore("attendance");
          const request = attendance.index("byDateGroupTrainee").get([dateISO, groupId, traineeId]);
          request.onsuccess = () => {
            const row = { ...(request.result ?? { id: store.uuid(), dateISO, groupId, traineeId }), present, updatedAt: Date.now() };
            rows.push(row);
            attendance.put(row);
          };
        };
      }
    };
  });
  return rows;
}

export async function saveTrainee(store, row, selectedGroupIds) {
  if (!row.firstName?.trim() || !row.lastName?.trim()) throw new Error("Podaj imię i nazwisko");
  if (!["auto", "manual"].includes(row.pricingMode ?? "auto")) throw new Error("Nieprawidłowy tryb opłat");
  if (row.pricingMode === "manual") nonnegativeNumber(row.manualMonthlyFee, "kwota miesięczna");
  await store.runTx(["trainees", "memberships", "groups"], "readwrite", transaction => {
    const groups = transaction.objectStore("groups").getAll();
    groups.onsuccess = () => {
      const available = new Set(groups.result.map(group => group.id));
      if ([...selectedGroupIds].some(id => !available.has(id))) { transaction.abort(); return; }
      const memberships = transaction.objectStore("memberships");
      const request = memberships.index("byTrainee").getAll(row.id);
      request.onsuccess = () => {
        transaction.objectStore("trainees").put(row);
        const existing = new Map(request.result.map(membership => [membership.groupId, membership]));
        for (const membership of request.result) {
          if (isMembershipActive(membership) && !selectedGroupIds.has(membership.groupId)) memberships.put(changeMembership(membership, false));
        }
        for (const groupId of selectedGroupIds) {
          const membership = existing.get(groupId);
          if (membership && isMembershipActive(membership)) continue;
          memberships.put(membership ? changeMembership(membership, true) : {
            id: store.uuid(), groupId, traineeId: row.id, sessionsPerWeek: 1, createdAt: Date.now()
          });
        }
      };
    };
  });
}

export async function setMembershipActive(store, membershipId, active) {
  if (typeof active !== "boolean") throw new Error("Nieprawidłowy status przypisania");
  await store.runTx(["memberships"], "readwrite", transaction => {
    const memberships = transaction.objectStore("memberships");
    const request = memberships.get(membershipId);
    request.onsuccess = () => {
      if (!request.result) { transaction.abort(); return; }
      memberships.put(changeMembership(request.result, active));
    };
  });
}

export async function addGroupMembers(store, groupId, traineeIds) {
  await store.runTx(["groups", "trainees", "memberships"], "readwrite", transaction => {
    const group = transaction.objectStore("groups").get(groupId);
    group.onsuccess = () => {
      if (!group.result) { transaction.abort(); return; }
      for (const traineeId of traineeIds) {
        const person = transaction.objectStore("trainees").get(traineeId);
        person.onsuccess = () => {
          if (!person.result) { transaction.abort(); return; }
          const memberships = transaction.objectStore("memberships");
          const request = memberships.index("byGroupTrainee").get([groupId, traineeId]);
          request.onsuccess = () => {
            if (request.result && isMembershipActive(request.result)) return;
            memberships.put(request.result ? changeMembership(request.result, true) : {
              id: store.uuid(), groupId, traineeId, sessionsPerWeek: 1, createdAt: Date.now()
            });
          };
        };
      }
    };
  });
}

export async function modifyGroup(store, groupId, change) {
  await store.runTx(["groups"], "readwrite", transaction => {
    const groups = transaction.objectStore("groups");
    const request = groups.get(groupId);
    request.onsuccess = () => {
      if (!request.result) { transaction.abort(); return; }
      try { groups.put(change(request.result)); }
      catch { transaction.abort(); }
    };
  });
}

export async function exportAll(store) {
  const data = store.getSnapshot ? await store.getSnapshot(STORE_NAMES) :
    Object.fromEntries(await Promise.all(STORE_NAMES.map(async name => [name, await store.getAll(name)])));
  return { version: 1, exportedAt: new Date().toISOString(), data };
}

export async function replaceAll(store, payload, { notify = true, shouldApply = () => true } = {}) {
  const { data } = validateBackup(payload);
  await store.runTx(STORE_NAMES, "readwrite", (t) => {
    if (!shouldApply()) throw new Error("Dane lokalne zmieniły się podczas pobierania. Spróbuj ponownie.");
    for (const name of STORE_NAMES) t.objectStore(name).clear();
    for (const name of STORE_NAMES) {
      const s = t.objectStore(name);
      for (const row of data[name] ?? []) s.put(row);
    }
  }, { notify });
}

export async function getSessionScopes(store, dateISO, groupId) {
  return await store.getByIndex("sessionScopes", "byDateGroup", [dateISO, groupId]);
}

export async function setSessionScopes(store, dateISO, groupId, scopeIds) {
  if (!validDate(dateISO) || !Array.isArray(scopeIds)) throw new Error("Nieprawidłowy zakres zajęć");
  let row;
  await store.runTx(["sessionScopes", "scopes", "groups"], "readwrite", transaction => {
    const group = transaction.objectStore("groups").get(groupId);
    group.onsuccess = () => {
      if (!group.result || isGroupSessionCancelled(group.result, dateISO)) { transaction.abort(); return; }
      const scopes = transaction.objectStore("scopes").getAll();
      scopes.onsuccess = () => {
        const available = new Set(scopes.result.map(scope => scope.id));
        if (scopeIds.some(id => !available.has(id))) { transaction.abort(); return; }
        const sessions = transaction.objectStore("sessionScopes");
        const request = sessions.index("byDateGroup").get([dateISO, groupId]);
        request.onsuccess = () => {
          row = { ...(request.result ?? { id: store.uuid(), dateISO, groupId, createdAt: Date.now() }),
            scopeIds: [...new Set(scopeIds)], updatedAt: Date.now() };
          sessions.put(row);
        };
      };
    };
  });
  return row;
}
