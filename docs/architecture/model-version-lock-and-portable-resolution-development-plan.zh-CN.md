# DJ 与用户自定义算子模型版本固定及跨环境路径解析开发方案

## 1. 文档状态

- 状态：双锁执行框架与 Built-in Catalog 全量调用点审计已实现；当前包含 31 个 HF snapshot、19 个固定单文件和 1 个 OpenCV 包内资源
- 范围：DSH Agent、Data-Juicer Plan Flow、本地 Python 执行后端
- 不包含：DockerBackend、模型训练、公共模型仓库托管
- 目标对象：DJ 内置算子、当前账号的用户自定义算子、不可变 Plan、LocalProcessBackend Run

### 1.1 2026-09-09 实施记录

- 正式 Catalog 已固定 51 个模型/资源条目；31 个 HF 仓库记录不可变 commit 与 294 个运行文件身份，19 个 HTTP 单文件记录 URL、size 与 SHA256，另含 1 个由 uv 锁定 wheel 提供的 OpenCV 资源。锁绑定 DJ `1.5.4` 和源码 revision `a2e21c98532f8767cb590cd5b35c0752a47f56d1`。
- `prepare_plan` 现在生成服务端控制的 `model_bindings`；Plan 不保存解析后的绝对路径。
- Local Worker 增加 `preparing_models`，验证缓存或按固定 commit 下载，写入 `resolved-models.json`，改写运行配方后设置 `HF_HUB_OFFLINE=1` 和 `TRANSFORMERS_OFFLINE=1`。
- 用户自定义算子的 `model_refs` 现在要求 `parameter`；验证阶段使用同一个 resolver，并在发布前补齐远端 snapshot 的文件长度和 SHA256。构造函数不接受或不使用注入参数时拒绝发布。
- 新增离线命令 `python -m data_juicer.tools.plan_flow.model_bundle export <plan.yaml> <bundle-dir>` 和 `... import <bundle-dir> <preloaded-root>`；安装项目脚本后也可使用 `dj-models`。
- Linux/Windows 启动器均透传 `DSH_PRELOADED_MODEL_ROOT` 和 `DSH_MODEL_NETWORK_POLICY`。Linux 断网运行设置 `DSH_MODEL_NETWORK_POLICY=offline`，并把导入目录设置为 `DSH_PRELOADED_MODEL_ROOT`。
- 声明扫描器 `python -m data_juicer.tools.plan_flow.model_requirement_scanner --check` 直接审计内置算子中的 120 个 `prepare_model` 调用点；当前 61 个已锁定、22 个明确阻断、37 个经复核无需本地权重锁，未归类项为 0。阻断项包括 gated/license、动态语言资源、未固定 Git 源和未发布 SHA256 的大文件，不能静默按最新版执行。
- 未进入正式锁清单且明确选择 Hugging Face 模式的算子会返回 `MODEL_REQUIREMENT_UNDECLARED`，不会继续按可变引用执行。历史含模型但无绑定的 Plan 返回 `LEGACY_MODEL_BINDING_REQUIRED`，需生成新 Plan 版本。
- 新 Plan 同时生成 `runtime_lock`：保存 `uv.lock` SHA256、Python 主次版本以及关键包的锁定版本；本地 Worker 运行前复核。模型绑定声明需要哪个关键包时，安装版本与 `uv.lock` 不同会以 `RUNTIME_PACKAGE_MISMATCH` 阻断。
- 正式执行设置 `DATA_JUICER_DISABLE_AUTO_INSTALL=1`，LazyLoader 及已审计的直接安装路径不得在 Worker 内调用 pip/uv 改写共享环境。自定义算子缺少的精确依赖仍只允许安装到当前账号隔离 runtime，并使用 `--no-deps`，不修改 DJ 环境。
- 新增 `http-file`、`modelscope`、`torch-hub`、`python-distribution` 后端；与已有 `huggingface`、`local-file` 一起使用同一 freeze/prepare/verify/materialize 接口。固定 URL 先写临时文件，校验 size/SHA256 后原子发布；Torch Hub 固定 Git commit；ModelScope 固定 revision；包内资源同时受 uv.lock 版本和资源 SHA256 约束。
- OpenCV 的 `haarcascade_frontalface_alt.xml` 已纳入正式 Catalog，锁定 `opencv-contrib-python==4.11.0.86` 和资源 SHA256，并覆盖人脸数量、人脸比例、图片/视频人脸模糊四个算子。
- 启动探针会展示 `uv.lock` 指纹，并报告当前环境漂移；不相关的普通任务不被可选包漂移阻断，实际使用该包的 Plan 会阻断。本机当前检测到 `torch==2.13.0`，而 `uv.lock` 为 `2.8.0`，所以依赖 Torch 的模型 Plan 在环境按锁重建前不会执行。

