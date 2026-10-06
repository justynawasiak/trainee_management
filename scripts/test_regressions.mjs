import assert from "node:assert/strict";
import { computeAutoFee, exportAll, membershipIncludesDate, replaceAll, saveTrainee, setMembershipActive, setPaid, updateGroupSchedule, groupHasTrainingOnDate } from "../pwa/logic.js";
import { validateBackup, nonnegativeNumber } from "../pwa/validation.js";
import { createSync } from "../pwa/sync.js";
import { renderGroupDetail } from "../pwa/pages/groups.js";
import { renderPayments } from "../pwa/pages/payments.js";
import { renderStats } from "../pwa/pages/stats.js";
import { createMemoryStore, fixture, installDocument, nodes, texts, button, tick } from "./test_support.mjs";

const store = createMemoryStore(fixture());
const original = await exportAll(store);
for (const payload of [{ data: { trainees: [] } }, { ...original, data: { ...original.data, groups: {} } },
  { ...original, data: { ...original.data, settings: [] } }]) {
  await assert.rejects(replaceAll(store, payload));
  assert.deepEqual(await exportAll(store).then(result => result.data), original.data);
}
const invalid = structuredClone(original);
invalid.data.memberships[0].sessionsPerWeek = -1;
assert.throws(() => validateBackup(invalid));
assert.equal(computeAutoFee(0, original.data.settings[0]), 0);
for (const value of ["", -1, Infinity, "bad"]) assert.throws(() => nonnegativeNumber(value, "kwota"));
assert.throws(() => nonnegativeNumber(1.5, "treningi", { integer: true }));
console.log("PASS: imports validate before any write; invalid amounts and zero-session pricing");

store.failStore = "memberships";
await assert.rejects(saveTrainee(store, { id: "new", firstName: "New", lastName: "Person", pricingMode: "auto" }, new Set(["a"])));
assert.equal((await store.getAll("trainees")).length, 1);
store.failStore = null;
await saveTrainee(store, { id: "new", firstName: "New", lastName: "Person", pricingMode: "auto" }, new Set(["a"]));
assert.equal((await store.getAll("trainees")).length, 2);
const membership = (await store.getAllByIndex("memberships", "byTrainee", "new"))[0];
assert.equal(membershipIncludesDate(membership, "2020-01-01"), false);
await setMembershipActive(store, membership.id, false);
assert.ok((await store.get("memberships", membership.id)).endedAt);
await saveTrainee(store, { id: "new", firstName: "New", lastName: "Person" }, new Set(["a"]));
assert.equal((await store.getAllByIndex("memberships", "byTrainee", "new")).length, 1);
await Promise.all([setPaid(store, "2026-10", "person", true, 120), setPaid(store, "2026-10", "person", false, 120)]);
assert.equal((await store.getAll("payments")).length, 1);
console.log("PASS: atomic person save, historical memberships, rejoining, concurrent payment creation");

installDocument();
const group = await store.get("groups", "a");
group.schedule = [{ dayOfWeek: 5, startTime: "18:00", durationMin: 60 }, { dayOfWeek: 1, startTime: "18:00", durationMin: 60 }];
await store.put("groups", group);
const detail = await renderGroupDetail({ store, navigate() {}, params: new URLSearchParams("groupId=a") });
await button(detail, "Usuń").onclick();
assert.deepEqual((await store.get("groups", "a")).schedule.map(entry => entry.dayOfWeek), [5]);
const changed = updateGroupSchedule(fixture().groups[0], [{ dayOfWeek: 3, startTime: "18:00", durationMin: 60 }], new Date("2026-10-07T12:00:00"));
assert.equal(groupHasTrainingOnDate(changed, new Date("2026-10-06T12:00:00")), true);
assert.equal(groupHasTrainingOnDate(changed, new Date("2026-10-13T12:00:00")), false);
console.log("PASS: sorted schedule deletion and historical schedules");

const paymentStore = createMemoryStore(fixture());
const reads = [];
const delayedStore = { ...paymentStore, getAllByIndex(name, index, key) {
  if (name !== "payments") return paymentStore.getAllByIndex(name, index, key);
  return new Promise(resolve => reads.push({ key, resolve }));
} };
const render = renderPayments({ store: delayedStore, pricing: fixture().settings[0], now: new Date("2026-10-06T12:00:00"), navigate() {} });
await tick();
reads.shift().resolve([]);
const payments = await render;
const monthSelect = nodes(payments).find(node => node.tag === "select");
monthSelect.onchange({ target: { value: "11" } });
monthSelect.onchange({ target: { value: "12" } });
await tick();
assert.deepEqual(reads.map(read => read.key), ["2026-11", "2026-12"]);
reads[1].resolve([]); await tick();
reads[0].resolve([{ id: "stale", traineeId: "person", paid: true, amount: 999 }]); await tick();
assert.ok(texts(payments).some(text => text.includes("Kwota: 120")));
assert.equal((await paymentStore.getAll("payments")).length, 0);
const row = nodes(payments).find(node => node.className?.includes("item big"));
const paidAction = row.onclick(); await tick();
reads[2].resolve(await paymentStore.getAllByIndex("payments", "byMonth", "2026-12"));
await paidAction;
assert.equal((await paymentStore.getAll("payments"))[0].month, "2026-12");
console.log("PASS: stale payment renders ignored, month-bound writes, rendering is read-only");

