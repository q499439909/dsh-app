# DSH 数据处理 Agent 优化记录与测试复盘

> 更新日期：2026-09-07  
> 代码范围：`D:\dsh-app`、`D:\dj\data-juicer-1.5.4`  
> 文档目的：记录近期数据处理对话测试中已经实施的修改、验证依据、踩坑经验，以及尚未实施的后续优化，避免把计划中的能力误认为已经完成。

## 1. 背景与目标

近期测试集中在一类典型图片处理任务：按人脸数量、人脸面积占比、NSFW、水印、美学质量等条件过滤图片，并对保留图片的人脸区域做模糊，同时输出逐图分数、删除原因和阶段计数。

测试暴露出的核心矛盾不是 Data-Juicer 算子本身无法工作，而是 Agent 在“需求确认—能力检索—方案确认—计划生成—执行—验收”之间缺少足够明确的收敛规则和执行前检查，导致：

- 已经具备决策信息后仍持续思考；
- 搜索结果和 schema 重复占用上下文；
- 把组合、报告问题过早判断成自定义算子 gap；
- 到执行阶段才发现 CPU、依赖、模型下载或源码接口问题；
- 连接恢复后重复已经完成的分析；
- 正式长任务跑完后才发现输出契约或后处理错误；
- 运行监控依赖 Agent 高频轮询，消息多、上下文大、体感拖沓。

优化目标是让普通原生可达任务稳定走下面的短路径：

```text
inspect_input
→ requirement_ready
→ 一次批量 search_capabilities
→ 一次批量 get_capability_schemas（仅 shortlist）
→ 候选方案与验收映射
→ 用户确认
→ prepare_plan / approve_plan
→ Runtime 预检
→ 执行与验收
```

## 2. 已实施修改

### 2.1 需求阶段：锁定已明确需求，减少重复确认

涉及文件：

- `D:\dsh-app\.dsh\skills\data-juicer-requirements-zh\SKILL.md`

已经加入的规则：

- 用户明确给出且未被输入事实否定的目标、范围、输出、语义边界、约束和验收标准，标记为“已锁定需求”。
- 不得只因为 Agent 想到更严格的解释，就重新打开已锁定需求。
- 只有 `inspect_input` 返回与既有需求直接冲突的事实时，才允许重新询问，并必须展示冲突证据。
- `inspect_input` 后若没有用户所有的实质歧义，直接生成 `requirement_ready` 摘要，不再为了补齐 TaskSpec 字段而提问。
- 增加快速收敛路径：

```text
inspect_input → requirement_ready 摘要 → 用户确认
```

这项修改解决的是“用户已经讲清楚，Agent 仍不断确认输出目录、破坏性策略或更严格语义”的问题。

### 2.2 检索层：加入保守的英文词形归一化

涉及文件：

- `D:\dj\data-juicer-1.5.4\data_juicer\tools\op_search.py`

已经加入：

- BM25 索引和查询保留原 token；
- 对以 `s` 结尾的英文词增加保守单数别名；
- 排除 `ss`、`us`、`is` 等常见非复数结尾，降低错误截断；
- 搜索结果携带原始 BM25 `score`。

直接修复的测试问题：

```text
image aesthetic quality scoring
```

此前查询中的 `aesthetic` 可能无法匹配目录里的 `aesthetics`，导致漏召回 `image_aesthetics_filter`，Agent 随后把美学评分误判为 capability gap。加入归一化后，两种词形可以建立匹配。

这里采用的是小范围、可解释的词形别名，不是引入重量级 NLP lemmatizer。这样启动成本低，也更容易控制误召回。

### 2.3 搜索结果限制为每条需求 Top 3

涉及文件：

- `D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\discovery.py`
- `D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\server.py`
- `D:\dsh-app\.dsh\skills\data-juicer-plan-flow-zh\SKILL.md`
- `D:\dsh-app\.dsh\skills\data-juicer-plan-flow\SKILL.md`

修改内容：

