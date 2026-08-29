# DSH + Data-Juicer：Agent 自动发现与部署缺失能力的隔离运行落地方案

更新时间：2026-08-29

## 1. 目标与结论

目标不是让 Agent 获得在共享宿主机上执行 `pip install`、`git clone` 和模型下载的权限，而是建立以下受控闭环：

```text
用户需求
  ↓
Agent 提取原子能力
  ↓
DJ 内置算子/内部能力目录搜索
  ├─ 已存在：生成可运行 Plan
  └─ 缺失：搜索候选代码、算子、模型和依赖
              ↓
       生成 CapabilityProposal
              ↓
       许可/来源/权限审批
              ↓
       隔离构建候选 Runtime
              ↓
       Contract Test + 小样本 Preview
              ↓
       发布不可变 Runtime 与 Model Artifact
              ↓
       隔离执行正式任务
```

结论：

1. **必须先有隔离，才能安全开放自动发现与部署。** 否则 Agent 找到的任意 Python 包、Git 仓库或模型加载代码都可能修改共享环境、读取业务数据或影响其他用户。
2. **先 Docker，后 Kubernetes。** Docker 阶段建立正确的制品、挂载、资源、权限和生命周期接口；Kubernetes 阶段复用这些接口和 OCI 镜像，只替换执行 Adapter 与存储/调度实现。
3. **Agent 不直接成为系统管理员。** Agent负责提出和验证候选方案；构建模块、模型模块和执行模块执行经过策略校验的结构化规格。
4. **模型、算子、依赖是三个独立制品。** 模型权重不默认烘焙进镜像，算子源码不能作为未固定版本的网络代码运行，依赖必须锁定并固化为镜像 digest。
5. **新能力首次引入必须审批。** 已审批并进入内部目录的能力以后可以自动复用。

## 2. 当前基线

当前环境：

- DSH Web：`D:\dsh-app`；
- Data-Juicer 源码与 plan-flow：`D:\dj\data-juicer-1.5.4`；
- 共享 Python 环境：`D:\dj\.envs\dsh-dj`；
- 当前 plan-flow worker 在 `data_juicer/tools/plan_flow/runner.py` 中通过 `subprocess.Popen()` 启动；
- Plan、版本、run、日志和输出已按 workspace 持久化；
- Data-Juicer 支持 `custom_operator_paths` 动态加载自定义算子；
- Data-Juicer 算子可以声明 `_requirements`，Ray 模式存在 operator runtime environment manager；
- 当前主机约 32 GiB 内存、8 个逻辑 CPU、CPU 版 PyTorch、无可用 CUDA；
- 当前没有可用 Docker CLI，WSL2 Linux 环境未就绪。

已有能力可继续保留：Plan 校验、不可变版本、审批、preview、run 状态和报告。需要新增的是能力供应链和隔离执行层，而不是重写 DJ 的核心 Executor。

### 2.1 当前必须修复的安全假设

1. MCP 调用方传入的 `workspace_root` 目前只是路径参数，不是租户授权。多人部署后应由认证身份和 `workspace_id` 在服务端解析真实路径。
2. MCP 进程拥有的环境变量会被当前 worker 继承。正式运行应改成按任务引用 `secret_ref`，只注入任务需要的短期凭据。
3. 当前 PID 是运行身份；容器阶段应改为 container ID，Kubernetes 阶段改为 Job UID/Pod UID。
4. 当前自定义 postprocess artifact 会被快照，但自定义算子及其完整依赖还没有形成独立、不可变、可验证的 runtime artifact。

## 3. 统一领域模型

Docker 和 Kubernetes 必须共享同一套上层模型，避免迁移时重写 Plan-flow。

### 3.1 CapabilityRequirement

Agent 从用户需求中提取“需要什么”，不直接选择包名：

```yaml
capability: prompted_image_segmentation
contract_version: 1
input:
  media: image
  fields: [image_path, boxes]
output:
  fields: [masks, scores]
quality:
  preview_required: true
resources:
  accelerator: optional-gpu
constraints:
  local_data_only: true
  allowed_licenses: [organization-approved]
```

### 3.2 CapabilityDescriptor

内部能力目录中已经批准的实现：

```yaml
capability_id: cap_prompted_segmentation_sam3_v1
implements: prompted_image_segmentation@1
operator:
  name: prompted_segmentation_mapper
  artifact_sha256: ...
runtime:
  image_digest: registry.internal/dj/runtime@sha256:...
models:
  - artifact_id: model_sam3_rev_x
default_resources:
  profile: gpu-medium
security:
  run_network: none
approval:
  status: approved
  scope: department-x
```

### 3.3 ModelArtifact

```yaml
artifact_id: model_vendor_name_revision
source: https://official-source/...
revision: immutable-revision
sha256: ...
size_bytes: ...
format: safetensors-or-onnx-or-checkpoint
license:
  identifier: ...
  reviewed_by: ...
  reviewed_at: ...
  allowed_scope: ...
storage_uri: model-store://vendor/name/revision
```

