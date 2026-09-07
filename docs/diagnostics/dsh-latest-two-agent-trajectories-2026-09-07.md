# DSH 最近两条会话 Agent 轨迹与耗时诊断

记录时间：2026-09-07（Asia/Shanghai）  
工作目录：`D:\shishi`  
模型路由：`provider=bl`、`model=glm-5.2`

## 1. 统计口径

数据直接来自 DSH 持久化的 `session.jsonl.zstd` 事件日志。

- **模型阶段**：`step/start → assistant/message`。这是 DSH `sessionStats.llmMs`
  使用的口径，也是目前最接近界面“think”的可观测时间，但不等同于模型内部纯思考时间。
- **TTFT**：`step/start → 第一个非空 text/reasoning/tool delta`。
- **持续生成**：`第一个非空 delta → assistant/message`。
- **工具耗时**：`tool/call → tool/result`。
- `ask_user_question` 的工具耗时主要是等待用户回答，不能算作程序执行时间。
- Token 使用量来自 provider 在 `assistant/message.usage` 中上报的数据。被用户中止且
  provider 未返回 usage 的步骤无法得到精确 token 数，不使用 chunk 数冒充 token 数。
- 本文只记录动作级轨迹和聚合指标，不复制模型的逐字内部 reasoning。

原始日志：

```text
C:\Users\hu\.dsh\sessions\--D-shishi--\session-6862567e-5c0d-4799-8f81-4b70259be7f5\session.jsonl.zstd
C:\Users\hu\.dsh\sessions\--D-shishi--\session-714047d3-ed47-4413-9b04-0893fc820b53\session.jsonl.zstd
```

## 2. 最新会话：6862567e…

会话开始：13:18:02  
结束方式：用户中止  
总计：1 turn、9 steps、23,124 个展开后的持久化事件

| Step | 开始时间 | Agent 动作 / 下一调用 | 模型阶段 | TTFT | 持续生成 | 工具/等待 | 输入 / 缓存读 / 输出 token |
|---|---:|---|---:|---:|---:|---:|---:|
| 1.1 | 13:18:02.122 | 加载需求 Skill | 2.604 s | 0.958 s | 1.646 s | 0.007 s | 505 / 10,112 / 117 |
| 1.2 | 13:18:04.748 | `inspect_input` | 11.993 s | 1.103 s | 10.890 s | 0.017 s | 1,760 / 10,112 / 625 |
| 1.3 | 13:18:16.771 | 提出第一组澄清问题 | 50.843 s | 0.935 s | 49.908 s | 56.225 s 用户等待 | 1,137 / 11,776 / 2,931 |
| 1.4 | 13:20:03.853 | 提出第二组澄清问题 | 14.671 s | 1.719 s | 12.952 s | 26.913 s 用户等待 | 4,111 / 11,776 / 823 |
| 1.5 | 13:20:45.448 | 加载 Plan Flow Skill | 2.626 s | 1.558 s | 1.068 s | 0.009 s | 865 / 15,872 / 70 |
| 1.6 | 13:20:48.098 | `search_capabilities` | 16.229 s | 1.344 s | 14.885 s | 0.084 s | 3,157 / 16,640 / 770 |
| 1.7 | 13:21:04.425 | `get_capability_schemas` | 104.860 s | 1.323 s | 103.537 s | 0.017 s | 4,411 / 19,712 / 5,399 |
| 1.8 | 13:22:49.323 | 判断能力缺口，随后请求 Mapper authoring spec | **538.072 s** | 1.723 s | 536.349 s | **0.037 s MCP** | 13,963 / 16,640 / **28,299** |
| 1.9 | 13:31:47.467 | 读取脚手架后继续设计，尚未形成工具调用 | **65.139 s** | 3.854 s | 61.285 s | 无 | 未上报；已流式产生 15,135 个 reasoning 字符 |

汇总：

