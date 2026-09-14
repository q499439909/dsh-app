# DataJuicer 对话式处理 Agent：框架选型补充调研

调研日期：2026-09-12。范围：官方主文档和源码仓库；本笔记不声称已对三个方案实测。具体 DSH 改造优先级须结合本地代码审计；这里的选型排序属于工程判断。

## 结论

结合主任务代码审计传回的条件——现有应用为 Node、已有持久 PlanWorkflow、当前工具通路是内部 HTTP 网关——建议以 **Pi SDK + 薄 DJ 应用层** 作为替代核心的首选验证方案。保留已有 DJ 工具、作业执行和工作流资产，补齐终态汇报、业务检查与用户输入事件；不用从零写模型循环，也不用整套改成 Python/Deep Agents。Pi 不内置 MCP 在这里不是决定性缺点，可把现有 HTTP 客户端包装成 customTools；对外需要通用 MCP 时再做适配。

若现有循环容易修复，短期保留 DSH 并修断点仍可能迁移最少；若未来主服务迁到 Python 且频繁编写复杂算子，Deep Agents 才更有吸引力。以上依赖主任务代码审计，本笔记未重复检查那些文件。

这不是性能排名：没有在用户的数据、模型和工具集上跑评测，不能断言哪个成功率最高。

## 核实的事实

### Pi

