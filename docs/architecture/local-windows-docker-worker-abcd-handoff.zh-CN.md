# Windows 本机 Docker Worker：阶段 A–I 接手记录

更新时间：2026-08-30

## 1. 文档用途

本文是阶段 A–I 完成后的事实型接手文档，回答三个问题：

1. 当前已经完成并实际验证了什么；
2. 实施过程中哪些地方不能靠猜；
3. 原规划中哪些设计已被实施事实修正或收窄。

后续总体路线仍以
[`local-windows-docker-worker-validation.zh-CN.md`](./local-windows-docker-worker-validation.zh-CN.md)
为准。本文不重复与原规划一致的后续内容；只有本文明确标为“替代原规划”的决定优先。

## 2. 当前结论

阶段 A、B、C、D、E、F、G、H 以及 I 的 loopback execution broker 演练已经完成。完整隔离与故障矩阵已经开始执行，其中 orphan 对账、资源/断网、真实 OOM/deadline、主动文件与模型篡改、未声明 Secret 隔离以及 Local/Docker 成功路径业务等价均已验证；下一步只继续尚未覆盖的 Secret 注入生命周期和业务失败语义等项目。

当前已经具备：

- 可用的 WSL2、Ubuntu 24.04 和 Linux Docker Desktop backend；
- 受控的 `D:\dsh-worker` 数据根和约定目录；
- 可由源码和锁文件重建的非 root CPU runtime 镜像；
- 严格校验 `run-spec`、路径、挂载权限和 recipe hash 的容器入口；
- 在只读根文件系统、断网和资源限制下成功运行的无模型 Data-Juicer fixture；
- 结构化失败码、输出清单和可复核的文件 hash。
- 通用 `ExecutionBackend` seam 和不泄漏 PID/Docker 字段的 `RunHandle`；
- 已从 `PlanRunner` 移出的 `LocalProcessBackend` 进程生命周期实现。
- 使用安全 argv 调用 Docker、固定安全参数和受控 staging 的 `DockerBackend`；
- Docker 私有状态、deadline/cancel/OOM/丢失映射、结果完整性复核、运行 provenance 和差异化 cleanup；
- 真实 Docker Desktop 端到端执行、Adapter 重建后恢复和容器清理验证。
- 严格 ModelManifest、受控 staging、原子发布、逐文件与聚合 hash 复核的本机 ModelStore；
- `model-store://` 逻辑 URI、Docker 只读模型挂载和模型 provenance；
- 两个真实容器并发读同一模型、容器内修改失败、容器删除后模型仍存在的验证。
- 审批门禁、不可变 proposal、离线派生镜像和本机 capability catalog；
- H1 无模型算子的“缺能力 → Builder → 注册 → 预览 → 复用”；
- H2 新算子、新 CPU Runtime 与阶段 G ModelArtifact 的断网推理闭环。
- 只监听数值 loopback、只接收批准计划引用的 Execution Broker；
- 固定本机 profile、capability/image allowlist、模型 hash 契约和 `local-cpu` 单并发门禁；
- HTTP 创建/查询/取消/清理、进程重启恢复和统一错误结构。
- 基于 managed/tenant labels、私有 backend state、allowlist image ID 和 profile limits 的 orphan 主动对账。

尚未完成的是完整测试矩阵中其余压力/故障注入项目和 Windows 自启动部署；当前 broker 是可直接运行的 loopback 进程，不是已注册的 Windows 服务。Docker Adapter 当前支持本地 dataset、默认 executor、已发布本机模型，以及由 Capability Builder 烘焙并由 bootstrap 预注册算子的派生 Runtime。recipe 直接传 `custom_operator_paths`、postprocess 和非默认 executor 仍会显式拒绝，不会静默降级。

## 3. 接手时的代码和制品位置

### 3.1 仓库

```text
规划与接手文档：D:\dsh-app
Data-Juicer 源码：D:\dj\data-juicer-1.5.4
受控 worker 根：D:\dsh-worker
当前检查 commit：e8994bc8e5419eee49b530984a8b5ee18336c760
```

Data-Juicer 工作树当前是 dirty worktree，里面同时存在用户先前修改和 A–F 修改。不要使用 `git reset --hard`、`git checkout --` 或按整个工作树回退。接手者只能按文件和 diff 分辨自己的修改。

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

D:\dsh-worker\build-results\dj-plan-flow-execution-backend-local-v1\
  validation-summary.json

D:\dsh-worker\build-results\dj-plan-flow-docker-backend-local-v1\
  validation-summary.json

D:\dsh-worker\build-results\dj-plan-flow-capability-h-local-v1\
  validation-summary.json

D:\dsh-worker\build-results\dj-plan-flow-broker-i-local-v1\
  pip-freeze.before.txt
  pip-freeze.after.txt
  validation-summary.json

D:\dsh-worker\build-results\dj-plan-flow-model-store-local-v1\
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

阶段 F 最终真实 Adapter fixture（已删除容器和成功运行的 `work`，保留 bundle/input/output/logs/provenance）：

```text
D:\dsh-worker\runs\run-f-5130509f57c942a7891985bdeb13dda1
```

阶段 G 已发布模型与最终 Docker fixture：

```text
D:\dsh-worker\models\fixture-tiny-model-v1
D:\dsh-worker\runs\run-docker-71c062b515be41f59b42047e51792b57
```

## 4. 阶段完成情况