### 1.2 双锁边界（已定稿）

| 对象 | 锁文件/清单 | 固定内容 | 不负责 |
|---|---|---|---|
| Python 运行环境 | `uv.lock` + Plan `runtime_lock` | 包版本、发行制品哈希、依赖图、Python 版本、lockfile 指纹 | 模型权重、Git 模型仓库、任意下载文件 |
| 模型与辅助制品 | `builtin_model_catalog.json` / User manifest + Plan `model_bindings` | backend、revision/commit、文件 size/SHA256、consumer 注入点 | 安装或升级 Python 包 |

`uv.lock` 不能直接锁普通模型文件。只有资源随 wheel 发布时（例如 OpenCV haarcascade），才由 `uv.lock` 固定 wheel，同时由模型 Catalog 固定实际资源文件哈希。Ultralytics 本体归 `uv.lock`，`.pt` 权重归模型 Catalog；两者缺一不可。

## 2. 背景与问题

当前 DJ 内置算子通常把 Hugging Face 模型仓库名直接传给 `from_pretrained`。没有显式 `revision` 时，Transformers 默认解析远端 `main`。即使远端只修改 README，commit 也会变化；Windows 无法创建 Hugging Face 缓存 symlink 时，同一权重还可能在新 snapshot 下被重复下载。

本机已经发生过该问题：`Falconsai/nsfw_image_detection` 从 `04367978...` 更新到 `96cb0d03...`，新提交只修改 README，模型权重 SHA256 未变，但运行仍重新下载了约 343 MB 权重。

当前实现还有以下缺口：

1. DJ Built-in Catalog 来源于 live `OPERATORS` registry，没有随正式 Catalog 维护的模型依赖和固定版本清单；
2. DJ 内置算子的统一模型加载层能够向 `from_pretrained` 透传参数，但绝大多数算子不声明固定 revision；
3. 当前 227 个 DJ Catalog 算子中，至少 85 个具有名称包含 `model` 的参数，但这些参数混合了 Hugging Face、API、DJ 文件模型、ModelScope、本地 thirdparty 文件和框架模型，不能靠参数名直接决定下载行为；
4. Plan 的 `models` 当前只接受 `artifact_id`，且本地原生执行没有从 DJ 算子默认参数自动解析隐式模型依赖，因此实际使用三个模型的 Plan 仍可能保存为 `models: []`；
5. 用户自定义算子已经要求远端 `model_refs` 使用不可变 commit，但尚未完整冻结远端文件清单，也没有强制源码通过注入的本地模型路径加载；
6. Plan、模型身份和本机缓存路径尚未分层，不能同时保证不可变性、跨机器迁移和缓存复用。

## 3. 目标与非目标

### 3.1 目标

1. DJ 内置算子和用户自定义算子使用的模型都固定到不可变版本；
2. 固定内容至少包含后端、模型 ID、不可变 revision、运行必需文件及内容哈希；
3. 正式 Plan 不保存任何机器相关绝对缓存路径；
4. Runner 在每台机器上根据实际缓存配置解析并注入本地路径；
5. 同一机器上多个任务和多个 Plan 版本复用同一模型缓存；
6. 正式执行不解析远端 `main`，也不静默升级模型；
7. 模型升级产生新的 Catalog 锁、自定义算子版本或 Plan 版本，不改变历史 Plan；
8. 不要求预先下载 DJ 所有模型，支持全量声明扫描、按需下载和常用模型预热；
9. 测试、自定义算子验证和正式 Run 使用相同模型解析规则；
10. 保留当前 DJ、Hugging Face、Torch 等后端缓存目录及环境变量规则。

### 3.2 非目标

1. 本阶段不开发或接入 DockerBackend；
2. 不把模型权重复制进自定义算子目录或 Plan 目录；
3. 不把每次模型下载自动视为 Catalog 升级；
4. 不承诺为没有不可变版本能力的外部 API 模型提供权重级复现；
5. 不靠文件路径或缓存命中反向推导正式版本选择；
6. 不在正式执行阶段自动寻找“可用的相近版本”作为降级方案。

## 4. 核心设计决策

### 4.1 三层身份必须分离

| 层级 | 职责 | 是否包含绝对路径 | 是否可变 |
|---|---|---:|---:|
| Catalog 默认锁 | 规定新 Plan 默认选择哪个模型版本 | 否 | 仅经显式升级修改 |
| Plan 模型绑定 | 固定本次 Plan 实际选择的版本和内容 | 否 | 不可变 |
| Run 路径解析 | 把逻辑绑定映射到当前机器缓存路径 | 是 | 每次 Run 可不同 |

依赖关系为：

