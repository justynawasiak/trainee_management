import assert from "node:assert/strict";
import { STORE_NAMES } from "../pwa/validation.js";

export class Element extends EventTarget {
  constructor(tag) {
    super();
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.open = false;
    this.disabled = false;
    this.classList = { toggle() {} };
  }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(type, listener, options) {
    this[`on${type}`] = listener;
    super.addEventListener(type, listener, options);
  }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  prepend(child) { this.children.unshift(child); }
  set innerHTML(value) { this.children = []; }
  insertAdjacentHTML(position, html) { this.children.push({ textContent: html }); }
  querySelector() { return nodes(this).find(node => node.dataset?.modalError === "1") ?? null; }
  focus() {}
  scrollIntoView() {}
  remove() {}
  showModal() { this.open = true; }
  close() { this.open = false; setTimeout(() => this.dispatchEvent(new Event("close")), 0); }
}
export const nodes = root => [root, ...(root.children ?? []).flatMap(nodes)];
export const texts = root => nodes(root).map(node => node.textContent).filter(Boolean);
export const button = (root, label) => nodes(root).find(node => node.tag === "button" && node.textContent === label);
export const tick = () => new Promise(resolve => setTimeout(resolve, 0));
export function installDocument() {
  const roots = new Map();
  globalThis.document = {
    createElement: tag => new Element(tag),
    createTextNode: text => ({ textContent: text }),
    getElementById(id) {
      if (!roots.has(id)) roots.set(id, new Element("div"));
      return roots.get(id);
    },
    body: new Element("body")
  };
  return roots;
}

const indexFields = {
  byGroup: ["groupId"], byTrainee: ["traineeId"], byMonth: ["month"],
  byGroupTrainee: ["groupId", "traineeId"], byDateGroup: ["dateISO", "groupId"],
  byDateGroupTrainee: ["dateISO", "groupId", "traineeId"], byMonthTrainee: ["month", "traineeId"]
};
function indexedRows(rows, index, key) {
  const fields = indexFields[index];
  assert.ok(fields, `Unknown index ${index}`);
  return rows.filter(row => JSON.stringify(fields.length === 1 ? row[fields[0]] : fields.map(field => row[field])) === JSON.stringify(key));
}

export function createMemoryStore(initial, hooks = {}) {
  const data = Object.fromEntries(STORE_NAMES.map(name => [name, structuredClone(initial[name] ?? [])]));
  let tail = Promise.resolve();
  let nextId = 0;
  const store = {
    data, failWrites: false, failStore: null,
    uuid: () => `test-id-${++nextId}`,
    async getAll(name) { await tail; return structuredClone(data[name]); },
    async get(name, id) { await tail; return structuredClone(data[name].find(row => (name === "settings" ? row.key : row.id) === id)); },
    async getAllByIndex(name, index, key) { await tail; return structuredClone(indexedRows(data[name], index, key)); },
    async getByIndex(name, index, key) { return (await store.getAllByIndex(name, index, key))[0]; },
    async getSnapshot() { await tail; return structuredClone(data); },
    async put(name, row) { await store.runTx([name], "readwrite", transaction => transaction.objectStore(name).put(row)); },
    async delete(name, id) { await store.runTx([name], "readwrite", transaction => transaction.objectStore(name).delete(id)); },
    runTx(names, mode, runner, { notify = true } = {}) {
      if (mode === "readwrite" && notify) hooks.beforeWrite?.();
      const operation = tail.then(() => {
        if (store.failWrites) throw new Error("Storage unavailable");
        const snapshot = structuredClone(data);
        const queue = [];
        let aborted = false;
        const enqueue = operation => {
          const request = {};
          queue.push(() => { request.result = structuredClone(operation()); request.onsuccess?.(); });
          return request;
        };
        runner({
          abort() { aborted = true; },
          objectStore(name) {
            assert.ok(names.includes(name));
            return {
              get: id => enqueue(() => snapshot[name].find(row => (name === "settings" ? row.key : row.id) === id)),
              getAll: () => enqueue(() => snapshot[name]),
              index: index => ({
                get: key => enqueue(() => indexedRows(snapshot[name], index, key)[0]),
                getAll: key => enqueue(() => indexedRows(snapshot[name], index, key))
              }),
              put(row) {
                if (store.failStore === name) throw new Error("Injected write failure");
                return enqueue(() => {
                  const key = name === "settings" ? "key" : "id";
                  snapshot[name] = snapshot[name].filter(existing => existing[key] !== row[key]);
                  snapshot[name].push(structuredClone(row));
                });
              },
              delete: id => enqueue(() => { snapshot[name] = snapshot[name].filter(row => row.id !== id); }),
              clear: () => enqueue(() => { snapshot[name] = []; })
            };
          }
        });
        while (queue.length && !aborted) queue.shift()();
        if (aborted) throw new Error("Transaction aborted");
        for (const name of names) data[name] = snapshot[name];
        if (mode === "readwrite" && notify) hooks.onWrite?.();
      });
      tail = operation.catch(() => {});
      return operation;
    }
  };
  return store;
}

export function fixture() {
  return {
    trainees: [{ id: "person", firstName: "Anna", lastName: "Test", createdAt: new Date("2026-09-01T12:00:00").getTime() }],
    groups: [{ id: "a", name: "Alpha", schedule: [{ dayOfWeek: 2, startTime: "18:00", durationMin: 60 }] }],
    memberships: [{ id: "member", groupId: "a", traineeId: "person", sessionsPerWeek: 1, createdAt: new Date("2026-09-01T12:00:00").getTime() }],
    attendance: [], payments: [], settings: [{ key: "pricing", currency: "PLN", feeBySessionsPerWeek: { 1: 120, 2: 200, all: 320 } }], scopes: [], sessionScopes: []
  };
}