- 服务端硬上限从 Top 5 调整为 Top 3；调用方传入更大的 `top_k` 也不会突破上限。
- 多个原子需求仍通过一次批量调用完成。
- 同一个算子命中多个需求时跨需求去重，并累积 `matched_requirements`。
- exact-name 命中保留确定性快路径。

Top 3 是候选上限，不是要求 Agent 把三个候选全部送去查 schema。Skill 已要求：

- 高分候选完整覆盖需求时，通常只选 Top 1；
- 不同候选分别覆盖需求的不同部分，或 description 存在真实歧义时，才保留 Top 2；
- 不得机械地把全部 Top 3 传给下一步。

### 2.4 明确拆分 `search_capabilities` 与 `get_capability_schemas`

涉及文件：

- `D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\discovery.py`
- `D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\server.py`
- DSH 中英文 plan-flow Skill

修改后的职责如下：

| 工具 | 用途 | 返回内容 |
|---|---|---|
| `search_capabilities` | 发现和排序候选 | `name/candidate_id`、`type`、`tags`、完整 `description`、`match_score`、`matched_requirements`、身份字段 |
| `get_capability_schemas` | 验证选中候选能否真实配置和执行 | `name`、`type`、`parameters` |

搜索不再返回：

- signature；
- 参数树；
- 参数说明的大段重复内容。

schema 不再重复：

- description；
- tags；
- 搜索分数；
- 匹配需求。

正确调用方式是：

```text
每条需求搜索 Top 3
→ Agent 根据 description、score 和覆盖关系选 Top 1/2
→ 将所有需求的 shortlist 去重
→ 一次批量 get_capability_schemas
```

不是“搜索返回 Top 3 后只把全局第一个算子交给 schema”，也不是“把所有 Top 3 全部查一遍”。shortlist 的选择单位是每条原子需求，schema 查询在跨需求去重后批量完成。

### 2.5 增加检索后的强制收敛规则

涉及文件：

- `D:\dsh-app\.dsh\skills\data-juicer-plan-flow-zh\SKILL.md`

已经加入：

- 每个确认后的 TaskSpec 正常只允许一次能力检索。
- 重新打开需求时必须展示与既有验收标准冲突的 schema 或运行约束。
- 已加载 schema 足以覆盖全部验收标准，并且没有新 Material Ambiguity 或 capability gap 时，必须立即展示候选方案。
- 此时禁止继续换词检索、重复加载 schema，或以内审为理由延迟输出方案。
- 增加“低难度原生可达快路径”，明确原生算子已经覆盖时不再做扩展探索。

这部分是针对“思考内容一开始已经列出正确算子，但之后仍思考很久”的直接约束。

### 2.6 增加 `prepare_plan` 前结构自检

涉及文件：

- `D:\dsh-app\.dsh\skills\data-juicer-plan-flow-zh\SKILL.md`

调用 `prepare_plan` 前要求在内存中验证：

- `recipe.process` 必须是列表；
- 每项必须是只含一个算子名的映射；
- 参数必须放在对应算子名之下；
- `postprocess` 位于 Plan 顶层，不能放进 recipe；
- `view_spec.groups[*].process_indexes` 必须连续、无重复、无越界；
- 修订时必须同时提供原 `task_id` 和上一版 `base_plan_version`。

目的不是增加一轮模型讨论，而是避免用错误结构调用工具、收到报错后再反复修复。

### 2.7 自定义算子：改为版本感知的受控开发闭环

涉及的主要文件：

- `D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\operator_authoring.py`
- `operator_catalog_service.py`
- `user_operator_store.py`
- `user_operator_validation.py`
- `user_operator_runtime.py`
- `user_operator_worker.py`
- `D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\server.py`
- DSH plan-flow Skill

新增或接入的工具流程：

```text
确认真实 gap
→ get_custom_operator_authoring_spec
→ 从当前 DJ 版本的 scaffold 开始生成源码
→ develop_custom_operator
→ get_custom_operator_job
→ 成功后进入当前账号个人算子库
→ 按 candidate_id 查 schema
→ 写入 Plan operator_bindings
```

