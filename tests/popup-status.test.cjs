const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const { worker, deferred, scope } = require("./dispatcher-harness.cjs");
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const w = worker(),
    listeners = {},
    intervals = new Map(),
    requests = [],
    elements = {};
  for (const id of ["capture", "label", "status", "cancel"])
    elements[id] = {
      disabled: false,
      hidden: false,
      textContent: "",
      events: {},
      addEventListener(type, fn) {
        this.events[type] = fn;
      },
      classList: { toggle() {}, add() {} },
    };
  let timer = 0;
  const c = vm.createContext({
    __cfpProtocol: w.workerContext.__cfpProtocol,
    crypto: { randomUUID: () => scope().owner },
    document: { getElementById: (id) => elements[id] },
    window: { addEventListener: (name, fn) => (listeners[name] = fn) },
    setInterval(fn) {
      intervals.set(++timer, fn);
      return timer;
    },
    clearInterval: (id) => intervals.delete(id),
    chrome: {
      windows: { getCurrent: async () => ({ id: 0 }) },
      tabs: { query: async () => [w.tab], get: async () => w.tab },
      runtime: {
        sendMessage(message) {
          const result = deferred();
          requests.push({ message, result });
          return result.promise;
        },
      },
    },
  });
  vm.runInContext(fs.readFileSync("popup.js", "utf8"), c);
  return { w, c, elements, listeners, intervals, requests };
}
function reply(f, index, value) {
  const { message, result } = f.requests[index];
  result.resolve({
    type: message.type,
    requestId: message.requestId,
    ok: true,
    status: value,
  });
}
function status(f, id, phase) {
  const operation = {
    operationId: id,
    tabId: 0,
    windowId: 0,
    captureContext: { incognito: false },
  };
  return f.w.workerApi.setOperationState(operation, phase, { begin: true });
}
test("popup polls once, survives reopen state, rejects superseded operation replies and clears unload timer", async () => {
  const f = fixture();
  await tick();
  assert.equal(f.requests.length, 1);
  const oldId = scope().owner,
    newId = scope().owner;
  reply(f, 0, status(f, oldId, "capturing"));
  await tick();
  assert.equal(f.elements.cancel.hidden, false);
  assert.equal(f.elements.capture.disabled, true);
  assert.equal(f.intervals.size, 1);
  const poll = [...f.intervals.values()][0];
  poll();
  poll();
  await tick();
  assert.equal(f.requests.length, 2);
  reply(f, 1, status(f, newId, "encoding"));
  await tick();
  assert.equal(f.elements.status.textContent, "Encoding PNG");
  poll();
  await tick();
  reply(f, 2, status(f, oldId, "saved"));
  await tick();
  assert.equal(f.elements.status.textContent, "Encoding PNG");
  f.listeners.unload();
  assert.equal(f.intervals.size, 0);
});
test("popup exact cancel payload and unload own the pending refresh without auto close", async () => {
  const f = fixture();
  await tick();
  const id = scope().owner;
  reply(f, 0, status(f, id, "capturing"));
  await tick();
  const clicked = f.elements.cancel.events.click();
  await tick();
  assert.deepEqual(
    { ...f.requests[1].message },
    {
      type: "capture-cancel",
      requestId: f.requests[1].message.requestId,
      windowId: 0,
      tabId: 0,
      operationId: id,
    },
  );
  reply(f, 1, status(f, id, "cancelled"));
  await clicked;
  assert.equal(f.elements.cancel.hidden, true);
  assert.equal(f.elements.capture.disabled, false);
  f.listeners.unload();
  assert.equal(f.intervals.size, 0);
});
