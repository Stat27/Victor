declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exit(code?: number): never;
};

type SearchResult = {
  title: string;
  url: string;
};

type Source = SearchResult & {
  excerpt: string;
};

type OllamaResponse = {
  message?: {
    content?: string;
  };
  error?: string;
};

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const VICTOR_NAME = process.env.VICTOR_NAME ?? "victor";
const THINK = parseThink(process.env.THINK ?? "false");
const MAX_RESULTS = parsePositiveInt(process.env.WEB_MAX_RESULTS, 5);
const MAX_CHARS_PER_SOURCE = parsePositiveInt(process.env.WEB_MAX_CHARS, 1800);

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(" ").trim();

  if (!query || query === "--help" || query === "-h") {
    printHelp();
    return;
  }

  console.log(`Searching web for: ${query}`);
  const results = await searchDuckDuckGo(query, MAX_RESULTS);

  if (results.length === 0) {
    throw new Error("No search results found.");
  }

  const sources = await collectSources(results);

  if (sources.length === 0) {
    throw new Error("Search worked, but no readable source text was fetched.");
  }

  console.log(`Fetched ${sources.length} source(s). Asking ${VICTOR_NAME}...`);
  const answer = await askVictor(query, sources);

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

function printHelp(): void {
  console.log(`Usage:
  npm run web -- "<question>"

Examples:
  npm run web -- "latest Ollama tool calling docs"
  npm run web -- "qwen3.5:9b ollama size and context"

Environment:
  OLLAMA_HOST       Default: http://localhost:11434
  VICTOR_NAME       Default: victor
  THINK             Default: false
  WEB_MAX_RESULTS   Default: 5
  WEB_MAX_CHARS     Default: 1800
`);
}

async function searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
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

async function collectSources(results: SearchResult[]): Promise<Source[]> {
  const sources: Source[] = [];

  for (const result of results) {
    try {
      const html = await fetchText(result.url);
      const text = extractReadableText(html);
      const excerpt = text.slice(0, MAX_CHARS_PER_SOURCE);

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

async function askVictor(question: string, sources: Source[]): Promise<string> {
  const sourceBlock = sources
    .map((source, index) => {
      return `[${index + 1}] ${source.title}
URL: ${source.url}
Excerpt:
${source.excerpt}`;
    })
    .join("\n\n---\n\n");

  const prompt = `Answer the user's question using the web sources below.

Rules:
- Cite sources with bracketed source numbers like [1] or [2].
- If the sources do not support a claim, say so.
- Prefer concise, practical answers.
- Do not invent facts beyond the provided sources.

Question:
${question}

Sources:
${sourceBlock}`;

  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VICTOR_NAME,
      messages: [{ role: "user", content: prompt }],
      think: THINK,
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

main().catch((error) => {
  console.error(`web_chat failed: ${String(error)}`);
  process.exit(1);
});
