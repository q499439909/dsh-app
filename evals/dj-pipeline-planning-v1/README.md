# Data-Juicer Pipeline Planning Benchmark v1

这个测试集评估 DSH + Data-Juicer 在“当前算子可达性判断”和“Pipeline 方案设计”上的表现，不直接评估算子的像素级或模型级实际效果。

## 覆盖范围

核心集共有 12 个用例，完整覆盖：

| 模态 | 可达性 | 低 | 中 | 高 |
| --- | --- | --- | --- | --- |
| 文本 | 可达 | TXT-R-L | TXT-R-M | TXT-R-H |
| 文本 | 不可达 | TXT-U-L | TXT-U-M | TXT-U-H |
| 图片 | 可达 | IMG-R-L | IMG-R-M | IMG-R-H |
| 图片 | 不可达 | IMG-U-L | IMG-U-M | IMG-U-H |

难度指规划难度，不指运行成本：低难度通常只有 1–2 个原子目标；中难度有多个步骤、阈值或顺序依赖；高难度包含多阶段、跨样本状态或复合验收。

## 文件说明

- `cases.json`：12 个任务提示、输入 profile、硬验收标准和隐藏 gold oracle。
- `capability-scope.json`：冻结的能力边界。专门排除脚本、自定义算子和通用模型逃生口。
- `fixtures/text-fixtures.json`：文本样本或逻辑分层。
- `fixtures/image-fixtures.json`：图片语义 profile。当前没有绑定真实媒体文件。
- `rubric.json`：100 分评分量表、硬失败条件和套件级指标。
- `case.schema.json`：单个 case 的 JSON Schema。
- `validate_dataset.py`：验证矩阵、引用、记录数和可达/不可达 oracle 不变量。

## 推荐执行方式

1. 向被测 Agent 只提供 `task_prompt`、`input_profile`、对应 fixture，以及 `capability-scope.json` 中的公开边界。
2. 不提供 `reachability`、`difficulty` 和 `gold`；这些字段只供评测器使用。
3. 记录 Agent 的能力检索、schema 加载、候选方案、能力缺口和用户确认行为。
4. 用 `rubric.json` 逐例评分，再计算可达性混淆矩阵及按模态、难度分组的得分。
5. 不调用正式 `prepare_plan` 或运行链；本套件的终点是“方案等待确认”。

运行结构校验：

```powershell
python .\validate_dataset.py
```

## 判定规则

- `reachable` 表示冻结范围内的专用当前算子可以覆盖全部硬验收标准。
- `unreachable` 表示至少一项硬验收存在真实能力缺口；部分覆盖不能改判为可达。
- 当前运行环境缺依赖、模型或凭证时，另记为 `runtime_blocked`，不能篡改目录级 gold label。
- 不可达用例允许提出扩展能力，但必须先声明 gap，且不能把扩展方案说成当前原生能力。

以下情况属于硬失败：把不可达判成完全可达、用不等价算子冒充目标效果、越过确认门生成/执行正式 Plan、或偷偷启用被冻结范围排除的逃生能力。

## 图片夹具说明

当前图片夹具是用于规划评测的确定性语义 profile，例如尺寸、人脸数量、水印类型和期望决策。这样可以先稳定测试“系统是否理解能力边界”，而不把图片生成随机性、媒体许可和具体模型误差混进测试。

实际运行 `IMG-R-L`、`IMG-R-M`、`IMG-R-H` 的媒体夹具已单独放在 `materialized-v1/`，
包含图片、运行 manifest、gold 标注和内容 hash。其效果评测仍需与本规划测试分开报告；
模型相关阈值的适用边界见 `materialized-v1/README.md`。