```text
DJ Built-in Catalog ─┐
                     ├─→ ModelLockResolver.freeze(plan)
User Operator Store ─┘              │
                                    ▼
                        不可变 model_bindings
                                    │
                                    ▼
                         当前环境 prepare/verify
                                    │
                                    ▼
                  resolved-models.json + materialized recipe
```

### 4.2 下载缓存不是版本事实来源

本机缓存只回答“当前机器是否已有某个固定版本”，不能回答“正式 Catalog 应使用哪个版本”。扫描到新缓存、用户手工下载模型、测试运行下载模型，都不得自动修改 Catalog 默认锁。

### 4.3 执行不跟随可变引用

正式 Plan 禁止保存 `main`、可移动 tag 或未解析的仓库名作为最终模型身份。允许用户在需求阶段写模型名，但 `prepare_plan` 必须将其解析成已批准的 Catalog 锁或要求用户提供不可变 revision。Plan 保存后，执行不再查询最新版。

### 4.4 模型版本与缓存状态正交

每个模型分别维护：

- `lock_status`：是否已有不可变 revision 和文件身份；
- `validation_status`：模型与算子组合是否通过规定验证；
- `cache_status`：当前执行环境是否已有完整文件。

因此 `pinned + validated + missing` 是合法状态：版本已经固定和验证，但新电脑尚未下载。

## 5. 统一深模块：ModelLockResolver

新增深模块 `ModelLockResolver`，把 Catalog 查询、用户算子 manifest、后端 metadata、缓存检查、哈希验证和路径物化隐藏在一个小接口后面。调用方不得自行拼接 Hugging Face snapshot 路径。

建议外部接口：

```python
class ModelLockResolver:
    def freeze(self, plan: dict) -> FrozenModelPlan: ...
    def prepare(self, bindings: list[dict]) -> PreparationReport: ...
    def materialize(self, recipe: dict, bindings: list[dict]) -> MaterializedModels: ...
    def verify(self, bindings: list[dict]) -> VerificationReport: ...
```

接口语义：

- `freeze`：收集 DJ 和 User 算子的模型需求，选择确切锁，生成环境无关的 `model_bindings`；
- `prepare`：在当前环境按绑定检查或下载确切版本，不改变绑定；
- `materialize`：将逻辑模型引用改写为当前机器本地路径，返回物化 recipe 和路径映射；
- `verify`：离线复核文件清单、大小和哈希。

内部设置两类真实 seam：

1. 模型需求 Adapter：`DJModelRequirementAdapter`、`UserOperatorModelRequirementAdapter`；
2. 模型后端 Adapter：已实现 `HuggingFaceAdapter`、`LocalFileAdapter`、`HttpFileAdapter`、`ModelScopeAdapter`、`TorchHubAdapter` 和 `PythonDistributionAdapter`。

测试使用 in-memory Adapter，不访问公网或真实大模型。

## 6. 数据模型

### 6.1 DJ Built-in Model Catalog

建议新增：

```text
data_juicer/tools/plan_flow/builtin_model_catalog.json
```

结构将模型实体与算子消费关系分离，避免 image/video 算子重复声明同一个模型：

```json
{
  "schema_version": 1,
  "dj_version": "1.5.4",
  "dj_source_revision": "<data-juicer-source-commit>",
  "models": {
    "hf:Falconsai/nsfw_image_detection@96cb0d0342c7afb80cab76ecc58b265fa44da256": {
      "backend": "huggingface",
      "model_id": "Falconsai/nsfw_image_detection",
      "revision": "96cb0d0342c7afb80cab76ecc58b265fa44da256",
      "files": [
        {
          "path": "config.json",
          "size": 724,
          "sha256": "<sha256>"
        },
        {
          "path": "preprocessor_config.json",
          "size": 325,
          "sha256": "<sha256>"
        },
        {
          "path": "model.safetensors",
          "size": 343223968,
          "sha256": "97b2ce64ec146884b37f98ee7944ca4891aa72f6827dc0cb10684a1cbecd5830"
        }
      ],
      "lock_status": "pinned",
      "validation_status": "validated"
    }
  },
  "operators": {
    "image_nsfw_filter": [
      {
        "binding_key": "nsfw_classifier",
        "parameter": "hf_nsfw_model",
        "default_model_ref": "hf:Falconsai/nsfw_image_detection@96cb0d0342c7afb80cab76ecc58b265fa44da256",
        "injection": "local_snapshot_path"
      }
    ],
    "video_nsfw_filter": [
      {
        "binding_key": "nsfw_classifier",
        "parameter": "hf_nsfw_model",
        "default_model_ref": "hf:Falconsai/nsfw_image_detection@96cb0d0342c7afb80cab76ecc58b265fa44da256",
        "injection": "local_snapshot_path"
      }
    ]
  }
}
```

