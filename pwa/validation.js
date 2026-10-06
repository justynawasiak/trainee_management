export const STORE_NAMES = ["trainees", "groups", "memberships", "attendance", "payments", "settings", "scopes", "sessionScopes"];

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && date.getFullYear() >= 1900 &&
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` === value;
}

export function nonnegativeNumber(value, label, { integer = false, min = 0 } = {}) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) throw new Error(`Podaj: ${label}`);
  const number = Number(value);
  if (!Number.isFinite(number) || number > Number.MAX_SAFE_INTEGER || number < min || (integer && !Number.isSafeInteger(number))) {
    throw new Error(`Nieprawidłowa wartość: ${label}`);
  }
  return number;
}

function requireValue(condition, description) {
  if (!condition) throw new Error(`Nieprawidłowy backup: ${description}`);
}

function text(value) { return typeof value === "string" && value.trim().length > 0; }
function numeric(value, integer = false, min = 0) {
  return typeof value === "number" && Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER && value >= min && (!integer || Number.isSafeInteger(value));
}
function scheduleValid(schedule) {
  return Array.isArray(schedule) && schedule.every(entry => entry && numeric(entry.dayOfWeek, true, 1) && entry.dayOfWeek <= 7 &&
    typeof entry.startTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(entry.startTime) && numeric(entry.durationMin, true, 15));
}

export function validateBackup(input) {
  const payload = input?.payload?.data ? input.payload : input;
  requireValue(payload && payload.version === 1 && payload.data && typeof payload.data === "object" && !Array.isArray(payload.data), "wersja lub format");
  const data = {};
  for (const name of STORE_NAMES) {
    // Older version 1 exports did not yet contain scope stores.
    const rows = payload.data[name] ?? (["scopes", "sessionScopes"].includes(name) ? [] : null);
    requireValue(Array.isArray(rows), `brak lub błędny zbiór ${name}`);
    const keys = new Set();
    for (const row of rows) {
      requireValue(row && typeof row === "object" && !Array.isArray(row), `${name}: rekord`);
      const key = name === "settings" ? row.key : row.id;
      requireValue(text(key) && !keys.has(key), `${name}: identyfikator`);
      keys.add(key);
      for (const field of ["createdAt", "updatedAt", "endedAt", "paidAt"]) {
        requireValue(row[field] === undefined || row[field] === null || numeric(row[field], true), `${name}: ${field}`);
      }
    }
    data[name] = structuredClone(rows);
  }
  const ids = name => new Set(data[name].map(row => row.id));
  const people = ids("trainees"), groups = ids("groups"), scopes = ids("scopes");
  for (const row of data.trainees) {
    requireValue(text(row.firstName) && text(row.lastName), "imię i nazwisko");
    requireValue([undefined, "auto", "manual"].includes(row.pricingMode), "tryb opłat");
    requireValue(row.pricingMode !== "manual" || numeric(row.manualMonthlyFee), "kwota ręczna");
    requireValue(["phone", "email"].every(key => row[key] === undefined || typeof row[key] === "string"), "dane kontaktowe");
  }
  for (const row of data.groups) {
    requireValue(text(row.name) && scheduleValid(row.schedule ?? []), "nazwa lub harmonogram grupy");
    requireValue(row.cancelledDates === undefined || (Array.isArray(row.cancelledDates) && row.cancelledDates.every(validDate)), "odwołane daty");
    requireValue(row.scheduleHistory === undefined || (Array.isArray(row.scheduleHistory) && row.scheduleHistory.every(entry =>
      entry && validDate(entry.fromISO) && scheduleValid(entry.schedule))), "historia harmonogramu");
  }
  const unique = new Set();
  for (const row of data.memberships) {
    const key = JSON.stringify([row.groupId, row.traineeId]);
    requireValue(groups.has(row.groupId) && people.has(row.traineeId) && !unique.has(key) && numeric(row.sessionsPerWeek, true), "przypisanie do grupy");
    requireValue(row.periods === undefined || (Array.isArray(row.periods) && row.periods.length > 0 && row.periods.every(period => period && validDate(period.fromISO) &&
      (period.toISO === null || (validDate(period.toISO) && period.toISO >= period.fromISO)))), "historia przypisania");
    unique.add(key);
  }
  for (const name of ["attendance", "payments", "sessionScopes"]) {
    const rowKeys = new Set();
    for (const row of data[name]) {
      const key = JSON.stringify(name === "payments" ? [row.month, row.traineeId] : name === "attendance" ? [row.dateISO, row.groupId, row.traineeId] : [row.dateISO, row.groupId]);
      requireValue(!rowKeys.has(key), `${name}: duplikat`);
      rowKeys.add(key);
      if (name !== "payments") requireValue(validDate(row.dateISO) && groups.has(row.groupId), `${name}: grupa lub data`);
      if (name !== "sessionScopes") requireValue(people.has(row.traineeId), `${name}: osoba`);
      if (name === "attendance") requireValue(typeof row.present === "boolean", "status obecności");
      if (name === "payments") requireValue(typeof row.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(row.month) &&
        numeric(row.amount) && typeof row.paid === "boolean", "płatność");
      if (name === "sessionScopes") requireValue(Array.isArray(row.scopeIds) && row.scopeIds.every(id => scopes.has(id)), "zakres zajęć");
    }
  }
  const pricing = data.settings.find(row => row.key === "pricing");
  requireValue(pricing && text(pricing.currency) && pricing.feeBySessionsPerWeek && typeof pricing.feeBySessionsPerWeek === "object" &&
    !Array.isArray(pricing.feeBySessionsPerWeek) && Object.keys(pricing.feeBySessionsPerWeek).length > 0 && Object.entries(pricing.feeBySessionsPerWeek).every(([key, value]) =>
      (key === "all" || /^(0|[1-9]\d*)$/.test(key)) && numeric(value)), "ustawienia opłat");
  return { version: 1, data };
}
