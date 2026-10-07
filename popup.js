const P = globalThis.__cfpProtocol;
const button = document.getElementById("capture"),
  label = document.getElementById("label"),
  status = document.getElementById("status"),
  cancel = document.getElementById("cancel");
let timer = null,
  inFlight = false,
  closed = false,
  current = null,
  tab = null,
  windowId = null,
  newestRequest = null;
const superseded = new Set();
function restorationText(summary) {
  if (!summary) return "";
  if (summary.status === "acknowledged")
    return " Page restoration acknowledged.";
  if (summary.status === "unverified")
    return " Page restoration could not be verified in that document.";
  return " Some page restoration failed.";
}
function render(value) {
  P.validatePublicStatus(value);
  if (
    value.tabId !== tab.id ||
    value.windowId !== windowId ||
    value.incognito !== tab.incognito ||
    (value.operationId && superseded.has(value.operationId))
  )
    return;
  if (current?.operationId && value.operationId !== current.operationId) {
    if (!value.operationId) return;
    superseded.add(current.operationId);
    while (superseded.size > 20)
      superseded.delete(superseded.values().next().value);
  }
  current = value;
  status.textContent = value.text + restorationText(value.restoration);
  status.classList.toggle("error", value.phase === "failed");
  cancel.hidden = !["preparing", "capturing", "encoding"].includes(value.phase);
  button.disabled = [
    "preparing",
    "capturing",
    "encoding",
    "initiating",
  ].includes(value.phase);
  label.textContent = "Capture full page";
}
async function request(type, extra = {}) {
  const requestId = crypto.randomUUID();
  newestRequest = requestId;
  const reply = await chrome.runtime.sendMessage({
    type,
    requestId,
    windowId,
    ...extra,
  });
  if (
    closed ||
    newestRequest !== requestId ||
    reply?.requestId !== requestId ||
    reply.type !== type
  )
    return;
  if (!reply.ok) throw P.fault(reply.code);
  render(reply.status);
}
async function refresh() {
  if (inFlight || closed || windowId === null) return;
  inFlight = true;
  try {
    await request("capture-status");
  } catch (error) {
    status.textContent = P.fault(error.code).message;
    status.classList.add("error");
  } finally {
    inFlight = false;
  }
}
button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    await request("capture-active-tab");
  } catch (error) {
    status.textContent = P.fault(error.code).message;
    status.classList.add("error");
    button.disabled = false;
  }
});
cancel.addEventListener("click", async () => {
  if (!current?.operationId) return;
  cancel.disabled = true;
  try {
    await request("capture-cancel", {
      tabId: current.tabId,
      operationId: current.operationId,
    });
  } catch (error) {
    status.textContent = P.fault(error.code).message;
    status.classList.add("error");
  } finally {
    cancel.disabled = false;
  }
});
window.addEventListener("unload", () => {
  closed = true;
  clearInterval(timer);
});
(async () => {
  const actualWindow = await chrome.windows.getCurrent();
  P.uint(actualWindow.id);
  windowId = actualWindow.id;
  const [queried] = await chrome.tabs.query({ active: true, windowId });
  if (!Number.isSafeInteger(queried?.id))
    throw P.fault("CAPTURE_CONTEXT_UNVERIFIED");
  tab = await chrome.tabs.get(queried.id);
  if (
    tab.windowId !== windowId ||
    !tab.active ||
    typeof tab.incognito !== "boolean"
  )
    throw P.fault("CAPTURE_CONTEXT_UNVERIFIED");
  await refresh();
  if (!closed) timer = setInterval(refresh, 500);
})().catch((error) => {
  status.textContent = P.fault(error.code).message;
  status.classList.add("error");
  button.disabled = true;
});
