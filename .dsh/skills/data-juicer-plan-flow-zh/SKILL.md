---
name: data-juicer-plan-flow-zh
description: 在已有用户确认的 requirement_ready TaskSpec 后，使用 mcp__dj__ 从 search_capabilities 开始完成 Data-Juicer 能力匹配、方案确认、不可变 Plan、审批、执行、报告与故障恢复；也用于继续审查、运行或修复已有 task_id/plan_version。原始的目录筛选、分类、清洗或数据集构建需求应先使用 data-juicer-requirements-zh，不由本 Skill 直接澄清或检查输入。
user-invocable: true
---

# Data-Juicer 计划、审批与执行

只使用一个 DSH Agent。MCP 是能力、持久化和执行层，不是另一个 Agent。使用用户选择的工作区，并在每个工作区相关调用中传入绝对路径 `workspace_root`。

MCP 服务器没有独立业务工作区。源码目录和进程 cwd 只是实现细节，绝不能作为 `workspace_root`。不得要求用户把数据复制进 MCP 源码树，也不得通过文件工具读取环境变量文件。

## 接手门禁

新任务必须具备用户已确认的 `requirement_ready` TaskSpec，其中至少包含目标、输入 profile 与 dataset/manifest 路径、判断单位、输出、语义边界、约束和验收标准。若缺少该交接契约，调用 `skill` 工具加载 `data-juicer-requirements-zh`；该 Skill 已加载时按其流程继续。不得自行补齐需求后直接搜索能力。

继续审查、批准、运行或修复已有 `task_id + plan_version` 时，可以按现有 Plan 状态接手，不必重做需求阶段。

## 必经流程

1. 验证 `requirement_ready` 交接契约及输入 profile。输入路径发生变化、profile 缺失或明显过期时，回退前置 Skill 重新检查；正常情况下不得重复调用 `inspect_input`。
2. 从已确认的目标、判断单位、语义边界、输出和验收标准生成少量独立的原子能力需求，先归并共享同一实现的业务判断，再把当前 `requirement_ready` TaskSpec 版本的全部原子需求放进一次 `mcp__dj__search_capabilities` 批量调用；同时用 `resolve_capabilities` 查询已经批准的外部能力。自然语言需求应规范化为简短英文能力查询；plan-flow 只使用服务端 BM25，不要求或调用 regex。已知完整算子名时由服务端走精确名称快路径。正常检索每个 TaskSpec 版本最多一次。
3. `search_capabilities` 只用于发现算子，不返回也不得探测服务器凭证、base URL 或默认模型。运行配置由 MCP 保持私有；只有方案已经选中 API 算子并调用 `prepare_plan` 时，MCP 才按该算子的实际需要解析配置。严禁通过 DSH 文件工具读取或检查环境变量文件。
4. 能力探索可能暴露新的权限、成本、可行性或业务取舍。只对仍需用户决定且会实质改变 Pipeline 的新 Material Ambiguity 提问；不得重新打开已确认的需求，除非能力证据表明其不可实现。
5. `search_capabilities` 返回的是从 DJ 现有 `OPRecord/OPSearcher` 目录检索出的紧凑算子定义，并对跨需求重复算子去重；不得把候选数量误当成最终 Pipeline 的算子数量上限。对进入 shortlist 或准备写入 Recipe 的算子，按精确名称批量调用 `mcp__dj__get_capability_schemas` 加载完整结构化 schema。加载已有候选的 schema 不算再次检索，最终真实需要的算子可以超过 5 个。必须检查完整 schema 后才能认定算子适用，再形成内存中的候选方案：规范化 recipe、重要参数、必要 postprocess、风险、验收映射和能力 gap。确认前不得写脚本、修改工作区或调用 `prepare_plan`。
6. 向用户展示具体方案与验收映射，并请求 `确认并生成计划`、`修改方案` 或 `取消任务`。`ask_user_question` 可用时必须调用；不可用时使用简明文本。只有明确选择 `确认并生成计划` 才能继续。
7. 确认后，把 Data-Juicer 内置算子和已批准外部算子统一写入标准 `plan.recipe.process`，并在顶层写入精确 `capability_bindings`。第一次检索与已批准能力解析都无适用结果时，先明确记录能力 gap；只有存在可证明的召回异常时才允许一次定向纠错检索，不得换词循环搜索。
8. 对真实缺口按可复用的数据契约划分算子：先问“把当前业务对象换成同类输入（例如把 face mask 换成任意 mask），算法是否仍可原样工作”。若可以，业务对象不得进入能力名称。Agent 生成的算子必须遵循 DJ 基类、注册和 schema 规范，由结构化 Fetcher 获取固定 revision 的源码、wheel 或模型，再调用 `prepare_capability` 完成隔离构建与验证。不得用 shell 下载、不得把新算子直接写入 DJ 源码、不得接触业务输入。若多个缺口属于同一任务，可以放入一次 Capability Proposal。
9. `prepare_capability` 返回 `pending_approval` 后，展示所有 Operator Artifact、源码/依赖/模型 hash、许可证、验证结果、权限和资源约束，请求第一次明确的“批准能力”。只有该选择才能调用 `approve_capability`。内容变化、验证失败或批准 hash 不符时停止；已经 `available` 的相同能力自动复用，不重复审批和构建。
10. 调用 `mcp__dj__prepare_plan`。修改时复用 `task_id`，并把上一版 `plan_version` 作为 `base_plan_version`。每次调用都生成新的不可变 `plan_vNNN`，不得编辑旧版本。
11. 展示规范化 Plan、校验结果、Runtime 组合、版本 diff 和 `content_hash`，请求第二次明确的 `批准并执行`、`修改计划` 或 `取消任务`。能力审批绝不等于 Plan 审批；只有明确选择 `批准并执行` 才能调用 `mcp__dj__approve_plan`。
12. 明确批准后，用准确的 `task_id + plan_version + content_hash` 调用 `mcp__dj__approve_plan`，随后调用 `mcp__dj__run_plan`。正式运行只能经 Runtime Resolver 和 loopback Broker 进入断网 Docker；若返回 `BROKER_REQUIRED`，停止并报告部署配置问题，绝不得回退共享本机 Python 环境。
13. 轮询 `mcp__dj__get_run`。失败时先检查日志；只有安全的瞬时故障才能原样重试。若 recipe、脚本、路径或数据语义需要变化，必须创建新版本并重新确认。只有用户要求取消或继续不安全时才调用 `mcp__dj__cancel_run`。
14. 成功后返回 task id、plan version、run id、Runtime id、Dataset Snapshot hash、输出制品 manifest、实际执行 recipe 和报告路径。

