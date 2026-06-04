declare const process: {
  env: Record<string, string | undefined>;
};

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type SearchResult = {
  title: string;
  url: string;
};

export type Source = SearchResult & {
  excerpt: string;
};

export type AgentDecision = {
  needsWeb: boolean;
  query: string;
  queries: string[];
  reason: string;
};

export type VictorConfig = {
  ollamaHost: string;
  victorName: string;
  think: boolean | string;
  autoMemory: boolean;
  maxResults: number;
  maxCharsPerSource: number;
  memoryDir: string;
};

type OllamaResponse = {
  message?: {
    content?: string;
  };
  error?: string;
};

export function loadConfig(): VictorConfig {
  return {
    ollamaHost: process.env.OLLAMA_HOST ?? "http://localhost:11434",
    victorName: process.env.VICTOR_NAME ?? "victor",
    think: parseThink(process.env.THINK ?? "false"),
    autoMemory: parseBoolean(process.env.VICTOR_AUTO_MEMORY ?? "false"),
    maxResults: parsePositiveInt(process.env.WEB_MAX_RESULTS, 5),
    maxCharsPerSource: parsePositiveInt(process.env.WEB_MAX_CHARS, 1800),
    memoryDir: process.env.VICTOR_MEMORY_DIR ?? "memory"
  };
}

export async function loadMemory(config: VictorConfig): Promise<string> {
  const files = ["machine.md", "preferences.md", "projects.md", "benchmarks.md", "facts.md"];
  const sections: string[] = [];

  for (const file of files) {
    try {
      const content = await readFile(join(config.memoryDir, file), "utf8");
      sections.push(content.trim());
    } catch {
      // Memory files are optional so the agent can run on a fresh clone.
    }
  }

  return sections.join("\n\n---\n\n");
}

export async function decideWebSearch(
  config: VictorConfig,
  question: string,
  memory: string,
  recentChat = ""
): Promise<AgentDecision> {
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

Recent chat:
${recentChat || "(none)"}

Question:
${question}`;

  const raw = await askOllama(config, prompt);
  const parsed = parseAgentDecision(raw);

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

export function normalizeSearchQueries(decision: AgentDecision, question: string): string[] {
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

export function rankSearchResults(results: SearchResult[], question: string): SearchResult[] {
  return [...results].sort((left, right) => scoreSearchResult(right, question) - scoreSearchResult(left, question));
}

export async function appendMemory(config: VictorConfig, file: string, note: string): Promise<void> {
  if (!["machine.md", "preferences.md", "benchmarks.md", "projects.md", "facts.md"].includes(file)) {
    throw new Error(`Unsupported memory file: ${file}`);
  }

  const trimmed = note.trim();

  if (!trimmed) {
    throw new Error("Memory note is empty.");
  }

  await mkdir(config.memoryDir, { recursive: true });
  await appendFile(join(config.memoryDir, file), `\n- ${trimmed}\n`, "utf8");
}

export async function searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url);
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const linkPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gis;

  for (const match of html.matchAll(linkPattern)) {
    const rawUrl = decodeHtml(match[1] ?? "");
    const title = normalizeText(stripTags(decodeHtml(match[2] ?? "")));
    const resultUrl = unwrapDuckDuckGoUrl(rawUrl);

    if (!title || !isHttpUrl(resultUrl) || seen.has(resultUrl)) {
      continue;
    }

    seen.add(resultUrl);
    results.push({ title, url: resultUrl });

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

export async function collectSources(results: SearchResult[], maxCharsPerSource: number): Promise<Source[]> {
  const sources: Source[] = [];

  for (const result of results) {
    try {
      const html = await fetchText(result.url);
      const text = extractReadableText(html);
      const excerpt = text.slice(0, maxCharsPerSource);

      if (excerpt.length < 200) {
        continue;
      }

      sources.push({ ...result, excerpt });
    } catch (error) {
      console.error(`Skipping source: ${result.url}`);
      console.error(`  ${String(error)}`);
    }
  }

  return sources;
}

export async function askOllama(config: VictorConfig, prompt: string): Promise<string> {
  const response = await fetch(`${config.ollamaHost}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.victorName,
      messages: [{ role: "user", content: prompt }],
      think: config.think,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama API failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as OllamaResponse;

  if (data.error) {
    throw new Error(data.error);
  }

  return data.message?.content?.trim() || "(empty response)";
}