- 有 `assistant/message` 的模型阶段：807.037 s；
- 工具总时间：83.309 s，其中 83.138 s 是等待用户回答，程序工具仅 0.171 s；
- provider 已上报：输入 29,909、缓存读 112,640、输出 39,034 token；
- 已上报 token 合计 181,583；Step 1.9 被中止，因此该合计是下限。

authoring spec 的实际调用：

```text
13:31:47.404 call   {"category":"mapper","modality":"image"}
13:31:47.441 result
耗时 37 ms，持久化 result message 约 1.4 KB
```

注意：这个会话里最突出的 538 秒长模型阶段发生在 authoring spec **调用之前**；
spec 返回以后实际只继续了 65 秒，然后用户中止。

## 3. 次新会话：714047d3…

会话开始：13:15:14  
结束方式：Turn 1 因网络错误结束；Turn 2 最终达到 max-tokens  
总计：2 turns、12 steps、25,103 个展开后的持久化事件

| Turn.Step | 开始时间 | Agent 动作 / 下一调用 | 模型阶段 | TTFT | 持续生成 | 工具/等待 | 输入 / 缓存读 / 输出 token |
|---|---:|---|---:|---:|---:|---:|---:|
| 1.1 | 13:15:14.971 | 加载需求 Skill | 4.229 s | 1.918 s | 2.311 s | 0.009 s | 10,634 / 0 / 157 |
| 1.2 | 13:15:19.226 | `inspect_input` | 8.621 s | 1.079 s | 7.542 s | 0.020 s | 1,305 / 10,624 / 468 |
| 1.3 | 13:15:27.881 | 提出澄清问题 | 53.705 s | 1.979 s | 51.726 s | 27.474 s 用户等待 | 913 / 11,904 / 3,025 |
| 1.4 | 13:16:49.078 | 模型请求失败，重试 5 次 | 无完整消息 | 无 token | 无 | 22.861 s 生命周期 | 未上报 |
| 2.1 | 13:17:27.946 | 继续提出澄清问题 | 35.568 s | 2.651 s | 32.917 s | 16.872 s 用户等待 | 5,282 / 10,624 / 2,050 |
| 2.2 | 13:18:20.399 | 加载 Plan Flow Skill | 3.200 s | 1.564 s | 1.636 s | 0.011 s | 2,110 / 15,872 / 126 |
| 2.3 | 13:18:23.627 | `search_capabilities` | 14.316 s | 1.684 s | 12.632 s | 5.717 s | 3,178 / 17,920 / 819 |
| 2.4 | 13:18:43.676 | `get_capability_schemas` | 39.184 s | 1.425 s | 37.759 s | 0.015 s | 3,542 / 20,992 / 2,321 |
| 2.5 | 13:19:22.889 | 聚焦缺口后再次检索 | 47.491 s | 2.318 s | 45.173 s | 0.020 s | 10,266 / 17,920 / 2,843 |
| 2.6 | 13:20:10.418 | 获取目标 schema | 30.891 s | 5.569 s | 25.322 s | 0.012 s | 21,599 / 10,624 / 1,539 |
| 2.7 | 13:20:41.338 | 请求 Mapper authoring spec | 7.457 s | 3.589 s | 3.868 s | **0.012 s MCP** | 1,880 / 32,128 / 259 |
| 2.8 | 13:20:48.822 | 读取脚手架后持续 reasoning，未形成工具调用 | **491.831 s** | 1.311 s | **490.520 s** | 无 | 605 / 33,920 / **32,768** |

汇总：

- DSH 统计到的完整模型阶段：736.493 s；
- 工具总时间：50.162 s，其中 44.346 s 是等待用户回答；
- 真正程序工具耗时 5.816 s，其中一次 `search_capabilities` 占 5.717 s；
- provider 已上报：输入 61,314、缓存读 182,528、输出 46,375 token；
- 已上报 token 合计 290,217；
- Step 2.8 恰好输出 32,768 token，随后 `turn/end.reason=max-tokens`。

authoring spec 的实际调用：

