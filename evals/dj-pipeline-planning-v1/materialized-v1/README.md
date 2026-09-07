# Reachable image fixtures: materialized-v1

这套媒体夹具用于实际运行 `IMG-R-L`、`IMG-R-M`、`IMG-R-H`，与只评估规划能力的
`fixtures/image-fixtures.json` 分开保存。

## 目录

- `sources/`：图像生成工具产生的 8 张基础图。保留为不可变来源。
- `IMG-R-L/`：8 张精确尺寸边界图。
- `IMG-R-M/`：10 张人像筛选和人脸模糊输入图。
- `IMG-R-H/`：14 张图文精选输入图。
- 每个 case 包含 `input.jsonl`、`gold.json`、`checksums.sha256` 和 `images/`。
- `source-prompts.json`：基础图的最终生成提示词与生成方式。
- `build_materialized.py`：由基础图确定性重建全部变体和 DSH 镜像。

## DSH 可直接运行的位置

构建脚本把每个 case 同步到：

- `evals/dj-pipeline-planning-v1/dsh-workspace/inputs/<CASE_ID>/`
- `D:\shishi\evals\dj-pipeline-planning-v1\inputs\<CASE_ID>\`

镜像中的 `input.jsonl` 使用对应镜像图片的绝对路径，可直接交给本机 DSH。
`image_path` 字段是单元素路径数组（而不是裸字符串），运行时应为图像算子配置
`image_key: image_path`；这是 Data-Juicer 多模态算子的输入契约。

## Gold 的使用边界

- `IMG-R-L` 是确定性元数据 oracle，可以要求 100% 判定准确。
- `IMG-R-M` 的人脸数量和面积比例是人工标注/工程化分层。运行模型可能使用不同的人脸框定义，
  应先把这 10 张图作为 canary 校准阈值，再评分。
- `IMG-R-M`、`IMG-R-H` 的 `nsfw-proxy` 是成年人的非露骨泳装图，只用于安全模型阈值探针。
  它不保证被所有 NSFW 模型判为不安全，因此该单条应记录实际分数，不能作为跨模型硬 oracle。
- 水印、低质、拼图、尺寸、极端宽高比、重复簇和空间关系错配均有显式 gold。
- 模型评分不预写到 gold；评测时应输出实际分数、阈值、模型标识和删除原因。

## 重建与校验

```powershell
python .\materialized-v1\build_materialized.py
```

脚本会覆盖同名派生图片和 manifest，但不会改写或删除 `sources/` 中的生成原件。
