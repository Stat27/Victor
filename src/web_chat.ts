declare const process: {
  argv: string[];
  exit(code?: number): never;
};

import {
  askOllama,
  buildWebAnswerPrompt,
  collectSources,
  loadMemory,
  loadConfig,
  searchDuckDuckGo
} from "./victor_lib.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const query = process.argv.slice(2).join(" ").trim();

  if (!query || query === "--help" || query === "-h") {
    printHelp();
    return;
  }

  console.log(`Searching web for: ${query}`);
  const results = await searchDuckDuckGo(query, config.maxResults);

  if (results.length === 0) {
    throw new Error("No search results found.");
  }

  const sources = await collectSources(results, config.maxCharsPerSource);

  if (sources.length === 0) {
    throw new Error("Search worked, but no readable source text was fetched.");
  }

  const memory = await loadMemory(config);

  console.log(`Fetched ${sources.length} source(s). Asking ${config.victorName}...`);
  const answer = await askOllama(config, buildWebAnswerPrompt(query, sources, memory));

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

main().catch((error) => {
  console.error(`web_chat failed: ${String(error)}`);
  process.exit(1);
});
