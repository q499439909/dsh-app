# Plan 执行与交付契约

完整参数、路径语义、审计组件和报告输出以 `get_plan_contract` 返回的版本化 schema 为准。此文件只保留最小例子，避免维护两套字段定义。

`recipe.process` 每项只有一个算子名，参数嵌套在该名称下。字段绑定放在 DJ 要求的配置层，不靠记忆猜测 schema。

```yaml
user_intent: 清洗文本，保留 id
recipe:
  dataset_path: D:/workspace/input.jsonl
  export_path: processed.jsonl
  process:
    - clean_links_mapper: {repl: ""}
  executor_type: default
  np: 1
postprocess: []
expected_outputs:
  - id: corpus
    path: processed.jsonl
    format: jsonl
    producer: {kind: recipe}
    required_fields: [id, text]
acceptance_criteria: []
acceptance_checks:
  - id: review_quality
    kind: manual
```

输出路径相对本次 Run 输出目录。recipe producer 只能对应 recipe 的导出文件。图像报告优先配置 `postprocess: [{kind: image_audit, audit_mode: full, rules: [{id: face_count, field: face_counts, min: 1, max: 1}]}]`。其规则字段从算子 schema 获取；recipe 仅包含打分过滤器，宿主在 Run 中保留全量样本，再生成 decisions/kept/summary。cascade 模式只省后续判定，不承诺节省模型推理成本；缺失分数不等于 0。零保留默认合法。

报告、复制图片等由 `producer: {kind: postprocess, index: 0}` 指向真实后处理步骤。原生组件无法满足时，脚本要在 prepare_plan 前写好并通过 postprocess 引用进入快照。不要承诺在运行后另写脚本补业务工作。

原生审计同时生成 report.md，报告消费同一份 decisions/summary，不另写脚本重复判定。严格小于阈值设置 `max_inclusive: false`；输出字段以工具返回的 output_schemas 为准。

支持的检查：`row_count`、`field_equals`、`audit_consistency` 和 `manual`。存在 acceptance_criteria 时，检查 criterion 必须绑定其中的准确文本。audit_consistency 的 output_id 指向原生 summary；主观标准没有证据时保持 unverified，不能用数量范围代替质量证据。

prepare_plan 自动冻结本地输入及引用媒体。路径不支持或快照超限时报告限制，不绕过工具运行。新计划展示输入快照、输出、步骤、重要参数和运行阻断。修改计划使用 task_id + base_plan_version，旧版本不编辑。
