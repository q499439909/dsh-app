# Data-Juicer + DeepSeek Harness Plan-Flow 接手文档 V2

最后更新：2026-08-27

## 0. 2026-08-27 接手摘要（接手先读）

本版在 2026-08-25 中文接手文档基础上复制并更新。旧内容仍保留为历史背景；本节、后文更新后的第 1、8、12、15、16、17、18 节代表当前结论，若与旧摘要冲突，以本版新结论为准。

### 我们在做什么

继续使用单个 DSH Agent + Data-Juicer 本体 + 小型 `plan-flow` MCP，构建可澄清、可审查、可版本化、可批准、可执行和可追溯的正式数据处理流程。当前焦点已从 MCP 主体开发转向两件事：

1. 在生成 Pipeline 前，用结构化 TaskSpec 准确区分“必须由用户决定的关键歧义”和“可以自行探索获得的事实”；
2. 控制 DSH 澄清阶段的推理量和提问数量，避免一个简单问题思考数分钟、一次提出大量并不阻塞当前阶段的问题。

MCP 仍不是第二个 Agent。DSH 负责理解、澄清、规划和交互；MCP 负责输入事实、能力事实、Plan 校验与版本、批准状态和执行。

### 已经完成了什么

#### TaskSpec 与澄清方法

- 已确定 TaskSpec 三个成熟度：`draft -> discovery_ready -> plan_ready`。
- 未知项分为：
  - `known`：已有可靠值；
  - `unknown_discoverable`：可由 `inspect_input`、`search_capabilities` 或环境探测获得；
  - `unresolved_user_owned`：必须由用户决定，不能从数据或环境推断。
- “TaskSpec 明确”不等于每个字段已有具体值；它表示业务意图足以进入下一阶段，且每个未知项的解决责任已经明确。
- 探索前只解决阻塞 `discovery_ready` 的用户所有决策；达到 `discovery_ready` 后才调用 `inspect_input` / `search_capabilities`。
- 探索结果回填 TaskSpec 后，只处理新暴露的 Material Ambiguity；达到 `plan_ready` 后再展示结构化需求摘要和验收标准，并确认是否开始 Pipeline 规划。
- Material Ambiguity 只指不同解释会实质改变 Pipeline 结构、关键参数、工具/模型选择、类别或目标分布、评估方式、验收结论、成本、风险或执行可行性的歧义。字段为空本身不是 Material Ambiguity。
- 数值模糊询问明确范围；hard/soft 混淆询问约束等级；“明显、复杂、较大、高质量”等语义优先用正例、反例和边界案例澄清。
- `ask_user_question` 可用时必须优先使用；不可用时允许普通文本提问。澄清需求本身比交互形式更重要。

#### Skill 文件

已修改并同步中英文 Skill：

```text
D:\dsh-app\.dsh\skills\data-juicer-plan-flow-zh\SKILL.md
D:\dsh-app\.dsh\skills\data-juicer-plan-flow-zh\references\task-spec-and-clarification.md
D:\dsh-app\.dsh\skills\data-juicer-plan-flow\SKILL.md
D:\dsh-app\.dsh\skills\data-juicer-plan-flow\references\task-spec-and-clarification.md
```

当前 Skill 已包含以下性能约束：

- TaskSpec 是紧凑决策状态，不是必须逐字段展开的问卷或思考清单；不向用户复述空字段。
- reference 不再每次强制全文读取；只在需要详细 schema，或遇到数值、hard/soft、复杂语义边界时按需读取。
- 每轮优先集中提出 1–3 个高影响问题。
- 如果一个问题已经阻塞下一阶段，先只问该问题，不展开后续规划、实现或验收问题。
- 不得仅因 TaskSpec 某字段为空就提问。
- 检测路径、算子能力和执行环境应先探索；只有新增权限、成本或业务取舍才交给用户决定。

#### 性能诊断与已做修正

已解析最新慢会话的 `session.jsonl.zstd`。该请求从用户输入到 `ask_user_question` 约 304 秒，其中工具调用只有 10–40 ms，耗时几乎全部来自模型推理：

| 模型步骤 | 耗时 | 输出 token |
|---|---:|---:|
| 读取 TaskSpec reference 前 | 约 28 秒 | 1,372 |
| 构造 Draft TaskSpec、列目录 | 约 57 秒 | 3,327 |
| 组织澄清问题 | 约 218 秒 | 12,282 |

最后一步生成约 4 万字符推理并提出 5 个问题；实际第一阻塞项只是“用户说两个视频，但目录有六个，究竟是哪两个”。因此已确认瓶颈不是 MCP、文件读取或网络 I/O，而是提示词冲突、问题爆炸和模型输出过长。

已通过 DSH“记忆系统”正式替换 Mnemon `USER.md` 中旧的“澄清必须决策级敏锐且穷尽六维度”偏好。新的全局偏好是：只问阻塞当前阶段的 Material Ambiguity；可探索信息自行获取；每轮 1–3 个高影响问题；单一阻塞问题先单独问。已确认事实源和投影均更新：

```text
C:\Users\hu\.mnemon\runtime\memories.json
C:\Users\hu\.mnemon\runtime\USER.md
```

慢会话日志还显示同一个 `data-juicer-plan-flow-zh` 在一个用户轮次中被注入两次，每份约 3,111 字符。最近的显式 `/data-juicer-plan-flow-zh` 会话都出现两次注入。为去除疑似重复的 `dsh-tool-skill` 监听器，已从 `D:\dsh-app\dj-dsh.patch.yml` 移除顶层冗余：

```yaml
- id: tool-skill
  disabled: false
```

标准 Agent preset 自带的 `tool-skill` 仍保留。此项必须重启 DSH 后才生效和验证。

### 当前进行到哪

截至 2026-08-27 的实测监听状态：

```text
57035  PID 32472  node.exe
  DSH Web，使用 D:\dsh-app\dj-dsh.patch.yml

8010   PID 39576  D:\dj\.envs\dsh-dj\python.exe
  当前正式 plan-flow MCP

8000   PID 33604  历史 Python 环境
  不是当前 DSH patch 指向的 MCP
```

Skill 正文和 Mnemon 新记忆已经可供后续加载；但 57035 是修改 `dj-dsh.patch.yml` 之前启动的旧进程，尚未加载去除 `tool-skill` 后的 patch。曾尝试自动重启，停止进程操作被本地执行策略整体拦截；旧服务没有被停止，仍保持在线。

因此当前状态是“规则已修改并静态验证，Mnemon 已实时更新；DSH 尚待人工正常重启；重启后的性能回归和单次注入尚未验证”。不要把“已写 patch”误写成“重复注入已经验证修复”。

当前 `D:\dsh-app` 有本项目未提交修改，也有用户原有的无关删除/未跟踪文件。接手时只处理本项目目标文件，不要恢复、删除或覆盖其他内容。当前目标文件包括：

```text
M  .dsh/skills/data-juicer-plan-flow-zh/SKILL.md
M  .dsh/skills/data-juicer-plan-flow/SKILL.md
M  dj-dsh.patch.yml
?? .dsh/skills/data-juicer-plan-flow-zh/references/
?? .dsh/skills/data-juicer-plan-flow/references/
?? DJ_DSH_HANDOFF.zh-CN.v2.md
```

