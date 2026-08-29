# Windows 本机 Docker Worker：阶段 A–D 接手记录

更新时间：2026-08-29

## 1. 文档用途

本文是阶段 A–D 完成后的事实型接手文档，回答三个问题：

1. 当前已经完成并实际验证了什么；
2. 实施过程中哪些地方不能靠猜；
3. 阶段 E 开始前需要修正原规划中的哪一项设计。

后续总体路线仍以
[`local-windows-docker-worker-validation.zh-CN.md`](./local-windows-docker-worker-validation.zh-CN.md)
为准。本文不重复与原规划一致的 E 以后内容；只有本文明确标为“替代原规划”的决定优先。

## 2. 当前结论

阶段 A、B、C、D 的本机验证范围已经完成，可以进入阶段 E。

当前已经具备：

- 可用的 WSL2、Ubuntu 24.04 和 Linux Docker Desktop backend；
- 受控的 `D:\dsh-worker` 数据根和约定目录；
- 可由源码和锁文件重建的非 root CPU runtime 镜像；
- 严格校验 `run-spec`、路径、挂载权限和 recipe hash 的容器入口；
- 在只读根文件系统、断网和资源限制下成功运行的无模型 Data-Juicer fixture；
- 结构化失败码、输出清单和可复核的文件 hash。

尚未实现的是阶段 E/F 的 `ExecutionBackend` seam、Docker 生命周期管理和 broker。当前成功的容器运行由人工等价命令完成，不应误写成“DockerBackend 已完成”。

## 3. 接手时的代码和制品位置

### 3.1 仓库

```text
规划与接手文档：D:\dsh-app
Data-Juicer 源码：D:\dj\data-juicer-1.5.4
受控 worker 根：D:\dsh-worker
源码基准 commit：3267db5de297664db4fa4e505e93a1d58d74c95f
```

Data-Juicer 工作树当前是 dirty worktree，里面同时存在用户先前修改和 A–D 修改。不要使用 `git reset --hard`、`git checkout --` 或按整个工作树回退。接手者只能按文件和 diff 分辨自己的修改。

### 3.2 当前镜像

```text
tag:      dj-plan-flow-cpu:local-v1
image ID: sha256:c8815bf653a3e4fe7946ce1bf1c5501a37949b44401dfe06914c77a30db76490
size:     404975678 bytes
user:     10001:10001
```

镜像 tag 是可变指针。阶段 C 的历史验收文件记录的是阶段 D 最终重建前的旧 image ID；当前运行和后续 provenance 必须以 `docker image inspect` 得到的 image ID 为准，不能从旧摘要或 tag 猜测。

### 3.3 验收制品

```text
D:\dsh-worker\build-results\dj-plan-flow-cpu-local-v1\
  image-inspect.json
  image-history.txt
  validation-summary.json

D:\dsh-worker\build-results\dj-plan-flow-container-entry-local-v1\
  validation-summary.json
```

最终成功 fixture：

```text
D:\dsh-worker\runs\run-d005
```

最终受控失败 fixture：

```text
D:\dsh-worker\runs\run-d004
```

## 4. 阶段完成情况

| 阶段 | 状态 | 已验证事实 | 尚未声称完成的内容 |
| --- | --- | --- | --- |
| A | 完成 | WSL 2.7.3；Ubuntu 24.04 与 `docker-desktop` 均为 WSL2；Docker client/server 29.7.2，Linux containers；Docker 可实际构建和运行镜像；资源上限为 4 CPU、16 GB 内存、8 GB swap | GPU、Kubernetes、独立 Linux worker |
| B | 完成当前阶段范围 | `D:\dsh-worker` 七个一级目录存在；ACL 仅 SYSTEM、Administrators 和当前用户拥有 FullControl；测试使用 `tenant_id=local-test`；所有 fixture 均位于受控根 | `allowed_worker_root` 的 broker 强制执行尚未存在，因为 broker/DockerBackend 属于后续阶段 |
| C | 完成 | 固定基础镜像 digest；`uv==0.12.5`；`uv sync --frozen`；core + tools；非 editable 安装；非 root；只读 rootfs、断网、drop capabilities、no-new-privileges 和 tmpfs smoke test 通过 | GPU/CUDA、通用视觉/音频依赖、生产镜像发布与 registry |
| D | 完成 | 严格 `run-spec`；容器路径物化；recipe hash；模型声明和只读挂载；输入/bundle 只读、output/work/tmp 可写；DJ 默认执行器；result manifest；稳定退出码；成功和失败 fixture | timeout/cancel、100 条记录、自定义算子、tiny model；这些继续按原规划逐步验证 |