### 3.4 RuntimeManifest

```yaml
runtime_id: runtime_face_mask_v1
base_image_digest: ...
source_commits:
  data_juicer: ...
  custom_ops: ...
python_lock_sha256: ...
system_packages_lock_sha256: ...
image_digest: ...
supported_contracts:
  - face_detection@1
  - face_embedding@1
  - prompted_image_segmentation@1
sbom_uri: ...
build_provenance_uri: ...
```

### 3.5 RuntimeSpec

这是 Runtime Resolver 向执行模块提供的唯一启动规格：

```python
@dataclass(frozen=True)
class RuntimeSpec:
    run_id: str
    tenant_id: str
    image_digest: str
    command: tuple[str, ...]
    mounts: tuple[MountSpec, ...]
    model_mounts: tuple[ModelMount, ...]
    secret_refs: tuple[str, ...]
    cpu: float
    memory_gib: float
    ephemeral_storage_gib: float
    timeout_seconds: int
    pids_limit: int
    network_policy: str
    gpu_count: int = 0
```

RuntimeSpec 中不出现任意 Docker 参数、shell 字符串或 Kubernetes YAML，防止上层绕过策略。

## 4. 模块与 seam

建议在 `data_juicer/tools/plan_flow` 增加：

```text
plan_flow/
├─ capability/
│  ├─ requirements.py       # 原子能力规格
│  ├─ catalog.py            # 已审批能力查询
│  ├─ resolver.py           # 能力 → runtime/model
│  └─ proposal.py           # 缺失能力候选提案
├─ runtime/
│  ├─ manifest.py
│  ├─ resolver.py
│  ├─ builder.py
│  └─ policy.py
├─ models/
│  ├─ manifest.py
│  ├─ store.py
│  ├─ fetcher.py
│  └─ verifier.py
├─ execution/
│  ├─ spec.py
│  ├─ backend.py
│  ├─ local_process.py
│  ├─ docker.py
│  └─ kubernetes.py
├─ scheduling/
│  ├─ queue.py
│  ├─ quota.py
│  └─ reconciler.py
└─ runner.py
```

### 4.1 ExecutionBackend

```python
class ExecutionBackend(Protocol):
    def start(self, spec: RuntimeSpec) -> RunHandle: ...
    def inspect(self, handle: RunHandle) -> RunStatus: ...
    def cancel(self, handle: RunHandle) -> None: ...
    def collect(self, handle: RunHandle) -> RunResult: ...
    def cleanup(self, handle: RunHandle) -> None: ...
```

三个 Adapter：

- `LocalProcessBackend`：兼容当前行为，仅开发；
- `DockerBackend`：单机正式执行；
- `KubernetesJobBackend`：集群正式执行。

### 4.2 RuntimeBuilder

```python
class RuntimeBuilder(Protocol):
    def build(self, request: BuildRequest) -> BuildHandle: ...
    def inspect(self, handle: BuildHandle) -> BuildStatus: ...
    def publish(self, handle: BuildHandle) -> RuntimeManifest: ...
```

Builder 与 Runner 是不同模块：Builder 可以访问受控网络，但不能访问用户数据；Runner 可以访问任务数据，但默认不能访问互联网或安装依赖。

### 4.3 ModelStore

```python
class ModelStore(Protocol):
    def resolve(self, model_ref: ModelRef) -> ModelArtifact: ...
    def stage(self, artifact: ModelArtifact) -> StagedModel: ...
    def verify(self, artifact: ModelArtifact) -> VerificationResult: ...
    def evict(self, artifact_id: str) -> None: ...
```

## 5. Agent 发现缺失能力的完整流程

### 5.1 发现

1. Agent 将需求转成 `CapabilityRequirement[]`。
2. 先查询 DJ 内置 operator schema。
3. 再查询内部 capability catalog。
4. 有匹配能力时只允许选择 `approved` 状态和当前租户可用的 descriptor。
5. 无匹配能力时返回 `CAPABILITY_MISSING`，进入 proposal 流程，不能静默改用名称相似的模型。

### 5.2 候选研究

Agent 可以访问官方仓库、官方文档、论文和模型卡，输出：

- 候选实现和为什么满足 contract；
- 源码 URL 与 commit；
- 模型 ID 与 revision；
- Python、CUDA、系统依赖；
- CPU/GPU/内存初步需求；
- 许可证、门控下载、数据发送和网络要求；
- 替代方案；
- 需要新增的自定义 DJ 算子代码。

输出是 `CapabilityProposal`，不是直接部署命令。

### 5.3 审批矩阵

