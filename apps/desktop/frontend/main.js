const invoke = window.__TAURI__?.core?.invoke ?? mockInvoke;

const form = document.querySelector("#chat-form");
const promptInput = document.querySelector("#prompt");
const messages = document.querySelector("#messages");
const sendButton = document.querySelector("#send-button");
const newChatButton = document.querySelector("#new-chat-button");
const memoryButton = document.querySelector("#memory-button");
const memoryDialog = document.querySelector("#memory-dialog");
const memoryContent = document.querySelector("#memory-content");
const memoryStatus = document.querySelector("#memory-status");
const quickActions = document.querySelectorAll(".quick-action");
const promptCount = document.querySelector("#prompt-count");
const emptyStateTemplate = document.querySelector("#empty-state")?.cloneNode(true);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();

  if (!prompt) {
    return;
  }

  addMessage("user", prompt);
  const pending = addMessage("assistant", "Thinking...");
  promptInput.value = "";
  syncPromptInput();
  setBusy(true);

  try {
    const raw = await invoke("ask_victor", { message: prompt });
    updateMessage(pending, parseAgentOutput(raw));
    await refreshMemoryStatus();
  } catch (error) {
    updateMessage(pending, { answer: `Error: ${String(error)}`, meta: [] });
  } finally {
    setBusy(false);
  }
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    form.requestSubmit();
  }
});

promptInput.addEventListener("input", syncPromptInput);

newChatButton.addEventListener("click", () => {
  messages.replaceChildren();
  if (emptyStateTemplate) {
    messages.appendChild(emptyStateTemplate.cloneNode(true));
    bindPromptPills();
  }
  promptInput.focus();
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

quickActions.forEach((button) => {
  button.addEventListener("click", () => {
    setPrompt(button.dataset.prompt || "");
  });
});

bindPromptPills();

async function refreshMemoryStatus() {
  try {
    const memory = await invoke("load_memory");
    memoryStatus.textContent = memory.trim() ? "loaded" : "empty";
  } catch {
    memoryStatus.textContent = "error";
  }
}

function addMessage(role, content) {
  document.querySelector("#empty-state")?.remove();
  const item = document.createElement("article");
  item.className = `message ${role}`;
  renderMessage(item, content);
  messages.appendChild(item);
  scrollMessagesToBottom();
  return item;
}

function updateMessage(item, content) {
  renderMessage(item, content);
  scrollMessagesToBottom();
}

function renderMessage(item, content) {
  item.innerHTML = "";
  const payload =
    typeof content === "string"
      ? { answer: content, meta: [], sources: [] }
      : { sources: [], ...content };

  item.classList.toggle("pending", payload.answer === "Thinking...");

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = item.classList.contains("user") ? "U" : "V";
  item.appendChild(avatar);

  const contentColumn = document.createElement("div");
  contentColumn.className = "message-content";
  item.appendChild(contentColumn);

  const header = document.createElement("div");
  header.className = "message-header";
  const label = document.createElement("span");
  label.textContent = item.classList.contains("user") ? "You" : "Victor";
  header.appendChild(label);

  if (!item.classList.contains("user") && payload.answer !== "Thinking...") {
    const copy = document.createElement("button");
    copy.className = "copy-button";
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(payload.answer);
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Copy failed";
      }
      window.setTimeout(() => {
        copy.textContent = "Copy";
      }, 1200);
    });
    header.appendChild(copy);
  }

  contentColumn.appendChild(header);

  if (payload.meta.length > 0) {
    const meta = document.createElement("div");
    meta.className = "message-meta";
    payload.meta.forEach((entry) => {
      const chip = document.createElement("span");
      chip.textContent = entry;
      chip.title = entry;
      meta.appendChild(chip);
    });
    contentColumn.appendChild(meta);
  }

  const body = document.createElement("div");
  body.className = "message-body";
  if (payload.answer === "Thinking...") {
    body.appendChild(createThinkingIndicator());
  } else {
    body.textContent = payload.answer;
  }
  contentColumn.appendChild(body);

  if (payload.sources.length > 0) {
    const sources = document.createElement("details");
    sources.className = "message-sources";
    sources.open = true;
    const summary = document.createElement("summary");
    summary.textContent = `${payload.sources.length} source${payload.sources.length === 1 ? "" : "s"}`;
    sources.appendChild(summary);

    const list = document.createElement("ol");
    payload.sources.forEach((source) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = source.title;
      item.appendChild(link);
      list.appendChild(item);
    });
    sources.appendChild(list);
    contentColumn.appendChild(sources);
  }
}

