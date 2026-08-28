---
name: data-juicer-requirements-zh
description: 当用户提供本地目录、数据集或批量样本，并要求筛选、分类、清洗、去重、抽样、转换、质量评估或构建数据集时使用；即使用户没有提到 Data-Juicer，也要在能力检索和方案规划前，通过 inspect_input 获取输入事实，并用 TaskSpec 澄清业务目标、判断单位、输出、语义边界、约束和验收标准。普通单文件查看、知识问答及已有 Plan 的执行或故障诊断不使用。
user-invocable: true
---

# Data-Juicer 需求澄清

只负责把自然语言需求推进到用户确认的 `requirement_ready` TaskSpec。输入事实可以自行检查；能力、算子和实现方案留给后置 `data-juicer-plan-flow-zh` Skill。

## 必经流程

1. 从用户原始请求建立简明 Draft TaskSpec。区分 `known`、`unknown_discoverable` 和 `unresolved_user_owned`；TaskSpec 是决策状态，不是逐字段问卷。
2. 输入位置足以定位且无需新增权限时，立即调用 `mcp__dj__inspect_input`，将文件数量、格式、规模、媒体元数据、生成的 dataset/manifest 路径，以及工具实际返回的结构事实回填 TaskSpec。若路径或处理范围本身不明确，先只询问这个阻塞问题。
3. `inspect_input` 只负责输入事实。不得调用 `search_capabilities`，不得探测算子、模型、运行依赖或环境变量，不得用 shell、文件读取或自写脚本替代缺失的输入分析能力。工具未返回的事实保持 `unknown_discoverable`，不要猜测。
4. 基于原始需求与输入事实，分轮解决所有会实质改变 Pipeline 的 `unresolved_user_owned` Material Ambiguity，而不只是在能力检索前形成技术 query 所需的问题。优先明确目标与范围、判断单位、输出制品、规模与目标分布、hard/soft 约束、语义边界、验收标准和优化取舍。
5. 每轮集中提出 1–3 个相关的高影响问题；一个问题已阻塞后续澄清时先只问它。数值模糊询问范围，hard/soft 混淆询问约束等级，主观语义优先给正例、反例和边界案例。说明为什么要确认，以及不同答案会影响什么。
6. 不向用户询问 `inspect_input` 已能取得的事实。例如视频时长、分辨率、帧率或工具实际返回的 shot 结构应自行获取；但“按整条视频判断还是定位片段”属于用户决定，必须澄清。不要为了填满 TaskSpec 而提问。
7. 达到 `requirement_ready` 后，向用户展示结构化需求摘要、输入概况、未决的可探索事实和可判定验收标准，并请求 `确认需求并开始能力检索`、`修改需求` 或 `取消任务`。`ask_user_question` 可用时必须调用；不可用时使用简明文本。原始请求和一般附和都不算确认。
8. 用户确认后，保留完整的 `requirement_ready` TaskSpec 作为会话内交接契约，然后调用 `skill` 工具加载 `data-juicer-plan-flow-zh`。后置 Skill 已加载时不要重复加载，直接按交接契约继续。

需要详细字段、成熟度条件或提问边界时，按需读取 [TaskSpec 与需求契约](references/task-spec.md)。普通任务不必全文展开该 reference。

## 阶段门禁

用户确认需求前，禁止：

- 调用 `search_capabilities` 或检查具体执行环境；
- 选择算子、模型、算法、阈值或 Recipe 参数；
- 设计 postprocess、编写脚本或修改工作区；
- 调用 `prepare_plan`、`approve_plan`、`run_plan`。

## 工具范围

- 输入事实：`mcp__dj__inspect_input`
- 需求交互：`ask_user_question`
- 阶段交接：`skill`
