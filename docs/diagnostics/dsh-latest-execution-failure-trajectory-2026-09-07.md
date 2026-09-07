# DSH 最新会话执行失败轨迹与既有实现回归诊断

记录时间：2026-09-07（Asia/Shanghai）  
会话工作目录：`D:\shishi`  
分析截止时间：2026-09-07 15:00:25 +08:00  
分析对象：最新会话 `d5298cc8-737a-4c2f-b1b8-3d1dc5b4aa3d`

> 本文是新的诊断快照，没有覆盖
> `docs/diagnostics/dsh-latest-two-agent-trajectories-2026-09-07.md`。
> 截止分析时该会话仍在运行，因此后续事件不在本文统计范围内。

## 1. 结论

用户判断是正确的：这类需求在 2026-09-03 已经执行成功过。最新会话一直无法完成，
不是因为需求从未实现，也不主要是因为三个人工智能模型未下载，而是以下问题叠加：

1. **共享 DJ Python 环境发生了 OpenCV 包冲突/回归。** 目前
   `D:\dj\.envs\dsh-dj` 同时安装了 `opencv-contrib-python==4.11.0.86`
   和 `opencv-python==5.0.0.93`。两者覆盖同一个 `cv2` 包；实际导入出的
   `cv2 5.0.0` 没有 `CascadeClassifier`，DJ 内置人脸算子因此对每张图片都抛异常。
2. **DJ 把算子异常吞掉了。** 配置中的 `skip_op_error: true` 将异常样本当作跳过/丢弃，
   第一阶段就从 10 条变成 0 条；进程仍以成功退出，run 被标记为 `succeeded`。
3. **成功判定没有验收输出。** `annotated.jsonl` 和统计文件均为 0 字节，仍被接受为成功；
   Agent 先相信状态，再花很长时间调查“为什么成功却没有数据”。
4. **第二版方案已经丢失核心需求。** `plan_v002` 删除了两个人脸算子，实际
   `postprocess: []`，但文字说明却声称会用 YuNet 做人脸检测。即使当前三个 HF 模型全部跑完，
   该方案也不可能验证“恰好一张清晰人脸、面积占比 15%–60%”。
5. **Agent 没有复用同一工作区内 9 月 3 日的成功计划和脚本。** 它重新检索、重新设计，
   随后把环境回归误判成缺少 YuNet 模型，进入反复联网下载和磁盘搜索。

因此，这次“无法执行”包含两个层次：`run_r001` 是**运行环境损坏后产生的假成功**；
`run_r002` 是**仍在 CPU 上缓慢运行、但从定义上无法满足需求的错误方案**。

## 2. 统计口径与数据源

- 模型阶段：`step/start → assistant/message`，接近界面所显示的 think 时间，但不等于
  模型内部纯推理时间。
- TTFT：`step/start → 第一个非空 text/reasoning/tool delta`。
- 工具耗时：`tool/call → tool/result`；其中提问工具主要是在等待用户回答。
- Token：使用 provider 在 `assistant/message.usage` 中上报的数值；尚未完成或被中止的步骤
  不用字符数冒充 token。

主要证据：

```text
C:\Users\hu\.dsh\sessions\--D-shishi--\session-d5298cc8-737a-4c2f-b1b8-3d1dc5b4aa3d\session.jsonl.zstd
D:\shishi\.dj\tasks\task_4e29ba42b6e4\plans\plan_v001\plan.yaml
D:\shishi\.dj\tasks\task_4e29ba42b6e4\plans\plan_v002\plan.yaml
D:\shishi\.dj\tasks\task_4e29ba42b6e4\runs\run_r001\logs\stderr.log
D:\shishi\.dj\tasks\task_4e29ba42b6e4\runs\run_r001\result-manifest.json
D:\shishi\.dj\tasks\task_4e29ba42b6e4\runs\run_r002\run.json
D:\shishi\.dj\tasks\task_c552bf7fa047\plans\plan_v004\plan.yaml
D:\shishi\.dj\tasks\task_c552bf7fa047\runs\run_r002\run.json
```

