---
name: data-juicer-plan-flow-zh
description: 面向正式数据处理场景，依托 mcp__dj__ plan-flow 工具，完成数据处理任务的需求澄清、方案规划、版本管理、合规审查、执行运行与故障修复，输出可复现、可追溯、可二次处理的标准化数据处理流水线，适用于企业级正式数据治理、数据集清洗、迭代优化等业务场景。触发词：Data Juicer数据处理、数据任务规划、数据集清洗流程、DJ任务执行、数据流水线搭建、数据处理方案确认、数据任务版本管理、数据任务修复、数据处理验收、数据集迭代、正式数据任务、数据任务审查、DJ计划执行、数据流程复现、数据任务预检、数据处理报告生成、数据集优化流程
user-invocable: true
auto_load: true
---

# Data-Juicer 计划优先流程

只使用一个 DSH Agent。MCP 是能力、持久化和执行层，不是另一个 Agent。使用用户选择的工作区，并在每个工作区相关调用中传入绝对路径 `workspace_root`。

MCP 服务器没有独立的业务工作区。源码目录和进程 cwd 只是实现细节，绝不能作为 `workspace_root`。必须从当前 DSH 会话取得工作区，并在每次工作区相关调用中传入其绝对路径；所有相对路径都以该根目录解析。不得要求用户把工作区数据复制进 MCP 源码树，也不得因此申请提升权限。

## 必经流程

1. 判断需求是否明确了输入、输出、重要约束和验收标准。若缺失选择会实质改变流水线，必须调用 `ask_user_question` 补齐；不得自行假设，也不得用普通文本提问代替。
2. 检查或规划前，先把已理解的需求梳理成简明需求摘要，覆盖输入、输出、处理目标、约束和验收标准。无论原始需求是否完整，都必须调用 `ask_user_question`，提供 `确认并开始规划`、`修改需求`、`取消任务`；只有返回值准确选择 `确认并开始规划` 才能继续，原始请求本身不算确认。
3. 本地输入调用 `mcp__dj__inspect_input`。将独立需求交给 `mcp__dj__search_capabilities`；互不依赖的检索可以并行。服务器配置只能依据返回的 `runtime` 对象判断，严禁通过 DSH 文件工具读取或检查环境变量文件。
4. Data-Juicer 已覆盖的步骤写入 `plan.recipe.process`。经过一次聚焦检索仍无合适算子时，在顶层 `plan.postprocess` 提议通用 Python 制品，不要无限寻找算子。不得把 postprocess 写进 recipe。
5. 调用 `mcp__dj__prepare_plan`。修改时复用 `task_id`，并把上一版 `plan_version` 作为 `base_plan_version`。每次调用都生成新的不可变 `plan_vNNN`，不得编辑旧版本。
6. 向用户展示规范化 recipe、重要参数、后处理、风险、校验结果、版本 diff 和 `content_hash`，随后必须调用 `ask_user_question`，提供 `批准并执行`、`修改计划`、`取消任务`。只有返回值准确选择 `批准并执行` 才能调用 `mcp__dj__approve_plan`；聊天中的普通附和不算批准。修改后的新版本必须再次弹窗审查。
7. 明确批准后，用准确的 `task_id + plan_version + content_hash` 调用 `mcp__dj__approve_plan`，随后调用 `mcp__dj__run_plan`。
8. 轮询 `mcp__dj__get_run`。失败时先检查日志；只有安全的瞬时故障才能原样重试。若 recipe、脚本、路径或数据语义需要变化，必须创建新版本并重新确认。只有用户要求取消或继续不安全时才调用 `mcp__dj__cancel_run`。
9. 成功后返回 task id、plan version、run id、输出目录、实际执行 recipe 和报告路径。

`mcp__dj__preview_plan` 只提供不执行数据的预检摘要，不能代替校验或批准。

## Plan 约定

面向用户的计划保持以下结构：

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

使用 API 算子时，plan 中省略 `api_key` 和 `base_url`，凭据与端点由 Data-Juicer 从 MCP 服务器环境继承。使用 API VLM 算子时设置 `is_api_model: true`，通常省略 `api_or_hf_model`；`prepare_plan` 会采用 `runtime.default_models.vlm` 声明的服务器默认模型并写入规范化 Plan。必须信任服务器声明的模型角色：不得根据模型名是否包含 `vl` 等字符串猜测模态，不得自行替换已配置模型，也不得读取环境变量文件。用户明确指定的模型可以覆盖默认值，但必须作为重要 Plan 参数展示。若运行配置缺失，只报告缺失能力并让用户重新配置、重启 MCP，不得检查密钥文件。

## 工具范围

- 检查输入：`inspect_input`
- 检索能力：`search_capabilities`
- 版本管理：`prepare_plan`、`get_plan`
- 审查预览：`preview_plan`
- 批准门禁：`approve_plan`
- 执行与恢复：`run_plan`、`get_run`、`cancel_run`
