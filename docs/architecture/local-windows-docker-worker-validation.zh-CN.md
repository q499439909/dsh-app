# 当前 Windows 主机：Docker Worker 本机验证完整方案

更新时间：2026-08-30

## 1. 目的

本方案只解决一个问题：在不修改、不污染当前 `D:\dj\.envs\dsh-dj` 的前提下，用这台 Windows 主机构建并验证第一个隔离 worker，跑通：

```text
现有 DSH/DJ MCP
  ↓ RuntimeSpec
本机 DockerBackend
  ↓
Linux run container
  ├─ 固定 DJ runtime
  ├─ 输入/Plan/模型只读
  ├─ 输出/work/tmp 受控可写
  ├─ CPU/内存/进程/网络限制
  └─ 完成后清理
```

本方案不是部门生产部署，也不验证 GPU/SAM 3 性能。它验证以后迁移到独立 Linux worker 和 Kubernetes 所需的 interface、制品和生命周期。

## 2. 当前主机结论

已检查：

- Windows，约 32 GiB 内存；
- 8 个逻辑 CPU；
- D 盘约 317 GiB 空闲；
- WSL 2.7.3 已安装；
- 系统已检测到 Hyper-V hypervisor；
- 当前没有安装 WSL Linux 发行版；
- 当前没有 Docker CLI/Docker Desktop；
- 当前 DJ Python 为 3.12；
- 当前 PyTorch 是 CPU build，CUDA 不可用。

判断：本机适合 Docker/WSL2 CPU worker 验证。无需另一台物理服务器，也无需先创建完整 Hyper-V VM。

## 3. 能验证与不能验证的范围

### 3.1 能验证

- Linux OCI 镜像能否从 DJ 源码和锁文件重建；
- 当前 plan-flow 能否通过 DockerBackend 启动 worker；
- Windows 路径到 Linux 容器路径的 materialize；
- input、Plan bundle、模型的只读性；
- output、work、tmp 的写权限和生命周期；
- CPU、内存、pids、timeout 和默认断网；
- run 状态、日志、cancel、cleanup；
- MCP/broker 重启后 orphan container reconcile；
- Model Installer 写入与正式 run 只读模型的权限分离；
- Agent 缺失能力 proposal → 候选镜像 → preview 的 CPU 演练；
- 同一 RuntimeSpec 在 LocalProcessBackend 和 DockerBackend 的业务等价性。

### 3.2 不能验证

- CUDA、NVIDIA Container Runtime 和 GPU 分配；
- GPU 显存限制与多任务竞争；
- SAM 3 的实际吞吐；
- 多物理节点和节点故障；
- Kubernetes scheduler、PVC 和 NetworkPolicy；
- 控制面与 worker 的物理故障隔离。

## 4. 本机目标拓扑

```text
Windows Host
├─ DSH Web                  现有
├─ DJ MCP                   现有
├─ DJ shared venv           现有，只作为控制面
├─ execution broker         新增，本机窄接口
├─ D:\dsh-worker\           新增，受控数据根
└─ Docker Desktop
   └─ WSL2 Linux backend
      ├─ runtime builder
      ├─ model installer
      └─ run containers
```

`worker` 是逻辑角色，不要求独立物理机。Docker Desktop 的 WSL2 backend 已经提供 Linux 内核和轻量 VM。

## 5. 关键原则

1. 不复制 `D:\dj\.envs\dsh-dj` 到镜像；它包含 Windows wheel、Windows 路径和本机历史状态。
2. 不运行 `pip install` 修改共享 venv。
3. 镜像由 DJ 源码、`pyproject.toml`、`uv.lock`、Python 版本和自定义 artifact 声明式重建。
4. 首个镜像只装 core + tools，不使用仓库现有的 CUDA `[all]` Dockerfile作为 CPU 基线。
5. Agent 不直接调用 Docker socket；本机第一步可以由 DockerBackend 直接调用，接口稳定后立即收敛到 execution broker。
6. 模型下载容器和任务运行容器分开。
7. 模型正式目录只能由 ModelStore 发布，run 永远只读。
8. 所有实验先用小型 CPU fixture，不能用 SAM 3 作为第一项基础设施测试。

## 6. 阶段 A：Windows、WSL2 与 Docker Desktop 准备

本阶段会安装系统软件并可能要求重启，应由主机管理员执行；不要把它做成 Agent 自动动作。

### A1. 记录基线

执行前记录：

```powershell
wsl --version
wsl --status
wsl -l -v
Get-PSDrive -PSProvider FileSystem
```

当前预期：WSL 本体存在，但 `wsl -l -v` 没有 Linux 发行版。

### A2. 可选安装 Ubuntu 发行版

Docker Desktop 可以管理自己的 WSL2 backend；另外安装 Ubuntu 有利于检查 Linux 路径、网络和 Docker CLI 集成，但不是必须条件。

管理员 PowerShell：

```powershell
wsl --list --online
wsl --install -d Ubuntu-24.04
```