## 3. 用户需求

最新会话中的原始需求为：

```text
D:\shishi\data\images：保留恰好一张清晰人脸且人脸面积占比 15%–60%的图片；
过滤 NSFW、水印和明显低美学图片；输出实际检测分数、删除原因和阶段计数。
```

用户随后明确：

- “清晰人脸”只使用人脸检测置信度判断；
- 不删除原图；
- 保留图片另行输出；
- 需要逐条报告；
- 三个相关模型已经下载在 `C:\Users\hu\.cache\huggingface\hub`。

## 4. 会话整体指标

截止 15:00:25，该会话包含 2 个 turn、40 个已开始 step，其中最后一个 step 仍未结束。

| 指标 | 数值 |
|---|---:|
| 模型阶段累计 | 2,079,297 ms（约 34 分 39.3 秒） |
| 工具/用户等待累计 | 409,180 ms（约 6 分 49.2 秒） |
| TTFT 累计 | 435,572 ms |
| 首 token 后持续生成 | 1,635,680 ms |
| 未缓存输入 token | 330,217 |
| 缓存读取 token | 2,765,824 |
| 输出 token | 97,570 |

工具耗时不能直接解释为程序运行耗时，其中包括：

- 用户确认等待约 4 分钟；
- 一次递归磁盘搜索约 117.4 秒；
- MCP 和普通文件读取本身大多只需要几十毫秒；
- Step 2.3 的 311.3 秒几乎全是模型/provider 等待，四次文件读取只用了约 120 ms。

## 5. Turn 1：生成计划并得到“假成功”

| Step | 开始时间 | Agent 动作 | 模型阶段 | 工具/等待 | 输入 / 缓存读 / 输出 token |
|---|---:|---|---:|---:|---:|
| 1.1 | 14:17:47 | 加载需求 Skill | 3.581 s | 0.015 s | 10,633 / 0 / 179 |
| 1.2 | 14:17:51 | `inspect_input` | 14.508 s | 0.021 s | 1,326 / 10,624 / 904 |
| 1.3 | 14:18:06 | 提出两项澄清问题 | 93.550 s | 89.847 s 用户等待 | 1,366 / 11,904 / 4,584 |
| 1.4 | 14:21:09 | 确认需求 | 26.316 s | 1.747 s | 17,909 / 0 / 1,723 |
| 1.5 | 14:21:37 | 加载 Plan Flow Skill | 1.807 s | 0.014 s | 1,866 / 17,792 / 92 |
| 1.6 | 14:21:39 | `search_capabilities` | 27.704 s | 0.029 s | 5,266 / 17,792 / 1,873 |
| 1.7 | 14:22:07 | `get_capability_schemas` | 45.390 s | 0.016 s | 3,519 / 23,040 / 2,218 |
| 1.8 | 14:22:52 | 重复检索能力 | 34.494 s | 0.027 s | 3,537 / 26,496 / 2,186 |
| 1.9 | 14:23:27 | 再次读取 schema | 105.446 s | 0.019 s | 33,657 / 0 / 5,945 |
| 1.10 | 14:25:12 | 方案确认 | 249.110 s | 153.135 s 用户等待 | 6,319 / 33,536 / 14,550 |
| 1.11 | 14:31:54 | `prepare_plan`，`task_id=null` 失败 | 40.876 s | 0.016 s | 54,429 / 0 / 2,503 |
| 1.12 | 14:32:35 | 用 `face-image-curation` 重试，失败 | 12.228 s | 0.014 s | 2,554 / 54,400 / 784 |
| 1.13 | 14:32:48 | 用 `face_image_curation` 重试，失败 | 19.480 s | 0.013 s | 931 / 56,832 / 1,220 |
| 1.14 | 14:33:07 | 使用生成的 task id，创建 `plan_v001` | 23.790 s | 2.158 s | 2,176 / 56,832 / 1,371 |
| 1.15 | 14:33:33 | 请求执行确认 | 21.520 s | 2.134 s | 3,199 / 58,880 / 1,251 |
| 1.16 | 14:33:57 | 批准计划 | 7.878 s | 0.035 s | 1,401 / 61,952 / 313 |
| 1.17 | 14:34:05 | 启动 `run_r001` | 10.995 s | 0.088 s | 549 / 63,232 / 525 |
| 1.18 | 14:34:16 | 未调用工具，随后被用户中止 | 9.113 s | 无 | 未上报 |

