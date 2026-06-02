declare const process: {
  exit(code?: number): never;
};

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  appendMemory,
  askOllama,
  buildLocalAnswerPrompt,
  buildWebAnswerPrompt,
  collectSources,
  loadConfig,
  loadMemory,
  searchDuckDuckGo
} from "./victor_lib.ts";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ProposedMemory = {
  file: string;
  note: string;
};

type AgentDecision = {
  needsWeb: boolean;
  query: string;
  reason: string;
};

const HISTORY_LIMIT = 8;

async function main(): Promise<void> {
  const config = loadConfig();
  const rl = createInterface({ input, output });
  const history: ChatMessage[] = [];
  let pendingMemory: ProposedMemory | null = null;

  console.log("Victor chat. Type /help for commands.");

  while (true) {
    const userInput = (await rl.question("victor> ")).trim();

    if (!userInput) {
      continue;
    }

    if (userInput.startsWith("/")) {
      const shouldExit = await handleCommand(userInput, config, history, pendingMemory, (proposal) => {
        pendingMemory = proposal;
      });

      if (shouldExit) {
        break;
      }

      if (userInput === "/approve" || userInput === "/reject") {
        pendingMemory = null;
      }

      continue;
    }

    const memory = await loadMemory(config);
    const decision = await decideSearch(config, userInput, memory, history);
    let answer: string;

    if (decision.needsWeb) {
      console.log(`search> ${decision.query} (${decision.reason})`);
      answer = await answerWithWeb(config, userInput, decision.query, memory, history);
    } else {
      answer = await answerLocal(config, userInput, memory, history);
    }

    console.log();
    console.log(answer);
    console.log();

    history.push({ role: "user", content: userInput });
    history.push({ role: "assistant", content: answer });
    trimHistory(history);
  }

  rl.close();
}

async function handleCommand(
  command: string,
  config: ReturnType<typeof loadConfig>,
  history: ChatMessage[],
  pendingMemory: ProposedMemory | null,
  setPendingMemory: (proposal: ProposedMemory | null) => void
): Promise<boolean> {
  if (command === "/exit" || command === "/quit") {
    return true;
  }

  if (command === "/help") {
    console.log(`Commands:
  /help                 Show commands
  /exit                 Exit chat
  /memory               Show loaded memory
  /remember <note>      Append a user-written note to memory/facts.md
  /propose-memory       Ask Victor to propose one memory update from this session
  /approve              Save the pending proposed memory update
  /reject               Discard the pending proposed memory update
  /clear                Clear session history`);
    return false;
  }

  if (command === "/memory") {
    const memory = await loadMemory(config);
    console.log(memory || "(no memory loaded)");
    return false;
  }

  if (command.startsWith("/remember ")) {
    const note = command.slice("/remember ".length).trim();
    await appendMemory(config, "facts.md", note);
    console.log("Saved to memory/facts.md");
    return false;
  }

  if (command === "/propose-memory") {
    const proposal = await proposeMemory(config, history);

    if (!proposal) {
      console.log("No memory update proposed.");
      return false;
    }

    setPendingMemory(proposal);
    console.log("Proposed memory update:");
    console.log(`  file: memory/${proposal.file}`);
    console.log(`  note: ${proposal.note}`);
    console.log("Use /approve to save or /reject to discard.");
    return false;
  }

  if (command === "/approve") {
    if (!pendingMemory) {
      console.log("No pending memory proposal.");
      return false;
    }

    await appendMemory(config, pendingMemory.file, pendingMemory.note);
    console.log(`Saved to memory/${pendingMemory.file}`);
    return false;
  }

  if (command === "/reject") {
    console.log(pendingMemory ? "Discarded pending memory proposal." : "No pending memory proposal.");
    return false;
  }

  if (command === "/clear") {
    history.length = 0;
    console.log("Session history cleared.");
    return false;
  }

  console.log("Unknown command. Type /help.");
  return false;
}

async function decideSearch(
  config: ReturnType<typeof loadConfig>,
  question: string,
  memory: string,
  history: ChatMessage[]
): Promise<AgentDecision> {
  const prompt = `Decide whether this chat turn needs current web information.

Use web search for recent facts, current docs, news, rankings, model availability, or source citations.
Do not use web search for stable local repo workflow or facts already present in memory.

Return only JSON:
{
  "needsWeb": true,
  "query": "search query",
  "reason": "short reason"
}

Memory:
${memory || "(none)"}

Recent chat:
${formatHistory(history)}

User turn:
${question}`;

  const raw = await askOllama(config, prompt);
  const json = extractJson(raw);

  if (!json) {
    return { needsWeb: true, query: question, reason: "Routing JSON was invalid." };
  }

  try {
    const parsed = JSON.parse(json) as Partial<AgentDecision>;
    return {
      needsWeb: Boolean(parsed.needsWeb),
      query: typeof parsed.query === "string" && parsed.query.trim() ? parsed.query.trim() : question,
      reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "No reason provided."
    };
  } catch {
    return { needsWeb: true, query: question, reason: "Routing JSON could not be parsed." };
  }
}

async function answerWithWeb(
  config: ReturnType<typeof loadConfig>,
  question: string,
  query: string,
  memory: string,
  history: ChatMessage[]
): Promise<string> {
  const results = await searchDuckDuckGo(query, config.maxResults);
  const sources = await collectSources(results, config.maxCharsPerSource);

  if (sources.length === 0) {
    return answerLocal(config, question, memory, history);
  }

  const prompt = `${buildWebAnswerPrompt(question, sources, memory)}

Recent chat:
${formatHistory(history)}`;

  return askOllama(config, prompt);
}

async function answerLocal(
  config: ReturnType<typeof loadConfig>,
  question: string,
  memory: string,
  history: ChatMessage[]
): Promise<string> {
  const prompt = `${buildLocalAnswerPrompt(question, memory)}

Recent chat:
${formatHistory(history)}`;

  return askOllama(config, prompt);
}

async function proposeMemory(config: ReturnType<typeof loadConfig>, history: ChatMessage[]): Promise<ProposedMemory | null> {
  if (history.length === 0) {
    return null;
  }

  const prompt = `Review this recent chat and propose at most one durable memory update.

Only propose memory that is stable and useful for future Victor answers.
Do not store secrets, private prompts, transient opinions, or unverified claims.

Allowed files:
- machine.md
- preferences.md
- benchmarks.md
- projects.md
- facts.md

Return only JSON:
{
  "file": "facts.md",
  "note": "short durable note"
}

Return {"file":"","note":""} if nothing should be remembered.

Recent chat:
${formatHistory(history)}`;

  const raw = await askOllama(config, prompt);
  const json = extractJson(raw);

  if (!json) {
    return null;
  }

  try {
    const parsed = JSON.parse(json) as Partial<ProposedMemory>;
    const file = typeof parsed.file === "string" ? parsed.file.trim() : "";
    const note = typeof parsed.note === "string" ? parsed.note.trim() : "";

    if (!file || !note) {
      return null;
    }

    return { file, note };
  } catch {
    return null;
  }
}

function formatHistory(history: ChatMessage[]): string {
  if (history.length === 0) {
    return "(none)";
  }

  return history.map((message) => `${message.role}: ${message.content}`).join("\n\n");
}

function trimHistory(history: ChatMessage[]): void {
  while (history.length > HISTORY_LIMIT) {
    history.shift();
  }
}

function extractJson(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return raw.slice(start, end + 1);
}

main().catch((error) => {
  console.error(`chat failed: ${String(error)}`);
  process.exit(1);
});
