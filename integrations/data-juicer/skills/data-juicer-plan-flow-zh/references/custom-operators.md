# 自定义算子开发

仅在检索和组合仍不能满足业务要求时读取。先记录缺口与已有候选的不足。

正常路径固定为：`search_capabilities → 确认 gap → get_custom_operator_authoring_spec → develop_custom_operator → get_custom_operator_job → validated → 返回 candidate_id`。

1. 调用 get_custom_operator_authoring_spec，只把它用于获取当前 DJ version 下 category × modality 的 imports、base class、methods、source_scaffold、输入输出约定和 validation_contract 写法。它不生成或执行源码，也不代替 capability 搜索。
2. Agent 按 spec 生成 source，固定 validation_contract 和有代表性的临时 samples；媒体样例优先声明 develop_custom_operator 的 validation_fixtures，并在 sample 媒体字段中用 `$fixture:<as>` 引用，不用 Shell/Python 自建文件。当前只支持 Backend 生成 deterministic Image fixture，不猜测或伪造 Video fixture。随后提交 develop_custom_operator，由 DJ MCP Backend 生成临时 fixture、完成静态检查、真实 DJ Runtime 首次验证和成功后的个人版本发布。DJ MCP Backend 是唯一权威验证环境。依赖精确锁版本；远程模型声明不可变 revision；本地模型使用已存在路径；API 凭证只用后端配置。新增费用、权限或超出用户既定资源范围时确认，已有授权沿用。
3. develop 返回 job_id 后，用 get_custom_operator_job 只读查询 running / failed / validated / experimental、结构化诊断、candidate_id 和 validation summary；它不取消、重跑或修改任务。失败时读取并报告 error_details 的 phase、reason，以及可用的 field、expected、actual、hint。模型准备、依赖安装和执行共用 deadline。validation contract 引用 `__dj__stats__.*` 时，后端自动让 stats 在验证输出中可观察，Agent 不设置 `keep_stats_in_res_ds` 等内部配置。
4. develop/job 为 failed 或 experimental 时，根据 error_details 修正 source、samples 或 validation_contract，并使用**相同 operator name / ID** 再次调用 develop；如果传了 request_id，本次新提交使用新的 request_id。不要为了重试改算子名。每次尝试都是独立、可审计的 draft，失败 draft 不发布、不生成 candidate_id，也不进入 capability catalog。正常路径禁止搜索 DJ 源码、寻找旧 venv、本地 import DJ 或用 Shell 预验证。只有已经出现具体且后端诊断不足的异常证据时，才进入有目的的维护诊断；预算耗尽时报告阻断，不换任务或算子 ID 绕过。共享 DJ 修复属于维护范围，沿用已有授权，不以业务算子开发隐式改共享依赖。不把测试写入业务数据目录，不通过无业务依据地改样本或删断言降低验收标准。
5. 只有 validated 后才发布不可变版本，并向用户返回完整 `candidate_id = user:<operator_id>:<content_hash>`；后续引用个人算子必须使用 candidate_id，不用普通 name。已有 published version 不受后续失败 draft 影响；同名新 draft validated 后以新的 content_hash 发布新版本。到此结束自定义算子开发流程，不得无理由继续 prepare_plan。只有用户还明确要求“用这个算子处理数据”时，才继续读取该 candidate_id 的 schema、编排 Plan 并走审批流程。develop 已包含首次验证，不要默认调用 validate_custom_operator；validate 只用于已有版本在 dependency/runtime 变化后的显式复验或用户明确要求的重新验收。published version 的源码、contract 和内容哈希不可变；draft 的 contract 可在下一次 develop 中修正。validated 仅覆盖声明的 JSON 断言，语义质量不足时明确说明；experimental 仍是 draft，不生成 candidate_id，也不声称质量已验证。

不要在验证通过前提前执行业务处理。后端负责个人版本发布与临时目录清理，skill 不维护第二份状态机。
