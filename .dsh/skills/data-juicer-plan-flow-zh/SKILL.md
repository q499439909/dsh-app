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
2. 从已确认的目标、判断单位、语义边界、输出和验收标准生成少量独立的原子能力需求，先归并共享同一实现的业务判断，再把当前 `requirement_ready` TaskSpec 版本的全部原子需求放进一次 `mcp__dj__search_capabilities` 初始批量调用；该接口同时查询 DJ 和当前账号的个人 catalog，每条需求最多返回 Top 3。自然语言需求应规范化为简短英文能力查询；plan-flow 只使用服务端 BM25，不要求或调用 regex。已知完整算子名时由服务端走精确名称快路径。每个 TaskSpec 版本只允许一次初始批量检索，不得无目的换词重复检索；第 5 步规定的未覆盖原子需求复检不属于重复正常检索。
3. `search_capabilities` 只用于发现算子，不返回也不得探测服务器凭证、base URL 或默认模型。运行配置由 MCP 保持私有；只有方案已经选中 API 算子并调用 `prepare_plan` 时，MCP 才按该算子的实际需要解析配置。严禁通过 DSH 文件工具读取或检查环境变量文件。
4. 能力探索可能暴露新的权限、成本、可行性或业务取舍。只对仍需用户决定且会实质改变 Pipeline 的新 Material Ambiguity 提问；不得重新打开已确认的需求，除非能力证据表明其不可实现。若要重新打开，必须展示与哪条已确认验收标准冲突的 schema 或运行约束；不得仅凭更严格的可能解释、输出目录偏好或内部自审重新提问。
5. `search_capabilities` 返回候选的名称、类型、标签、完整 description、匹配分、命中的原子需求和身份字段，并对跨需求重复算子去重；它不返回 signature 或参数 schema。必须先检查每条原子需求返回的全部 Top 3 description，再按最小充分原则选择 shortlist：高分且明确完整覆盖时取 Top 1；候选分别覆盖不同部分、匹配分接近、description 无法证明完整覆盖或存在语义歧义时取 Top 2–3。不得为了省略判断而固定只取 Top 1，也不得在没有选择依据时机械加载全部 Top 3。若 Top 3 均不能完整覆盖，且原查询包含多个行为、指标或输出，必须重新拆成更窄的 Atomic Requirements，仅对未覆盖需求强制调用一次 `search_capabilities` 复检；复检仍缺失后才能认定 capability gap。仅对进入 shortlist 或准备写入 Recipe 的算子，按候选 `candidate_id`（旧 DJ 名称也兼容）一次批量调用 `mcp__dj__get_capability_schemas` 加载结构化参数契约；该响应不重复 description 和 tags。加载已有候选的 schema 不算再次检索，最终真实需要的算子可以超过 3 个。必须检查完整 schema 后才能认定算子适用，再形成内存中的候选方案：规范化 recipe、重要参数、必要 postprocess、风险、验收映射和能力 gap。确认前不得写脚本、修改工作区或调用 `prepare_plan`。当已加载的结构化 schema 足以支持所有验收标准，且没有新的 Material Ambiguity 或 capability gap 时，必须立即进入第 6 步；不得继续换词检索、重复加载 schema，或通过内部自审延迟给出方案。
6. 向用户展示具体方案与验收映射，并请求 `确认并生成计划`、`修改方案` 或 `取消任务`。`ask_user_question` 可用时必须调用；不可用时使用简明文本。只有明确选择 `确认并生成计划` 才能继续。
7. 确认后，把内置和当前用户算子统一写入标准 `plan.recipe.process`；个人算子在顶层 `operator_bindings` 中绑定 `step_index`、`provider: user`、`operator_id`、`version`。不传 userId、源码路径或自报 external_operator_names。DJ 不需要个人绑定。
8. 完成第 5 步的缺口复检后仍没有合适候选，或已有比较证据证明 DJ 算子效果不足时，才记录缺口并进入自定义算子流程；复检完成前禁止调用 authoring spec。生成源码前必须按算子 `category` 和 `modality` 调用一次 `get_custom_operator_authoring_spec`，从其 `source_scaffold` 开始实现，并严格遵守返回的当前 DJ 版本、基类、注册方式、required_methods、forbidden_overrides 和 `model_policy`；不得凭记忆猜接口。只选择一种模型策略：`none`、`api_vlm`、`remote_model` 或 `local_model`。优先复用匹配的 DJ 算子，其次使用能满足验收契约的轻量确定性实现。远程模型必须在 `model_refs` 声明不可变的 `model_id + commit revision`，源码加载同一 revision；本地模型声明已存在的绝对文件路径；额外 Python 包必须使用精确 `name==version`。API VLM 只使用后端私有配置，不得写入密钥。模型沿用后端缓存，不得放进 `assets`、算子目录或测试目录。付费 API、私有/受限模型或大体积下载先让用户确认；其他情况拿到脚手架后直接填写并调用 `develop_custom_operator`，不得继续发散研究接口或架构。提交 proposal（name、category、source、validation_contract）、临时 samples 和 parameters。验收契约先固定，不得靠换样本、删断言或降低标准使失败版本通过；业务契约改变使用新算子 ID。不得修改 DJ 源码或把测试文件写入正式数据目录。
9. `develop_custom_operator` 返回 `OPERATOR_SOURCE_INCOMPATIBLE` 时，只按 `source_preflight.diagnostics` 修改源码，最多自动修正两次；不得为寻找 DJ 接口搜索全盘 Python 环境、Anaconda、DJ 源码目录或互联网。只有 job 状态为 testing 才通过 `get_custom_operator_job` 轮询；failed/cancelled 必须立即停止轮询并报告 `error_details.phase`。取消时传 cancel=true，并确认 cleanup_pending=false。算子验证成功前不得提前写 postprocess、创建业务输出目录或调用 `prepare_plan`。成功后自动进入当前账号个人库，无需另行发布审批；使用返回的 candidate_id 再读取 schema 并继续规划。validated 只表示声明的 JSON 断言通过，不证明任意视觉或语义质量；experimental 必须明确说明试用性质。已有个人版本可用 `validate_custom_operator` 复验，不能伪造验证状态。额外包使用账号隔离环境，锁定版本；模型沿用后端缓存，不写入测试临时目录。
10. 调用 `mcp__dj__prepare_plan`，并同时提交仅用于展示的 `view_spec.groups`：先确定真实且有序的 `plan.recipe.process`，再按当前任务语义把连续的 `process_indexes` 组织为少量阶段，为每个阶段给出准确的 `title` 和可选 `summary`。不得为了展示制造不存在的执行步骤，不得改变、跳跃或重复算子索引；不适合合并的步骤保持独立。修改时复用 `task_id`，并把上一版 `plan_version` 作为 `base_plan_version`。每次调用都生成新的不可变 `plan_vNNN` 及其 `plan-view.json`，不得编辑旧版本。调用工具前必须执行下文的 prepare_plan 前结构自检。
11. `prepare_plan` 已返回 `execution_preview` 和 `runtime_assessment`；展示规范化 Plan、校验结果、实际执行预览、Runtime 解析、CPU/GPU 回退或阻断项、版本 diff 和 `content_hash`，请求第二次明确的 `批准并执行`、`修改计划` 或 `取消任务`。存在 `runtime_assessment.blocking_issues` 时不得请求执行审批。能力审批绝不等于 Plan 审批；只有明确选择 `批准并执行` 才能调用 `mcp__dj__approve_plan`。
12. 明确批准后，用准确的 `task_id + plan_version + content_hash` 调用 `mcp__dj__approve_plan`，随后调用 `mcp__dj__run_plan`。本部署使用 native 的 PlanRunner → LocalProcessBackend → DJ executor，不要求 Docker 或 broker。缺依赖或存在版本冲突时报告运行环境阻断，不得修改共享 DJ Python 包来绕过。
13. 轮询 `mcp__dj__get_run`。失败时先检查日志；只有安全的瞬时故障才能原样重试。若 recipe、脚本、路径或数据语义需要变化，必须创建新版本并重新确认。只有用户要求取消或继续不安全时才调用 `mcp__dj__cancel_run`。
14. 成功后返回 task id、plan version、run id、Runtime id、Dataset Snapshot hash、输出制品 manifest、实际执行 recipe 和报告路径。