| 阶段 | 状态 | 已验证事实 | 尚未声称完成的内容 |
| --- | --- | --- | --- |
| A | 完成 | WSL 2.7.3；Ubuntu 24.04 与 `docker-desktop` 均为 WSL2；Docker client/server 29.7.2，Linux containers；Docker 可实际构建和运行镜像；资源上限为 4 CPU、16 GB 内存、8 GB swap | GPU、Kubernetes、独立 Linux worker |
| B | 完成当前阶段范围 | `D:\dsh-worker` 七个一级目录存在；ACL 仅 SYSTEM、Administrators 和当前用户拥有 FullControl；测试使用 `tenant_id=local-test`；所有 fixture 均位于受控根 | `allowed_worker_root` 的 broker 强制执行尚未存在，因为 broker/DockerBackend 属于后续阶段 |
| C | 完成 | 固定基础镜像 digest；`uv==0.12.5`；`uv sync --frozen`；core + tools；非 editable 安装；非 root；只读 rootfs、断网、drop capabilities、no-new-privileges 和 tmpfs smoke test 通过 | GPU/CUDA、通用视觉/音频依赖、生产镜像发布与 registry |
| D | 完成 | 严格 `run-spec`；容器路径物化；recipe hash；模型声明和只读挂载；输入/bundle 只读、output/work/tmp 可写；DJ 默认执行器；result manifest；稳定退出码；成功和失败 fixture | timeout/cancel、100 条记录、自定义算子、tiny model；这些继续按原规划逐步验证 |
| E | 完成 | 通用 execution interface；不透明 `backend_ref`；LocalProcess Adapter；PID 私有状态；PlanRunner 依赖注入；inspect/cancel/collect/cleanup；重启后恢复；`RUNNER_LOST`；contract tests | Docker Adapter 和容器生命周期属于阶段 F |
| F | 完成当前阶段范围 | Docker Adapter；镜像 tag 启动前解析为 image ID；安全 argv；固定 sandbox/resource 参数；受控 input/bundle/output/work；私有容器状态；restart recovery；deadline/cancel/OOM/exit/missing 映射；日志与结果收集；provenance；成功/失败 cleanup；真实 Docker 端到端 | broker orphan 对账、ModelStore、自定义算子、postprocess 和非默认 executor 按后续阶段实现 |
| G | 完成当前阶段范围 | Installer/Publisher 路径角色分离；严格 ModelManifest；逐文件和确定性 tree hash；许可状态；失败不暴露部分 artifact；同卷原子 rename；每次 resolve 复核；逻辑 URI；Docker 只读挂载；并发读取；修改拒绝；模型 provenance | OS 独立服务账号/ACL 属于部署加固；联网 downloader、公开模型、TTL/LRU/引用保护不在本阶段 tiny fixture 范围 |

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

### 5.11 不要让 Docker tag、container name 或调用方 handle 成为控制真相

阶段 F 启动时先用 `docker image inspect` 将 tag 解析成 `sha256:` image ID，再以该 ID 创建容器。容器 ID、image ID、名称和受控运行根只写入：

```text
<workspace>/.dj/execution/docker/<backend_ref>.json
```

`RunHandle` 仍只有通用字段。Adapter 重建后靠私有记录恢复；handle 的 `created_at/deadline` 还必须与私有 `RuntimeSpec` 一致，不能让伪造 handle 提前取消真实容器。

### 5.12 不要把“argv 安全”误解成“路径已经安全”

`subprocess.run(["docker", ...], shell=False)` 只消除了 shell 拼接问题，不会自动建立路径授权。阶段 F 还额外执行：

- dataset 必须真实存在于声明 workspace，路径链不能含符号链接；
- staging 和四个 bind source 必须位于 `D:\dsh-worker` 受控根；
- worker root 不能是盘符根，也不能含破坏 `--mount` CSV 语法的字符；
- export 必须位于本次 `RuntimeSpec.output_dir`；
- collect 再次拒绝绝对路径、`..`、symlink、越界目标和 hash/size 不匹配。

### 5.13 Docker logs 的 stderr 不等于业务失败

真实 fixture 的 Data-Juicer 配置、进度和 warning 主要出现在 Docker stderr，即使容器最终退出 0。阶段 F 按 Docker stdout/stderr 原样分别保存，但状态仍由 inspect 的退出码/OOM、result manifest 和文件完整性共同决定。

### 5.14 共享 venv 指纹必须带上计算时点和源码 identity

阶段 F 最终 `pip check` 通过，且 site-packages 没有本阶段测试时刻的新安装痕迹。当前规范化 freeze hash 是 `d1bfc3a4c4643576dbffdccf85723fba2cf84c800c05c9010f6a3551443477d7`，但它不能与阶段 E 的 `4c032...` 直接解释为“阶段 F 安装了包”：两次检查之间仓库 HEAD 和 editable VCS identity 已变化，且阶段 F 开始前没有重新记录同算法的 before 值。后续阶段必须在第一项可能导入项目代码的测试之前先取 before hash；没有 before 值时只能报告当前事实，不能猜差异来源。

### 5.15 不要用“目录已经复制完成”代替模型发布

正式 artifact 必须先在 `model-downloads/<request-id>` 完整落盘，再由 ModelStore 校验 manifest 字段、许可状态、文件清单、逐文件 hash、总大小和聚合 tree hash。Publisher 只把 manifest 声明的文件复制到：

```text
models/.publishing-<artifact-id>-<uuid>
```

复核副本后才在同一 `models` 文件系统内原子 rename。直接 copy 到 `models/<artifact-id>` 会让并发 run 看见半成品，不能采用。

### 5.16 聚合 hash 算法不能靠口头约定