```text
13:20:48.796 call   {"category":"mapper","modality":"image"}
13:20:48.808 result
耗时 12 ms，持久化 result message 约 1.4 KB
```

## 4. 为什么 authoring spec 后显示长时间 think

结论：**MCP 没有卡住，模型在高速但过量地生成 reasoning。**

证据链：

1. 两次 MCP 都在 40 ms 内返回；
2. spec 返回后的模型调用分别在 1.311 s 和 3.854 s 内出现首个 reasoning delta；
3. 次新会话后续只有 reasoning delta，没有 text delta、tool-call delta；
4. 该步骤在约 8 分 12 秒内生成 32,768 个输出 token，然后明确以
   `max-tokens` 结束；
5. 对应持续生成速度约 66.8 token/s，并不是 provider 吞吐异常；
6. 最新会话中，spec 调用前一个步骤也产生了 28,299 输出 token，说明过度推理
   在读取 spec 之前已经出现，并非 spec 内容本身触发；
7. spec 返回消息只有约 1.4 KB，排除“大型 MCP 返回体导致解析缓慢”。

最可能的形成条件：

- 当前路由使用 `glm-5.2`，单步输出上限为 32,768；
- 任务同时涉及人脸数量、清晰度、面积占比、NSFW、水印、美学评分和统计输出；
- Agent 拿到通用 Mapper scaffold 后，需要一次性生成完整源码、参数 schema、依赖和
  validation contract；
- Skill 规定“从 scaffold 生成完整源码”，但没有限制下一步 reasoning token、源码规模
  或必须在多少 token 内进入 `develop_custom_operator`；
- 因而模型在单个 reasoning block 中持续推演实现，没有跨越到 tool-call block。

两条会话从 13:18 到 13:29 还存在并发。并发可能降低部分吞吐，但不是主因：两个长步骤
仍分别达到约 52.8 和 66.8 输出 token/s，墙钟时间主要由生成了数万 token 决定。

### 4.1 Step 2.8 实际在推演什么

该步骤没有开始写可提交的工具参数，而是在 reasoning 中反复处理以下主题：

1. 设计一个名为 `image_face_mask_blur_mapper` 的人脸局部模糊算子；
2. 在 Haar 椭圆遮罩、GrabCut、MediaPipe landmarks、BiSeNet face parsing 等方案间取舍；
3. 评估 OpenCV、MediaPipe、Transformers、Torch 等依赖在账号隔离环境中的可用性；
4. 推演 Mapper 构造函数、`self.image_key`、`process_single` 和 DJ 注册方式；
5. 设计人脸、NSFW、水印、美学过滤器的执行顺序；
6. 解决“Filter 删除样本后，怎样仍为被删除样本输出实际分数、删除原因和阶段计数”；
7. 在重新推理被删除图片、宽阈值保留全部样本、先标记后删除、后处理清理等多套
   Pipeline 设计之间来回切换；
8. 反复讨论应在生成个人算子前还是之后向用户请求方案确认；
9. 思考 validation contract 和测试样本，但始终没有收敛为一次工具调用。

日志中的量化特征与此一致：135,909 个 reasoning 字符中，`face` 出现 444 次、
`filter` 174 次、`nsfw` 133 次、`validation` 101 次、`mapper` 62 次，且出现大量
“wait / maybe / reconsider”式回退。整个步骤的流式事件只有 reasoning delta，
`text-delta=0`、`tool-call-delta=0`，结尾仍在比较新的 Pipeline 变体。因此它不是
“代码已经写好但工具发送慢”，而是一直没有完成设计决策。

### 4.2 人脸模糊需求存在，问题是阶段污染

人脸模糊是本任务的真实需求，因此请求 `mapper/image` authoring spec 是合理的，不能据
首条可见消息没有完整重述业务上下文就判断为需求漂移。为了让审计记录不依赖隐含上下文，
后续仍应在 requirement-ready TaskSpec 中把“仅对最终保留图片做人脸区域模糊、非人脸区域
不得主动模糊”列成明确的原子需求，再由用户整体确认。