Catalog 文件进入 DJ 正式源码管理。它不保存 `cache_status` 和本机路径；这两个信息属于当前运行环境。

### 6.2 用户自定义算子模型清单

沿用不可变版本目录：

```text
<DSH_USER_DATA_ROOT>/<user_id>/custom_operators/<category>/<operator_id>/
└── versions/<operator_content_hash>/
    ├── operator.py
    ├── manifest.json
    ├── model_refs.json
    └── validation.json
```

远端模型引用从当前的 `{model_id, revision}` 扩展为：

```json
{
  "backend": "huggingface",
  "model_id": "owner/model",
  "revision": "<immutable-commit>",
  "files": [
    {"path": "config.json", "size": 123, "sha256": "..."},
    {"path": "model.safetensors", "size": 456, "sha256": "..."}
  ],
  "parameter": "model_path",
  "injection": "local_snapshot_path"
}
```

`model_refs.json` 必须参与自定义算子内容哈希。改变模型 revision、文件集合或哈希即产生新的自定义算子版本。

### 6.3 Plan 模型绑定

现有 `models: [{artifact_id}]` 与历史 capability/Docker 模型制品语义耦合。本阶段不改动该字段，原生执行新增服务端控制的 `model_bindings`：

```yaml
model_bindings:
  - binding_id: model_001
    backend: huggingface
    model_id: Falconsai/nsfw_image_detection
    revision: 96cb0d0342c7afb80cab76ecc58b265fa44da256
    files:
      - path: config.json
        size: 724
        sha256: <sha256>
      - path: preprocessor_config.json
        size: 325
        sha256: <sha256>
      - path: model.safetensors
        size: 343223968
        sha256: 97b2ce64ec146884b37f98ee7944ca4891aa72f6827dc0cb10684a1cbecd5830
    consumers:
      - step_index: 2
        operator: image_nsfw_filter
        parameter: hf_nsfw_model
        provider: dj
```

约束：

1. `model_bindings` 由服务端生成，Agent 不直接填写哈希和本地路径；
2. 同一 `(backend, model_id, revision, files)` 在一个 Plan 中合并为一个 binding；
3. consumer 必须指向实际 `recipe.process` 步骤和真实模型参数；
4. 自定义算子 consumer 还必须匹配 `operator_bindings` 中的确切算子版本；
5. `model_bindings` 进入 Plan bundle 的 `content_hash`；
6. 不允许出现绝对路径、`main` 或可移动 tag；
7. Catalog 更新不得回写历史 Plan。

### 6.4 Run 路径记录

每次 Run 新增：

```text
<run_dir>/resolved-models.json
```

示例：

```json
{
  "schema_version": 1,
  "models": [
    {
      "binding_id": "model_001",
      "local_path": "D:\\shishi\\.cache\\huggingface\\hub\\models--Falconsai--nsfw_image_detection\\snapshots\\96cb0d...",
      "verified": true,
      "verified_at": "<timestamp>"
    }
  ]
}
```

绝对路径只存在于 Run 制品及 `materialized-recipe.yaml`，不进入 Plan 内容哈希。另一台电脑可以解析成不同路径，只要逻辑模型身份和文件哈希一致。

## 7. DJ Built-in Catalog 初始化

### 7.1 不下载全部模型

初始化分为“全量声明扫描”和“按需文件准备”。不得为了生成锁清单下载所有权重。

扫描步骤：

1. 从 live `OPERATORS` registry 取得全部 DJ 算子及参数 schema；
2. 静态分析源码中的 `prepare_model`、`from_pretrained`、`check_model` 和默认模型赋值；
3. 合并显式参数和函数体内设置的默认值，例如 `image_aesthetics_filter` 的空参数在构造函数内转换为真实仓库名；
4. 区分 Hugging Face、API、DJ 文件、ModelScope、Torch Hub、本地 thirdparty 等来源；
5. 对 Hugging Face 仅读取远端 metadata，将 `main` 解析为 commit，并读取文件大小及 LFS 内容哈希；
6. 输出 `builtin_model_catalog.draft.json` 和结构化诊断；
7. 无法可靠识别的条目标为 `manual_review`，不得猜测；
8. 人工复核后提交正式 `builtin_model_catalog.json`。

扫描器只用于生成和维护清单，不在每次服务启动时动态改变正式锁。

### 7.2 初始锁选择规则

按以下优先级选择初始 revision：

1. DJ 源码或发布说明明确指定的不可变版本；
2. 当前已验证并完整缓存的 revision；
3. 与 DJ 当前发布版本时间相符、完成兼容性验证的 revision；
4. 当前远端 `main` 只能作为候选，验证后才能进入正式锁。

“本机下载过哪个”只提供候选证据，不能自动更新 Catalog。

### 7.3 状态展示

