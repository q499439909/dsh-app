# DSH + Data-Juicer：Agent 驱动的缺失能力补齐与 Docker 执行闭环开发方案

状态：Proposed

日期：2026-08-30

范围：当前 Windows 本机、DSH 控制面、Data-Juicer Plan Flow、Docker Desktop、本地小规模数据

## 1. 目标

本方案要完成的不是某一个“人脸 Mask Pipeline”，而是一条可复用的通用闭环：

```text
用户提出数据处理需求
  ↓
DSH Agent 形成并确认 TaskSpec
  ↓
将需求拆成 Atomic Requirement
  ↓
检索 DJ 内置算子和已批准 Capability Catalog
  ├─ 全部覆盖：直接形成候选 Plan
  └─ 存在缺口：研究、下载、开发、构建、验证新 Capability
                         ↓
                   Capability 审批
                         ↓
             发布可复用 Operator/Model Artifact
  ↓
按 DJ 现有算子 + 新算子编排标准 recipe.process
  ↓
解析并组合 Runtime Manifest
  ↓
展示具体 Plan、Preview 证据和验收映射
  ↓
Plan 审批
  ↓
Docker Broker 隔离执行
  ↓
收集数据、媒体制品、报告和 provenance
```

人脸 Mask 仅作为首个端到端验收用例，用来证明系统能够处理：

- 现有算子库不能完整覆盖的语义；
- 需要下载本地模型和额外依赖；
- 需要按 Data-Juicer 规范开发外部算子；
- 一个 Plan 同时组合内置算子与多个新算子；
- 输出不仅有 JSONL，还有 Mask PNG、叠加预览和验收报告；
- 新能力获批后可由后续任务自动复用。

## 2. 已确认的产品决策

### 2.1 本轮范围

- 只完成当前 Windows 主机上的本机闭环。
- Docker Desktop 是正式数据执行 Adapter。
- 不在本轮实现远程 Linux Worker、多人租户、Kubernetes 或对象存储。
- 当前测试输入较小，典型上限约 500 张本地图片。

### 2.2 Agent 与受控模块分工

- DSH Agent 负责需求理解、能力研究、方案选择、算子代码生成、工具编排和用户交互。
- DSH 的 PowerShell、文件、搜索和任务 Tool 可以用于研究、编写和调用流程。
- 模型、源码和依赖进入正式制品前，必须经过结构化 Fetcher、Verifier、Builder、Store 和 Catalog。
- 正式流程不依赖一串无法复现的临时 shell 命令直接修改共享 Python 环境或正式模型目录。

### 2.3 两类审批

1. Capability 审批：只在首次引入或实质变更源码、依赖、模型、许可证或权限时出现。
2. Plan 审批：针对具体任务的输入、算子顺序、参数、资源、输出和验收标准。

已批准 Capability 自动复用，不为每次任务重复审批。没有新能力的任务只需要 Plan 审批。

### 2.4 网络

- Fetcher 位于本机控制面，可以访问批准来源。
- Builder 默认断网，只消费本地快照源码和 wheelhouse。
- 正式 Docker Run 默认 `network=none`。
- VLM API、Secret 生命周期和受限 egress profile 不在本轮范围。

### 2.5 自定义算子生命周期

- Agent 新开发的算子默认作为外部 Operator Artifact，不直接修改共享 DJ 主源码。
- 算子仍严格继承 Data-Juicer 基类并注册到 `OPERATORS`，仍由标准 `recipe.process` 编排。
- 稳定、通用、通过部门评审的算子可以发起 Promotion，进入部门算子库、DJ fork 或上游社区。
- 官方支持通过 `custom_operator_paths` 注册外部算子；本系统在此语义上增加不可变快照、依赖锁定、审批和 Docker Runtime 组合，而不是发明另一套算子协议。