| 变化 | 是否需要审批 |
|---|---|
| 复用已批准 runtime/model，资源不超默认 | 自动 |
| 首次引入新 PyPI 包或 Git commit | 需要 |
| 首次引入新模型权重 | 需要 |
| 接受门控模型条款或特殊许可证 | 必须人工 |
| 构建时访问新的域名 | 需要 |
| 运行时开启外网 | 必须人工 |
| 请求 GPU/大内存但在租户配额内 | 可按策略自动 |
| 超出租户配额 | 必须人工 |
| 读取其他 workspace | 永远拒绝 |

### 5.4 构建与验证

1. Builder 创建无业务数据、无业务密钥的构建沙箱。
2. 只允许访问 allowlist 包源和批准的源码/model 域名。
3. 解析并锁定 Python 和系统依赖。
4. 复制自定义算子 artifact，固定 hash。
5. 构建 OCI 镜像。
6. 生成 SBOM、依赖清单、源码 provenance 和镜像 digest。
7. 运行 import test、operator schema test、输入输出 contract test。
8. 在独立 preview run 中挂载少量任务样本。
9. 质量报告通过审批后发布到内部目录。

构建失败只销毁候选构建环境，不影响现有 MCP、runtime 和其他任务。

## 6. Docker 阶段

### 6.1 部署拓扑

#### 开发阶段

```text
Windows 当前主机
├─ DSH Web
├─ DJ MCP
├─ Docker Desktop
└─ WSL2 Linux backend
```

仅用于功能验证、小样本和 CPU 测试。SAM 等 CUDA runtime 的正式基准不在当前 CPU-only 主机完成。

#### 部门首版

```text
控制面主机
├─ DSH Web
├─ DJ MCP
├─ capability catalog
└─ execution broker client
          │ mTLS/内网
          ▼
Linux Docker Worker
├─ execution broker daemon
├─ Docker Engine
├─ image cache
├─ model store/cache
├─ task scratch
└─ optional NVIDIA runtime
```

不要让 MCP 或 Agent 直接持有 Docker socket。Docker socket 等价于很高的宿主控制权限。由 execution broker 提供窄接口：

```text
POST /runs
GET  /runs/{id}
POST /runs/{id}/cancel
POST /runs/{id}/cleanup
```

broker 只接受 RuntimeSpec，验证 image allowlist、挂载根目录、资源配额和网络策略后再调用 Docker Engine。

### 6.2 Linux Worker 目录

```text
/srv/dj-platform/
├─ models/
│  └─ <provider>/<model>/<revision>/
├─ runs/
│  └─ <tenant>/<run-id>/
│     ├─ bundle/       # Plan、recipe、自定义 artifact，只读
│     ├─ input/        # 输入 staging，只读
│     ├─ output/       # 唯一持久可写业务目录
│     ├─ logs/         # broker 收集日志
│     └─ state.json
├─ build-cache/
├─ model-downloads/
└─ broker-state/
```

所有宿主路径由 broker 根据 tenant/run 生成，RuntimeSpec 不能提交任意宿主绝对路径。

### 6.3 容器挂载

| 容器路径 | 来源 | 模式 | 理由 |
|---|---|---|---|
| `/workspace/input` | 本 run 输入 staging | 只读 | 算子不能修改原始输入，也不能沿路径访问其他 workspace |
| `/run/bundle` | 不可变 Plan bundle | 只读 | 防止已审批 Plan、recipe、自定义代码在运行时被篡改 |
| `/models/<id>` | 模型缓存中的固定 revision | 只读 | 防止任务污染共享权重，保证多个 run 复用同一 hash |
| `/workspace/output` | 本 run 输出 | 读写 | 唯一业务持久写入点，便于归属、配额和回收 |
| `/run/work` | 容器临时盘或 run scratch | 读写 | DJ 中间状态，完成后按策略删除 |
| `/tmp` | tmpfs | 读写、限额 | 避免临时文件写满宿主盘，随容器结束消失 |
| `/run/secrets` | 临时 secret mount | 只读 | 不进入镜像、Plan、日志和普通环境文件 |

#### 为什么模型缓存只读挂载

1. **防止缓存投毒。** 一个恶意或错误任务不能覆盖共享 checkpoint，影响后续所有任务。
2. **可重现。** `model_id + revision + sha256` 对应的字节在运行期间不会变化。
3. **并发安全。** 多个容器可以同时读取，不发生任务间写竞争。
4. **生命周期独立。** 删除任务容器不会删除几个 GB 到几十 GB 的模型；缓存由 LRU/TTL/配额单独管理。
5. **许可与审计。** 只有 ModelStore 能写入模型库，写入前检查来源、hash、许可和审批。
6. **最小权限。** 模型加载代码只需要读权限，不应获得写权限。

模型下载不能直接写正式目录。正确流程：

```text
下载到 /srv/dj-platform/model-downloads/<request-id>
  ↓
校验 revision/hash/文件清单/许可
  ↓
原子 rename 到 models/<provider>/<model>/<revision>
  ↓
设置只读权限
```

### 6.4 镜像分层

