import { dayOfWeekIso } from "./db.js";

export function groupHasTrainingOnDate(group, date) {
  const dow = dayOfWeekIso(date);
  return (group?.schedule ?? []).some((e) => Number(e.dayOfWeek) === dow);
}

export function computeAutoFee(totalSessionsPerWeek, pricing) {
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
  const totalSessionsPerWeek = memberships.reduce((sum, m) => sum + Number(m.sessionsPerWeek ?? 0), 0);
  return {
    totalSessionsPerWeek,
    autoFee: computeAutoFee(totalSessionsPerWeek, pricing),
    currency: pricing?.currency ?? "PLN"
  };
}

export async function ensurePayment(store, month, traineeId, suggestedAmount) {
  const existing = await store.getByIndex("payments", "byMonthTrainee", [month, traineeId]);
  if (existing) return existing;
  const p = {
    id: store.uuid(),
    month,
    traineeId,
    paid: false,
    amount: Number(suggestedAmount ?? 0),
    paidAt: null,
    createdAt: Date.now()
  };
  await store.put("payments", p);
  return p;
}

export async function setPaid(store, month, traineeId, paid, amount) {
  const payment = await store.getByIndex("payments", "byMonthTrainee", [month, traineeId]);
  if (!payment) {
    await ensurePayment(store, month, traineeId, amount);
    return setPaid(store, month, traineeId, paid, amount);
  }
  payment.paid = Boolean(paid);
  payment.paidAt = payment.paid ? Date.now() : null;
  if (amount !== undefined && amount !== null) payment.amount = Number(amount);
  await store.put("payments", payment);
  return payment;
}

export async function setAttendance(store, dateISO, groupId, traineeId, present) {
  const key = [dateISO, groupId, traineeId];
  const existing = await store.getByIndex("attendance", "byDateGroupTrainee", key);
  const row =
    existing ??
    ({
      id: store.uuid(),
      dateISO,
      groupId,
      traineeId,
      present: false,
      updatedAt: Date.now()
    });
  row.present = Boolean(present);
  row.updatedAt = Date.now();
  await store.put("attendance", row);
  return row;
}

export async function exportAll(store) {
  const stores = ["trainees", "groups", "memberships", "attendance", "payments", "settings", "scopes", "sessionScopes"];
  const data = {};
  for (const s of stores) data[s] = await store.getAll(s);
  return { version: 1, exportedAt: new Date().toISOString(), data };
}

export async function importAll(store, payload) {
  const data = payload?.data;
  if (!data) throw new Error("Brak danych w pliku");
  await store.runTx(["trainees", "groups", "memberships", "attendance", "payments", "settings", "scopes", "sessionScopes"], "readwrite", (t) => {
    const targets = ["trainees", "groups", "memberships", "attendance", "payments", "settings", "scopes", "sessionScopes"];
    for (const name of targets) {
      const s = t.objectStore(name);
      for (const row of data[name] ?? []) s.put(row);
    }
  });
}

export async function replaceAll(store, payload) {
  const data = payload?.data;
  if (!data) throw new Error("Brak danych");
  const targets = ["trainees", "groups", "memberships", "attendance", "payments", "settings", "scopes", "sessionScopes"];
  await store.runTx(targets, "readwrite", (t) => {
    for (const name of targets) t.objectStore(name).clear();
    for (const name of targets) {
      const s = t.objectStore(name);
      for (const row of data[name] ?? []) s.put(row);
    }
  });
}

export async function getSessionScopes(store, dateISO, groupId) {
  return await store.getByIndex("sessionScopes", "byDateGroup", [dateISO, groupId]);
}

export async function setSessionScopes(store, dateISO, groupId, scopeIds) {
  const existing = await store.getByIndex("sessionScopes", "byDateGroup", [dateISO, groupId]);
  const row =
    existing ??
    ({
      id: store.uuid(),
      dateISO,
      groupId,
      scopeIds: [],
      createdAt: Date.now()
    });
  row.scopeIds = Array.from(new Set(scopeIds ?? [])).filter(Boolean);
  row.updatedAt = Date.now();
  await store.put("sessionScopes", row);
  return row;
}
