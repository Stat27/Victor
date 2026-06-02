declare const process: {
  argv: string[];
  exit(code?: number): never;
};

import {
  askOllama,
  buildWebAnswerPrompt,
  collectSources,
  loadConfig,
  searchDuckDuckGo
} from "./victor_lib.ts";

type AgentDecision = {
  needsWeb: boolean;
  query: string;
  reason: string;
};

async function main(): Promise<void> {
  const config = loadConfig();
  const question = process.argv.slice(2).join(" ").trim();

  if (!question || question === "--help" || question === "-h") {
    printHelp();
    return;
  }

  console.log(`Asking ${config.victorName} whether web search is needed...`);
  const decision = await decideSearch(config, question);
  console.log(`Decision: ${decision.needsWeb ? "search" : "local"} - ${decision.reason}`);

  if (!decision.needsWeb) {
    const answer = await askOllama(config, question);
    console.log();
    console.log("Answer:");
    console.log(answer);
    return;
  }

  const query = decision.query || question;
  console.log(`Searching web for: ${query}`);
  const results = await searchDuckDuckGo(query, config.maxResults);

  if (results.length === 0) {
    console.log("No search results found. Falling back to local answer.");
    const answer = await askOllama(config, question);
    console.log();
    console.log("Answer:");
    console.log(answer);
    return;
  }

  const sources = await collectSources(results, config.maxCharsPerSource);

  if (sources.length === 0) {
    console.log("No readable source text fetched. Falling back to local answer.");
    const answer = await askOllama(config, question);
    console.log();
    console.log("Answer:");
    console.log(answer);
    return;
  }

  console.log(`Fetched ${sources.length} source(s). Asking ${config.victorName}...`);
  const answer = await askOllama(config, buildWebAnswerPrompt(question, sources));

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

async function decideSearch(config: ReturnType<typeof loadConfig>, question: string): Promise<AgentDecision> {
  const prompt = `Decide whether answering this user question requires current web information.

Use web search when the answer depends on recent facts, current docs, prices, releases, rankings, news, model availability, or exact source citations.
Do not use web search for stable general knowledge, local repo workflow, or questions that can be answered from the user's provided context.

Return only compact JSON with this exact shape:
{
  "needsWeb": true,
  "query": "search query to run",
  "reason": "short reason"
}

Question:
${question}`;

  const raw = await askOllama(config, prompt);
  const parsed = parseDecision(raw);

  if (parsed) {
    return parsed;
  }

  return {
    needsWeb: true,
    query: question,
    reason: "Victor did not return valid routing JSON, so web search is used as a safe fallback."
  };
}

function parseDecision(raw: string): AgentDecision | null {
  const jsonText = extractJson(raw);

  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as Partial<AgentDecision>;
    return {
      needsWeb: Boolean(parsed.needsWeb),
      query: typeof parsed.query === "string" ? parsed.query.trim() : "",
      reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "No reason provided."
    };
  } catch {
    return null;
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
  WEB_MAX_RESULTS   Default: 5
  WEB_MAX_CHARS     Default: 1800
`);
}

main().catch((error) => {
  console.error(`agent_chat failed: ${String(error)}`);
  process.exit(1);
});
