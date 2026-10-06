import assert from "node:assert/strict";
import { exportAll, groupHasScheduledTrainingOnDate, groupHasTrainingOnDate, isGroupSessionCancelled, replaceAll, setGroupSessionCancelled } from "../pwa/logic.js";
import { renderAttendance, renderAttendanceGroup } from "../pwa/pages/attendance.js";
import { renderStats } from "../pwa/pages/stats.js";

import { nodes, texts, button, createMemoryStore, installDocument } from "./test_support.mjs";

installDocument();
const date = new Date("2026-10-06T12:00:00");
const initial = {
  groups: [
    { id: "a", name: "Alpha", schedule: [{ dayOfWeek: 2, startTime: "18:00", durationMin: 60 }] },
    { id: "b", name: "Beta", schedule: [{ dayOfWeek: 2, startTime: "19:00", durationMin: 60 }] }
  ],
  trainees: [{ id: "person", firstName: "Anna", lastName: "Test" }],
  memberships: [{ id: "member", traineeId: "person", groupId: "a", sessionsPerWeek: 1 }],
  attendance: [{ id: "entry", dateISO: "2026-10-06", groupId: "a", traineeId: "person", present: true }],
  payments: [], settings: [{ key: "pricing", currency: "PLN", feeBySessionsPerWeek: { 1: 120 } }], scopes: [], sessionScopes: []
};
const store = createMemoryStore(initial);
const data = store.data;
let route;
const context = { store, now: date, pricing: {}, setNow() {}, navigate: value => { route = value; } };
const groupContext = { ...context, params: new URLSearchParams("groupId=a&date=2026-10-06") };

let view = await renderAttendance(context);
assert.ok(button(view, "Odwołaj zajęcia"));
store.failWrites = true;
await button(view, "Odwołaj zajęcia").onclick();
assert.equal(route, undefined);
assert.equal(isGroupSessionCancelled(data.groups.find(group => group.id === "a"), "2026-10-06"), false);
assert.equal(button(view, "Odwołaj zajęcia").disabled, false);
store.failWrites = false;
await button(view, "Odwołaj zajęcia").onclick();
assert.equal(route, "#/attendance");
assert.equal(groupHasScheduledTrainingOnDate(data.groups.find(group => group.id === "a"), date), true);
assert.equal(groupHasTrainingOnDate(data.groups.find(group => group.id === "a"), date), false);
assert.equal(groupHasTrainingOnDate(data.groups.find(group => group.id === "a"), new Date("2026-10-13T12:00:00")), true);
assert.equal(groupHasTrainingOnDate(data.groups.find(group => group.id === "b"), date), true);
assert.equal(data.attendance[0].present, true);
view = await renderAttendance(context);
assert.ok(texts(view).some(text => text.includes("Zajęcia odwołane")));
assert.ok(button(view, "Przywróć zajęcia"));
view = await renderAttendanceGroup(groupContext);
assert.ok(button(view, "Przywróć zajęcia"));
assert.equal(button(view, "Wszyscy obecni"), undefined);
assert.equal(button(view, "Wszyscy nieobecni"), undefined);

// Statistics must exclude both the expected attendance and stored presence.
view = await renderStats(context);
assert.ok(texts(view).includes("Obecnosc: 0/4 (0%)."));
nodes(view).find(node => node.tag === "select").onchange({ target: { value: "person" } });
await new Promise(resolve => setTimeout(resolve, 0));
assert.ok(texts(view).some(text => text.includes("0/4")));
console.log("PASS: date-specific cancellation, list/detail controls, write failure, statistics");

await button(await renderAttendanceGroup(groupContext), "Przywróć zajęcia").onclick();
assert.equal(groupHasTrainingOnDate(data.groups.find(group => group.id === "a"), date), true);
assert.ok(button(await renderAttendanceGroup(groupContext), "Wszyscy obecni"));
assert.equal(data.attendance[0].present, true);
view = await renderStats(context);
assert.ok(texts(view).includes("Obecnosc: 1/5 (20%)."));
await Promise.all([
  setGroupSessionCancelled(store, "a", "2026-10-06", true),
  setGroupSessionCancelled(store, "a", "2026-10-13", true)
]);
await setGroupSessionCancelled(store, "a", "2026-10-06", true);
assert.deepEqual(data.groups.find(group => group.id === "a").cancelledDates, ["2026-10-06", "2026-10-13"]);
await setGroupSessionCancelled(store, "a", "2026-10-06", false);
assert.deepEqual(data.groups.find(group => group.id === "a").cancelledDates, ["2026-10-13"]);
console.log("PASS: restoration preserves attendance, idempotency, simultaneous date changes");

const before = structuredClone(data);
for (const invalid of ["2026-02-30", "2026-13-01", "bad", "2026-1-01"]) {
  await assert.rejects(setGroupSessionCancelled(store, "a", invalid, true));
}
await assert.rejects(setGroupSessionCancelled(store, "missing", "2026-10-06", true));
await assert.rejects(setGroupSessionCancelled(store, "a", "2026-10-06", "true"));
assert.deepEqual(data, before);
const payload = await exportAll(store);
await replaceAll(store, payload);
assert.deepEqual(data.groups, before.groups);
console.log("PASS: invalid input, missing group, export/import round trip");