`mcp__dj__preview_plan` 只提供不执行数据的预检摘要，不能代替校验或批准。

## 交互呈现契约

需要用户决策时，把“审查材料”和“决策控件”分开：

- 先在普通 assistant 回复中展示需求摘要、候选方案、能力证据、capability gap、Plan、diff、风险和验收映射等完整审查内容。
- 然后调用 `ask_user_question`；弹窗的 `question` 只写一句需要用户作出的决策，不得复制前述报告、Plan、证据列表或 Markdown 章节。
- 选项使用简短 label；`description` 最多用一句话说明该选择的直接影响或取舍。为精确绑定审批对象，可在问题中保留必需的 task id、plan version 或 `content_hash`。
- 若没有需要用户选择的事项，不调用 `ask_user_question`。

## Plan 约定

```yaml
user_intent: "..."
modality: text
risk_notes: []
acceptance_criteria: []
approval_required: true
recipe:
  dataset_path: "D:/workspace/input.jsonl"
  export_path: processed.jsonl
  process: []
  executor_type: default
  np: 4
postprocess: []
```

只使用能力检索实际返回的算子名和参数。脚本必须在 `prepare_plan` 前存在于工作区内，MCP 会把它快照进不可变计划包。不得在 plan、recipe、脚本参数、报告或工具调用中放入明文密钥。

使用 API 算子时省略 `api_key` 和 `base_url`。使用 API VLM 算子时设置 `is_api_model: true`，用户未指定模型时通常省略 `api_or_hf_model`；只有该算子已经进入 Recipe 后，`prepare_plan` 才会从服务器私有配置解析默认 VLM，并把解析后的非秘密模型名写入规范化 Plan。用户明确指定的模型可以覆盖默认值，但必须作为重要 Plan 参数展示。若所选算子缺少凭证、默认模型或其他运行配置，`prepare_plan.validation.errors` 会给出具体算子、缺少项、配置文件与重启提示；向用户原样说明并停止审批，绝不得读取密钥文件，也不得因为服务器可能配置了某种模型而倒推或改变算子选择。

## 工具范围

- 阶段回退：`skill`
- 检索能力：`search_capabilities`
- 加载候选完整定义：`get_capability_schemas`
- 外部能力供应链：`resolve_capabilities`、`prepare_capability`、`get_capability`、`approve_capability`
- 需求与方案确认：`ask_user_question`
- 版本管理：`prepare_plan`、`get_plan`
- 审查预览：`preview_plan`
- 批准门禁：`approve_plan`
- 执行与恢复：`run_plan`、`get_run`、`cancel_run`