`D:\dj\data-juicer-1.5.4` 当前 `git status --short` 只显示多项 demos 修改和未跟踪 `data-juicer-hub/`；没有显示 plan-flow 核心文件的未提交改动。旧文档中列出的 plan-flow 修改是历史状态，不能代替当前 `git status`。

### 下一步计划

1. 在没有真实任务运行时，正常关闭当前 57035 DSH Web，并重新运行 `D:\dsh-app\web-dj.cmd`，使更新后的 `dj-dsh.patch.yml` 生效。不要在活跃执行中重启。
2. 重启后新建干净会话。旧会话已经持久保存旧 Skill 与旧 Mnemon 快照，不适合性能回归。
3. 显式调用一次 `/data-juicer-plan-flow-zh`，检查新 session 日志中 `source.kind=skill-invocation` 是否只出现一次；若仍出现两次，再定位实际的双监听来源，不要继续靠删随机配置猜测。
4. 使用同一最小复现：目录实际有六个视频，但用户说“这两个视频哪个是运镜视频”。预期第一轮只询问输入范围；范围解决后，只有“运镜”的不同解释确实会改变检测或验收时，才另行澄清语义边界。不得提前询问检测方案、预期数量、输出格式或执行环境。
5. 记录从用户输入到第一个 `ask_user_question` 的耗时、各 step 输出 token 和工具耗时，与 304 秒基线对比。性能验收优先看问题是否收敛和模型输出 token 是否显著下降。
6. 用户回答后再进入 `inspect_input` + `search_capabilities`，回填 TaskSpec；探索后仅处理新出现的 Material Ambiguity。
7. TaskSpec 达到 `plan_ready` 后展示需求摘要与可判定验收标准，确认后再生成 Pipeline。
8. 若问题数量已收敛但 GLM 仍生成大量隐藏推理，再处理模型层：为澄清阶段使用更快模型或更低 thinking/output budget；不要先把延迟归因于 MCP。
9. 完成性能回归后继续旧计划中的真实小样本端到端验收、Plan 版本/diff/重新批准和报告验证。

### 经验和不要重复踩的坑

- TaskSpec 明确不等于“所有事实已经知道”；`unknown_discoverable` 是合法状态。
- 不要把 TaskSpec 当问卷。空字段不是提问理由，只有 Material Ambiguity 才是。
- 不要要求探索前一次性完成最终 TaskSpec；使用 `discovery_ready` 和 `plan_ready` 两道成熟度门槛。
- 不要让用户回答 Agent 能通过输入检查、能力检索或环境探测得到的事实。
- 不要在输入范围尚未明确时，同时追问实现路径、验收、输出形式和执行环境；一个阻塞问题先单独问。
- 不要把“提问必须穷尽”写入全局 Mnemon 偏好，它会压过具体 Skill 的收敛策略并导致问题爆炸。
- 不要强制每次全文读取 reference。读取本身很快，但会制造额外模型轮次和大量推理。
- 不要只看总耗时猜 MCP 慢。先用 session 日志拆分模型 step、tool call 和等待用户时间。
- DSH session 是 Zstandard 压缩 JSONL；最近日志位于 `C:\Users\hu\.dsh\sessions\...\session.jsonl.zstd`。诊断时统计 `step/start`、`assistant/message`、`tool/call`、`tool/result`、`usage.outputTokens` 和注入消息来源。
- 显式 `/skill` 出现两次 `<skill_content>` 是可观测 bug/配置问题，不要误认为模型自行重复阅读。
- `auto_load: true` 不能当作当前 DSH 文件系统 provider 的可靠加载保证；当前 provider 文档明确以名称/description 路由和 `/name` 用户手势为主。测试时要检查实际 session 注入，而不是只看 frontmatter。
- 修改 Skill 正文会影响后续加载，但不会改写已在旧会话历史中的 `<skill_content>`；性能测试必须使用新会话。
- 修改 `dj-dsh.patch.yml` 必须重启 DSH；只刷新浏览器不够。
- 重启命令若被本地策略拦截，不要绕过或假装重启成功；确认旧监听仍在线，并明确留下人工重启步骤。
- 记忆系统的 `memories.json` 是事实源，`USER.md` / `MEMORY.md` 是投影。应通过 Mnemon 控制层或 UI 更新，不要直接编辑投影。

## 0A. 2026-08-25 历史摘要

本轮仍在完成同一个目标：以单个 DSH Agent 为推理和交互主体，以 Data-Juicer 本体和小型 `plan-flow` MCP 提供事实、校验、版本、审批和执行；不重新引入 DJAgent，也不增加嵌套 Agent。

### 当前运行状态

当前已确认的运行状态：

```text
http://127.0.0.1:8010/mcp
  当前正式 plan-flow MCP
  PID 38776
  D:\dj\.envs\dsh-dj\python.exe

http://127.0.0.1:57035/
  当前唯一 DSH Web
  PID 37808

http://127.0.0.1:8000/mcp
  仍有历史 data-juicer-agents 环境进程
  DSH 的 dj-dsh.patch.yml 不指向它；不要误拿 8000 做当前验收
```

### 已经完成了什么

当前已经完成并实测：

- 8010 MCP 已重启并加载媒体模态兼容与精确算子名兜底；
- 通过活 MCP 精确查询 `image_tagging_vlm_mapper`、`modality=image`、`top_k=1`，当前准确只返回该算子；
- `search_capabilities` 已保持一次返回候选完整 schema，并将默认值和服务端硬上限统一为 `top_k=5`；即使调用方传 10 或 30，每项也最多返回 5 个；
- `runtime` 正确报告凭据、base URL 和 `qwen3.7-plus` VLM 默认模型均已配置，且不泄漏密钥；
- `web-dj.ps1` 已改为默认固定/复用 57035、校验端口归属、告警其他 DSH Web，并清理脚本自己启动的 DSH 子进程；
- 旧的多个 DSH Web 已清理，当前只剩 57035。

### 当前进行到哪

当前尚未完成：

- 一次有界完整检索已经实施，但四个互相重叠的需求仍会返回约 43 KB；需要在真实任务中验证 DSH 是否会先归并原子能力，避免重复搜索同一个 VLM 实现；
- 尚未实现基于下游步骤依赖的 material 参数记录与更强 `prepare_plan` 校验；当前主要依赖 DSH + Skill 从真实 schema 做语义判断；
- 尚未修改 `_stats.jsonl` 的关联字段或实现 clean/full/selected stats 输出策略；
- 一个历史 session 日志已确认存在重复 `seq=3`，数据仍在但尚未修复；
- 尚未完成新的真实小样本端到端任务验收。

### 下一步计划

接手后优先做：先修复或隔离损坏 session，然后用 57035 + 8010 新建会话验证一次有界完整检索和真实小样本任务。不要继续通过堆查询词规避检索接口的问题。

## 1. 我们在做什么

目标是脱离 DJAgent 框架，只使用一个 DeepSeek Harness（DSH）Agent、Data-Juicer（DJ）本体与一个小而稳定的 `plan-flow` MCP，完成可审查、可复现、可版本化的数据处理。

MCP 不是第二个 Agent。DSH 负责需求澄清、规划和判断；MCP 只负责输入检查、算子发现、严格校验、持久化、审批状态和执行。

目标流程：

