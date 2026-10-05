# DSH × Data-Juicer 标准 MCP 本地 MVP 接手文档

更新时间：2026-10-04（Asia/Shanghai）  
适用工作区：`D:/dsh-app`、`D:/dj/data-juicer-1.5.4`

本文记录把 DSH 与 Data-Juicer Plan Flow 从自定义内部 HTTP bridge 切换到
`@deepseek-ai/dsh-mcp-client + streamable-http` 的本地单用户 MVP 过程，包括已经修改的代码、实际验证、踩坑和下一步。

本文以两个仓库当前的 **dirty worktree** 为准，不把未提交改动、Git HEAD 和正在运行的进程视为同一版本。
文档不包含 API Key、内部令牌或 DSH Web 临时登录 token。

## 1. 一页结论

本地标准 MCP 闭环已经实际跑通：

```text
DSH Web / Agent
  -> @deepseek-ai/dsh-mcp-client
  -> MCP Streamable HTTP
  -> http://127.0.0.1:8010/mcp
  -> Data-Juicer Plan Flow
  -> prepare_plan
  -> approve_plan
  -> run_plan
  -> get_run
  -> succeeded
```

当前 MVP 的部署假设是：

- 单机、单用户；
- 模型供应商统一配置；
- DJ MCP 只监听本机；
- DJ 工作区由服务端固定，不信任模型传入的绝对路径；
- Plan Flow 使用 `native` 本地进程执行；
- 暂不保留旧 bridge 的结构化审批、会话状态恢复和 Run 完成后主动唤醒能力；
- 暂不宣称具备多用户或不可信用户之间的操作系统级隔离。

## 2. 当前架构与旧架构的区别

### 2.1 旧接线

旧配置表面写着 MCP 风格的工具名，但 DSH 实际没有使用标准 MCP transport：

```text
DSH
  -> packages/dsh-user-auth/lib/dj-bridge.js
  -> GET/POST /internal/operator-tools
  -> DJ FastMCP 内部 HTTP Adapter
```

旧 bridge 除工具转发外还承担：

- 从 DSH 会话 owner 注入用户身份；
- 用会话 cwd 覆盖 `workspace_root`；
- 注入稳定 `request_id`；
- 隐藏 `approve_plan`，改用宿主 `confirm_plan`；
- 维护 `PlanWorkflow` SQLite、审批 outbox、Run 轮询和会话恢复；
- Run 结束后向原会话发布报告。

因此，旧 bridge 不是单纯的协议适配器。

### 2.2 当前 MVP 接线

当前 DSH 直接使用官方 MCP Client：

```text
DSH
  -> @deepseek-ai/dsh-mcp-client
  -> streamable-http
  -> /mcp
  -> FastMCP tools/list + tools/call
```

工具公开名称仍为：

```text
mcp__dj__inspect_input
mcp__dj__search_capabilities
mcp__dj__prepare_plan
mcp__dj__approve_plan
mcp__dj__run_plan
mcp__dj__get_run
...
```

本次实际发现 15 个 DJ 工具。标准 MCP Client 负责连接、发现、工具注册、调用超时、断线重连和工具列表更新；
它不会自动提供 DSH 特有的身份、cwd 注入或结构化审批语义。

## 3. 路径和配置

### 3.1 主要路径

| 内容 | 路径 |
|---|---|
| DSH 工作区 | `D:/dsh-app` |
| Data-Juicer 源码 | `D:/dj/data-juicer-1.5.4` |
| DJ Python | `D:/dj/.envs/dsh-dj-uvlock-20260911/Scripts/python.exe` |
| DSH 部署配置 | `D:/dsh-app/dsh-deployment.json` |
| DSH patch 模板 | `D:/dsh-app/dj-dsh.patch.yml` |
| 启动器 | `D:/dsh-app/web-dj.ps1` |
| DJ MCP 实现 | `D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/server.py` |
| 账号/工作区控制 | `.../plan_flow/task_control.py` |

### 3.2 当前部署配置

`dsh-deployment.json` 当前关键值：

```json
{
  "workspaceRoot": ".",
  "webPort": 57535,
  "djPort": 8010,
  "executionMode": "native",
  "proxyUrl": null,
  "publicOrigin": null
}
```

说明：

- `workspaceRoot` 最终解析为 `D:/dsh-app`；
- 文档编写前的联调因 `57535` 被另一套 DSH 占用，使用过 `57536` 临时覆盖；
- 当前不使用 HTTP/HTTPS 代理；
- `publicOrigin=null`，仍是本地部署，不是公网部署配置。

