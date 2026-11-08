Adds [dsh-super-search](https://github.com/pengfeis/dsh-super-search) to **Context & Search**.

Global search over DSH conversations that spans every session and every
workspace, and indexes only what a person typed, what the assistant answered,
and the conversation title — reasoning blocks, tool calls, and tool output never
enter the index.

- The palette (`⌘⇧K`) searches the whole corpus at once, with a scope bar to
  narrow it to one working directory; `super_search` gives the agent the same
  search with an optional `workspace` argument.
- Chinese matches the way people write it: a run of characters matches as one
  substring or through its adjacent character pairs, so `搜索插件` finds
  `搜索会话插件` without matching a text that merely holds the same characters
  apart. English words match inside longer words.
- The index is derived from the session log: live sessions extend incrementally,
  stored sessions are re-read only when their persistence revision changed.
- The palette routes are admitted by `ctx.connection.admit()`, so they carry the
  same browser authentication as the rest of the application surface.

Install: `plugin_manager install_bundle target=git+https://github.com/pengfeis/dsh-super-search.git#v1.1.1`