参考：[Data-Juicer 1.5.4 开发者指南](https://datajuicer.github.io/data-juicer/zh_CN/v1.5.4/docs/DeveloperGuide_ZH.html#id2)。

## 3. 当前基线与真正缺口

### 3.1 已完成且应复用

当前代码已经完成并真实验证：

- 不可变 Plan、版本、content hash、审批和运行记录；
- `ExecutionBackend` seam；
- DockerBackend 的只读 rootfs、断网、资源限制、输入/模型只读挂载；
- ModelStore 的清单、hash、原子发布、只读挂载和运行 provenance；
- CapabilityBuilder 的 source/wheelhouse 快照、离线 build、operator import/registry test；
- 无模型 H1 capability 和带模型 H2 capability；
- loopback Execution Broker、capability allowlist、固定 profile、重启恢复、cancel/cleanup；
- OOM、deadline、orphan reconcile、主动篡改和 Local/Docker 成功路径业务等价测试。

这些能力不重写，只补齐通用 Agent 闭环需要的 seam 和接线。

### 3.2 当前缺口

1. 活跃的 8010 Plan Flow MCP 仍通过默认 `PlanRunner` 走本地进程，没有提交给 Docker Broker。
2. 当前 CapabilityDescriptor 近似“一项 capability 对应一个派生镜像和一个 operator”，不能自然组合多个新算子。
3. Broker 创建请求仍使用单个 `capability_id`，而一次 Run 实际需要的是整个 Runtime Manifest。
4. Host 侧 Plan 校验只认识实时 DJ registry 中的内置算子，不能用已批准 Operator Artifact 的 schema 安全校验外部算子。
5. 当前 `inspect_input` 为原始媒体目录生成的 JSONL 使用宿主绝对路径；Docker staging 只复制 dataset 配置文件，不复制其引用的媒体资产。
6. DockerBackend 明确拒绝 recipe 中的 `custom_operator_paths` 和顶层 postprocess；新算子只能靠预先烘焙的单 capability 镜像演示。
7. CapabilityBuilder 状态为 `prepare → approve → publish/build`，审批时还没有完整 build/test 证据，用户体验与两次审批目标不一致。
8. 还没有 Agent 可调用的结构化源码/依赖/模型获取接口，也没有从需求缺口到 capability proposal 的完整 MCP interface。
9. Run 输出契约仍偏向单一 dataset export，不能完整描述 Mask、overlay、目录制品及逐文件 hash。

## 4. 领域模型

领域词汇的精确定义保存在仓库根目录 `CONTEXT.md`。本方案依赖以下关系：

```text
TaskSpec
  └─ 1..N Atomic Requirement

Atomic Requirement
  └─ N:M Capability

Capability
  ├─ 1..N Operator Artifact
  ├─ 0..N Model Artifact
  ├─ dependency contract
  ├─ resource contract
  └─ security contract

Plan
  ├─ standard DJ recipe.process
  ├─ exact operator bindings
  ├─ Dataset Snapshot reference
  ├─ acceptance criteria
  └─ output contract

Plan + Operator Artifacts + dependencies + Model Artifacts
  └─ Runtime Resolver
       └─ Runtime Manifest
            └─ Docker Run
```

重要约束：

- Atomic Requirement 是业务语义，不等于算子名称。
- 一个需求可能由一个算子覆盖，也可能需要多个算子。
- 一个算子也可以同时覆盖多个相关需求。
- Capability 不是 Docker 镜像；Runtime Manifest 才决定实际运行镜像。
- Plan 的业务表达保持为标准 Data-Juicer Pipeline。

## 5. 算子边界原则

### 5.1 换对象测试

设计一个算子前必须询问：

> 把当前业务对象换成同结构的另一种对象，这段算法还能原样工作吗？

如果下面场景使用同一算法：

```text
face mask
person mask
car mask
product mask
foreground mask
```

则 `face` 不应进入算子能力定义。应抽象为例如：

```yaml
masked_region_statistics_mapper:
  image_key: image
  mask_key: mask
  output_key: region_stats
  metrics: [area_ratio, mean_luminance]
```

当前任务通过传入 face mask，自然得到人脸区域面积和亮度。

### 5.2 算子不按验收语句机械拆分

“原子需求”不意味着“每句话建立一个算子”。算子边界应满足：

- 输入输出契约稳定；
- 算法语义内聚；
- 能被其他任务复用；
- 可以独立做 contract test；
- 不把当前任务名称、样本路径、目标数量硬编码进实现；
- 对相同重计算尽量只解码一次。

例如 `area_ratio` 与 `mean_luminance` 都依赖同一 image/mask 解码，把它们作为可配置 metrics 放进一个 `masked_region_statistics_mapper`，通常比两个重复加载媒体的浅算子更合理。

### 5.3 单样本算子与全局算子分开

- Mapper：产生 mask、embedding、区域统计等逐样本字段或文件引用。
- Filter：按单样本条件保留或删除。
- Deduplicator/Grouper：基于 embedding 或业务 ID 形成唯一主体组。
- Selector：按字段、分层和配额从整个数据集选择样本。
- Pipeline：只有真正需要控制数据集级执行或多个内部阶段时才使用。

不把“生成 Mask、算亮度、去重、均衡选 30 个”塞入一个人脸专用巨型 Mapper。

### 5.4 优先顺序

对每个 Atomic Requirement，Agent 必须依次选择：

1. 直接复用 DJ 内置算子；
2. 复用已批准部门 Capability；
3. 用更通用的已有算子组合满足；
4. 开发可复用外部算子；
5. 只有算法确实不可分割时才开发任务特定 Pipeline。

## 6. 目标模块与 seam

### 6.1 DSH Orchestrator

职责：

- 维护 TaskSpec；
- 生成 Atomic Requirement；
- 调用能力解析；
- 研究候选来源并编写外部算子草稿；
- 展示两类审批；
- 在失败后依据结构化错误修订，不从 stderr 猜测提权。

DSH Tool 的定位：

- Web/PowerShell：查资料、下载候选的开发期验证、生成代码、运行受控 CLI；
- 文件 Tool：读取 schema、编写 Operator Artifact 草稿和测试；
- Jobs Tool：跟踪长时间 build/test；
- MCP：把候选内容交给正式供应链，并执行审批后的 Plan。

正式成功路径不得要求用户手工运行 PowerShell。

### 6.2 Capability Resolver

小 interface：

```python
resolve(requirements, modality, resource_policy) -> CapabilityResolution
```

内部行为：

- 批量检索 DJ 内置 operator schema；
- 检索已批准 Capability Catalog；
- 按 contract version、输入字段、输出字段、资源、模型和网络策略验证匹配；
- 返回 `covered`、`partial` 或 `missing`，以及证据和推荐绑定；
- 不因名称相似就声明覆盖。

### 6.3 Artifact Fetcher

Fetcher 只负责把外部内容变成可验证的暂存对象，不负责审批和发布。

支持来源：

- PyPI 官方源；
- GitHub/GitLab 固定 commit；
- Hugging Face/ModelScope 固定 revision；
- workspace 内用户提供的本地文件。

核心 interface：

```python
stage_source(request: SourceRequest) -> StagedSource
stage_dependencies(request: DependencyRequest) -> WheelhouseArtifact
stage_model(request: ModelRequest) -> StagedModel
```

强制行为：

- 下载到 `D:\dsh-worker\model-downloads` 或 capability quarantine；
- 限制来源域名和最大大小；
- 禁止使用浮动 branch/tag 作为最终身份；
- 生成逐文件 inventory 与 aggregate hash；
- 记录许可证证据；
- 默认拒绝不明许可证、额外可执行文件、pickle 权重和未批准 `trust_remote_code`；
- Fetcher 不读取业务输入数据。

### 6.4 Operator Artifact Builder

Operator Artifact 是外部算子的独立制品，不与某次 Runtime 镜像绑定。

建议 manifest：

```yaml
artifact_id: op-masked-region-statistics-v1
source_hash: sha256:...
import_modules:
  - department_ops.masked_region_statistics
operators:
  - name: masked_region_statistics_mapper
    kind: mapper
    schema_hash: sha256:...
    contract_version: 1
dependencies:
  wheelhouse_hash: sha256:...
models: []
tests:
  contract_report_hash: sha256:...
```

验证内容：

- Python compile、lint 和 import；
- `OPERATORS` 注册；
- schema 提取；
- 参数默认值和类型可被 jsonargparse 解析；
- 单样本/batch contract；
- 路径写入只发生在声明的输出目录；
- 不在 import 阶段联网或安装依赖；
- 合成 fixture 的确定性结果；
- 输出字段与 CapabilityRequirement 一致。

### 6.5 Capability Lifecycle

状态改为：

```text
draft
  → staging
  → building
  → validating
  → pending_approval
  → approved
  → publishing
  → available
```

任一自动阶段可进入 `failed`，保留结构化诊断。`pending_approval` 后的内容不可修改；任何字节变化产生新 proposal 和 content hash。

Capability Proposal 可以包含多个新 Operator Artifact，但发布后每个 Artifact 保持独立身份，便于别的任务只复用其中一项。

### 6.6 Runtime Resolver 与 Runtime Assembler

这是多新算子组合的核心 deep module。

```python
resolve(plan) -> RuntimeManifest
```

内部行为：

1. 对 recipe 的每一步绑定内置 operator 或 approved Operator Artifact。
2. 合并 Operator Artifact 的 Python 和系统依赖。
3. 合并 Model Artifact 引用及 hash。
4. 验证 CPU/GPU、内存和网络策略兼容性。
5. 计算 composition key。
6. 命中已有不可变 runtime image，或触发离线 Runtime build。
7. 生成 Runtime Manifest 和镜像不可变 ID。

composition key 至少包含：

```text
base_image_id
Data-Juicer source identity
sorted Operator Artifact hashes
resolved dependency lock hash
bootstrap version
system package lock hash
execution profile family
```

同一组 Artifact 和依赖应复用同一镜像，不按任务重复 build。

若依赖无法合并，返回 `DEPENDENCY_CONFLICT`，列出冲突包、两个来源和候选解决方式。本机首版不自动拆成多容器多阶段 Pipeline。

### 6.7 Dataset Snapshot

```python
create_snapshot(input_descriptor) -> DatasetSnapshot
```

本轮对最多约 500 张图片采用一次真实复制：

```text
workspace 原始数据
  → D:\dsh-worker\runs\<run>\input
  → Docker read-only bind mount 到 /workspace/input
```

不会复制进镜像，也不会在容器内再复制第二份。

创建流程：

1. 解析 dataset 文件及所有媒体引用；
2. 校验真实路径位于当前 workspace，拒绝 symlink/path escape；
3. 复制到受控 run input staging；
4. 处理重名文件并记录源到目标映射；
5. 将 manifest 中的 Windows 绝对路径重写为 `/workspace/input/...`；
6. 生成逐文件 hash、总大小、文件数和 snapshot hash；
7. 容器只读挂载；
8. 成功收集后删除 staging，失败按有限 TTL 保留。

不默认使用 hardlink，因为源文件在外部被修改时会同时改变所谓“快照”。

### 6.8 Plan Validator

Plan 的 `recipe.process` 保持 Data-Juicer 标准格式。新增顶层绑定事实：

```yaml
operator_bindings:
  - step: 0
    operator: image_face_mask_mapper
    provider: capability
    artifact_id: op-face-mask-v1
    schema_hash: sha256:...
  - step: 1
    operator: masked_region_statistics_mapper
    provider: capability
    artifact_id: op-masked-region-statistics-v1
    schema_hash: sha256:...
  - step: 2
    operator: frequency_specified_field_selector
    provider: builtin
    data_juicer_identity: ...
```

Validator 不通过执行任意外部 Python 来获得 schema，而是读取已批准 Operator Artifact 的不可变 schema snapshot。

必须验证：

- recipe 每一步都有唯一绑定；
- 参数属于绑定 schema；
- 上一步输出字段满足下一步输入字段；
- Model Artifact 与 Capability/Runtime contract 一致；
- 输出路径只能指向 `${RUN_OUTPUT}`；
- Plan 使用的 capability 状态为 `available`；
- acceptance criteria 能映射到可观测字段或制品。

### 6.9 Execution Broker

Broker 仍保持窄 interface，但创建请求从单一 capability 改为 resolved runtime：

```json
{
  "task_id": "task_x",
  "plan_version": "plan_v003",
  "runtime_id": "runtime_<hash>",
  "profile": "local-cpu"
}
```

调用方不能提交 image ID、宿主 mount、Docker argv、network 参数或 secret。Broker 从 PlanStore、Runtime Catalog、ModelStore 和 Dataset Snapshot 推导运行事实。

Plan Flow MCP 的 `run_plan` 应在内部：

1. 验证 Plan approval；
2. 调用 Runtime Resolver；
3. 创建 Dataset Snapshot；
4. 向 Broker 提交 resolved runtime；
5. 保存 broker public run ID；
6. 将状态、cancel、cleanup 投影回现有 MCP interface。

不要求 DSH Agent 直接调用 Docker 或自行选择 capability image。

### 6.10 Output Artifact Collector

Result Manifest 扩展为递归文件清单：

```yaml
dataset:
  path: processed_data.jsonl
  sha256: ...
artifacts:
  - kind: mask
    path: masks/0001.png
    media_type: image/png
    sha256: ...
  - kind: overlay
    path: overlays/0001.png
    media_type: image/png
    sha256: ...
reports:
  - path: report.md
    sha256: ...
summary:
  files: 91
  bytes: ...
```

Collector 只收集 `/workspace/output`，拒绝 symlink、越界路径、未声明的大文件和超过 profile 限额的输出。

## 7. MCP interface

面向 Agent 的新 public interface 应尽量小，复杂实现隐藏在模块内部。

### 7.1 能力解析

```python
resolve_capabilities(
    requirements: list[dict],
    modality: str,
    resource_profile: str = "local-cpu",
) -> CapabilityResolution
```

返回内置覆盖、Catalog 覆盖、缺口、候选 bindings 和必要证据。

### 7.2 准备 Capability Proposal

```python
prepare_capability(
    workspace_root,
    task_id,
    requirements,
    operator_drafts,
    source_requests,
    dependency_requests,
    model_requests,
) -> CapabilityProposalStatus
```

约束：

- `operator_drafts` 只能引用 workspace 内文件；
- SourceRequest 是结构化 URL/revision，不接受 shell command；
- 不接受 Dockerfile、Docker args 或任意宿主目标路径；
- 工具可以异步返回 proposal ID，由 `get_capability` 查询状态。

### 7.3 查询与审批

```python
get_capability(proposal_id) -> CapabilityProposalStatus

approve_capability(
    proposal_id,
    content_hash,
    note,
) -> Approval
```

审批后自动发布；发布成功返回可绑定的 capability/operator/model IDs。失败不静默退回共享 venv。

### 7.4 现有 Plan interface

保留：

- `prepare_plan`
- `get_plan`
- `preview_plan`
- `approve_plan`
- `run_plan`
- `get_run`
- `cancel_run`

修改：

- `prepare_plan` 接受/生成 `operator_bindings`；
- `preview_plan` 展示 Runtime 组成、模型、数据快照策略和输出契约；
- `run_plan` 只走 Broker，不再隐式创建 LocalProcessBackend；
- LocalProcessBackend 仅供显式测试，不是 MCP 正式路径。

## 8. 审批体验

### 8.1 Capability 审批只在必要时出现

下列情况无需 Capability 审批：

- 全部使用内置算子；
- 复用当前 scope 已批准的 Capability；
- 相同 Artifact 和 Runtime composition cache hit；
- 参数变化但没有改变源码、模型、依赖或权限。

需要审批：

- 新源码/commit；
- 新依赖或版本变化；
- 新模型或模型 revision 变化；
- 许可证或来源变化；
- 新资源/网络/Secret 权限；
- 已批准 Artifact 的任何字节变化。

### 8.2 一次展示完整证据

Capability 审批页面/问题应聚合展示：

- 缺失能力与为什么现有算子不满足；
- 新算子名称、通用边界、输入输出；
- 来源、revision、许可证和 hash；
- 模型大小、格式和 inventory；
- 依赖锁；
- security/resource contract；
- contract test、合成 fixture 和静态检查结果；
- 计划使用的少量用户样本 Preview 范围。

用户批准后，系统可以用已批准 capability 对限定样本做 Preview；Preview 不通过时 Agent 修改候选并形成新 proposal。不会在同一 content hash 下偷偷修代码。

### 8.3 Plan 审批

Plan 审批展示：

- 输入 Snapshot 摘要；
- 标准 DJ recipe；
- 每步内置/外部 operator binding；
- Runtime composition 和 cache 状态；
- 模型清单；
- Preview 结果；
- 输出目录和制品类型；
- 资源 profile、timeout 和风险；
- acceptance criteria 映射。

## 9. 人脸 Mask 验收用例的合理算子分解

以下只是候选映射，实施时仍须先通过 Capability Resolver 检索现有 DJ 算子和部门目录。

### 9.1 可能的 Pipeline

```yaml
process:
  - image_face_mask_mapper:
      image_key: images
      mask_key: face_masks
      model_path: model-store://face-parser-v1

  - masked_region_statistics_mapper:
      image_key: images
      mask_key: face_masks
      output_key: face_region_stats
      metrics: [area_ratio, mean_luminance]

  - face_embedding_mapper:
      image_key: images
      region_key: face_masks
      output_key: face_embedding
      model_path: model-store://face-embedding-v1

  - embedding_cluster_deduplicator:
      embedding_key: face_embedding
      group_key: subject_cluster
      threshold: <validated-value>

  - stratified_selector:
      strata:
        - face_region_stats.size_bucket
        - face_region_stats.brightness_bucket
      unique_by: subject_cluster
      quotas:
        small.dark: 5
        small.normal: 5
        medium.dark: 5
        medium.normal: 5
        large.dark: 5
        large.normal: 5
```

### 9.2 哪些应通用，哪些可保留 face 语义

| 能力 | 建议边界 | 原因 |
|---|---|---|
| 生成人脸区域 mask | `image_face_mask_mapper` 可 face-specific | 模型和标签语义确实针对人脸 |
| 区域面积、亮度 | `masked_region_statistics_mapper` | 换成任意 mask 仍能原样工作 |
| 生成人脸 embedding | `face_embedding_mapper` 可 face-specific | 特征模型和相似度语义针对人脸 |
| 根据 embedding 分组/去重 | `embedding_cluster_deduplicator` | 聚类算法不需要知道 embedding 来自人脸 |
| 多维配额抽样 | `stratified_selector` | 对任何结构化字段和业务类别都可复用 |
| Mask/overlay 导出 | 通用 artifact writer 或 Mapper 输出契约 | 文件生成不应绑定人脸任务 |

如果输入已经提供可靠 `subject_id`，应跳过 face embedding 和聚类，直接由 selector 使用该字段；不能为满足“看起来智能”而强制运行模型。

### 9.3 验收输出

```text
output/
├─ processed_data.jsonl
├─ images/                 # 选中的30张图片或稳定引用
├─ masks/                  # 30张二值PNG
├─ overlays/               # 30张可视质检图
├─ metadata.csv
├─ result-manifest.json
└─ report.md
```

报告必须说明：

- 最终数量和六个配额；
- 大小/亮度阈值及来源；
- 不同人物依据是 subject ID 还是 embedding 近似聚类；
- 无法满足配额时的缺口，不允许重复样本硬凑；
- mask_definition；
- 模型、算子、Runtime 和输入 Snapshot hash。

## 10. 实施阶段

### P0：冻结当前回归基线

目标：避免在接线过程中破坏已经完成的 A–I 和故障矩阵。

工作：

- 保存两个仓库当前 diff 和测试基线；
- 固定基础镜像 ID、已发布 H1/H2 descriptor 和 ModelArtifact hash；
- 保留现有真实 Docker opt-in 测试；
- 新增一条测试，证明正式 MCP 当前仍走 LocalProcessBackend，随后在 P6 改为期望失败/删除。

完成标准：已有单元、集成、真实 Docker 测试结果可重现。

### P1：领域对象与 schema 解耦

目标：把 Operator Artifact、Capability 和 Runtime 从当前单镜像描述中拆开。

工作：

- 新增版本化 schema；
- CapabilityDescriptor 改为引用 Operator/Model Artifact 和权限 contract，不直接等同 image；
- 新增 RuntimeManifest/RuntimeCatalog；
- 为旧 H1/H2 descriptor 提供只读迁移或兼容加载；
- Broker request 从 `capability_id` 迁移到 `runtime_id`。

完成标准：一个 RuntimeManifest 能声明两个外部 Operator Artifact；旧 descriptor 不被静默误读。

### P2：外部 Artifact Fetcher 与 quarantine

目标：让 Agent 能通过结构化 interface 获取模型、源码和 Linux wheels。

工作：

- 实现允许来源与 revision 校验；
- 实现下载大小、超时、断点/失败清理；
- 生成 inventory、hash、license evidence；
- 建立 quarantine 到正式 Store 的原子发布；
- 明确拒绝 pickle、未知许可证和未批准 remote code 的默认策略。

完成标准：Agent 不需要用户手工下载，失败下载不会污染正式模型或 wheelhouse。

### P3：Operator Artifact 与 Capability 生命周期

目标：从 Agent 生成的 workspace 草稿形成可审批、可独立复用的 Operator Artifact。

工作：

- 实现 draft snapshot；
- 自动 scaffold/schema/registry/contract test；
- Builder 状态改为先 build/validate、后 approve/publish；
- Capability Proposal 支持多个 Operator Artifact；
- 发布后写入 Catalog；
- 加入 Promotion metadata，但本轮不实现部门评审系统。

完成标准：未批准代码只能在无业务数据沙箱运行；批准后 Artifact 字节不可变。

### P4：Runtime Resolver 与多算子组合镜像

目标：一个标准 DJ Plan 可同时使用内置算子与多个新算子。

工作：

- 实现 exact operator binding；
- 合并依赖与 ModelArtifact；
- 检测依赖冲突；
- 生成 composition key；
- 离线构建组合镜像；
- 通过 bootstrap 注册所有外部 operator modules；
- 缓存和复用相同 Runtime；
- 生成 Runtime provenance。

完成标准：同一 Run 至少成功使用两个独立外部 Operator Artifact；第二个任务 cache hit，不重新 build。

### P5：Dataset Snapshot 与通用输出制品

目标：容器能安全读取 raw media，并输出 Mask 等目录制品。

工作：

- 递归解析媒体引用；
- 复制和路径重写；
- Snapshot hash；
- 扩展 container result manifest；
- 递归输出收集、hash、大小上限和 symlink 拒绝；
- 定义成功/失败 staging 清理策略。

完成标准：500 张以内图片只复制一次；容器 recipe 不含 Windows 绝对路径；Mask 文件可验证收集。

### P6：MCP → Runtime Resolver → Broker 接线

目标：正式 DSH 流程不再落回本地共享 venv 执行。

工作：

- 在 server/service 暴露能力解析、准备、查询和审批工具；
- `prepare_plan` 支持外部 schema binding；
- `run_plan` 解析 Runtime、创建 Snapshot 并提交 Broker；
- 映射 broker public run ID；
- 保持 get/cancel/cleanup interface；
- LocalProcessBackend 只保留显式测试入口；
- DSH Skill 更新工具顺序、停止规则和两类审批规则。

完成标准：从 DSH 新会话提出未知能力任务，Agent 无需人工命令即可走到 Docker Run。

### P7：人脸 Mask Agent 端到端验收

目标：验证通用闭环，而不是只验证底层类。

工作：

- 准备有授权的小型测试集和期望分布；
- 让 Agent 自主检索现有算子；
- 只开发实际缺失且边界可复用的算子；
- 完成 Capability 审批；
- 运行小样本 Preview；
- 生成并审批标准 DJ Plan；
- Docker 正式运行并验证制品；
- 第二个新任务复用已批准 Artifact/Runtime。

完成标准见第 12 节。

### P8：失败矩阵与文档收口

目标：证明闭环在失败时仍安全、可解释。

覆盖：

- 来源不可达、hash 不符、许可证拒绝；
- wheel 平台不匹配；
- import/registry/schema/contract test 失败；
- 依赖冲突；
- 模型被篡改；
- approval hash 变化；
- 输入路径越界和 manifest 引用丢失；
- Runtime cache 损坏；
- Docker OOM/timeout/cancel/orphan；
- 输出 symlink、越界或超限；
- Agent 在没有新证据时重复 build/search 的停止规则。

## 11. 具体文件改造建议

### 11.1 Data-Juicer Plan Flow

建议逐步从现有单文件实现演进，避免一次性大搬迁：

```text
D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\
├─ capability\
│  ├─ schema.py
│  ├─ resolver.py
│  ├─ catalog.py
│  ├─ lifecycle.py
│  └─ operator_artifact.py
├─ artifacts\
│  ├─ fetcher.py
│  ├─ inventory.py
│  ├─ license_policy.py
│  ├─ model_store.py
│  └─ source_store.py
├─ runtime\
│  ├─ manifest.py
│  ├─ resolver.py
│  ├─ assembler.py
│  └─ catalog.py
├─ dataset_snapshot.py
├─ result_manifest.py
├─ execution\
│  ├─ backend.py
│  ├─ spec.py
│  ├─ local_process.py
│  └─ docker.py
├─ broker.py
├─ validation.py
├─ service.py
└─ server.py
```

迁移原则：

- 先让现有 `capability.py` 和 `model_store.py` 作为 Adapter 满足新 interface；
- 新测试通过后再决定是否物理移动文件；
- 不为了目录整齐同时做大规模无行为重构；
- 旧 descriptor 必须显式 version migration，不能就地改写历史制品。

### 11.2 DSH

```text
D:\dsh-app\.dsh\skills\data-juicer-requirements-zh\
D:\dsh-app\.dsh\skills\data-juicer-plan-flow-zh\
D:\dsh-app\dj-dsh.patch.yml
```

修改：

- Requirement Skill 输出 Atomic Requirement，但不预先指定算子；
- Plan Skill 增加 capability missing 分支；
- 明确算子边界的换对象测试；
- 一次 capability search、一次 catalog resolve；
- capability build/validate 期间使用异步 job/poll；
- 两类审批调用精确 hash；
- Plan 批准后只调用 Broker-backed `run_plan`；
- 控制工具结果大小和模型步骤预算。

### 11.3 Worker 运行目录

```text
D:\dsh-worker\
├─ model-downloads\
├─ models\
├─ capability-quarantine\
├─ operator-artifacts\
├─ runtime-catalog\
├─ build-contexts\
├─ build-cache\
├─ runs\
└─ broker-state\
```

每个目录必须有明确唯一写入模块；Agent/Run 不能直接修改正式 Store。

## 12. 测试与 Definition of Done

### 12.1 保留回归

- H1 无模型 capability；
- H2 model-backed capability；
- ModelStore tamper/reverify；
- Docker isolation；
- Broker lifecycle/reconcile；
- Local/Docker 内置算子业务等价。

这些作为回归，不重新当作本轮新成果。

### 12.2 新增 interface 测试

- 一个 Atomic Requirement 由内置算子覆盖；
- 一个 Atomic Requirement 由已批准 Capability 覆盖；
- 一个 Requirement 映射多个 Operator；
- 一个 Operator 覆盖多个相关 Requirement；
- 外部 schema 可以校验 Plan，但不执行 artifact 源码；
- 两个外部 Artifact 组合成一个 Runtime；
- 相同组合稳定 cache hit；
- 依赖冲突得到确定性错误；
- Broker 不接受任意 image/mount/network 参数。

### 12.3 Agent 会话测试

至少验证三个用户请求：

1. 纯内置算子任务：不出现 Capability 审批。
2. 已批准能力复用：不下载、不 build，只出现 Plan 审批。
3. 人脸 Mask 新能力：出现一次聚合 Capability 审批和一次 Plan 审批。

检查 Agent：

- 不把 requirement 名称直接当 operator 名称；
- 不因候选名称相似就宣称满足；
- 不循环换关键词搜索；
- 不用共享 venv 临时安装作为正式结果；
- 不为满足非空 process 塞装饰性算子；
- 不在没有新证据时重新设计；
- 失败时读取结构化 error code 再行动。

### 12.4 人脸 Mask 用例 DoD

- 从不超过 500 张本地图片创建可验证 Dataset Snapshot；
- 容器内不存在宿主 Windows 路径；
- 至少组合两个独立外部 Operator Artifact；
- recipe 同时包含适用的 DJ 内置算子和新算子；
- 模型通过 ModelStore 只读挂载，镜像不包含模型权重；
- Runtime 和正式 Run 均断网；
- 输出 30 张有效二值 Mask 或明确报告输入不足；
- 输出 overlay、metadata、result manifest 和验收报告；
- 六个 size/brightness 组合配额可审计；
- 不同人物约束的方法和局限明确；
- 第二次相同能力请求不重新下载、审批或 build；
- Plan、Artifact、Model、Runtime、Snapshot 和输出均有 hash provenance；
- cleanup 后无 managed container，输入 staging 按策略释放，正式输出保留。

### 12.5 性能与交互 DoD

- 能力检索每个 TaskSpec 版本最多一次正常检索；
- 已知候选按精确 ID/schema 加载，不循环搜索；
- build/test 使用异步状态，不让一次 MCP 调用无限阻塞；
- Capability 审批内容能在一个界面/问题中读完；
- 已批准能力的普通任务不因供应链模块增加额外交互；
- Agent 整个正式回合保持既定模型步骤和输出 token 红线。

## 13. 结构化错误码

新增或明确：

```text
CAPABILITY_MISSING
CAPABILITY_PARTIAL
SOURCE_NOT_ALLOWED
SOURCE_REVISION_REQUIRED
DOWNLOAD_FAILED
DOWNLOAD_SIZE_EXCEEDED
LICENSE_REVIEW_REQUIRED
MODEL_FORMAT_NOT_ALLOWED
REMOTE_CODE_NOT_ALLOWED
ARTIFACT_INVENTORY_MISMATCH
OPERATOR_IMPORT_FAILED
OPERATOR_NOT_REGISTERED
OPERATOR_SCHEMA_INVALID
CONTRACT_TEST_FAILED
CAPABILITY_APPROVAL_REQUIRED
CAPABILITY_CONTENT_CHANGED
DEPENDENCY_CONFLICT
RUNTIME_BUILD_FAILED
RUNTIME_NOT_APPROVED
RUNTIME_CACHE_CORRUPT
DATASET_REFERENCE_NOT_FOUND
DATASET_SNAPSHOT_FAILED
OPERATOR_BINDING_MISSING
OPERATOR_SCHEMA_MISMATCH
OUTPUT_ARTIFACT_INVALID
OUTPUT_LIMIT_EXCEEDED
```

每个错误至少包含：

- `code`；
- 稳定、简短的 `message`；
- 机器可读 `details`；
- `retryable`；
- 责任归属：Agent 可修订、用户需决定、环境需修复或永久拒绝。

## 14. 风险与控制

| 风险 | 控制 |
|---|---|
| Agent 下载恶意包/模型 | 来源 allowlist、固定 revision、quarantine、hash、许可证和格式策略 |
| 构建代码读取业务数据 | Builder 不挂载 workspace/input，不注入业务 Secret |
| 多算子依赖冲突 | Runtime Resolver 在 build 前确定性解析并返回冲突证据 |
| 组合镜像爆炸 | 按 composition key 缓存、复用高频 Runtime、后续 Promotion |
| 外部算子无法被 host 校验 | 发布不可变 schema snapshot，Validator 不导入外部代码 |
| 输入复制占空间 | 本轮小规模直接复制；记录大小并在 cleanup 后释放 |
| 两次审批太繁琐 | 首次能力才审批、证据聚合、已批准能力自动复用 |
| 任务专用算子泛滥 | 换对象测试、Catalog 去重、Promotion 和弃用策略 |
| Agent 绕开正式模块使用 shell | Skill 明确正式成功路径，MCP/Broker 只接受已发布 Artifact |

## 15. 本轮不做

- VLM/API 在线推理；
- SecretRef 和受限 egress gateway；
- 远程 Linux Worker；
- 多租户认证、配额和 workspace_id；
- Kubernetes；
- 对象存储；
- 多 Runtime 的跨容器阶段编排；
- TB 级数据零复制；
- 自动向部门算子库或开源社区提交代码；
- 未经人工同意接受门控模型条款。

## 16. 推荐实施顺序

严格按以下顺序推进：

```text
P0 回归基线
 → P1 领域对象/schema 解耦
 → P2 Fetcher/quarantine
 → P3 Operator Artifact/Capability 生命周期
 → P4 多算子 Runtime 组合
 → P5 Dataset Snapshot/输出制品
 → P6 MCP/Broker 接线与 DSH Skill
 → P7 人脸 Mask Agent E2E
 → P8 失败矩阵和文档收口
```

不要先写人脸专用巨型算子再反推架构；也不要在 MCP/Broker 尚未接通时用 DSH PowerShell 的一次性成功冒充闭环完成。