- 旧地址 `badlogic/pi-mono` 本次访问重定向到 `earendil-works/pi`。官方把 Pi 定义为最小终端编码 harness，提供交互、print/JSON、RPC、SDK 四种模式；默认有文件读写编辑和 shell 工具。文档明确不内置 MCP、子代理、计划模式、后台 bash，相关能力通过扩展或外部执行方式补充。支持多模型提供方和兼容 API 的自定义提供方。[官方 README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md)
- SDK 可提供 `customTools`、选择启用工具、加载技能；会话负责历史、压缩、事件流、取消、steer/followUp。工具开始/更新/结束事件可以映射成产品进度卡。会话持久化与真正后台作业恢复不是同一件事。[SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- 非 Node 应用可走 stdin/stdout JSONL RPC。若自建 Web UI，仍需自己的进程管理、事件转发和业务状态展示。[RPC 协议](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)

### Deep Agents / LangGraph

- Deep Agents 是建立在 LangChain、LangGraph 上的 SDK；提供计划、文件系统、上下文压缩、子代理和技能等能力。官方自己建议较简单任务考虑 `create_agent` 或自定义 LangGraph 工作流。[概览](https://docs.langchain.com/oss/python/deepagents/overview)
- `create_agent` 已提供“模型 → 工具 → 模型”的循环；可组合 middleware 和确定性图节点，因此不需要为普通数据工具调用直接引入完整 Deep Agents。[Agent 循环](https://docs.langchain.com/oss/python/langchain/agents)、[middleware](https://docs.langchain.com/oss/python/langchain/middleware/overview)
- Deep Agents 能用支持 tool calling 的 LangChain chat model，provider 字符串和预配置 model 实例都可用。工具调用兼容不等于业务成功率；官方也指出基础评测不足以证明复杂长任务效果。[模型文档](https://docs.langchain.com/oss/python/deepagents/models)
- 默认文件系统保存在 graph state；需要真实写入运行环境时必须配置适当 backend。FilesystemBackend、StoreBackend 和 sandbox 有不同职责，shell 执行由 sandbox 或 LocalShellBackend 提供。[Backends](https://docs.langchain.com/oss/python/deepagents/backends)
- LangGraph 的 `interrupt()` 可暂停等待用户信息，通过同一 `thread_id` 和 `Command(resume=...)` 恢复；生产需要持久 checkpointer。恢复会从被中断节点开头重跑，因此中断之前的副作用必须幂等或隔离。[Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)
- 本次最新 MCP 文档使用 `langchain.mcp.MCPAdapter`，适配工具后可交给 agent；支持 HTTP、stdio、内存 FastMCP 等。此 namespace 文档标为 beta。旧 `langchain-mcp-adapters` 仓库明确宣布不再积极维护，要求迁移。实施应锁定验证过的依赖，不能混抄不同代接口。[当前 MCP 文档](https://docs.langchain.com/oss/python/langchain/mcp)、[旧适配器声明](https://github.com/langchain-ai/langchain-mcp-adapters)

## 对本任务的工程判断

| 方案 | 真正省掉的工作 | 仍必须自行实现 | 适用判断 |
| --- | --- | --- | --- |
| 修 DSH + 薄领域层 | UI、已有集成、已有会话资产 | 工具循环问题、领域门槛、运行状态与证据 | 现有核心可修时优先 |
| `create_agent` / LangGraph | 标准循环、持久状态、暂停恢复、流输出 | DJ 领域工具和可靠作业执行 | Python 服务端的优先替代核心 |
| Deep Agents | 上述加文件编辑、压缩、技能、可配置编码环境 | DJ 编排正确性、算子测试、作业队列、UI | 自定义算子是常用能力时更划算 |
| Pi SDK / RPC | 轻量编码循环、技能、会话、编码交互 | 领域流程、后台作业、产品 UI；若需要则 MCP 适配 | 当前 Node/TS 与既有 worker 条件下首选验证 |
| 从零通用 Agent | 自由度 | 协议、上下文、取消、恢复、事件、兼容性全部维护 | 不建议；只自写领域层 |

“轻量”要看总交付成本。少几个框架依赖但补写 MCP、持久化和恢复不一定更精简；同样，单 Agent 能做的清洗任务不必默认拆成多 Agent。

## Pi SDK 嵌入的具体边界

1. **模型网关兼容先验收**。Pi 自定义模型支持 Chat Completions、Responses、Anthropic Messages、Google API 等协议。OpenAI-compatible 不是完整兼容保证；文档明确有 `supportsDeveloperRole`、`supportsReasoningEffort` 等配置。用当前用户真实网关验证串行工具调用、错误工具结果、流式参数、取消、压缩和长上下文。不能只以聊天能返回判定接入完成。[自定义模型](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md)
2. **提问/审批是宿主桥接责任**。SDK 的工具执行函数可以调用自己的用户输入服务；产品应保存 question_id、run_id、待回答状态，回复后恢复。Pi RPC 已定义 select/confirm/input/editor 的请求应答子协议；超时会返回默认值，TUI 专有 UI 在 RPC 下可能不可用。不能假设安装 Pi 后现有 DSH 审批回调自动生效。[RPC 用户交互](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
3. **SDK 生命周期要显式接线**。切换/恢复会话会替换 session，需要重新订阅事件，并在使用扩展时重新绑定 extensions；streaming 中的新消息须选择 steer 或 followUp。[SDK 生命周期](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
4. **会话与 DJ 作业分开**。Pi 负责模型循环，已有 PlanWorkflow/worker 负责数据处理。设计 terminal outbox，作业完成后可靠投递给对应会话并生成报告；Pi 进程重启后可从 outbox 补送。避免拿 JSONL 会话记录冒充作业恢复系统。此项为架构建议。
5. **工具与配置隔离**。将正常数据任务限制为 DJ 工具；仅进入自定义算子阶段才开放隔离的代码读写/执行能力。为应用设置独立 agentDir、会话目录、ResourceLoader 和提供方配置，避免意外读取用户全局编码扩展；具体限制用 SDK 能力和执行层实现，不靠 Skill。此项为架构建议。

## 与框架无关的最小可靠闭环（建议）

1. **需求及数据画像**：先检查输入可访问性、字段和样本。仅在字段含义、目标标准、输出要求存在会改变结果的歧义时追问；把答案写入 TaskSpec，避免反复问。
2. **检索并落到可执行计划**：按语义找候选算子，再读取权威参数 schema、依赖和示例，生成结构化 PipelineSpec。不要让模型靠记忆拼参数，也不要一次给它全部算子定义。
3. **验证与试跑**：验证字段、参数类型、算子顺序、依赖；小样本试跑返回 before/after、过滤比例和失败原因。校验通过才能提交全量。
4. **补能力**：仅确认内置算子及组合无法覆盖后，进入隔离工作目录写自定义算子。编译、注册、单元样例、异常输入和试跑通过后，生成版本化算子产物；成功依据是测试和处理结果，不能只是写出代码。
5. **后台执行**：提交工具迅速返回 run_id。worker 跑 DJ，独立持久化进度、日志、产物；状态工具/事件驱动 Agent 完成汇报。页面关闭或模型请求超时不应使作业消失。提交带幂等键，重试不创建重复全量任务。
6. **基于证据汇报**：机器记录输入/输出量、算子与参数、输入版本、过滤样例、失败记录和产物地址；模型只解释这些事实。零产物或运行失败不能进入完成态。

建议工具面保持约 8–12 个领域动作，而不是把每个 DJ 算子包装为独立 MCP 工具。一个可行起点是 inspect_data、search_operators、get_operator、validate_pipeline、preview_pipeline、submit_run、get_run、get_report；自定义算子工作区与测试按需要补入。

约束要落在 validate/submit/register 等服务端检查及状态转换中，Skill 用来教策略与示例。无论 Pi 还是 Deep Agents，都不能把文字约束自动变为强制业务不变量。

## 如何决策，避免再换一次外壳

固定同一模型、同一工具和同一输入，先用 10 个真实小任务对比现有 DSH、一个薄循环原型，以及有必要时 Deep Agents/Pi 中的一种。覆盖：清晰需求、模糊需求、跨算子组合、非法参数、缺失依赖、自定义算子、执行中断、断线重连、重复提交、失败汇报。

记录端到端成功率、人工介入次数、不必要追问、错误后恢复、重复运行、总耗时和 token。先通过输入到产物的闭环，再决定是否迁移 UI。只做文字对比不能证明“丝滑”，这一组用例才是选择和后续回归的依据。