关键约束：

- 不再凭模型记忆猜 `BaseFilter`、注册方式或 required methods。
- 不允许为找接口而搜索全盘 Python 环境、Anaconda、DJ 源码或互联网。
- `OPERATOR_SOURCE_INCOMPATIBLE` 只根据结构化 diagnostics 修改，最多自动修正两次。
- 验收契约先固定，不允许为了让失败版本通过而换样本、删断言或降低标准。
- 验证前使用临时 samples，不能把测试文件写进正式业务目录。
- 自定义算子验证成功前，不得提前写 postprocess、创建业务输出目录或生成 Plan。
- 不直接修改 DJ 内置算子源码。
- 用户算子按账号隔离，并通过 `candidate_id/operator_id/version` 绑定到 Plan。

这项改造主要解决此前水印算子测试中出现的源码散落、直接修改 DJ、MCP 缓存未刷新、版本状态不清楚和接口猜错等问题。

### 2.8 Runtime 预检：在执行前识别 GPU 阻断

涉及文件：

- `D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\runtime_preflight.py`
- `D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\service.py`
- `D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\runner.py`
- 本地执行后端相关文件

已完成的行为：

- `prepare_plan/get_plan` 返回 `execution_preview` 和 `runtime_assessment`；
- Plan 展示真实 backend、device 解析结果、回退和阻断项；
- 存在 `GPU_REQUIRED` 阻断时，`run_plan` 再次预检并拒绝执行；
- DSH Skill 要求存在 blocking issues 时不得请求用户批准执行；
- 本部署明确使用 native `PlanRunner → LocalProcessBackend → DJ executor`，不再错误地假定必须 Docker 或 broker。

已明确的产品规则是：

- 本机没有 GPU 不代表禁止使用模型；
- 模型支持 CPU 时可以下载并执行；
- 模型不支持 CPU 时，必须在下载前阻止；
- 不允许下载完成后才发现当前设备无法使用。

当前硬件阻断已经进入预检；模型大小、缓存命中和 CPU 预计耗时仍属于后续完善项，见第 5 节。

### 2.9 启动、缓存和用户上下文集成

涉及文件：

- `D:\dsh-app\web-dj.ps1`
- `D:\dsh-app\web-dj.sh`
- `D:\dsh-app\dj-dsh.patch.yml`
- `D:\dsh-app\packages\dsh-user-auth\lib\dj-bridge.js`
- operator library、plan explorer 的服务端代理

相关改动包括：

- 固定 DJ 源码根目录和 Python 路径；
- 将 DSH、MCP、验证 worker 和 native worker 使用的模型缓存环境统一传递；
- 为 Hugging Face 提供统一 `HF_HOME` 默认位置；
- 将当前账号上下文安全传递给 DJ MCP 的内部接口；
- 个人算子目录和 operator catalog 按账号隔离；
- 接入 HTTP fetch provider 和本机代理设置；
- 启动时检查所需插件目录，避免缺插件后静默降级。

本机重启方式：

```powershell
cd D:\dsh-app
.\web-dj.ps1
```

通常可以先关闭页面，再执行脚本。严格来说，关闭页面只关闭浏览器 UI，不保证后台旧进程一定结束；脚本应负责检查并启动所需服务。若遇到端口占用，应先确认 `57035` 和 `8010` 对应的进程，再决定是否停止，不能盲目结束所有 Python 或 Node 进程。

## 3. 测试中踩过的坑

### 3.1 把检索漏召回误判为 capability gap

现象：`image aesthetic quality scoring` 没召回 `image_aesthetics_filter`，Agent 随即认为美学评分没有原生算子。

根因：BM25 是词面匹配，`aesthetic` 与 `aesthetics` 未归一化。

经验：

- 宣布 gap 前，先区分“目录不存在”与“检索没召回”；
- exact operator name 和目录浏览可以作为可证明的召回异常证据；
- 词形归一化应尽量保守，避免用过度 stemming 制造噪声。

### 3.2 搜索和 schema 返回了两遍完整资料

