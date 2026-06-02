const invoke = window.__TAURI__.core.invoke;

const form = document.querySelector("#chat-form");
const promptInput = document.querySelector("#prompt");
const messages = document.querySelector("#messages");
const sendButton = document.querySelector("#send-button");
const memoryButton = document.querySelector("#memory-button");
const memoryDialog = document.querySelector("#memory-dialog");
const memoryContent = document.querySelector("#memory-content");
const memoryStatus = document.querySelector("#memory-status");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();

  if (!prompt) {
    return;
  }

  addMessage("user", prompt);
  promptInput.value = "";
  setBusy(true);

  try {
    const raw = await invoke("ask_victor", { message: prompt });
    addMessage("assistant", extractAnswer(raw));
  } catch (error) {
    addMessage("assistant", `Error: ${String(error)}`);
  } finally {
    setBusy(false);
  }
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    form.requestSubmit();
  }
});

memoryButton.addEventListener("click", async () => {
  try {
    memoryContent.textContent = await invoke("load_memory");
    memoryDialog.showModal();
  } catch (error) {
    memoryContent.textContent = `Error: ${String(error)}`;
    memoryDialog.showModal();
  }
});

async function refreshMemoryStatus() {
  try {
    const memory = await invoke("load_memory");
    memoryStatus.textContent = memory.trim() ? "loaded" : "empty";
  } catch {
    memoryStatus.textContent = "error";
  }
}

function addMessage(role, content) {
  const item = document.createElement("article");
  item.className = `message ${role}`;
  item.textContent = content;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

function setBusy(isBusy) {
  sendButton.disabled = isBusy;
  promptInput.disabled = isBusy;
  sendButton.textContent = isBusy ? "Thinking" : "Send";
}

function extractAnswer(raw) {
  const marker = "\nAnswer:\n";
  const index = raw.lastIndexOf(marker);

  if (index === -1) {
    return raw.trim();
  }

  return raw.slice(index + marker.length).trim();
}

refreshMemoryStatus();