1. 从用户自然语言生成紧凑 Draft TaskSpec，并标记 `known`、`unknown_discoverable`、`unresolved_user_owned`；
2. 只澄清阻塞探索的用户所有 Material Ambiguity，达到 `discovery_ready`；
3. 检查输入并检索 DJ 能力，把事实回填 TaskSpec；
4. 只澄清探索后新暴露的 Material Ambiguity，达到 `plan_ready`；
5. 展示结构化需求摘要和验收标准，获得“确认并开始规划”；
6. DJ 能覆盖的步骤放进 `recipe.process`，真正的 gap 由 DSH 编写通用 Python 后处理；
7. 保存不可变 `plan_vNNN`；
8. 展示 Plan、重要参数、风险、diff 和 `content_hash`，再次审批；
9. 只执行被批准的准确版本；
10. 保存日志、实际 recipe、输出和报告；任何实质修改都创建新 Plan 版本并重新审批。

## 2. 已确定的架构决策

### 不再依赖 DJAgent

DJAgent 的 `build_dataset_spec`、`build_process_spec`、`build_system_spec` 是为它自己的多阶段状态和职责分层设计的。DSH 本身已有规划能力，不需要安装 DJAgent 包，也不需要照搬三份 Spec 再合并。

### 不使用旧一次性 Recipe-Flow 作为正式入口

旧 `run_data_recipe` 在内存拼 recipe 后立即执行，没有可靠落盘的 Plan、版本、diff、审批状态、制品快照和执行清单。它适合实验，不适合正式流程。

### 不把所有算子暴露成 MCP 工具

MCP 只提供能力检索和九个工作流工具。DSH 通过 `search_capabilities` 获取真实算子 schema，再把选中的算子写入 Plan。这样避免巨大工具目录，也避免找不到某个算子时无限搜索。

### Plan 是主工件，Recipe 是执行器视图

Plan 面向用户、审查、版本和复现；`recipe` 只是 Plan 中给 DJ 使用的部分。顶层 `postprocess` 可以包含通用 Python 脚本，不会传给 DJ。执行时可按具体执行器生成 `materialized-recipe.yaml`。

## 3. 当前目录和运行环境

```text
D:\dj\data-juicer-1.5.4
  Data-Juicer 源码和 plan-flow MCP 实现

D:\dj\.envs\dsh-dj
  当前 MCP 使用的 Python 环境

D:\dsh-app
  DSH 程序壳、启动器、MCP 环境配置、Skills 和本文档

<当前 DSH 会话工作区>
  用户本次选择的数据、Plan、脚本、输出与报告
```

工作区绝不能写死。DJ 源码目录、MCP cwd 和 DSH 安装目录都不是业务工作区。

关键文件：

```text
D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\
  common.py       路径、原子写入、锁、hash、错误类型
  discovery.py    输入检查、算子检索、runtime 状态
  validation.py   Plan/recipe/算子/路径/密钥/脚本校验
  store.py        task、Plan 版本、审批和制品快照
  runner.py       异步执行、状态、日志、后处理和报告
  service.py      应用服务
  server.py       FastMCP 适配层

D:\dj\data-juicer-1.5.4\data_juicer\tools\DJ_mcp_plan_flow.py
D:\dj\data-juicer-1.5.4\data_juicer\tools\mcp_server.py
D:\dsh-app\.dsh\skills\data-juicer-plan-flow-zh\SKILL.md
D:\dsh-app\.dsh\skills\data-juicer-plan-flow\SKILL.md
D:\dsh-app\web-dj.ps1
D:\dsh-app\dj-dsh.patch.yml
D:\dsh-app\dj-plan-flow.env
```

用户已自行修改中文版 Skill，接手时不要无意覆盖。

## 4. 当前 MCP 接口

当前只暴露九个工具：

| 工具 | 作用 |
|---|---|
| `inspect_input` | 检查输入；原始媒体目录会生成 DJ JSONL manifest |
| `search_capabilities` | 检索算子、参数 schema、兼容性和能力 gap |
| `prepare_plan` | 规范化、校验并保存新 `plan_vNNN` |
| `get_plan` | 读取 Plan、校验、diff、审批和版本列表 |
| `preview_plan` | 显示准确执行预览，不处理数据 |
| `approve_plan` | 按 `task_id + plan_version + content_hash` 批准准确版本 |
| `run_plan` | 异步启动已批准 Plan |
| `get_run` | 查询运行状态、日志、输出和报告 |
| `cancel_run` | 停止运行中的 worker |

没有继续拆 `build_dataset_spec`、`build_process_spec`、`build_system_spec`。对于单 Agent DSH，这些是内部思考维度，不应扩大 MCP 接口。

## 5. Plan 格式和 DJ/通用脚本分工

```yaml
user_intent: "..."
modality: image
risk_notes: []
acceptance_criteria: []
approval_required: true

recipe:
  dataset_path: "..."
  export_path: processed.jsonl
  process:
    - some_dj_operator:
        important_parameter: value
  executor_type: default
  np: 4

postprocess:
  - kind: python
    script: scripts/finish.py
    arguments: {}
```

规则：

- `recipe` 只包含 DJ 能识别的配置；
- `postprocess` 是 Plan 顶层字段，不进入 DJ recipe；
- DSH 决定哪些步骤由 DJ 做，哪些是真正的 gap；
- 聚焦检索后仍无合适算子，就使用受审查的通用 Python 制品；
- 猫狗拆分只是历史示例，没有写进代码；
- 执行器会生成具体 DJ 使用的 materialized recipe；
- Windows 下会把 `dataset_path` 改写成结构化 local dataset，避免反斜杠被 CLI parser 当 shell escape。

## 6. 工作区识别

当前 `@deepseek-ai/dsh-mcp-client` 没有实现 MCP Roots，初始化 capability 为空，协议不会自动发送当前工作区。

现行方案：

1. DSH 会话取得当前用户选择的工作区；
2. 每个工作区相关调用显式传绝对 `workspace_root`；
3. 所有相对输入、脚本和输出路径都从该根目录解析；
4. MCP 拒绝逃逸工作区的路径；
5. 返回值回显规范化后的 `workspace_root`。

不要增加全局 `set_workspace`。HTTP MCP 可能服务多个会话，全局可变目录会串工作区。也不要用启动环境变量固定某个业务工作区。

旧错误曾把相对输入按 MCP cwd 解析到 DJ 源码树，导致 DSH 要求复制数据或提升权限。现已由 `resolve_workspace_path()` 修复，并要求工作区必须是绝对路径。

## 7. 持久化和版本管理

```text
<workspace>\.dj\inputs\input_<id>\
  manifest.jsonl
  input.json

<workspace>\.dj\tasks\task_<id>\
  task.yaml
  current.json
  plans\plan_v001\
    plan.yaml
    validation.json
    diff.json
    content-hash.txt
    approval.json          仅批准后存在
    artifacts\            后处理脚本等快照
  plans\plan_v002\...
  runs\run_r001\
    run.json
    materialized-recipe.yaml
    report.md
    logs\stdout.log
    logs\stderr.log
    logs\postprocess-*.log

<workspace>\outputs\<task-slug>\plan_vNNN\run_rNNN\
```

不变量：