## 4. 已实施修改

### 4.1 DSH 改为标准 MCP Client

文件：`D:/dsh-app/dj-dsh.patch.yml`

原来的：

```yaml
- id: dj-http-gateway
  name: '@dsh-dj/user-auth/dj-bridge'
  config:
    serverName: dj
    transport: internal-http
    baseUrl: http://127.0.0.1:8010
```

替换为：

```yaml
- id: mcp-dj
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: dj
    transport: streamable-http
    url: http://127.0.0.1:8010/mcp
    toolCallTimeoutMs: 1800000
    failOnStartupError: true
    reconnect:
      enabled: true
      initialDelayMs: 500
      maxDelayMs: 30000
      maxAttempts: 10
```

不要同时启用旧 `dj-http-gateway` 和新 `mcp-dj`，否则会争用相同的 `mcp__dj__*` 工具名称。

### 4.2 DJ 内增加显式单用户模式

文件：

- `data_juicer/tools/plan_flow/server.py`
- `data_juicer/tools/plan_flow/task_control.py`

新增环境变量：

```text
DJ_PLAN_FLOW_SINGLE_USER=local
DJ_PLAN_FLOW_WORKSPACE_ROOT=D:\dsh-app
```

行为：

1. `DJ_PLAN_FLOW_SINGLE_USER` 存在时，标准 `/mcp` 调用不会因缺少 `current_user` 返回 `ACCOUNT_REQUIRED`；
2. `task_control.controlled()` 返回 false，不启用账号工作区和 Task owner 门禁；
3. 所有带 `workspace_root` 的 Plan Flow 工具都会经 `_workspace_root()` 改写为固定部署工作区；
4. 即使模型传入其他绝对路径，也不会改变真实工作区；
5. 内部健康和页面路由仍可继续使用已有 `DSH_DJ_INTERNAL_TOKEN`。

固定工作区覆盖已应用到：

- `inspect_input`
- `inspect_runtime`
- `prepare_plan`
- `get_plan`
- `approve_plan`
- `run_plan`
- `get_run`
- `cancel_run`
- Run 结果相关 HTTP 路由的工作区参数

### 4.3 启动器调整

文件：`D:/dsh-app/web-dj.ps1`

当前工作树包含以下相关调整：

- MCP 子进程注入单用户模式和固定工作区环境变量；
- 单用户模式不再依赖旧用户认证插件提供的 `/auth/deployment` 作为启动就绪条件；
- 单用户模式以 DSH Web 端口监听作为就绪信号；
- Windows `Start-Process` 会把参数加双引号，进程识别正则现已兼容 `"web"`、`"--port" "57536"`；
- 增加从 lifecycle 和 stdout 日志恢复 DSH token-bearing URL 的逻辑；
- 非 `-NoOpen` 启动时让 DSH 自己打开带 token 的 URL，避免额外打开裸地址导致 401；
- 已有 DSH 实例可恢复其带 token 的启动 URL后再打开。

注意：`web-dj.ps1` 中还有其他当前工作树改动。接手者应以 `git diff -- web-dj.ps1` 为准，不能只依据本文猜测来源。

### 4.4 关闭失效代理

文件：`D:/dsh-app/dsh-deployment.json`

```json
"proxyUrl": null
```

此前配置是 `http://127.0.0.1:15236`。启动器会把它写入：

```text
HTTP_PROXY
HTTPS_PROXY
ALL_PROXY
NODE_USE_ENV_PROXY=1
```

但当时本机没有进程监听 `15236`，所以远程模型请求连续重试后报：

```text
Connection error.
TRANSPORT
```

同一模型 endpoint 直连返回 HTTP 200，因此根因是失效代理，不是模型 ID、API Key 或 MCP。

### 4.5 测试

文件：`tests/tools/plan_flow/test_control_contracts.py`

新增测试覆盖：

- 单用户模式关闭账号控制；
- 固定工作区覆盖模型传入的其他路径；
- 内部 token 仍存在时，单用户标准 MCP 调用不会被账号检查误拒绝。

## 5. 实际验证结果

### 5.1 MCP 协议验证

使用 `@modelcontextprotocol/client` 的 `StreamableHTTPClientTransport` 直连：

```text
http://127.0.0.1:8010/mcp
```

验证结果：