现象：搜索已经返回完整参数资料，随后 schema 又把 shortlist 全量返回，导致用户感觉搜索步骤没有意义。

根因：发现职责和执行契约职责没有分开。

经验：

- 搜索负责“选谁”；schema 负责“怎么配”；
- description 应留在搜索阶段，因为没有用途说明无法做 shortlist；
- 参数树只在 shortlist 确定后获取；
- schema 必须批量查 shortlist，但不能批量查所有搜索候选。

### 3.3 Agent 已经得到答案，却没有停止条件

现象：思考开头已经列出五个正确原生算子，之后仍继续查找、比较和怀疑。

根因：Prompt 中存在大量“需要检查”的要求，却没有完成条件和时间/回合预算。

经验：

- 每一阶段都要同时定义进入条件和退出条件；
- “没有新证据”本身应该触发停止，而不是触发更多自审；
- 对原生可达的简单任务，应规定固定的工具调用上限。

### 3.4 过早把原生组合折叠成自定义算子

现象：人脸数量和人脸面积本来分别有原生 filter，却被折叠进 `face_quality_filter`。

根因：Agent 把“统一报告/统一评分缓存”的方便性误当成算法能力缺失。

经验：

- 先判断原生单算子是否覆盖原子需求；
- 再判断多个原生算子组合能否覆盖；
- 报告、归因和格式转换通常属于后处理，不自动构成 filter gap；
- 只有算法能力本身不存在或已有算子效果经证据证明不足，才进入自定义算子流程。

### 3.5 自定义算子接口靠猜，提交后才发现版本不兼容

出现过的错误包括：

- 猜测 `data_juicer.ops.base_filter`；
- 猜测 `OP_REGISTRY` 和 `compute_stats`；
- 搜索多个 Conda、Python 和 DJ 安装目录；
- 尝试错误 GitHub raw 地址；
- 在验证前写业务脚本和创建输出目录。

经验：

- 当前运行版本必须提供机器可读的 authoring contract；
- 自定义源码必须从 scaffold 生成；
- 兼容性预检应在真实执行前做 AST/import/required-method 检查；
- 错误必须返回具体 phase 和 diagnostics，不能让模型自由探索系统。

### 3.6 无 GPU 与不能执行模型被混为一谈

错误逻辑：无 GPU → 不下载模型。

正确逻辑：

```text
检测模型声明和依赖
→ 判断 CPU 是否支持
→ 判断缓存和下载大小
→ 支持 CPU：说明成本后允许下载
→ 不支持 CPU：下载前阻断
```

经验：设备兼容性必须是能力元数据和 Runtime 预检的一部分，不能依赖 Agent 根据 tags 临时推测。

### 3.7 正式运行后才发现模型很大或网络 HEAD 超时

出现过：

- 美学模型约 1.46GB，在正式 run 中才开始下载；
- 已缓存的 NSFW、水印模型仍发起 Hugging Face HEAD 请求并等待超时；
- Agent 高频读取 `.incomplete` 文件大小，形成大量无价值对话。

经验：

- Plan 批准前展示模型是否缓存、下载量和大致 CPU 耗时；
- 缓存完整时优先 cache-only/offline 加载；
- 长下载由后台 watcher 监控，只在阶段变化、失败或完成时通知 Agent；
- 不应让大模型下载隐藏在某个普通算子步骤里。

### 3.8 没有 canary，后处理契约错误在长任务后暴露

典型错误：

- DJ 默认 `keep_stats_in_res_ds=False`；
- 主输出 `scored.jsonl` 不含 stats；
- stats 位于同行对齐的 `scored_stats.jsonl`；
- 后处理读错文件后产生全 null 报告，并把 10 张图全部删除。

经验：

- 正式执行前用 1～3 条样本跑完整链路；
- canary 不只检查进程成功，还要验证输出字段、兄弟文件、行对齐、报告非空和阶段计数；
- 对 Data-Juicer 的 export 行为应以当前版本源码/契约为准，不能凭经验假设。

### 3.9 JPEG 重编码破坏“非人脸区域像素不变”验收

