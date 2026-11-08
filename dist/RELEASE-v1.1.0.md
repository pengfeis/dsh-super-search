# v1.1.0 · cross-session and workspace search, sharper matching

The search now spans sessions and working directories by design, matches
Chinese text the way people write it, and finds a conversation by its title.

## What changed

- **Cross-session, cross-workspace.** The palette searches every session of
  every workspace at once. A scope bar lists the workspaces the corpus holds
  and narrows the search to one of them; the `super_search` tool takes a
  `workspace` argument (`"all"` reaches every workspace, the caller's own
  workspace is the default), and `ctx.superSearch.search()` takes the same.
- **Titles are searchable.** A conversation's title rides in its own log, so a
  session is findable by its name even when none of its words appear in it,
  and a title match lifts that session's other hits.
- **Chinese matching that follows how people write.** A run of Chinese
  characters matches as one substring, or through any adjacent character pair of
  the run — so `搜索插件` finds `搜索会话插件` without matching a text that
  merely holds the same characters apart. English words still match inside
  longer words.
- **Partial matches, kept honest.** When no text holds every term, the search
  falls back to matches that carry most of the query's terms and characters
  and keep the matched words close together, and says so in the result.
- **Ranking by score.** Hits are scored by how often and how exactly the terms
  occur, whether the message is a question or an answer, and whether the
  conversation's title matches.
- **A bilingual README** covering both English and Chinese.

## Install

```bash
# agent
plugin_manager install_bundle target=git+https://github.com/pengfeis/dsh-super-search.git#v1.1.0

# CLI
dsh plugin --profile <profile> add git+https://github.com/pengfeis/dsh-super-search.git
```

The attached `dsh-super-search-1.1.0.tgz` (and its sha256) installs offline.

## Upgrade notes

The palette's scope bar and the tool's `workspace` argument are new; nothing
else changed for existing users. `ctx.superSearch.search()` keeps its old
signature — `workspace` and `sessionId` are optional additions, and `cwd` still
narrows to one directory.
