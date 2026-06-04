# Victor Personal Agent Plan

Victor's goal is to become a personal local assistant, not only a chat UI.

That means Victor should maintain useful awareness across sessions:

- what the user is trying to build;
- what happened in previous sessions;
- what the current repo/workspace state is;
- what the local machine and model runtime look like;
- what user preferences and decisions should persist;
- what facts should be remembered, updated, or forgotten.

Victor should not silently scrape every private file on the machine. "Aware of everything" means aware of approved local context sources and able to ask for more access when needed.

## Principles

1. **Local first**
   Memory, sessions, and context indexes stay on this machine unless the user explicitly exports or pushes them.

2. **User-controlled memory**
   Durable memory should be proposed, reviewed, edited, or approved. Avoid silently polluting memory.

3. **Awareness before action**
   Victor should inspect relevant local state before giving advice or taking action.

4. **Scoped access**
   Victor should know which areas it is allowed to observe: this repo, memory files, sessions, benchmark runs, machine snapshots, and approved project folders.

5. **Reproducible behavior**
   The personal-agent workflow should be documented and portable to another machine.

## Step 1: Awareness Inventory

Create an explicit map of what Victor can observe.

Target context sources:

- `memory/*.md`: durable machine, preference, project, benchmark, and fact memory.
- `sessions/`: saved chat/session transcripts.
- `runs/`: benchmark and model test history.
- Git state: current branch, dirty files, recent commits.
- Repo files: README, plans, scripts, source files, profiles, modes.
- Runtime state: Ollama availability, active model, GPU snapshot, current profile.

Deliverable:

- Add a context snapshot command that summarizes the current approved state.
- Example command:

```bash
npm run context
```

Expected output:

- memory files found;
- recent session count;
- current git branch and dirty files;
- current profile/model if available;
- recent benchmark/run notes;
- Ollama reachability;
- GPU snapshot when available.

## Step 2: Session History

Victor should remember conversations as sessions, not only individual memory notes.

Target behavior:

- Each desktop or terminal chat creates a session file.
- Sessions are stored under `sessions/YYYY-MM-DD/<session-id>.json`.
- A compact session summary is generated at the end or after major turns.
- The desktop sidebar can show recent sessions.
- Reopening a session restores recent messages and its summary.

Deliverable:

- Session storage format.
- Session list command.
- Desktop session sidebar.

## Step 3: Memory Approval Workflow

Victor should propose memory updates instead of blindly saving them.

Target behavior:

- After a meaningful turn, Victor proposes at most one durable memory note.
- The UI shows:
  - target memory file;
  - proposed note;
  - `Save`;
  - `Edit`;
  - `Reject`.
- Terminal chat keeps `/propose-memory`, `/approve`, and `/reject`.

Deliverable:

- Tauri commands for proposed memory.
- UI memory approval panel.
- Memory write audit line in the session file.

## Step 4: Relevant Memory Retrieval

Victor should not dump all memory into every prompt forever.

Target behavior:

- For each user request, Victor selects relevant memory sections.
- High-priority memory is always loaded:
  - durable user preferences;
  - active project goal;
  - current machine/runtime facts.
- Other memory is retrieved based on the question.

Deliverable:

- Memory selection helper.
- Prompt output showing which memory files were used.
- Reduced prompt noise for unrelated tasks.

## Step 5: Personal Assistant Commands

Victor should support assistant workflows beyond normal chat.

Target commands:

- `what did we do last?`
- `continue the Victor project`
- `summarize today's work`
- `remember this`
- `forget/update this memory`
- `show current context`
- `what changed in the repo?`
- `what should I do next?`

Deliverable:

- Intent router for assistant commands.
- Context-aware answers using sessions, memory, and git state.

## Step 6: Tool Layer

Victor should gain controlled local tools.

Initial safe tools:

- read approved repo files;
- summarize git status;
- list recent sessions;
- load memory;
- run benchmark scripts on request;
- capture GPU/runtime snapshot.

Later tools:

- calendar/reminders;
- broader filesystem access;
- project-specific task runners;
- background monitoring.

Deliverable:

- Tool registry.
- Tool permission model.
- UI indication when tools are used.

## Step 7: Daily Personal Agent Loop

Victor should support a lightweight daily workflow.

Target behavior:

- On startup, Victor loads current context snapshot.
- Victor can summarize recent progress.
- Victor can suggest the next step based on project state.
- Victor can remember decisions made during the session.
- Victor can produce an end-of-session summary.

Deliverable:

- `npm run context`
- `npm run daily`
- desktop startup context panel;
- end-of-session summary and memory proposal.

## Current Next Step

Implement Step 1: Awareness Inventory.

Start with a TypeScript context snapshot command:

```bash
npm run context
```

It should inspect only approved repo-local sources first. This gives Victor a reliable base layer of awareness before adding session history and richer tools.