现象：代码只修改了人脸 ROI，但保存 JPEG 后整张图都有像素变化，严格验收失败。

根因：JPEG 是有损重编码，不能用逐像素相等验证“框外未变化”。

经验：

- 若验收要求框外解码像素完全不变，输出应使用 PNG 等无损格式；
- 验收脚本必须把算法影响和编解码影响分开；
- “代码只操作 ROI”不等于“最终文件的 ROI 外像素未变化”。

### 3.10 文件名不能作为模型判定真值

测试文件名包含 `valid`、`watermark`、`low-aesthetic` 等提示，但模型实际可能：

- 把正常图片判成水印；
- 让 `low-aesthetic` 通过阈值；
- 没识别出 `nsfw-proxy`；
- 检测到的人脸面积与文件名暗示不一致。

经验：

- Pipeline 只能基于图像内容和明确元数据做判断；
- 文件名可作为离线测试标签，但不能进入被测处理逻辑；
- 验收应同时报告“规则忠实执行”和“模型语义质量”，两者不能混为一谈。

### 3.11 模型效果验证不能只看技术成功

水印去除测试中曾出现：模型能运行、文件能输出，但实际 mask 错误、去除效果差。

经验：

- smoke test 只能证明可执行；
- JSON 断言通过只能证明声明字段满足契约；
- 视觉质量需要专门的样本集、前后对比和图像能力评估；
- `validated` 不应被解释成“任意真实图片上的视觉质量已经可靠”。

### 3.12 失败恢复会重复已经完成的推理

连接错误或用户继续后，Agent 曾重复列举候选、重做 gap 判断和重新查资料。

经验：

- 会话必须保存结构化 checkpoint；
- checkpoint 至少包含 TaskSpec 版本、shortlist、已加载 schema、gap、用户确认和下一动作；
- 恢复后只执行 `pending_action`，不能重新开放已关闭的决策。

### 3.13 时间统计把暂停、等待和工具执行混在一起

一次测试显示工具调用 41 分钟，其中约 31 分钟实际上是会话停止后等待用户继续，并非工具占用。

经验：UI 应分别统计：

- LLM 推理；
- 工具真实执行；
- 队列与重试；
- 模型下载；
- Data-Juicer 算子执行；
- 等待用户；
- 会话暂停。

否则用户无法判断究竟是 Agent、MCP、网络还是 DJ 慢。

## 4. 对近期测试数据的判断

几个有代表性的会话指标：

| 测试 | 步骤 | LLM 时间 | 工具时间 | 输入 tokens | 主要问题 |
|---|---:|---:|---:|---:|---|
| 最新图片过滤测试 | 27 | 23分46秒 | 3分30秒 | 约 140万 | schema 后不收敛、查源码、错误自定义接口、未进入 `prepare_plan` |
| 前一次图片过滤测试 | 22 | 19分07秒 | UI 显示 41分25秒 | 约 97万 | 词形漏召回美学算子、暂停时间混入工具耗时、重复分析 |
| 完整图片 Pipeline | 90 | 60分41秒 | 10分37秒 | 约 1100万 | 大模型下载、高频轮询、后处理 stats 契约错误、JPEG 验收错误 |

这些数据说明：

1. 当前首要瓶颈是 Agent 推理和流程空转，不是 DJ 算子执行。
2. 搜索精简能减少上下文，但不能单独解决 10～20 分钟不进入 `prepare_plan` 的问题。
3. 真正影响端到端成功率的是执行前预检、canary 和阶段状态管理。

## 5. 尚未实施或仍需完善的建议

以下内容是建议，不应当理解为当前已经完成。

### P0：阶段状态机和硬预算

建议增加显式状态：

```text
REQUIREMENTS
DISCOVERY
SCHEMA_REVIEW
PLAN_REVIEW
PLAN_PREPARE
PLAN_APPROVAL
RUNTIME_PREFLIGHT
CANARY
RUNNING
VALIDATION
DONE
```

每个状态规定允许调用的工具、进入条件、退出条件和最大回合数。例如：

