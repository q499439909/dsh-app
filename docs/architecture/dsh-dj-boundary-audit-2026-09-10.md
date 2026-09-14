# DSH ↔ DJ 边界审计（2026-09-10）

范围：`dsh-user-auth`、`dsh-dj-plan-explorer`、`dsh-dj-datasets`、`dj-dsh.patch.yml`；为核对端到端判断，追踪 DJ 的 gateway/service/store。只读生产源码，没有读取环境变量内容、token 或业务数据库，没有启动真实处理任务。现有 Node 测试 37/37 通过。下列“已证实”指代码路径证据；影响若依赖部署或攻击输入，单独注明。

## 当前架构

1. patch 加载本地 skill、PowerShell/文件工具、计划面板、认证、结果中心及 `dj-bridge`。[配置](D:/dsh-app/dj-dsh.patch.yml:1)
2. 配置虽然写 `streamable-http` 与 `/mcp`，实际 bridge 用 `new URL('/internal/operator-tools', config.url)`，从 DJ 发现工具定义，再由 DSH 自己注册 `mcp__dj__*` 并执行 HTTP JSON 转发；不是在这里运行标准 MCP transport 客户端。身份来自执行会话 owner，workspace 参数被替换为 session cwd。[bridge](D:/dsh-app/packages/dsh-user-auth/lib/dj-bridge.js:5)
3. DSH 对会话 API 和事件流施加 owner 检查；登录 principal 通过 request context 传递。会话权限已有工程实现，不能说全靠 skill。[会话边界](D:/dsh-app/packages/dsh-user-auth/lib/session-access.js:31)、[owner 检查](D:/dsh-app/packages/dsh-user-auth/lib/identity-access.js:317)
4. 计划 UI 从聊天 tool/result 解析 `prepare_plan`，通过只读 proxy 获取 plan-view 和 run-steps；结果中心从聊天历史发现 run 引用，再通过 DJ internal 输出网关建立自己的 SQLite 投影。[计划投影](D:/dsh-app/packages/dsh-dj-plan-explorer/lib/client.js:69)、[结果对账](D:/dsh-app/packages/dsh-dj-datasets/lib/index.js:81)

## 发现与修改

### P0：审批 hash 被检查，但“真实用户同意”没有成为执行凭据（已证实）

UI 点击按钮只是发送自然语言 `批准并执行方案 ... content_hash=...` 给模型。[client.js:176](D:/dsh-app/packages/dsh-dj-plan-explorer/lib/client.js:176) bridge 无分类地注册全部发现工具，[dj-bridge.js:23](D:/dsh-app/packages/dsh-user-auth/lib/dj-bridge.js:23) 而 DJ 工具列表包括 `approve_plan`。[server.py:234](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/server.py:234)

审批服务只检查个人算子授权，再调用 store；store 验证 bundle/hash/validation，记录版本、hash、时间和 note，没有 actor、session、用户确认事件或 receipt。[service.py:251](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/service.py:251)、[store.py:262](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/store.py:262) 因此正常 UI 能表达确认，但相同能力也直接暴露给 Agent，代码不能区分真实点击与模型自主审批。现有 hash 保护应保留，不能把缺少 receipt 误写为“没有审批机制”。

修改：Agent 调 `request_plan_approval` 生成 pending action；受认证 UI POST 接受准确 plan/hash；DSH 后端签发/登记 approval receipt，DJ 验证其 task、version、hash、workspace、actor、用途和有效期。Agent 可查询批准状态，不能自行创建有效批准。对话文字批准若继续支持，也须由宿主将真实用户消息转成受信事件并绑定待审批项。run 接口强制 receipt/approval 检查，重复点击有幂等键。

### P0：会话归属不是 workspace / Plan / Run 权限（已证实缺少此层，跨用户实际利用未执行）

bridge 可靠替换 workspace 参数，但 session create 这里只验证会话 owner，没有 workspace ACL。[session-access.js:58](D:/dsh-app/packages/dsh-user-auth/lib/session-access.js:58) plan-view proxy 原样转发浏览器 query，只加入当前 user header。[plan-explorer/index.js:41](D:/dsh-app/packages/dsh-dj-plan-explorer/lib/index.js:41) DJ `_authorize_personal_plan` 仅在存在 `operator_bindings` 时校验 `operator_owner`，不涵盖普通内置算子 Plan 的任务归属。[service.py:354](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/service.py:354)

结论限定：不能把 session cwd 视为经授权的 workspace。所审路径没有一般 Plan/Run owner 校验；是否存在其他部署级隔离须进一步核实。不要仅靠 UI 隐藏路径。

