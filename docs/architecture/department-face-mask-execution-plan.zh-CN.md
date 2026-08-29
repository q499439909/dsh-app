# 部门级人脸 Mask 数据任务：隔离执行与能力扩展方案

## 1. 决策摘要

当前 `D:\dsh-app` 的 DSH Web 与 `D:\dj\data-juicer-1.5.4` 的 plan-flow MCP 继续作为控制面；不要再向 `D:\dj\.envs\dsh-dj` 安装 SAM、InsightFace 或任务临时依赖。新增独立的执行模块，把已审批 Plan 交给 Docker 容器运行。

第一阶段使用一台 Linux Docker worker，不上 Kubernetes。一个 DJ run 对应一个容器，设置 CPU、内存、临时磁盘、超时和网络策略。任务结束删除容器可写层，持久保留 Plan、日志、报告和输出；模型权重存入独立模型缓存并按 revision 复用。

第一条能力先建设为经过人工验证的 `face-mask-v1` 运行时，而不是立即允许 Agent 任意安装依赖。待运行时构建、预览、审批、缓存和回收链路稳定后，再开放“Agent 发现候选能力并自动构建候选镜像”。

## 2. 当前环境结论

- Windows 主机约有 32 GiB 内存、8 个逻辑 CPU；D 盘当前有约 317 GiB 空闲空间。
- 当前 DJ 环境为 Python 3.12，PyTorch 是 CPU build，`torch.cuda.is_available()` 为 false。
- 当前找不到 Docker CLI，WSL2 Linux 发行版也没有就绪。
- 当前 plan-flow 的 `PlanRunner.start()` 直接通过 `subprocess.Popen()` 启动共享宿主 Python worker。
- Data-Juicer 已支持通过 `custom_operator_paths` 动态加载外部算子；算子可以声明 `_requirements`，Ray executor 还具备按算子生成/合并 `runtime_env` 的能力。但这些能力不能替代整个任务的主机隔离、租户授权、资源配额和可回收生命周期。

因此，当前 Windows 机器适合作为开发/控制面和小样本 CPU 验证环境，不适合作为部门级 SAM 3 本地推理 worker。开发阶段可以安装 Docker Desktop + WSL2；正式多人使用应准备 Linux Docker worker。是否配 GPU 由分割模型基准决定，隔离方案本身不依赖 GPU。

就当前候选模型而言，SAM 3 官方推荐环境是 Python 3.12+、PyTorch 2.7+、CUDA 12.6+ GPU，checkpoint 还是需要申请访问和认证的门控资源。因此当前 CPU-only Windows 环境不能作为 SAM 3 正式运行时。`buffalo_l` 可以通过 ONNX Runtime 使用 CPU，但 InsightFace 官方代码的 MIT 许可不等于预训练模型权重许可；官方对预训练模型声明了非商业研究限制，并为 `buffalo_l` 提供另行授权联系入口。部门内部用途必须在使用前完成许可审阅。

## 3. 人脸 Mask 任务定义

在不考虑上游检索时，输入应为图片 manifest，而不是让执行容器自由扫描数据库。每条记录至少包含：

```json
{
  "sample_id": "...",
  "image_path": "...",
  "source_width": 1920,
  "source_height": 1080
}
```

正式运行前必须把“人脸区域”定义清楚，例如：

- 仅面部皮肤；
- 面部皮肤加耳朵；
- 整个头部（含头发）；
- 是否包含脖子；
- 遮挡物、眼镜、口罩如何处理。

这个定义决定应该采用提示式通用分割、face parsing，还是二者组合。模型名称不能替代 mask 语义规格。

建议流水线如下：

1. **单人/单脸验证与几何记录**：检测所有人脸，按规则保留恰好一个有效主脸的图片；保存 bbox、关键点、检测置信度和坐标变换。
2. **身份嵌入与去重**：对对齐后的人脸生成 embedding；按经标注集校准的阈值聚类或近重复过滤。embedding 只用于去重，不自动当作真实身份标签。
3. **分割**：用扩边后的 bbox/crop 为分割模型提供提示；保存 crop 到原图的可逆变换；输出概率、crop mask 和还原到原图尺寸的 mask。
4. **质量门禁**：检查 mask 面积、连通域、与 bbox/关键点的一致性、边界截断、空洞、置信度及异常比例。模型判定与确定性规则分开记录。
5. **多样性度量与采样**：在去重和质量过滤之后，按身份簇、脸部相对面积和脸部区域亮度分桶，再按目标配额抽样。
6. **人工抽检**：按 `身份簇 × 大小桶 × 亮度桶` 分层抽检，而不是只随机查看整体样本。