- `tools/list` 成功；
- 发现 15 个工具；
- `get_plan_contract` 返回 `ok=true`；
- contract version 为 `plan-v1.2`。

### 5.2 固定工作区验证

调用 `inspect_input` 时故意传入：

```text
workspace_root = D:/must-not-be-used
```

DJ 实际返回：

```text
workspace_root = D:\dsh-app
```

证明工作区由服务端固定，模型参数不能覆盖。

### 5.3 完整 Plan Flow 冒烟任务

测试输入：`D:/dsh-app/.dsh/mcp-smoke/input.jsonl`，两条文本记录。

调用顺序：

```text
prepare_plan
approve_plan
run_plan
get_run（轮询）
```

结果：

```text
task_id:          task_b9c0f9badd0a
plan_version:     plan_v001
run_id:           run_r001
execution_status: succeeded
delivery_status:  passed
result_count:     2
task_status:      needs_review
acceptance:       unverified
```

`needs_review / unverified` 是因为示例包含业务验收描述，但没有人工确认；不是执行失败。

输出目录：

```text
D:/dsh-app/outputs/verify-the-local-standard-mcp-plan-flow-end-to-e/
  task_b9c0f9badd0a/plan_v001/run_r001/
```

Run 报告：

```text
D:/dsh-app/.dj/tasks/task_b9c0f9badd0a/runs/run_r001/report.md
```

### 5.4 自动化回归

执行：

```powershell
Set-Location D:/dj/data-juicer-1.5.4
& D:/dj/.envs/dsh-dj-uvlock-20260911/Scripts/python.exe `
  -m pytest `
  tests/tools/plan_flow/test_control_contracts.py `
  tests/tools/plan_flow/test_workflow_remediation.py `
  tests/tools/plan_flow/test_p2_contracts.py -q
```

结果：

```text
34 passed
```

另做过：

- PowerShell 语法解析通过；
- `git diff --check` 通过；
- 启动脚本复用已有 DSH 进程的识别回归通过；
- 浏览器中 `glm-5.3` 在关闭代理后完成真实模型请求，并正确列出 15 个 DJ 工具。

## 6. 启动与停止

### 6.1 配置检查

```powershell
Set-Location D:/dsh-app
./web-dj.ps1 -CheckOnly
```

它只解析部署清单和构建身份，不代表在线进程已加载最新代码。

### 6.2 默认启动

确认 `57535` 和 `8010` 没有被其他不相关进程占用后：

```powershell
Set-Location D:/dsh-app
./web-dj.ps1
```

如需不自动打开浏览器：

```powershell
./web-dj.ps1 -NoOpen
```

### 6.3 端口冲突时

联调期间 `57535` 曾被另一套使用 `dsh-core.patch.yml` 的 DSH 占用，因此使用：

```powershell
./web-dj.ps1 -Port 57536 -McpPort 8010
```

不要为了腾端口直接终止未知进程。先检查进程命令行，确认它是否属于当前部署。

### 6.4 访问 URL

DSH 0.2 Web 使用带临时 token 的启动 URL：

```text
http://127.0.0.1:<port>/?token=<temporary-token>
```

不要把 token 写进文档、提交、日志摘要或聊天消息。直接打开裸地址可能返回 401 或进入未认证初始页。

### 6.5 修改后重启规则

- 修改 `dj-dsh.patch.yml`、DSH 插件或 DSH 环境：重启 DSH；
- 修改 DJ Python、DJ 环境文件或单用户环境变量：重启 DJ MCP；
- 启动器提示“Using the MCP process already listening”时，旧进程不会自动加载新 Python 或环境；
- 刷新浏览器不能替代后端重启。

## 7. 踩坑记录

### 7.1 “工具名像 MCP”不等于使用标准 MCP transport

旧 bridge 也把工具注册为 `mcp__dj__*`，但实际走 `/internal/operator-tools`。
判断 transport 必须查看插件配置和调用实现，不能只看工具名前缀。

### 7.2 只替换 YAML 会触发 `ACCOUNT_REQUIRED`

DJ 原逻辑检测到 `DSH_DJ_INTERNAL_TOKEN` 后，要求 `current_user`。
标准 MCP 工具函数不会自动从旧内部 HTTP header 建立该 ContextVar。
因此只把 URL 改为 `/mcp`，工具发现可能成功，但大多数工具调用会被拒绝。

本地 MVP 通过显式 `DJ_PLAN_FLOW_SINGLE_USER` 解决；多用户版本不能继续沿用这个绕过。

