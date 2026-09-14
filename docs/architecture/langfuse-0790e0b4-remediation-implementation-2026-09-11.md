# DJ 编排与审批闭环实施记录

日期：2026-09-11。依据：[复盘与修改方案](./langfuse-0790e0b4-review-and-remediation-2026-09-10.md)。

核心闭环已落地并通过真实界面和 DJ 执行验证：继续使用 standard preset，模型准备方案，通过宿主结构化问题取得用户选择，宿主保存审批并直接派发 Run。聊天卡片是可选入口。刷新页面或丢失卡片不再丢失后端方案与审批状态。本文没有将整个方案标记为完成，未完成项列在最后。

## 1. 工具与 skill 的职责

- 保留标准 preset，没有新增数据处理 preset，也没有按状态隐藏通用工具。
- skill 负责工作顺序、证据复用、需求覆盖与诊断边界；后端负责身份、版本、审批、幂等和执行校验。
- 正常规划优先查询 DJ 契约、输入画像、算子和当前任务状态；不用源码补足已经公开的工具契约。
- 用户授权 debug 时，可以定向读源码、诊断日志和有权访问的成功记录。缺少算子时允许编写脚本并进行限定范围的测试，再将脚本及参数纳入版本化方案；正式数据处理仍通过已批准的 Run 执行。
- “清晰人脸”不能由人脸数量、面积比例或美学分数直接宣称已覆盖。skill 要求逐项说明覆盖证据、缺口和替代方案。

更新文件：`.dsh/skills/data-juicer-plan-flow-zh/SKILL.md`、`references/plan-contract.md`、`references/custom-operators.md`。requirements skill 保持兼容入口。

## 2. 结构化审批与可靠派发

新增 `mcp__dj__confirm_plan`，参数明确绑定 task_id、plan_version、content_hash；workspace、账号、会话由宿主上下文取得。工具调用宿主 `userQuestions.ask`，展示方案及“批准并运行 / 调整方案 / 暂不执行”。只有宿主返回的实际批准选项生成批准记录；模型自述或任意自由文本不会冒充该选择。

用户批准后，宿主完成以下步骤，无需模型再调用 run_plan：

1. 校验当前最新版本、内容哈希、方案有效性和运行时阻塞项。
2. 先在 SQLite 保存决策，再调用 DJ 可信审批端点。
3. 使用固定 request_id 派发 Run；网络错误采用租约、退避和有限次数重试。
4. 进程恢复后继续处理已保存决策；丢失 Run 响应时以同一 request_id 获取同一 Run。

重复批准复用原决策与 Run。过期方案不能取得新批准。已持久化决策恢复时按其不可变版本重放，不会擅自切换成后来的方案。审批失败不会被包装成执行成功；阻塞原因保留在状态查询中。

新增 `mcp__dj__get_workflow_status` 及 `/api/dj/session-plans`。输入区从后端恢复方案和执行状态，显示排队、运行、完成或阻塞；卡片渲染失败有独立降级入口。卡片的“批准并运行”同样走宿主审批服务，不再通过聊天消息让模型接力运行。

主要实现：

| 仓库与文件 | 职责 |
|---|---|
| DSH `packages/dsh-user-auth/lib/plan-workflow.js` | 会话方案、审批 outbox、重试、状态和事件 |
| DSH `packages/dsh-user-auth/lib/dj-bridge.js` | 可信用户问答、工具身份绑定、重复运行恢复 |
| DSH `packages/dsh-dj-plan-explorer/lib/index.js` | 会话鉴权、审批及状态 HTTP 接口 |
| DSH `packages/dsh-dj-plan-explorer/lib/client.js` | 输入区恢复、可选卡片、渲染错误降级 |
| DJ `data_juicer/tools/plan_flow/service.py` | prepare_plan 幂等提交、运行时评估和版本校验 |

本地工作流库及诊断证据目录已加入 gitignore，避免提交账号和任务记录。

## 3. 完整规划契约与内置报告

新增 `get_plan_contract`，公开版本化 JSON Schema，包含 recipe、postprocess、outputs、acceptance 及审批约定；prepare_plan 使用类型化参数。算子搜索默认返回简明候选，详细信息仍可按需查询。本次五组图像算子查询中，序列化响应由 19,392 字符减少到 6,256 字符，候选 ID 不变（约减少 68%）；这是响应体对比，不是模型思考时间的保证。

五类常用图像过滤算子补充真实分数字段、方向、范围、对齐方式及能力局限。未知契约显式标记，不能用猜测替代实际分数。

新增原生 `image_audit` 后处理：

- 使用真实 Filter 的评分路径保留全部输入样本，清除输入中预填的统计字段，避免伪造评分。
- 输出逐图分数、检查状态、所有删除原因及首个原因、保留清单、汇总统计和可选的保留图片副本。
- 以冻结输入清单验证输出总体，校验输入数＝保留数＋删除数，以及每阶段进入数＝删除数＋剩余数。
- 缺失分数不会写成 0 或通过；cascade 中未评估项明确标记。空输入和全部删除是合法结果。
- Plan 展示和 Run 步骤图包含 recipe 与 postprocess，后处理失败、跳过、运行状态可见。

限制：当前 image_audit 支持 native 后端、默认执行器、JSONL 和 filter-only recipe。cascade 优化的是判定过程，目前仍会计算完整评分，不能宣称节省模型推理。没有实现新的“人脸清晰度”模型，也没有将现有检测算子冒充该能力。

主要新增文件位于 DJ `data_juicer/tools/plan_flow/`：`plan_contract.py`、`score_contracts.py`、`image_audit.py`、`recovery.py`；配套修改 validation、local_worker、presentation、runner 和 native_inputs。