`plan_v001` 为收集实际分数而把各过滤器阈值设为宽松范围，计划本身包含：

- `image_face_count_filter`
- `image_face_ratio_filter`
- `image_nsfw_filter`
- `image_aesthetics_filter`
- `image_watermark_filter`

但第一项人脸算子处理每张图片时都发生相同异常：

```text
AttributeError: module 'cv2' has no attribute 'CascadeClassifier'
```

由于 `skip_op_error: true`，异常样本全部被过滤，第一阶段日志显示 `Left 0 samples`，
后续算子只是在空数据集上运行。最终：

- `annotated.jsonl`：0 字节、0 行；
- 统计输出：0 字节；
- stderr 明确包含逐样本异常；
- 运行状态和 result manifest 却是 `succeeded`；
- 汇总甚至记录 `Errors: 0`。

这不是一次成功的业务执行，而是运行框架把“全部样本因异常丢失”误报成成功。

## 6. Turn 2：误判原因并生成无法满足需求的计划

| Step | 开始时间 | Agent 动作 | 模型阶段 | 工具/等待 | 输入 / 缓存读 / 输出 token |
|---|---:|---|---:|---:|---:|
| 2.1 | 14:35:14 | 查询 `run_r001`，看到 `succeeded` | 10.164 s | 0.028 s | 1,843 / 63,232 / 224 |
| 2.2 | 14:35:25 | 读取输出，发现 0 行 | 12.105 s | 0.011 s | 1,146 / 65,024 / 434 |
| 2.3 | 14:35:37 | 读取报告、manifest、stderr、stdout | **311.259 s** | **0.120 s** | 66,682 / 0 / 460 |
| 2.4 | 14:40:48 | 继续分析日志 | 14.330 s | 0.017 s | 5,531 / 66,560 / 727 |
| 2.5 | 14:41:03 | 再读日志 | 8.458 s | 0.026 s | 10,007 / 66,560 / 174 |
| 2.6 | 14:41:11 | 编写临时环境诊断脚本 | **196.008 s** | 0.029 s | 13,054 / 76,544 / 11,229 |
| 2.7 | 14:44:27 | 使用错误的 Python 路径运行，失败 | 3.614 s | 0.674 s | 24,316 / 76,544 / 79 |
| 2.8 | 14:44:32 | 找到实际 Python 路径 | 6.372 s | 0.639 s | 283 / 100,736 / 322 |
| 2.9 | 14:44:39 | 检查 cv2 和可用视觉库 | 3.389 s | 6.513 s | 1,165 / 100,992 / 157 |
| 2.10 | 14:44:48 | 设计 `plan_v002`，同时搜索 YuNet | **235.979 s** | 10.906 s | 773 / 102,144 / 13,180 |
| 2.11 | 14:48:55 | 请求批准，并继续尝试下载 | 54.831 s | 4.483 s | 18,221 / 100,736 / 3,387 |
| 2.12 | 14:49:55 | 批准计划，确认 `cv2.objdetect` 也不存在 | 64.508 s | 0.702 s | 3,852 / 118,912 / 3,004 |
| 2.13 | 14:51:00 | 启动 `run_r002`，并发测试网络 | 30.046 s | 0.817 s | 3,316 / 122,752 / 1,594 |
| 2.14 | 14:51:31 | 递归搜索本地 ONNX 文件 | 45.090 s | **117.446 s** | 2,088 / 125,952 / 2,289 |
| 2.15 | 14:54:13 | 查询 `run_r002`，仍在运行 | 33.423 s | 0.030 s | 2,650 / 128,000 / 1,707 |
| 2.16 | 14:54:47 | 询问如何获得人脸模型 | 30.485 s | 7.271 s 用户等待 | 2,300 / 130,560 / 1,705 |
| 2.17 | 14:55:25 | 尝试 PowerShell 下载 YuNet | 10.389 s | 0.882 s | 1,853 / 132,736 / 571 |
| 2.18 | 14:55:36 | 再次尝试下载 | 29.913 s | 0.735 s | 1,273 / 134,528 / 1,766 |
| 2.19 | 14:56:07 | 再次尝试 curl/网络绕行 | 66.449 s | 0.904 s | 3,124 / 134,528 / 3,144 |
| 2.20–2.22 | 14:57 后 | 用网页接口确认 OpenCV Zoo/HF 上的 YuNet，并查询 run | 持续生成 | 短工具调用 | 会话仍在进行 |
| 2.23 | 截止时 | 仍在推理 | 未完成 | 未完成 | 未上报 |