阶段 G 将 artifact 聚合 hash 明确定义为：按规范化相对路径排序，对每个文件依次输入 `UTF-8(path) + NUL + file bytes + NUL` 后计算 SHA-256。最初手工 fixture 曾因命令行转义把预期聚合 hash 算错，Publisher 正确拒绝且正式模型目录没有出现。最终 manifest 中的聚合 hash是：

```text
sha256:46150d027b041df4093eb3c50ad740480005d0960218d35b28f37cc968eb87ce
```

这再次说明 hash 必须由与 Publisher 相同的实现对最终字节计算，不能从看起来等价的 shell 表达式猜。

### 5.17 模型正式目录存在不等于之后永远可信

同一 Windows 用户仍可在容器外改动文件，因此 `resolve()` 每次都重新验证完整 artifact，而不是只在 publish 时验证一次。run 侧的安全保证来自 Docker bind mount 的 `readonly`，不是宿主文件的只读属性。未来使用独立服务账号/ACL 可以继续加固，但当前文档不把模块接口的路径授权误写成 OS 级不可绕过隔离。

### 5.18 不要把宿主模型路径写进 Plan

Plan 只声明 artifact identity，并以：

```text
model-store://fixture-tiny-model-v1/weights.bin
```

引用文件。Docker Adapter 在确认 artifact 已发布且文件属于 manifest 后才物化成 `/models/<artifact-id>/<file>`。宿主 `D:\dsh-worker\models\...` 路径只出现在 ModelStore 和 Docker 私有状态，不能进入通用 handle 或可移植 Plan。

## 6. 阶段 E 已实施的设计决定：通用 RunHandle 不暴露 Docker 字段

### 6.1 决定

采纳“不要让通用 `RunHandle` 天然成为 Docker Handle”的建议，并进一步约束 `backend_ref` 为后端生成的不透明字符串。

本文替代原规划 **E4 RunHandle** 的 JSON 示例。阶段 E 已实现以下通用信封：

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

阶段 E 迁移前，`PlanRunner.start()` 直接调用 `subprocess.Popen()`，并把以下字段写入通用 `run.json`：

```text
pid
pid_create_time
```

阶段 E 已将这两个字段移入 `LocalProcessBackend` 私有状态，没有保留在通用 run state 中。

同理，Docker Adapter 后续产生的：

```text
container_id
image_id
```

不能进入通用 `RunHandle`。`image_id` 仍然必须出现在不可变的运行 provenance/审计结果中，但这是 collect 后的事实记录，不是上层控制 Docker 所需的句柄字段。

### 6.4 阶段 E contract test 已覆盖的约束

当前 contract tests 已验证：

1. `PlanRunner` 不直接导入或调用 `subprocess`、Docker client；
2. 通用 `RunHandle` 没有 `pid`、`container_id`、`image_id`、`pod_uid`；
3. `backend_ref` 由 Adapter 创建，拒绝调用方伪造或跨 backend 使用；
4. Local Adapter 能仅凭自身私有记录完成 inspect/cancel/collect/cleanup；
5. backend 私有记录丢失时返回稳定的 `RUNNER_LOST`，而不是让上层猜进程或容器；
6. fake backend 可以使用任意不透明 ref 通过同一 contract，证明上层没有依赖 ref 格式；
7. handle 的持久化格式有 schema version，时间统一为 UTC。

阶段 F 的 Docker Adapter 已通过同一 contract，并补充了容器重启恢复和 image provenance 测试。

### 6.5 为什么选择此方案

阶段 E 已有 LocalProcess Adapter 和独立 fake backend 通过同一 interface，证明 `PlanRunner` 不依赖进程身份格式；阶段 F 随后加入第二个生产 Adapter——Docker。选择在 E 先建立 seam，使阶段 F 能直接按 contract 实现 Docker，避免把 Docker 分支临时塞回 `PlanRunner`。通用信封保持 interface 小；进程、Docker 和未来 Kubernetes 的恢复复杂度留在各自实现内。

## 7. 阶段 E 实施结果

实现位置：

```text
data_juicer/tools/plan_flow/execution/spec.py
data_juicer/tools/plan_flow/execution/backend.py
data_juicer/tools/plan_flow/execution/local_process.py
data_juicer/tools/plan_flow/execution/local_worker.py
```

`PlanRunner` 现在接收注入的 backend，不再导入或调用 `subprocess`/`psutil`。Local Adapter 的私有状态位于：

```text
<workspace>/.dj/execution/local-process/<backend_ref>.json
```

最终窄回归结果为 45 passed、2 deselected；两项 operator catalog 测试因仓库 `LazyLoader` 会自动安装可选 Transformers 而有意跳过，它们在阶段 E 的 runner-only 变更前已经通过。测试前后共享 venv 的规范化 freeze hash 相同，`pip check` 通过，没有遗留 local worker。

阶段 E 的 handle 约束已在阶段 F 原样保持，没有为了 Docker 增加 backend-specific 公共字段。

## 8. 阶段 F 实施结果

实现位置：

```text
data_juicer/tools/plan_flow/execution/docker.py
data_juicer/tools/plan_flow/execution/spec.py
data_juicer/tools/plan_flow/runner.py
tests/tools/plan_flow/test_docker_backend.py
```

### 8.1 创建与隔离

Adapter 使用安全参数数组调用 Docker CLI，没有命令字符串或 shell 重定向。每次运行生成随机 `backend_ref` 和受控 staging 根，并固定使用：

```text
user 10001:10001
read-only rootfs
network none
cap-drop ALL
no-new-privileges
pids 256
2 CPU
8 GiB memory / memory-swap
1 GiB noexec,nosuid tmpfs
input + bundle readonly
output + work writable
```

