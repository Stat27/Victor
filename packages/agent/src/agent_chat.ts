declare const process: {
  argv: string[];
  exit(code?: number): never;
};

import {
  type AgentDecision,
  appendMemory,
  askOllama,
  buildLocalAnswerPrompt,
  buildWebAnswerPrompt,
  collectSources,
  decideWebSearch,
  loadMemory,
  loadConfig,
  loadRepoContext,
  normalizeSearchQueries,
  rankSearchResults,
  searchDuckDuckGo
} from "./victor_lib.ts";

type MemoryDecision = {
  file: string;
  note: string;
};

async function main(): Promise<void> {
  const config = loadConfig();
  const memory = await loadMemory(config);
  const question = process.argv.slice(2).join(" ").trim();
  const repoContext = await loadRepoContext(question);

  if (!question || question === "--help" || question === "-h") {
    printHelp();
    return;
  }

  console.log(`Asking ${config.victorName} whether web search is needed...`);
  const decision = await decideWebSearch(config, question, memory, "", repoContext);
  console.log(`Decision: ${decision.needsWeb ? "search" : "local"} - ${decision.reason}`);

  if (!decision.needsWeb) {
    const answer = await askOllama(config, buildLocalAnswerPrompt(question, memory, repoContext));
    const savedMemory = await rememberAfterTurn(config, question, answer, memory);
    printMemoryResult(savedMemory);
    console.log();
    console.log("Answer:");
    console.log(answer);
    return;
  }

  const queries = normalizeSearchQueries(decision, question);
  console.log("Search queries:");
  queries.forEach((query) => console.log(`- ${query}`));

  const results = await searchQueries(queries, config.maxResults, question);

  if (results.length === 0) {
    console.log("No search results found. Falling back to local answer.");
    const answer = await askOllama(config, buildLocalAnswerPrompt(question, memory, repoContext));
    const savedMemory = await rememberAfterTurn(config, question, answer, memory);
    printMemoryResult(savedMemory);
    console.log();
    console.log("Answer:");
    console.log(answer);
    return;
  }

  const sources = await collectSources(results, config.maxCharsPerSource);

  if (sources.length === 0) {
    console.log("No readable source text fetched. Falling back to local answer.");
    const answer = await askOllama(config, buildLocalAnswerPrompt(question, memory, repoContext));
    const savedMemory = await rememberAfterTurn(config, question, answer, memory);
    printMemoryResult(savedMemory);
    console.log();
    console.log("Answer:");
    console.log(answer);
    return;
  }

  console.log(`Fetched ${sources.length} source(s). Asking ${config.victorName}...`);
  const answer = await askOllama(config, buildWebAnswerPrompt(question, sources, memory, repoContext));
  const savedMemory = await rememberAfterTurn(config, question, answer, memory);
  printMemoryResult(savedMemory);

  console.log();
  console.log("Sources:");
  sources.forEach((source, index) => {
    console.log(`[${index + 1}] ${source.title}`);
    console.log(`    ${source.url}`);
  });

  console.log();
  console.log("Answer:");
  console.log(answer);
}

async function rememberAfterTurn(
  config: ReturnType<typeof loadConfig>,
  question: string,
  answer: string,
  memory: string
): Promise<MemoryDecision | null> {
  if (!config.autoMemory) {
    return null;
  }

  const prompt = `Decide whether this completed assistant turn contains exactly one durable memory worth saving.

Save memory only when it will help Victor behave as a personal assistant in future sessions.
Good memory:
- durable user preferences
- durable machine or environment facts
- durable project goals, implementation state, or decisions
- benchmark results or local performance observations
- facts the user explicitly asks Victor to remember

Do not save:
- secrets, credentials, tokens, private keys, or addresses
- temporary conversational details
- generic information from web sources
- speculation or weak claims
- duplicate information already present in memory

Allowed files:
- machine.md
- preferences.md
- projects.md
- benchmarks.md
- facts.md

Return only compact JSON:
{
  "file": "projects.md",
  "note": "short durable note written in third person"
}

Return {"file":"","note":""} if nothing should be saved.

Existing memory:
${memory || "(none)"}

User turn:
${question}

Assistant answer:
${answer}`;

  const raw = await askOllama(config, prompt);
  const parsed = parseMemoryDecision(raw);

  if (!parsed) {
    return null;
  }

  await appendMemory(config, parsed.file, parsed.note);
  return parsed;
}

function parseMemoryDecision(raw: string): MemoryDecision | null {
  const jsonText = extractJson(raw);

  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as Partial<MemoryDecision>;
    const file = typeof parsed.file === "string" ? parsed.file.trim() : "";
    const note = typeof parsed.note === "string" ? parsed.note.trim() : "";

    if (!file || !note) {
      return null;
    }

    if (!["machine.md", "preferences.md", "projects.md", "benchmarks.md", "facts.md"].includes(file)) {
      return null;
    }

    return { file, note };
  } catch {
    return null;
  }
}

function printMemoryResult(memory: MemoryDecision | null): void {
  if (memory) {
    console.log(`Memory: saved to ${memory.file} - ${memory.note}`);
    return;
  }

  console.log("Memory: no durable update");
}

async function searchQueries(queries: string[], maxResults: number, question: string) {
  const seen = new Set<string>();
  const merged = [];

  for (const query of queries) {
    console.log(`Searching web for: ${query}`);
    const results = await searchDuckDuckGo(query, maxResults);

    for (const result of results) {
      if (seen.has(result.url)) {
        continue;
      }

      seen.add(result.url);
      merged.push(result);
    }
  }

  return rankSearchResults(merged, question).slice(0, maxResults);
}

function extractJson(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return raw.slice(start, end + 1);
}

function printHelp(): void {
  console.log(`Usage:
  npm run agent -- "<question>"

Examples:
  npm run agent -- "what is the latest Ollama tool calling behavior?"
  npm run agent -- "how do I recreate victor in debug mode?"

Environment:
  OLLAMA_HOST       Default: http://localhost:11434
  VICTOR_NAME       Default: victor
  THINK             Default: false
  VICTOR_AUTO_MEMORY Default: false
  WEB_MAX_RESULTS   Default: 5
  WEB_MAX_CHARS     Default: 1800
`);
}

main().catch((error) => {
  console.error(`agent_chat failed: ${String(error)}`);
  process.exit(1);
});
