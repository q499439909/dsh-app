# Trace 84cf1dd9：问题复盘与修改方案

日期：2026-09-11。状态：诊断与方案，尚未实施本轮修复。

对象：[Langfuse trace 84cf1dd9634d3b8c726c372b00231c22](https://jp.cloud.langfuse.com/project/cmtsesk750007ad0frm2llts3/traces/84cf1dd9634d3b8c726c372b00231c22)。

**结论：上轮修复打通了真实审批和首次派发，但没有完成模型准备、失败状态恢复和业务规划的闭环。悬浮提示是新增前端状态区的实现问题；模型权重没有丢失，实际是锁清单要求的辅助文件缺失，加上缓存恢复分支失效。不能把这次失败归因于用户没有下载模型，也不能通过继续增加 skill 指令解决。**

本文列出本条 trace、关联会话、实际制品及定向复现中能确认的问题。“所有问题”限于这些证据覆盖的范围，不承诺发现系统全部潜在缺陷。后续会话证据与本条 trace 的耗时统计分开。

## 1. 直接回答两个现象

### 1.1 为什么有悬浮文字

文字由 [client.js](D:/dsh-app/packages/dsh-dj-plan-explorer/lib/client.js:143) 的 `SessionPlanScope` 生成，组件挂在 `conversation.input.dock`，因此跟随输入区呈现，不属于普通聊天消息。它不是模型生成的回复，也不是用户必须使用的审批界面。

实现存在这些问题：

- 任意一次状态 fetch 异常都会直接显示 `String(error)`，于是 `TypeError: Failed to fetch` 原样出现在产品界面。
- 错误段落位于方案卡片之外，没有独立的收起、重试和连接状态设计，形成突兀的悬浮文字。
- 每 5 秒重试，但没有区分短暂断线、登录失效、权限拒绝、服务退出，也没有超时和请求取消。
- 无条件提示“可使用 confirm_plan 问答确认”。这是内部工具名称；已经审批或已经失败的任务不应再被引导去确认。如果 DSH 服务本身离线，问答也不能充当备用连接。
- 正常情况下，“规划中”也直接显示 `get_plan_contract` 等内部工具名；没有完成事件对应的准确阶段状态，最后一次查询完成后仍可能长期显示“规划中”。

已用真实组件代码注入 fetch 失败复现完全相同的文字。这个复现证明提示的来源与错误处理缺陷，不能证明历史上第一次网络请求失败的底层原因。

**当前网络事实：北京时间 12:19:36，127.0.0.1:57035 无监听，DJ 8010 仍有监听；trace 中的 DSH PID 33584 已不存在。** 这解释当前 DSH 请求为什么失败，但没有历史浏览器 HAR 或进程退出原因，不能断言当时就是 DSH 崩溃、被关闭或代理异常。现有启动日志没有记录退出根因。

### 1.2 为什么已下载模型还报缺失

实际失败：`task_87db875b0081 / plan_v001 / run_r001`，`MODEL_FILE_MISSING: Locked model file is missing or truncated: labels.json`。失败发生在模型准备阶段，尚未处理图片。

本地核验结果：

| 模型 | 主要权重 | 锁清单要求但 snapshot 缺失的文件 | 离线加载验证 |
|---|---|---|---|
| Falconsai/nsfw_image_detection | 343,223,968 字节，存在且哈希匹配 | labels.json，38 字节 | 通过 |
| shunk031/aesthetics-predictor-v2-sac-logos-ava1-l14-linearMSE | 1,219,627,572 字节，存在且哈希匹配 | configuration_predictor.py，1,123 字节；modeling_v2.py，5,006 字节 | 通过 |
| amrul-hzz/watermark_detector | 343,268,717 字节，存在且哈希匹配 | training_args.bin，4,027 字节 | 通过 |

验证使用现有缓存、`local_files_only=True` 和离线设置，加载模型及 processor；没有下载、没有推理业务图片。所有已存在的锁定文件哈希均匹配。合计缺少 **10,194 字节**，不是缺少约 1.9 GB 权重。

因此，用户说“以前下载过，能用”与这次报错并不矛盾：**既有推理路径能够加载模型，但 Plan Flow 的锁定文件清单比该路径实际需要的文件更宽。** 美学模型当前通过已安装的 `aesthetics_predictor` 类加载，不依赖 snapshot 中的两份远程 Python 文件。文件对其他加载方式是否必要必须按具体 loader 判断，不能一概删除。

还有一个确定的代码错误：[huggingface.py](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/model_backends/huggingface.py:54) 先验证已有目录失败，再进入锁，却执行：

```python
existing = self._find(binding)
path = existing or Path(snapshot_download(**kwargs)).resolve()
```

`_find` 只检查目录存在。部分缓存再次被选中，下载函数被短路，最后再次校验并报同一错误。隔离测试中 `offline=False`、缺 labels.json、下载函数可以补齐，结果仍然 **download_calls=0、recovered=false**。

关联会话第 3 轮随后尝试手工下载四个文件，又出现临时目录 `Permission denied` 和 `WinError 1314` 符号链接权限错误；美学模型的两个文件已进入 blobs，却没有形成可用的 snapshot 文件。这个权限问题属于后续修复路径，不是本条 trace 首次失败的直接原因。

## 2. 本条 trace 的时间线

会话：`session-a246802d-184b-4111-8d86-fd3ed235c1a5`；工作区 `D:/shishi`；standard preset；glm-5.2。以下为北京时间。

| 时间 | 事件 | 结果 |
|---|---|---|
| 11:54:46 | 接收图片筛选需求 | 10 张图片，要求包含清晰度、分数、删除原因和阶段计数 |
| 11:54:53 | inspect_input | 明确返回 media_content=not_decoded、quality=not_evaluated |
| 11:55:01 | search_capabilities | 43 ms；这次有单独搜索清晰度 |
| 11:55:17 | get_capability_schemas | 11 ms，取得 5 个算子的契约 |
| 11:56:26 | get_plan_contract | 19 ms，取得新增 image_audit 契约 |
| 11:57:38–51 | grep/glob、shell 枚举、读取旧脚本 | 搜索 DSH 中 image_audit 实现未命中，再枚举工作区及 .dj，找到旧 filter_report.py |
| 12:00:03 | shell 语法检查旧脚本 | 只做 py_compile，未验证报告业务行为 |
| 12:02:58–12:03:02 | prepare_plan | valid=true、环境检查通过、无 blockers；未发现本地模型文件缺口 |
| 12:03:04 | 前端 plan_received | 后端方案已被界面收到；不能说这次完全没有收到方案 |
| 12:03:35–56 | confirm_plan | 用户真实批准，宿主持久化并启动 run_r001 |
| 12:03:59 | worker 模型准备失败 | labels.json 缺失；Run failed，delivery failed，acceptance unverified |
| 12:03:56–12:04:18 | 批准后的模型调用 | 6 次 Connection error，最终整轮以 TRANSPORT 错误结束 |

总耗时 **572.245 秒（9 分 32 秒）**。17 次模型请求，其中 11 次成功、6 次失败；模型请求耗时合计 **529.442 秒**，约占总时长 92.5%；trace 记录输出 token 合计 **33,230**。非确认工具耗时合计 **6.171 秒**，确认工具 **21.038 秒**包含用户等待和宿主操作，不能全部算模型思考。

最慢的四段成功模型请求分别为 69.143、72.219、131.413、174.887 秒，合计约 447.7 秒，集中于契约理解、报告脚本复用及最终编排。搜索响应并不是主要瓶颈。

## 3. 问题清单

| 编号 | 优先级 | 已确认问题与影响 | 证据边界 |
|---|---|---|---|
| F1 | P0 | 原始异常和内部工具指令直接进入输入区；无断线分类及有效恢复按钮 | 真实组件隔离复现；历史网络根因待补证 |
| F2 | P0 | 模型已有目录不完整时，恢复分支跳过下载，必然重复失败 | 实际缓存检查及下载调用次数复现 |
| F3 | P0 | “版本已锁定”被当作“模型可运行”；审批前仅检查依赖与设备，未检查模型文件就绪 | 本条 prepare 返回无 blockers，worker 约 3 秒后即失败 |
| F4 | P0 | 模型锁清单混合了运行必需文件与辅助文件；错误不含模型、revision、完整缺失清单及修复入口 | 三个模型离线加载通过；Run 只报 labels.json |
| F5 | P0 | 成功、失败、取消统一映射为 finished；Run 错误留在嵌套字段，输入区未显示 | 真实 failed Run 重放得到 finished、顶层 error=null |
| F6 | P0 | 幂等限制过度：同一 Plan 的首次 Run 失败后没有正确的新 attempt；再次确认返回旧 running 状态 | 隔离复现；真实会话有 3 次 approval_persisted，但仅 1 次 run_submitted、1 个 Run |
| F7 | P1 | 原生审计与旧脚本重复定义判断规则、重复输出决策，边界不一致 | 水印概率 0.8 的实际函数测试：原生保留、脚本删除 |
| F8 | P1 | 报告输出契约仍不自足：提供了 Plan 输入 schema 和文件名，没有 decisions/summary 的完整字段 schema、示例及现成可读报告 | trace 的 get_plan_contract 返回；旧脚本继续被用于二次判定和 Markdown 报告 |
| F9 | P1 | 清晰度缺口仅作为 risk/coverage 字典展示，没有结构化的缺口接受记录；还以未验证的样例假设弱化缺口 | 输入只画像未解码，却声称“测试数据无模糊人脸边缘用例”；旧脚本写 exactly one clear face |
| F10 | P1 | acceptance_checks 的 4 条 criterion 都不对应 acceptance_criteria，校验仍通过；数量 0–10 不能证明筛选正确 | delivery.validate_contract 实际返回 errors=[]；最终验收会保持 unverified，不会因此获得语义通过 |
| F11 | P1 | 模型在未出现实际平台错误前探索实现、枚举 .dj；得到契约后仍持续分析，规划耗时未解决 | 首轮 grep/glob/pwsh 工具及请求耗时；没有证据表明本轮执行了业务图片处理或读取了其他任务文件内容 |
| F12 | P1 | 批准后的摘要依然依赖一次额外模型请求，连接失败覆盖了整轮体验；宿主没有独立交付可见 Run 回执/失败摘要 | confirm 已成功派发，随后 6 次 TRANSPORT；用户随后两次发“继续” |
| F13 | P1 | 失败恢复没有贯通：get_run 的业务失败包在 ok=true 中，通用异常恢复映射未生效；failure-manifest 的 stdout/stderr 引用为 null | 实际 Run、failure-manifest；第 3 轮转去读内部文件和手工修复缓存 |
| F14 | P1 | 摘要搜索保留接近 1 的 match_score，却去掉排名依据；实验性去水印算子被列为脸数、脸面积、NSFW、美学的候选 | trace 搜索结果；分数公式按来源名次得到第一名 1.0，不是匹配概率。最终未选错该算子，但增加噪声 |
| F15 | P1 | 前端后台持续查询所有关联 Run，包括终态，且服务端逐个串行读取；缓存未持久更新，两个界面入口状态不统一 | 两次 snapshot 对终态 Run 仍调用两次 get_run；是已确认机制问题，尚无本次负载故障证据 |
| F16 | P1 | 缺少 DSH 退出、前端 fetch 原因和模型连接底层错误的可关联证据 | 当前 DSH 已退出、DJ 存活；历史只记录 Connection error，不能定位代理/上游/本机退出责任 |

F1、F5、F6、F8 是上轮新增实现或未完成契约的直接不足。上轮 12.4 秒审批 canary 只覆盖预制方案的成功路径，不能证明此次真实图片规划、部分模型缓存及失败恢复场景已通过。

## 4. 修改方案

继续使用 **standard preset**；不增加强制的数据处理 preset，不把需求分析、检索、规划写成固定状态机。本轮应收敛已有接口和宿主协调层，而不是继续堆 MCP 工具。

### P0-A：恢复模型准备的正确性

修改 DJ `model_backends/huggingface.py`、模型锁目录及 runtime preflight。

1. 将“找到目录”与“验证通过”分开。进入文件锁后重新验证；只有全部必需文件通过 size/hash 才复用。目录存在但不完整时，下载或从 blobs 补全缺失/损坏文件，再校验。
2. 保留有效的大权重文件，按文件补全，避免整个 snapshot force_download。使用 staging、原子发布和有界重试；并发进程仅发布一份验证通过的制品。
3. Windows 不能创建符号链接时使用经过哈希验证的实体文件复制方案，不要求用户提权，也不依赖不存在或已失效的环境变量开关。下载和维护由有明确缓存权限的宿主路径执行，不让业务 Agent 在受限 shell 里反复试探。
4. 锁契约区分 `required_for_inference`、`required_remote_code`、`auxiliary/provenance`，记录具体 loader 及其依赖。最小推理文件集必须经过真实离线加载测试再发布新版锁，不能凭文件名推断可删除。
5. **已批准的旧 Plan 不修改绑定清单或 content_hash。** 旧 Plan 可补齐原锁要求的四个小文件并保持身份不变；若选择改用新版最小锁，则新建 Plan 版本，展示差异并确认。
6. 扩展既有 `inspect_runtime`/`prepare_plan` 的 readiness 返回：逐模型列出 locked/cached/verified/loadable、缺失文件、需下载字节、缓存可写性和 offline 状态。`runtime.ok` 与 `model_readiness` 分开，不能再用一句“可能要下载 1.9 GB”替代实测。
7. 审批前发现无法自动准备的模型阻塞项就明确阻断；能够按已批准预算准备时，把准备阶段和成本写清楚。worker 仍做最终校验以覆盖审批后漂移。

### P0-B：用准确状态替换悬浮错误

修改 DSH `plan-workflow.js`、plan-explorer 前后端。

- 不新增常驻大卡片。采用宿主已有的紧凑任务状态入口，完整方案和错误细节按需展开；审批仍使用结构化问答。
- 将网络状态 `online/reconnecting/offline/auth_required` 与任务执行状态分开。保留最后已知 Run 并标记更新时间，不因网络失败变成“任务失败”或重新待审批。
- 输入区只显示“连接中断，正在重试”“运行失败：模型缓存不完整”等用户语言；提供真正可用的“重试连接 / 查看详情 / 重新登录”。原始异常仅留在诊断详情。
- 将 Run 的 succeeded/failed/cancelled/needs_review 明确映射，不再统一显示“已结束”；同步 execution、delivery、acceptance 三种状态及结构化错误。
- 统一卡片、输入区、完整方案页的数据源。只对活动任务轮询或订阅；终态缓存落地。请求有超时、AbortController、退避及页面隐藏时降频，避免串行查询全部历史版本。
- 刷新恢复只恢复原方案和原 Run，不显示重复审批按钮；用户已经批准时移除“confirm_plan”提示。

### P0-C：区分审批、运行尝试和重试

保留轻量协调模块，但修正身份模型：

- Approval 绑定不可变 Plan/hash；RunAttempt 绑定一次实际执行；DispatchRequest 是该 attempt 的幂等派发请求。
- 网络重放沿用原 attempt/request_id；用户明确选择“修复后重试”才创建新 attempt/request_id。双击同一重试按钮仍只能产生一个新 Run。
- 已失败 Run 不再被 `confirm_plan` 的 submitted 记录包装成 running。返回最新 Run 状态和可执行恢复动作。
- 调整 dj-bridge 对 run_plan 的无条件拦截：允许经过宿主验证的 retry_of，拒绝模型通过随机 request_id 隐式重复执行。
- 优先扩展既有接口或增加宿主重试 action，不为每个状态新增 MCP 工具。方案未变且审批仍有效时沿用原批准；实际费用/范围变化则按既有权限策略补充确认。

### P1-A：一套规则、一份决策、多种展示

修改 `plan_contract.py`、`image_audit.py`、validation/delivery。

1. 补全 image_audit 的输出 schema 和一条真实示例，明确 scores、checks、reasons、first_reason、stages、independent_hits、copy_kept、零保留与缺失值语义。
2. 提供原生可读报告，或让受控 Markdown renderer 只读取 audit/decisions 和 summary；不得再对 processed.jsonl 重算一遍业务阈值。
3. 规则配置成为唯一判定来源。明确水印阈值是 `<0.8` 还是 `<=0.8`；需要排他边界时在规则契约表达比较运算符，不以“微小差异”接受两份互相矛盾的输出。
4. 对当前任务移除二次判定脚本，复用原生保留清单和图片复制；这是执行内容变化，需生成 plan_v002 后展示确认，不能篡改 v001。
5. criterion 改为稳定 criterion_id 或强制校验文本对应关系，返回未绑定项。内置检查覆盖分数完整性、数量守恒、阶段一致性、决策和复制清单一致性；语义质量继续保留未验证状态。

### P1-B：明确需求缺口，减少无效规划

- `coverage` 使用类型化状态和证据引用；“清晰度”保留在原需求中，不从验收列表悄悄移除。
- 缺口可在同一次结构化问答中确认，例如“接受未测清晰度并运行 / 补齐清晰度能力 / 暂不执行”。将接受的 gap ID、后果和版本写入批准记录；不要求用户重复走聊天卡片和问答两套流程。
- 不以文件名或输入列表推断“没有模糊样本”，不在报告里将 face_count 写成 clear face。
- 正常编排拿到公开契约后直接使用；真的缺少字段时指出具体缺失并做定向诊断。授权 debug、脚本开发和限定样例测试继续允许；此次正常规划不需要遍历 .dj 或搜索平台实现。
- 精简搜索摘要：保留候选顺序、匹配行为和局限，去掉容易误解的接近 1 的数字，或明确标为 rank-derived。按行为区分检测、修改、评价，避免“去水印”充当脸数/NSFW 能力候选。
- 在既有调用监测中记录阶段耗时、输出规模及无新证据的探索；触发提示后转为澄清具体缺口或提交已有草案。不要把“3 次相同参数”当作唯一低效信号；本次几乎没有这种重复。

### P1-C：让执行结果独立于模型连接

- confirm_plan 成功派发后，宿主立即产生可持久恢复的“已批准，Run 已启动”回执。
- 随后模型总结失败，显示“回复连接中断，任务状态如下”；Run 生命周期继续由后端展示。无法输出总结不应使用户以为审批未生效。
- get_run 对业务失败也附带 recovery_actions；MODEL_FILE_MISSING 包括模型身份、缺失项、缓存来源、是否可修复与重试条件。日志通过有权访问的报告入口提供，failure-manifest 引用实际已存在的日志。
- 建立模型准备、运行结束/失败的宿主事件和 trace 关联；不能只记录 run_submitted 后就失去后续链路。
- 对前端 fetch、DSH 生命周期、上游模型传输保留可关联时间、request_id、PID、exit code、错误分类和必要的底层 cause；不记录凭证。DSH 与 DJ 启停应有明确监督、退出记录和恢复策略。

## 5. 验收要求

不再只用预制文本 Plan 的成功审批证明全部场景通过。

| 场景 | 必须验证 |
|---|---|
| 已完整缓存 | 零下载，精确离线加载成功，不再提示需要下载整套权重 |
| 当前部分缓存 | 大权重不重新下载；仅补齐有效缺口；Windows 无符号链接权限也能成功；仍保持原锁校验 |
| 缓存损坏/离线/只读 | 报出模型、revision、文件及恢复动作；审批前可见；不静默忽略哈希 |
| 服务或网络断开 | 不出现原始 TypeError 和内部工具指令；保留最后状态；恢复后不重复批准/派发 |
| 模型回复服务断开 | 宿主回执和最终 Run 失败原因仍可查看，不要求用户发“继续”才能知道结果 |
| Run 失败后重试 | 保留 failed Run；一次明确重试产生一个新 Run；重复点击/网络重放不产生第三次运行 |
| 水印边界 0.8 | 审计、保留清单、图片副本、报告结论完全一致 |
| 清晰度能力缺口 | 不能称全部满足；明确补齐或记录用户接受缺口；单次问答即可完成相关确认 |
| 未绑定验收项 | prepare 阶段有明确诊断；数量检查不能冒充筛选语义验证 |
| 完整原业务需求 | 从原始输入到准备、批准、运行、报告全程测试；与本条 trace 比较各阶段耗时及输出 token |

建议先用相同模型、相同输入重复至少 10 次采集规划数据，单独报告中位数和最大值；正式 P95 使用更大样本，不从单条 trace 推断。可将“公开契约足够的这组五算子任务，提交方案前模型时间不超过 120 秒、输出 token 不超过 8,000”作为首轮回归目标，超标时依据实际阶段继续改进；该数值是建议目标，不是已实现性能。

正常场景应无需平台源码或其他任务内部文件；诊断和自定义开发场景单列验收，检查操作有具体问题、有效权限和可追溯制品，不采用一刀切的零 shell 禁令。

实施顺序：**P0-A 模型准备 → P0-B 状态准确性 → P0-C 显式重试 → P1-A 报告契约 → P1-B 缺口与效率 → P1-C 完整观测**。每个阶段用其失败复现转绿后再跑完整图片任务。

## 6. 可复核证据与限制

诊断目录：`D:/dsh-app/.dsh/diagnostics/84cf1dd9634d3b8c726c372b00231c22/`，已受现有 gitignore 保护，不提交原始会话内容。

| 命令/证据 | 本轮结果 |
|---|---|
| `node .dsh/diagnostics/84cf1dd9634d3b8c726c372b00231c22/repro-dock.mjs` | **FAIL（预期的红灯）**：真实组件显示完整原始异常和 confirm_plan 指令 |
| `repro-model.py`，使用锁定 Python 与 DJ PYTHONPATH | **FAIL**：可修复的部分缓存未调用下载函数；另记录三个实际缓存的文件清单 |
| `node .dsh/diagnostics/84cf1dd9634d3b8c726c372b00231c22/repro-workflow.mjs` | **FAIL**：failed 映射 finished、error 未提升；再次确认返回旧 running |
| `repro-report.py`，使用锁定 Python 与 DJ PYTHONPATH | **FAIL**：水印 0.8 两份决策不一致；未绑定验收项仍通过校验 |
| `probe-offline-load.py` / `offline-load.json` | **PASS**：三个既有模型与 processor 离线加载成功；已有文件哈希匹配 |
| `trace.json` / `metrics.json` | 本条 trace 的调用、耗时及返回值 |
| `session.jsonl` | 同一会话后续“继续”及 Windows 下载失败证据；不计入本条 trace 耗时 |
| `workflow_events.json` / `plan_decisions.json` | 用户批准、单次派发及重复批准同一决策的记录 |
| `service-status.json` | 12:19:36 DSH 端口离线、DJ 在线的即时检查 |

以上失败用例用于固定问题，不代表本轮完成了修复。未改生产逻辑、锁文件或已有 Plan，未下载模型或重新执行用户任务。没有历史浏览器网络记录或 DSH 退出日志，故网络根因保留待验证；不能将当前端口状态或后续 Windows 权限错误强行归因到首个 fetch 失败。