修改：建立服务端 workspace registry 与 membership；会话绑定 workspace_id；DJ Task/Plan/Run 存 owner/workspace_id。每个读写入口使用同一授权函数。路径由后端 ID 解析，不接受浏览器路径作为权限事实。个人算子权限单独保留，不能替代任务权限。

### P0/P1：结果归属从聊天内容推导，缺少权威 Run owner 校验（代码已证实，伪造认领为待验证风险）

`discoverRunOrigins` 对整个 history 递归解析对象和 JSON 字符串，未限定可信 tool/result 来源；`registerRunResult` 检查访问 session 后将该 session owner 当结果 owner。[index.js:46](D:/dsh-app/packages/dsh-dj-datasets/lib/index.js:46)、[dataset-catalog.js:126](D:/dsh-app/packages/dsh-dj-datasets/lib/dataset-catalog.js:126) 输出适配器只传 internal token，不传 user；DJ internal asset 路由只验 internal token。[run-output-http.js:29](D:/dsh-app/packages/dsh-dj-datasets/lib/run-output-http.js:29)、[server.py:337](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/server.py:337)

拥有某会话不应成为认领任意已知 origin 的依据。风险是已知另一运行引用的内容进入自己的 history 后，可触发错误归属；未向真实系统尝试此行为。

修改：Run 完成事件包含 DJ 权威 owner/workspace/task/run ID；结果投影按服务端授权 Run 查询建立，origin 不从任意聊天 JSON 获得。历史迁移仅从严格 tool/result provenance 提取候选，仍需 DJ owner 校验。internal token 表示服务身份，不替代最终用户授权。

### P1：结果刷新依赖一次性历史扫描，新 Run 会漏投影（已证实）

`ensureReconciled()` 永久复用首次成功 Promise，只有失败才清空；随后完成的新 Run 卡片仍匹配旧结果。[client.js:44](D:/dsh-app/packages/dsh-dj-datasets/lib/client.js:44) 对账最多列 200 个会话、逐个顺序获取 history，无分页；任何一个注册异常会终止整次对账。[index.js:81](D:/dsh-app/packages/dsh-dj-datasets/lib/index.js:81) 认证层又在底层返回 page 后按 owner 过滤，分页可能被其他用户条目占满。[session-access.js:42](D:/dsh-app/packages/dsh-user-auth/lib/session-access.js:42)

修改：短期按 run ID 对账、终态事件失效缓存、分页、逐项错误隔离。长期订阅 Run terminal/outbox 事件，使用唯一 run ID 幂等 upsert；history reconcile 仅做迁移/修复。列表在存储查询前限制 owner，而不是分页后过滤。

### P1：计划进度和结果卡片有两个不同的状态源（已证实）

plan 面板仅在挂载且已知 run 时轮询，轮询结果只更新局部 state 与内存 runs map；结果卡片依赖聊天 `run_plan/get_run` 结果，没有订阅该 map 或 terminal 事件。[plan client.js:138](D:/dsh-app/packages/dsh-dj-plan-explorer/lib/client.js:138)、[result client.js:35](D:/dsh-app/packages/dsh-dj-datasets/lib/client.js:35) 结果卡片把 `preparing_models` 当 terminal（只排除 starting/running），与计划面板枚举不一致。[result client.js:49](D:/dsh-app/packages/dsh-dj-datasets/lib/client.js:49) plan polling 遇到 JSON `ok:false` 直接 return，不重试也不呈现错误。[plan client.js:138](D:/dsh-app/packages/dsh-dj-plan-explorer/lib/client.js:138)

修改：共享 typed Run 状态契约和单一 session/task 数据源；服务推送或持久游标轮询独立于面板生命周期。断线显示 stale/reconnecting，终态刷新 result projection。不能要求模型持续 get_run 才使 UI 正确。

### P2：现有结果记录不会更新；partial 与 available 可能长期过期（已证实控制流，触发依赖输出变化）

`registerRunResult` 看到已有 origin 就返回，不重新 inspect；存储支持 partial，但没有此路径的更新逻辑。[dataset-catalog.js:145](D:/dsh-app/packages/dsh-dj-datasets/lib/dataset-catalog.js:145) 如果首次投影不完整，后续补齐无法自然修正。

修改：按 manifest revision/hash 幂等 upsert；明确 Run 完成后输出是否不可变。若不可变，修复需新 artifact revision；删除 tombstone 防止对账复活。

### P2：配置与实际协议含义不一致（已证实）