DJ Catalog 详情增加：

```json
{
  "models": [
    {
      "model_id": "Falconsai/nsfw_image_detection",
      "revision": "96cb0d...",
      "lock_status": "pinned",
      "validation_status": "validated",
      "runtime_status": "available"
    }
  ]
}
```

`runtime_status` 根据当前服务进程有效缓存目录实时计算，不写回正式 Catalog 文件。

## 8. Plan 准备流程

`PlanFlowService.prepare_plan` 在普通参数校验之后、保存不可变 Plan 之前调用 `ModelLockResolver.freeze`：

```text
解析 recipe.process
    ↓
解析 DJ schema 与 operator_bindings
    ↓
DJModelRequirementAdapter 读取 Built-in Model Catalog
UserOperatorModelRequirementAdapter 读取固定 operator manifest
    ↓
合并模型需求和 consumer
    ↓
拒绝未固定、未声明或冲突的模型
    ↓
生成 model_bindings
    ↓
评估当前缓存及预计下载量
    ↓
保存不可变 Plan、validation 和 execution preview
```

运行预览展示：模型 ID、revision、来源、验证状态、当前是否缓存、预计新增下载量、是否 gated/private、CPU/GPU 要求。路径不展示为 Plan 内容。

如果 Agent 或用户为 DJ 算子显式指定了非默认模型：

- 使用 `model-lock://<approved-model-ref>` 时直接绑定；
- 只给仓库名、`main` 或 tag 时返回 `MODEL_REVISION_REQUIRED`；
- 新模型必须先建立不可变锁并完成要求的验证，不能在执行阶段临时接受。

## 9. 模型准备与缓存复用

### 9.1 不新增 Agent/MCP 工具

模型准备是 `run_plan` 的内部运行阶段，不要求 Agent 调用新的 MCP 工具。Run 状态增加：

```text
starting → preparing_models → running → succeeded/failed/cancelled
```

`get_run` 返回每个 binding 的准备进度和下载/复用结果。

### 9.2 缓存定位

各 Adapter 按当前进程实际环境解析缓存根目录：

- Hugging Face：`HF_HUB_CACHE`，其次 `HF_HOME`；
- DJ：现有 `DATA_JUICER_*` 配置；
- Torch Hub：`TORCH_HOME`/实际 `torch.hub.get_dir()`；
- 其他后端后续按其当前版本真实规则增加。

Plan 和 Catalog 都不保存上述根目录。

### 9.3 下载及并发规则

1. 文件锁键为 `(backend, model_id, revision)`，多个 Plan 同时需要相同模型时只有一个下载者；
2. 只下载 Plan 固定 revision，不解析最新版；
3. 下载结束逐文件校验大小和 SHA256；
4. 中断下载保留后端可安全续传的 `.incomplete`，但不得视为 available；
5. 同一 revision 已完整缓存时不发起文件下载；允许后端进行必要的本地 metadata 读取；
6. Plan v001 到 v005 若引用相同 binding，只复用同一缓存；
7. Windows symlink 不可用不影响正确性，因为固定 revision 不会因 README 更新切换 snapshot；可另行启用 Developer Mode 优化跨 revision 去重，但不作为正确性前提。
8. Adapter 不得安装 Python 包；缺少 SDK 时返回 `MODEL_DOWNLOAD_BLOCKED`，由维护者修改 `pyproject.toml`、更新 `uv.lock` 并重新部署；
9. 固定 URL 下载必须落到同目录临时文件，完成长度和 SHA256 校验后用原子 rename 发布，失败临时文件不得成为缓存命中；
10. 正式 DJ executor 总是启用 HF/Transformers offline，而不是仅在本次 Plan 恰好准备了 HF binding 时启用。

### 9.4 跨机器行为

迁移到新电脑时：

1. 读取同一个不可变 Plan；
2. Adapter 根据新电脑环境变量得到新的缓存根目录；
3. 检查确切 revision 和文件哈希；
4. 若不存在，则在新电脑下载该固定 revision；
5. 写入新 Run 的 `resolved-models.json`；
6. 将新电脑本地路径注入 materialized recipe。

路径不同不影响 Plan 内容哈希或模型身份。

## 10. Recipe 物化与正式执行

Runner 在每次运行中执行：

```text
verify immutable Plan bundle
→ prepare exact model bindings
→ verify exact files
→ copy exact user operator versions
→ rewrite model consumer parameters to local paths
→ write resolved-models.json
→ write materialized-recipe.yaml
→ launch LocalProcessBackend
```

正式 worker 设置：

```text
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
```

并在启动 DJ executor 前再次验证：

