# TaskSpec 与需求契约

## 状态与未知项

前置阶段只使用三个状态：

- `draft`：已从自然语言建立初始意图，输入可能尚未检查。
- `input_profiled`：已调用 `inspect_input` 并回填工具能够获得的输入事实。
- `requirement_ready`：用户拥有的 Material Ambiguity 已解决，需求摘要和验收标准已由用户确认，可以开始能力检索。

未知项标记为：

- `known`：已有可靠值。
- `unknown_discoverable`：可由输入或能力探索获得，不应询问用户。
- `unresolved_user_owned`：必须由用户决定，不能从数据或环境推断。

TaskSpec 不要求每个字段都有值。空字段本身不构成歧义；关键是未知项有明确责任归属。

## 建议结构

```yaml
task_spec:
  status: draft # draft | input_profiled | requirement_ready
  goal: null
  scope:
    current_input_only: null
    intended_final_scale: null
  input:
    sources: []
    formats: []
    dataset_path: null
    profile: {}
    discoverable_unknowns: []
  judgment_unit: null
  output:
    artifacts: []
    formats: []
    destination: null
  categories_and_distribution:
    categories: []
    target_distribution: null
  constraints:
    hard: []
    soft: []
  semantic_boundaries:
    included: []
    excluded: []
    positive_examples: []
    negative_examples: []
    boundary_cases: []
  acceptance_criteria: []
  optimization_objectives: []
  material_ambiguities: []
  assumptions: []
```

## `inspect_input` 边界

只回填工具实际返回的事实，例如：

- 文件或记录数量、格式、路径与总规模；
- 视频的时长、分辨率、帧率、编码等媒体元数据；
- 工具已经实现并明确返回的结构信息，如估算 shot 数或是否多 shot；
- 规范化 dataset/manifest 路径。

如果 `inspect_input` 没有返回 shot 信息，不得声称已经检查。保持 `unknown_discoverable`；只有当用户选择片段级任务且该事实会影响可行性时，才交给后置阶段寻找相应能力。不得在前置阶段私自运行 shot detector 或写分析脚本。

## Material Ambiguity

不同答案会实质改变以下任一项时，才属于 Material Ambiguity：

- Pipeline 结构或判断单位；
- 关键参数、阈值、算子、模型或工具；
- 输出制品、类别或目标分布；
- 评估方式、验收结论或优化方向；
- 成本、风险、权限或执行可行性。

对目录视频“判断哪个是运镜视频”，典型用户所有型问题包括：

- 当前只判断这些视频，还是建设从更大库筛选目标规模数据的通用流程；
- 按整条视频分类，还是定位并输出运镜片段；
- 平移、俯仰、推拉、跟拍、环绕、升降、数字 zoom 等哪些算运镜；
- 轻微镜头运动、主体运动和后期裁剪如何处理；
- 输出文件列表、排名、标签还是切出的片段；
- 是否有人工 GT，以及误收和漏检哪个更不可接受。

这些问题可以分轮询问，但不得因它们不妨碍技术搜索就跳过。

## `requirement_ready` 条件

只有同时满足以下条件才能交接：

- 目标、处理范围和判断单位明确；
- 输出制品及必要字段明确；
- 会改变 Pipeline 的语义边界已解决；
- hard/soft 约束、目标规模或分布在适用时明确；
- 验收标准与主要优化取舍可判定；
- 剩余未知项仅为后续可探索事实；
- 用户已确认结构化摘要并允许开始能力检索。

交接时保留 `inspect_input` 返回的 dataset/manifest 路径，避免后置 Skill 重复扫描输入。