真正的问题发生在 authoring spec 返回以后：Agent 没有锁定“当前只开发一个最小 Mapper”
的阶段，而是重新打开了整个 Pipeline 设计，把人脸模糊实现、过滤顺序、被删除样本报告、
阶段计数、postprocess 和审批顺序同时放进一个 reasoning 步骤。真实需求本身没有问题，
问题是算子开发阶段被其他尚未到期的规划问题污染。

正确轨迹应该是：

```text
确认包含人脸模糊在内的完整 TaskSpec
→ 检索并确认已有 face / NSFW / watermark / aesthetics 能力
→ 将人脸模糊缺口冻结为一个最小 Mapper 工作项
→ get_custom_operator_authoring_spec
→ 直接从 scaffold 填充 source + validation_contract
→ develop_custom_operator
→ 验证成功后再设计 Plan 和报告
```

应先只完成最小 `image_face_mask_blur_mapper` 的源码与验证，不应在同一步同时解决被删除
样本报表、阶段计数、后处理清理和 Plan 审批顺序。

## 5. 当前可以记录到什么程度

现有 DSH 日志已经足以离线还原：

- turn/step 起止；
- 模型路由；
- TTFT、持续生成和完整模型阶段；
- 每个工具的名称、参数、call/result 时间和耗时；
- provider 上报的输入、缓存读、缓存写、输出 token；
- retry、transport error、user abort、max-tokens 等终止原因；
- reasoning/text/tool-call 各类流式 chunk 的数量和字符量。

现有缺口：

- 被中止的模型调用通常没有 provider usage，只能标记“未上报”或另做启发式估算；
- 日志不能揭示模型内部在首 token 之前的纯计算时间，只能准确记录 TTFT；
- 页面没有把 TTFT、reasoning token 增长、工具执行和用户等待拆开显示；
- 目前没有现成的“一键导出逐步轨迹”报告，需要离线解压和聚合。

## 6. 建议修改

1. 参照 DJAgent，把 authoring spec 当成待填写模板，而不是新的方案设计阶段：返回后直接
   替换名称、类名和 `process_single` 实现，并调用 `develop_custom_operator`。
2. 在 Plan Flow Skill 中明确：spec 返回后的下一次外部动作就是
   `develop_custom_operator`；本步不得讨论 Pipeline、postprocess、报告或审批顺序。
3. 个人算子只实现被冻结的单一职责；报告和阶段计数留到算子验证成功后的 Plan 阶段。
4. 增加轨迹回归用例：`get_custom_operator_authoring_spec` 的下一次工具调用必须是
   `develop_custom_operator`，且提交源码来自返回的 scaffold。
5. UI 可另外把状态拆成 `等待首 token / reasoning 流式生成 / 工具执行 / 等待用户 /
   retry`，但它属于可观测性增强，不是修复 authoring 流程的前置条件。
6. 增加只读轨迹导出器，以 Markdown/JSON 输出本报告中的逐步数据；原始 session 日志继续
   作为唯一事实来源。

## 7. 追加诊断：为什么首次都没有召回 image_face_count_filter

两条会话首次搜索的 Built-in BM25 结果中，`image_face_count_filter` 实际都排在第 3 名：

```text
detect human faces ... face count bounding boxes ...
=> image_segment_mapper, image_detection_yolo_mapper, image_face_count_filter

face detection filter ... exactly one face and face area ratio ...
=> image_face_ratio_filter, phrase_grounding_recall_filter, image_face_count_filter
```

相同参数连续执行两次得到完全相同的顺序，因此这不是随机召回。

问题发生在 DJ Built-in 和 User Custom Catalog 的融合阶段：

1. `top_k` 被限制为最多 3；
2. Built-in 和 User 分别形成候选组；
3. 每个组都从 rank 0 重新计算 `1 / (60 + rank)`；
4. 当前账号只有一个个人算子 `image_watermark_remove_mapper`，只要与 query 有任意 token
   重合，就成为 User 组 rank 0；