Step 2.3 的 311 秒并非四个文件读取慢。provider 在约 300 秒时发生 idle timeout 后重试，
工具总计仅约 120 ms。这是本次会话里最明显的“think 很久”来源之一。

环境诊断已经获得了正确线索：

```text
cv2 version: 5.0.0
CascadeClassifier: False
FaceDetectorYN: True
mediapipe / insightface / face_recognition / dlib / onnxruntime: not installed
ultralytics: 8.4.138
```

但 Agent 随后没有沿“为什么一个标准 OpenCV 符号消失”继续检查包冲突，而是把问题转成
“下载一个 YuNet 模型”。这使执行路径偏离了真正根因。

### `plan_v002` 的结构性问题

`plan_v002` 仅保留三个 HF 算子：NSFW、美学、水印。两个人脸算子被删除，实际计划中：

```yaml
postprocess: []
```

计划的风险说明却声称将在 postprocess 中使用 YuNet。说明文字和可执行计划不一致，
`prepare_plan` 也没有验证核心验收条件是否仍有实现者。

`run_r002` 截止时并没有卡死：它在 CPU 上执行已缓存的模型。NSFW 首张图片约耗时
213.65 秒，整个 NSFW 阶段约 218 秒，之后进入美学模型。但无论它最后是否以
`succeeded` 结束，都不会产生人脸数量、清晰度和面积比例的合格判定。

## 7. 为什么以前可以执行

同一工作区存在此前的完整实现：

```text
task: task_c552bf7fa047
plan: plan_v004
run:  run_r002
开始: 2026-09-03 14:39:57
成功: 2026-09-03 14:53:14
```

此前计划成功执行了同样的：

- `image_face_count_filter`，运行后保留 10 条；
- `image_face_ratio_filter`，运行后保留 10 条；
- NSFW、美学和水印算子；
- `artifacts/report_and_blur.py` 后处理，使用 Haar cascade 生成逐条报告和模糊图。

最终生成 `report.json`、`kept.jsonl` 和处理后的图片，阶段计数为保留 4、删除 6。
其质量还不完美：目标预期是 3/7，并存在大脸/低美学误保留、有效人像被判水印等问题；
但它确实端到端执行并产生了可用制品。

关键时间关系是：

```text
09-03 14:39–14:53  旧计划执行成功
09-03 16:13        opencv-python 5.0.0.93 被安装进共享 dsh-dj 环境
09-07              同一人脸算子报 CascadeClassifier 不存在
```

当前共享环境：

```text
D:\dj\.envs\dsh-dj\python.exe
opencv-contrib-python 4.11.0.86
opencv-python         5.0.0.93
cv2 imported version  5.0.0
CascadeClassifier     False
FaceDetectorYN        True
```

作为对照，另一个未发生该混装的环境：

```text
D:\dj\data-juicer-agents\.venv\Scripts\python.exe
opencv-contrib-python 5.0.0.93
CascadeClassifier     True
FaceDetectorYN        True
```