这些是当前 `DockerResourceLimits` 默认值，可通过类型化配置收窄或调整；不能由计划内容提供任意 Docker 参数。

### 8.2 生命周期和恢复

已覆盖 created/running/exit 0/nonzero/OOM/deadline/cancel/missing 映射。cancel 先写 `cancellation_requested`，再 `docker stop --time <grace>`，失败时 `docker kill`。新建 `DockerBackend` 实例只使用通用 handle 和持久化私有记录，能继续 inspect/collect，证明恢复不依赖旧 Python 对象。

当前尚无 broker，因此规划中的全局 label 扫描/orphan 对账没有伪装成已完成；Adapter 已在容器写入 `dj.managed`、run、task、backend-ref labels，为后续 broker 对账提供稳定事实。

### 8.3 收集、provenance 与 cleanup

容器退出 0 后并不直接宣布成功。Adapter 会验证 result manifest identity、清单字段、相对路径、文件类型、size 和 SHA-256，再原子复制到业务 output。`RunResult.provenance` 是收集结果，不是控制 handle；`PlanRunner` 将其写入 run state，同时保存 `runtime-provenance.json`。

成功 cleanup 删除容器和受控 `work`，保留 input/bundle/output/logs/provenance；失败 cleanup 删除容器但保留 `work` 供诊断。cleanup 自身写 `cleanup.json`，然后删除 Adapter 私有状态。真实成功 fixture 已验证该策略，最终 `dj.managed=true` 容器数为 0。

### 8.4 验证结果与诚实边界

- Docker/entry/backend 窄回归：32 passed、1 integration skipped；
- 显式真实 Docker integration：1 passed；
- 较宽 Plan Flow 回归曾得到 53 passed、1 skipped，但包含已知会访问 operator catalog 的测试，因此不把它作为共享 venv 无副作用证明；
- Python compile、`git diff --check`、`pip check` 通过；
- Docker Desktop 29.7.2，真实运行固定 image ID `sha256:c8815bf653a3e4fe7946ce1bf1c5501a37949b44401dfe06914c77a30db76490`；
- 没有遗留 managed container。

阶段 F 收口时尚未实现模型、自定义算子或 postprocess；其中模型能力现已由下方阶段 G 补齐。自定义算子和 postprocess 仍保持显式 unsupported，不会静默跳过。

## 9. 阶段 G 实施结果

实现位置：

```text
data_juicer/tools/plan_flow/model_store.py
data_juicer/tools/plan_flow/validation.py
data_juicer/tools/plan_flow/execution/docker.py
tests/tools/plan_flow/test_model_store.py
tests/tools/plan_flow/test_docker_backend.py
```

### 9.1 ModelStore seam

阶段 G 使用两个窄模块表达不同角色：

```text
LocalModelInstaller.stage_local(request_id, source_dir)
  只接受 D:\dsh-worker\fixtures 下的源
  只写 D:\dsh-worker\model-downloads\<request-id>

LocalModelStore.publish(request_id)
LocalModelStore.resolve(artifact_id)
LocalModelStore.verify(artifact_id)
  只从 model-downloads 发布到 models
  resolve/verify 均重新执行完整性检查
```

这是当前单机进程内的路径能力分离，不等同于两个 Windows 服务账号。真实 run input 位于 workspace，Installer interface 会拒绝将其作为源；后续 broker/部署若需要抵抗同主机恶意代码，应再使用独立 principal 和 ACL。

### 9.2 Manifest 与发布状态

当前 manifest 为严格 schema，只接受 artifact/source/revision/hash/size/license/files；许可状态必须是 `approved` 或 `approved-for-test`。路径拒绝绝对路径、`..`、Windows ADS 冒号、反斜杠、大小写重复和 symlink。

已验证两类持久状态：

```text
model-downloads/<request-id>/_stage.json       status=staged
models/<artifact-id>/_publication.json         status=published
```

受控 hash mismatch fixture 在 staging 校验时失败，`models/<artifact-id>` 不存在，也没有遗留 `.publishing-*`。

### 9.3 Docker 接入

Plan 顶层使用：

```yaml
models:
  - artifact_id: fixture-tiny-model-v1
```

recipe 内的 `model-store://` URI 由 Adapter 解析。未声明 artifact、未列入 manifest 的文件、缺少 ModelStore、worker root 不一致都会在 `docker create` 前失败。通过后新增只读 bind mount，并将同一 artifact identity 写入 `run-spec.models`。最终 provenance 记录 artifact ID、source、revision、aggregate hash、size 和 license status，不记录宿主路径。

### 9.4 真实验收

最终 tiny fixture：

```text
artifact_id: fixture-tiny-model-v1
payload: weights.bin, 1076 bytes
file sha256: e3c0d1f24e4bc584015d8c0776330d57b19b0a06963c9f7946ceb894a64e6250
tree sha256: 46150d027b041df4093eb3c50ad740480005d0960218d35b28f37cc968eb87ce
license: approved-for-test
```

真实 Docker 验证包括：两个容器同时处于 running 并读取同一文件；容器内 `unlink` 返回只读文件系统错误；两个容器删除后 `LocalModelStore.verify()` 继续通过；另一次完整 `DockerBackend` run 成功，container entry 验证模型挂载只读，provenance 包含准确模型 manifest，cleanup 删除容器但不删除模型。

