# 安装与分发 · dsh-super-search

本目录是给别人安装用的产物。

| 文件 | 说明 |
|---|---|
| `dsh-super-search-1.0.0.tgz` | 可安装的 dsh bundle 包（8 个文件，13.8 KB） |
| `dsh-super-search-1.0.0.tgz.sha256` | 校验和 |

## 兼容性

- DSH：0.2.x 系列（本插件只调用稳定 Host 服务 `sessionQuery`、`sessions`、`sessionPersistence`、`tools`、`webServer`、`connection`；浏览器侧只注入 `slots`、`locale`、`uiWorkspace`、`shortcuts`）。
- 平台：需要 Web GUI（桌面版或 `dsh web`）。Host 端与操作系统无关，因此不声明平台限制。

## 安装方式一：让智能体安装（适合任意来源）

在任意会话里让智能体执行：

```text
plugin_manager install_bundle  target=<包规格>  enabled=true
```

`target` 可接受：

| 形态 | 例子 |
|---|---|
| 本地 tarball 绝对路径 | `/Users/me/dist/dsh-super-search-1.0.0.tgz` |
| HTTPS tarball 地址 | `https://example.com/dsh-super-search-1.0.0.tgz` |
| Git 仓库 | `git+https://github.com/<you>/<repo>.git#path:dsh-super-search` |
| npm 包名（已发布时） | `dsh-super-search` 或 `dsh-super-search@1.0.0` |

## 安装方式二：网页「Plugins → Add plugin」

该对话框接受：npm 包名、GitHub 仓库地址、本地目录路径。

- 想用目录：`tar -xzf dsh-super-search-1.0.0.tgz` 得到 `package/` 目录，把它的绝对路径填进去。
- 本地目录会以 `link:` 依赖安装（文件留在原处，删掉目录插件就失效）；要长期使用，优先用 tarball、Git 或 npm。

## 安装方式三：dsh CLI

```bash
dsh plugin --profile <profile> add <包规格>
```

## 三种分发渠道怎么选

1. **发布到 npm**（最省事）：`npm publish` 后，别人在 Add plugin 里填 `dsh-super-search` 即可；被插件索引收录后还能在 Discover 里搜到。
2. **公开 Git 仓库**：推送本目录，别人粘贴仓库地址，或使用
   `git+https://github.com/<you>/<repo>.git#path:dsh-super-search`
3. **直接发 tarball**：把 `dist/` 里的文件给对方，对方用智能体安装以上面的两种方式之一。

## 安装后自检

- Plugins 列表出现 **Super search / 全局搜索**，描述为「按用户提问与助手回答…」。
- 侧栏底部出现「搜索会话」入口，`⌘⇧K` 能打开搜索面板。
- 智能体可调用工具 `super_search`。
- 手工检查路由（未带浏览器凭据应为 401，响应头含插件自己的 `content-type`）：

```bash
curl -si "http://127.0.0.1:<port>/api/super-search?q=test" | head -3
```

## 卸载

- 智能体：`plugin_manager remove_bundle  target=dsh-super-search`
- 网页：Plugins 列表里选中该插件 → Remove。

## 发布前清单

- [ ] 确定许可证：本包当前**没有**声明 `license`，发布前请自行补充（例如 MIT）并注意随之附带的授权条款。
- [ ] 版本号：改 `package.json` 的 `version` 后重新打包（见下）。
- [ ] 可选：`repository`、`author`、`keywords` 字段。

## 重新打包

```bash
cd dsh-super-search
rm -f dist/*.tgz dist/*.sha256
npm pack --pack-destination dist
cd dist && shasum -a 256 dsh-super-search-*.tgz > dsh-super-search-1.0.0.tgz.sha256
```

`package.json` 的 `files` 决定打进包里的文件：`index.js`、`client.js`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`、`README.md`。
`test/` 与 `dist/` 不进包。
