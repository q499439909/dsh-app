# Windows 本机 Docker Worker：阶段 A–G 接手记录

更新时间：2026-08-30

## 1. 文档用途

本文是阶段 A–G 完成后的事实型接手文档，回答三个问题：

1. 当前已经完成并实际验证了什么；
2. 实施过程中哪些地方不能靠猜；
3. 原规划中哪些设计已被实施事实修正或收窄。

后续总体路线仍以
[`local-windows-docker-worker-validation.zh-CN.md`](./local-windows-docker-worker-validation.zh-CN.md)
为准。本文不重复与原规划一致的后续内容；只有本文明确标为“替代原规划”的决定优先。

## 2. 当前结论

阶段 A、B、C、D、E、F、G 的本机验证范围已经完成，可以进入阶段 H。

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

尚未实现的是阶段 H 自定义算子闭环和后续 broker/API。Docker Adapter 当前支持本地 dataset、默认 executor 和已发布本机模型；postprocess、自定义算子和非默认 executor 仍会显式拒绝，不会静默降级。

## 3. 接手时的代码和制品位置

### 3.1 仓库

```text
规划与接手文档：D:\dsh-app
Data-Juicer 源码：D:\dj\data-juicer-1.5.4
受控 worker 根：D:\dsh-worker
当前检查 commit：d56e53d22e9bc87d692002539c017d9d3946ae07
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

下一步可按原规划进入阶段 H。阶段 H 的 capability proposal、派生镜像和自定义算子内容与规划一致，此处不重复。