大小建议用 `face_bbox_area / image_area` 或归一化眼间距度量；暗/正常建议在脸部 ROI（最好是初步 mask）上计算亮度，而不是使用整张图片平均亮度。小/中/大与暗/正常的阈值应由数据分布和验收集确定，不能由 Agent 静默拍脑袋设定。

## 4. 运行时分层

### 4.1 控制面

DSH Agent 负责需求澄清、能力发现、Plan 编制和解释；DJ MCP 负责 Plan 校验、版本、审批、运行状态和报告。控制面不导入 SAM/InsightFace 的重依赖，也不直接执行 `pip install`。

### 4.2 Runtime Resolver

新增一个深模块，把 Plan 转换为可执行但与 Docker/Kubernetes 无关的 `RuntimeSpec`：

```python
@dataclass(frozen=True)
class RuntimeSpec:
    image_digest: str
    command: list[str]
    mounts: list[MountSpec]
    model_mounts: list[ModelMount]
    secret_refs: list[str]
    cpu: float
    memory_gib: float
    ephemeral_storage_gib: float
    timeout_seconds: int
    network_policy: str
    gpu_count: int = 0
```

Resolver 只能从已审批的内部 capability catalog 选择镜像和模型；未知能力返回 `CAPABILITY_MISSING` 或创建候选构建请求，不能直接修改 MCP 的 Python 环境。

### 4.3 Execution Backend

在 `data_juicer/tools/plan_flow/runner.py` 当前 `subprocess.Popen()` 的 seam 引入：

```python
class ExecutionBackend:
    def start(self, spec: RuntimeSpec) -> RunHandle: ...
    def inspect(self, handle: RunHandle) -> RunStatus: ...
    def cancel(self, handle: RunHandle) -> None: ...
    def cleanup(self, handle: RunHandle) -> None: ...
```

实现两个 Adapter：

- `LocalProcessBackend`：保留当前行为，只允许单机开发；
- `DockerBackend`：正式运行使用，记录 container ID，负责 stop/kill/remove。

未来确有多机调度需求时再增加 `KubernetesJobBackend`，Plan 和 RuntimeSpec 不变。

### 4.4 Build Backend

运行容器与构建容器必须分开：

- builder 可以访问受控的包仓库、官方源码和模型源；
- builder 不挂载用户数据，不拥有业务密钥；
- builder 根据锁定版本、源码 commit、模型 revision 和自定义算子 artifact 计算环境 hash；
- 构建成功后运行测试、生成 SBOM/依赖清单和许可记录，再推送内部镜像仓库；
- run container 只使用 image digest，不在运行时安装包。

## 5. `face-mask-v1` 的首个运行时

第一版优先构建一个专用且固定的运行时：

```text
dj-face-mask-runtime:v1
├─ 固定 commit 的 Data-Juicer
├─ 自定义 face detect/embedding mapper
├─ 自定义 prompted segmentation mapper
├─ mask quality filter
├─ diversity metadata mapper
├─ 固定版本的 Python/系统依赖
└─ 不内置业务数据和密钥
```

模型权重单独存放：

```text
model-cache/
├─ insightface/<model>/<revision-or-hash>/
└─ sam/<model>/<revision-or-hash>/
```

下载阶段缓存可写，正式 run 以只读方式挂载。每次运行的 `work`、`tmp` 和容器 rootfs 是临时的；输出、Plan、日志、报告和运行 provenance 持久化。

如果 InsightFace/ONNX 与 SAM/PyTorch 能在一个锁定环境中稳定共存，就先用一个镜像减少工程量。如果构建或升级验证显示依赖冲突，再拆为 `face-analysis-runtime` 和 `segmentation-runtime` 两个顺序 step；不要预先为假设冲突增加多容器编排复杂度。

## 6. Agent 自动发现和部署能力

“自动”应是受审批的供应链流程：

```text
需求 → 原子能力 → 内部目录搜索 → 官方候选搜索
     → CapabilityProposal → 人工批准构建
     → 隔离 builder → 安全/许可/兼容性检查
     → 小样本 preview → 质量验收
     → 发布到内部目录 → 正式 run
```

候选能力必须生成不可变记录：

```yaml
capability: face_prompted_segmentation
implementation: sam-family-adapter
source_repo: <official URL>
source_commit: <commit>
license: <detected and reviewed>
python_lock_hash: <hash>
image_digest: <digest>
models:
  - source: <official model source>
    revision: <revision>
    sha256: <hash>
resources:
  cpu: 4
  memory_gib: 16
  gpu_count: 0
network:
  build: allowlisted
  run: none
tests:
  contract: passed
  preview_dataset: <version>
  quality_report: <path>
```

