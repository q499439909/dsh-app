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
2. 从已确认的目标、判断单位、语义边界、输出和验收标准生成少量独立的原子能力需求，先归并共享同一实现的业务判断，再把当前 `requirement_ready` TaskSpec 版本的全部原子需求放进一次 `mcp__dj__search_capabilities` 批量调用。自然语言需求应规范化为简短英文能力查询；plan-flow 只使用服务端 BM25，不要求或调用 regex。已知完整算子名时由服务端走精确名称快路径。正常检索每个 TaskSpec 版本最多一次。
3. 只使用返回的 `runtime` 判断服务器配置。严禁通过 DSH 文件工具读取或检查环境变量文件，也不得按模型名字符串猜测模态或自行替换服务器默认模型。
4. 能力探索可能暴露新的权限、成本、可行性或业务取舍。只对仍需用户决定且会实质改变 Pipeline 的新 Material Ambiguity 提问；不得重新打开已确认的需求，除非能力证据表明其不可实现。
5. `search_capabilities` 返回的是从 DJ 现有 `OPRecord/OPSearcher` 目录检索出的紧凑算子定义，并对跨需求重复算子去重；不得把候选数量误当成最终 Pipeline 的算子数量上限。对进入 shortlist 或准备写入 Recipe 的算子，按精确名称批量调用 `mcp__dj__get_capability_schemas` 加载完整结构化 schema。加载已有候选的 schema 不算再次检索，最终真实需要的算子可以超过 5 个。必须检查完整 schema 后才能认定算子适用，再形成内存中的候选方案：规范化 recipe、重要参数、必要 postprocess、风险、验收映射和能力 gap。确认前不得写脚本、修改工作区或调用 `prepare_plan`。
6. 向用户展示具体方案与验收映射，并请求 `确认并生成计划`、`修改方案` 或 `取消任务`。`ask_user_question` 可用时必须调用；不可用时使用简明文本。只有明确选择 `确认并生成计划` 才能继续。
7. 确认后，把 Data-Juicer 已覆盖的步骤写入 `plan.recipe.process`。第一次批量检索的候选经完整 schema 验证后都不适用，不自动等于召回异常；先明确记录能力 gap。只有用户修改需求形成新的 TaskSpec 版本，或存在可证明的召回异常时，才允许一次定向纠错检索；同一版本纠错最多一次，不得换词循环搜索。仍无合适算子时，才在顶层 `plan.postprocess` 提议通用 Python 制品；不得把 postprocess 写进 recipe。需要脚本时此时才创建，并在 `prepare_plan` 前完成语法检查。
8. 调用 `mcp__dj__prepare_plan`。修改时复用 `task_id`，并把上一版 `plan_version` 作为 `base_plan_version`。每次调用都生成新的不可变 `plan_vNNN`，不得编辑旧版本。
9. 展示规范化 Plan、校验结果、版本 diff 和 `content_hash`，请求 `批准并执行`、`修改计划` 或 `取消任务`。只有明确选择 `批准并执行` 才能调用 `mcp__dj__approve_plan`；一般附和不算批准，修改后的新版本必须再次审查。
10. 明确批准后，用准确的 `task_id + plan_version + content_hash` 调用 `mcp__dj__approve_plan`，随后调用 `mcp__dj__run_plan`。
11. 轮询 `mcp__dj__get_run`。失败时先检查日志；只有安全的瞬时故障才能原样重试。若 recipe、脚本、路径或数据语义需要变化，必须创建新版本并重新确认。只有用户要求取消或继续不安全时才调用 `mcp__dj__cancel_run`。
12. 成功后返回 task id、plan version、run id、输出目录、实际执行 recipe 和报告路径。

`mcp__dj__preview_plan` 只提供不执行数据的预检摘要，不能代替校验或批准。

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

使用 API 算子时省略 `api_key` 和 `base_url`。使用 API VLM 算子时设置 `is_api_model: true`，通常省略 `api_or_hf_model`；`prepare_plan` 会采用 `runtime.default_models.vlm` 声明的服务器默认模型。用户明确指定的模型可以覆盖默认值，但必须作为重要 Plan 参数展示。运行配置缺失时只报告缺失能力并让用户重新配置、重启 MCP，不得检查密钥文件。

## 工具范围

- 阶段回退：`skill`
- 检索能力：`search_capabilities`
- 加载候选完整定义：`get_capability_schemas`
- 需求与方案确认：`ask_user_question`
- 版本管理：`prepare_plan`、`get_plan`
- 审查预览：`preview_plan`
- 批准门禁：`approve_plan`
- 执行与恢复：`run_plan`、`get_run`、`cancel_run`