如系统提示则重启。验证：

```powershell
wsl -l -v
```

Ubuntu 应显示 `VERSION 2`。如果不是：

```powershell
wsl --set-version Ubuntu-24.04 2
```

### A3. 安装 Docker Desktop

人工安装 Docker Desktop，配置：

- 使用 WSL2 backend；
- 使用 Linux containers；
- 不启用不需要的 Kubernetes；
- 不把 Docker TCP daemon 暴露到局域网；
- 不允许 Agent 直接获得 Docker socket；
- 根据组织情况核对 Docker Desktop 使用许可。

验证：

```powershell
docker version
docker info
docker run --rm hello-world
```

### A4. 本机资源上限

当前主机只有 32 GiB 内存和 8 个逻辑 CPU。建议第一轮为 WSL/Docker 留：

```text
最多 4 CPU
最多 16 GiB 内存
8 GiB swap
```

如果通过 `%UserProfile%\.wslconfig` 管理，可采用：

```ini
[wsl2]
memory=16GB
processors=4
swap=8GB
```

配置变化后通过 `wsl --shutdown` 让 WSL 重启生效。该动作会停止当前所有 WSL 工作负载，因此只能在确认没有运行任务时执行。

验收：Windows 空闲时仍有足够内存，Docker 容器不会占用整机全部资源。

## 7. 阶段 B：受控目录与权限

### B1. 目录规划

```text
D:\dsh-worker\
├─ models\                 # 已验证模型，run 只读
├─ model-downloads\        # 下载临时区
├─ runs\
│  └─ <run-id>\
│     ├─ input\            # 只读挂载
│     ├─ bundle\           # Plan/recipe/artifact，只读挂载
│     ├─ output\           # 唯一业务持久写目录
│     ├─ work\             # DJ 中间状态
│     └─ logs\             # broker 收集
├─ build-contexts\         # 候选构建上下文
├─ build-results\          # SBOM/provenance/test results
├─ broker-state\           # container handle/reconcile state
└─ fixtures\               # 非敏感测试样本
```

人工创建：

```powershell
$root = 'D:\dsh-worker'
New-Item -ItemType Directory -Force -Path `
  "$root\models", `
  "$root\model-downloads", `
  "$root\runs", `
  "$root\build-contexts", `
  "$root\build-results", `
  "$root\broker-state", `
  "$root\fixtures"
```

不要将 `D:\dj` 整棵源码或用户任意 workspace 作为容器可写根。

### B2. 测试租户

本机先定义固定测试租户：

```text
tenant_id = local-test
allowed_worker_root = D:\dsh-worker
```

RuntimeSpec 只能引用逻辑资源：

```text
run://local-test/run-001/input
run://local-test/run-001/output
model://fixture/tiny-model/v1
artifact://plan/<sha256>
```

由本机 broker 转换为绝对路径，拒绝 RuntimeSpec 自带任意 `D:\...`。

## 8. 阶段 C：最小 CPU Runtime 镜像

### C1. 为什么不直接使用现有 Dockerfile

仓库已有 `D:\dj\data-juicer-1.5.4\Dockerfile`，它基于 NVIDIA CUDA，安装 Java、大量系统包和 `.[all]`。它适合综合 CUDA 镜像，不适合作为本机 CPU 沙箱最小验证：

- 当前没有 GPU；
- 构建时间和镜像体积大；
- 下载源和依赖面过宽；
- 很难区分是基础设施失败还是某个可选依赖失败。

### C2. 建议新增文件

在 DJ 仓库中后续实现：

```text
docker/
├─ Dockerfile.plan-flow-cpu
├─ Dockerfile.capability
└─ entrypoint.sh

data_juicer/tools/plan_flow/
└─ container_entry.py
```

### C3. CPU Dockerfile 设计

建议骨架：

```dockerfile
FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    UV_PROJECT_ENVIRONMENT=/opt/dj-venv

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates ffmpeg libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 实际实施时固定 uv 版本或 installer digest。
RUN pip install --no-cache-dir uv==<approved-version>

WORKDIR /opt/data-juicer

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --extra tools --no-install-project

COPY data_juicer ./data_juicer
COPY tools ./tools
COPY hatch_build.py ./
RUN uv sync --frozen --no-dev --extra tools

RUN groupadd --gid 10001 djrun \
    && useradd --uid 10001 --gid 10001 --no-create-home djrun

USER 10001:10001
WORKDIR /workspace

ENTRYPOINT ["/opt/dj-venv/bin/python", "-m", \
            "data_juicer.tools.plan_flow.container_entry"]
