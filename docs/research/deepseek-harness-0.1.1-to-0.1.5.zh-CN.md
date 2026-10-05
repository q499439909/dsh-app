# DeepSeek Harness `0.1.1-rc.2` → `0.1.5-rc.2` 更新研究

> 研究日期：2026-09-21  
> 范围：`@deepseek-ai/dsh` / `deepseek-ai/deepseek-harness`  
> 资料约束：只采用 DeepSeek 官方仓库的 Release、tag compare、源码、包清单和官方迁移文档；本仓库文件只用于判断本地兼容性，不被当作上游事实来源。

## 结论先行

这不是一次只改界面的补丁升级，而是跨过了一次核心 Web/插件通信架构迁移。

- 对普通用户，主要收益是更完整的会话导航与统计、任意文件上传、右侧多标签预览与文件交付、更强的子代理控制、长会话性能和断线恢复、Windows 体验修复，以及新的 `DeepSeek-V41-Flash` 默认模型。[`0.1.2-rc.1` 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1) · [`0.1.5-rc.1` 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
- 对插件作者，最大的破坏性变化是旧 `APIProxy` 被迁移并移除，浏览器侧远程调用改为 Typert Remote / `ctx.remote.<namespace>`；官方架构说明明确写明“不再存在 API Proxy 服务”。[`0.1.2-rc.1` 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1) · [APIProxy → Remote 官方架构决策](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/.agents/notes/archived/architecture/2026-08-10-unary-apiproxy-remote-migration.zh.md) · [Remote API 实操手册](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/docs/cookbook/adding-a-remote-api.zh.md)
- `D:\dsh-app` 的四个私有 Web 插件仍直接依赖 `@deepseek-ai/dsh-host-apiproxy` 和/或已被删除的 `@deepseek-ai/dsh-client-runtime`，其中认证和数据集插件还直接调用 `ctx.apiProxy`。因此，把 CLI 和大多数包改成 `0.1.5-rc.2`，但把这两个旧包强行固定为 `0.1.1-rc.2`，只能形成一个跨架构混装树，不能算完成升级。[全量官方 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.5-rc.2) · [`0.1.5-rc.2` CLI 包清单](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/apps/cli/package.json)
- `0.1.5-rc.2` 相对 `0.1.5-rc.1` 本身只有两项 UI 打磨；真正的大跨度变化来自中间的 `0.1.2`、`0.1.3` 和 `0.1.5-rc.1`。[`0.1.5-rc.2` 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2)

## 版本范围与证据链

官方没有发布一份直接覆盖 `0.1.1-rc.2 → 0.1.5-rc.2` 的单独迁移说明，但两份 RC 汇总说明恰好首尾相接：

1. `0.1.2-rc.1` 明确汇总“自 `0.1.1-rc.2` 以来”的主要变化。[官方 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1)
2. `0.1.5-rc.1` 明确汇总“自 `0.1.2-rc.1` 以来”的主要变化。[官方 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
3. 再叠加 `0.1.5-rc.2` 的两项体验优化，即覆盖目标范围。[官方 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2)
4. 源码级核对使用官方完整比较页。[`dsh-v0.1.1-rc.2...dsh-v0.1.5-rc.2`](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.5-rc.2)

## 用户能直接感知的更新

### 1. 会话界面、可读性与性能

- 已完成回答前的过程内容和 System prompt 默认折叠；对话正文宽度可自适应或拖动，字号可调，Markdown 表格随字号缩放。[`0.1.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1)
- 每个回答末尾显示 token 用量与耗时，可展开精确统计；完整历史新增回合导航，未加载的回合也可预览和跳转。[`0.1.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1)
- Web 显示连接状态，支持断线自动重试/立即重连；后续版本又修复了断线后不能恢复的问题。[`0.1.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1) · [`0.1.3-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.3-alpha.2)
- 长会话的打开、恢复、持续对话、密集实时消息、代码高亮、布局和导航预览均做了性能与内存优化。[`0.1.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1) · [`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
- `0.1.5-rc.2` 进一步压缩对话间距、优化交付文件卡片和代码文件图标。[`0.1.5-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2)

### 2. 文件上传、预览与交付

- Web 从图片上传扩展为任意类型文件上传；文件与图片共用预览区，后台上传提供进度和取消，切换会话仍保留状态，模型可按保存路径用文件工具读取。[`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
- 新右侧 Sidebar 支持多标签、分栏和全屏，可预览 Markdown、代码、HTML、PDF 和图片；模型可以显式交付文件，用户可预览、用默认应用打开或在文件管理器定位。旧 Detail 面板被移除。[`0.1.5-alpha.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-alpha.1) · [`0.1.5-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-alpha.2) · [`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
- Web 能直接展示顶层或 PTC 嵌套 `read_image` 结果，也能显示模型回复中引用的 POSIX 绝对路径本地图片。[`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)

### 3. 模型与网络

- DeepSeek 适配器新增 `DeepSeek-V41-Flash`（配置名 `deepseek-flash`），支持文本、图片和会话历史中的系统提示词更新；新会话默认使用它，显式配置仍优先。[`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
- 支持动态修改系统提示词而不破坏 KV Cache，但模型必须显式声明支持。[`0.1.5-alpha.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-alpha.1)
- 自定义 provider 的模型发现支持 `models` 对象和 Anthropic 原生列表，并可补齐模型名、上下文窗口和最大输出 token；无效 Base URL 会在发现前校验并提示。[`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
- 所有出站请求遵循 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`。[`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)

### 4. 子代理、Agent Teams 与目标控制

- 父 Agent 与可持续子 Agent 从单向 `report` 迁为双向 `send_message`；子代理可排队、编辑、删除、Steer 单条/全部消息并停止。[`0.1.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1) · [`0.1.3-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.3-alpha.2)
- Agent Teams 已提供可安装的实验包，但不会默认启用，需显式加入 profile。[`0.1.5-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-alpha.2)
- 用户暂停目标会立即结束当前模型轮次，模型不能自行恢复，必须由用户恢复。[`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)

### 5. 平台、工具与可靠性

- Python SDK runtime 新增 Windows x64，随后补充 macOS x64；ACP 补齐标准会话控制、模型设置、MCP、权限和取消能力。[`0.1.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1) · [`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
- 默认启用带 SSRF 防护的公网 `web_fetch`；Python SDK、Headless、ACP 和自定义 Profile 默认提供它。[`0.1.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1)
- Windows 修复包括目录选择器编码截断、选择器被其他窗口遮挡、盘符根目录 Workspace、Python SDK 启动崩溃；非终端子进程不再弹控制台窗口。[`0.1.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1) · [`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
- MCP 工具发现会拒绝重复分页游标，避免启动/同步永久等待；DeepSeek 流式工具调用会保留续传分片的调用 ID 和名称，避免损坏会话记录。[`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
- 点赞、点踩都改为弹窗确认，失败时保留反馈文本并提示。[`0.1.5-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2)

## 架构/API 破坏性变化

| 变化 | 对插件/数据的影响 | 官方依据 |
|---|---|---|
| **旧 APIProxy 移除，迁移到 Remote Gateway / Typert Remote** | 旧插件不能继续 `inject: ['apiProxy']` 或调用 `ctx.apiProxy.sessions.*`。Host 能力应继承 `TypertRemoteService`、用 `@Remote` 声明；Client 注入 `remote` 与 `remote.<namespace>` 后调用 `ctx.remote.<namespace>.<method>()`。 | [`0.1.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1) · [架构决策](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/.agents/notes/archived/architecture/2026-08-10-unary-apiproxy-remote-migration.zh.md) · [Remote API 手册](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/docs/cookbook/adding-a-remote-api.zh.md) |
| **旧 `dsh-client-runtime` 源包整体删除** | 依赖其 `slots`、`conversationEvents`、`conversation` 和旧 client contract 的插件不能靠 peer override 兼容，需要迁到新的 client services / remote / panel API。 | [完整 compare（可见 `packages/client/runtime` 删除）](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.5-rc.2) |
| **Web panel API 改动** | 全局面板改由 `sidebar.panellist` 与 `main` 注册；原 `conversation` Slot 迁到 `main` 下的 `conversation` key。旧 Slot 名称/注册方式需改。 | [`0.1.5-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-alpha.2) · [`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1) |
| **Session 格式升级为 V3** | 支持的旧日志会生成新日志且保留原文件，但升级后的会话不能由旧版降级读取；自定义日志读取器必须适配 V3。 | [`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1) · [V2 → V3 迁移规范](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/session/session-format-v2-to-v3/README.zh.md) |
| **Session 查询与生命周期 API 改动** | `Session.events` 被 `seq`、`eventAt()`、`snapshotEvents()` 取代；持久化 API 改由生命周期范围的 `SessionHandle` 持有；`agentLoop.create()` 变为异步，并新增单进程独占 session 锁。 | [`0.1.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1) · [`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1) |
| **Agent / Inbox API 改动** | 删除 `ctx.agent`，调用方需显式传递 Agent；`Inbox` 变成只存在于类型层的接口，通过 `agent.inbox` 访问，`hasPending`、`claim` 不再是公共 API。 | [`0.1.5-alpha.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-alpha.1) · [`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1) |
| **子代理通信从 `report` 转向 `send_message`** | 依赖旧单向 report 工具/包的 profile 应改为双向消息控制面；现有配置中继续锁定 `dsh-tool-subagent-report` 是旧架构遗留信号。 | [`0.1.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1) · [完整 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.5-rc.2) |
| **其他不兼容项** | 自定义 persona 拆为 prefix/suffix；普通 subprocess handle 不再暴露 pid；Code Mode 更名为 PTC；Web PTC 默认不再提供通用 `workflow`；SQLite Session 后端移除，已有内容需用旧版导出。 | [`0.1.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1) · [`0.1.3-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.3-alpha.2) |

## 与 `D:\dsh-app` 当前插件的直接关系

以下是对 2026-09-21 工作区现状的静态核对。这里的“本地证据”说明当前插件写法；“上游依据”说明为什么该写法不能作为 `0.1.5` 原生插件继续运行。

| 本地组件 | 当前依赖/调用 | 与 `0.1.5` 的冲突 | 迁移方向 |
|---|---|---|---|
| `@dsh-dj/user-auth` | peer 依赖 `dsh-host-apiproxy ^0.1.1-rc.2`；`inject = ['webServer', 'apiProxy']`；通过 monkey-patch 包装 `apiProxy.sessions`、`subagents`、`events`、`downloads`。见 [`packages/dsh-user-auth/package.json`](../../packages/dsh-user-auth/package.json) 与 [`lib/index.js`](../../packages/dsh-user-auth/lib/index.js)。 | 官方已移除 APIProxy，并把每个操作迁回所属 Remote service；因此核心不会再提供旧 `apiProxy` service。[官方架构决策](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/.agents/notes/archived/architecture/2026-08-10-unary-apiproxy-remote-migration.zh.md) | 不能只改 peer 版本。需把用户身份/会话授权变成 0.1.5 Host owner/service 的明确策略，并为浏览器调用定义 Typert Remote；避免继续 patch 一个已不存在的聚合代理对象。[Remote API 手册](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/docs/cookbook/adding-a-remote-api.zh.md) |
| `@dsh-dj/datasets` | 同时依赖 `dsh-host-apiproxy` 和 `dsh-client-runtime`；Host 注入 `apiProxy`，直接调用 `apiProxy.sessions.list/history`；Client 依赖旧 `slots` 与 `conversationEvents`。见 [`package.json`](../../packages/dsh-dj-datasets/package.json)、[`lib/index.js`](../../packages/dsh-dj-datasets/lib/index.js)、[`lib/client.js`](../../packages/dsh-dj-datasets/lib/client.js)。 | 两条基础接缝都已改变：APIProxy 移除，旧 client runtime 源包删除；其会话读取和卡片插槽都无法由 0.1.5 原生核心满足。[官方 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.5-rc.2) | Host 侧按 Session/Workspace owner API 重写远程能力；Client 侧改用 `ctx.remote` 和新的 `main` / Sidebar panel 注册面。[Remote API 手册](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/docs/cookbook/adding-a-remote-api.zh.md) · [`0.1.5` panel 变更](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1) |
| `@dsh-dj/operator-library` | Client 依赖 `dsh-client-runtime`；Host 注入本地 `identityAccess`；通过旧 Sidebar/runtime 组合呈现。见 [`package.json`](../../packages/dsh-dj-operator-library/package.json) 与 [`lib/index.js`](../../packages/dsh-dj-operator-library/lib/index.js)。 | `identityAccess` 是本项目私有 service，不能称为“被上游删除”；真正可由官方证明的冲突是旧 client runtime 已从上游移除，panel seam 已改变。[官方 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.5-rc.2) | 保留本地身份域也可以，但需要显式挂到 0.1.5 Host/Remote 架构，并把 UI 入口迁到新版 Sidebar/panel API。[`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1) |
| `@dsh-dj/plan-explorer` | Client 依赖 `dsh-client-runtime`，使用 `conversationEvents`、`conversation` 和 `conversation.*` Slots；Host 注入本地 `identityAccess`、`djWorkflow`。见 [`package.json`](../../packages/dsh-dj-plan-explorer/package.json)、[`lib/client.js`](../../packages/dsh-dj-plan-explorer/lib/client.js)、[`lib/index.js`](../../packages/dsh-dj-plan-explorer/lib/index.js)。 | `identityAccess`、`djWorkflow` 是本地服务，并非官方 DSH 服务，不能把缺失归类为某个官方“删除项”；但旧 client runtime 删除和 conversation panel API 迁移足以使当前 Client 插件不兼容。[官方 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.5-rc.2) · [`0.1.5` panel 变更](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1) | 将计划卡片投影/操作迁入新版 `main.conversation` 或右侧 Sidebar，并给 `djWorkflow` 定义正式 Remote namespace；不要再从旧 runtime `/client` 入口取 contract。[Remote API 手册](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/docs/cookbook/adding-a-remote-api.zh.md) |

### 当前版本锁定为什么不是兼容方案

当前 [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) 一方面列出 `dsh-client-runtime@0.1.5-rc.2`、`dsh-host-apiproxy@0.1.5-rc.2`、`dsh-tool-subagent-report@0.1.5-rc.2` 的注入请求，另一方面又在 overrides 中把三者固定到 `0.1.1-rc.2`。这三个名称恰好都属于被新架构替代的旧接缝。

上游源码比较显示：

- `packages/host/apiproxy` 在目标 tag 中整包删除；官方架构决策说明其能力已分散到自然业务 owner 的 Typert Remote，不存在一个可直接替换版本号的 `apiProxy` 对象。[官方 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.5-rc.2) · [架构决策](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/.agents/notes/archived/architecture/2026-08-10-unary-apiproxy-remote-migration.zh.md)
- `packages/client/runtime` 在目标 tag 中整包删除，其原有 sessions、workspaces、conversation registry 和 slots contract 不再是 0.1.5 的运行时边界。[官方 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.5-rc.2)
- 子代理官方控制面已经用 `send_message` 替代单向 `report`；继续锁旧 `dsh-tool-subagent-report` 只是在维持旧 profile 的依赖形状。[`0.1.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1)
- 目标版 CLI 的官方包清单已经依赖 ACP/SDK 应用组合，不再依赖 `dsh-host-apiproxy`；这与源码删除相互印证。[`0.1.5-rc.2 apps/cli/package.json`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/apps/cli/package.json)

因此，这些 override 最多能让包管理器解析出旧模块，不能让 0.1.5 核心重新提供旧 Cordis service，也不能把旧 client contract 自动接到新的 Remote/panel 架构。启动时插件长期 `pending` 是依赖图没有获得所需 service 的直接表现，而不是“新版包没下载下来”。

## 对升级执行的含义

建议把升级定义为“迁移四个本地插件”，而不是“继续对齐版本号”:

1. 以纯 `0.1.5-rc.2` 核心 profile 为基线，禁止将已移除的三条旧接缝伪装为目标版包。
2. 先迁 `user-auth`：它拥有 `identityAccess`，也是其他三个插件的授权根；将 session/workspace 权限下沉到明确 Host owner，并用 Typert Remote 暴露浏览器所需的最小能力。[Remote API 手册](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/docs/cookbook/adding-a-remote-api.zh.md)
3. 再迁 `datasets`：把 `apiProxy.sessions.list/history` 改成 0.1.5 的 Session 查询/Remote seam，同时按 V3 session 数据模型测试历史扫描。[V2 → V3 迁移规范](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/session/session-format-v2-to-v3/README.zh.md)
4. 迁 `operator-library` 与 `plan-explorer` 的 UI：改用新版 `main`、`main.conversation`、`sidebar.panellist`/右侧 Sidebar 能力。[`0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
5. 最后移除 `dsh-client-runtime`、`dsh-host-apiproxy`、`dsh-tool-subagent-report` 的旧版 overrides，做完整插件树启动测试、鉴权隔离测试、Session V3 升级/回退边界测试和 Web 面板交互测试。[完整官方 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.5-rc.2)

## 官方一手资料索引

- [全部 Releases](https://github.com/deepseek-ai/deepseek-harness/releases)
- [`0.1.2-rc.1`：汇总自 `0.1.1-rc.2` 的变化](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1)
- [`0.1.3-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.3-alpha.2)
- [`0.1.5-alpha.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-alpha.1)
- [`0.1.5-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-alpha.2)
- [`0.1.5-rc.1`：汇总自 `0.1.2-rc.1` 的变化](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
- [`0.1.5-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2)
- [完整 tag compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.5-rc.2)
- [APIProxy → Typert Remote 官方架构决策](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/.agents/notes/archived/architecture/2026-08-10-unary-apiproxy-remote-migration.zh.md)
- [新增 Remote API 官方实操手册](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/docs/cookbook/adding-a-remote-api.zh.md)
- [Session V2 → V3 官方迁移规范](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/session/session-format-v2-to-v3/README.zh.md)
- [`0.1.5-rc.2` CLI 官方 package manifest](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/apps/cli/package.json)
