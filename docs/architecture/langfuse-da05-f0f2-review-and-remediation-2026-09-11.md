# 双区间筛选、自定义算子与完成报告：诊断和修改方案

日期：2026-09-11。状态：已检查 trace、关联会话、持久状态及冻结制品，已做隔离复现；本文为方案，未修改业务代码、重启服务、重置预算或执行用户待审批的 Plan。

## 1. 结论与范围

这次不是“人脸检测失败”，也不是“成功后少写了一句 skill”。实际断点是：**规则语言不能表达区间并集，自定义算子验证不能访问嵌套统计字段，提交前错误消耗执行预算，以及 Run 终态没有连接到持久会话消息投递。** 回退脚本又引入了计数与输出一致性问题。

参考了 Codex 任务“评估并改进 Data Juicer Skills”及其 [84cf 修复记录](./langfuse-84cf1dd9-remediation-implementation-2026-09-11.md)。两次新会话使用 standard preset，trace 中 DSH PID 为 41596，算子作业 supervisor PID 为 1112，与该记录 13:54 的服务身份一致。不能把这些问题解释为尚未使用上一轮修复。

上一轮的持久审批、执行尝试、后台同步、原生报告和模型缓存修复应保留。本次补齐它们之间的缺口，不新增强制业务 preset，也不把规划固定为工具调用状态机。

证据范围：完整下载两条 trace（11 / 85 个 observations），读取各自本地会话、workflow 事件、算子作业、Plan、成功 Run 验收结果；检查实际引用的实现；执行临时目录/内存数据库中的定向复现。未重跑完整模型管线，未声称发现系统全部潜在问题。参考任务最近部分回合通过 read_thread 返回空 items，因此用其已落盘的实施记录和实际代码补齐，而非声称读取了不可见内容。

## 2. 两条 trace 必须分开理解