### 7.3 标准 Client 不会自动发送 DSH cwd

当前 `@deepseek-ai/dsh-mcp-client@0.2.0-rc.2` 没有把当前会话工作区作为 MCP Roots 或工具参数注入。
如果仍让模型填写 `workspace_root`，既容易出错也不应作为安全事实。

本地 MVP 由 DJ 服务端固定工作区。多用户版应改为受信任的 workspace ID/会话上下文映射。

### 7.4 标准 MCP 不等于旧审批体验

标准 `/mcp` 会直接暴露 `approve_plan` 和 `run_plan`。旧 bridge 的：

- `confirm_plan`
- 结构化用户确认
- 决策 outbox
- 幂等自动派发
- `get_workflow_status`
- Run 后台轮询和终态唤醒

不会由通用 MCP Client 自动恢复。

当前本地单用户流程只是：模型展示计划，用户在聊天中明确同意，然后模型调用 `approve_plan` 和 `run_plan`。
它适合功能 MVP，不是严格的人机审批门禁。

### 7.5 旧本地 UI 插件与 DSH 0.2 不兼容

以下包版本仍为 `0.1.0`，peerDependencies 只声明支持 DSH 0.1.x：

- `@dsh-dj/operator-library`
- `@dsh-dj/plan-explorer`
- `@dsh-dj/user-auth`
- `@dsh-dj/datasets`

DSH 0.2 会禁用它们并打印兼容性警告。因此不能再依赖 `dsh-user-auth` 的 `/auth/deployment` 判断本地 MVP 是否就绪。

不要直接使用版本豁免掩盖问题。要么升级并验证这些插件，要么在标准 MCP MVP 配置中明确移除。

### 7.6 Windows 命令行参数带引号

`Start-Process` 实际命令行类似：

```text
"node.exe" ".../bin.js" "web" "--port" "57536"
```

旧正则只匹配未加引号的 `web --port 57536`，导致已运行的正确进程被误判为陌生进程。
进程复用和端口检查必须兼容引号。

### 7.7 DSH 已启动，不等于裸 URL 返回 200

DSH stdout 已经打印启动 URL时，裸 `http://127.0.0.1:<port>/` 仍可能因缺少 token 不能代表已认证页面。
本地单用户启动就绪使用端口监听；真正打开页面使用 stdout 中的 token-bearing URL。

### 7.8 失效本地代理会伪装成模型故障

`proxyUrl=http://127.0.0.1:15236` 会被启动器写入 Node 代理环境。
DJ MCP 是 localhost，受 `NO_PROXY` 保护，所以 MCP 可以正常；远程模型却会经失效代理失败。

这会造成看似矛盾的现象：

```text
MCP tools/list 正常
模型请求 5 次重试后 Connection error / TRANSPORT
```

排障时应分别验证：本地 MCP、代理端口、模型 endpoint 直连，不要把三者混为一个健康检查。

### 7.9 端口监听不证明代码和环境是最新的

`8010` 有监听时，启动器会复用已有 DJ 进程。修改 Python 或环境变量后若不重启，该进程仍运行旧版本。
必须结合 PID、启动时间、命令行、health/build 信息和启动日志判断。

### 7.10 DSH 会话工作区与 DJ 固定工作区可能不一致

联调浏览器会话曾显示工作区 `D:/shishi`，但 DJ 单用户模式固定为 `D:/dsh-app`。
模型可以正确发现工具，但处理 `D:/shishi` 中的数据时会因工作区不一致失败或找错相对路径。

下一步必须明确选择一个统一工作区，或实现可信的 DSH session cwd 到 DJ workspace 映射。

### 7.11 凭证搜索可能造成明文泄露

排障过程中曾有一次宽范围文本搜索把凭证文件中的 API Key 打印到本地工具输出。
文档没有记录其值，但该密钥应轮换。

以后：

- 不对凭证文件做无过滤 `rg`/`Get-Content`；
- 只检查键是否存在，不输出值；
- HTTP 探针只输出状态码和错误类型；
- 日志和交接文档不得包含 token、API Key 或完整 Authorization header。

### 7.12 dirty worktree 不能整体回退

`D:/dsh-app` 在本次工作开始前已经有修改和未跟踪文件，包括 package/lock/workspace、patch、备份和分析制品。
`dj-dsh.patch.yml` 中 `web-fetch-http` 条目的删除也不是本次标准 MCP 工作中新增的决定。

不要执行：

```text
git reset --hard
git checkout -- .
```