最终选定回归为 45 passed，包含三个显式 Docker integration；Ruff、Python compile、`git diff --check`、`pip check` 通过。最终回归前后规范化 freeze hash 均为 `b1576420911e2c336d677b4851c82f5439d54a5e3a8cd0181f77edebaf2f3a05`，基础镜像 ID 前后均为 `sha256:c8815bf653a3e4fe7946ce1bf1c5501a37949b44401dfe06914c77a30db76490`，没有遗留 managed/model-test 容器。

## 10. 阶段 H 实施结果

### 10.1 Capability Builder seam

实现位置：

```text
data_juicer/tools/plan_flow/capability.py
tests/tools/plan_flow/test_capability_builder.py
tests/fixtures/plan_flow/capabilities/h1/
tests/fixtures/plan_flow/capabilities/h2/
```

公开对象保持窄接口：`CapabilityBuilder.prepare/approve/publish` 和 `LocalCapabilityCatalog.resolve`。proposal 会把受控 source 与 wheelhouse 快照到 `D:\dsh-worker\broker-state\capability-proposals`，审批绑定精确 content hash；发布前再次核对快照、基础镜像 tag 当前指向的不可变 image ID，并在断网 build 中只安装本地 wheels。构建后先做 import/registry test，再原子登记 descriptor。

`CapabilityDescriptor` 显式固定 `source_hash`、`dependency_lock_hash`、`base_image_id`、派生 `backend_ref.image_id` 和 model refs。通用 `RunHandle` 没有增加 `container_id` 或 `image_id`；Docker identity 仍只存在 backend 私有记录或 capability 的 Docker-specific `backend_ref`。这落实了阶段 E 前的抽象决定，没有把 Docker 字段重新泄漏到通用 handle。

Builder 不接受 workspace/run input 作为 source，只接受 `D:\dsh-worker\fixtures\capabilities` 下的真实目录，拒绝 symlink。基础镜像同时保留可用于 Dockerfile `FROM` 的本地 ref 和审批绑定的 image ID：前者只负责本机解析，后者才是身份。不要把裸 `sha256:...` 直接写进 `FROM`；Docker 会把它当作 registry repository 解析。

### 10.2 H1：无模型 capability

基础镜像内已确认找不到 `dsh_demo_token`。H1 使用仓库 fixture 生成本地 wheel，新算子 `demo_text_signature_mapper` 只输出规范化文本的短 SHA-256 签名，不访问模型和网络。

最终发布事实：

```text
capability_id:       demo-text-signature-v2
content_hash:        sha256:ad578309a0a604cf3f8117fd8a3cdcaf3c7966a2eaca0c7c5a9406e0013c7f71
source_hash:         sha256:0653614d80ec09395f836fb33da06bbec8098eede10e3fdc16c6cb3880c9906b
dependency_lock:     sha256:10022f39728a0202a3b8434cdd1fa6d786b9ad4f88f35d5a71dfd6c312f79b6b
derived image ID:    sha256:87b81ce6a47536b31cb736b3d41b66cfd236ba2e39989b99831798808a188cba
base image ID:       sha256:c8815bf653a3e4fe7946ce1bf1c5501a37949b44401dfe06914c77a30db76490
model refs:          []
```

未审批 publish 返回 `CAPABILITY_APPROVAL_REQUIRED`，错误审批 hash 返回 `CAPABILITY_CONTENT_CHANGED`。真实 DockerBackend preview 输入 `Hello   Builder`，输出 `demo_signature=48572721987d9d63`。再次 publish 同一 proposal 直接返回 catalog descriptor，不执行第二次 build。

### 10.3 H2：Google BERT-Tiny ModelArtifact 与推理

只下载固定 revision `30b0a37ccaaa32f332884b96992754e246e48c5f` 的三个文件，没有下载 pickle 权重：

```text
artifact_id: google-bert-uncased-l2-h128-a2-r30b0a37
config.json:       382 bytes
model.safetensors: 17739144 bytes
vocab.txt:         231508 bytes
aggregate hash:    sha256:e962e2ee0f9a03d84d04461e30a0fdac2a8a3c53351eb325442b9808a3407b5c
license:           approved-for-test（Apache-2.0 evidence 见规划文档）
```

文件先进入 worker fixture，再严格走阶段 G 的 `LocalModelInstaller.stage_local → LocalModelStore.publish → resolve/verify`。最终模型仍在 `D:\dsh-worker\models\google-bert-uncased-l2-h128-a2-r30b0a37`，不在镜像 layer 中。

H2 wheelhouse 是 Linux CPython 3.12 的 CPU-only 离线集合，总计 230158869 bytes，核心版本为 `torch==2.8.0+cpu`、`transformers==4.57.1`、`tokenizers==0.22.2`、`safetensors==0.8.0`。这些包没有安装到共享 Windows venv。

最终发布事实：

```text
capability_id:       demo-bert-feature-v3
content_hash:        sha256:5d93c4226b1f2c7f2887d1403e01023e60f657c9bd5eb660a63f43f8ae11cfba
source_hash:         sha256:cb4a56152d96f747eadfcc83c7b8ae2af7a3d6c56fb265afdaabffac0eaf9cd9
dependency_lock:     sha256:a0ec9a243eed7caf51517b307ad0797b6570baf0e55748e4d165e1bfcc443e6b
derived image ID:    sha256:25da6864fdb67b7a85bc827300db7bb0784923d14ba53cb2b9b5df2eb05ece67
model artifact hash: sha256:e962e2ee0f9a03d84d04461e30a0fdac2a8a3c53351eb325442b9808a3407b5c
```