1. materialized recipe 中注入位置与 consumer 一致；
2. 本地路径位于当前 Adapter 解析出的允许缓存根；
3. revision 和文件哈希与 Plan 完全一致；
4. 自定义算子源码、资源和模型绑定均属于当前账号允许的版本；
5. 缺失或不匹配时立即失败，不恢复为远端模型名。

运行结束不清理后端模型缓存。自定义算子测试临时文件仍按现有规则删除。

## 11. 自定义算子约束增强

### 11.1 Authoring contract

继续要求所有远端模型声明不可变 commit，并增加：

- `parameter`：接受本地模型路径的构造参数；
- `required_files` 或可解析的加载类型；
- 禁止 `revision="main"`；
- 禁止未声明的模型仓库字符串作为 `from_pretrained` 实参；
- 禁止把模型权重放入小型 text assets。

### 11.2 验证方式

用户算子验证流程改为：

```text
解析并固定 model_refs
→ 在后端公共缓存准备确切 revision
→ 将本地 snapshot 路径注入测试参数
→ 设置 HF/Transformers offline
→ 运行 DJ 原生 executor
→ 校验验收契约
→ 将文件清单写入不可变 operator manifest
```

如果源码忽略注入参数并尝试访问远端，离线验证应失败。源码预检同时提供更早、更清晰的诊断。

### 11.3 版本变化

修改以下任一内容都产生新的用户算子版本：

- 源码；
- 依赖锁；
- 模型 ID 或 revision；
- 模型文件集合或哈希；
- 验收契约；
- 小型资源。

旧 Plan 继续引用旧算子版本和旧模型 binding。

## 12. 模型升级流程

模型升级必须显式执行：

```text
检查远端新 revision
→ 比较运行必需文件的内容哈希
→ 生成升级报告
→ 下载候选 revision
→ 运行兼容性和效果回归
→ 更新 Built-in Model Catalog 或发布新用户算子版本
→ 新 Plan 使用新锁
```

分类处理：

- 只有 README/model card 变化，运行文件哈希未变：记录更新，不要求升级正式锁；
- 配置、processor、代码或权重变化：必须重新验证；
- `trust_remote_code=True` 的任一 Python 文件变化：按高风险行为处理；
- 安全问题要求紧急升级：仍创建新锁和新 Plan，不原地修改历史版本。

Catalog 锁更新只影响之后创建的 Plan。历史 Plan 内的 `model_bindings` 不变。

## 13. 错误码

| 错误码 | 含义 |
|---|---|
| `MODEL_REQUIREMENT_UNDECLARED` | 算子会加载模型，但 Catalog/manifest 未声明 |
| `MODEL_LOCK_MISSING` | 模型没有不可变版本锁 |
| `MODEL_REVISION_REQUIRED` | 使用了仓库名、main 或可移动 tag |
| `MODEL_BINDING_CONFLICT` | 同一 consumer 或模型出现冲突版本 |
| `MODEL_NOT_PREPARED` | 当前环境尚未准备固定版本 |
| `MODEL_DOWNLOAD_BLOCKED` | gated、凭据、许可证或网络阻止下载 |
| `MODEL_FILE_MISSING` | 固定版本缺少必需文件 |
| `MODEL_HASH_MISMATCH` | 本地文件与锁定哈希不符 |
| `MODEL_PATH_FORBIDDEN` | 物化路径不在解析出的允许缓存根 |
| `MODEL_OFFLINE_ACCESS_ATTEMPT` | 正式执行仍尝试远端下载 |
| `LEGACY_MODEL_BINDING_REQUIRED` | 历史 Plan 使用模型但没有固定绑定 |
| `LEGACY_RUNTIME_LOCK_REQUIRED` | 历史 Plan 没有 Python runtime_lock |
| `RUNTIME_LOCK_MISSING` | 找不到或无法解析 uv.lock/runtime_lock |
| `RUNTIME_LOCK_MISMATCH` | Plan 固定的 uv.lock/Python 与当前源码环境不同 |
| `RUNTIME_PACKAGE_MISSING` | 模型绑定需要的 uv 锁定包未安装 |
| `RUNTIME_PACKAGE_MISMATCH` | 已安装关键包版本与 uv.lock 不一致 |

## 14. 代码改动范围

### 14.1 DJ Plan Flow 新增

建议新增：

| 文件 | 职责 |
|---|---|
| `model_lock_schema.py` | Catalog、binding、文件清单的严格 schema |
| `model_lock_resolver.py` | freeze/prepare/materialize/verify 深模块 |
| `model_requirement_scanner.py` | 生成 Built-in Catalog 草稿和诊断 |
| `model_backends/huggingface.py` | HF metadata、缓存定位、固定 revision 准备 |
| `model_backends/local_file.py` | 本地模型文件哈希和路径解析 |
| `builtin_model_catalog.json` | DJ 正式默认模型锁及 consumer 映射 |

