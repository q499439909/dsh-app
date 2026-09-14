# Trace 84cf1dd9 修复实施记录

日期：2026-09-11。对应 [原修改方案](./langfuse-84cf1dd9-review-and-remediation-2026-09-11.md)。

## 已落地的变化

继续使用 standard preset，没有新增数据处理 preset 或 MCP 工具。业务规划仍按需调用工具；工程边界放在 DJ 契约校验、可信问答审批、执行尝试身份、权限和运行锁中。Skill 保留简短的工作方法、缺口处理和诊断边界。

| 问题 | 修复 |
|---|---|
| F1 状态区悬浮错误 | 改为可展开的紧凑入口；连接状态独立于任务状态。超时、断线、登录过期、权限拒绝分别处理，保留最后已知 Run，提供连接重试。原始异常和内部工具名称不进入状态提示。 |
| F2 部分模型缓存无法恢复 | 文件锁内重新校验；优先复用经过哈希验证的 blobs，只补缺失/损坏文件。采用 staging 和原子实体文件发布，避免 Windows 符号链接提权要求。有效大权重保留。 |
| F3 审批前没有模型就绪信息 | prepare_plan / inspect_runtime / get_plan 提供逐模型 revision、缓存路径、文件校验、缺失清单、准备字节、offline、可写性。不可准备项阻断审批；worker 再次检查。loadable 明确为 not_checked，文件校验不冒充加载测试。 |
| F4 辅助文件混入推理依赖 | 三个内置模型发布 inference-v2 锁，区分推理必需与 auxiliary/provenance，记录具体 loader。旧 Plan 的模型清单和哈希保持不变。 |
| F5 失败被显示成结束 | succeeded / failed / cancelled / needs_review 独立显示，提升错误与恢复动作；分别呈现执行、交付、验收状态。 |
| F6 失败后无法重试 | Approval 与 RunAttempt 分离。用户明确重试才新增 attempt；同一失败 Run 的重复请求复用新 attempt。未派发成功的恢复沿用原请求 ID。清理未完成时继续同步并禁止重试。 |
| F7 双重业务判断 | image_audit 是唯一规则执行点。report.md 只渲染 decisions/summary。支持 max_inclusive=false，水印 0.8 的排除边界一致。 |
| F8 报告契约不足 | 发布 decisions、kept、summary 输出 schema、示例、原生 Markdown 报告和 audit_consistency 验收。 |
| F9 缺口没有明确接受记录 | Coverage 类型化；needs_user_input 阻断，gap 通过同一次真实问答明确接受并持久记录。普通自由文本、模型伪造 actor 或 accepted_gaps 不构成宿主审批。 |
| F10 验收项未绑定 | 有 acceptance_criteria 时，criterion 必须匹配其中的准确文本。审计验收检查决策、保留清单、分数完整性、图片副本及阶段计数一致；主观语义仍需独立证据。 |
| F11 规划低效 | 工具契约提供完整报告路径，Skill 要求 prepare 成功后简述并进入问答，避免重复整份 JSON。记录模型阶段耗时、请求次数、工具耗时和输出字节，并在后续调用中提示超时规划应收敛。120 秒是观测目标，不是硬性中断模型的状态机。 |
| F12 派发后仍依赖模型回复 | confirm_plan 生成持久回执，使用宿主 concludeTurn 结束本轮。修复真实宿主发现的 undefined 输出字段导致 INVALID_TOOL_OUTPUT 问题，宿主工具结果统一转换成无损 JSON。 |
| F13 失败无恢复路径 | 模型错误带具体身份和缺失信息；get_run 返回 recovery_actions；失败 manifest 引用实际 stdout/stderr。读取/取消 Run 保留账号权限检查，不再依赖当前自定义算子环境可执行。 |
| F14 检索噪声/漏召回 | 摘要移除概率式 match_score；过滤把模糊/去除变换当检测的候选。完整回归发现复合“人脸数量+面积”使计数排第五，新增基于公开计量契约的检索来源，保证两个相关行为都能被召回；不是把管线步骤写死。 |
| F15 重复轮询 | 合并界面数据源，服务端并发上限、去重和短时缓存；终态持久保存，清理结束后不再访问 DJ；后台仍同步活动 Run，无需浏览器在线。 |
| F16 缺少关联诊断 | 保存模型请求阶段、provider request ID、网络错误分类、运行阶段及 PID。启动器记录子进程输出和退出；自启动 DJ 意外退出最多重启三次，不接管外部进程。DSH 退出保留日志并由启动脚本恢复持久派发。undici 诊断观察器保留底层 cause code，不记录请求头、正文、路径或凭证。 |

## 实际模型缓存修复

旧锁缺少的 labels.json、training_args.bin、configuration_predictor.py、modeling_v2.py 已补齐，共 **10,194 字节**。三个旧绑定均通过完整 size/hash 校验。有效大权重未重新下载。离线加载探针使用实际 processor 和模型类；准备成本现为 0 字节。

Python 沿用 `D:/dj/.envs/dsh-dj-uvlock-20260911/Scripts/python.exe`，uv.lock 未放宽。修复了启动探针在 Windows PowerShell 5.1 下多行 `python -c` 的引号丢失问题，改为从 stdin 执行。

## 用户任务的版本

`D:/shishi / task_87db875b0081` 已准备 **plan_v002**，hash：

`sha256:2f09586624eebb3f76ce7d434b8376ab4f08ad392dc17b105fad4532d05bd8c8`

五个算子和原生审计报告取代旧脚本，启用保留图片复制，水印规则为 `<0.8`。模型 readiness 全部通过、准备字节为 0。