```

说明：

- `uv sync --frozen` 使用现有 lock，不在构建时自动升级版本；
- 仅使用 `tools` extra，先不安装 `generic/vision/audio/all`；
- 不使用 editable install；
- 最终以非 root 用户运行；
- 构建阶段可联网，run 阶段默认断网；
- 镜像内不复制业务数据、凭据和模型。

实际提交前应根据 `uv sync` 在 Linux 上的解析结果修正 Dockerfile，并固定基础镜像 digest。

### C4. 构建

在 DJ 源码根执行：

```powershell
docker build `
  --file docker/Dockerfile.plan-flow-cpu `
  --tag dj-plan-flow-cpu:local-v1 `
  .
```

记录：

```powershell
docker image inspect dj-plan-flow-cpu:local-v1
docker image history dj-plan-flow-cpu:local-v1
```

正式 run 应解析到 image ID/digest，而不是继续信任 tag。

### C5. 镜像 smoke test

第一层：

```powershell
docker run --rm --entrypoint /opt/dj-venv/bin/python `
  dj-plan-flow-cpu:local-v1 `
  -c "import data_juicer; print(data_juicer.__version__)"
```

第二层：验证非 root、只读 rootfs 和默认断网：

```powershell
docker run --rm `
  --read-only `
  --network none `
  --cap-drop ALL `
  --security-opt no-new-privileges:true `
  --tmpfs /tmp:rw,noexec,nosuid,size=256m `
  --entrypoint /opt/dj-venv/bin/python `
  dj-plan-flow-cpu:local-v1 `
  -c "import os; print(os.getuid())"
```

验收：导入成功，uid 为 10001，容器不需要宿主 venv。

## 9. 阶段 D：容器入口与路径物化

### D1. container_entry 的职责

`container_entry.py` 只做：

1. 读取 `/run/bundle/run-spec.json`；
2. 校验 schema 和 run ID；
3. 校验 `/run/bundle/materialized-recipe.yaml` hash；
4. 校验声明的模型目录存在且只读；
5. 启动 DJ Executor；
6. 写 `/workspace/output/result-manifest.json`；
7. 返回结构化 exit code。

它不能：

- 安装依赖；
- 下载模型；
- 修改 Plan；
- 访问 Docker socket；
- 根据用户输入执行 shell 字符串；
- 扫描其他宿主目录。

### D2. 路径转换

```text
Windows                         Container
D:\dsh-worker\runs\r1\input   /workspace/input
D:\dsh-worker\runs\r1\bundle  /run/bundle
D:\dsh-worker\models\m1        /models/m1
D:\dsh-worker\runs\r1\output  /workspace/output
D:\dsh-worker\runs\r1\work    /run/work
```

持久 Plan 保存逻辑路径；仅 materialized recipe 使用容器路径。这样以后迁移 Linux/Kubernetes 时不修改 Plan 语义。

### D3. 最小 fixture

先使用一个很小的 JSONL 文本/图片 manifest 和不需要模型的内置 DJ 算子，验证 DJ 全流程。不要第一轮就引入人脸模型。

验收顺序：

1. 单记录 JSONL；
2. 内置无模型算子；
3. 100 条记录；
4. 受控失败算子；
5. timeout/cancel；
6. 自定义轻量算子；
7. tiny model artifact；
8. 再考虑真实视觉模型。

## 10. 阶段 E：ExecutionBackend seam

### E1. 文件结构

```text
data_juicer/tools/plan_flow/execution/
├─ __init__.py
├─ spec.py
├─ backend.py
├─ local_process.py
└─ docker.py
```

### E2. Interface

```python
class ExecutionBackend(Protocol):
    def start(self, spec: RuntimeSpec) -> RunHandle: ...
    def inspect(self, handle: RunHandle) -> RunStatus: ...
    def cancel(self, handle: RunHandle) -> None: ...
    def collect(self, handle: RunHandle) -> RunResult: ...
    def cleanup(self, handle: RunHandle) -> None: ...
```

### E3. 迁移当前 runner

1. 先将当前 `subprocess.Popen()` 原样移入 `LocalProcessBackend`；
2. `PlanRunner` 接收 backend，不直接创建进程；
3. 保持所有现有 plan-flow 测试通过；
4. 建立 backend contract test；
5. 再实现 DockerBackend。

禁止在 `runner.py` 中同时保留一半 Docker 分支和一半 Popen 分支，否则生命周期逻辑会重复并逐渐分叉。

### E4. RunHandle

