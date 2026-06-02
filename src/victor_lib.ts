declare const process: {
  env: Record<string, string | undefined>;
};

export type SearchResult = {
  title: string;
  url: string;
};

export type Source = SearchResult & {
  excerpt: string;
};

export type VictorConfig = {
  ollamaHost: string;
  victorName: string;
  think: boolean | string;
  maxResults: number;
  maxCharsPerSource: number;
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
    maxResults: parsePositiveInt(process.env.WEB_MAX_RESULTS, 5),
    maxCharsPerSource: parsePositiveInt(process.env.WEB_MAX_CHARS, 1800)
  };
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

export function buildWebAnswerPrompt(question: string, sources: Source[]): string {
  return `Answer the user's question using the web sources below.

Rules:
- Cite sources with bracketed source numbers like [1] or [2].
- If the sources do not support a claim, say so.
- Prefer concise, practical answers.
- Do not invent facts beyond the provided sources.

Question:
${question}

Sources:
${formatSources(sources)}`;
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

function parseThink(input: string): boolean | string {
  if (input === "true") {
    return true;
  }

  if (input === "false") {
    return false;
  }

  return input;
}

function parsePositiveInt(input: string | undefined, fallback: number): number {
  if (!input) {
    return fallback;
  }

  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