- 每次 `prepare_plan` 都创建新版本，绝不覆盖；
- 修改时复用 `task_id` 并传上一版 `base_plan_version`；
- 无效 Plan 也保存审计，但不能批准；
- `content_hash` 覆盖规范化 Plan 和制品内容；
- Plan 或制品被修改会触发 `PLAN_TAMPERED`；
- 只有 hash 匹配的有效 Plan 才能批准；
- `run_plan` 会再次检查 bundle 和审批 hash；
- 每次运行都有独立 `run_rNNN` 和输出目录。

hash 用于完整性和审批内容绑定，不是为了堆很多 hash，也不能单独证明 UI 中有真人点击。

## 8. 两道 UI 确认

### 需求确认

- 先维护 TaskSpec，并区分 `unknown_discoverable` 与 `unresolved_user_owned`；
- 只询问不同答案会实质改变 Pipeline 的 Material Ambiguity，不因字段为空而提问；
- 探索前只问达到 `discovery_ready` 所必需的问题，探索后只问新暴露的用户所有决策；
- 每轮优先 1–3 个高影响问题；单个问题已阻塞下一阶段时先只问该问题；
- `ask_user_question` 可用时必须使用，不可用时允许普通文本提问；
- 达到 `plan_ready` 后展示输入、输出、目标、约束、语义边界和验收标准，再请求“确认并开始规划 / 修改需求 / 取消任务”；
- 原始请求本身不算确认。

### Plan 审批

- `prepare_plan` 后展示 recipe、重要参数、后处理、风险、校验、diff 和 `content_hash`；
- 再弹出“批准并执行 / 修改计划 / 取消任务”；
- 只有准确选择“批准并执行”才能调用 `approve_plan` 和 `run_plan`；
- 新 Plan 版本必须重新审批。

当前 UI 调用由 Skill 强约束；工具不可用时允许文本澄清或确认。MCP 只能验证 hash，不能证明批准一定来自 UI 真人回答。如果未来要求技术上不可绕过，需要增加一个小型 DSH 审批桥接插件，由它调用 `ctx.userQuestions.ask()` 后再批准。这是工具适配器，不是第二个 Agent。

## 9. API、环境变量和 VLM

正确链路：

```text
D:\dsh-app\dj-plan-flow.env
  -> web-dj.ps1 启动时读取
  -> MCP Server 进程环境
  -> runner 子进程继承
  -> DJ API 算子读取环境变量
```

算子和 DSH 都不得自行寻找或读取 `.env`。Plan、工具参数、日志、报告和本文档都不得包含密钥。

启动器允许注入：

```text
OPENAI_API_KEY
DASHSCOPE_API_KEY
SK
OPENAI_BASE_URL
OPENAI_API_URL
DASHSCOPE_BASE_URL
DJ_VLM_MODEL
DASHSCOPE_DEFAULT_MODEL
OPENAI_DEFAULT_MODEL
```

环境变量是启动时快照。修改 `.env` 后必须重启 MCP。若 8010 已有进程，启动器会复用它并警告 `.env` 没有重新加载。

MCP 通过安全的 `runtime` 告诉 DSH 配置状态：

```json
{
  "api_credentials_configured": true,
  "api_base_url_configured": true,
  "vlm_model_configured": true,
  "default_models": {
    "vlm": {
      "configured": true,
      "model": "qwen3.7-plus",
      "role": "vision-language",
      "source": "server_environment"
    }
  }
}
```

只公开非秘密的模型 ID 和角色，不返回 key。DSH 只能信任该对象，不能缺字段时读取配置文件兜底。

历史上 DSH 因模型名没有 `vl`，误判 `qwen3.7-plus` 不是视觉模型，并想换成 `qwen-vl-max`。该判断错误；官方说明 `qwen3.7-plus` 支持文本、图像和视频输入。

现行规则：

- `DJ_VLM_MODEL` 是服务器声明的 VLM 默认模型；
- 不得按模型名猜模态或自行换模型；
- 用户明确要求时才允许 Plan 覆盖模型；
- API VLM 算子设置 `is_api_model: true`，通常省略 `api_or_hf_model`；
- `prepare_plan` 会把服务器默认模型写入规范化 Plan；
- 缺显式模型且缺 `DJ_VLM_MODEL` 时返回 `RUNTIME_VLM_MODEL_MISSING`。

## 10. 算子检索和 gap

`search_capabilities` 返回算子的名称、说明、tags、真实参数 schema、`executor_compatible`、`modality_compatible`，以及无候选时的 gap 提示。

已修复两类检索问题：

```text
image -> image OR multimodal
video -> video OR multimodal
audio -> audio OR multimodal
```

query 精确等于算子名时，直接将算子置顶，不再被 BM25 或 tag 过滤误删；即使模态不兼容也返回并用 `modality_compatible` 提示。

实例：`image_tagging_vlm_mapper` 的 tags 是 `gpu, api, vllm, multimodal`。旧逻辑用 `modality=image` 会在排名前过滤掉它；现在精确 query 且 `top_k=1` 能正确返回。

DSH 不应无限寻找不存在的算子。换合适的需求描述或精确算子名聚焦检索一次；仍不合适就标记 gap 并规划通用脚本。

### 2026-08-25 真实 DSH 检索故障复盘

真实 DSH 会话首轮用四条长中文需求搜索，全部返回 `gap`。第二轮改用英文后找到了 `image_deduplicator` 和 `vlm_ray_vllm_engine_pipeline`，但多轮仍找不到 `image_tagging_vlm_mapper`。

本轮没有只依赖本地复现，而是检查了 DSH 保存的完整 MCP spill：

```text
C:\Users\hu\AppData\Local\Temp\dsh-spill-wuh8gZ\session-ea64a2b2b6d0\
```

三份完整响应确实没有 `image_tagging_vlm_mapper`，所以这次不是“算子已返回但 DSH 没读到”。随后直接调用活的 8010 MCP，精确查询也找不到；而同一个 Python 环境直接加载磁盘代码可以找到。

最终根因是 8010 MCP 在 `discovery.py` 最终修改前已经启动，内存中仍是旧检索逻辑：

```text
旧逻辑：modality=image 只接受 image tag
算子 tags：gpu, api, vllm, multimodal
结果：image_tagging_vlm_mapper 在 BM25 前就被过滤
```

磁盘新代码已经实现 `image -> image OR multimodal` 和 exact-name 兜底，但 Python 进程不会热加载；`_searcher()` 还带单例缓存。停止旧 8010 并重新启动后，活 MCP 验证已通过：

```yaml
requirements:
  - image_tagging_vlm_mapper
modality: image
top_k: 1

# 当前返回
operators:
  - name: image_tagging_vlm_mapper
```

因此，算子检索异常时必须区分三件事：

1. 磁盘代码是否正确；
2. 8010 活进程是否加载了该版本；
3. DSH 的完整 MCP spill 中是否真的包含候选。

不要用本地 import 结果直接推断 DSH 当时看到的结果，也不要看到 tool UI 截断就先断定候选在被截断部分。

### 跨语言和响应膨胀问题

当前 BM25 索引是英文算子名、英文说明和英文参数说明；tokenizer 只按空格、下划线和标点切分。长中文查询与英文索引没有 token 交集，简单加入中文分词也不能解决中英文词汇不相交的问题。