| 证据 | 实际用户需求 / 所处阶段 | 结果 |
|---|---|---|
| [da05eb2f](https://jp.cloud.langfuse.com/project/cmtsesk750007ad0frm2llts3/traces/da05eb2f176125a6c7e58a155bd77916) | “结果如何”；此前需求为**保留多人脸**，不是无人脸或多人脸 | task_5064a2c74b00 / plan_v001 / run_r001 已成功；10 张保留 1 张、排除 9 张 |
| [f0f2ec6d](https://jp.cloud.langfuse.com/project/cmtsesk750007ad0frm2llts3/traces/f0f2ec6daa52818857fe2e1a29d39fa8) | **保留无人脸或多人脸**；即人脸数 0 或 ≥2 | 自定义算子开发链失败，最终生成 Python 后处理 Plan：task_381ca46eb36d / plan_v001 |

第一条对应 session-9ab4eb03-cd6a-48d3-b5d9-f93c94d525af；第二条对应 session-801884e0-c22d-4060-86f6-387e1ccb461d。它们是同一账号的不同会话，不能把第一条的成功 Run 当作第二条双区间需求已经执行成功。

第二条 trace 顶层 input/output、sessionId 为空，但 observations 带会话属性，本地会话保存原始需求。取证时它停在 confirm_plan 的 tool/call，尚无 tool/result / turn/end，也无持久审批、Run。这是一个审批调用尚未闭合的截面，**不是已经执行失败的 Run**。用户此前取消的是预算选择问答，并不等于批准后续方案。

### 时间线（北京时间）

| 时间 | 会话 / 行为 | 证据 |
|---|---|---|
| 14:00:24 | 双区间需求开始 | 首次模型请求超时，重试恢复 |
| 14:00:49–54 | inspect_input 首次传 `input.images` 被拒绝，改 `input.path` 成功 | INPUT_REQUIRED |
| 14:00:59–14:02:02 | 检索、取算子 schema、原生 Plan 契约和 authoring spec | 相关检测算子已经召回；不是人脸计数漏召回 |
| 14:03:30 | 并发读取 7 张图片 | 7 次均因 deepseek-v4-flash 未声明图片输入失败 |
| 14:03:56 | shell 用 OpenCV 探测样本 | 得到 0、1、3 人脸等结果；属于诊断证据，不是正式 Run |
| 14:05:07–38 | 第一次自定义作业 519413d8ab404ab1 | 执行后 `face_policy_valid` 断言失败 |
| 14:06:09 | 同名去掉 equals 再提交 | CONTRACT_CHANGED；没有新作业，但扣一次预算 |
| 14:06:36–14:07:01 | 改名后第二次作业 a65f3c1afb154116 | `__dj__stats__.face_policy_valid` 断言失败 |
| 14:07:31 | 再次改名、去掉 equals | OPERATOR_BUDGET_EXHAUSTED |
| 14:08:47–14:15:24 | 询问重置预算或 Python 后处理 | 等待 396.463 秒后用户取消 |
| 14:16:49–14:17:34 | 写 Python 报告脚本，仅 py_compile 后 prepare_plan | valid=true，未做脚本行为验证 |
| 14:17:50 | 本地会话记录 confirm_plan 调用 | 取证时没有审批结果与 Run |

另一个成功会话：14:06:46 派发；Run 在 14:08:12.529 更新为成功；后台在 14:08:13.544 保存 succeeded；14:08:46 用户追问；14:09:22 才收到模型总结。后台约 1 秒内已知道成功，延迟点在消息交付，不在轮询。

### 耗时与失败分类

| 指标 | da05（追问结果） | f0f2（双区间规划） |
|---|---:|---:|
| trace 时间跨度 | 36.105 秒 | 1,045.782 秒 |
| 模型请求数 / 错误数 | 3 / 0 | 26 / 1 |
| 模型请求耗时合计 | 35.885 秒 | 592.808 秒 |
| trace 输出 token 合计 | 2,230 | 53,690 |
| 已闭合工具调用 / 错误数 | 3 / 0 | 35 / 11 |
| 预算问答等待 | 0 | 396.463 秒 |

f0f2 的 35 个已闭合工具不含末尾未闭合的 confirm_plan。11 个工具错误包括 7 次不支持图片输入、1 次 input 参数错误、2 次自定义提交拒绝、1 次问答取消。**两个异步算子作业失败发生在 ok=true 的查询返回中，不在 tool ERROR 计数里。** 不能只查红色 span，也不能把用户等待全部归为模型慢。

## 3. 根因与问题清单

### F1 / P0：原生规则只有单区间，简单 OR 被迫升级为代码开发

[image_face_count_filter.py](D:/dj/data-juicer-1.5.4/data_juicer/ops/filter/image_face_count_filter.py:43) 接受单组 min/max；any_or_all 表示一条记录内多张图片的聚合方式，**不表示多个区间取并集**。

[plan_contract.py](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/plan_contract.py:6) 的 Rule 也只有 min/max 与开闭边界。[image_audit.py](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/image_audit.py:10) 逐条判断违规，任一违规就删除；把“等于 0”和“至少 2”写成两条普通规则只会形成 AND，不能解决需求。

本次自定义实现实际上重新做了一次已有的人脸检测，只为增加 `count == 0 or count >= 2`。最小正确修复应落在**已有统计量上的规则表达**。真实需求不是要新的检测模型。

### F2 / P0：自定义验证断言只访问顶层，正常统计输出无法被断言

[user_operator_validation.py](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_validation.py:464) 使用 `rows[row].get(field)`。

实际算子写入 `{"__dj__stats__":{"face_policy_valid":[1]}}`。因此顶层 `face_policy_valid` 查不到；点号写法也会被当成完整顶层键，仍查不到。公开 authoring spec 只说明 equals 的 row/field/value，没有嵌套取值规范、实际输出预览或完整多模态断言示例。

已重放 trace 中的算子计算和过滤方法：三个原始样本分别输出 `[0]/[1]`、`[1]/[0]`、`[3]/[1]`，正确保留无人脸与多人脸两条。将正确嵌套输出送入从当前源码提取的原断言循环，两种字段写法都失败。此复现验证检测/过滤逻辑与断言问题；没有冒充重新执行完整隔离 worker。

### F3 / P0：预算在预检前扣除，恢复说明不可执行

同文件 [develop](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_validation.py:61) 先增加 attempts、写 request 记录，再进入 `_develop` 做契约一致性、依赖等校验。因此 CONTRACT_CHANGED 也扣预算；请求残留还会在重放时变成 DEVELOP_INTERRUPTED，而非原来的确定性预检错误。

本例实际是“两次 worker 作业 + 一次契约拒绝 = 三次用完”。桥接层把 task_id 设置为会话 ID，因此预算范围是该账号当日该会话，不是界面文案让人理解的每个算子各三次。换名字不会清空该会话预算。

错误只给出泛化 diagnose 动作，没有剩余额度、重置时间、可用恢复入口。模型提出“重置预算”选项时没有可调用的对应宿主能力。

### F4 / P1：验证失败丢失必要证据，模型转向削弱验收

失败作业只保存字段名和 phase，且 job.phase 仍是 execute、error_details.phase 是 contract。临时执行输出和日志随 `_cleanup` 删除，缺少 expected/actual、字段是否存在、有限输出示例和证据引用。

模型先删 equals，再改名重试，最后在问答中声称只留 row_count 与 limitations 可发布 validated。但代码的 `accepted = bool(purpose and equals)` 明确表明这种提交最多 experimental。**不能用取消断言来修断言解析错误。**

保持不可变契约是合理边界，但应允许创建可追踪的新候选/契约版本，明确记录修正的断言与原业务要求，不要求模型凭空换算子名。

### F5 / P0：运行终态没有报告投递路径

[dj-bridge.js](D:/dsh-app/packages/dsh-user-auth/lib/dj-bridge.js:116) 在确认派发后 concludeTurn，避免审批后模型连接故障破坏派发；这项修复应保留。

[plan-workflow.js](D:/dsh-app/packages/dsh-user-auth/lib/plan-workflow.js:48) 的 refresh 只更新数据库并记录 run_status_changed；pollActive 在后台同步，未连接到会话持久消息、inbox 或报告投递 outbox。UI 更新不等于主动报告。真实成功会话在审批轮结束和“结果如何”之间没有新 assistant 消息。

内存数据库运行真实 PlanWorkflow 的 approve→pollActive，得到 succeeded，事件只有 approval_persisted、run_submitted、run_status_changed，未产生报告投递事件。这个复现配合调用链检查与真实会话证明缺失链路；仅凭某个事件名不存在本身不足以推断任意系统没有通知。

### F6 / P1：聚合验收状态被模型误读，报告不准确

成功 Run 的 acceptance.json 已明确：decisions_row_count=passed、audit_consistency=passed；manual_review=unverified；另有“全部删除原因”未绑定 criterion-2=unverified。最终模型却说自动检查“待宿主最终核验”，并把 manual_review 解释为图片语义质量。该 Plan 的 manual_review 实际绑定“保留图片复制到 audit/images/”。

模型只读取 get_run、decisions 和 12 行运行报告，没有读取逐项验收证据。[service.py](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/service.py:407) 返回聚合 Run；应该补足结构化交付摘要，而不是让模型据 aggregate unverified 猜原因。

### F7 / P0：回退脚本通过语法检查，却存在可复现的业务错误

对象是 task_381ca46eb36d/plan_v001 已冻结的 `artifacts/image_audit_report.py`，不是假想实现。它尚未在用户 Run 中执行，以下是隔离制品测试发现：

| 缺陷 | 定向输入 | 实际错误 |
|---|---|---|
| 独立命中被写成首次删除数 | 一张图同时命中四条规则 | independent_hits 为 `[1,0,0,0]`，应为 `[1,1,1,1]`，却标记 complete=true |
| 缺分数仍生成成功形态报告 | 缺 face_counts，其他分数通过 | decision.kept=false，但 summary.removed=0、阶段 remaining=1，且 all_reasons_complete=true |
| 文件身份使用 basename | 两个目录各有一张 same.jpg，均保留 | kept=2，最终图片文件只有 1 个，发生覆盖 |

此外脚本把 NSFW 条件写为 `<0.5`，前一个原生方案为 `≤0.5`；本轮说明却声称“全部为 DJ 标准默认值”。这是边界语义漂移。缺失值处理不区分布尔/非有限数；后续验证应覆盖这些类型。

原生 image_audit 已具备稳定身份、完整性验证和一致的报告渲染，这次因 F1 又退回重复实现，重新引入上一轮已解决的问题。

### F8 / P1：Plan 结构有效与验收完整仍被混为一谈

双区间 Plan 只声明两个 row_count 检查，都没有 criterion；四条 acceptance_criteria 没有绑定。prepare_plan 仍返回 valid=true、presentation_warnings=[]。现有 [delivery.py](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/delivery.py:48) 会检查“填了 criterion 但不匹配”，不会在缺填时提示覆盖不足。

四个“全量计分”内置 Filter 通过宽松阈值模拟 keep-all，但只有 native image_audit 才使用 reduce=False 的真评分路径。以人脸上限 10000 等哨兵值代替评分模式，不构成全输入完整性保证。两条 row_count 不能证明完整分数、所有原因、阶段计数或保留副本一致。

Python 后处理可以保留为合法扩展方式；问题是不能把冻结和 py_compile 当业务测试，也不能把输出声明当验收证据。

### F9 / P1：能力与参数契约不足制造无效调用

- 当前模型不支持图片输入，但仍发起 7 个并发 read_image。应在模型运行上下文/工具元数据公开输入模态与不可用原因；首个同类能力错误即可阻止重复批次。无需为此全局禁用诊断。
- inspect_input 的 input 是宽泛字典，缺少强制 path 的公开结构约束；错误恢复仍建议 diagnose，而不是直接给合法参数。
- 成功会话的前一轮把 `multi-face-image-filter` 当 task_id，得到 INVALID_TASK_ID；改空字符串才成功。新建与续接身份需要清晰 schema、示例与字段错误恢复。
- 规划后期 shell `import data_juicer` 失败，但此前 cv2 可用且 DJ worker 已执行到断言阶段，不能据此声称整个 DJ 未安装。诊断接口应显式返回宿主、服务、隔离验证环境的身份与可用入口。

### F10 / P1：无进展提示不足，trace 关联信息不完整

53,690 输出 tokens、26 次模型请求包含长推理、重复提交和 shell 等待。现有重复 fingerprint 提示不能识别“只换算子名/断言拼法，仍在同一断点”，也未向模型稳定提供预算与作业摘要。应按语义尝试及新增证据记录进度，而非依赖模型记忆或一概裁剪工具。

作业失败是业务终态，但工具读取成功；trace 只有 ERROR 统计会漏报。当前 trace 顶层 sessionId 缺失，应把 session、turn、task、plan、attempt、run、job 明确关联，并区分工具调用结果和异步业务结果。第二条尚未闭合的审批应可见 pending，不应被汇总为“全流程已失败”。

## 4. 修改设计

### A. 原生 Rule 支持同一统计字段的区间并集

在现有 Rule 增加有界 `any_of` 区间列表，旧 min/max 仍按旧语义解释；禁止两种形式混用，检查非空、有效边界与数据类型。规则内 OR，规则间 AND：

```json
{
  "kind": "image_audit",
  "audit_mode": "full",
  "copy_kept": true,
  "rules": [
    {
      "id": "face_policy",
      "field": "face_counts",
      "any_of": [{"min": 0, "max": 0}, {"min": 2}]
    }
  ]
}
```

这是**拟新增契约，当前不能提交**。不要先引入任意 Python 表达式或无限递归条件树。对 face_counts 依公开计量契约校验非负整数；缺失、bool、NaN/Inf 不得当无人脸或通过。检测计算仍复用 image_face_count_filter，评分依旧 reduce=False；只由 image_audit 决定去留。

同步修改 plan_contract、image_audit、audit_report、检索/计量契约、展示规则和一致性验收。报告保存规则的完整参数及版本，旧 Plan 的冻结内容与 hash 不变。无需单独为该需求开发新算子。

### B. 自定义算子验证可诊断、可修正，预算只计实际执行

1. 发布版本化断言 schema。保留旧 `field` 为**字面顶层键**；新增 `path: ["__dj__stats__", "face_policy_valid"]`（必要时数组元素用整数段），二者互斥，避免含点号原始键歧义。禁止 eval。
2. authoring spec 给出完整 Filter 输入、输出和嵌套断言示例。提交前校验 row 范围格式、path 段类型、契约结构、依赖声明；执行后区分不存在、null、类型不符、值不符。
3. 返回结构化 expected/actual、exists、row、path、phase、有限输出预览、证据 ID。在精确清理临时目录前保存账号隔离、大小有界的失败证据，不保存凭证，不保留全部临时缓存。
4. 预检通过后原子预留执行预算，创建作业并记录同一请求状态。预检拒绝存可重放的 rejected 结果，不扣 worker 尝试；并发/幂等保护不变。真实启动失败按明确策略计费/回补，避免崩溃重复扣费。
5. 错误返回 scope、used/remaining、reset_at、retryable 及实际可用恢复动作。若提供追加预算入口，应由宿主真实用户动作授权，不让模型通过改名、换 request_id 重置。未实现入口前不要展示“重置”假选项。
6. 契约修正创建新 revision，关联原候选和差异；不得静默改旧契约，也不得自动删除 equals 降低通过门槛。明确 experimental 与 validated 的区别。

### C. Run 完成后持久投递报告，不依赖浏览器或下一次提问

保留审批后的 concludeTurn。在 PlanWorkflow 观察到终态时，同一事务中保存 Run 快照并写 `run_report_outbox`；以 `(user_id, session_id, task_id, run_id, event_kind)` 唯一键去重。运行结束与清理 pending 可分开呈现，不无限等待清理才告诉用户失败。

独立投递器向该会话追加持久结果消息；前端订阅只负责展示。基础消息由确定性数据生成，包含执行/交付/验收三个状态、输入/保留/排除统计、失败或未验证原因、业务报告与产物引用。LLM 详细总结可选，失败不能阻塞基础交付。

具体约束：

- 终态快照与 outbox 原子保存；失败重试、进程重启可恢复。
- 消息写入使用相同幂等 event ID，处理“消息已写但 ack 前崩溃”。如果宿主不提供幂等消息接口，先补该接口；单靠 outbox unique key 不能保证用户只看到一次。
- 保留 pending/delivered/failed、消息 ID、尝试次数、下一次重试时间。报告生成失败保留终态通知并说明报告待生成。
- 活跃用户回合期间入队，按宿主消息序列在安全边界投递，不打断/覆盖用户输入；离线时持久保存，重连可见。
- 历史终态回填要有策略，避免升级后向所有旧会话群发。可从部署时刻或用户指定未交付任务恢复。
- get_run / get_workflow_status 返回结构化 `result_summary`、逐项 acceptance evidence、未绑定标准与安全产物引用；不只给内部 report_path。
- suggested 运行目标：后台获知终态后 10 秒内基础消息可持久读取。这是待验收目标，不是当前保证。

### D. 验收与回退脚本使用同一事实来源

审批前返回 `acceptance_coverage`：哪些标准已绑定、哪些未绑定、哪些需要人工，以及实际检查范围。允许诚实的未验证方案，但在审批详情显式呈现；criterion 用稳定 ID 逐步代替易漂移的文本映射，兼容旧版本。

自动检查与手工检查按真实用途划分。复制文件、原因完整性和阶段计数可自动核验，不能默认丢给 manual_review；主观语义质量才使用单独人工标准。某项自动检查通过不能冒充全部业务标准通过。

A 完成后，这个双区间任务应生成新的原生 Plan，不覆盖已冻结的 v001。若保留通用 Python 扩展路径，则增加独立、冻结的行为测试和契约化验证器；报告仅渲染单份 decisions/summary，不重新定义判断规则。样本身份采用稳定 ID，原 basename 只作展示。评分能力不足时显式阻断，不用宽松阈值伪装完整评分。

### E. 轻量调整工具和 skill

工具契约增加输入模态、准确输入 schema、新建/续接 task 约定、作业轮询建议时间、验证预算及候选状态。Skill 只补必要决策知识：先判断已有分数能否表达规则；看实际断言差异再修；不要删测试争取通过；未闭合问答不当批准；用逐项验收事实报告。

保持 standard preset、源码诊断和受控脚本开发可用。无进展控制应聚合语义等价尝试，给出新增证据、耗时和预算，不强制每次走固定顺序。

## 5. 实施顺序与验收

| 批次 | 改动范围 | 必须通过的回归 |
|---|---|---|
| P0-A | 原生区间并集 + 报告/验收同源 | 0、1、2、3 分别保留/排除/保留/保留；单区间旧行为不变；多规则/多图、边界、缺分数与非法类型；不开发新算子即可完成该需求 |
| P0-B | 嵌套断言、错误证据、预算事务 | 原始三张样本输出正确且断言通过；错误断言给 expected/actual；CONTRACT_CHANGED 不占执行次数；同请求不重复扣费；并发与崩溃重放；删 equals 仍只能 experimental |
| P0-C | 终态报告 outbox 与宿主幂等消息 | 用户不再发消息，仍自动收到成功/失败/取消/待验收报告；浏览器关闭、服务重启、重复轮询、投递 ack 前崩溃均不漏不重；消息只进所属账号会话；总结模型离线仍有基础报告 |
| P1-D | 验收覆盖、结构化摘要、扩展脚本测试 | 自动 passed 不被说成待核验；manual 与未绑定原因完整；多命中、缺分数、同名图片反例被发现；报告、明细、摘要、副本一致 |
| P1-E | 模态/输入契约、进度与 trace 关联 | 文本模型不重复读图；错误参数返回直接修正；异步 job.failed 被汇总；待审批正确显示 pending；区分模型耗时、用户等待和执行时间 |

完整业务回归应新建隔离任务，用同一 10 张图片分别执行“仅多人脸”和“无人脸或多人脸”，走真实用户审批；验证两种规则得到各自正确结果。不得把当前仅多人脸 Run 作为双区间回归，也不得代用户批准其未完成方案。

性能评估重新采集多次样本，分别记录到首次可确认 Plan、用户等待、Run 和报告投递耗时。单次工具单测通过不代表 120 秒规划目标或模型质量达标。

## 6. 已执行复现及证据位置

受 gitignore 保护的诊断目录：`D:/dsh-app/.dsh/diagnostics/dual-trace-20260911/`。含两条原始 trace、两份会话、workflow 事件、完整工具输入输出、统计和 prepared-plan。原始会话不随方案提交。

| 命令 | 结果 | 覆盖边界 |
|---|---|---|
| `D:/dj/.envs/dsh-dj-uvlock-20260911/Scripts/python.exe -X utf8 D:/dsh-app/.dsh/diagnostics/dual-trace-20260911/probe.py` | exit 1，4 项预期失败 | 原源码断言循环、实际 develop 方法的预检扣费、实际 Rule schema；存储/worker 依赖隔离 |
| `node D:/dsh-app/.dsh/diagnostics/dual-trace-20260911/probe-notify.mjs` | exit 1，succeeded 但没有报告交付事件 | 真实 PlanWorkflow，内存 DB、模拟 DJ 返回；结合源码及会话取证 |
| `D:/dj/.envs/dsh-dj-uvlock-20260911/Scripts/python.exe -X utf8 D:/dsh-app/.dsh/diagnostics/dual-trace-20260911/replay-operator.py` | exit 0，0/1/3 检测和保留结果正确 | trace 生成的实际方法 + 当前 OpenCV；未重新运行完整 worker |
| `D:/dj/.envs/dsh-dj-uvlock-20260911/Scripts/python.exe -X utf8 D:/dsh-app/.dsh/diagnostics/dual-trace-20260911/probe-fallback.py` | Python probe exit 1，三项错误复现 | 当前冻结 Python 脚本，合成输入及临时目录；不修改业务产物 |

本次没有执行修复后的绿色回归，因为尚未实施修复。以上失败输出是定位证据，不是已修复声明。