`demo_bert_feature_mapper` 使用本地目录、`local_files_only=True`、CPU、eval 和 inference mode。正式 preview provenance 明确记录 `read_only=true`、`network=none`、上述 image ID 与 ModelArtifact hash。固定输入两次输出完全一致：

```text
hidden_size: 128
token_count: 14
l2_norm: 10.088903
checksum_sha256: 3dcaf65ee0a160fe87efb609b862cba50852377cc7f18aee110208ae0e889b77
```

第二条不同输入得到 `69f34183038a47fdc2608f7b35eac0bf72d48029357cf9982a2c63c8bb03e6ad`，证明 fixture 没有返回常量。第二次请求复用同一 v3 image ID 和同一 ModelArtifact hash。成功 cleanup 后 managed container 数为 0，镜像内搜索不到 `model.safetensors`，ModelStore 再次 verify 通过。

### 10.4 实施中不能靠猜的坑

1. `FROM sha256:<local-image-id>` 不是可靠的 Dockerfile 写法；必须使用本地 ref，并在构建前 inspect、比对已审批的 image ID。
2. Transformers 需要模型目录。阶段 G 原先只支持 `model-store://artifact/file`；H 增加了明确的 `model-store://artifact` 根目录语义，仍只会物化到只读 `/models/<artifact>`。
3. Data-Juicer/jsonargparse 会把自定义算子构造函数中“没有默认值”的参数当成 CLI 必填项，可能在合并 YAML 时误报缺失。`model_path` 使用空默认值，并在算子初始化时自行做明确校验。
4. 已发布 capability 不原地覆盖。早期 H2 v1 暴露参数解析问题，descriptor schema 又在审计时补齐 model hash，因此最终有效版本是 v3；v1/v2 是不可变调试历史，不应被当成当前入口。
5. safetensors 与 pickle 权重不能混收。当前 artifact 清单只有 config/safetensors/vocab，任何额外文件都会被 G 的 inventory 校验拒绝。
6. “断网”必须同时存在于 build 和 run：Builder 使用本地 wheelhouse 且 `docker build --network=none`，正式容器使用 `--network none`，算子再设置 `local_files_only=True`。
7. H 开始摘要记录的规范化 freeze hash `48a665...` 无法用文档既定算法复现；当前同算法结果为 `db54d161...`。没有 H 时段内的 site-packages 写入痕迹，`pip check` 通过，且所有依赖均下载到 worker/tool cache，但不能据此伪称跨整个 H 的 freeze hash 已严格相等。后续阶段必须把 before/after 原始 freeze 文本一并落盘，不能只留摘要 hash。

### 10.5 回归与下一步

阶段 H 相关 Plan Flow 回归为 `67 passed, 3 skipped`；三个 skip 都是显式 opt-in Docker integration。该最终回归窗口前后的规范化 freeze hash 都是 `db54d161ab6f0e1f95c2cb0f66e89c3d7138db5abe5a21994499f2ab9f10b1ec`，`pip check` 通过；这只能证明该窗口不变，不能抹去 10.4 第 7 项的阶段起点审计缺口。Ruff 目标检查通过，基础镜像 ID 保持 `sha256:c881...76490`。H1/H2 的真实 Docker preview、重复推理、不同输入、模型未 bake、cleanup 后复核均已单独执行通过。

## 11. 阶段 I 实施结果

### 11.1 Broker interface 与深度

实现位置：

```text
data_juicer/tools/plan_flow/broker.py
data_juicer/tools/plan_flow/runner.py
data_juicer/tools/plan_flow/execution/docker.py
tests/tools/plan_flow/test_broker.py
```

HTTP interface 保持为四个动作：

```text
POST /v1/runs
GET  /v1/runs/{run-id}
POST /v1/runs/{run-id}:cancel
POST /v1/runs/{run-id}:cleanup
```

创建请求只允许 `task_id`、`plan_version`、`capability_id`、`profile`。调用者不能提交 container/image ID、mount、Docker 参数、shell/argv、tenant 或 run ID；额外字段统一返回 HTTP 422 与 `INVALID_REQUEST`。broker 从批准的 PlanStore bundle、capability catalog、ModelStore 和固定 profile 自行推导所有执行事实。

启动命令：

```powershell
D:\dj\.envs\dsh-dj\python.exe -m data_juicer.tools.plan_flow.broker `
  --workspace <absolute-workspace> `
  --worker-root D:\dsh-worker `
  --allow-capability <capability-id> `
  --tenant-id <tenant> `
  --host 127.0.0.1 `
  --port 8765
```

`serve_broker` 只接受数值 loopback IP；`0.0.0.0`、局域网地址和主机名都会在 Uvicorn 启动前被拒绝为 `BROKER_LOOPBACK_REQUIRED`。本阶段没有把 broker 注册为 Windows 服务，验收进程已停止，不残留监听端口。

### 11.2 身份、allowlist 与 profile

PlanRunner 的 `run_r001` 是 task-local ID，不能直接作为 broker 的全局 URL identity。broker 因此生成 `run_<32hex>` 的公开 ID，并在 `D:\dsh-worker\broker-state\runs` 持久映射到 task-local run；HTTP 永不返回通用 handle 或 Docker backend ref。这不是改变 `RunHandle`，而是在更高层增加全局路由 identity。

allowlist 存的是 capability ID；descriptor 必须是 Docker backend 且只包含不可变 `image_id`。正式 `DockerBackend` 再 inspect 该 ID，不接受请求端提供 tag。批准计划声明的 ModelArtifact 集合必须与 descriptor `model_refs` 完全一致，且 ModelStore 当前 aggregate hash 必须相同，否则在 backend start 前返回 `CAPABILITY_MODEL_MISMATCH`。