```text
dj-runtime-base
├─ Linux + Python
├─ Data-Juicer 固定 commit
└─ 通用运行入口

dj-runtime-cpu
├─ FROM base
└─ CPU 通用依赖

dj-runtime-cuda
├─ FROM base
├─ 固定 CUDA/PyTorch 兼容栈
└─ GPU 通用依赖

dj-runtime-capability-<hash>
├─ FROM cpu 或 cuda
├─ 自定义算子 artifact
└─ 锁定的额外依赖
```

正式 Plan 使用 image digest：

```text
registry.internal/dj/runtime@sha256:abc...
```

不使用可漂移的 `latest`。

模型默认不进入镜像，除非模型极小、许可允许分发、与 runtime 强耦合且有明确收益。大模型与镜像分离可以降低镜像构建、推送和升级成本。

### 6.5 Docker 运行示例

下面是 broker 最终生成的等价命令；Agent 不能直接提交这些自由参数：

```bash
docker create \
  --name dj-run-<run-id> \
  --label dj.run-id=<run-id> \
  --label dj.tenant-id=<tenant-id> \
  --user 10001:10001 \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 512 \
  --cpus 4 \
  --memory 16g \
  --memory-swap 16g \
  --network none \
  --tmpfs /tmp:rw,noexec,nosuid,size=2g \
  --mount type=bind,src=<run>/input,dst=/workspace/input,readonly \
  --mount type=bind,src=<run>/bundle,dst=/run/bundle,readonly \
  --mount type=bind,src=<model>,dst=/models/model-a,readonly \
  --mount type=bind,src=<run>/output,dst=/workspace/output \
  --mount type=bind,src=<run>/work,dst=/run/work \
  registry.internal/dj/runtime@sha256:<digest> \
  python -m data_juicer.tools.plan_flow.container_entry \
    --recipe /run/bundle/materialized-recipe.yaml
```

GPU run 在通过资源策略后额外加入：

```bash
--gpus 'device=<broker-assigned-device>'
```

默认 `network none`。如果调用远程模型，broker 根据已审批的 `network_policy` 接入受限网络；不能简单改成无限外网。

### 6.6 输入、输出和路径转换

Plan 中保存逻辑路径或 workspace 相对路径，materialize 阶段转换为容器路径：

```text
workspace/input/a.jpg  → /workspace/input/a.jpg
outputs/result.jsonl   → /workspace/output/result.jsonl
run work               → /run/work
model artifact         → /models/<artifact-id>
```

禁止把 Windows `D:\...` 路径写入正式容器 recipe。Plan 仍记录原始资源标识，materialized recipe 记录容器路径和映射 provenance。

### 6.7 单机调度与配额

Docker 只会执行资源限制，不会自动判断机器是否还有容量。增加 broker 队列：

```text
queued → admitted → starting → running
       → succeeded/failed/cancelled → collecting → cleaned
```

初始资源 profile：

```yaml
cpu-small:   {cpu: 2, memory_gib: 4,  gpu: 0}
cpu-medium:  {cpu: 4, memory_gib: 16, gpu: 0}
gpu-small:   {cpu: 4, memory_gib: 16, gpu: 1}
gpu-medium:  {cpu: 8, memory_gib: 32, gpu: 1}
```

profile 是上限模板，具体数值经 benchmark 调整。默认：每用户 1 个并发 run、每 worker 设置总 admission capacity，不能仅依赖所有容器各自 limit 后过量启动。

### 6.8 运行结束和清理

成功或失败都执行：

1. 停止并等待容器内所有子进程；
2. 收集 exit code、OOM、超时、CPU/内存峰值；
3. 收集 stdout/stderr 和 result manifest；
4. 校验输出路径未越界；
5. 更新 run 状态；
6. `docker rm` 删除容器可写层；
7. 删除 tmpfs；
8. 撤销短期 secret；
9. `work` 按策略立即删除或失败后短期保留；
10. 保留输出、Plan、日志、报告和 provenance。

独立 GC：

- orphan container：broker 重启后按 label reconcile；
- failed work：默认保留有限时间；
- output：业务保留策略；
- model cache：按许可、最近使用时间和配额回收；
- image cache：只清理没有 catalog 引用且超过 TTL 的 digest；
- build cache：独立容量上限。

## 7. Kubernetes 阶段

### 7.1 何时迁移

满足任意多项时迁移：

- 超过一台 worker；
- CPU/GPU 节点类型不同；
- 单机排队成为瓶颈；
- 需要节点故障后的统一状态和重试；
- 需要部门/项目 Namespace 级配额；
- 需要弹性增加 worker；
- 需要更成熟的 Secret、NetworkPolicy 和审计集成。

不要仅因“多人使用”就立刻上 Kubernetes。一台 Linux Docker worker 加队列已经可以安全支持第一批部门用户。

### 7.2 Kubernetes 拓扑

