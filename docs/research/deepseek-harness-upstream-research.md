# DeepSeek Harness 0.1.1-rc.2 → 0.1.2-alpha.3 上游更新与插件兼容性调查

> 调查日期：2026-09-01（Asia/Shanghai）  
> 上游范围：仅使用 `deepseek-ai/deepseek-harness` 官方 GitHub Release、tag、commit、文档和源码。

## 结论

当前官方最新版本是 **`dsh-v0.1.2-alpha.3`**，发布于 **2026-08-31 16:03:39 UTC（2026-09-01 00:03:39 中国标准时间）**，tag 与当时 `master` 均指向 `dd6322d604e00eec1ba5e0c8541159906a21094a`。GitHub 将该版本标记为 **Pre-release**；官方当前公开的 7 个 Release 也全部是 pre-release，因此不存在可称为“最新稳定版”的 GA Release。[官方 Release 列表](https://github.com/deepseek-ai/deepseek-harness/releases) [alpha.3 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.3) [发布提交](https://github.com/deepseek-ai/deepseek-harness/commit/dd6322d604e00eec1ba5e0c8541159906a21094a)

本工作区的实际基线是 **`@deepseek-ai/dsh@0.1.1-rc.2`**，`pnpm-workspace.yaml` 中的 DSH 官方包 catalog 也整体锁定在 `0.1.1-rc.2`；同时有 4 个本地插件和 3 个按 `0.1.1-rc.2` 包名精确定址的 pnpm patch。官方提供了从该基线到 alpha.3 的完整比较入口。[官方完整比较](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.2-alpha.3)

**不建议直接把根依赖改成 `0.1.2-alpha.3` 后就上线。** 当前插件中至少有两类硬不兼容：Host 侧 `ApiProxy` 已移除，Client 侧会话注册 API 和包所有权已迁移。所有问题都有可行的改造方向，但多用户会话隔离属于安全边界重设计，不应用一个临时 shim 视为已解决。

源码树也能直接验证这不只是发布说明的措辞：rc.2 中的 `packages/host/apiproxy` 和 `packages/client/runtime` 在 alpha.3 已不存在，其职责分别进入 Remote/Connection 体系与新的 Client 领域包。[rc.2 Host ApiProxy 源码目录](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.1-rc.2/packages/host/apiproxy) [rc.2 Client Runtime 源码目录](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.1-rc.2/packages/client/runtime) [alpha.3 官方源码树](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.3/packages)

## 最新三个 alpha 的主要更新

### 0.1.2-alpha.1（2026-08-27）

- 长会话 UI 开始大幅重构：过程折叠、回合导航、正文宽度/字号、精确 token 用量、流式代码高亮和更高效的会话初始化。
- 插件能在模型设置页增加 provider 登录配置，并支持注册第三方界面语言。
- 子代理增加 provider/model/reasoning effort/max output 选择，ACP 补齐会话控制、模型、MCP、权限和取消能力。
- 网络访问 Web UI 时开启启动链接的一次性 token 认证；官方安全说明同时明确 Harness 未经安全审计，沙箱、审批和权限不保证形成隔离。
- **Breaking：**旧 `ApiProxy` 调用层迁移并移除，统一使用 `@Remote` Gateway；会话 UI 工程被大幅拆分；Code Mode 更名为 PTC Mode；Headless 进度改输出到 stderr，stdout 仅保留最终结果。[官方 alpha.1 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.1)

### 0.1.2-alpha.2（2026-08-30）

- UI 显示连接异常、自动重试和立即重连；会话标题可查看活动的定时计划。
- 插件列表区分会话插件/全局插件，可切换 Agent Preset 和搜索其他 preset。
- 改善长会话和密集实时消息处理，回答末尾显示 token 用量与耗时。
- 修复 Node.js 24.0–24.11.1 启动/HMR；恢复 alpha.1 一度移除的 `SessionEvent.ignorable`，用于保留外部插件事件兼容。[官方 alpha.2 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2) [恢复外部事件兼容的官方提交](https://github.com/deepseek-ai/deepseek-harness/commit/29b65af)

### 0.1.2-alpha.3（2026-08-31）

- 长会话右侧导航可预览和跳转尚未载入的分页回合，降低长会话渲染内存并改善代码高亮流畅度。
- 修复运行中/排队消息的图片回显与投递、持续子代理后续消息图片、无扩展名图片识别和后端卡顿导致的假断线。
- **Breaking：**移除可选 SQLite Session 持久化后端；旧内容不会被删除，但官方要求用旧版导出。[官方 alpha.3 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.3)

## 对当前插件的兼容性判定

| 本地组件 | 判定 | 确定会命中的变更 | 可解决性 |
|---|---|---|---|
| `@dsh-dj/user-auth` | **硬不兼容，安全高风险** | Host 插件明确 `inject = ["webServer", "apiProxy"]`，并 monkey-patch `apiProxy.sessions/subagents/events/downloads/respond`。官方新版已宣布“Connection 持有传输和精确 Fetch 路由，不再存在 API Proxy 服务”。[官方 ApiProxy → Remote 迁移决策](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.3/.agents/notes/implemented/architecture/2026-08-10-unary-apiproxy-remote-migration.zh.md) | **可解决，但不是改名。** 要把 Session list/search/create/fork/history、subagent、event stream 和日志下载的用户所有权校验重新安置到新的 Remote/Connection/业务 service 边界，并重做越权、冷会话恢复、子代理和流式事件测试。官方一次性 Web token 不等于本项目的多用户认证/授权。 |
| `@dsh-dj/datasets` Host | **硬不兼容** | 依赖 `apiProxy.sessions.list/history` 进行结果 reconcile，而该服务已移除。官方当前简单一元操作通过 `ctx.remote.<namespace>`，且仅 `@Remote`/`@RemoteScope` 公开的方法能被 Client 调用。[官方 API Gateway 参考](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.3/docs/api-gateway.zh.md) | **可解决，中等改造。** Host reconcile 需改为直接使用当前 Host 领域 service/会话持久化读取 seam，或由数据集自有 `@Remote`/Fetch 端点暴露经授权的结果。 |
| `@dsh-dj/datasets` Client | **硬不兼容** | 现有包注入 `conversationEvents`并调用 `ctx.conversationEvents.register(...)`；最新官方 Client 组合改为 `ctx.uiConversation`，其 `events` 才是 `ConversationEventRegistry`。同时 `isAppendSurfaceEvent` 不再从 `dsh-client-runtime/client` 导出。[旧 runtime 对外面](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/packages/client/runtime/src/client/index.ts) [新 ui-conversation 对外面](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.3/packages/client/ui-conversation/src/client/index.ts) [`UiConversation.events` 源码](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.3/packages/client/ui-conversation/src/client/conversation/assembly.ts) | **可解决，小到中等改造。** 改为注入 `uiConversation`和 `ctx.uiConversation.events.register(...)`，将 surface helper 改从当前 owner 导入或直接使用稳定事件字段，并重跑投影和 turn-tail 测试。 |
| `@dsh-dj/plan-explorer` Client | **硬不兼容** | 同样使用已迁移的 `conversationEvents`。它还依赖本地 patch 新增的 `shell.auxiliary` slot 和 `ctx.layout.open/close/toggleAuxiliary*`，而 alpha.3 官方 `ui-layout` 仍是 three-column AppFrame，源码没有这些公开面。[官方 alpha.3 ui-layout 源码](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.3/packages/client/ui-layout/src/client/index.ts) | **可解决，中等改造。** 除更新会话注册 API 外，要么把 auxiliary patch 手工 rebase 到 alpha.3，要么改用官方现有 slot/overlay/details 容器重新放置面板。 |
| `@dsh-dj/operator-library` | **部分不兼容/高脆弱性** | Host 侧只使用 `webServer.register` 的精确 HTTP 路由，这个面在 alpha.3 仍存在；Client 侧却直接依赖 sidebar DOM/CSS 选择器，并通过自定义事件打开上述非官方 auxiliary panel。[官方 alpha.3 WebServer 源码](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.3/packages/host/webserver/src/index.ts) [官方 Slots 子系统说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.3/docs/subsystems/slots.zh.md) | **可解决。** Host API 大概可原样保留；Client 入口应从 DOM 插入改为官方类型化 slot，或至少对 alpha.3 DOM 重做实机验证。 |

### 会话 UI slot 的细节

`conversation.chat.turnTail` 这个 slot key 在 alpha.3 仍存在，但其声明/所有权已从 `ui-conversation` 拆到新的 `@deepseek-ai/dsh-client-ui-chat`。因此不是简单的“slot 删除”，而是插件依赖、注入顺序、类型导入和实机加载都需按新 owner 重新验证。[旧 slot contract](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/packages/client/ui-conversation/src/client/contract/slots.ts) [alpha.3 ui-conversation contract](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.3/packages/client/ui-conversation/src/client/contract/slots.ts) [alpha.3 ui-chat contract](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.3/packages/client/ui-chat/src/client/contract/slots.ts)

## 3 个本地 patch 的处理

pnpm `patchedDependencies` 的 key 包含精确版本 `0.1.1-rc.2`，升级到 `0.1.2-alpha.3` 后它们不会自动变成新版 patch；三者都要决定“丢弃、重写或手工 rebase”。

1. **`dsh-client-ui-layout` patch：必须重做或改设计。** 它增加第四列 auxiliary panel、新 slot 和 `ctx.layout` 方法，上游 alpha.3 不包含这些定制。会话 UI 拆包后直接套用旧的已构建 `lib/client.js` patch 风险很高。[官方 alpha.3 ui-layout 包](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.3/packages/client/ui-layout)
2. **`dsh-host-webserver` patch：必须手工 rebase，并与新 Connection 认证边界联合审查。** 该 patch 自定义 `registerRequestGuard()` 以覆盖 HTTP/upgrade，alpha.3 官方 WebServer 公开面中没有该方法；新官方架构由 Connection 在 `/api` Remote/Fetch 分发前执行信任检查。[官方 WebServer 源码](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.3/packages/host/webserver/src/index.ts) [官方 API Gateway 运行时说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.3/docs/api-gateway.zh.md#%E8%BF%90%E8%A1%8C%E6%97%B6%E8%B0%83%E7%94%A8)
3. **`dsh-tool-ask-user` patch：需重新生成，但改造较小。** alpha.3 官方 tool 仍没有本地 patch 增加的字符数/单行强制校验，因此如果项目仍需要该约束，可在 alpha.3 TypeScript 源面上重新实现并产生新 patch。[官方 alpha.3 ask-user 源码](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.3/packages/interaction/tool-ask-user/src/index.ts)

## 可行的升级路线

1. 从当前分支切一个独立升级分支，先备份用户数据；如果任何 profile 用过 SQLite Session，在旧版先完成导出。
2. 整体将 DSH catalog/root 依赖升到同一 `0.1.2-alpha.3` 家族，同时更新 4 个本地包的 peer dependencies；不要保留一半 rc.2、一半 alpha.3 的 DSH 运行时。官方 alpha.3 根包和各 DSH 包都使用 `0.1.2-alpha.3`。[官方 alpha.3 根 package.json](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.3/package.json)
3. 先做 Client 兼容层：`conversationEvents` → `uiConversation.events`、补 `ui-chat` owner 依赖、替换已迁移的 runtime helper，并决定 auxiliary panel 是 rebase 还是改用官方 slot。
4. 再做 Host 数据路径：把 datasets reconcile 从 `apiProxy` 迁出。
5. 最后单独完成鉴权/授权边界重写：列表、搜索、创建、分叉、历史、模型选择、队列、取消、subagent、日志下载、流式事件和 response 全部要有跨用户拒绝测试。
6. 验证门槛：`pnpm install`、全部本地单测、DSH boot、新建/恢复/分叉会话、Plan turn-tail、结果 reconcile、辅助面板、sidebar 入口、WebSocket 和多用户越权矩阵。

## 最终判断

- **能不能升：能。**
- **现有插件是否全部直接兼容：不是。** `user-auth`、`datasets`、`plan-explorer` 存在可确认的硬不兼容；`operator-library` 的 Host 路由大概可保留，Client 面板和 DOM 插入需适配。
- **能不能解决：能，但应做成一次受控迁移。** UI/数据集是常规 API 迁移；用户鉴权是安全架构迁移，必须以完整越权回归为交付条件。
- **建议的发布策略：**先在兼容分支上完成 alpha.3 适配和回归，保留 rc.2 可回滚安装；在 alpha 阶段不要覆盖唯一的生产环境。