固定 profile 已落地：

```text
local-tiny: 1 CPU, 2 GiB, 64 pids, 256 MiB tmpfs, 300 s
local-cpu:  2 CPU, 8 GiB, 256 pids, 1 GiB tmpfs, 1800 s
```

profile timeout 被写进通用 RuntimeSpec/RunHandle deadline。`local-cpu` 在 `.start.lock` 内扫描持久 broker run 状态，进程重启后仍只允许一个 active run；请求端没有覆盖资源上限的字段。

### 11.3 生命周期与真实验收

cancel 通过 PlanRunner/ExecutionBackend seam 幂等执行；cleanup 只调用 backend 一次，在 broker record 与 run state 写入 `cleaned_at`，重复请求仍返回 `cleaned=true`。broker 响应只投影公开状态，不泄漏 container name/ID、image ID 或宿主路径。

真实验收使用 `127.0.0.1:18765`、tenant `local-i`、`demo-text-signature-v2` 与 `local-tiny`：

```text
public run ID: run_25d624f04f9c470fabb97889f6ef7494
plan hash: sha256:815748604fa9b783593d6f6c417dc142185b3c9c4543bb1c998e04de3691ea44
image ID: sha256:87b81ce6a47536b31cb736b3d41b66cfd236ba2e39989b99831798808a188cba
output signature: 1f1bc5ddc95edacf
```

夹带 `--privileged` 的请求得到 422/`INVALID_REQUEST`；合法请求在只读根、`network=none`、drop ALL capabilities 和 profile 资源限制下成功。停止并重新启动 broker 后，同一公开 run ID 仍查询为 succeeded；两次 cleanup 均成功，managed container 数为 0，输出保留。

阶段 I 当时验证的“重启恢复”依赖已落盘的 broker record、PlanRunner state 与 Docker private state。broker record 真正缺失的 orphan 主动对账现已在完整故障矩阵首批工作中实现，见第 12 节；两类恢复证据仍应分开描述。

### 11.4 回归、环境与经验

阶段 I 当时的 Plan Flow 回归为 `74 passed, 3 skipped`。orphan 对账落地后回归为 `77 passed, 3 skipped`；Ruff、compileall、diff check、`pip check` 通过。阶段 I 把完整 `pip freeze` 原文分别保存为 before/after，两文件 SHA-256 均为 `eaf49368038d6fd020c4527352982cc39e3e6c11919bdde8c1dfa604414f1903`，135 行逐行相同；规范化 hash 均为 `db54d161ab6f0e1f95c2cb0f66e89c3d7138db5abe5a21994499f2ab9f10b1ec`。基础镜像 ID 仍为 `sha256:c881...76490`。

不能靠猜的实现点：

1. task-local run ID 不是全局 broker ID；混用会导致不同 task 的 `run_r001` 冲突。
2. loopback 必须校验实际 bind address，不能只在文档里写“请使用 127.0.0.1”。
3. `local-cpu` 并发门禁必须持有跨进程文件锁并读取持久状态，内存计数在 broker 重启后会失效。
4. capability allowlist 不能只校验名字；还要固定 image ID 和 ModelArtifact hash。
5. cleanup 幂等状态属于 broker/run state，不能依赖 Docker 容器是否还存在来猜。
6. FastAPI 默认 422 结构不是稳定领域错误；HTTP adapter 必须转换为统一 `PlanFlowError` envelope。

## 12. 完整故障矩阵首批结果：orphan 对账

`ExecutionBroker.reconcile()` 与 broker app 启动过程现在会调用 backend-specific discovery。DockerBackend 只向上层返回 task、plan 和通用 `RunHandle`；`container_id`、`image_id` 仍保留在 Docker 私有状态中，没有重新泄漏进 broker API 或通用 handle。

接管必须同时满足：容器有 `dj.managed=true` 和相同 `dj.tenant-id` label；Docker 私有记录属于当前 workspace/tenant；不可变 image ID 对应 allowlisted capability；资源 limits 与唯一 profile 完全相同；容器 labels、RuntimeSpec、PlanRunner run state 和通用 handle 彼此一致；计划模型集合及 hash 仍满足 capability contract。多个 capability/profile 都能匹配时不猜，直接不接管。已有 broker 映射不会重复生成公开 ID。

真实 Docker tracer 刻意绕过 Broker，先由 PlanRunner + DockerBackend 启动 `demo-text-signature-v2`，制造“容器和 PlanRunner state 已存在、broker record 尚未写入”的崩溃窗口。随后新 Broker 成功接管：

```text
tenant:                    matrix-orphan
public run ID:              run_08e0cc2f92de4c948a0e1cc9908d742a
initial reconciled status:  running
terminal status:            succeeded
reconcile idempotent:       true
managed containers after:   0
```

机器可读证据保存在 `D:\dsh-worker\build-results\dj-plan-flow-orphan-reconcile-local-v1\validation-summary.json`。临时 workspace、broker 映射、测试 run staging 和容器均已清理。

本轮新发现且不能靠猜的坑：`docker ps --format {{.ID}}` 默认给 12 位短 ID，Docker 私有记录保存的是 64 位完整 ID，直接比较会静默漏掉所有真实 orphan。发现命令必须带 `--no-trunc`；该行为已有失败测试和真实 Docker tracer 双重锁定。异租户和未知镜像也有明确拒绝测试。

下一步继续原规划 15.1–15.7 中尚缺真实故障注入证据的项目，不重复已经通过的 A–I 与本节验收。

