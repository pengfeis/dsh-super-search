---
description: "Global search over DeepSeek Harness conversations: user questions and assistant answers only."
kind: "package-bundle"
---

# dsh-super-search

Global search over the conversations a DeepSeek Harness keeps. The searchable
corpus is deliberately narrow: only what a person typed (user questions) and
what the assistant answered (assistant answers).

Left out by construction:

- reasoning ("thinking") blocks,
- tool calls and their arguments,
- tool output, and
- the notices the Harness itself delivers in the user role (runtime context,
  timestamps, skill catalogs, background-job notices).

## What it adds

| Surface | What it does |
|---|---|
| Search palette | `⌘⇧K` or the sidebar entry opens a palette that searches every conversation and opens the one you pick. |
| `super_search` tool | The agent searches earlier conversations in its own workspace with the same rules. |
| `ctx.superSearch` | The Host service both callers share: `search({ query, sessionId?, cwd?, limit? })`. |

Each open starts a new run: the palette remounts its body under a fresh open
generation, so the previous query, hits, selection, and any request still in
flight are dropped instead of reappearing. Pressing the shortcut again while the
palette is already open keeps the current run.

Matching is case-insensitive substring matching, so a word inside a longer word
and a Chinese phrase inside a sentence are both found. Several words are
combined with AND. Hits carry the session id, the folded session title, the
role, the event sequence, a snippet around the first match, and the occurrence
count; they are ranked by occurrence count and then by recency.

## Install

Install this bundle in **Plugins → Add plugin** and enable it. The palette then
appears at the sidebar foot and on `⌘⇧K`. The client half is served at its own
revisioned URL, so a page that was already open when the bundle was enabled
picks the palette up on the next load.

From this repository, either paste the URL in that dialog or use a package spec:

```bash
# agent tool
plugin_manager install_bundle target=git+https://github.com/pengfeis/dsh-super-search.git#v1.0.0

# CLI
dsh plugin --profile <profile> add git+https://github.com/pengfeis/dsh-super-search.git
```

The `v1.0.0` release also carries `dsh-super-search-1.0.0.tgz` and its sha256 for
offline installs.

## Distribute

The `dist/` folder holds the packed bundle (`dsh-super-search-<version>.tgz` plus
its sha256), [INSTALL.md](dist/INSTALL.md) with every install form the Web dialog
and the package manager accept, `publish.sh` for cutting a release, and the
draft entry for the [awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness)
list. `dist/*.tgz` is git-ignored: release assets carry the artifact.

## How it works

- **Index.** A derived cache over the session log; the log stays the single
  source of truth. The corpus is `ctx.sessions` (live) plus
  `ctx.sessionPersistence` (stored). A live session is extended with the events
  appended since the last scan; a stored session is re-read only when its
  persistence revision changed, four at a time.
- **Reads.** Live sessions are read from the in-memory log; stored sessions
  through `ctx.sessionQuery.observeSession()`, which replays and validates the
  log the same way resume does.
- **Titles.** Folded through `ctx.sessionQuery.readTitle()` once per session and
  remembered.
- **Browser entry point.** The palette reads `/api/super-search` and the Host
  admits the request through `ctx.connection.admit()`, so it carries the same
  browser authentication as the rest of the application surface. The route is
  an exact match, so it never shadows the shared `/api` channel for other paths.

## Tests

Both run against real session logs, without a Harness:

```bash
# extract + match semantics
node test/search.test.mjs <session.jsonl> [...]

# the real index: refresh, ranking, snippets, titles, cold-session caching
node test/index.test.mjs <session.jsonl> [...]
```

The browser half has its own DOM-free wiring test:

```bash
# module wiring, open store generation, one fresh body per open
node test/client.test.mjs
```

A session log lives under `$DSH_HOME/sessions/<workspace>/<session-id>/` as
`session.v4.jsonl.zstd`; decompress it with `zstd -dc`.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxResults` | `50` | Hits returned by one search when the caller does not ask for a limit. |

Set it on this bundle's row in the profile patch:

```yaml
- id: super-search
  name: 'dsh-super-search'
  config:
    maxResults: 100
```
