Adds [dsh-super-search](https://github.com/pengfeis/dsh-super-search) to **Context & Search**.

Global search over DSH conversations that indexes only what a person typed and
what the assistant answered — reasoning blocks, tool calls, and tool output never
enter the index — exposed as a ⌘⇧K palette and a `super_search` tool.

- Only `user/message` (a human turn) and `assistant/message` text blocks are
  indexed; Harness-injected user-role notices (runtime context, timestamps, skill
  catalogs, background jobs) are excluded as well.
- Substring matching, so Chinese phrases match inside a sentence and English
  words match inside longer words; several words combine with AND.
- Derived index over the session log: live sessions extend incrementally, stored
  sessions re-read only when their persistence revision changes.
- The palette route is admitted by `ctx.connection.admit()`, so it carries the
  same browser authentication as the rest of the application surface.

Install: `plugin_manager install_bundle target=git+https://github.com/pengfeis/dsh-super-search.git#v1.0.0`
(replace pengfeis with the account that hosts it).