OpenCV 多个 wheel 共用同一个 `cv2` 命名空间，混装不同版本很容易造成文件相互覆盖。
结合安装时间和前后运行结果，这是本次回归最直接、最强的因果证据。

## 8. 完整故障链

```text
共享环境安装第二套且版本不一致的 OpenCV wheel
    ↓
cv2 导入成功，但缺少 CascadeClassifier
    ↓
能力检索/资源预检只判断“算子可用”，未做符号或单样本 smoke test
    ↓
image_face_count_filter 对 10 张图逐一抛异常
    ↓
skip_op_error=true 将异常样本全部丢弃
    ↓
输入 10 条 → 输出 0 条，但进程返回成功
    ↓
run/result manifest 错标 succeeded，验收层未检查空输出
    ↓
Agent 相信成功状态后重新调查，并误转向下载 YuNet
    ↓
plan_v002 删除人脸阶段且没有实际 postprocess
    ↓
CPU 上慢跑三个 HF 模型，但永远无法满足核心人脸条件
```

## 9. Agent 决策上的具体问题

1. 能力检索重复，schema 读取后又重新搜索，增加了模型上下文和生成量。
2. `prepare_plan` 连续使用三个非法 task id 才创建成功，说明 task 生命周期约束没有在工具调用前固化。
3. 没有在新建计划前检索当前目录的历史 task、plan 和 artifacts，丢失了可直接复用的成功实现。
4. 遇到内置算子失败后，没有进入已经建立的
   `get_custom_operator_authoring_spec → develop_custom_operator → validate_custom_operator`
   自定义算子闭环，而是临时拼接 postprocess 和下载命令。
5. `plan_v002` 的说明与 YAML 不一致，且没有按验收条件做静态覆盖检查。
6. `run_r002` 仍在运行时继续做递归磁盘搜索和多轮下载尝试，增加等待和上下文噪声。
7. 用户已经说明 HF 模型在本地缓存，Agent 仍把主要精力放在新增 YuNet 下载；实际第一优先级应是恢复
   已经跑通过的 OpenCV 环境和实现。
8. 会话输出 97,570 token，存在大量重复分析；Step 2.3 还叠加了 provider 300 秒超时重试。

## 10. 修改建议

### P0：先恢复正确性

1. **统一 OpenCV wheel。** `dsh-dj` 环境中只能保留一套版本一致的 OpenCV 包。
   可恢复到一个经过验证的 `opencv-contrib-python` 版本，并重新验证
   `cv2.CascadeClassifier`、`cv2.FaceDetectorYN` 及现有 DJ 人脸算子。不要只通过
   `import cv2` 判断环境健康。
2. **计划执行前做 operator smoke test。** 对选中的算子至少实例化一次；对关键算子用一条样本试跑。
   人脸算子预检应直接验证所需符号，而不是只验证包名、设备和资源目录。
3. **不要把算子异常计为正常过滤。** plan-flow 执行建议默认 `skip_op_error: false`；如确需容错，
   也必须记录 error count，并在全部样本异常或错误率超过阈值时将 run 标为失败。
4. **将业务验收接入成功状态。** 输入非空而输出为 0、必需报告为空、必需字段缺失、阶段计数不闭合时，
   `run_plan` 不能返回业务 `succeeded`。
5. **停止或废弃 `plan_v002` 结果。** 它缺少人脸处理阶段，不能作为本需求的有效运行结果。

### P1：让 Agent 复用已知实现

1. 在 `search_capabilities` 前增加“当前 workspace 历史计划/自定义算子/后处理制品”检索，
   同一输入目录和相似需求优先基于已成功 plan 修改，而不是从零规划。
2. 复用并修正 `task_c552bf7fa047/plan_v004` 的结构：保留完整报告和输出逻辑，
   先解决环境回归，再针对 4/6 与目标 3/7 的质量差异调参或替换算子。
