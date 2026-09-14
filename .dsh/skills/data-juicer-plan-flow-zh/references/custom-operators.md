# 自定义算子开发

仅在检索和组合仍不能满足业务要求时读取。先记录缺口与已有候选的不足。

1. 调用 get_custom_operator_authoring_spec，按返回的 source_scaffold、当前版本接口、required_methods 和 model_policy 实现。不要凭记忆猜 DJ 接口。
2. 固定 validation_contract 和有代表性的临时样本，再提交 develop_custom_operator。依赖精确锁版本；远程模型声明不可变 revision；本地模型使用已存在路径；API 凭证只用后端配置。新增费用、权限或超出用户既定资源范围时确认，已有授权沿用。
3. 根据结构化诊断修正；可读取相关源码、授权成功记录，允许在候选目录落盘脚本并通过 shell 测试限定样例。预算由后端计算，耗尽时报告阻断，不换任务或算子 ID 绕过。共享 DJ 修复属于维护范围，沿用已有授权，不以业务算子开发隐式改共享依赖。不把测试写入业务数据目录，不通过改样本或删断言降低验收标准。
4. job 为 testing 时按需查询 get_custom_operator_job；失败报告 error_details.phase。取消传 cancel=true，并检查 cleanup_pending=false。模型准备、依赖安装和执行共用 deadline。
5. validated 或 experimental 后才引用 candidate_id，重新读 schema 并编排 Plan。validated 仅覆盖声明的 JSON 断言，语义质量不足时明确说明；experimental 不声称质量已验证。复验使用 validate_custom_operator。

不要在验证通过前提前执行业务处理。后端负责个人版本发布与临时目录清理，skill 不维护第二份状态机。