### 4.1 阶段 A 的当前主机事实

当前 `.wslconfig`：

```ini
[wsl2]
memory=16GB
processors=4
swap=8GB
```

Docker Engine 当前报告 4 CPU、约 16 GB 内存，和 `.wslconfig` 一致。D 盘检查时约有 339 GB 可用空间。

### 4.2 阶段 B 的目录和权限

已存在：

```text
D:\dsh-worker\
├─ models
├─ model-downloads
├─ runs
├─ build-contexts
├─ build-results
├─ broker-state
└─ fixtures
```

根目录 ACL：

```text
NT AUTHORITY\SYSTEM       FullControl
BUILTIN\Administrators   FullControl
DESKTOP-RA4SAJA\hu       FullControl
```

这里的“完成”是目录与主机权限基线完成，不代表 RuntimeSpec 的逻辑 URI 已经由 broker 强制解析。阶段 E/F 不能因为目录已经存在，就跳过根路径校验。

### 4.3 阶段 C 的实现

新增文件：

```text
D:\dj\data-juicer-1.5.4\.dockerignore
D:\dj\data-juicer-1.5.4\docker\Dockerfile.plan-flow-cpu
D:\dj\data-juicer-1.5.4\docker\entrypoint.sh
```

最终 Dockerfile 的关键实现：

- 基础镜像使用显式 SHA-256 digest；
- 系统层只安装 CPU fixture 所需的最小运行库；
- 第三方锁定依赖和本地源码分层安装；
- 本地包同步使用 `--reinstall-package py-data-juicer`，避免复用旧本地 wheel；
- runtime home 和缓存都位于 `/tmp/djrun`，由 tmpfs 承载；
- 入口和进程均以 UID/GID `10001:10001` 运行。

### 4.4 阶段 D 的实现

主要入口：

```text
D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\container_entry.py
```

固定容器路径 contract：

```text
input   /workspace/input   只读
bundle  /run/bundle        只读
models  /models/<id>       只读
output  /workspace/output  可写
work    /run/work          可写
temp    /tmp               可写 tmpfs
```

稳定退出码：

```text
0   SUCCESS
10  INVALID_SPEC
11  RECIPE_HASH_MISMATCH
12  PATH_NOT_ALLOWED
13  MOUNT_POLICY_VIOLATION
20  EXECUTION_FAILED
21  RESULT_MANIFEST_FAILED
```

为保证“先校验、后加载重依赖”，还做了三项配套修正：

- `data_juicer.tools.plan_flow.PlanFlowService` 改为延迟导入；
- Ray executor exports 改为延迟导入；
- `free_models()` 不再为了清空未使用的 CUDA cache 而触发可选 Torch 安装。

最终 `run-d005` 在以下约束下成功：

```text
read-only rootfs
network none
cap-drop ALL
no-new-privileges
pids-limit 64
1 CPU
2 GiB memory + 2 GiB memory-swap
256 MiB noexec/nosuid/nodev tmpfs
```

结果：退出码 0，两个输出文件，共 62 字节。`result-manifest.json` 中的 hash 已用宿主重新计算并匹配。

`run-d004` 使用错误 recipe hash，最终镜像返回退出码 11，且 output/work 都没有文件，证明执行器没有在完整性校验失败后启动。

## 5. 不要猜的坑和实施经验

### 5.1 不要从 tag 或旧摘要猜当前镜像

每次源码重建都会让 `dj-plan-flow-cpu:local-v1` 指向新 image ID。启动前解析并持久化 image ID；重启恢复、审计和重放都不能只保存 tag 或容器名称。

### 5.2 不要假设 `uv sync` 会刷新本地源码 wheel

BuildKit/uv cache 曾让新镜像继续包含旧的 `container_entry`。本地项目安装层必须使用：