export function formatSources(sources: Source[]): string {
  return sources
    .map((source, index) => {
      return `[${index + 1}] ${source.title}
URL: ${source.url}
Excerpt:
${source.excerpt}`;
    })
    .join("\n\n---\n\n");
}

export function buildLocalAnswerPrompt(question: string, memory: string): string {
  const takeRule = wantsTake(question)
    ? "- The user is asking for a take/opinion/recommendation. Give a brief factual grounding, then a clearly labeled practical take."
    : "- If the user asks for a recommendation, give one with a short reason.";

  return `Answer the user's question using the available local memory when relevant.

Rules:
- Prefer concise, practical answers.
- If local memory directly applies, use it.
- Do not claim memory contains facts it does not contain.
${takeRule}

Local memory:
${memory || "(none)"}

Question:
${question}`;
}

export function buildWebAnswerPrompt(question: string, sources: Source[], memory = ""): string {
  const takeRule = wantsTake(question)
    ? "- The user is asking for a take/opinion/recommendation. First ground the facts with citations, then include a clearly labeled \"My take\" section."
    : "- If the user asks for a recommendation, give one after grounding it in sources and memory.";

  return `Answer the user's question using the web sources below.

Rules:
- Cite sources with bracketed source numbers like [1] or [2].
- If the sources do not support a claim, say so.
- Prefer concise, practical answers.
- Do not invent facts beyond the provided sources.
- Distinguish GPU VRAM from system RAM. Do not treat an 8 GB RAM source as evidence for an 8 GB NVIDIA VRAM recommendation.
- If the user's observed local benchmark conflicts with generic web advice, say that the local benchmark is more relevant for this machine.
- Use local memory when it is more specific than generic web advice.
${takeRule}

Question:
${question}

Local memory:
${memory || "(none)"}

Sources:
${formatSources(sources)}`;
}

function wantsTake(question: string): boolean {
  const lower = question.toLowerCase();
  return (
    lower.includes("what do you think") ||
    lower.includes("your take") ||
    lower.includes("what's your take") ||
    lower.includes("is it good") ||
    lower.includes("is this good") ||
    lower.includes("should i") ||
    lower.includes("do you recommend") ||
    lower.includes("recommendation")
  );
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "VictorLocalAssistant/0.1"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

function unwrapDuckDuckGoUrl(rawUrl: string): string {
  if (rawUrl.startsWith("//")) {
    rawUrl = `https:${rawUrl}`;
  }

  try {
    const parsed = new URL(rawUrl);
    const wrapped = parsed.searchParams.get("uddg");
    return wrapped ? decodeURIComponent(wrapped) : parsed.toString();
  } catch {
    return rawUrl;
  }
}

function extractReadableText(html: string): string {
  const withoutScripts = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ");

  return normalizeText(stripTags(decodeHtml(withoutScripts)));
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, " ");
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function isHttpUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseAgentDecision(raw: string): AgentDecision | null {
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

function scoreSearchResult(result: SearchResult, question: string): number {
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

function parseThink(input: string): boolean | string {
  if (input === "true") {
    return true;
  }

  if (input === "false") {
    return false;
  }

  return input;
}

function parseBoolean(input: string): boolean {
  return !["0", "false", "no", "off"].includes(input.toLowerCase());
}

function parsePositiveInt(input: string | undefined, fallback: number): number {
  if (!input) {
    return fallback;
  }

  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