当前临时规则应写进 Skill 和 MCP tool 参数说明：

- `requirements` 是简短算子检索词，不是复述整段用户需求；
- 先把需求转换成简短英文原子能力，例如 `image perceptual hash deduplication`、`image tagging using API vision language model`；
- 三个依赖同一 VLM 结构化输出的业务判断，不必重复检索三个“完美 filter”，可检索一次 VLM tagging，再由任务 prompt 和后处理实现；
- 选中候选后，query 必须准确等于算子名，不能写成 `image_tagging_vlm_mapper generate ...`，否则不触发 exact-name 分支。

真实第二轮四需求、`top_k=10` 的完整响应约 83 KB，DSH UI 明确 spill 了 33 KB。讨论过强制两阶段“摘要 -> exact schema”，但用户最终选择更简单的成熟 Agent 方式：一次检索返回少量候选的完整 schema，exact-name 二次查询只作为失败兜底。

现已实现：

```text
默认 top_k = 5
服务端硬上限 = 5
每个候选仍返回完整 parameters schema
返回顶层有效 top_k，调用方传 10/30 也会明确显示 5
query 精确等于算子名时仍直接返回准确算子
```

同一组四需求在活 8010 上重测，候选数量由最多 40 份 schema 降为最多 20 份，响应约 43,409 字符。下一步不是继续缩减每个候选的信息，而是让 DSH 把多个共享实现的业务判断归并成少量原子能力；例如“真实照片/动物类别/毛色”通常只需检索一次 API VLM tagging。

同时应将中文零命中区分为 `search_miss` 或可重试检索失败，不要立即把跨语言零分误报成确定的能力 `gap`。

### 算子参数显式化方案（已讨论，尚未实现）

每个 VLM/LLM 算子的参数接口不同，不能因为都与 VLM 有关就统一参数名。例如：

- `image_tagging_vlm_mapper` 有 `input_template`、`system_prompt`、`tag_field_name`、API/HF 切换；
- `video_captioning_from_vlm_mapper` 有 `caption_num`、`keep_candidate_mode`、`keep_original_sample`，并可能扩增记录；
- `text_tagging_by_prompt_mapper` 实际是文本 LLM 算子，当前偏 HF/vLLM，输出字段也不在 `__dj__meta__`。

当前选择不维护完整 `operator_contract`。DSH 先精确获取选定算子的真实参数 schema，再由当前 LLM 根据任务和下游用途判断 material 参数。满足任一条件的参数必须显式写入 recipe 并在 Plan 审批中展示：

- 影响任务 prompt、标签定义、分类边界或抽取要求；
- 决定后续读取的输出字段和结构；
- 决定模型、API/HF/vLLM 后端或兼容性；
- 改变样本数量、候选保留或原样本保留；
- 影响阈值、随机性、生成质量、成本或失败策略；
- 算子默认值不能明确满足本任务；
- 本次值与算子默认值不同。

特别规则：生成结果若供下游分类、筛选或抽取，不得直接使用通用默认 prompt。例如基于标签筛选具体业务类别时，必须显式生成任务相关 prompt、标签规则和输出字段。

未来可扩展 Plan 顶层（不进入 DJ recipe）：

```yaml
step_contracts:
  - step_id: tag
    implementation_ref: recipe.process[0]
    consumes: [images]
    expected_produces: [__dj__meta__.task_tags]
    downstream_use: [filter]

parameter_decisions:
  - implementation_ref: recipe.process[0]
    explicit:
      input_template:
        reason: downstream filtering requires task-specific labels
      tag_field_name:
        reason: postprocess reads a stable field
```

`prepare_plan` 至少可确定性校验参数名、必填项、显式决策是否确实写入 recipe、非默认值是否有理由；没有 operator contract 时，它不能完全证明 prompt 语义和实际输出字段，所以仍需要用户审批和小样本预检。不要把这段未来格式误认为当前已经支持。

### `_stats.jsonl` 和最终资产方案（已讨论，尚未实现）

当前 DJ exporter 的实际行为：

- `keep_stats_in_res_ds=false` 会从主数据同时删除 `__dj__stats__` 和 `__dj__meta__`；
- 独立 `_stats.jsonl` 默认只含 `__dj__stats__` 和 `__dj__meta__`；
- `keep_hashes_in_res_ds` 是另一项控制；
- `image_tagging_vlm_mapper` 的标签默认在 `__dj__meta__.image_tags`，因此 clean 主数据不会包含这些标签；
- 有些业务输出在其他顶层字段，单纯删除 `__dj__meta__` 不是通用“清洁输出”。

不建议把 Data-Juicer 全局 `keep_stats_in_res_ds` 默认改成 `true` 再无条件删除 meta，因为这会复制大量 stats、重写整个主数据，并且只删 meta 仍可能留下 stats、hash 或其他算子业务字段。

当前偏好的轻量方案是不新增 `record_id` 字段，优先复用已有媒体路径作为 `_stats.jsonl` 关联字段：

```yaml
图像：images
视频：videos
音频：audios
```

边界必须记录：

- 单媒体、一条路径唯一、同工作区内后处理时可直接使用路径；
- 一条媒体对应多条文本/任务记录时，仅路径不唯一，应使用现有字段组成复合键，例如 `images + text`；
- 多图列表需要路径规范化并保留稳定顺序；
- caption/扩增算子会形成一对多，媒体路径只能表示来源，不能唯一标识输出行；
- 绝对路径适合一次任务内部关联，不适合作为跨机器永久资产 ID。

建议未来 Plan 增加输出策略，而不是只暴露一个布尔值：

```yaml
output_contract:
  primary_asset: clean        # 或 full_stats / selected_stats
  stats_sidecar: retain
  join_fields: [images]
  join_cardinality: one_to_one
  selected_fields: []
```

DSH 不应把大型 stats 整体读进模型上下文；后处理脚本按关联字段程序化读取，DSH 只抽样审查。以上 exporter、Plan 和 runner 改动均尚未落地。

## 11. 输入、校验和执行

输入检查支持 JSON、JSONL、CSV、TSV、Parquet 的基本采样和字段判断。图片/视频目录会生成 DJ JSONL manifest，使用 `<__dj__image>` / `images` 或 `<__dj__video>` / `videos`。

校验包括：

- 只能有一个数据源；
- 本地路径必须存在且位于工作区；
- `process` 必须为非空的单算子步骤列表；
- 算子必须存在，参数必须属于真实 schema，必填参数不能缺；
- recipe 顶层字段必须属于 DJ 配置；
- 明文 secret 被拒绝；
- 后处理只支持工作区内现有 Python 脚本，并做语法检查和快照；
- API 缺凭据时警告，API VLM 缺模型时错误。

执行行为：

- `run_plan` 异步启动独立 Python worker；
- worker 继承 MCP 环境；
- 执行前再次验证 bundle；
- DJ 完成后顺序运行快照后的 Python 后处理；
- stdout、stderr 和每个后处理分别留日志；
- `get_run` 能识别 worker 异常退出；
- `cancel_run` 终止 worker 和子进程；
- 成功后生成基础 `report.md`。

## 12. 启动、停止和重启

当前正式入口：

```text
MCP:     http://127.0.0.1:8010/mcp
DSH Web: http://127.0.0.1:57035/
```