> 实施更新：下面的 Docker 字段示例已由
> [`local-windows-docker-worker-abcd-handoff.zh-CN.md`](./local-windows-docker-worker-abcd-handoff.zh-CN.md#6-阶段-e-前置设计决定通用-runhandle-不暴露-docker-字段)
> 第 6 节替代。通用 `RunHandle` 不再直接暴露 `container_id` 或 `image_id`。

```json
{
  "backend": "docker",
  "run_id": "run_r001",
  "container_id": "...",
  "image_id": "sha256:...",
  "created_at": "...",
  "deadline": "..."
}
```

不能只保存容器名称；container ID 和 image ID 才是恢复与审计依据。

## 11. 阶段 F：DockerBackend

### F1. broker 校验后的等价运行命令

```powershell
docker create `
  --name dj-run-r001 `
  --label dj.managed=true `
  --label dj.run-id=run_r001 `
  --user 10001:10001 `
  --read-only `
  --network none `
  --cap-drop ALL `
  --security-opt no-new-privileges:true `
  --pids-limit 256 `
  --cpus 2 `
  --memory 8g `
  --memory-swap 8g `
  --tmpfs /tmp:rw,noexec,nosuid,size=1g `
  --mount "type=bind,src=D:\dsh-worker\runs\r001\input,dst=/workspace/input,readonly" `
  --mount "type=bind,src=D:\dsh-worker\runs\r001\bundle,dst=/run/bundle,readonly" `
  --mount "type=bind,src=D:\dsh-worker\models\fixture-v1,dst=/models/fixture-v1,readonly" `
  --mount "type=bind,src=D:\dsh-worker\runs\r001\output,dst=/workspace/output" `
  --mount "type=bind,src=D:\dsh-worker\runs\r001\work,dst=/run/work" `
  dj-plan-flow-cpu:local-v1 `
  --run-spec /run/bundle/run-spec.json
```

随后：

```powershell
docker start dj-run-r001
docker inspect dj-run-r001
docker logs dj-run-r001
docker wait dj-run-r001
```

这些命令只说明 Adapter 行为。正式实现使用 Docker Engine client 或安全的 argv 调用，不拼接用户 shell 字符串。

### F2. 状态映射

```text
Docker created     → starting
Docker running     → running
exit code 0        → collecting/succeeded
nonzero exit       → failed
OOMKilled          → RUN_OOM
deadline exceeded  → RUN_TIMED_OUT
manual stop        → cancelled
container missing  → RUNNER_LOST 或已清理记录
```

### F3. Cancel

1. 标记 cancellation requested；
2. 请求容器优雅停止；
3. 超过 grace period 后强制停止；
4. 等待进程结束；
5. 收集已有日志和 result；
6. 标记 cancelled；
7. 执行 cleanup。

### F4. Cleanup

成功：

- 删除容器；
- 删除 work；
- 保留 output/logs/bundle/provenance；
- tmpfs 自动消失。

失败：

- 删除容器；
- work 短期保留供诊断；
- 日志和 bundle 保留；
- 记录清理 deadline。

Broker 重启后列出带 `dj.managed=true` label 的容器，与 `broker-state` 对账，处理 orphan。

## 12. 阶段 G：本机 ModelStore

### G1. 权限分离

```text
Model Installer
  可写：model-downloads/<request-id>
  不可读：业务 run input

ModelStore Publisher
  可读：已下载 staging
  可写：models/<artifact-id>

Run Container
  只读：models/<artifact-id>
```

### G2. ModelManifest

```yaml
artifact_id: fixture-tiny-model-v1
source: local-fixture
revision: v1
sha256: <sha256>
size_bytes: <size>
license:
  status: approved-for-test
files:
  - path: weights.bin
    sha256: <sha256>
```

### G3. 发布

```text
model-downloads/request-001/
  ↓ 校验 manifest 和每个文件 hash
models/.publishing-fixture-v1/
  ↓ 原子 rename
models/fixture-v1/
  ↓ run readonly mount
/models/fixture-v1
```

校验失败永远不能把部分文件暴露为正式 artifact。

### G4. 第一项测试用模型

使用几 KB/MB 的本地 fixture 文件，不联网、不涉及特殊许可，验证：

- 下载/staging/publish 状态；
- hash mismatch 拒绝；
- run 能读；
- run 不能覆盖或删除；
- 两个 run 可同时读取；
- 删除容器后模型仍存在。

之后再接公开、许可清晰的小型 CPU 模型。SAM 3 和 BUFFALO 不应成为 ModelStore 的第一项基础测试。

## 13. 阶段 H：两级缺失能力自动部署演练

阶段 H 必须拆成两个明确且顺序执行的验收点。H1 只验证 capability 构建与注册链路；H2/H-model 在同一套 seam 上加入阶段 G 的 ModelArtifact。不要用一次 model-backed demo 同时承担两类验收，否则失败时无法判断问题属于 Builder/Runtime，还是 ModelStore/inference。

### H1. 无模型 demo capability

创建一个仓库内的 demo 自定义算子包：

```text
tests/fixtures/capabilities/demo_image_stat/
├─ pyproject.toml
├─ demo_image_stat/
│  ├─ __init__.py
│  └─ operator.py
└─ tests/
```

要求它：

- 依赖一个基础镜像没有的小型、固定版本依赖，或使用本地 fixture wheel；
- 输入输出 contract 简单；
- 不联网；
- 不访问模型；
- 能故意生成一个依赖缺失场景。

H1 演练流程：

```text
Agent 需求分析
  ↓
Capability catalog 未找到
  ↓
生成 CapabilityProposal
  ↓
人工批准 demo source/hash/dependency
  ↓
Builder 从 dj-plan-flow-cpu:local-v1 构建派生镜像
  ↓
import test + operator contract test
  ↓
preview run
  ↓
发布 local capability descriptor
  ↓
第二次请求直接复用，不再构建
```

H1 明确验收点：

```text
无模型 demo capability
  → 验证“缺算子 → Builder → 新 Runtime → 注册 → 复用”
```

- 共享 venv 的 `pip freeze` 前后不变；
- 基础镜像 ID 不变；
- 派生镜像有独立 ID；
- capability descriptor 固定 source hash、依赖 lock hash 和派生 image ID；
- 构建失败不会影响现有 run；
- 未批准 proposal 不能运行；
- 第二次同样依赖得到相同环境 hash 或复用既有 digest。

### H2 / H-model. tiny model-backed capability

H1 通过后，再创建第二个独立 capability。它必须同时包含：

```text
新 Operator
  + 新派生 Runtime
  + 阶段 G 已发布 ModelArtifact
  → 离线 CPU inference
```

建议使用 Google BERT-Tiny：

```yaml
artifact_id: google-bert-uncased-l2-h128-a2-rev-30b0a37
source: https://huggingface.co/google/bert_uncased_L-2_H-128_A-2
revision: 30b0a37ccaaa32f332884b96992754e246e48c5f
architecture:
  layers: 2
  hidden_size: 128
  attention_heads: 2
license:
  evidence: Apache-2.0
  status: requires-explicit-test-approval
runtime_files:
  - config.json
  - model.safetensors
  - vocab.txt
excluded_files:
  - pytorch_model.bin
  - flax_model.msgpack
```

选择理由与约束：

- Google 官方模型仓库明确把 2/128 模型定位为受限计算资源下的小型 BERT，并声明小模型与源码同为 Apache-2.0；
- Hugging Face 的 Google 官方 namespace 提供 `model.safetensors`，单份权重约 17.7 MB，适合本机 CPU 演练；
- 只下载固定 revision 的 `config.json`、`model.safetensors` 和 `vocab.txt`，不下载整个约 53.3 MB、包含重复格式的仓库；
- 禁止使用 pickle 格式的 `pytorch_model.bin`；实际文件 hash、总大小、许可审批人和审批时间必须由阶段 G ModelManifest/审批记录固化；
- Builder 只把固定版本的推理依赖和新 Operator 放进派生 Runtime，模型不得 bake 进 image；
- 构建阶段可按 allowlist 下载依赖，正式 preview/run 必须 `network=none`，模型通过 `/models/<artifact-id>` 只读挂载；
- 原始 BERT 不是经过句向量任务微调的质量模型。H-model 只验收真实 inference、确定性和集成链路，不把 embedding 相似度当业务质量结论。

建议 demo Operator contract：输入一条短文本，使用 `AutoTokenizer` 和 `AutoModel` 的本地路径、`local_files_only=True`、CPU/eval/no-grad，执行一次 forward；输出 `hidden_size=128`、token count、有限的 pooled-vector norm 和确定性 checksum，不在日志中打印完整 embedding。

H-model 演练流程：

```text
Capability catalog 未找到 model-backed demo operator
  ↓
生成并人工批准 source/dependency/model proposal
  ↓
Model Installer 下载固定 revision 的 safetensors/config/vocab
  ↓
阶段 G ModelStore 校验并发布 ModelArtifact
  ↓
Builder 构建包含新 Operator 和固定推理依赖的新 Runtime
  ↓
import test + operator contract test + model mount contract test
  ↓
network=none 的 preview inference
  ↓
发布 capability descriptor（固定 image ID + model artifact hash）
  ↓
第二次请求复用同一 Runtime 和 ModelArtifact
```

H-model 明确验收点：

```text
tiny model-backed capability
  → 验证“新 Operator + 新 Runtime + G ModelArtifact → inference”
```

- 未审批的模型许可、source revision、dependency lock 或 Operator source 任一项都不能进入 Builder/run；
- 派生 Runtime ID 与基础镜像及 H1 Runtime 不同，模型文件不在任何 image layer 中；
- preview 的 container entry 验证模型挂载只读，模型路径来自 `model-store://` 物化而非宿主路径；
- 固定输入的两次推理得到 `hidden_size=128`、有限数值和相同 checksum；不同输入不能得到相同 checksum；
- 模型 hash mismatch、缺文件和尝试联网分别得到稳定失败码，不能回退为在线 `from_pretrained(model_id)`；
- cleanup 删除容器/work 后，Runtime 和 ModelArtifact 仍存在且可复核；
- 第二次相同 capability 请求不重新下载模型、不重新构建镜像，复用同一 image ID 和 ModelArtifact hash；
- 共享 venv、基础镜像 ID 和阶段 G tiny fixture 均保持不变。

模型与许可事实来源：

- [Google BERT 官方仓库](https://github.com/google-research/bert)：小模型表、计算资源定位及 Apache-2.0 声明；
- [Google 官方 Hugging Face 模型页](https://huggingface.co/google/bert_uncased_L-2_H-128_A-2/tree/30b0a37ccaaa32f332884b96992754e246e48c5f)：固定 revision 的文件清单和 safetensors；
- [Google BERT LICENSE](https://github.com/google-research/bert/blob/master/LICENSE)：许可正文。

### H3. 2026-08-30 实施状态

H1 与 H2 已完成真实 Docker 验收。当前有效 descriptor 是：

```text
H1 demo-text-signature-v2
  image: sha256:87b81ce6a47536b31cb736b3d41b66cfd236ba2e39989b99831798808a188cba

H2 demo-bert-feature-v3
  image: sha256:25da6864fdb67b7a85bc827300db7bb0784923d14ba53cb2b9b5df2eb05ece67
  model: sha256:e962e2ee0f9a03d84d04461e30a0fdac2a8a3c53351eb325442b9808a3407b5c
```

H2 固定输入两次 checksum 相同，不同输入 checksum 不同；provenance 为只读根、`network=none`，模型未 bake 入镜像，cleanup 后 ModelStore 仍可 verify。实现事实、旧调试 descriptor 的版本原因以及 freeze 审计缺口见
[`local-windows-docker-worker-abcd-handoff.zh-CN.md`](./local-windows-docker-worker-abcd-handoff.zh-CN.md) 第 10 节。

## 14. 阶段 I：本机 Execution Broker

DockerBackend 最终不应由 Agent 直接操作 Docker。增加只监听 loopback 的 broker：

```text
POST /v1/runs
GET  /v1/runs/{run-id}
POST /v1/runs/{run-id}:cancel
POST /v1/runs/{run-id}:cleanup
```

### I1. Broker 校验

- image 必须在本机 allowlist 且解析为固定 image ID；
- mount source 必须位于 `D:\dsh-worker`；
- input/bundle/model 必须 readonly；
- output/work 必须属于当前 run；
- CPU、内存、pids、timeout 不超过本机 profile；
- 默认网络为 none；
- 不接受 `privileged`、host network、host PID、任意 device；
- 不接受任意 Docker CLI 参数；
- 不接受 shell command，只接受 command argv；
- run ID 和租户必须与已批准 Plan 匹配。

### I2. 本机 profile

```yaml
local-tiny:
  cpu: 1
  memory_gib: 2
  pids: 64
  tmp_gib: 0.25
  timeout_seconds: 300

local-cpu:
  cpu: 2
  memory_gib: 8
  pids: 256
  tmp_gib: 1
  timeout_seconds: 1800
```

本机同时只允许一个 `local-cpu` run，避免拖垮 DSH/MCP。

### I3. 2026-08-30 实施状态

loopback Execution Broker 已实现并通过真实 HTTP + Docker 验收：

```text
module: data_juicer.tools.plan_flow.broker
bind: 仅数值 loopback IP
public run ID: run_<32hex>
allowlist: capability ID → immutable Docker image ID
profiles: local-tiny / local-cpu
```

创建请求只接受批准 Plan 引用、capability 和 profile；mount、Docker 参数、command、tenant、run ID 都不能由请求提供。模型集合及 aggregate hash 必须与 capability descriptor 一致。`local-cpu` 单并发门禁使用跨进程锁和持久 run 状态；cancel/cleanup 幂等。

真实 `127.0.0.1` 运行在 broker 进程重启后用同一公开 run ID 恢复成功，cleanup 后无 managed container、无监听端口。阶段 I 的该次恢复依赖已落盘 broker record；缺 record 的主动 Docker label orphan 对账随后已在完整故障矩阵首批工作中完成。两类恢复的事实与验收证据见
[`local-windows-docker-worker-abcd-handoff.zh-CN.md`](./local-windows-docker-worker-abcd-handoff.zh-CN.md) 第 11、12 节。

## 15. 完整测试矩阵

### 15.1 构建

- lock 不一致时构建失败；
- DJ import 成功；
- MCP/plan-flow import 成功；
- 非 root 用户；
- 镜像不包含 `dj-plan-flow.env`、API key、用户数据；
- image inspect 能得到固定 ID。

2026-08-30 第二批矩阵补证：Broker 创建的真实容器以 `10001:10001` 运行；不可变 capability image ID 和实际 HostConfig 已从 Docker Desktop inspect 读取。其余构建项沿用阶段 C/H 的既有证据。

### 15.2 文件隔离

- 读取 input 成功；
- 写 input 失败；
- 读取 bundle 成功；
- 写 bundle 失败；
- 读取 model 成功；
- 写/删 model 失败；
- 写 output 成功；
- 写 work/tmp 成功；
- 写容器 rootfs 失败；
- 引用 `..` 或符号链接逃逸失败；
- 读取 `D:\dj` 或其他 run 失败。

2026-08-30 第二批矩阵补证：实际 HostConfig 显示 rootfs readonly，input/bundle 的 `RW=false`，output/work 的 `RW=true`；容器内写根目录得到 `EROFS`，写 `/tmp` 成功。路径穿越、符号链接与结果逃逸仍由现有拒绝测试覆盖；本批没有把 HostConfig 的只读标志夸大为已主动篡改 input/bundle 文件。

2026-08-30 第四批矩阵补证：真实 PlanRunner/DockerBackend probe 主动读取 input/bundle/model 成功，主动写 input/bundle/model、删除 model 和写 rootfs 均得到 `EROFS`；写 output/work/tmp 成功；容器内看不到宿主 `D:\dsh-worker` 或 `D:\dj`。ModelStore 篡改前后 aggregate hash 相同。证据位于 `D:\dsh-worker\build-results\dj-plan-flow-files-equivalence-local-v1\validation-summary.json`。

### 15.3 进程和资源

- CPU 限制可观察；
- 内存超限映射为 `RUN_OOM`；
- pids limit 阻止无限 fork；
- timeout 能终止子进程；
- cancel 幂等；
- DockerBackend 重启可恢复 inspect；
- broker 重启可发现 orphan。

2026-08-30 实施状态：最后一项已完成单元拒绝矩阵和真实 Docker tracer。Broker 启动时对账 managed + tenant labels，再与当前 workspace 的 Docker 私有状态、不可变 allowlist image ID、唯一 profile limits、RuntimeSpec 和 PlanRunner run state 交叉验证；异租户、未知镜像、歧义匹配均不接管。真实 tracer 从缺失 broker record 的 running 容器恢复到 succeeded，重复对账不重复建映射，cleanup 后该租户容器为 0。Docker 枚举必须使用 `docker ps -a --no-trunc`，否则 12 位短 ID 无法与私有状态中的 64 位 container ID 相等。证据位于 `D:\dsh-worker\build-results\dj-plan-flow-orphan-reconcile-local-v1\validation-summary.json`。

2026-08-30 第二批矩阵补证：Broker `local-tiny` 的实际 HostConfig 为 1 CPU、2 GiB memory/swap、64 pids。独立低风险 probe 在容器内读取到 `cpu.max=100000 100000`、`memory.max=268435456`、`pids.max=16`；启动 15 个子进程后 `pids.current=16`，下一次 spawn 得到 `EAGAIN`。证据位于 `D:\dsh-worker\build-results\dj-plan-flow-resource-isolation-local-v1\validation-summary.json`。

2026-08-30 第三批矩阵补证：一次性离线派生 probe image 通过正常 PlanRunner/DockerBackend seam 运行。128 MiB probe 被真实 OOM kill，得到 exit 137、`OOMKilled=true` 和 `RUN_OOM`；含父子进程的 probe 在 2 秒 deadline 后被停止，得到 exit 137、`timed_out=true`、`RUN_TIMED_OUT`，停止后容器 PID 为 0。cleanup 后无该租户容器，临时镜像已删除。证据位于 `D:\dsh-worker\build-results\dj-plan-flow-failure-injection-local-v1\validation-summary.json`。

### 15.4 网络和 Secret

- 默认 DNS/HTTP 访问失败；
- 未声明 secret 不存在；
- secret 不进入 Plan、image history、stdout/stderr；
- 测试任务结束 secret mount 消失；
- 只有明确 API capability 才能申请受控网络，此项可留到 Linux worker 阶段。

2026-08-30 第二批矩阵补证：真实容器 HostConfig 为 `NetworkMode=none`，容器内连接 `1.1.1.1:443` 得到 `ENETUNREACH`。本批没有 secret 注入，因此不对 secret 生命周期其余项目作新增完成声明。

2026-08-30 第四批矩阵补证：宿主设置未声明的哨兵 secret 后，Docker run 内该环境变量仍为 null，派生 probe image history 不含哨兵。当前未实现正式 `secret_ref` mount，故“任务结束后 secret mount 消失”仍未验收，不能用“从未挂载”替代撤销生命周期证据。

### 15.5 ModelStore

- hash 正确才能发布；
- hash 错误保持 staging 状态；
- 部分下载不会出现在正式目录；
- 两个 run 可并发只读；
- run 不能投毒模型；
- 模型与容器生命周期独立。

### 15.6 Capability Builder 与 model-backed inference

- H1 未审批 proposal 不能构建或注册；
- H1 构建无模型派生 Runtime，第二次请求复用同一 image ID；
- H1 构建失败不改变基础镜像、共享 venv 或已注册 capability；
- H-model 固定 Google BERT-Tiny revision，只接收 safetensors/config/vocab；
- H-model 的 ModelArtifact hash 与 capability descriptor、run provenance 一致；
- H-model Runtime 不包含模型文件，run 只读挂载阶段 G artifact；
- `network=none` 且 `local_files_only=True` 的 CPU inference 成功；
- 相同输入重复 inference 的 shape/checksum 稳定，不同输入 checksum 不同；
- 缺模型、模型 hash 错误、依赖缺失和联网回退均结构化失败；
- H-model 第二次请求同时复用 Runtime image ID 与 ModelArtifact hash。

### 15.7 业务等价

同一 Plan 分别运行：

```text
LocalProcessBackend
DockerBackend
```

比较：

- 输出记录数；
- 关键字段；
- 算子顺序；
- recipe hash；
- 自定义 artifact hash；
- 错误语义。

允许日志路径和运行时元数据不同，不允许业务输出无解释漂移。

2026-08-30 第四批矩阵补证：同一批准 Plan、同一 content hash 和同一 `whitespace_normalization_mapper` 先后由 LocalProcessBackend 与 DockerBackend 真实执行，两边均 succeeded，输出记录数均为 2，逐条 JSON 业务记录完全相同。该成功路径已加入 `DJ_RUN_DOCKER_INTEGRATION=1` 的 opt-in 集成测试。自定义 artifact 和同一失败 Plan 的错误语义尚未在本批比较。证据位于 `D:\dsh-worker\build-results\dj-plan-flow-files-equivalence-local-v1\validation-summary.json`。

## 16. 日志与可观察性

每个 run 保留：

```text
run.json
runtime-spec.json
materialized-recipe.yaml
mount-manifest.json
model-manifest.json
container-inspect.json
stdout.log
stderr.log
result-manifest.json
resource-summary.json
cleanup.json
```

至少记录：

- run/tenant/job/plan ID；
- image ID；
- model artifact ID/hash；
- CPU/内存 profile；
- container ID；
- started/finished/cleaned 时间；
- exit code、OOM、timeout、cancel；
- output 清单和 hash；
- 不记录 API key、原始 embedding 或不必要的图片内容。

## 17. 故障与恢复演练

必须人工演练：

1. run 正常完成；
2. 算子抛异常；
3. 容器 OOM；
4. run 超时；
5. 用户 cancel；
6. DockerBackend 进程重启；
7. DJ MCP 重启；
8. Docker Desktop 重启；
9. 模型 hash 错误；
10. 输出目录不可写；
11. 宿主剩余磁盘不足；
12. builder 下载失败；
13. candidate image contract test 失败。

每项都应验证：状态不悬挂、共享 venv 未变化、其他 run 不受影响、可以回收。

## 18. 本机验证完成标准

只有同时满足以下条件，才进入独立 Linux worker：

1. 当前共享 venv 在全部测试后未增加或改变依赖；
2. Local/Docker backend contract tests 通过；
3. 输入、Plan、模型只读测试通过；
4. CPU/内存/pids/timeout/cancel 测试通过；
5. result、日志和 provenance 齐全；
6. 容器、work、tmp 和 secret 能按策略清理；
7. Docker Desktop/broker/MCP 重启后无永久 orphan；
8. tiny model 的 staging、校验、发布、只读复用通过；
9. H1 无模型缺失能力完成“Builder → 新 Runtime → 注册 → 复用”；
10. H-model 完成“新 Operator + 新 Runtime + G ModelArtifact → 离线 inference”；
11. H1/H-model 未审批候选均不能进入 build/run；
12. H-model 第二次请求复用同一 image ID 和 ModelArtifact hash；
13. 两次相同 Plan 使用同一 image/model hash 可重放；
14. DSH Web 在 worker 压力测试时仍可用。

## 19. 本机之后如何迁移

本机通过后：

1. 准备 Linux worker；
2. 部署 Docker Engine 和 execution broker；
3. 把本机 image 推送内部 registry并固定 digest；
4. 把 ModelArtifact 同步到 Linux ModelStore 并复核 hash；
5. 将 DockerBackend 从本机 Docker Engine 改为远程 broker；
6. 将 `D:\dsh-worker` 路径映射替换成 `/srv/dj-platform`；
7. Agent、Plan、RuntimeSpec、CapabilityDescriptor、RuntimeManifest 和 ModelArtifact 不变；
8. 在 Linux GPU worker 上另做 CUDA/GPU/SAM 3 验证。

## 20. 推荐执行顺序

```text
A. WSL2 + Docker Desktop
  ↓
B. D:\dsh-worker 目录和测试租户
  ↓
C. 最小 CPU runtime 镜像
  ↓
D. container_entry + 路径物化
  ↓
E. LocalProcessBackend seam
  ↓
F. DockerBackend + lifecycle
  ↓
G. tiny ModelStore
  ↓
H1. 无模型 demo：缺算子 → Builder → 新 Runtime → 注册 → 复用
  ↓
H2/H-model. tiny model-backed capability：新 Operator + 新 Runtime + G ModelArtifact → inference
  ↓
I. loopback execution broker
  ↓
完整隔离/故障/重启测试
  ↓
独立 Linux worker
```

不要调换为“先让 Agent 自动下载/安装，再补隔离”。正确顺序必须是先建立 runtime、builder、ModelStore 和 execution interface，再给 Agent 开放结构化的 proposal 能力。