```text
DSH + DJ MCP
      ↓ RuntimeSpec
KubernetesJobBackend
      ↓
Kubernetes API
├─ Namespace / ServiceAccount / ResourceQuota
├─ Job → Pod
│  ├─ init container：模型制品校验/准备
│  └─ main container：DJ runtime
├─ internal image registry
├─ model PVC / object storage
├─ input/output object storage or PVC
└─ logs/metrics/events
```

一个 run 对应一个 Kubernetes Job；不要直接创建裸 Pod。Job UID 成为运行身份。

### 7.3 存储

推荐逐步把“宿主绝对路径 workspace”升级为资源 URI：

```text
workspace://<tenant>/<workspace>/<relative-path>
object://<bucket>/<tenant>/<run>/...
model://<provider>/<model>/<revision>
artifact://<plan-bundle-hash>
```

Kubernetes 中宿主 `D:\...` 路径不能跨节点工作。选择：

- 输入/输出：对象存储优先；或租户隔离的 RWX PVC；
- 模型：共享只读 PVC、节点本地只读 cache，或对象存储 + init container staging；
- Plan bundle：对象存储下载到 `emptyDir`，验证 hash 后只读使用；
- work/tmp：`emptyDir` 并设置 `sizeLimit`；
- Secret：Kubernetes Secret 或外部 secret manager，以文件方式只读挂载。

#### 模型 PVC 的注意事项

主任务只读挂载。写入模型 PVC 的权限只给 model installer/controller。多个 Job 不应同时直接下载到同一最终目录；下载到临时目录、校验后原子发布。

如果集群存储不支持高效 `ReadOnlyMany`，可使用：

1. 对象存储作为权威 ModelStore；
2. 每节点 Daemon/cache service 做本地缓存；
3. init container 将指定模型 staging 到本 Pod 的 `emptyDir`；
4. 主容器只读挂载 staging 结果。

### 7.4 Kubernetes Job 示例

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: dj-run-<run-id>
  namespace: dj-<tenant>
  labels:
    app: dj-runner
    dj.run-id: <run-id>
    dj.runtime-digest: <short-digest>
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 7200
  ttlSecondsAfterFinished: 86400
  template:
    metadata:
      labels:
        app: dj-runner
        dj.run-id: <run-id>
    spec:
      serviceAccountName: dj-runner
      restartPolicy: Never
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      initContainers:
        - name: prepare-models
          image: registry.internal/dj/model-installer@sha256:<digest>
          args:
            - verify-and-stage
            - --manifest=/bundle/models.yaml
            - --target=/staged-models
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - {name: bundle, mountPath: /bundle, readOnly: true}
            - {name: model-source, mountPath: /model-source, readOnly: true}
            - {name: staged-models, mountPath: /staged-models}
          resources:
            requests: {cpu: "500m", memory: "1Gi"}
            limits: {cpu: "2", memory: "4Gi"}
      containers:
        - name: runner
          image: registry.internal/dj/runtime@sha256:<digest>
          args:
            - python
            - -m
            - data_juicer.tools.plan_flow.container_entry
            - --recipe
            - /bundle/materialized-recipe.yaml
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          resources:
            requests:
              cpu: "4"
              memory: "16Gi"
              ephemeral-storage: "10Gi"
            limits:
              cpu: "4"
              memory: "16Gi"
              ephemeral-storage: "20Gi"
          volumeMounts:
            - {name: bundle, mountPath: /bundle, readOnly: true}
            - {name: input, mountPath: /workspace/input, readOnly: true}
            - {name: output, mountPath: /workspace/output}
            - {name: staged-models, mountPath: /models, readOnly: true}
            - {name: work, mountPath: /run/work}
            - {name: tmp, mountPath: /tmp}
      volumes:
        - name: bundle
          persistentVolumeClaim: {claimName: run-<run-id>-bundle}
        - name: input
          persistentVolumeClaim: {claimName: run-<run-id>-input}
        - name: output
          persistentVolumeClaim: {claimName: run-<run-id>-output}
        - name: model-source
          persistentVolumeClaim: {claimName: approved-models}
        - name: staged-models
          emptyDir: {sizeLimit: 50Gi}
        - name: work
          emptyDir: {sizeLimit: 20Gi}
        - name: tmp
          emptyDir:
            medium: Memory
            sizeLimit: 2Gi
