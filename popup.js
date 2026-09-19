const button = document.getElementById("capture");
const label = document.getElementById("label");
const status = document.getElementById("status");

button.addEventListener("click", async () => {
  button.disabled = true;
  label.textContent = "Starting capture…";
  status.textContent = "";

  try {
    const response = await chrome.runtime.sendMessage({ type: "capture-active-tab" });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not start the capture.");
    }
    window.close();
  } catch (error) {
    label.textContent = "Capture full page";
    status.textContent = error?.message || "Could not start the capture.";
    button.disabled = false;
  }
});