启动 MCP 和 DSH Web：

```powershell
& D:\dsh-app\web-dj.ps1
```

`web-dj.ps1` 在 2026-08-25 已修改：

- 默认 DSH Web 端口固定为 57035，不再每次随机开新端口；
- 57035 已由相同 `bin.js web + dj-dsh.patch.yml` 实例监听时，直接复用并打开页面；
- 57035 被其他程序占用时拒绝启动；
- 发现其他端口的同类 DSH Web 时只告警，不自动终止，避免误杀仍在使用的会话；
- 它新启动的 DSH 子进程放在 `try/finally` 中，脚本正常退出或多数 `Ctrl+C` 场景会清理；
- 强制关闭整个 PowerShell 或系统异常时 `finally` 仍可能来不及执行，但下次启动会复用固定端口，不会继续随机累积；
- 可显式传 `-Port 58000`，但正常使用不要随意改变固定端口。

已验证 Windows PowerShell 5.1 AST 语法、57035 HTTP 200、复用前后 DSH Web 进程数不增加、非 DSH 进程占用目标端口时会正确拒绝。

截至 2026-08-27，57035 的监听进程是 PID 32472，并且启动早于本轮 `dj-dsh.patch.yml` 修改。下一次需要重启 DSH 时，应先通过监听端口和命令行重新确认 PID，正常停止该实例，再运行新脚本；不要永久依赖本文记录的 PID。

关闭浏览器标签页不等于停止 DSH Web。浏览器只是客户端，后台 Node Server 会继续监听。检查当前 DSH Web：

```powershell
Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -eq 'node.exe' -and
        $_.CommandLine -match 'bin\.js web'
    } |
    Select-Object ProcessId, CreationDate, CommandLine
```

停止前先确认 8010 上确实是 plan-flow：

```powershell
$listener = Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1

if ($listener) {
    $mcpProcess = Get-CimInstance Win32_Process `
        -Filter "ProcessId=$($listener.OwningProcess)"

    $mcpProcess | Select-Object ProcessId, CommandLine

    if ($mcpProcess.CommandLine -match "data_juicer\.tools\.mcp_server.*plan-flow") {
        Stop-Process -Id $mcpProcess.ProcessId
    }
}
```

重启边界要区分清楚：

- 修改 Python plan-flow 代码、`.env` 或 MCP 依赖后，必须重启 8010 MCP；
- 修改 `SKILL.md` 或引用资料后，后续重新加载 Skill 时可以读到新正文，但旧会话中已经注入的 Skill 内容不会被追溯替换，因此性能和行为验收应新建干净会话；
- 修改 `dj-dsh.patch.yml` 后必须重启 DSH Web；刷新浏览器页面不等于重启后台 Node Server；
- 当前 57035 进程启动早于本轮删除顶层重复 `tool-skill` 的 patch 修改，尚未加载该修改，必须人工重启后才能验证是否只注入一次 Skill；
- 不要在真实任务运行中重启 MCP 或 DSH。

机器上仍可能存在历史 8000 plan-flow，它来自 `D:\dj\data-juicer-agents\.venv`，不是当前 DSH patch 指向的 8010。诊断时必须按监听端口和进程命令行确认目标，不能只看进程名。

## 13. 已解决的故障

### `ModuleNotFoundError: datasets`

曾用 base Python 启动 DJ。当前启动器固定使用 `D:\dj\.envs\dsh-dj\python.exe`。

### editable 安装要求 Microsoft Visual C++ 14+

本地项目的构建依赖触发原生编译。不要在 base 环境反复 editable 安装整个项目；使用已经准备好的隔离环境。

### stdio `Invalid JSON: EOF`

手动启动 stdio MCP 后输入空行或关闭 stdin 会产生不完整 JSON-RPC。stdio 给客户端托管，不是交互式终端。正式 DSH 使用 streamable HTTP。

### 把 JSON MCP 配置粘到 PowerShell

`"mcpServers": {...}` 是配置文件内容，不是 PowerShell。当前使用 `dj-dsh.patch.yml`。

### PowerShell 5.1 没有 `Start-Process -Environment`

启动器已改成临时设置父进程环境、启动子进程继承，再恢复父进程。

### `ArgumentList` 含 null

启动器已过滤空的额外 DSH 参数。

### 错误工作区

旧实现把 MCP 源码目录当工作区。现改为每次传当前 DSH 工作区，cwd 不参与业务路径解析。

### DSH 读取 `.env`

旧 Skill 暴露具体文件路径，模型自行 Read。现已删除该提示，要求只看 MCP `runtime`，并禁止读取环境文件。

### VLM 模型误判

不能按名字是否含 `vl` 判断视觉能力。现由 MCP 返回服务器声明的模型角色并物化默认模型。

### 精确算子名仍搜不到

根因是 tag 过滤早于 BM25。现已加入媒体模态与 `multimodal` 兼容映射，以及精确算子名直接返回。

### 单个 DSH 会话历史加载失败

错误：

```text
history unavailable for session "session-3ab5d1c5-4775-4028-b0c2-850115a1723c"
corrupt session log: seq gap in committed region at line 5 (expected 4, got 3)
```

对应文件：

```text
C:\Users\hu\.dsh\sessions\--D-shishi--\
session-3ab5d1c5-4775-4028-b0c2-850115a1723c\session.jsonl.zstd
```

只读解压验证显示文件可解压、共 1867 行、末尾仍完整到 `seq=9802`；损坏位于开头：

```text
seq=0  permission/preset
seq=1  sandbox/mode
seq=2  approval/policy
seq=3  session/end-seed
seq=3  agent/inbox/spliced
seq=4  turn/start
...
seq=9802 turn/end
```

时间线表明 session 创建后先写入 `session/end-seed seq=3`，数小时后实际对话又从 `seq=3` 开始。重启前内存状态仍可使用，重启后严格从磁盘校验才暴露错误。其他历史会话仍在，因为每个 session 是独立文件。

同时曾发现 6 个 DSH Web 进程共享 `C:\Users\hu\.dsh\sessions`；多个旧页面/Server 共用日志增加了竞态和错误续写风险，但尚不能证明这是 DSH 内部 `end-seed` bug 的唯一原因。

该 session 尚未修复。安全恢复方案：

1. 停止所有 DSH Web；
2. 备份原始 `.zstd`；
3. 解压 JSONL；
4. 只删除无数据的 `session/end-seed seq=3`；
5. 保留实际首轮的 `agent/inbox/spliced seq=3`；
6. 重新压缩并加载；
7. 不要把第二个 3 改成 4，否则后面全部序号和缓存终点都会错位。

目前没有发现 DSH 自带 session repair 命令。恢复前必须保留原文件，且不要在 DSH 仍运行时编辑会话日志。

## 14. 验证状态

测试文件：

```text
D:\dj\data-juicer-1.5.4\tests\tools\plan_flow\test_plan_flow.py
```

已验证：

- 动态工作区相对路径解析；
- runtime 不泄漏 secret；
- API VLM 自动物化默认模型；
- 精确算子名置顶和媒体/multimodal 兼容检索；
- Plan 版本不可变和 diff；
- 无效 Plan 不能批准；
- 未批准不能运行，篡改可检测；
- 后处理快照且不进入 recipe；
- MCP 只暴露九工具；
- 完整批准、DJ 执行和报告链路。

最近结果：10 个快速测试通过；1 个完整执行测试单独通过。

2026-08-25 追加的活环境验证：

- 直接通过 MCP Client 调用 `http://127.0.0.1:8010/mcp`；
- 精确查询 `image_tagging_vlm_mapper`、`modality=image`、`top_k=1`，返回列表只有该算子；
- runtime 返回 API credential/base URL/VLM model 均已配置，默认模型为 `qwen3.7-plus`；
- 当前 DSH Web 57035 返回 HTTP 200；
- 修改后的 `web-dj.ps1` 在 Windows PowerShell 5.1 下解析通过；
- 复用 57035 前后 DSH Web 进程数均为 1；
- 用 8010 作为错误的 Web 端口测试时，启动器正确识别其拥有者不是预期 DSH Web 并退出非零。

