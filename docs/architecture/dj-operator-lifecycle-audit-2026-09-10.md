# DJ 能力检索与个人算子生命周期审查

日期：2026-09-10。范围：当前 `D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow` 的检索、个人算子开发测试、模型/依赖与 job 生命周期。基于本地一手源码和有限纯本地测试；未运行模型下载、付费模型或生产数据处理，未修改生产代码。检索适用路径未发现 AGENTS.md/CONTEXT.md。本文的“风险/建议”不等于已发生的事故。

## 当前设计中应保留的机制

- MCP 开发接口提交源码、样本和断言，异步返回 job；查询接口也接受取消请求。测试后自动发布个人版本，区分 validated 与 experimental。[接口](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/server.py:88)
- 输入限 100 条/1 MB，媒体样本复制到临时目录且限 50 MB；契约、样本指纹、参数指纹先冻结，同一算子 ID 后续不能改契约。[冻结和输入检查](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_validation.py:65)
- 源码只在子进程导入；检查只注册一个新算子、继承正确基类，使用真实 DJ executor，而非仅做语法检查。[worker](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_worker.py:12)
- 个人版本由源码/schema/manifest/contract 的内容 hash 标识，原子更新目录指针；experimental 不覆盖已 validated 的当前版本；Plan 使用精确版本绑定而非用户任意路径。[版本发布](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_store.py:75)、[Plan 绑定](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_store.py:196)
- 取消与超时会终止子进程树；重启后的查询会按 PID+创建时间识别遗留 worker，清理准确的临时目录，避免误杀复用 PID。[取消和中断清理](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_validation.py:221)
- 模型已做冻结、prepare、verify、参数物化；开发模型首次解析后补充文件身份，再离线验证。不应在方案中重新发明模型锁。[模型流程](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_validation.py:340)

## 问题与修改建议

### P1：job 的取消、超时不是全阶段保证

事实：deadline 在 `_run` 入口生成，但只在 `run_command` 的子进程轮询中检查。`model_prepare` 直接在 supervisor 的 daemon 线程中同步调用 resolver，未传 deadline/cancel；resolver 逐个同步调用 backend。`get(cancel=True)` 仅设置当前服务实例内 `_jobs` 的 Event；另一服务实例无法取消尚存活的原 supervisor。恢复逻辑是标记失败并清理，不是恢复工作。[deadline/模型准备](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_validation.py:312)、[轮询检查](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_validation.py:386)、[resolver](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/model_lock_resolver.py:277)

推断：模型准备阻塞时，180 秒测试超时与取消请求不能保证及时结束；服务重启/多实例部署会放大问题。

建议：job 表持久化 `phase/deadline/cancel_requested/owner/lease_expires_at/heartbeat`；模型准备与环境准备也放在可终止 worker 中。所有阶段从同一 deadline 计算剩余时间。启动时扫描失去 lease 的任务，明确进入 interrupted；允许显式重试而非假装续跑。先在现有服务实现，无需先引入大型框架。

### P1：缺少开发请求幂等与任务级预算

事实：每次 develop 创建随机 UUID 和新线程；接口没有 request_id、关联业务 task、父 attempt 或预算字段。单次有时间和样本上限，但不存在跨调用的重试/并发/下载预算。[创建 job](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_validation.py:152)、[接口](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/server.py:88)

建议：添加 `request_id/task_id/attempt_of`；同 request_id+payload 返回原 job，内容变化报冲突；按账户/任务控制同时运行数和累计尝试数。skill 可以建议修复方式，后端决定是否还有预算。开发失败返回 `retryable` 与结构化诊断，禁止由模型无限重发。

### P1：测试目录隔离不等于执行权限隔离

事实：worker 使用 `os.environ.copy()`，然后调整临时和缓存路径；通过普通 Popen 以当前账户启动。AST lint 主要约束 DJ 算子接口；并非任意 Python 的安全沙箱。复制媒体和重写常见输出参数有价值，但不能限制源码任意访问其他绝对路径或网络。[环境和进程](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_validation.py:326)、[参数重写](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_worker.py:53)

建议：明确产品威胁模型。单用户本地模式至少使用环境变量白名单、默认禁网的执行阶段、只读输入与专用输出、资源上限；多人/托管模式需要独立低权限 worker 或已有容器 backend，不能将账户目录隔离宣传成代码权限隔离。模型/依赖获取单独成为受授权的准备阶段。

### P1：validated 仍只是调用方断言通过，不能当任务验收

事实：accepted 由 `purpose` 与非空 `equals` 决定；row_count 本身不能得到 validated。支持的验收只是固定样本 JSON 字段相等/行数。report 已明确写 `Declared JSON output assertions only`，内置算子的 schema 也明确标记不是当前任务质量证据。绑定允许 experimental，未强制业务质量门禁。[断言与报告](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_validation.py:434)、[内置声明](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/operator_catalog_service.py:55)、[绑定](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_store.py:196)

