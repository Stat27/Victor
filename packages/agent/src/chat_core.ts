import {
  appendMemory,
  askOllama,
  buildLocalAnswerPrompt,
  buildWebAnswerPrompt,
  collectSources,
  decideWebSearch,
  loadConfig,
  loadMemory,
  normalizeSearchQueries,
  rankSearchResults,
  type SearchResult,
  searchDuckDuckGo
} from "./victor_lib.ts";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ProposedMemory = {
  file: string;
  note: string;
};

export type ChatTurnResult = {
  answer: string;
  route: {
    needsWeb: boolean;
    query: string;
    queries: string[];
    reason: string;
  };
  sources: Array<{
    title: string;
    url: string;
  }>;
};

export const HISTORY_LIMIT = 8;

export async function answerChatTurn(
  config: ReturnType<typeof loadConfig>,
  question: string,
  history: ChatMessage[]
): Promise<ChatTurnResult> {
  const memory = await loadMemory(config);
  const route = await decideWebSearch(config, question, memory, formatHistory(history));

  if (!route.needsWeb) {
    const answer = await answerLocal(config, question, memory, history);
    return { answer, route, sources: [] };
  }

  const queries = normalizeSearchQueries(route, question);
  const results = await searchQueries(queries, config.maxResults, question);
  const sources = await collectSources(results, config.maxCharsPerSource);

  if (sources.length === 0) {
    const answer = await answerLocal(config, question, memory, history);
    return {
      answer,
      route: {
        ...route,
        query: queries[0] ?? route.query,
        queries,
        reason: `${route.reason}; no readable web sources fetched, answered locally.`
      },
      sources: []
    };
  }

  const prompt = `${buildWebAnswerPrompt(question, sources, memory)}

Recent chat:
${formatHistory(history)}`;

  const answer = await askOllama(config, prompt);
  return {
    answer,
    route: { ...route, query: queries[0] ?? route.query, queries },
    sources: sources.map((source) => ({ title: source.title, url: source.url }))
  };
}

export async function rememberFact(config: ReturnType<typeof loadConfig>, note: string): Promise<void> {
  await appendMemory(config, "facts.md", note);
}

export async function approveMemory(config: ReturnType<typeof loadConfig>, proposal: ProposedMemory): Promise<void> {
  await appendMemory(config, proposal.file, proposal.note);
}

export async function proposeMemory(
  config: ReturnType<typeof loadConfig>,
  history: ChatMessage[]
): Promise<ProposedMemory | null> {
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

export function appendTurn(history: ChatMessage[], question: string, answer: string): void {
  history.push({ role: "user", content: question });
  history.push({ role: "assistant", content: answer });
  trimHistory(history);
}

export function clearHistory(history: ChatMessage[]): void {
  history.length = 0;
}

export function formatHistory(history: ChatMessage[]): string {
  if (history.length === 0) {
    return "(none)";
  }

  return history.map((message) => `${message.role}: ${message.content}`).join("\n\n");
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

async function searchQueries(queries: string[], maxResults: number, question: string): Promise<SearchResult[]> {
  const seen = new Set<string>();
  const merged: SearchResult[] = [];

  for (const query of queries) {
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