### 14.2 DJ Plan Flow 修改

| 文件 | 修改内容 |
|---|---|
| `discovery.py` | DJ operator schema/detail 增加正式模型声明摘要 |
| `operator_catalog_service.py` | 展示 model lock/validation/runtime 状态 |
| `service.py` | `prepare_plan` 调用 freeze，运行预览展示模型准备情况 |
| `validation.py` | 校验 `model_bindings`、consumer、不可变 revision 和禁止路径 |
| `runtime_preflight.py` | 用真实绑定替换当前按参数名推测模型的逻辑 |
| `runner.py` | 增加 preparing_models、路径物化及 resolved-models.json |
| `execution/local_worker.py` | 离线执行前复核模型文件及物化参数 |
| `user_operator_resources.py` | 远端 model_refs 增加文件清单和 consumer 参数 |
| `user_operator_validation.py` | 使用统一 resolver 准备和注入模型 |
| `operator_authoring.py` | 强化源码及模型路径注入约束 |
| `user_operator_store.py` | 解析并返回不可变模型引用，不暴露宿主路径 |
| `presentation.py` | Plan UI 展示模型 revision、缓存和下载量 |

### 14.3 DSH 修改

1. Plan 预览展示每个模型的来源、固定 revision、验证状态、是否已缓存和预计下载量；
2. Run 状态展示 `preparing_models` 及按模型的复用/下载/校验进度；
3. Operator Library 详情展示 DJ/User 模型锁，但不展示账号宿主绝对路径；
4. 启动器继续统一传递现有缓存变量给 DSH、MCP、验证 worker 和正式 worker；
5. 不增加由 Agent 自行填写 revision/hash 的 MCP 参数，不新增模型准备 MCP 工具。

## 15. 兼容和迁移

### 15.1 DJ Built-in Catalog

1. 对当前 227 个算子生成扫描报告；
2. 对至少 85 个模型参数候选逐项分类，参数名扫描仅作为线索；
3. 首批完成 NSFW、watermark、aesthetics 及其 image/video consumers；
4. 已缓存模型校验后登记 exact revision 和文件哈希；
5. 未缓存模型只获取 metadata 并固定候选，不批量下载；
6. 无法确认来源或文件身份的条目标记 `manual_review`；
7. 正式发布前保证所有会隐式下载的 DJ 算子要么有锁，要么在 Plan 准备时明确阻断。

### 15.2 历史 Plan

历史不可变 Plan 不原地补写。处理规则：

- 不使用模型的历史 Plan 可以继续运行；
- 使用模型但没有 `model_bindings` 的 Plan 返回 `LEGACY_MODEL_BINDING_REQUIRED`；
- DSH 基于旧 Plan 创建新版本，补齐绑定并重新展示、批准；
- 新 Catalog 锁不得反向改变旧 Plan 的内容哈希。

### 15.3 历史用户算子

- 已有且不使用模型的版本无需迁移；
- 已有远端 model_refs 只有 commit、缺文件清单时，可在新 Plan 中解析并固定文件清单，但不得改写旧算子目录；
- 源码未接受注入路径或实际忽略固定 revision 的模型型用户算子，需重新验证并发布新版本；
- 原有 validated 不能自动继承到模型行为发生变化的新版本。

## 16. 开发阶段

### P0：Schema 与首批 Catalog 锁

- 实现严格数据类型和读取校验；
- 建立 NSFW、watermark、aesthetics 三个锁；
- 为 image/video consumers 建立明确参数注入映射；
- 完成 Catalog 文件的 DJ 版本和源码版本绑定。

验收：三个模型均不含 `main`，文件身份完整，Catalog 加载失败时服务给出明确错误。

### P1：Resolver 与后端 Adapter

- 实现 freeze/prepare/materialize/verify；
- 实现 HuggingFaceAdapter 和 LocalFileAdapter；
- 支持当前缓存变量、下载锁、完整性校验和跨路径解析。

验收：同一逻辑绑定可在两个临时缓存根解析为不同路径，输出文件身份一致。

### P2：Plan 接线

- `prepare_plan` 自动产生 `model_bindings`；
- validation、content hash、Plan view 和 runtime preflight 接线；
- 拒绝未锁模型和绝对路径。

验收：包含模型的 Plan 不再出现空模型清单；Catalog 更新后旧 Plan 内容不变。

### P3：Local Runner 接线

- 增加 preparing_models；
- 按需准备固定 revision；
- 生成 resolved-models.json；
- 注入本地路径并离线执行；
- worker 二次校验。

验收：同模型的 Plan v001-v005 只下载一次；换缓存根后下载相同 revision，Plan hash 不变。

### P4：用户自定义算子接线

