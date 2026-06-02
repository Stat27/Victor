declare const process: {
  exit(code?: number): never;
};

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  answerChatTurn,
  appendTurn,
  approveMemory,
  clearHistory,
  type ChatMessage,
  type ProposedMemory,
  proposeMemory,
  rememberFact
} from "./chat_core.ts";
import { loadConfig, loadMemory } from "./victor_lib.ts";

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

    const result = await answerChatTurn(config, userInput, history);

    if (result.route.needsWeb) {
      console.log(`search> ${result.route.query} (${result.route.reason})`);
    }

    console.log();
    console.log(result.answer);
    console.log();

    appendTurn(history, userInput, result.answer);
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
    await rememberFact(config, note);
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

    await approveMemory(config, pendingMemory);
    console.log(`Saved to memory/${pendingMemory.file}`);
    return false;
  }

  if (command === "/reject") {
    console.log(pendingMemory ? "Discarded pending memory proposal." : "No pending memory proposal.");
    return false;
  }

  if (command === "/clear") {
    clearHistory(history);
    console.log("Session history cleared.");
    return false;
  }

  console.log("Unknown command. Type /help.");
  return false;
}

main().catch((error) => {
  console.error(`chat failed: ${String(error)}`);
  process.exit(1);
});
