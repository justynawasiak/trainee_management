import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";

// Use an existing Playwright runtime; the application has no runtime dependencies.
const moduleName = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(moduleName ? pathToFileURL(resolve(moduleName)).href : "playwright");
const root = resolve("pwa");
const html = '<!doctype html><html><body><div id="appTitle"></div><div id="topbarActions"></div><div id="main"></div><dialog id="modal"><form method="dialog"><div id="modalTitle"></div><button value="cancel">Close</button><div id="modalBody"></div><div id="modalFooter"></div></form></dialog></body></html>';
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end(html); return; }
  const filename = resolve(root, `.${pathname}`);
  if (!filename.startsWith(root + sep) || extname(filename) !== ".js") { response.writeHead(404); response.end(); return; }
  try { response.setHeader("Content-Type", "text/javascript"); response.end(await readFile(filename)); }
  catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const results = await page.evaluate(async () => {
    const { createStore } = await import("/db.js");
    const logic = await import("/logic.js");
    const { renderPeople } = await import("/pages/people.js");
    const { renderPayments } = await import("/pages/payments.js");
    const { renderAttendanceGroup } = await import("/pages/attendance.js");
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const waitFor = async predicate => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error("UI did not reach expected state");
    };
    const store = await createStore({ namespace: `native-test-${crypto.randomUUID()}` });
    const fixture = { version: 1, data: {
      trainees: [{ id: "person", firstName: "Anna", lastName: "Test" }],
      groups: [{ id: "group", name: "Group", schedule: [{ dayOfWeek: 2, startTime: "18:00", durationMin: 60 }] }],
      memberships: [{ id: "member", groupId: "group", traineeId: "person", sessionsPerWeek: 1 }],
      attendance: [], payments: [], scopes: [], sessionScopes: [],
      settings: [{ key: "pricing", currency: "PLN", feeBySessionsPerWeek: { 1: 120 } }]
    } };
    const results = [];
    try {
      await logic.replaceAll(store, fixture);
      let rejected = false;
      try { await store.runTx(["trainees"], "readwrite", transaction => {
        transaction.objectStore("trainees").clear(); throw new Error("Failure after queued clear");
      }); } catch { rejected = true; }
      check(rejected && (await store.getAll("trainees")).length === 1, "Transaction exception must abort queued clears");
      try { await logic.replaceAll(store, { data: { trainees: [] } }); } catch {}
      check((await store.getAll("trainees")).length === 1, "Invalid import changed native IndexedDB");
      await Promise.all([logic.setPaid(store, "2026-10", "person", true, 120), logic.setPaid(store, "2026-10", "person", false, 120)]);
      check((await store.getAll("payments")).length === 1, "Concurrent payment writes created duplicates");
      await logic.setGroupSessionCancelled(store, "group", "2026-10-06", true);
      rejected = false;
      try { await logic.setAttendance(store, "2026-10-06", "group", "person", true); } catch { rejected = true; }
      check(rejected && (await store.getAll("attendance")).length === 0, "Cancelled session accepted attendance");
      await logic.setGroupSessionCancelled(store, "group", "2026-10-06", false);
      results.push("native transaction abort, import preservation, concurrent writes, cancelled-session guard");

      const main = document.getElementById("main");
      const ctx = { store, pricing: fixture.data.settings[0], now: new Date("2026-10-06T12:00:00"), navigate() {} };
      main.replaceChildren(await renderPeople(ctx));
      [...main.querySelectorAll("button")].find(button => button.textContent === "Dodaj").click();
      await waitFor(() => document.getElementById("modal").open);
      document.querySelector('[placeholder="Imię"]').value = "New";
      document.querySelector('[placeholder="Nazwisko"]').value = "Person";
      [...document.querySelectorAll("#modalBody button")].find(button => button.textContent === "Edytuj").click();
      await waitFor(() => document.getElementById("modalTitle").textContent === "Edytuj grupy");
      const checkbox = document.querySelector('input[type="checkbox"]');
      checkbox.click();
      [...document.querySelectorAll("#modalFooter button")].find(button => button.textContent === "Zapisz").click();
      await waitFor(() => document.getElementById("modalTitle").textContent === "Dodaj osobę" && document.getElementById("modal").open);
      check(document.querySelector('[placeholder="Imię"]').value === "New", "Nested modal lost draft values");
      const save = [...document.querySelectorAll("#modalFooter button")].find(button => button.textContent === "Zapisz");
      save.click(); save.click();
      await waitFor(async () => (await store.getAll("trainees")).length === 2);
      const people = await store.getAll("trainees");
      check(people.length === 2 && (await store.getAllByIndex("memberships", "byTrainee", people.find(person => person.firstName === "New").id)).length === 1, "Person/group save duplicated or failed");
      results.push("native nested dialog restoration, group assignment, repeated save protection");

      main.replaceChildren(await renderPayments(ctx));
      const edit = main.querySelector('button[aria-label="Zmień kwotę"]');
      const before = await store.getAll("payments");
      edit.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 20));
      check(JSON.stringify(await store.getAll("payments")) === JSON.stringify(before), "Nested edit key toggled payment");
      const attendance = await renderAttendanceGroup({ ...ctx, params: new URLSearchParams("groupId=group&date=2026-10-06") });
      check(attendance.querySelector('[role="button"]'), "Active attendance controls missing");
      results.push("native keyboard propagation and attendance rendering");

      const legacyNamespace = `migration-${crypto.randomUUID()}`;
      const old = await createStore({ namespace: legacyNamespace });
      await logic.replaceAll(old, fixture);
      const identity = crypto.randomUUID().replaceAll("-", "").repeat(2);
      const migrated = await createStore({ accountId: identity, legacyNamespace });
      check((await migrated.getAll("trainees")).length === 1, "Account database migration lost records");
      check((await old.getAll("trainees")).length === 1, "Legacy database was deleted during migration");
      const imported = structuredClone(fixture);
      imported.data.trainees[0].firstName = "Imported";
      await logic.replaceAll(migrated, imported);
      const reopened = await createStore({ accountId: identity, legacyNamespace });
      check((await reopened.getAll("trainees"))[0].firstName === "Imported", "An import was overwritten by repeat migration");
      // Close the second connection before removing the isolated test databases.
      await old.removeLocalData();
      await migrated.removeLocalData();
      await reopened.removeLocalData();
      results.push("native account migration preserves source records");
    } finally { await store.removeLocalData(); }
    return results;
  });
  assert.equal(results.length, 4);
  results.forEach(result => console.log(`PASS: ${result}`));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