```

如果 runtime 需要 GPU，在 `requests` 和 `limits` 增加集群设备插件提供的 GPU extended resource，并由 RuntimeSpec 转换，不能让 Agent提交任意节点名或设备 ID。

### 7.5 Namespace、配额和身份

建议以部门或项目为 Namespace，不必为每个用户创建 Namespace；用户身份继续由 DSH/DJ 控制面管理，Job label 记录 user/run。每个 Namespace 配置：

- ResourceQuota：CPU、内存、GPU、PVC、Job 数量；
- LimitRange：默认和最大 request/limit；
- ServiceAccount：runner 无 Kubernetes API token；
- NetworkPolicy：默认拒绝，按 capability 开放；
- Pod Security：restricted；
- 镜像来源策略：只允许内部 registry 和 digest；
- Secret 权限：按任务最小化。

### 7.6 Kubernetes 生命周期

- `start()`：创建 Job，记录 Job UID；
- `inspect()`：读取 Job condition、Pod phase、container state 和 events；
- `cancel()`：删除 Job 或设置平台取消状态后删除；
- `collect()`：读取 result manifest、日志和资源指标；
- `cleanup()`：删除 Job/临时 PVC/临时 Secret，保留输出和 provenance；
- `reconciler()`：处理控制面重启、失联 Job、超时和 TTL；
- Job 的 `activeDeadlineSeconds` 是平台超时的第二道保险，控制面仍需有自己的 deadline 状态。

## 8. 从当前状态到 Kubernetes 的实施阶段

### 阶段 0：先建立 seam，不改变运行行为

改动：

1. 定义 RuntimeSpec、RunHandle、RunStatus；
2. 将当前 `Popen` 移入 `LocalProcessBackend`；
3. `PlanRunner` 注入 ExecutionBackend；
4. run 状态增加 `backend`、`runtime`、`resources`、`provenance`；
5. 保持现有测试全部通过。

验收：相同 Plan 使用 LocalProcessBackend 的结果与当前一致。

### 阶段 1：固定 Docker runtime

改动：

1. 建立基础 CPU/CUDA 镜像；
2. 增加容器入口 `container_entry`；
3. 实现路径 materialize；
4. 实现 DockerBackend；
5. 增加输入/Plan/model 只读挂载；
6. 增加 CPU、内存、pids、tmpfs、timeout；
7. 实现日志、cancel、cleanup、orphan reconcile；
8. 当前 Windows 用 Docker Desktop 做 smoke test。

验收：容器无法写输入、Plan 和模型；不能访问其他 workspace；删除容器后输出仍存在；超时和 MCP 重启不会留下孤儿容器。

### 阶段 2：Linux Docker worker 与多人队列

改动：

1. 部署 execution broker；
2. 控制面与 worker 使用 mTLS；
3. 增加 tenant/workspace 服务端授权；
4. 增加队列、资源 profile、用户/系统并发配额；
5. 建立内部镜像仓库和 ModelStore；
6. 部署首批固定能力 runtime；
7. 有需要时接入 NVIDIA runtime。

验收：两个用户并发运行互不可见；一个任务 OOM、依赖失败或恶意写路径不影响其他任务和 MCP。

### 阶段 3：受控的 Agent 自动扩展

改动：

1. CapabilityRequirement 和内部 catalog；
2. CapabilityProposal；
3. 独立 RuntimeBuilder；
4. 模型下载、许可审批、hash 校验和只读发布；
5. contract test 与 preview gate；
6. 发布 runtime/model 后自动复用；
7. 构建与运行网络策略分离。

验收：Agent 找到一个新能力时，共享 DJ venv 不发生变化；构建失败不影响正式 runtime；未经批准的模型/源码/网络不能执行。

### 阶段 4：Kubernetes Adapter

改动：

1. 部署内部 registry、对象存储/PVC、Namespace 配额和安全策略；
2. 实现 KubernetesJobBackend；
3. RuntimeSpec 转换为 Job；
4. init container 负责模型校验/staging；
5. 输出和 Plan 从宿主路径迁移为资源 URI；
6. 实现 Job/Pod event、日志、取消、TTL 和 reconciler；
7. DockerBackend 保留用于本地开发和应急回退。

验收：同一 image digest、model revision 和 Plan 可在 Docker 与 Kubernetes Adapter 上得到等价业务输出。

### 阶段 5：多节点生产化

改动：

1. CPU/GPU 节点池；
2. 节点标签、taint/toleration 由平台策略生成；
3. 部门 Namespace ResourceQuota；
4. 模型节点缓存；
5. 指标、告警、成本和容量规划；
6. 备份 catalog、provenance、输出索引和审批记录。

## 9. 测试方案

### 9.1 Interface 测试

同一组 backend contract tests 应运行于 Local、Docker 和 Kubernetes Adapter：

- start 返回稳定 RunHandle；
- inspect 状态单调且终态稳定；
- cancel 幂等；
- cleanup 幂等；
- backend 重启后可根据 handle 恢复 inspect；
- 超时与 OOM 有结构化错误码。

### 9.2 隔离测试

- 写 `/workspace/input` 必须失败；
- 写 `/models` 必须失败；
- 读其他 tenant path 必须失败；
- 读取未声明 secret 必须失败；
- 默认外网连接必须失败；
- fork bomb 受 pids limit；
- 内存超限产生 OOM 状态而非拖垮 worker；
- 临时盘超限任务失败但宿主仍健康；
- 自定义算子不能修改 Plan bundle。

### 9.3 供应链测试

- tag 漂移不能改变已批准 image digest；
- model hash 不符拒绝运行；
- 未审批许可证拒绝发布；
- 构建网络访问非 allowlist 域名失败；
- 新依赖不能进入共享 venv；
- catalog descriptor、runtime manifest、model artifact 与 run provenance 可闭环追溯。

### 9.4 业务测试

- 每种 capability 建立小型 contract dataset；
- preview 与正式运行使用相同 image/model，只改变输入规模和资源；
- 质量指标按业务维度分桶报告；
- runtime/model 升级必须与上一批准版本做回归比较。

## 10. 运行状态与错误码

统一状态：

```text
draft
→ awaiting_capability
→ awaiting_approval
→ building
→ validating
→ ready
→ queued
→ admitted
→ starting
→ running
→ collecting
→ succeeded | failed | cancelled | timed_out
→ cleaned
```

关键错误码：

```text
CAPABILITY_MISSING
CAPABILITY_NOT_APPROVED
MODEL_LICENSE_NOT_APPROVED
MODEL_ACCESS_REQUIRED
MODEL_HASH_MISMATCH
RUNTIME_BUILD_FAILED
RUNTIME_TEST_FAILED
IMAGE_NOT_ALLOWED
RESOURCE_QUOTA_EXCEEDED
NETWORK_POLICY_DENIED
MOUNT_PATH_DENIED
RUN_OOM
RUN_TIMED_OUT
RUNNER_LOST
OUTPUT_VALIDATION_FAILED
```

Agent 根据结构化错误决定下一步，不能从任意 stderr 猜测并自动提权。

## 11. 数据与制品生命周期

| 对象 | 创建者 | 运行时权限 | 任务后处理 |
|---|---|---|---|
| 输入 | workspace/data system | 只读 | 按业务策略保留 |
| Plan bundle | DJ PlanStore | 只读 | 长期保留、不可变 |
| runtime 镜像 | RuntimeBuilder | 只读执行 | catalog 引用期间保留 |
| 模型制品 | ModelStore | 只读 | 独立许可、TTL/LRU/引用保护 |
| work/tmp | run | 读写 | 成功立即删，失败短期保留 |
| 输出 | run | 读写 | 按业务策略保留 |
| 日志/报告 | run/broker | 追加/收集 | 脱敏后保留 |
| Secret | secret manager | 只读、短期 | run 终止立即撤销 |
| 容器/Pod | backend | 临时 | 收集后删除 |

## 12. 不采用的方案

### 在共享 DJ venv 动态安装

拒绝。会产生跨用户污染、依赖漂移、不可复现、供应链和回滚困难。

### 每个 run 临时联网 pip install

不作为正式方案。即使容器隔离，也会导致每次结果依赖当时网络和包仓库状态，并把构建风险混入业务运行。

### 把所有模型打进一个超级镜像

不作为默认方案。镜像过大、许可混杂、更新成本高、CPU/GPU 栈冲突。模型作为独立制品只读挂载。

### Agent 直接操作 Docker socket 或 Kubernetes 凭据

拒绝。Agent 只能提交结构化 proposal、BuildRequest 和 RuntimeSpec，由策略模块和 broker 执行。

### 现在立即上 Kubernetes

拒绝作为前置。当前先把 Docker 阶段的 interface、制品和隔离做正确；否则 Kubernetes 只会放大不成熟的运行语义和运维复杂度。

## 13. 最终验收标准

1. Agent 能把未知需求转换为缺失 capability，并输出可审阅候选；
2. 新能力构建、模型下载和 preview 均不修改共享 DJ 环境；
3. 未经审批的新源码、模型许可、网络和超额资源不能进入正式运行；
4. 正式 run 使用固定 image digest、model revision/hash 和 Plan hash；
5. 输入、Plan、模型只读，输出是唯一持久业务写入点；
6. 任务结束删除容器/Pod、临时文件和 Secret，但保留输出、日志和 provenance；
7. 两个用户并发任务在路径、进程、资源、缓存私有部分和凭据上隔离；
8. 同一 RuntimeSpec 可由 DockerBackend 和 KubernetesJobBackend 执行；
9. MCP/broker 重启可恢复状态并清理孤儿任务；
10. 每个发布能力都能追溯源码、依赖、镜像、模型、许可、测试和审批。

## 14. 推荐的实际启动顺序

现在先做以下四件事：

1. 把 `runner.py` 的 `Popen` 抽到 `LocalProcessBackend`，建立稳定 ExecutionBackend interface；
2. 在当前 Windows 机器安装 Docker Desktop + WSL2，完成 DockerBackend 的 CPU smoke test；
3. 准备 Linux Docker worker，部署 broker、模型库和首个固定 runtime；
4. 固定能力运行稳定后，再实现 Agent proposal → builder → preview → publish。

Kubernetes 放在这些 interface 和制品稳定之后。迁移时不改变 Agent、Plan、CapabilityDescriptor、RuntimeManifest、ModelArtifact 和 RuntimeSpec，只增加 KubernetesJobBackend，并将宿主路径存储升级为对象存储/PVC。

## 15. 当前 Windows 主机上的本地 Worker 验证方案

本节是摘要；逐步安装、镜像、代码 seam、ModelStore、DockerBackend、broker、测试矩阵与完成标准见独立文档：[当前 Windows 主机 Docker Worker 本机验证完整方案](./local-windows-docker-worker-validation.zh-CN.md)。

### 15.1 能验证什么

当前主机可以验证：

- Linux runtime 镜像能否从锁定依赖构建；
- LocalProcessBackend 与 DockerBackend 的 contract 是否一致；
- 输入、Plan、模型只读挂载；
- 输出和 work/tmp 生命周期；
- CPU/内存/pids/timeout/network 限制；
- 模型 installer 与 run container 的写权限分离；
- cancel、cleanup、MCP/broker 重启后的 orphan reconcile；
- Agent proposal → candidate image → preview 的 CPU 闭环。

当前主机不能验证：

- CUDA runtime 和 GPU device allocation；
- SAM 3 等 GPU 模型的正式吞吐和显存容量；
- 多节点调度、节点故障和 Kubernetes 集群行为；
- 物理机器级故障隔离。

### 15.2 不是复制当前 venv

不要把 `D:\dj\.envs\dsh-dj` 直接复制进镜像。当前环境是 Windows Python，包含 Windows wheel、路径和本机状态，不能成为 Linux worker 的运行环境。

镜像应从声明式输入重建：

```text
Data-Juicer source commit
+ pyproject.toml / uv.lock
+ Python version
+ system package list
+ custom operator artifacts
+ CPU/CUDA runtime profile
= immutable Linux OCI image
```

当前 venv 只作为行为对照和依赖调查来源，不是镜像层。

### 15.3 本机拓扑

```text
Windows
├─ DSH Web
├─ DJ MCP
├─ execution broker client
├─ D:\dsh-worker\runs      # 可检查的输入/输出/日志
└─ Docker Desktop
     └─ WSL2 Linux backend
          ├─ builder container
          ├─ model installer container
          └─ run container