- `DISCOVERY` 最多一次普通检索；
- `SCHEMA_REVIEW` 最多一次批量 schema；
- 原生完全覆盖后，下一动作必须是 `PLAN_REVIEW`；
- 用户确认候选方案后，下一动作必须是 `prepare_plan`；
- plan 创建前禁止写业务处理脚本和输出目录。

### P0：执行前依赖和模型成本清单

Runtime 预检还应补充：

- `cpu_supported` / `gpu_required`；
- 当前实际 device；
- 依赖是否安装及版本冲突；
- 模型是否已缓存；
- 预计下载字节数；
- CPU 上的粗略耗时等级；
- 是否会进行联网 HEAD/下载；
- 可否启用 offline/cache-only。

### P0：强制 canary gate

正式 run 前对 1～3 条样本验证：

- 所有模型可加载；
- schema 参数能实例化；
- 输出和 stats 文件存在；
- 行数与行对齐正确；
- 报告字段非空；
- 后处理能读取真实输出；
- 输出媒体格式满足验收；
- 单条推理耗时可接受。

### P1：结构化 checkpoint 与恢复

建议保存：

```json
{
  "task_spec_version": "...",
  "requirements_confirmed": true,
  "search_completed": true,
  "shortlist": [],
  "schemas_loaded": [],
  "gaps": [],
  "candidate_plan_confirmed": false,
  "pending_action": "present_candidate_plan"
}
```

模型重试或恢复后直接从 `pending_action` 继续。

### P1：后台运行 watcher

把轮询从对话 Agent 移出，只有以下事件进入会话：

- 模型下载开始且规模较大；
- 算子阶段切换；
- 长时间无进度；
- 自动重试耗尽；
- run 完成；
- 需要用户决策。

### P1：重新设计性能指标

至少拆分模型、工具、下载、算子、暂停和用户等待时间，并展示当前阶段和当前长杆。

## 6. 推荐的回归测试

每次修改流程后，应固定运行下面几组测试。

### 6.1 检索回归

- `image aesthetic quality scoring` 必须召回 `image_aesthetics_filter`；
- `image aesthetics quality scoring` 得到一致的首要候选；
- 每条需求不超过 3 个候选；
- search 响应不含 `parameters/signature`；
- schema 响应不重复 `description/tags`；
- exact operator name 稳定命中自身。

### 6.2 流程回归

- 明确需求只经过一次 `inspect_input`；
- 没有 Material Ambiguity 时不产生额外澄清轮；
- 一次 search、一次 schema 后必须展示候选方案；
- 用户确认后下一步为 `prepare_plan`；
- plan 创建前不得产生业务处理脚本和输出目录。

### 6.3 Runtime 回归

- CPU-only + CPU-compatible 模型：允许计划，提前展示下载成本；
- CPU-only + GPU-required 模型：下载前阻断；
- 已缓存模型：不进行不必要的联网检查；
- 缺依赖：在运行前明确报错，不得自动污染共享环境。

### 6.4 端到端 canary 回归

- `scored.jsonl` 与 `scored_stats.jsonl` 契约正确；
- 报告没有全 null；
- 删除原因与各阶段计数一致；
- 严格像素不变要求使用无损输出；
- 文件名不参与业务判定。

## 7. 当前结论

已经完成的搜索层调整是必要的：词形归一化解决漏召回，Top 3 和 search/schema 分工减少了重复上下文，Skill 中的 shortlist 与强制收敛规则也明确了正常路径。

但要让数据处理 Agent 真正“丝滑”，下一步重点不应继续压缩几个搜索字段，而应转向三个系统问题：

1. 用状态机和硬预算保证已具备证据时立即前进；
2. 在任何下载和正式运行前完成设备、依赖、模型成本预检；
3. 用小样本 canary 提前发现输出契约和后处理错误。

理想体感不是让 Agent 少说几句话，而是让用户始终知道：当前在哪个阶段、为什么需要这一步、下一步是什么，以及哪些昂贵动作尚未发生。
