declare const process: {
  argv: string[];
  exit(code?: number): never;
};

import {
  askOllama,
  buildLocalAnswerPrompt,
  buildWebAnswerPrompt,
  collectSources,
  loadMemory,
  loadConfig,
  searchDuckDuckGo
} from "./victor_lib.ts";

type AgentDecision = {
  needsWeb: boolean;
  query: string;
  queries: string[];
  reason: string;
};

async function main(): Promise<void> {
  const config = loadConfig();
  const memory = await loadMemory(config);
  const question = process.argv.slice(2).join(" ").trim();

  if (!question || question === "--help" || question === "-h") {
    printHelp();
    return;
  }

  console.log(`Asking ${config.victorName} whether web search is needed...`);
  const decision = await decideSearch(config, question, memory);
  console.log(`Decision: ${decision.needsWeb ? "search" : "local"} - ${decision.reason}`);

  if (!decision.needsWeb) {
    const answer = await askOllama(config, buildLocalAnswerPrompt(question, memory));
    console.log();
    console.log("Answer:");
    console.log(answer);
    return;
  }

  const queries = normalizeQueries(decision, question);
  console.log("Search queries:");
  queries.forEach((query) => console.log(`- ${query}`));

  const results = await searchQueries(queries, config.maxResults, question);

  if (results.length === 0) {
    console.log("No search results found. Falling back to local answer.");
    const answer = await askOllama(config, buildLocalAnswerPrompt(question, memory));
    console.log();
    console.log("Answer:");
    console.log(answer);
    return;
  }

  const sources = await collectSources(results, config.maxCharsPerSource);

  if (sources.length === 0) {
    console.log("No readable source text fetched. Falling back to local answer.");
    const answer = await askOllama(config, buildLocalAnswerPrompt(question, memory));
    console.log();
    console.log("Answer:");
    console.log(answer);
    return;
  }

  console.log(`Fetched ${sources.length} source(s). Asking ${config.victorName}...`);
  const answer = await askOllama(config, buildWebAnswerPrompt(question, sources, memory));

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

async function decideSearch(config: ReturnType<typeof loadConfig>, question: string, memory: string): Promise<AgentDecision> {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Today is ${today}.

Decide whether answering this user question requires current web information.

Use web search when the answer depends on recent facts, current docs, prices, releases, rankings, news, model availability, or exact source citations.
Do not use web search for stable general knowledge, local repo workflow, or questions that can be answered from the user's provided context.
Do not use web search only to rediscover facts already present in local memory. Use web search to complement or verify unstable/current facts.

Search query rules:
- Do not include an old year like 2024 or 2025 unless the user explicitly asks about that year.
- For current recommendations, use ${today.slice(0, 4)} or no year.
- Prefer precise source-targeted queries over broad SEO queries.
- For Ollama model questions, include likely primary sources such as "site:ollama.com/library", plus the exact model names when known.
- For hardware-fit questions, use "VRAM", "GPU", and the model tag; do not search only for "RAM".

Return only compact JSON with this exact shape:
{
  "needsWeb": true,
  "query": "search query to run",
  "queries": ["primary query", "backup query"],
  "reason": "short reason"
}

Local memory:
${memory || "(none)"}

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
    queries: buildFallbackQueries(question),
    reason: "Victor did not return valid routing JSON, so web search is used as a safe fallback."
  };
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

  return merged
    .sort((left, right) => scoreSearchResult(right, question) - scoreSearchResult(left, question))
    .slice(0, maxResults);
}

function normalizeQueries(decision: AgentDecision, question: string): string[] {
  const fallbackQueries = buildFallbackQueries(question);
  const modelHardwareQuestion = isModelHardwareQuestion(question);
  const queries = [
    ...(modelHardwareQuestion ? fallbackQueries : []),
    decision.query,
    ...decision.queries,
    ...(modelHardwareQuestion ? [] : fallbackQueries)
  ]
    .map((query) => sanitizeQuery(query))
    .filter((query) => query.length > 0);

  return [...new Set(queries)].slice(0, 4);
}

function scoreSearchResult(result: { title: string; url: string }, question: string): number {
  const haystack = `${result.title} ${result.url}`.toLowerCase();
  let score = 0;

  if (haystack.includes("ollama.com/library")) {
    score += 100;
  }

  if (haystack.includes("qwen3.5")) {
    score += 35;
  }

  if (haystack.includes("qwen3")) {
    score += 20;
  }

  if (haystack.includes("hermes3")) {
    score += 20;
  }

  if (haystack.includes("deepseek-r1")) {
    score += 15;
  }

  if (haystack.includes("vram")) {
    score += 15;
  }

  if (haystack.includes("gpu")) {
    score += 10;
  }

  if (isModelHardwareQuestion(question) && haystack.includes("ram") && !haystack.includes("vram")) {
    score -= 40;
  }

  if (haystack.includes("2024") || haystack.includes("2025")) {
    score -= 10;
  }

  return score;
}

function sanitizeQuery(query: string): string {
  return query
    .replace(/\b20(1[0-9]|2[0-5])\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFallbackQueries(question: string): string[] {
  const lower = question.toLowerCase();

  if (isModelHardwareQuestion(question)) {
    return [
      "site:ollama.com/library qwen3.5:9b",
      "site:ollama.com/library qwen3:8b qwen3:14b",
      "site:ollama.com/library hermes3:8b",
      "site:ollama.com/library llama3.1:8b llama3.2"
    ];
  }

  if (lower.includes("qwen3.5")) {
    return [
      "site:ollama.com/library qwen3.5 9b",
      "qwen3.5 9b ollama model size context"
    ];
  }

  return [question];
}

function isModelHardwareQuestion(question: string): boolean {
  const lower = question.toLowerCase();
  return (
    lower.includes("ollama") &&
    (lower.includes("gpu") || lower.includes("vram") || lower.includes("nvidia")) &&
    (lower.includes("model") || lower.includes("qwen") || lower.includes("llama") || lower.includes("hermes"))
  );
}

function parseDecision(raw: string): AgentDecision | null {
  const jsonText = extractJson(raw);

  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as Partial<AgentDecision>;
    const queries = Array.isArray(parsed.queries)
      ? parsed.queries.filter((query): query is string => typeof query === "string")
      : [];

    return {
      needsWeb: Boolean(parsed.needsWeb),
      query: typeof parsed.query === "string" ? parsed.query.trim() : "",
      queries,
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