## 13. 完整故障矩阵第二批结果：资源与基础隔离

本批没有新增可由请求控制的资源字段，也没有为了测试开放任意 command。Broker 创建正常 `demo-text-signature-v2` run 后，直接从 Docker Desktop system boundary 读取容器实际 HostConfig；另用同一不可变 capability image 做最小 cgroup/isolation probe，避免把“create argv 看起来正确”写成运行时已生效。

Broker `local-tiny` 容器的实际事实为：

```text
user:              10001:10001
readonly rootfs:   true
network:           none
cap drop:          ALL
security opt:      no-new-privileges:true
CPU:               NanoCpus=1000000000
memory/swap:       2147483648 / 2147483648
pids:              64
/tmp:              rw,noexec,nosuid,size=268435456
input,bundle RW:   false,false
output,work RW:    true,true
```

容器内 probe 使用更小的 1 CPU、256 MiB、16 pids 测试 profile，以便低风险观察边界：

```text
cpu.max:                 100000 100000
memory.max:              268435456
pids.max/current:        16 / 16
children started:        15
next spawn:              EAGAIN (errno 11)
rootfs write:            EROFS (errno 30)
/tmp write:              succeeded
external 1.1.1.1:443:    ENETUNREACH (errno 101)
```

Broker 业务 run 最终为 succeeded，cleanup 后该租户 managed container 为 0。机器可读证据在 `D:\dsh-worker\build-results\dj-plan-flow-resource-isolation-local-v1\validation-summary.json`。现有 opt-in 真实 Docker 回归也已加入实际 HostConfig 断言；本轮启用全部真实 DockerBackend 测试得到 `12 passed`。

边界说明：本批证明 CPU/memory/pids cgroup 配额确实下发、pids 超限确实阻止创建进程，但没有把“memory.max 可见”冒充为 `RUN_OOM` 端到端映射；真实 OOM 和真实 deadline/子进程终止仍留给下一批。input/bundle 的只读属性已由实际 HostConfig 证明，本批没有在正常业务容器里主动篡改输入文件。

## 14. 完整故障矩阵第三批结果：OOM 与 deadline

为避免污染正式 capability，本批从已核对的基础镜像 ID 离线构建两个一次性 probe image。它们仍由正常 `PlanRunner → DockerBackend` seam 启动，使用 1 CPU、128 MiB、32 pids 和 1 秒 stop grace；请求端没有获得任意 command 或资源覆盖能力。验收后两个 probe image 均已删除。

```text
OOM probe:
  runner status:       failed
  error_code:          RUN_OOM
  exit_code:           137
  Docker OOMKilled:    true
  timed_out:           false

deadline probe（父进程 + sleep 子进程）:
  timeout:             2 seconds
  runner status:       failed
  error_code:          RUN_TIMED_OUT
  exit_code:           137
  Docker OOMKilled:    false
  timed_out:           true
  container PID after: 0
```

两次 cleanup 后 `matrix-failure` managed container 为 0；临时 workspace、build context、run staging 和 tags 均已清理。机器可读证据在 `D:\dsh-worker\build-results\dj-plan-flow-failure-injection-local-v1\validation-summary.json`。

不能靠猜的点：Dockerfile 的 `FROM sha256:<image-id>` 会被 BuildKit 当作 registry repository 名解析，并可能尝试联网，而不是自动引用本地 image ID。本次先 inspect `dj-plan-flow-cpu:local-v1` 必须仍等于固定基础 image ID，再以该本地 tag 作为 `FROM`，同时保持 `--pull=false --network=none`；不能因“写了 sha256”就假定构建是本地且不可变。

## 15. 完整故障矩阵第四批结果：主动篡改与业务等价

一次性 isolation probe 通过正常 PlanRunner/DockerBackend seam 运行，并引用已发布的 `fixture-tiny-model-v1`。容器不是只检查 mount flag，而是实际执行读、写和删除：

```text
input read:          succeeded
bundle read:         succeeded
model read:          succeeded
input write:         EROFS
bundle write:        EROFS
model write/delete:  EROFS / EROFS
rootfs write:        EROFS
output/work/tmp:     succeeded / succeeded / succeeded
host D:\dsh-worker:  not visible
host D:\dj:          not visible
```

宿主进程设置了 `MATRIX_UNDECLARED_SECRET=sentinel-must-not-enter-container`，容器环境中该值为 null，probe image history 也不包含哨兵。当前系统尚未实现正式 `secret_ref` 挂载，因此这只证明“未声明 secret 不会随宿主环境泄漏”，不能冒充 secret mount 创建/撤销生命周期已经完成。

ModelStore 在篡改前后 verify 得到相同 aggregate hash：`sha256:46150d027b041df4093eb3c50ad740480005d0960218d35b28f37cc968eb87ce`。probe image、容器、build context、workspace 和 run staging 已清理。

同一个批准 Plan 使用 `whitespace_normalization_mapper`，先后由 LocalProcessBackend 与 DockerBackend 执行。两边 content hash 相同、状态均为 succeeded，输出记录数均为 2，逐条 JSON 业务记录完全相同：

```json
[{"text":"hello   world"},{"text":"line with   spaces"}]
```

该成功路径已加入 opt-in 真实 Docker 集成测试。机器证据位于 `D:\dsh-worker\build-results\dj-plan-flow-files-equivalence-local-v1\validation-summary.json`。本批没有自定义 artifact，也没有构造同一失败 Plan 比较两 backend 的失败码，因此 15.7 的 artifact/error 语义项仍不写成完成。
