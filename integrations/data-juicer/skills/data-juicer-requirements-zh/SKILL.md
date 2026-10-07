---
name: data-juicer-requirements-zh
description: 兼容旧会话中的 Data-Juicer 需求澄清入口；新数据处理任务统一使用 data-juicer-plan-flow-zh。
user-invocable: true
---

# Data-Juicer 需求澄清兼容入口

加载 data-juicer-plan-flow-zh 并继续当前目标；已加载时直接继续。需求澄清为按需步骤，不再要求 requirement_ready 或固定需求确认。

已明确的目标、输入范围、输出和用户批准继续有效；实际执行以 DJ 保存的准确 Plan 版本与可信审批为准。旧 TaskSpec 可作为上下文，不作为额外门禁。
