import assert from "node:assert/strict";
import { renderPeople } from "../pwa/pages/people.js";

import { nodes as descendants, button, createMemoryStore, installDocument, tick } from "./test_support.mjs";

async function scenario(action) {
  installDocument();
  const store = createMemoryStore({ groups: [{ id: "group-1", name: "Group One" }, { id: "group-2", name: "Group Two" }] });
  const saved = store.data;
  let route;
  const view = await renderPeople({ store, pricing: {}, navigate: value => { route = value; } });
  const click = async node => {
    // Await the production click handler, including asynchronous storage writes.
    await node.onclick(new Event("click", { cancelable: true }));
  };
  await click(button(view, "Dodaj"));
  const body = document.getElementById("modalBody");
  const footer = document.getElementById("modalFooter");
  const modal = document.getElementById("modal");
  const personForm = body.children[0];
  const inputs = descendants(personForm).filter(node => node.tag === "input");
  inputs[0].value = "Anna";
  inputs[1].value = "Test";
  inputs[2].value = "+48 123 456 789";
  inputs[3].value = "ANNA@example.test";

  if (action !== "no-groups") {
    await click(button(personForm, "Edytuj"));
    const checkboxes = descendants(body).filter(node => node.type === "checkbox");
    for (const checkbox of checkboxes) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change"));
    }
    if (action === "save-groups") await click(button(footer, "Zapisz"));
    else modal.close(); // Cancel, header close, and Escape all close the dialog.
    await tick();
    assert.equal(modal.open, true);
    assert.equal(body.children[0], personForm);
    assert.deepEqual(inputs.map(node => node.value).slice(0, 4), ["Anna", "Test", "+48 123 456 789", "ANNA@example.test"]);
    if (action === "save-groups") {
      await click(button(personForm, "Edytuj"));
      const selected = descendants(body).filter(node => node.type === "checkbox");
      assert.ok(selected.every(node => node.checked));
      selected[0].checked = false;
      selected[0].dispatchEvent(new Event("change"));
      modal.close();
      await tick();
      assert.equal(body.children[0], personForm);
    }
  }

  await click(button(footer, "Zapisz"));
  await tick();
  assert.equal(modal.open, false, "Saving the person must not reopen the dialog");
  assert.equal(route, "#/people");
  assert.equal(saved.trainees.length, 1);
  assert.equal(saved.trainees[0].email, "anna@example.test");
  assert.equal(saved.memberships.length, action === "save-groups" ? 2 : 0);
  for (const membership of saved.memberships) {
    assert.equal(membership.traineeId, saved.trainees[0].id);
    assert.equal(membership.sessionsPerWeek, 1);
  }
}

for (const action of ["no-groups", "save-groups", "cancel-groups"]) {
  await scenario(action);
  console.log(`PASS: ${action}`);
}