function setBusy(isBusy) {
  sendButton.disabled = isBusy;
  promptInput.disabled = isBusy;
  sendButton.querySelector("span").textContent = isBusy ? "Working" : "Send";
  document.body.dataset.busy = isBusy ? "true" : "false";
}

function parseAgentOutput(raw) {
  const meta = [];
  const decision = raw.match(/Decision:\s*(.*)/);
  const fetched = raw.match(/Fetched\s+(\d+)\s+source\(s\)/);
  const search = raw.match(/Searching web for:\s*(.*)/);
  const memory = raw.match(/Memory:\s*(.*)/);

  if (decision?.[1]) {
    const [route, reason] = decision[1].split(/\s+-\s+/, 2);
    meta.push(`Route: ${route.trim()}`);
    if (reason) {
      meta.push(reason.trim());
    }
  }

  if (search?.[1]) {
    meta.push(`Search: ${search[1].trim()}`);
  }

  if (fetched?.[1]) {
    meta.push(`${fetched[1]} sources`);
  }

  if (memory?.[1]) {
    meta.push(`Memory: ${memory[1].trim()}`);
  }

  const marker = "\nAnswer:\n";
  const index = raw.lastIndexOf(marker);
  const sources = parseSources(raw);

  if (index === -1) {
    return { answer: raw.trim(), meta, sources };
  }

  return { answer: raw.slice(index + marker.length).trim(), meta, sources };
}

function parseSources(raw) {
  const block = raw.match(/\nSources:\n([\s\S]*?)\n\nAnswer:\n/);

  if (!block?.[1]) {
    return [];
  }

  const lines = block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const sources = [];

  for (let index = 0; index < lines.length; index += 1) {
    const title = lines[index].match(/^\[(\d+)\]\s+(.*)$/);
    const url = lines[index + 1];

    if (title?.[2] && url?.startsWith("http")) {
      sources.push({ title: title[2], url });
      index += 1;
    }
  }

  return sources;
}

function createThinkingIndicator() {
  const indicator = document.createElement("span");
  indicator.className = "thinking-indicator";
  for (let index = 0; index < 3; index += 1) {
    indicator.appendChild(document.createElement("span"));
  }
  return indicator;
}

function bindPromptPills() {
  document.querySelectorAll(".prompt-pills button").forEach((button) => {
    button.addEventListener("click", () => {
      setPrompt(button.dataset.prompt || "");
    });
  });
}

function setPrompt(value) {
  promptInput.value = value;
  syncPromptInput();
  promptInput.focus();
}

function syncPromptInput() {
  promptCount.textContent = String(promptInput.value.length);
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 190)}px`;
  scrollMessagesToBottom();
}

function scrollMessagesToBottom() {
  window.requestAnimationFrame(() => {
    messages.scrollTo({ top: messages.scrollHeight, behavior: "auto" });
  });
}

async function mockInvoke(command, payload = {}) {
  if (command === "load_memory") {
    return "machine: local workstation\nmodel: victor\nrouting: auto web";
  }

  if (command === "ask_victor") {
    return [
      "Asking victor whether web search is needed...",
      "Decision: local - This preview is running without Tauri IPC.",
      "",
      "Answer:",
      `Preview response for: ${payload.message || "Victor"}`,
    ].join("\n");
  }

  throw new Error(`Unknown command: ${command}`);
}

refreshMemoryStatus();
syncPromptInput();