尚缺的回归测试：

- 一次完整 schema 检索的响应体预算和需求归并效果；
- exact-name 兜底和服务端 `top_k=5` 硬上限；
- 中文/跨语言零命中不能直接误报确定能力 gap；
- material 参数与下游依赖校验；
- stats sidecar 关联字段、一对多和复合键；
- DSH session 日志 `end-seed` 重复的上游修复或最小复现。

已知非阻塞警告：Pydantic Settings 的 `IncompleteFieldDefinitionWarning`，以及 DJ 某些字符串的 `SyntaxWarning: invalid escape sequence`。

## 15. 当前进度和未提交状态

### V2 当前状态（2026-08-27）

当前重点已从“搭建 Plan-First MCP”推进到“收敛需求澄清策略并解决 Agent 思考过久”。本轮已经完成：

- 中英文 plan-flow Skill 都加入 TaskSpec、Material Ambiguity、两阶段澄清和每轮 1–3 问的规则；
- TaskSpec 状态明确为 `draft -> discovery_ready -> plan_ready`；输入目录、数据规模、格式、运行环境和能力清单等可探测事实留给 `inspect_input`、`search_capabilities` 或环境探测，不在 discovery 前询问；
- `ask_user_question` 可用时优先使用；不可用时允许普通文本提问，不再因为缺少某一种交互形式而停止规划；
- Mnemon 的 USER 记忆已从“尽可能穷尽澄清”更新为相同的 Material Ambiguity 原则，避免全局偏好与 Skill 冲突；
- 已从 `dj-dsh.patch.yml` 删除顶层重复 `tool-skill`，保留标准 Agent preset 中的 Skill 工具，目标是消除同一 Skill 每次加载两份的问题；
- 已分析慢会话日志：工具耗时只有毫秒级，主要时间消耗在模型输出与推理，尤其是第三步约 218 秒、12,282 个输出 token，最终一次提出 5 个问题；因此当前瓶颈不是 MCP 网络或工具执行。

尚未完成的是重启后的实测。当前 57035 仍是修改 patch 之前启动的 Node 进程，因此“重复 Skill 注入是否消失、澄清是否缩短、首轮是否只问真正阻塞项”都还不能宣布验证通过。8010 当前是 `D:\dj\.envs\dsh-dj\python.exe -m data_juicer.tools.mcp_server plan-flow ... --port 8010`；8000 是历史环境，不是当前 patch 目标。

本轮相关文件为：

```text
D:\dsh-app
  .dsh/skills/data-juicer-plan-flow-zh/SKILL.md
  .dsh/skills/data-juicer-plan-flow-zh/references/task-spec-and-clarification.md
  .dsh/skills/data-juicer-plan-flow/SKILL.md
  .dsh/skills/data-juicer-plan-flow/references/task-spec-and-clarification.md
  dj-dsh.patch.yml
  DJ_DSH_HANDOFF.zh-CN.v2.md
```

`D:\dj\data-juicer-1.5.4` 当前没有本轮 plan-flow 核心文件改动，只看到原有 demos 修改和未跟踪 `data-juicer-hub/`。两边都可能存在用户的其他改动，接手时必须重新运行 `git status --short`，不得按本文列表清理工作区。

### 2026-08-25 历史状态

Plan-First MCP 主体已实现，不再处于“讨论方案 B”阶段。工作区、Plan 版本、审批 hash、异步运行、API/VLM 注入、双 UI 确认和算子检索修复均已落地。

旧 8010 已停止并重启，精确 VLM 算子检索在活 MCP 上验证通过；旧的多个 DSH Web 也已清理到只剩 57035。因此原文“先重启 8010”的下一动作已经完成。

当前阶段是“稳定接口并完成真实验收”，不是继续搭架构。最先要处理的是：

1. 对损坏 session 做备份恢复，或者明确放弃该 session 并新建干净会话；
2. 更新 Skill/tool 描述：使用简短英文原子能力词、归并共享同一实现的业务判断、默认不主动请求超过 5 个候选；exact-name 只作为召回失败兜底；
3. 再跑真实小样本任务，观察 DSH 是否能在一次完整 schema 检索中选中 API `image_tagging_vlm_mapper`、生成任务相关 prompt 并合理分配 DJ/后处理；
5. 根据真实失败决定是否实现 material 参数和 stats 输出方案，不要一次引入尚未证明必要的大型 contract 层。

本文更新时两个仓库都有未提交改动。重要项包括：

```text
D:\dj\data-juicer-1.5.4
  data_juicer/tools/plan_flow/discovery.py
  data_juicer/tools/plan_flow/validation.py
  skills/data-juicer-plan-flow/SKILL.md
  tests/tools/plan_flow/test_plan_flow.py

D:\dsh-app
  .dsh/skills/data-juicer-plan-flow-zh/SKILL.md
  .dsh/skills/data-juicer-plan-flow/SKILL.md
  web-dj.ps1
  DJ_DSH_HANDOFF.zh-CN.md
  DJ_DSH_HANDOFF.md（同步后）
```

`D:\dj\data-juicer-1.5.4` 还有多项 demos 文件修改和未跟踪 `data-juicer-hub/`，不属于本轮 plan-flow 核心改动，不能顺手覆盖或清理。`D:\dsh-app` 还有未跟踪 `docs/`。这些均按用户已有工作处理。

接手后仍要在两个仓库分别运行 `git status --short`，不要把上面列表当永久事实。

## 16. 下一步计划

1. 确认没有真实任务运行后，人工关闭当前 57035 DSH Web，并重新运行 `D:\dsh-app\web-dj.cmd`，让新的 `dj-dsh.patch.yml` 生效；不要只刷新浏览器。
2. 新建干净 DSH 会话，不复用已经注入旧 Skill/旧记忆的慢会话。
3. 在新会话显式加载一次中文 plan-flow Skill，检查 session 日志中的 `skill-invocation`，确认同一 Skill 不再注入两份。
4. 用相同最小复现任务测试 discovery 前澄清。若目录实际有 6 个视频而用户说“两个”，首轮应只确认处理范围，不应同时追问输出格式、阈值、类别细节等后续问题。
5. 从 session 日志比较总耗时、各 step 耗时、`usage.outputTokens`、最终问题数和工具耗时；以旧会话约 304 秒、第三步约 218 秒/12,282 输出 token 作为基线。
6. 范围明确后再调用 `inspect_input` 和 `search_capabilities`；根据发现结果只追问新出现且由用户决定的 Material Ambiguity。
7. 达到 `plan_ready` 后展示结构化 TaskSpec 摘要和验收标准，获得确认后再进入 Pipeline 规划。
8. 如果去重注入和规则收敛后仍然很慢，再单独评估降低 thinking 强度、换更快模型或设置更严格输出预算；不要在尚未验证重复注入前同时改动多个变量。
9. 澄清性能验收通过后，继续小规模端到端验证 Plan 保存、审批、执行、报告，以及 `plan_v001 -> plan_v002` 的 diff 和重新审批。
10. 基于真实失败再决定 stats 关联、material 参数校验、报告增强和 DSH 侧硬审批桥接，不要提前扩张 contract。
11. 最后分别审查两个仓库 diff，只提交本项目相关文件，保留 demos、`data-juicer-hub/`、`docs/` 等用户已有改动。

