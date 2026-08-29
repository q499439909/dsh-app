# 当前 Windows 主机：Docker Worker 本机验证完整方案

更新时间：2026-08-29

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

## 13. 阶段 H：缺失能力自动部署演练

### H1. 先用安全 demo capability

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

### H2. 演练流程

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

验收：

- 共享 venv 的 `pip freeze` 前后不变；
- 基础镜像 ID 不变；
- 派生镜像有独立 ID；
- 构建失败不会影响现有 run；
- 未批准 proposal 不能运行；
- 第二次同样依赖得到相同环境 hash 或复用既有 digest。

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

## 15. 完整测试矩阵

### 15.1 构建

- lock 不一致时构建失败；
- DJ import 成功；
- MCP/plan-flow import 成功；
- 非 root 用户；
- 镜像不包含 `dj-plan-flow.env`、API key、用户数据；
- image inspect 能得到固定 ID。

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

### 15.3 进程和资源

- CPU 限制可观察；
- 内存超限映射为 `RUN_OOM`；
- pids limit 阻止无限 fork；
- timeout 能终止子进程；
- cancel 幂等；
- DockerBackend 重启可恢复 inspect；
- broker 重启可发现 orphan。

### 15.4 网络和 Secret

- 默认 DNS/HTTP 访问失败；
- 未声明 secret 不存在；
- secret 不进入 Plan、image history、stdout/stderr；
- 测试任务结束 secret mount 消失；
- 只有明确 API capability 才能申请受控网络，此项可留到 Linux worker 阶段。

### 15.5 ModelStore

- hash 正确才能发布；
- hash 错误保持 staging 状态；
- 部分下载不会出现在正式目录；
- 两个 run 可并发只读；
- run 不能投毒模型；
- 模型与容器生命周期独立。

### 15.6 业务等价

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
9. demo 缺失能力能构建派生镜像并复用；
10. 未审批候选不能进入 run；
11. 两次相同 Plan 使用同一 image/model hash 可重放；
12. DSH Web 在 worker 压力测试时仍可用。

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
H. demo 缺失能力自动构建
  ↓
I. loopback execution broker
  ↓
完整隔离/故障/重启测试
  ↓
独立 Linux worker
```

不要调换为“先让 Agent 自动下载/安装，再补隔离”。正确顺序必须是先建立 runtime、builder、ModelStore 和 execution interface，再给 Agent 开放结构化的 proposal 能力。