patch 声明 `serverName/transport/failOnStartupError`，bridge 没读取这些配置，实际 absolute internal route 忽略 `/mcp` path。[patch:51](D:/dsh-app/dj-dsh.patch.yml:51)、[bridge:13](D:/dsh-app/packages/dsh-user-auth/lib/dj-bridge.js:13) 容易误判排障范围和 MCP 中间件是否生效。

修改：明确命名 authenticated DJ tool gateway；保留 MCP 对外协议时统一工具 catalog/validation/auth 适配器，避免两条执行语义。删除无效配置或实现并测试其契约。不要仅为“标准化”重写已能工作的桥接。

## 实施顺序与验收

1. 先实现真实审批凭据、workspace/task/run 授权，保留当前 hash 锁。测试：模型直接 approve 被拒绝；A 用户不能读/运行/认领 B 的内置算子任务；旧版本批准不能执行新版本；重复批准/启动只产生一次预期操作。
2. 修结果刷新、共享状态枚举和终态事件。测试：同一页面连续运行两次都出现结果；preparing_models 展示运行中；面板关闭仍更新结果；短暂错误后恢复。
3. Run 事件驱动投影替代全会话扫描。测试：超过 200 会话仍不丢结果；单条坏 origin 不阻塞其他结果；重放幂等；伪造普通聊天 JSON 不认领结果。
4. 最后精简 skill 为决策与路由；权限、审批、幂等和 UI 进度不由提示词保证。

## 本次验证

执行：`node --test packages/dsh-user-auth/test/*.test.mjs packages/dsh-dj-plan-explorer/test/*.test.mjs packages/dsh-dj-datasets/test/*.test.mjs`，37 passed / 0 failed。测试覆盖当前 owner/session 边界、bridge cwd 替换、解析、结果 ACL 和 HTTP 适配器。没有覆盖以上真实确认凭据、跨 workspace 授权、连续运行刷新和伪造 history origin 场景，因此测试通过不能反证这些缺口。无生产代码改动。

## 附录：P0/P1 最小接口落地（继续源码核对）

### 可信审批 HTTP 接入

现有注册形态为 `ctx.effect(() => ctx.webServer.register({kind:'exact', path, handler}), label)`；`/api` 全局 request guard 调 `identity.enterRequest(req)`，handler 可取 `identity.currentPrincipal()`。[index.js:69](D:/dsh-app/packages/dsh-user-auth/lib/index.js:69)、[index.js:101](D:/dsh-app/packages/dsh-user-auth/lib/index.js:101) 独立新路由仍应显式检查 principal，避免测试宿主或未来 guard 改动使其失效。

当前 CSRF 辅助只在存在 Origin 时比较 URL.host，允许缺 Origin；cookie 是 HttpOnly/SameSite=Lax，Secure 由配置控制。[index.js:43](D:/dsh-app/packages/dsh-user-auth/lib/index.js:43)、[identity-access.js:372](D:/dsh-app/packages/dsh-user-auth/lib/identity-access.js:372) 新 approval POST 建议只服务浏览器：要求 JSON、要求精确受信 Origin（包含协议，配置 publicOrigin；反代不可无条件信任 forwarded header）、不开放 CORS，必要时增加 session-bound CSRF nonce。不要照搬“无 Origin 直接放行”。服务内部提交走单独 internal route。

建议最小前端请求，不传 actor 或任意文件路径：

```js
fetch('/api/dj/plan-approvals', {
  method: 'POST', credentials: 'same-origin',
  headers: {'content-type':'application/json'},
  body: JSON.stringify({
    sessionId, taskId, planVersion, contentHash,
    decision: 'approve', requestId: pendingApprovalRequestId
  })
})
```

`requestId` 由服务为待确认对象创建，重复点击复用；不能随每次重试生成。前端展示的 `contentHash` 是防陈旧比较值，不被当权威计划内容。响应 `{ok:true, approval:{approvalId,taskId,planVersion,contentHash,status:'approved'}}`；凭据本体留在服务端。若另需自动执行，后端建 start operation，返回 operationId；或者 UI 成功后仅通知 Agent 查询状态，切勿重新让 Agent 执行“代批”。

下面为拟议接口伪码，`approvalStore/workspaceAccess/dj` 是应新增窄服务，非现成 API：

```js
ctx.webServer.register({kind:'exact', path:'/api/dj/plan-approvals',
  async handler(req,res) {
    requirePostJsonAndTrustedOrigin(req);
    const actor = identity.authenticateRequest(req);
    if (!actor) return unauthorized(res);
    const body = await readBoundedJson(req);
    if (!identity.canAccessSession(actor, body.sessionId)) return forbidden(res);
    const pending = await approvalStore.get(body.requestId);
    assertPendingMatches(pending, body); // session/task/version/hash/action
    const workspace = await workspaceAccess.forSession(actor, body.sessionId);
    assertEqual(workspace.id, pending.workspaceId);
    const plan = await dj.getPlan({actor,workspace,taskId:body.taskId,version:body.planVersion});
    assertEqual(plan.contentHash, body.contentHash);
    const result = await approvalStore.commitAndForwardIdempotently({actor,pending,plan});
    sendJson(res,200,{ok:true,approval:result.publicApproval});
  }
});
```