3. 若 DJ 内置人脸算子修复后效果仍不够，再走自定义算子标准流程；自定义算子负责弥补质量缺口，
   不应被用来掩盖共享环境已损坏的问题。
4. `prepare_plan` 增加验收覆盖校验：每一项硬性需求必须能映射到具体 operator、postprocess 或输出字段；
   禁止仅在说明中出现而 YAML 中没有实现。

### P2：减少“像卡住”的等待

1. 本地已缓存的 HF 模型应固定 revision，并在确认资源完整后使用离线/`local_files_only` 模式，
   避免每次 HEAD 请求和网络失败重试。
2. 计划确认前展示设备预测；当三个大模型只能在 CPU 上执行时，明确预计耗时。
3. 对 provider idle timeout、工具等待和模型生成分别打点，UI 不要统一显示为 think。
4. 限制连续无新证据的重复搜索/下载；一次失败后应回到根因假设和既有成功基线。

## 11. 最小恢复路径

建议按以下顺序恢复，而不是继续等待 `run_r002`：

1. 修复并锁定 `D:\dj\.envs\dsh-dj` 的 OpenCV 依赖；
2. 在该解释器中验证 `CascadeClassifier=True`，并对一张输入图试跑两个人脸算子；
3. 以 9 月 3 日的 `plan_v004` 和 `report_and_blur.py` 为基线重新执行；
4. 加入“非空输入 → 非空报告/计数闭合”的强制验收；
5. 在正确性恢复后，再处理检测质量从 4/6 调整到目标 3/7；
6. 若内置算法的质量上限不足，再生成、验证并发布当前用户可调用的自定义人脸算子。

## 12. 附注

- Agent 为诊断创建了临时文件 `D:\shishi\.dj\diag.py`，本文没有删除它。
- 本文只做诊断和方案记录，没有修改共享 Python 环境，也没有终止当时仍在运行的任务。
- 后续若继续追踪该会话，应另存新的时间点快照，避免把运行中数据与本文截止时数据混合。

## 13. 后续确认与修复（15:14 后）

后续跨会话检索找到了第二套 OpenCV 的准确安装来源。2026-09-03 16:09:04，
DSH 会话 `session-13d5b758-605e-4e63-8186-741a39d08418` 为开发水印检测功能直接执行：

```text
D:\dj\.envs\dsh-dj\python.exe -m pip install ultralytics
```

该命令没有经过 DJ 项目的 `uv.lock` 和 `[tool.uv].override-dependencies`。它安装了
`ultralytics 8.4.138`，并在 16:13:19 连带安装 `opencv-python 5.0.0.93`，覆盖了已有
`opencv-contrib-python 4.11.0.86` 的共享 `cv2` 文件；同时把 NumPy 升级到 2.5.2，
违反 `py-data-juicer 1.5.4` 的 `numpy<2.0.0` 约束。

修复动作：

- 终止没有人脸阶段、仍在运行的 `plan_v002/run_r002`，并通过 PlanRunner 将其收敛为
  `failed / RUNNER_LOST`；
- 清除冲突包，恢复项目锁定组合：NumPy 1.26.4、唯一的
  `opencv-contrib-python 4.11.0.86`、Ultralytics 8.3.159、ultralytics-thop 2.0.14、
  py-cpuinfo 9.0.0；
- 新增 `scripts/test-dj-runtime.ps1`，检查 OpenCV distribution 唯一性、关键 cv2 符号、
  Haar cascade 加载及两个人脸算子实例化；
- `web-dj.ps1` 在启动 MCP 前强制执行该检查，环境再次混装时直接拒绝启动；
- 重启 8010 plan-flow MCP，保留原 57035 DSH Web 进程。

验证结果：

```text
DJ runtime OK
OpenCV distributions: [('opencv-contrib-python', '4.11.0.86')]
cv2=4.11.0; face operators instantiated
```

DJ 原生回归测试：

```text
image_face_count_filter::test_filter_1       passed
image_face_ratio_filter::test_filter_small   passed
2 passed in 22.01s
```