- 扩展 model_refs 文件清单和参数注入；
- 更新 authoring spec、源码预检和 validation worker；
- 统一测试和正式执行的 resolver。

验收：用户算子忽略注入路径或写死 `main` 时无法发布；模型升级产生新算子版本。

### P5：全量扫描、迁移与 UI

- 生成全部 DJ 算子的模型依赖报告；
- 分类和复核首批后续模型；
- DSH 展示 Catalog、Plan 和 Run 三层状态；
- 为历史 Plan 和历史用户算子提供新版本迁移路径。

验收：所有已登记模型型 DJ 算子都能说明固定版本、当前缓存状态和执行路径来源。

## 17. 测试与验收矩阵

### 17.1 模块接口测试

1. 两个算子引用同一模型时只生成一个 binding；
2. DJ 默认模型和 User manifest 模型都经过相同 freeze 接口；
3. `main`、tag、非法 commit、重复 consumer 和冲突 revision 被拒绝；
4. Catalog 缺失模型声明时返回 `MODEL_REQUIREMENT_UNDECLARED`；
5. Plan 中任何绝对模型路径被拒绝；
6. 文件缺失、长度错误、哈希错误分别产生稳定错误码。

### 17.2 缓存和下载测试

1. 相同 binding 连续 prepare 两次，第二次为 cache hit；
2. 五个 Plan 版本引用相同 binding，只发生一次下载；
3. 两个并发 Run 引用相同模型，只有一个下载者；
4. 中断下载不得标记 available，重试可安全续传；
5. 远端 `main` 更新后，已固定 Plan 不访问新 revision；
6. README-only commit 不改变旧锁，也不触发旧 Plan 下载；
7. 切换缓存根后解析出的绝对路径变化，模型身份和 Plan hash 不变。

### 17.3 DJ 与用户算子执行测试

1. DJ NSFW + watermark + aesthetics 混合 Plan 在离线模式成功执行；
2. DJ image/video 算子共享同一 NSFW 或 watermark 缓存；
3. 用户算子使用固定 HF 模型并通过原生 DJ executor；
4. 用户算子声明模型但源码绕过注入时验证失败；
5. DJ + User 混合 Plan 合并重复模型并固定各自 consumer；
6. 发布用户算子新版本后，旧 Plan 仍运行旧模型版本。

### 17.4 跨环境测试

1. 在临时目录 A 准备模型并运行；
2. 将同一 Plan 拷贝到环境 B；
3. B 使用不同 `HF_HOME`；
4. B 下载/解析相同 revision 和文件哈希；
5. A、B 的 materialized path 不同；
6. A、B 的 Plan content hash、模型身份和业务结果契约一致。

## 18. 完成标准

满足以下条件后视为完成：

1. DJ 和用户自定义算子的所有已支持模型需求均有不可变版本身份；
2. 使用模型的新版 Plan 必须包含非空且完整的 `model_bindings`；
3. Plan/Catalog 中不存在本机绝对模型缓存路径；
4. LocalProcessBackend 在正式 DJ executor 启动前完成模型准备和校验；
5. 正式执行处于 HF/Transformers offline 模式，不能静默下载最新版；
6. 相同 revision 可被不同任务和 Plan 版本复用，不重复下载；
7. 不同电脑能把同一 binding 解析到各自缓存目录；
8. Catalog 更新、自定义算子更新和 Plan 更新均保留历史版本可复现；
9. 模型临时下载失败不污染 available 状态，测试文件清理不删除模型缓存；
10. 整套实现不依赖 DockerBackend。

## 19. 当前代码依据

- `data_juicer/tools/plan_flow/discovery.py`：当前 DJ Catalog 从 live `OPSearcher` 生成；
- `data_juicer/tools/op_search.py`：当前 `OPERATORS` registry 和 schema/标签分析；
- `data_juicer/utils/model_utils.py`：当前模型准备与 `from_pretrained` 调用；
- `data_juicer/ops/filter/image_nsfw_filter.py`：默认 HF NSFW 模型但无固定 revision；
- `data_juicer/ops/filter/image_watermark_filter.py`：默认 HF watermark 模型但无固定 revision；
- `data_juicer/ops/filter/image_aesthetics_filter.py`：构造函数内补充默认模型名；
- `data_juicer/tools/plan_flow/validation.py`：当前 `models` 仅接受 `artifact_id`；
- `data_juicer/tools/plan_flow/runtime_preflight.py`：当前主要通过参数名推测模型输入；
- `data_juicer/tools/plan_flow/user_operator_resources.py`：用户远端模型已要求不可变 commit；
- `data_juicer/tools/plan_flow/runner.py`、`execution/local_worker.py`：当前本地物化和执行路径；
- `D:/dsh-app/web-dj.ps1`：当前 DSH、MCP 和 worker 缓存环境变量传递入口。