## 17. 不要重复踩的坑

1. 不要把历史测试工作区写进代码、Skill、启动器或提示词。
2. 不要把 MCP 源码目录或 cwd 当业务工作区。
3. 不要使用全局可变 `set_workspace` 服务多个 HTTP 会话。
4. 不要让算子、DSH 或脚本自行读取 `.env`。
5. 不要把 API key 放进 Plan、recipe、工具参数、日志、报告或文档。
6. runtime 缺字段通常表示旧 MCP 未重启，不要读取配置文件兜底。
7. 不要按模型名字符串猜能力或擅自换模型。
8. 不要把 `content_hash` 当真人审批证明；它只绑定内容完整性。
9. 不要把普通“好”“继续”当 Plan 审批，必须使用准确 UI 选项。
10. 不要覆盖旧 Plan；实质修改必须创建新版本。
11. 不要把后处理写进 DJ recipe。
12. 不要无限找算子；聚焦检索后明确 gap。
13. exact query 没结果时先检查 tag 过滤，不要断言算子不存在。
14. 不要在 PowerShell 里交互使用 stdio MCP。
15. 不要把 JSON/YAML 配置当 PowerShell 命令。
16. 不要用 base Python 启动 DJ；确认解释器和 import 路径。
17. 8010 有旧 MCP 时不要误以为 `.env` 或新代码已加载。
18. 不要在真实运行中重启 MCP/DSH。
19. 不要用破坏性 Git 命令或覆盖用户修改的中文 Skill。
20. 不要把某个演示任务硬编码为通用行为。
21. 不要把本地当前源码的搜索结果当作 DSH 活 MCP 的历史结果；先读完整 spill，必要时直接调用 8010。
22. 不要只重启浏览器或 DSH 就以为 Python MCP 加载了新代码；Python 文件、`.env` 或依赖变更都必须停止并重启 8010。
23. 不要只看 tool UI 的截断提示就认定候选在 spill 后半段；对关键故障应 grep 完整 spill。
24. 不要用长中文业务需求直接查询英文 BM25 索引，也不要认为加中文分词就自动解决跨语言语义映射。
25. 不要把自然语言 query 与精确算子名混在同一个字符串；`image_tagging_vlm_mapper generate ...` 不是 exact query。
26. 不要无上限返回候选完整 schema；当前服务端硬限制每项最多 5 个，DSH 还应归并重复需求。
27. 不要因为同属 VLM 就向不同算子注入同一组参数；必须读取选定算子的真实 schema。
28. 下游要用生成标签筛选时，不要采用通用默认 prompt；prompt、标签定义和输出字段是 material 参数。
29. 不要把 `keep_stats_in_res_ds=true` 当作所有输出问题的默认答案；它会同时保留 stats/meta，并可能造成主数据与 sidecar 重复。
30. 不要按 `_stats.jsonl` 行号关联主数据；过滤、重排、分片和扩增都会破坏行号对应。优先用现有媒体路径或复合字段，并声明一对一/一对多。
31. 关闭浏览器标签页不会停止 DSH Web；检查后台 `node.exe ... bin.js web` 和监听端口。
32. 不要同时保留多个 DSH Web 共用 `C:\Users\hu\.dsh\sessions`；旧页面可能继续持有连接或写会话。
33. session 序号损坏时不要直接给后续所有事件加一，也不要删除整个 session；先备份，找出重复/缺失的准确事件。
34. 当前固定入口是 57035 + 8010；8000 是历史进程，不是当前 DSH patch 的 MCP。
35. TaskSpec“足以进入 discovery”不等于所有字段都已知；`discovery_ready` 允许存在 `unknown_discoverable`。
36. 不要把 TaskSpec 当成必须逐字段问完的问卷；字段为空本身不构成 Material Ambiguity。
37. 不要在 discovery 前询问能由目录扫描、数据检查、能力检索或环境探测得到的事实。
38. 不要把后续可能有用的问题与第一个阻塞问题一次性捆绑；若一个问题已经阻塞下一阶段，先只问它。
39. 数值模糊应确认范围，hard/soft 混淆应确认约束等级，主观语义优先用正例、反例和边界案例澄清，不要逼用户发明技术阈值。
40. `ask_user_question` 是优先交互方式，不是规划能否继续的前置条件；不可用时可以简洁文本提问。
41. 不要强制每次完整读取长 reference；核心决策规则应留在 Skill 主文，引用资料按需加载，否则会增加上下文和推理负担。
42. 不要只改 Skill 而忽略 Mnemon 的全局用户记忆；相互冲突的“穷尽澄清”偏好会覆盖或拉扯局部流程。
43. 诊断“思考很久”要先量化 session 中的 step 时间、输出 token 和 tool 时间；本次证据显示主要瓶颈是模型推理/输出，不是毫秒级 MCP 调用。
44. 同一 Skill 被注入两份是实际观察到的问题；删除重复 `tool-skill` 后必须重启 57035 并从日志验证，不能把配置修改本身当成修复完成。
45. 旧会话保存的是当时已经注入的 Skill/记忆内容；验证新规则必须使用新会话。
46. 修改 `dj-dsh.patch.yml` 后刷新页面无效，必须重启后台 DSH Web；修改 Python MCP 则重启 8010，二者不要混淆。
47. Mnemon 的事实源是 `C:\Users\hu\.mnemon\runtime\memories.json`；`USER.md` 是投影，不要直接编辑投影来伪造持久化记忆。

## 18. 建议接手提示词

```text
先阅读 D:\dsh-app\DJ_DSH_HANDOFF.zh-CN.v2.md，并分别检查 D:\dsh-app 与
D:\dj\data-juicer-1.5.4 的 git status，保留所有用户已有改动。
当前重点是验证 TaskSpec/Material Ambiguity 澄清规则和解决 DSH 思考过久。
Skill、reference、Mnemon 记忆和 dj-dsh.patch.yml 已修改，但当前 57035 尚未在
删除重复 tool-skill 后重启。先人工重启 DSH，再用新会话检查单次 Skill 注入，
复现首轮只问真正阻塞项，并从 session 日志比较 step 耗时和输出 token。
验证通过后再继续 inspect_input、search_capabilities、plan_ready 摘要确认和端到端 Plan。
不要把 TaskSpec 当问卷，不要询问可探测事实，不要读取 dj-plan-flow.env，
不要写死工作区，也不要把尚未实现的 stats/material-parameter 讨论当作已经落地。
```