```text
--reinstall-package py-data-juicer
```

否则“Dockerfile 已 COPY 新源码”不等于“venv 中安装的是新源码”。重建后要从镜像内验证实际 import 的模块。

### 5.3 不要用文本视觉相同来判断 recipe hash

Windows 新建 fixture 时，CRLF/LF 差异会改变 SHA-256。`run-d005` 第一次就因此被正确拒绝为退出码 11。必须对最终落盘并实际挂载的字节计算 hash，不能复制另一个看起来相同的 YAML 的 hash。

### 5.4 只读 rootfs 下不能沿用普通用户 home

第三方库会写 home、Hugging Face cache 或 XDG cache。最初使用 `/home/djrun` 会在只读根文件系统上失败。当前约定是：

```text
HOME=/tmp/djrun
XDG_CACHE_HOME=/tmp/djrun/.cache
HF_HOME=/tmp/djrun/huggingface
```

entrypoint 在 `/tmp` tmpfs 中创建这些目录。不要改回镜像层中的可写 home，也不要为了通过测试去掉 `--read-only`。

### 5.5 Python import 可能触发可选依赖安装

本仓库的 `LazyLoader` 不只是延迟导入；某些访问会尝试安装缺失包。实际遇到过：

- 导入 executor package 时加载 Ray adapter；
- 模型清理路径触发 Torch；
- 扩大 `model_utils` 测试范围后尝试安装 Transformers、Diffusers、Ultralytics、FastText 和 KenLM。

因此：

1. 容器入口的 schema/hash/path/mount 校验必须发生在 Plan Flow 服务、operator registry 和可选 executor 导入之前；
2. 不要把“只运行测试”理解为不会改共享 venv；
3. 共享 venv 测试前后要使用同一规范化算法比较 `pip freeze`；
4. 最后运行 `pip check`；
5. 阶段 D 的窄回归测试不要替换成整个 `test_model_utils.py`。

阶段 D 收口时，误触发的可选包已清除，锁文件要求的 `huggingface-hub==0.36.0` 已恢复，`pip check` 通过。最终窄测试前后规范化 freeze hash 均为：

```text
4c032af9a779407bdccf204f4889ac12eb07d0314ee65701d0373517fcb634fb
```

规范化算法是 `SHA-256(UTF-8(sorted(pip freeze) 以 LF 连接))`。阶段 C 摘要中的旧 hash 没有记录生成算法，不能直接拿两个不同算法的 hash 判断环境是否变化。

### 5.6 不要把宿主路径交给容器入口自行解释

入口只接受固定容器路径和已声明的模型路径。Windows 盘符、UNC、相对路径、`..`、未声明模型目录和越界输出都必须拒绝。宿主绝对路径的解析应属于后续 broker/Docker Adapter，而不是 `container_entry`。

### 5.7 不要用目录是否存在代替挂载权限验证

输入、bundle 和模型“能读”不等于“只读”。入口通过 `/proc/self/mountinfo` 验证实际 mount options；output、work、tmp 则必须实际可写。后端 contract test 也要覆盖挂载方向错误。

### 5.8 不要把 PowerShell 命令进程码当成容器退出码

在 PowerShell 中，如果 `docker run` 后又执行 `Write-Output`，外层 shell 最终可能显示退出码 0。必须立即保存 `$LASTEXITCODE`，并把保存值作为运行结果。失败 fixture 的真实容器退出码是 11。

### 5.9 不要过早删除失败运行目录

`run-d001`、`run-d002` 保留了旧 wheel、只读 home、可选依赖等问题的诊断现场；`run-d003` 是较早成功样例；`run-d004` 是受控失败；`run-d005` 是最终成功样例。后续 cleanup 策略实现前，不要把手工 fixture 当作无用临时目录批量删除。

### 5.10 日志不是结果真相

Data-Juicer 会打印很大的配置表和进度日志，并带有当前仓库已有的正则转义和 Pydantic warnings。判断成功应同时检查：

- 容器退出码；
- `result-manifest.json`；
- 输出文件数量、大小和 SHA-256；
- Docker inspect 中的 OOM/状态信息。

日志用于诊断，不应替代结构化状态和清单。