建议：保留现有标识但在 UI/skill 清楚区分 `schema_valid / smoke_passed / contract_passed / task_acceptance`。不要只把“多加 equals”作为提高质量。支持任务独立验收集、数值容差/范围、输出文件检查和人工样本评估。experimental 可允许明确批准的试运行；是否允许全量执行由策略控制，不能默认为失败或成功。

### P2：检索分值融合不可比，未找到不代表能力不存在

事实：内置 BM25 分数按本次最高分归一，最高候选通常为 1；个人候选使用 query token 覆盖率，再将二者按同一 match_score 排序。缺少候选时返回 gap，统一搜索还把底层 `postprocess_script/custom_operator` fallback 改为仅 custom_operator。executor_type 在 discovery 主要作为返回字段，不构成这里的兼容验证。[内置检索](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/discovery.py:190)、[融合](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/operator_catalog_service.py:174)

推断：最高命中分不代表语义置信度；自然语言强匹配的个人候选仍可能受不同标度影响。零命中直接引导开发可能造成不必要开发。

建议：返回 `retrieval_status=no_candidates` 而不是业务 gap；分开保留原始分、rank、检索方法，采用 rank 融合或已校准 rerank。添加能力适用性判断结果（supported/approximate/unknown）与运行兼容性状态。缺口路由保留组合、postprocess、自定义开发三条，不以工具零命中自动授权开发。

### P2：依赖 overlay 的身份没有覆盖实际基座内容

事实：runtime_id 包括 Python 路径/版本、依赖 pins、site-packages 路径，未包含这些目录内包版本/内容；缓存命中依据 ready.json。overlay 的 .pth 直接暴露基座包。新包是精确版本且 `--no-deps`，但未锁下载制品 hash。另一份 runtime lock 确实冻结 uv.lock hash，但安装版本检查只覆盖选中 audited 包集合，不能等同对整个环境做内容验证。[依赖运行时](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_runtime.py:41)、[runtime lock](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/runtime_environment_lock.py:60)

建议：把 base runtime fingerprint 纳入 overlay id；新增包锁 wheel hash/平台标签并保存安装收据。基座变化应失效并重建 overlay。对计划记录运行时验证范围，避免把部分包验证当作完全可复现。

### P2：存在另一套 capability lifecycle，但没有接入本条生产调用链

事实：CapabilityLifecycle 有 staging/building/pending_approval/approved/available 的哈希审批流程；在当前 data_juicer 源码搜索 `CapabilityLifecycle` 只找到定义，MCP 个人算子链直接调用 UserOperatorValidation 并自动发布。[另一生命周期](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/capability_lifecycle.py:33)、[实际 MCP](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/server.py:88)

建议：架构文档明确本地个人算子与共享能力发布的区别，避免将尚未接入的能力当作现有保证。不建议把个人测试通过自动入库也改成固定一次人工审批；共享发布才使用单独治理，执行批准仍由 Plan 层承担。

## 分阶段落地与验收

1. **先保证控制可靠**：幂等 job、持久取消、统一 deadline、阶段状态、并发/重试预算；验收重复请求只建一个 job、模型准备可取消、服务重启不留永久 testing、跨实例取消可见。
2. **再保证解释准确**：候选≠覆盖、schema≠业务质量、experimental 风险显式展示；任务验收独立于自编断言，确认 UI 可看到证据范围。
3. **再补可复现和隔离**：base fingerprint、包制品 hash、worker 权限/网络策略；验收基座变化缓存失效、worker 不能写非授权路径。
4. skill 只负责提出下一步（检索/组合/开发/解释/请求确认），不要再把超时、取消、幂等、审批真实性或累计预算作为仅靠模型记忆的规则。

## 本次测试证据与边界

执行：`D:/dj/.envs/dsh-dj/python.exe -m pytest tests/tools/plan_flow/test_user_operators.py -k 'dependency_conflicts or http_model_ref or custom_model_parameter or low_relevance or relevant_user or immutable_and_account or path_and_binding' -q`。

结果：7 passed，6 deselected，8.30 秒。覆盖账户/版本隔离、路径绑定拒绝、检索候选相关性、依赖冲突、本地模型变更、HTTP 模型身份和模型参数使用检查。出现未注册 integration mark 和既有源码转义警告。没有执行其余真实 worker/取消/模型下载测试，不能据此宣称上述新增风险已被运行复现。现有 cancel/timeout/smoke 测试位于 [test_user_operators.py](D:/dj/data-juicer-1.5.4/tests/tools/plan_flow/test_user_operators.py:289)，没有证明所有模型准备阶段都满足统一 deadline。