const statsStore = createMemoryStore(fixture());
await statsStore.put("groups", { ...fixture().groups[0], name: "<g>" });
await statsStore.put("memberships", { ...fixture().memberships[0], createdAt: new Date("2026-10-06T12:00:00").getTime() });
const stats = await renderStats({ store: statsStore, pricing: fixture().settings[0], now: new Date("2026-10-06T12:00:00"), navigate() {} });
assert.ok(texts(stats).includes("Obecnosc: 0/1 (0%)."));
assert.ok(texts(stats).some(text => text.includes("&lt;g&gt;")));
assert.ok(!texts(stats).some(text => text.includes("><g></text>")));
await statsStore.put("trainees", { ...fixture().trainees[0], createdAt: new Date("2026-10-06T12:00:00").getTime() });
await statsStore.put("payments", { id: "explicit", traineeId: "person", month: "2026-09", paid: false, amount: 120 });
const personalStats = await renderStats({ store: statsStore, pricing: fixture().settings[0], now: new Date("2026-10-06T12:00:00"), navigate() {} });
nodes(personalStats).find(node => node.tag === "select").onchange({ target: { value: "person" } });
await tick();
assert.ok(texts(personalStats).includes("Zalegle miesiace: 1"));
console.log("PASS: membership start dates and escaped chart labels");

function syncHarness(request) {
  const records = new Map(), timers = new Map();
  let sequence = 0, timerId = 0;
  const localStore = createMemoryStore(fixture());
  const sync = createSync({ store: localStore, accountId: "test", request, token: () => `change-${++sequence}`,
    storage: { getItem: key => records.get(key), setItem: (key, value) => records.set(key, value) },
    delay: (callback, ms) => { timers.set(++timerId, { callback, ms }); return timerId; }, cancelDelay: id => timers.delete(id), withLock: run => run() });
  return { sync, timers, localStore };
}
let finish;
const pending = syncHarness(() => new Promise(resolve => { finish = resolve; }));
pending.sync.changed();
const push = pending.sync.push(); await tick();
pending.sync.changed();
finish({ ok: true, status: 200, json: async () => ({ revision: 1 }) }); await push;
assert.equal(pending.sync.dirty, true);
assert.equal(pending.timers.size, 1);
const offline = syncHarness(async () => { throw new Error("Offline"); });
offline.sync.changed(); await offline.sync.push();
assert.equal(offline.sync.dirty, true);
const retry = [...offline.timers.values()][0];
await retry.callback();
assert.ok(offline.timers.size >= 1);
const pulling = syncHarness(() => new Promise(resolve => { finish = resolve; }));
const pull = pulling.sync.pull(); await tick();
pulling.sync.changed();
finish({ ok: true, status: 200, json: async () => ({ exists: true, revision: 1, payload: original }) });
assert.equal(await pull, false);
assert.equal(pulling.sync.dirty, true);
const conflicting = syncHarness(async () => ({ status: 409, ok: false }));
conflicting.sync.changed(); await conflicting.sync.push();
assert.equal(conflicting.sync.dirty, true);
assert.equal(conflicting.timers.size, 0);
assert.equal(conflicting.sync.conflicted, true);
assert.match(conflicting.sync.status, /Konflikt/);
let recoveryRequests = 0;
const recovery = syncHarness(async () => ++recoveryRequests === 1
  ? { status: 409, ok: false }
  : { status: 200, ok: true, json: async () => ({ exists: true, revision: 3, payload: original }) });
recovery.sync.changed();
await recovery.sync.push();
assert.equal(await recovery.sync.pull(), false);
assert.equal(recoveryRequests, 1);
assert.equal(await recovery.sync.pull({ force: true }), true);
assert.equal(recovery.sync.conflicted, false);
assert.equal(recovery.sync.dirty, false);
assert.equal(recovery.sync.status, "");
const emptyServer = syncHarness(async () => ({ status: 200, ok: true, json: async () => ({ exists: false }) }));
emptyServer.sync.changed();
assert.equal(await emptyServer.sync.pull({ force: true }), false);
assert.equal(emptyServer.sync.dirty, true);
assert.match(emptyServer.sync.status, /nie ma danych/);
console.log("PASS: edits during push/pull, persistent dirty state, scheduled retries, revision conflicts");

let unsafePulls = 0;
const noMetadata = createSync({ store, accountId: "blocked-storage", withLock: run => run(),
  storage: { getItem() { throw new Error("Denied"); }, setItem() { throw new Error("Denied"); } },
  request: async () => { unsafePulls++; return { ok: true }; }, onStatus() {} });
assert.equal(noMetadata.dirty, true);
assert.equal(await noMetadata.pull(), false);
assert.equal(unsafePulls, 0);
console.log("PASS: unavailable sync metadata cannot trigger destructive automatic pulls");