`mcp__dj__get_plan` 同时返回不执行数据的 `execution_preview` 和当前环境的 `runtime_assessment`；它们不能代替校验或批准。Runtime 状态可能变化，`run_plan` 会在执行前再次预检。

## 低难度原生可达快路径

当任务只需少量无跨样本状态的原子处理、能力顺序基本唯一，且完整 schema 证明当前 DJ 原生算子可覆盖全部验收标准时，执行以下**低难度原生可达快路径**：

```text
一次批量 search_capabilities
→ 一次批量 get_capability_schemas
→ 候选方案与验收映射
→ 用户确认生成 Plan
```

快路径不跳过需求确认、方案确认或 Plan 执行批准。它只禁止在证据已充分时继续检索、重复自审或发明新的业务边界。

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
  process:
    - clean_links_mapper:
        repl: ""
    - punctuation_normalization_mapper: {}
  executor_type: default
  np: 4
postprocess: []
```

每个 process 列表项必须是只包含一个算子名的映射，算子参数是该名称下的值。禁止把算子名放入 `name`、`operator` 或其他平铺字段。

### prepare_plan 前结构自检

在每次调用 `mcp__dj__prepare_plan` 前，先在内存中检查：

- `recipe.process` 是列表，且每项恰好包含一个算子名；
- 每个算子的参数是该算子名对应的映射，不存在平铺的过程项；
- `postprocess` 位于 Plan 顶层，不得放入 `recipe`；
- `view_spec.groups[*].process_indexes` 只引用实际 process 索引，按顺序连续覆盖，无跳跃、重复或越界；
- 修改方案时已同时提供原 `task_id` 和上一版 `base_plan_version`。

任一检查不通过时，先修正内存中的请求，不得用无效结构试探 `prepare_plan` 的报错。

只使用能力检索实际返回的算子名和参数。脚本必须在 `prepare_plan` 前存在于工作区内，MCP 会把它快照进不可变计划包。不得在 plan、recipe、脚本参数、报告或工具调用中放入明文密钥。

使用 API 算子时省略 `api_key` 和 `base_url`。使用 API VLM 算子时设置 `is_api_model: true`，用户未指定模型时通常省略 `api_or_hf_model`；只有该算子已经进入 Recipe 后，`prepare_plan` 才会从服务器私有配置解析默认 VLM，并把解析后的非秘密模型名写入规范化 Plan。用户明确指定的模型可以覆盖默认值，但必须作为重要 Plan 参数展示。若所选算子缺少凭证、默认模型或其他运行配置，`prepare_plan.validation.errors` 会给出具体算子、缺少项、配置文件与重启提示；向用户原样说明并停止审批，绝不得读取密钥文件，也不得因为服务器可能配置了某种模型而倒推或改变算子选择。

## 工具范围

- 阶段回退：`skill`
- 检索能力：`search_capabilities`
- 加载候选完整定义：`get_capability_schemas`
- 个人算子接口契约：`get_custom_operator_authoring_spec`
- 个人算子生成、测试和状态：`develop_custom_operator`、`validate_custom_operator`、`get_custom_operator_job`
- 需求与方案确认：`ask_user_question`
- 版本管理、审查预览与 Runtime 预检：`prepare_plan`、`get_plan`
- 批准门禁：`approve_plan`
- 执行与恢复：`run_plan`、`get_run`、`cancel_run`