## 6. 阶段 E 前置设计决定：通用 RunHandle 不暴露 Docker 字段

### 6.1 决定

采纳“不要让通用 `RunHandle` 天然成为 Docker Handle”的建议，并进一步约束 `backend_ref` 为后端生成的不透明字符串。

本文替代原规划 **E4 RunHandle** 的 JSON 示例。阶段 E 应采用类似以下通用信封：

```python
@dataclass(frozen=True)
class RunHandle:
    backend: BackendKind
    run_id: str
    created_at: datetime
    deadline: datetime | None
    backend_ref: str
```

字段语义：

- `run_id`：业务运行身份，对调用方稳定；
- `backend`：把句柄路由回创建它的 Adapter；
- `backend_ref`：由 Adapter 生成、只由同一 Adapter 解释的操作身份；
- `created_at`、`deadline`：UTC 时间，供通用生命周期逻辑使用。

不要把 `backend_ref` 定义成上层可以读取的 `dict[str, Any]`。否则只是把 `container_id` 从顶层挪进了一个无类型字典，泄漏仍然存在。

### 6.2 后端私有状态

每个 Adapter 维护自己的可序列化状态记录：

```text
LocalProcessBackend
  backend_ref → pid + process_create_time + process metadata

DockerBackend
  backend_ref → container_id + image_id + Docker lifecycle metadata

未来 KubernetesBackend
  backend_ref → namespace + pod_uid + Kubernetes lifecycle metadata
```

这些记录属于 Adapter 的实现，不是 `RunHandle` 的 interface。上层只能把完整 `RunHandle` 交回 `inspect/cancel/collect/cleanup`，不能根据 backend 分支读取 PID、container ID 或 pod UID。

### 6.3 当前代码迁移要求

当前 `PlanRunner.start()` 直接调用 `subprocess.Popen()`，并把以下字段写入通用 `run.json`：

```text
pid
pid_create_time
```

阶段 E 迁移时，这两个字段必须移入 `LocalProcessBackend` 私有状态；不要保留在通用 run state 中再额外复制一份 `RunHandle`。

同理，Docker Adapter 后续产生的：

```text
container_id
image_id
```

不能进入通用 `RunHandle`。`image_id` 仍然必须出现在不可变的运行 provenance/审计结果中，但这是 collect 后的事实记录，不是上层控制 Docker 所需的句柄字段。

### 6.4 阶段 E contract test 必须新增的约束

除原规划的 backend contract test 外，至少验证：

1. `PlanRunner` 不直接导入或调用 `subprocess`、Docker client；
2. 通用 `RunHandle` 没有 `pid`、`container_id`、`image_id`、`pod_uid`；
3. `backend_ref` 由 Adapter 创建，拒绝调用方伪造或跨 backend 使用；
4. Local 和 Docker Adapter 都能仅凭自身私有记录完成 inspect/cancel/collect/cleanup；
5. backend 私有记录丢失时返回稳定的 `RUNNER_LOST`，而不是让上层猜进程或容器；
6. fake backend 可以使用任意不透明 ref 通过同一 contract，证明上层没有依赖 ref 格式；
7. handle 的持久化格式有 schema version，时间统一为 UTC。

### 6.5 为什么选择此方案

阶段 E 已经存在两个真实 Adapter：LocalProcess 和 Docker，因此这个 seam 不是假设性的抽象。通用信封保持 interface 小；进程、Docker 和未来 Kubernetes 的恢复复杂度留在各自实现内。删除该 seam 时，这些分支复杂度会重新扩散到 `PlanRunner`，说明该模块具有实际深度和维护价值。

## 7. 接手后的第一步

按原规划进入阶段 E，但先以本文件第 6 节替代原 E4：

1. 为 `RuntimeSpec`、通用 `RunHandle`、`RunStatus`、`RunResult` 定义稳定 interface；
2. 将现有 Popen 和 PID 身份校验完整移入 `LocalProcessBackend`；
3. 用 fake backend 和 LocalProcess Adapter 建立 contract test；
4. 确认通用层没有 backend-specific 字段后，再开始 Docker Adapter。

除此之外，后续顺序和安全要求继续遵循原规划，不在本文重复。