5. 融合排序把 reciprocal rank 放在 `validated` 和 `provider=dj` 之前；
6. 因此这个 `experimental` 个人算子即使 `match_score=0`，仍占据总榜第 2 位；
7. Built-in 第 3 名 `image_face_count_filter` 随后被 `fused[:top_k]` 截掉。

两条真实首次返回均体现了这个顺序：

```text
Built-in 第 1 名
User image_watermark_remove_mapper（match_score=0）
Built-in 第 2 名
```

后续会话 `714047d3…` 又做了一次针对性检索：

```text
filter images keeping samples with exactly a specified number of detected faces
```

该 query 让 `image_face_count_filter` 升为 Built-in 第 1 名，所以能够保留在最终 top 3。
会话 `6862567e…` 没有执行第二次针对性检索，而是在一次综合查询后直接判断存在能力缺口，
随后请求了 image Mapper authoring spec，因此仍未召回。

`get_capability_schemas` 本身不限制只取 Top 1，而是接收 Agent 选出的数组。真实轨迹为：

```text
6862567e…
get_capability_schemas([
  image_face_ratio_filter,
  image_nsfw_filter,
  image_watermark_filter,
  image_aesthetics_filter
])

714047d3… 第一次
get_capability_schemas([
  image_face_ratio_filter,
  image_nsfw_filter,
  image_watermark_filter,
  image_aesthetics_filter,
  image_face_blur_mapper
])

714047d3… 针对性复检后
get_capability_schemas([image_face_count_filter])
```

因此正确算子不必成为 Top 1，但必须先存在于融合后的最终 Top 3，并被 Agent 选进 shortlist。
本例中它在融合前是 Built-in 第 3，融合后被截掉，Agent 无法看到其 description，也就不能
选择其 schema。

`6862567e…` 没有复检还有一个明确的指令原因：当前 Plan Flow Skill 规定“正常检索每个
TaskSpec 版本最多一次”。它把“检测人脸、返回数量、框和置信度”错误合并成一个复合查询，
首次结果缺少 count filter 后，按 Skill 的单次检索约束直接进入 gap/custom-operator 分支。
`714047d3…` 在检查首轮 schema 后，自行把缺口改写为两个更窄的查询并再次调用搜索，实际上
突破了“最多一次”的正常流程约束。这一行为目前依赖模型临场判断，所以两条会话表现不一致。

这说明问题有两个层次：

- **Catalog 排序缺陷**：低相关甚至零分的个人算子不应挤掉更相关的 Built-in 候选；
- **Agent 查询缺陷**：应把“检测框/置信度”“恰好一个人脸”“人脸面积占比”拆成独立的
  Atomic Requirements，并在判断 gap 前做一次针对性复检。

建议修复：

1. User 候选必须达到正相关阈值，`match_score <= 0` 不进入融合；
2. 融合排序应使用可比较的相关分数，不能让每个 provider 的 rank 0 天然等价；
3. 优先保留每个 requirement 的高相关 validated Built-in，再用 User Catalog 补缺；
4. 不要在融合前后都使用相同的 `top_k=3` 硬截断，可先扩大召回池再统一重排；
5. 增加回归用例：存在一个仅共享通用 `image` token 的 experimental user mapper 时，
   `image_face_count_filter` 仍应出现在“exactly one face”查询结果中；
6. Skill 增加规则：综合 requirement 未命中精确算子时，按 Atomic Requirement 改写并复检
   一次，复检仍缺失后才允许生成自定义算子。

实施状态（2026-09-07）：已在统一 catalog 中加入去停用词后的 User 查询覆盖阈值，并改为
按相关度优先、成熟度和 provider 同分优先的统一排序；已同步修改中英文 Plan Flow Skill，
采用最小充分 Top 1–3 shortlist，并在生成自定义算子前强制执行一次 gap-only 原子需求复检。