HTTP success 只有 DJ 已接受后返回 approved；跨 DSH/DJ 边界用 pending/committed 或 outbox 持久化，转发超时后按 requestId 查询，不能虚报失败然后重复批准/执行。最小方案也可让 DJ 作审批唯一存储，DSH 用 authenticated UI 专用 internal endpoint 转发且传幂等 requestId，避免造两套审批真相。普通 Agent tool gateway 不得接受此 UI-only 能力。

### bridge 的稳定调用标识

已安装 `@deepseek-ai/dsh-tools` 类型中 `ToolExecutionInput.callId` 是必填，`ToolExecution.rootCallId` 必填，`ToolRunContext` 继承它；`token` 是 registry-owned opaque identity，不可作为持久串。[类型:195](D:/dsh-app/node_modules/.pnpm/@deepseek-ai+dsh-tools@0.1._7117760508de0db46d4e3da5e4a645e6/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts:195)、[类型:260](D:/dsh-app/node_modules/.pnpm/@deepseek-ai+dsh-tools@0.1._7117760508de0db46d4e3da5e4a645e6/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts:260) Code dispatch 子调用注释约定 `<parent>:code:<n>`。[类型:244](D:/dsh-app/node_modules/.pnpm/@deepseek-ai+dsh-tools@0.1._7117760508de0db46d4e3da5e4a645e6/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts:244)

因此 bridge 应从 `exec.callId` 与真实 sessionId 派生 dispatch key，作为 server-only header/envelope 传 DJ；不要从模型 args 接受 call identity。`rootCallId` 用于归因，不能独自作为子调用幂等键，否则同一 code block 多个合法调用被合并。调用键防同一 dispatch 的传输重试，不防模型产生新的 callId 再次调用；长任务仍需显式 operation/request ID，且“再跑一次”需要创建新 operation。仅用 plan hash 去重会错误禁止合法重跑。

### workspace 迁移能信任什么

安装版 Host API 已有 `apiProxy.workspace`，workspace.list 返回 `workspaceId/path/sessionIds`；session summary 的 cwd 是服务读取 header.cwd 的 passthrough。[workspace schema:9](D:/dsh-app/node_modules/.pnpm/@deepseek-ai+dsh-host-apipr_454f1d4c6ff220b02d53b64462227ddc/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api/workspace.schema.d.ts:9)、[session summary:201](D:/dsh-app/node_modules/.pnpm/@deepseek-ai+dsh-host-apipr_454f1d4c6ff220b02d53b64462227ddc/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api/sessions.d.ts:201) session.create 允许 workspaceId 或 cwd，未指定时用 Host cwd。[session API:249](D:/dsh-app/node_modules/.pnpm/@deepseek-ai+dsh-host-apipr_454f1d4c6ff220b02d53b64462227ddc/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api/sessions.d.ts:249)

可信“关联事实”可从服务端 workspace registry、session summary/header 和 identity.sessionOwner 交叉建立；客户端 workspace_root、聊天 JSON、目录存在都不可作归属事实。但历史关联不等于独占所有权：同一 workspace 可能有多个 owner 的会话，且此前 create 允许任意 cwd。迁移应先产候选清单：单 owner 且在管理员授权 roots 内的可由明确迁移策略赋权；多 owner 标共享候选或待处理；缺 owner 不自动认领；历史无授权依据的敏感根目录不得因会话曾引用就开放。不要按首个访问者授予 workspace owner。

最小新授权表可为 `workspace_members(workspace_id,user_id,role,source)` 和 `session_workspaces(session_id,workspace_id)`；Task/Run owner 应从可信创建操作写入。`installSessionAccess` 当前未包裹 `apiProxy.workspace.*`，因此增加 membership 时必须覆盖 workspace list/create/rename/delete/session attach，以及 session.create 的 cwd/workspaceId，不能仅在 DJ bridge 入口判断。服务端 registry 能证明“已登记”，不能自动证明当前用户有权限。

以上接口是源码约束下的实现建议，未向运行服务发请求，未读取真实 workspace registry 或身份数据库；路径迁移需管理员提供策略与实际登记状态，不能根据静态代码猜测现存 workspace 的主人。