```

这已经是一个真实的逻辑 worker，只是 worker 与控制面共享同一台物理主机。

### 15.4 本机目录

```text
D:\dsh-worker\
├─ models\
├─ model-downloads\
├─ runs\
│  └─ <run-id>\
│     ├─ input\
│     ├─ bundle\
│     ├─ output\
│     ├─ work\
│     └─ logs\
├─ build-contexts\
└─ broker-state\
```

模型 installer 只能写 `model-downloads/<request-id>`。校验通过后由 ModelStore 原子发布到 `models/<artifact-id>`。正式 run 只以 `readonly` 方式挂载最终模型目录。

### 15.5 本机安装路径

1. 保持当前 DSH/DJ venv 不变；
2. 安装一个 WSL2 Linux 发行版，或直接使用 Docker Desktop 管理的 WSL2 backend；
3. 安装 Docker Desktop 并选择 WSL2 backend；
4. 创建 `D:\dsh-worker`；
5. 在 DJ 源码仓库增加 runtime Dockerfile 与容器入口；
6. 先构建不含业务模型的 CPU runtime；
7. 用固定小数据运行只读挂载和清理测试；
8. 再实现 ModelStore/installer；
9. 最后接 Agent proposal/builder，不能反过来先给 Agent 安装权限。

### 15.6 使用完整虚拟机的替代方案

可以创建 Ubuntu Hyper-V VM，并在 VM 内安装 Docker Engine：

```text
Windows DSH/DJ MCP
       ↓ HTTP/mTLS
Ubuntu VM execution broker
       ↓
Docker Engine
```

建议给测试 VM 分配约 4 vCPU、12–16 GiB 内存和 100–150 GiB 动态磁盘，具体取值根据宿主同时运行的任务调整。完整 VM 更接近未来独立 Linux worker，但安装、网络、共享目录和资源开销更大。

选择建议：

- 先验证镜像、挂载和 backend：Docker Desktop + WSL2；
- 需要验证远程 broker、mTLS、断线恢复：Hyper-V Ubuntu VM；
- 需要 GPU 模型、多人生产吞吐和独立故障域：独立 Linux GPU 服务器或云 GPU worker。

### 15.7 从本机迁移到独立服务器

本机验证通过后：

1. 把 image 推送到内部 registry，并固定 digest；
2. 在 Linux worker 拉取同一 digest；
3. 把模型 artifact 同步到 worker ModelStore，并复核 hash；
4. 将本机 `DockerBackend` 改为调用远程 execution broker；
5. 将 Windows bind path 映射替换为 worker staging path；
6. Plan、RuntimeSpec、CapabilityDescriptor 和 Agent 行为不变。

因此本机测试不是一次性临时代码，而是最终架构的单节点 Adapter 验证环境。
