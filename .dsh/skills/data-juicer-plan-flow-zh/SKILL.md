---
name: data-juicer-plan-flow-zh
description: 通过 mcp__dj__ plan-flow 工具规划、确认、执行和修复可复现的 Data-Juicer 数据处理任务。适用于需要需求澄清、计划审查、版本管理或报告的正式任务。
user-invocable: true
auto_load: true
---

# Data-Juicer 计划优先流程

只使用一个 DSH Agent。MCP 是能力、持久化和执行层，不是另一个 Agent。使用用户选择的工作区，并在每个工作区相关调用中传入绝对路径 `workspace_root`。

MCP 服务器没有独立的业务工作区。源码目录和进程 cwd 只是实现细节，绝不能作为 `workspace_root`。必须从当前 DSH 会话取得工作区，并在每次工作区相关调用中传入其绝对路径；所有相对路径都以该根目录解析。不得要求用户把工作区数据复制进 MCP 源码树，也不得因此申请提升权限。

## 必经流程

1. 判断需求是否明确了输入、输出、重要约束和验收标准。只追问会实质改变流水线的缺失信息；这些选择未解决前不要生成计划。
2. 本地输入先调用 `mcp__dj__inspect_input`。将独立需求交给 `mcp__dj__search_capabilities`；互不依赖的检索可以并行。读取返回的 `runtime` 布尔状态，判断 API 凭据、base URL 和 VLM 模型是否已配置，但不得获取其值。
3. Data-Juicer 已覆盖的步骤写入 `plan.recipe.process`。经过一次聚焦检索仍无合适算子时，在顶层 `plan.postprocess` 提议通用 Python 制品，不要无限寻找算子。不得把 postprocess 写进 recipe。
4. 调用 `mcp__dj__prepare_plan`。修改时复用 `task_id`，并把上一版 `plan_version` 作为 `base_plan_version`。每次调用都生成新的不可变 `plan_vNNN`，不得编辑旧版本。
5. 向用户展示规范化 recipe、重要参数、后处理、风险、校验结果、版本 diff 和 `content_hash`，等待用户明确批准这一准确版本。不得替用户批准，也不得把普通附和当成批准。
6. 明确批准后，用准确的 `task_id + plan_version + content_hash` 调用 `mcp__dj__approve_plan`，随后调用 `mcp__dj__run_plan`。
7. 轮询 `mcp__dj__get_run`。失败时先检查日志；只有安全的瞬时故障才能原样重试。若 recipe、脚本、路径或数据语义需要变化，必须创建新版本并重新确认。只有用户要求取消或继续不安全时才调用 `mcp__dj__cancel_run`。
8. 成功后返回 task id、plan version、run id、输出目录、实际执行 recipe 和报告路径。

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

使用 API 算子时，plan 中省略 `api_key` 和 `base_url`。Data-Juicer 会从 MCP 服务器环境继承 `OPENAI_*`、`DASHSCOPE_*` 或 `SK`。若 `runtime.api_credentials_configured` 为 false，应让用户更新 `D:\dsh-app\dj-plan-flow.env` 并重启 MCP 启动器；不得通过 DSH 工具设置或复制密钥。

## 工具范围

- 检查输入：`inspect_input`
- 检索能力：`search_capabilities`
- 版本管理：`prepare_plan`、`get_plan`
- 审查预览：`preview_plan`
- 批准门禁：`approve_plan`
- 执行与恢复：`run_plan`、`get_run`、`cancel_run`

不得使用旧 `run_data_recipe`、DJAgent、`djx` 或直接修改数据的 Shell 命令绕过该流程。
