# v1.0.0 · dsh-super-search

Global search over the conversations a DeepSeek Harness keeps, restricted to the
text a person typed and the text the assistant answered.

## Features

- **Search palette** — `⌘⇧K` or the sidebar foot entry; each open starts a fresh
  run, and Enter opens the matching conversation.
- **`super_search` tool** — the agent searches earlier conversations in its own
  workspace with the same rules.
- **`ctx.superSearch`** — the Host service both callers share:
  `search({ query, sessionId?, cwd?, limit? })`.

## Scope

Only two kinds of text are indexed: user questions and assistant answers.
Reasoning blocks, tool calls and their arguments, tool output, and the notices
the Harness delivers in the user role (runtime context, timestamps, skill
catalogs, background-job notices) never enter the index.

Matching is case-insensitive substring matching, so a Chinese phrase inside a
sentence and an English word inside a longer word are both found; several words
are combined with AND.

## Implementation

- Derived index over the session log: live sessions extend incrementally, stored
  sessions are re-read only when their persistence revision changes (4 at a
  time), titles fold once per session.
- Browser entry point `/api/super-search` is admitted by
  `ctx.connection.admit()`, so it carries the same browser authentication as the
  rest of the application surface.

## Install

```bash
# agent
plugin_manager install_bundle target=git+https://github.com/<owner>/dsh-super-search.git#v1.0.0

# CLI
dsh plugin --profile <profile> add git+https://github.com/<owner>/dsh-super-search.git
```

Or download the attached `dsh-super-search-1.0.0.tgz` and install that path.
The Web dialog also accepts the repository URL directly.
