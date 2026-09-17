---
name: data-juicer-plan-flow-zh
description: 使用 DJ tools 检查本地数据、编排处理管线、管理 Plan 版本、请求用户批准并执行；也用于继续已有 task、plan 或 run。需要业务澄清时按需询问。
user-invocable: true
---

# Data-Juicer 管线编排

沿用标准 preset，按需调用工具。使用当前 DSH 会话工作区；DJ 服务负责能力、版本和执行，源码目录不是业务工作区。普通编排优先使用自足工具契约，已取得的有效证据可以直接复用。不要读取凭证文件，也不要在工具受阻时用 shell 绕过授权或审批。

## 主流程

1. 缺少输入事实时调用 inspect_input；继续任务时用 get_workflow_status/get_plan/get_run 恢复。路径、判断单位、输出或成本边界存在实质歧义时才询问，见 [澄清指南](references/clarification.md)。用户已说明的需求直接沿用。
2. 用 search_capabilities 搜索所需行为，再对相关候选调用 get_capability_schemas。证据足够就编排；有明确未覆盖行为才补查。检索分数不等于质量保证。get_capability_schemas 返回的参数表和 output_contract 已包含编排所需的全部信息（参数含义、默认值、输出字段路径、响应结构、归一化规则）；不要为了"确认 input_template 占位符""了解图片如何注入""查看默认 prompt"等编排无关的内部实现去读算子源码。只有契约冲突、工具异常或结果不符时才按"有目的的诊断"读取相关源码。
3. 首次需要 Plan 字段/报告规则时调用 get_plan_contract，组织 recipe、必要 postprocess 和 expected_outputs。图像分数/淘汰原因/阶段计数优先用 image_audit；它在 Run 中全量打分，再按规则判定，成本在审批前说明。每项需求记录 covered / gap / needs_user_input 与证据；不能用人脸数量或面积代替清晰度。最小例子见 [Plan 契约](references/plan-contract.md)。目标仅为方案时，生成可审查 Plan 后交付即可。
4. 任务授权范围内可以准备脚本和调用 prepare_plan 创建草案；不要提前执行数据处理。工具返回校验错误或 runtime blockers 时先修正或报告阻断。
5. prepare_plan 成功后给出简短摘要，直接调用 confirm_plan；其问答详情提供准确版本、全部节点、规则、输出、缺口和实测模型准备成本，不在聊天中重复整份 JSON。该工具使用宿主结构化问答，绑定 task_id、plan_version、content_hash；用户选择后宿主持久化审批并自动启动。卡片是可选入口。普通 ask_user_question 用于澄清；执行确认复用同一问答机制，由 confirm_plan 记录版本绑定。
6. confirm_plan 返回 queued/run 后由宿主结束本轮并交付回执。刷新、响应丢失用 get_workflow_status/get_plan 恢复原记录。失败后用户明确要求重试时，confirm_plan 的 retry_of 指向该失败 Run；网络重放不会创建新运行。存在 gap 时由同一问答明确记录接受哪些缺口；needs_user_input 先澄清。改变执行内容才创建新版本并批准。
7. 用 get_run 取得进度、失败阶段和输出信息；界面会自行同步状态，不做紧密轮询。取消用 cancel_run，并核对 cleanup_pending=false。环境阻断用 inspect_runtime 查看差异和维护动作，沿用已有维护授权；不要把“无权修改共享环境”作为无恢复入口的结束语。
8. 交付 Plan/Run 标识、输出及报告位置，分别说明 execution_status、delivery_status、acceptance_status。只有必要输出齐全且硬验收通过才称任务完成；缺少语义证据明确为未验证。

## API 算子约束

API 传输配置由 DJ 服务统一持有。Plan 中不得填写 `model_params.base_url`、`model_params.api_key`，也不得把绝对 URL 写入 `api_endpoint`；只允许按算子需要填写 `/chat/completions` 这类相对路由。不要擅自切换供应商、读取环境文件，或让 postprocess 脚本自行取密钥绕开 DJ。

API 算子必须失败关闭：使用 `skip_op_error: false`。请求被拒、响应为空或无法解析时应将 Run 标为失败并报告真实错误，不能用空标签、空分数或全量“其他”伪装成功。若服务端配置完整但端点不接受算子实际发送的多模态协议，应报告“端点协议不兼容”，停止执行并等待端点契约或适配器方案；不得仅凭模型名称推断并改用另一家地址。

## 能力缺口

先判断是未找到、语义不满足还是环境不可用。考虑已有算子组合；外围报告/复制可以用进入 Plan 的 postprocess。核心新处理需要自定义算子时读取 [开发指南](references/custom-operators.md)，使用 authoring spec → develop → job/验证结果 → schema → Plan。

新增费用、权限或超出既定范围的资源使用先确认。已有开发授权且范围未变时直接推进。测试通过不等于任意数据上的语义质量通过；预算耗尽或不可恢复失败时说明问题，不用新任务/新算子 ID 绕过限制。

## 有目的的诊断与开发

工具异常、契约冲突或结果不符时，可以围绕具体问题读取相关源码、失败日志和有权访问的成功记录；先说明检查目标，取得证据后停止。不需要新 preset 或额外模式切换。授权失败时按恢复入口处理，不能从通用文件工具读取被拒绝任务的内部制品。

允许 shell 编写脚本和运行限定样例测试。源码、依赖、输入输出契约和验证证据应固定为自定义算子或受控后处理制品；正式数据处理纳入批准的 Plan/Run。不能先在 shell 中完成正式处理再补登记。连续遇到相同错误、重复检索无新证据时整理已知事实和具体缺口，不继续无目标阅读。
