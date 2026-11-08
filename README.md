# dsh-super-search

**Global search over DeepSeek Harness conversations — user questions and assistant answers only.**
**DSH 会话全局搜索 —— 只搜用户提问与助手回答。**


## 中文

在 DeepSeek Harness 保存的全部会话里做全局搜索。可检索的内容范围很窄：**只有人输入的提问、助手给出的回答，以及会话标题本身**。

按结构排除的内容：

- 思考过程（reasoning）块，
- 工具调用及其参数，
- 工具输出，
- Harness 自身以 user 角色投递的通知（运行时上下文、时间戳、技能目录、后台任务提示）。

### 提供的入口

| 入口 | 作用 |
|---|---|
| 搜索面板 | `⌘⇧K` 或侧栏入口，打开后可以搜索**所有工作区的所有会话**，回车直接跳到命中的会话；范围栏可把搜索收窄到某一个工作区。 |
| `super_search` 工具 | 智能体用同样的规则检索过往会话，支持跨会话；`workspace` 参数可限定到某个目录，传 `"all"` 则覆盖全部工作区。 |
| `ctx.superSearch` | 两个调用方共用的 Host 服务：`search({ query, workspace?, sessionId?, limit? })`，另有 `workspaces()`。 |

每次打开面板都会开始一轮全新的搜索：面板主体按"打开代次"重新挂载，上一次的关键词、结果、选中项以及仍在飞行中的请求都会随旧实例一起丢弃，而不是残留下来。面板已经打开时再按 `⌘⇧K`，会保留当前这一轮。

### 匹配规则

- 英文单词可以命中更长的词（`install` 能找到 `installation`）。
- 中文连续片段可以整段命中；当词语在文中不相邻时，命中其中的相邻字对，所以 `搜索插件` 能找到 `搜索会话插件`，但不会命中只是零散含有同样字的文本。
- 多个词之间是 AND 关系；当没有任何结果同时满足全部词时，退化为部分匹配，并明确提示。
- 结果按得分排序：词出现的次数与精确度、该条是提问还是回答、以及会话标题是否也命中。标题与正文一起参与检索，所以即使标题里的词没在正文出现，也能按标题找到会话。
- 匹配不区分大小写，中文短语出现在句子中间、英文单词出现在更长的词内部，都能命中。

### 搜索范围

搜索覆盖本 Harness 的整个语料：所有在线会话与所有已存储会话，覆盖所有工作目录。可用面板里的范围栏收窄，也可以用工具和 Host 服务的 `workspace` 参数收窄。工具的默认值是调用方智能体自己的工作区，与 Harness 的工作区授权模型保持一致；传 `workspace: "all"` 可以搜全部工作区。

### 实现要点

- **索引**是会话日志的派生缓存，日志仍是唯一事实来源。语料来自 `ctx.sessions`（在线）与 `ctx.sessionPersistence`（已存储）。在线会话只追加扫描其间新增的事件；已存储会话仅在持久化 revision 变化时才重读，每次并发 4 个。会话标题就在它自己的日志里，因此不需要二次读取。
- **读取**：在线会话直接读内存日志；已存储会话经 `ctx.sessionQuery.observeSession()` 读取，重放与校验方式与恢复会话一致。
- **浏览器入口**：面板读取 `/api/super-search` 与 `/api/super-search/workspaces`；Host 两者都经 `ctx.connection.admit()` 放行，与应用其余部分使用同一套浏览器鉴权。两者都是精确路由，不会遮蔽共享 `/api` 通道上的其他路径。

### 安装

在 **Plugins → Add plugin** 里安装并启用。面板会出现在侧栏底部，快捷键是 `⌘⇧K`。客户端模块按各自的版本号 URL 提供，因此插件启用前就已打开的页面会在下次加载时拿到面板。

也可以直接用本仓库地址或包规格：

```bash
# 智能体
plugin_manager install_bundle target=git+https://github.com/pengfeis/dsh-super-search.git#v1.1.2

# 命令行
dsh plugin --profile <profile> add git+https://github.com/pengfeis/dsh-super-search.git
```

`v1.1.2` Release 还附带 `dsh-super-search-1.1.2.tgz` 及其 sha256，便于离线安装。

### 测试

```bash
# 抽取与匹配语义（跑真实会话日志）
node test/search.test.mjs <session.jsonl> [...]

# 真实索引：刷新、排序、标题、跨会话与工作区范围
node test/index.test.mjs <session.jsonl> [...]

# 浏览器侧（无 DOM）
node test/client.test.mjs
```

会话日志位于 `$DSH_HOME/sessions/<工作区>/<会话 id>/session.v4.jsonl.zstd`，用 `zstd -dc` 解压。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxResults` | `50` | 调用方未指定时，一次搜索返回的结果条数。 |

```yaml
- id: super-search
  name: 'dsh-super-search'
  config:
    maxResults: 100
