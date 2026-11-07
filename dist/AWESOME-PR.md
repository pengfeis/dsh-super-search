# 收录 PR · 0xsline/awesome-deepseek-harness

目标仓库：<https://github.com/0xsline/awesome-deepseek-harness>

按它的 [contributing.md](https://github.com/0xsline/awesome-deepseek-harness/blob/main/contributing.md)：
一个真实仓库 + 一行事实性描述 + 链接；中英两个 README 在**同一个 PR** 里各加一条；PR 标题 `docs: add <repo>`。

## 类目

**不需要新类目** —— 现有 `Context & Search`（"Context management, compression, search, and session retrieval"）正好覆盖本插件；同区已有 `dsh-session-search` 这类会话检索条目。
（`Output & Deliverables` / 输出与交付 也已存在，但那是报告/导出类，不是本插件的归属。）

## 改动内容

两个文件都追加到 `## Context & Search` 小节末尾（把 `pengfeis` 换成实际 GitHub 账号）：

### README.md（英文）

```markdown
- [pengfeis/dsh-super-search](https://github.com/pengfeis/dsh-super-search) - Global search across DSH conversations that indexes only user questions and assistant answers (reasoning, tool calls, and tool output stay out), with a ⌘⇧K search palette and a `super_search` tool.
```

### README.zh-CN.md（中文）

```markdown
- [pengfeis/dsh-super-search](https://github.com/pengfeis/dsh-super-search) - DSH 会话全局搜索：只索引用户提问与助手回答（不含思考过程、工具调用与工具输出），提供 ⌘⇧K 搜索面板与 `super_search` 工具。
```

## PR

- 标题：`docs: add pengfeis/dsh-super-search`
- 正文：

```markdown
Adds [dsh-super-search](https://github.com/pengfeis/dsh-super-search) to **Context & Search**.

Global search over DSH conversations that indexes only what a person typed and
what the assistant answered — reasoning blocks, tool calls, and tool output never
enter the index — exposed as a ⌘⇧K palette and a `super_search` tool. Chinese
phrases match inside a sentence because matching is substring-based rather than
token-based.
```

## 命令（认证后执行）

```bash
gh repo fork 0xsline/awesome-deepseek-harness --clone=true --remote=false
cd awesome-deepseek-harness
git checkout -b docs/add-dsh-super-search
# 编辑 README.md 与 README.zh-CN.md（见上）
git commit -am "docs: add pengfeis/dsh-super-search"
git push -u origin docs/add-dsh-super-search
gh pr create --repo 0xsline/awesome-deepseek-harness \
  --title "docs: add pengfeis/dsh-super-search" \
  --body-file ../dist/AWESOME-PR-BODY.md
```
