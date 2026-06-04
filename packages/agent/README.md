# Victor Agent Package

TypeScript command-line and shared agent logic for Victor.

```text
src/agent_chat.ts   Agent router with optional web search and memory update loop
src/web_chat.ts     Forced web-backed answer wrapper
src/chat.ts         Interactive terminal chat
src/chat_core.ts    Shared chat turn helpers
src/victor_lib.ts   Ollama, web, config, and memory utilities
```

Run from the repository root:

```bash
npm run agent -- "question"
npm run chat
npm run web -- "question"
```

`npm run agent` and `npm run chat` share the same web-routing rules for current facts, model availability, and hardware-fit questions. One-shot `npm run agent` memory writes are off by default; set `VICTOR_AUTO_MEMORY=1` only when an automatic durable memory update is wanted.