```

---

## Distribute · 分发

The `dist/` folder holds the packed bundle (`dsh-super-search-<version>.tgz` plus
its sha256), [INSTALL.md](dist/INSTALL.md) with every install form the Web dialog
and the package manager accept, `publish.sh` for cutting a release, and the
draft entry for the [awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness)
list. `dist/*.tgz` is git-ignored: release assets carry the artifact.


## License · 许可证

MIT — see [LICENSE](LICENSE).

[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## English

Global search over the conversations a DeepSeek Harness keeps. The searchable
corpus is deliberately narrow: only what a person typed (user questions), what
the assistant answered (assistant answers), and the title of the conversation
itself.

Left out by construction:

- reasoning ("thinking") blocks,
- tool calls and their arguments,
- tool output, and
- the notices the Harness itself delivers in the user role (runtime context,
  timestamps, skill catalogs, background-job notices).

### What it adds

| Surface | What it does |
|---|---|
| Search palette | `⌘⇧K` or the sidebar entry opens a palette that searches **every session of every workspace** and opens the one you pick. A scope bar narrows the search to one working directory. |
| `super_search` tool | The agent searches earlier conversations with the same rules, across sessions; `workspace` narrows it to one directory, `"all"` widens it to everything. |
| `ctx.superSearch` | The Host service both callers share: `search({ query, workspace?, sessionId?, limit? })`, plus `workspaces()`. |

Each open of the palette starts a new run: the palette remounts its body under a
fresh open generation, so the previous query, hits, selection, and any request
still in flight are dropped instead of reappearing. Pressing the shortcut again
while the palette is already open keeps the current run.

### How matching works

- A word matches inside a longer word (`install` finds `installation`).
- A run of Chinese characters matches as one substring, or — when the words are
  not adjacent in the text — through any adjacent character pair of the run, so
  `搜索插件` still finds `搜索会话插件` without matching a text that merely holds
  the same characters apart.
- Several terms are combined with AND. When nothing matches every term, the
  search falls back to partial matches and says so.
- Hits are ranked by score: how often and how exactly the terms occur, whether
  the message is a question or an answer, and whether the conversation's own
  title matches. Titles are searched beside the messages, so a conversation is
  findable by its name even when none of its words appear in it.
- Matching is case-insensitive, so Chinese phrases inside a sentence and English
  words inside longer words are both found.

### Scope

The search spans the whole corpus of this Harness: every live session and every
stored one, across every working directory. Narrow it with the scope bar in the
palette, or with the `workspace` argument of the tool and of the Host service.
The tool's default is the calling agent's own workspace, matching the Harness's
workspace-authority model; pass `workspace: "all"` to reach every workspace.

### How it works

- **Index.** A derived cache over the session log; the log stays the single
  source of truth. The corpus is `ctx.sessions` (live) plus
  `ctx.sessionPersistence` (stored). A live session is extended with the events
  appended since the last scan; a stored session is re-read only when its
  persistence revision changed, four at a time. A conversation's title rides in
  its own log, so no second read is needed.
- **Reads.** Live sessions are read from the in-memory log; stored sessions
  through `ctx.sessionQuery.observeSession()`, which replays and validates the
  log the same way resume does.
- **Browser entry point.** The palette reads `/api/super-search` and
  `/api/super-search/workspaces`; the Host admits both through
  `ctx.connection.admit()`, so they carry the same browser authentication as the
  rest of the application surface. The routes are exact matches, so they never
  shadow the shared `/api` channel for other paths.

### Install

Install this bundle in **Plugins → Add plugin** and enable it. The palette then
appears at the sidebar foot and on `⌘⇧K`. The client half is served at its own
revisioned URL, so a page that was already open when the bundle was enabled
picks the palette up on the next load.

From this repository, either paste the URL in that dialog or use a package spec:

```bash
# agent tool
plugin_manager install_bundle target=git+https://github.com/pengfeis/dsh-super-search.git#v1.1.2

# CLI
dsh plugin --profile <profile> add git+https://github.com/pengfeis/dsh-super-search.git
```

The `v1.1.2` release also carries `dsh-super-search-1.1.2.tgz` and its sha256 for
offline installs.

### Tests

```bash
# extract + match semantics, against real session logs
node test/search.test.mjs <session.jsonl> [...]

# the real index: refresh, ranking, titles, cross-session and workspace scope
node test/index.test.mjs <session.jsonl> [...]

# the browser half without a DOM
node test/client.test.mjs
```

A session log lives under `$DSH_HOME/sessions/<workspace>/<session-id>/` as
`session.v4.jsonl.zstd`; decompress it with `zstd -dc`.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxResults` | `50` | Hits returned by one search when the caller does not ask for a limit. |

```yaml
- id: super-search
  name: 'dsh-super-search'
  config:
    maxResults: 100
```

---