## 4. 环境与可执行恢复信息

沿用已按 uv.lock 校准的环境 `D:/dj/.envs/dsh-dj-uvlock-20260911`，未改写 uv.lock。新增 `inspect_runtime`，按当前平台、Python、核心依赖及方案模型绑定解析锁定依赖闭包，报告缺失包、版本漂移和恢复动作。运行时检查在审批前执行，worker 启动处理前再次校验。

例如 RUNTIME_PACKAGE_MISMATCH 会引导检查当前环境并在授权维护范围内按锁文件恢复；不会提示跳过校验或自行升级共享依赖。任务归属、方案变更和审批缺失分别给出相应恢复入口。

既有环境恢复已验证 147 个包；新增依赖闭包检查的 torch / transformers / OpenCV 样本包含 93 个依赖，均匹配。torch 锁定版本为 2.8.0，导入版本为 2.8.0+cpu。

本次没有实现自动共享环境修复服务。runtime_id 是环境评估的派生标识，不等同于已经发布了不可变运行时镜像或独立执行器源码版本。

最终改动加载后已重启 DSH 与 DJ，保留 Langfuse 观测并关闭自动弹出浏览器。实时健康检查确认 DSH deploymentId 与部署清单相同、DJ build 指纹逐项匹配，使用上述锁定环境，启动错误日志为空。部署标识：`sha256:74547908a07172aa80f51eae116a9ecac7c57575f947af3a2e2df9f9bd8ddecf`。验证结果见 `.dsh/diagnostics/runtime-lock-20260911/live-check.json`。

## 5. 验证证据

| 验证 | 结果 |
|---|---|
| DJ `tests/tools/plan_flow` 全量回归 | **208 passed，5 skipped**；跳过项不算已覆盖 |
| DSH user-auth、plan-explorer、部署脚本相关测试 | **39 passed** |
| 真实 Filter 评分测试 | 输入伪造统计被重算；本应删除的样本仍保留评分记录 |
| 幂等与恢复测试 | prepare 重放同一版本；冲突提交拒绝；丢失响应与重启后复用同一 Run 请求 ID |
| 真实 Edge 浏览器与 DJ | 卡片批准 v001 得到 run_r001 成功；结构化问答批准 v002 得到 run_r002 成功 |
| 刷新恢复及并发重复批准 | 无聊天投影也能恢复方案；两次同时重复批准都返回 run_r002，未生成第三个 Run |
| 浏览器异常 | 测试期间 page errors 为空 |
| 原 trace 的方案事件回放 | 两个版本的方案投影通过 |
| 两仓库 diff 检查 | 无空白错误；有既存 LF/CRLF 提示 |

[新 Langfuse 验证 trace](https://jp.cloud.langfuse.com/project/cmtsesk750007ad0frm2llts3/traces/5c7991aa60ddd241583baac95e8d14cc)：standard preset、glm-5.2，**12.423 秒、2 次模型调用、1 次 confirm_plan、374 个输出 token**。结构化问题约 5.552 秒出现；没有读取源码、调用 shell 或再次调用 run_plan。

这条 trace 验证的是**预先准备好方案之后的审批闭环**，不是完整业务需求规划耗时，不能据此推断整体规划 P95 已达标。

本地证据保存在 `.dsh/diagnostics/workflow-remediation-20260911/`：`e2e-result.json`、`question-result.json`、`recovery-duplicate-result.json`、`canary-metrics.json`、`discovery-metrics.json`、`browser.png`、`question.png`。测试账号已停用、登录会话已撤销、测试任务会话已归档；小型测试工作区保留以便复核。

skill 的 YAML 及引用检查通过。通用 Codex skill 校验器不认识 DSH 已有的 `user-invocable` 扩展；该扩展保留，不把通用校验器结果表述为通过。

## 6. 未完成项与后续工程边界

1. **通用文件与 shell 的跨账号读取隔离尚未完成。** 当前安装的文件沙箱主要限制写入，Windows restricted token 配置也不能证明读取隔离。DJ API 和会话接口已有身份/归属校验，但不能用它们推导任意 shell 读取同样受控。后续必须为执行进程建立可验证的账号身份或受控读取根目录，并允许授权 debug 扩展范围；不应靠追加 skill 文本或解析 shell 字符串宣称修复。
2. **自动运行时维护与不可变运行时发布尚未完成。** 已完成此次按锁恢复、检查和恢复指引；共享环境自动重建、原子切换、回滚及执行器源码版本锁定仍需独立实现与故障验证。
3. **完整业务规划性能验收尚未完成。** 已有 DJ 调用耗时、重复参数提示、前端可见事件；未新增硬性模型阶段预算，也未做全流程 P95 基准、所有工具的诊断范围审计或完整清晰度缺口场景回归。下一步应按正常编排、能力缺口、环境失败三类固定输入分别验收，避免把审批 canary 当全流程成果。
4. **历史会话关联没有全量迁移。** 新方案、查询和确认会登记后端会话关联；未触达的历史方案不能保证直接出现在恢复入口。后续迁移必须验证账号及会话归属。
5. **浏览器验证脚本尚未整理为可移植的仓库 E2E 套件。** 本次有真实运行证据和已提交到工作树的单元/服务测试；长期回归还应提供自动建号、清理、故障注入和 CI 接入。

因此，本次可以确认“标准 preset 下可见方案 → 真实用户批准 → 可靠启动 → 状态恢复 → 内置审计报告”的实现与上述测试结果；不能确认整个原方案的隔离、维护自动化及性能目标已全部完成。