Agent 可以自动完成搜索、生成代码、构建候选和跑 preview；首次引入新源码、新许可、新模型或扩大网络权限时必须审批。通过一次的能力进入内部目录，后续任务直接复用，不再重复搜索安装。

其中许可审批是阻断条件：Agent 不能代替组织接受 Hugging Face 门控模型条款，也不能把“部门内部使用”自动判断为符合 InsightFace 模型的“非商业研究”限制。模型制品记录应保存审批人、用途范围、许可版本、获取时间和允许部署的环境。

## 7. 多用户保护

- `workspace_root` 不能继续作为调用方可任意指定的授权依据；认证层应把 `user_id/workspace_id` 映射为服务端路径。
- builder 永远不挂载业务 workspace；run container 只挂载本任务输入（只读）和输出（读写）。
- MCP 不把 Docker socket 暴露给 Agent；使用窄接口 execution broker 校验镜像、挂载和资源上限。
- 容器使用非 root 用户、只读 rootfs、drop capabilities、pids limit、CPU/内存/临时盘/超时限制。
- 默认关闭网络；确需 API 模型时只开放目标 endpoint，并按任务注入短期 credential。
- 人脸图片和 embedding 属于敏感数据；日志中不得写原图、embedding 或可复原的明文凭据，并配置访问审计和保留期限。

## 8. 资源与部署建议

### 开发机

当前 Windows 机器安装 Docker Desktop + WSL2 后，只做：

- 镜像构建和 contract test；
- 几十张图片的 CPU smoke test；
- 路径挂载、取消、超时和清理验证；
- 不承诺 SAM 3 的生产吞吐。

### 首个部门 worker

准备一台 Linux Docker worker。CPU、内存和 GPU 型号最终由 100/1000 张代表性图片的基准决定；在缺少基准前，不把某个显存数字写成硬性事实。初始可按以下队列设计：

- `cpu-small`：2 CPU / 4 GiB，元数据和轻量规则；
- `cpu-medium`：4 CPU / 8–16 GiB，人脸检测、embedding 和质量统计；
- `segmentation`：4–8 CPU / 16–32 GiB，GPU 为可选扩展资源；
- 每用户默认 1 个并发 run，系统总并发由 worker 容量决定。

如果暂时没有 GPU，仍可完成控制面、检测/embedding 和小样本分割验证，但生产分割应进入队列或调用独立 GPU inference worker，不能把 CPU 环境的偶然成功等同于可接受吞吐。

对于 SAM 3，正式 worker 应以官方推荐的 CUDA 软件栈作为候选基线；具体 GPU 型号、显存和 batch size 仍须通过代表性图片基准确认。模型权重由管理员完成门控访问和许可确认后进入内部模型库，任务容器不持有个人 Hugging Face token。

## 9. 实施顺序

### P0：固定能力、隔离宿主（建议先做）

1. 为 face mask 任务定义验收集和 mask 语义。
2. 编写四个自定义 DJ 算子及 contract test。
3. 构建固定 `dj-face-mask-runtime:v1`。
4. 增加 RuntimeSpec、ExecutionBackend、Local/Docker Adapter。
5. 增加 container ID 状态、cancel、timeout、cleanup 和 orphan reconciler。
6. 用 100/1000 张数据做质量、吞吐和资源基准。

### P1：部门多人使用

1. 增加用户认证与 workspace 授权映射。
2. 增加队列、并发、CPU/内存/磁盘配额。
3. 建立镜像仓库、模型缓存、审计和 TTL/LRU 回收。
4. Linux worker 投产；控制面与 worker 之间只传 RunSpec 和状态。

### P2：受控自动扩展

1. Capability catalog 与 CapabilityProposal。
2. 隔离 builder、依赖锁定、源码/model revision 固定。
3. 自动 contract test、preview 和质量报告。
4. 审批后发布新的 image digest。

### P3：需要多机时再上 Kubernetes

只有出现多台 worker、明显排队、节点资源差异、自动恢复和部门级配额需求时，才增加 Kubernetes Job Adapter；不要把 Kubernetes 作为当前隔离功能的前置条件。

## 10. 验收标准

- 新算子/模型安装不会改变 `D:\dj\.envs\dsh-dj`。
- 两个用户并发运行时，互相看不到 workspace、临时目录、模型私有缓存和 credential。
- 同一 Plan 记录 image digest、模型 revision/hash、自定义算子 artifact hash 和资源规格，可重放。
- 容器超时、取消、MCP 重启后均不会留下持续运行的孤儿任务。
- 任务失败不会删除输出证据和日志，但临时 rootfs/work/tmp 能按策略清理。
- 未审批的新依赖、源码、模型或网络权限不能进入正式运行。
- face mask 验收按各大小/亮度分桶分别报告，不只报告总体平均质量。