原 plan_v001 的内容哈希未变；原 failed Run 保留。plan_v002 **尚未审批和执行**，因为仍需在正常问答中明确接受清晰度缺口，或先开发并验证相应能力。系统修复授权不等于用户接受业务质量缺口。

## 验证

- DJ Plan Flow 全量：**218 passed，5 skipped**。跳过项为需要额外执行设施的测试，不计为通过。
- DSH 认证、工具桥、协调、状态组件、传输诊断：**46 passed**。
- 真实组件断线重放：保留原 Run；无 TypeError、Failed to fetch 或 confirm_plan 文案；401 停止自动重试并给出登录入口。
- 真实浏览器：断线、恢复、刷新后 Run 身份保持一致；页面无 JavaScript 异常。
- 五算子实际执行（隔离的相同 10 张图片）：`task_dacc12d3adc4 / run_r001` 成功，保留 **4**、排除 **6**；全量分数、阶段计数、保留图片和原生报告生成，约 **96.4 秒**。这是执行测试，不是规划耗时。
- 真实问答重试：测试任务 `task_7eb258457782` 保留失败的 run_r001，明确接受缺口后只创建 run_r002；run_r002 成功、delivery=passed、acceptance=unverified。两个并发网络重放均返回 run_r002，目录仍只有两个 Run。
- 宿主结束验证：重试所在第 2 轮只有一次模型步骤，confirm_plan 返回后 turn/end=completed，没有额外模型总结请求。
- 水印恰好 0.8 的边界、缺口接受、损坏缓存不发布、有效 blobs 复用、验收计数被篡改等均有定向回归。

## 证据边界与后续观测

首轮完整 Agent 回归确实再次发现了复合检索漏召回和工具输出无损 JSON 校验失败，均已修复，不能把这一轮作为成功性能样本。其运行中还记录到 PermissionError/lost sys.stderr，随后同一固定版本的明确重试成功；没有足够证据把首次进程退出归因于模型缓存或某个读文件操作。

历史 trace 的首个网络故障无法由新增日志追溯还原。新增诊断用于后续错误定位。模型规划耗时与 120 秒目标单独评估，尚未做十次重复或 P95 统计；不以单个预制审批测试宣称规划性能达标。

原始会话、受控测试账号、截图、模型清单和运行结果保存在受 gitignore 保护的 `.dsh/diagnostics/84cf1dd9634d3b8c726c372b00231c22/`，不提交凭证或原始会话。最终完整规划结果与运行服务身份在验收结束后补入下节。

## 最终验收补充

最终从原始自然语言需求开始的隔离回归已完成：`task_0baad5101e8d / run_r001`。模型检索、编排五项评分及原生 image_audit，通过真实结构化问答接受清晰度缺口后执行成功。10 张图片保留 4 张、排除 6 张，delivery=passed，acceptance=unverified，任务停在“处理完成，待验收”，不把接受缺口等同于满足清晰度要求。

成功规划轮共 10 次模型步骤、11 次工具调用，只读取了一次本 Skill 的公开契约参考文件；平台源码读取、shell 数据处理和其他任务内部文件读取均为 0。这是正常编排的实际回归结果，不是禁止调试和受控自定义算子开发的全局权限规则。确认派发后宿主直接结束本轮；浏览器断线、恢复、刷新保持同一 Run，JavaScript 异常为 0。

本轮还修复了第二次完整回归暴露的多模态召回问题：图文清单判为 multimodal 时，应同时检索 image/text 对应算子。未配置可选能力目录的部署不再向模型注册不可用的 resolve_capabilities。当前 DJ 网关注册 15 个工具；宿主隐藏内部 approve_plan、提供 confirm_plan 和 get_workflow_status 后，模型可见 DJ 工具为 16 个。沿用标准 preset。

性能仍未达标：成功轮从开始到调用确认工具为 **286.293 秒**，累计模型阶段 **272.277 秒**，输出 **16,826 tokens**，超过 120 秒和 8,000 tokens 的目标。工具链已闭合，但不能据此宣布规划延迟问题完全解决。该样本之外，首次模型连接在任何工具调用前连续失败，新增传输日志记录到 dashscope.aliyuncs.com 的 ECONNRESET；一次有界重试后才进入上述成功轮。连接失败与成功规划耗时分别记录，不混为算子执行故障。后续应基于这些阶段数据进一步压缩重复契约输入和无工具进展的长模型步骤，再用多次样本验证；不靠新增强制 preset 或绕过确认压缩时间。

最终源码复验：DJ 218 项通过、5 项跳过；DSH 46 项通过；两仓库 diff --check 无错误。DSH 与 DJ 已协调重启并通过部署握手和健康检查，核验时间为 **2026-09-11 13:54（北京时间）**：

- DSH：端口 57035，PID 41596。
- DJ：端口 8010，PID 1112，实例 `dab56ef5-cb0a-4c41-a721-3517599df0f0`。
- 部署标识：`sha256:e9766e8a2ca016c5865ade22f1a25f278b9721b92f5c7f2c13c7573ccd8ad20c`。
- DJ 源码标识：`sha256:310401206fcb9eaf6b115e1a93782e041f4644171e143cf265f9fde9c7852d32`。
- uv.lock 标识保持 `sha256:04d662d0fd6ec8ed1ffa98c1527ec947c883b0651ef71904496d3e0fbb66dc1e`。

本轮创建的四个隔离回归账号已禁用，诊断和产物保留；业务账号未受影响。原用户任务 plan_v002 仍等待真实缺口选择，没有代用户接受或执行。详细原始证据见诊断目录中的 final-metrics.json、final-e2e-result.json、final-session.jsonl、final-service-status.json、model-repair.json 和 retry-proof.json。