应逐文件查看 diff，区分已有用户改动、本次改动和运行时制品。

## 8. 当前限制

1. **单用户绕过不是多用户方案。** `DJ_PLAN_FLOW_SINGLE_USER` 会关闭账号资源控制，不能用于公网或不可信用户。
2. **执行仍是 native。** DJ worker 是宿主机本地进程，不是每任务容器。
3. **DSH 通用 shell/filesystem 工具仍启用。** 登录本身不会带来文件系统隔离。
4. **审批门禁降级。** 当前 Agent 可以看到并调用 `approve_plan`；仅靠对话约定要求先获得用户同意。
5. **旧 UI 插件被禁用。** Plan Explorer、Operator Library、用户认证和结果中心没有完成 DSH 0.2 兼容验证。
6. **固定工作区只有一个。** 浏览器选择的其他工作区不会自动传递给 DJ。
7. **默认 Web 端口与联调端口不同。** 配置是 `57535`，联调曾使用 `57536`。
8. **Run 记录和冒烟输出是本地运行制品。** `.dj/`、`outputs/`、`.dsh/mcp-smoke/` 不应未经审查提交。

## 9. 后续建议顺序

### P0：收敛本地 MVP

1. 统一 DSH 会话工作区与 `DJ_PLAN_FLOW_WORKSPACE_ROOT`；
2. 决定默认使用 `57535` 还是正式改成其他端口；
3. 从 MVP patch 移除不兼容的四个旧 UI 插件，或升级并逐个验证；
4. 轮换诊断时暴露过的模型 API Key；
5. 增加可重复的标准 MCP 冒烟脚本，避免每次手写 Node `-e`；
6. 为启动器的带引号命令行识别和 token URL 恢复增加自动化测试 seam。

### P1：恢复产品级 Plan Flow 体验

选择以下一种方向，不要把两者混在一起：

1. 在标准 MCP Server/Client seam 上新增 DSH 宿主适配，恢复可信审批、会话 workspace、幂等 request ID、状态恢复和终态通知；或
2. 明确保留旧 bridge 作为 DSH 专用 Adapter，同时让 `/mcp` 服务其他标准客户端。

如果选择第一种，应优先解决：

- `approve_plan` 不直接暴露给 Agent；
- 用户确认必须产生不可伪造的决策引用；
- Run 派发必须幂等；
- 后台 Run 的状态和终态报告可以跨重启恢复。

### P2：多用户与部署

多用户版本应取消 `DJ_PLAN_FLOW_SINGLE_USER`，并引入：

- DSH 服务端认证得到的可信 `user_id`；
- DSH 到 DJ 的短期签名身份或等价认证；
- 每条 Session/Task/Run/Artifact 的 owner 校验；
- 服务端 workspace ID 到真实路径的映射；
- 每用户或每任务容器；
- 配额、日志、审计、Secret 隔离和网络策略。

## 10. 接手检查清单

```text
[ ] 分别查看两个仓库 git status，确认没有覆盖用户已有改动
[ ] web-dj.ps1 -CheckOnly 通过
[ ] 确认目标 Web/DJ 端口的 PID 和命令行
[ ] 确认 proxyUrl=null，或代理端口确实有预期进程监听
[ ] 确认 DJ 进程已加载 DJ_PLAN_FLOW_SINGLE_USER 和固定工作区
[ ] 标准 MCP tools/list 返回 15 个工具
[ ] get_plan_contract 返回 ok=true
[ ] inspect_input 返回的 workspace_root 是固定工作区
[ ] 用无副作用样本跑 prepare/approve/run/get_run
[ ] 浏览器模型请求成功，不再出现 TRANSPORT Connection error
[ ] 核对 DSH 当前会话工作区与 DJ 固定工作区是否一致
[ ] 不把 .credentials、内部 token、Web token 写入输出或提交
```

## 11. 与旧文档的关系

`docs/architecture/plan-flow-mcp-handoff-2026-09-17.zh-CN.md` 对旧 bridge、受控审批和 Plan Flow 内部实现的描述仍有参考价值，
但其中“DSH 当前实际走 `/internal/operator-tools`”已经不代表本地标准 MCP MVP 的当前接线。

阅读顺序建议：

1. 先读本文，理解当前标准 MCP MVP；
2. 再读旧 Plan Flow 接手文档，理解 bridge 曾承担的产品能力；
3. 最后按两个仓库的当前 diff 和运行进程核实现状。
