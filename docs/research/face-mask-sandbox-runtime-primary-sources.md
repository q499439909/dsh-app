# 人脸 Mask 流水线的模型与容器运行事实研究

更新时间：2026-08-29

本文只核对与下列场景直接相关的第一手资料：部门多人通过 DSH + Data-Juicer MCP 执行人脸检测、身份去重、人脸区域分割和质量过滤；运行时可能需要 InsightFace `buffalo_l`、Meta SAM 3，以及 Docker 或 Kubernetes。本文不替代完整架构设计，也不构成法律意见。

## 1. 先区分三个容易混淆的对象

| 对象 | 在本流水线中的例子 | 需要版本化的内容 |
|---|---|---|
| 算子（operator） | “检测单人脸”“计算 embedding 并去重”“按检测框分割人脸”“检查 mask 连通域” | 算子代码、参数 schema、输入输出约定、测试 |
| 模型（model / weights） | `buffalo_l` 中的检测和识别 ONNX 权重、`sam3.pt` | 模型 ID、revision/哈希、权重文件、模型许可证 |
| Python/系统依赖（runtime dependencies） | `insightface`、`onnxruntime[-gpu]`、PyTorch、CUDA、SAM 3 包、OpenCV | Python/系统包锁定版本、基础镜像、CUDA/驱动兼容范围 |

这三者不能用“安装一个算子”概括。算子可以调用本地模型，也可以调用远程推理服务；同一个算子可切换不同模型；模型权重也不等同于加载它的 Python 包。InsightFace 官方资料尤其明确区分了 MIT 许可的代码与另有使用限制的预训练模型权重（[InsightFace README](https://github.com/deepinsight/insightface/blob/master/README.md#license)）。

## 2. InsightFace / BUFFALO 的官方事实

### 2.1 `buffalo_l` 包含什么

InsightFace 官方 Model Zoo 将 `buffalo_l` 列为一个模型包，而不是单一“人脸检测模型”。它包含：

- RetinaFace-10GF 检测；
- ResNet50@WebFace600K 人脸识别 embedding；
- 2D 106 点和 3D 68 点对齐；
- 性别与年龄属性模型；
- 官方表中包大小为 326 MB。

来源：[InsightFace Model Zoo](https://github.com/deepinsight/insightface/blob/master/model_zoo/README.md)。官方 Server 指南进一步给出 `buffalo_l` 的核心文件组合为 `det_10g.onnx` 和 `w600k_r50.onnx`（[InsightFace Server User Guide](https://github.com/deepinsight/insightface/blob/master/server/docs/user-guide.md#11-models-and-model-licenses)）。

因此，当前需求可用其中的检测输出做“单人照片”过滤和人脸框定位，用识别 embedding 做身份近重复聚类/去重。embedding 去重阈值、聚类规则和“保留哪张”并不是 `buffalo_l` 自动给出的完整业务策略，仍属于流水线算子逻辑。

### 2.2 安装和 CPU/GPU 后端

InsightFace Python Library 从 0.2 起使用 ONNX Runtime；官方要求 CPU 推理安装 `onnxruntime`，GPU 推理安装 `onnxruntime-gpu`。从 0.3.3 起，初始化 `FaceAnalysis()` 可自动下载模型包（[InsightFace Python Library README](https://github.com/deepinsight/insightface/blob/master/python-package/README.md#install)）。

这说明 BUFFALO 可以有 CPU 运行版本，GPU 不是容器隔离的前提；GPU 只影响推理后端和吞吐量。但部门服务不宜让每个任务任意自动下载：官方现成 Server 已采用“镜像不包含模型，单独 model installer 下载并验证，正常启动可保持离线”的方式（[InsightFace Server README](https://github.com/deepinsight/insightface/blob/master/server/README.md#quick-start)）。这为“依赖镜像”和“模型缓存/制品”分离提供了直接先例。

### 2.3 许可约束是阻断性检查项

InsightFace 代码采用 MIT 许可，但官方明确称其提供的预训练模型（包括 Python 库自动下载和手工下载的模型）仅供非商业研究使用；2025-11-24 更新还专门要求 `buffalo_l` 等开源识别模型联系 `recognition-oss-pack@insightface.ai` 获取授权信息（[InsightFace README](https://github.com/deepinsight/insightface/blob/master/README.md#license)）。Server 的统一许可说明同样写明开源模型包只限非商业学术研究，商业许可需另行取得（[InsightFace Server LICENSING.md](https://github.com/deepinsight/insightface/blob/master/server/LICENSING.md)）。

事实性结论：

- “部门内部使用”不能自动推导为符合“非商业研究”；需要组织自行做用途和授权判断。
- Agent 可以发现候选模型和生成部署计划，但不应自行代表组织接受模型条款。
- 模型进入可用目录前应有许可审批记录，并固定模型包/revision；代码许可证通过不代表权重许可证通过。

InsightFace 官方 Server 的安装流程会在下载前展示许可，只有显式 `--accept-license` 才继续，并生成 `manifest.json` 与签名 `MODEL.LICENSE`，`models verify` 可检查包身份和许可（[Server User Guide](https://github.com/deepinsight/insightface/blob/master/server/docs/user-guide.md#11-models-and-model-licenses)）。这是可借鉴的审批和制品验证机制。

## 3. SAM 3 的官方事实

### 3.1 能力是否适合“人脸框到 mask”

SAM 3 是图像和视频的可提示分割模型，可接受文本或视觉提示（点、框、mask），并返回 masks、boxes 和 scores；官方仓库称模型有 848M 参数，示例明确展示图像 box prompt（[SAM 3 官方仓库 README](https://github.com/facebookresearch/sam3#basic-usage)）。Hugging Face 上的 Meta 官方模型卡也展示了单个/多个正负框提示，以及把输出 mask 后处理回原图尺寸（[facebook/sam3 model card](https://huggingface.co/facebook/sam3#single-bounding-box-prompt)）。

据此，对本流水线更可控的接法是：BUFFALO 先给出每张图的人脸框，SAM 3 以框作为视觉提示生成该实例 mask，再把 mask 映射到原图尺寸。SAM 3 是通用开放词汇/可提示分割模型，不是官方定义的“精确人脸皮肤/五官语义解析器”；所以“框提示的 mask 是否符合数据规范”必须通过有标注的小样本基准与后续质量检查验证，不能把模型分数直接等同于业务合格。

### 3.2 官方安装和模型获取约束

当前官方 README 的推荐环境为 Python 3.12+、PyTorch 2.7+、CUDA 12.6+ 的 CUDA GPU；示例安装还单独安装匹配 CUDA 的 PyTorch，并可选安装 `flash-attn-3` 等加速依赖（[SAM 3 Installation](https://github.com/facebookresearch/sam3#installation)）。官方代码的模型构建器会通过 Hugging Face Hub 下载 `facebook/sam3` 的 `sam3.pt`（[model_builder.py](https://github.com/facebookresearch/sam3/blob/main/sam3/model_builder.py)）。

模型权重是门控资源：官方 README 要求先在 SAM 3 Hugging Face 仓库申请 checkpoint 访问权限，获批后再认证下载；模型卡也显示必须同意共享联系信息才能访问（[SAM 3 README](https://github.com/facebookresearch/sam3#getting-started)，[官方模型卡](https://huggingface.co/facebook/sam3)）。

事实性结论：SAM 3 的官方推荐路线实质上是 GPU/CUDA runtime，且权重下载不能假定完全无人值守。部门平台需要由管理员预先完成条款审阅和凭据授权，再把固定 revision 的权重放入受控模型制品库；不应把个人 Hugging Face token 烘焙进任务镜像。

### 3.3 SAM 许可证

SAM 3 代码和权重统一纳入专用 SAM License，许可证授予有限的使用、复制、分发、修改和衍生作品权利，同时要求遵守适用法律（包含隐私与数据保护）、再分发时附同一协议，并包含贸易控制等条件（[SAM 3 LICENSE](https://github.com/facebookresearch/sam3/blob/main/LICENSE)）。它不是 InsightFace 的 MIT 代码许可，也不应仅凭包元数据中的 classifier 判断权重许可。

## 4. “坏 mask”与多样性筛选的边界

模型提供原始检测、embedding、mask 和置信分数；“小/中/大人脸”“暗/正常亮”“坏 mask”是数据产品规则，需要显式算子和可审计阈值。可操作但需由内部样本校准的规则包括：

- 单人约束：检测到且仅检测到一个满足阈值的人脸；
- 大小分桶：按人脸框面积占原图面积比例，或框短边像素分桶；
- 亮度分桶：在固定色彩空间计算全图或脸部区域亮度统计，明确暗/正常阈值；
- 身份去重：对归一化 embedding 计算相似度并聚类，再按清晰度、姿态、遮挡、亮度等保留代表样本；
- mask 质量：检测框与 mask 的覆盖关系、mask 面积比、连通域数量、是否异常触边、孔洞/碎片、模型分数，以及人工抽检；
- 输出一致性：保存原图尺寸二值 mask，并记录检测框、模型 ID/revision、阈值与失败原因。

以上是工程推导，不是 InsightFace 或 SAM 3 官方承诺的质量标准。尤其“分割坏”必须先建立内部合格/不合格标注集，否则 Agent 只能猜测阈值，无法证明数据质量。

## 5. Docker 官方事实

Docker 容器默认没有资源限制，可以使用宿主内核调度器允许的资源；Docker 提供 `--memory` 等内存限制和 `--cpus` CPU 限制。`--cpus=1.5` 表示容器最多使用 1.5 个 CPU 的计算份额（[Docker Resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)）。因此平台界面显示的“CPU / GiB”通常就是对容器 CPU 与内存资源上限的声明，和是否分配 GPU是不同维度。

Docker volume 的数据生命周期独立于容器：容器销毁时可写层会销毁，但挂载 volume 的数据可以继续存在；volume 也支持只读挂载。非持久临时状态可使用 `tmpfs`（[Docker Volumes](https://docs.docker.com/engine/storage/volumes/)）。这直接支持以下事实边界：

- DJ、算子和 Python 依赖可固化在不可变镜像中；
- 输入和模型制品可只读挂载；
- 输出挂载独立持久化；
- 任务容器结束后删除，并不会自动删除独立 volume；缓存和输出需要各自的保留/回收策略。

若用 bind mount 直接映射宿主目录，Docker 官方指出它默认可写，容器进程能够修改甚至删除宿主文件；输入挂载必须显式只读，并且控制面应只允许服务端授权后的精确路径（[Docker Bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)）。

容器并不自动解决模型许可、租户路径授权或任务排队；这些属于平台控制面，而不是容器镜像本身的能力。

## 6. Kubernetes 官方事实

Kubernetes Job 表示运行到完成后停止的一次性任务；Job 创建一个或多个 Pod，并可对失败执行进行重试。删除 Job 会清理其创建的 Pod。完成的 Job/Pod 默认通常仍会保留以便查看状态和日志，需用户删除或配置完成后 TTL；`activeDeadlineSeconds` 可终止超时任务（[Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)）。

Kubernetes 对容器可声明 CPU、内存和 ephemeral-storage 的 `requests` 与 `limits`；调度主要使用 request，Linux 容器运行时通常用 cgroups 实施 CPU/内存 limit（[Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)）。这比单机 Docker 多出的关键能力是集群调度和 Job 生命周期控制，不是另一种模型环境格式；两者都运行 OCI 容器镜像。

Init container 在主容器前依次运行并必须成功完成；它可以使用与主容器共享的 volume，但可使用不同镜像和不同文件系统/Secret 视图（[Kubernetes Init Containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/)）。因此它适合做受控的模型制品准备/校验，但下载步骤必须幂等，因为 init container 可能重试或重新执行。

PersistentVolume（PV）的生命周期独立于单个 Pod；PersistentVolumeClaim（PVC）是用户对容量和访问模式的存储请求，Pod 通过 PVC 挂载实际 PV（[Kubernetes Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)）。这可用于跨 Job 复用只读模型缓存或持久化输出，但租户隔离、访问模式和回收策略仍需明确配置。

## 7. 对“Agent 自动找到并部署模型”的事实性结论

1. **可以自动化发现与技术验证，不能跳过授权。** `buffalo_l` 预训练模型有非商业研究限制及单独授权入口；SAM 3 权重需门控批准和认证。Agent 应输出候选模型、来源、许可和依赖清单，在管理员批准后才允许进入模型制品库。
2. **不要把动态 `pip install` 写入共享 DJ 宿主环境。** InsightFace CPU/GPU 后端不同，SAM 3 又有独立 PyTorch/CUDA/可选加速依赖；把它们任意装入一个长期共享 Python 环境有真实的版本冲突和不可复现风险。
3. **模型与依赖应分开制品化。** 依赖固化为按 digest 使用的 runtime 镜像；权重按模型 ID + revision/hash 存入受控缓存并只读挂载。官方 InsightFace Server 已采用“镜像无模型、先安装验证模型、正常服务离线”的模式。
4. **当前用例至少需要两个能力 runtime 或服务边界。** BUFFALO 可用 CPU ONNX Runtime，也可用 GPU ONNX Runtime；SAM 3 官方推荐 CUDA GPU。它们可以在一个 Job 的不同 step/容器运行，或作为两个版本化推理服务，不要求污染 Data-Juicer 的基础环境。
5. **自动发现新算子应走构建与评测流程，而不是运行时直接执行互联网代码。** 新算子至少要固定源码 commit、锁依赖、构建独立镜像、扫描和测试输入输出，再登记成可调用能力；新模型还要保存模型卡、许可证、revision/hash 和审批记录。
6. **质量判断不能完全委托给模型自评分。** 需要内部标注样本、指标和人工抽检，才能确定去重阈值、大小/亮度分桶和坏 mask 拒绝规则。

## 8. 第一手来源索引

- [InsightFace 主仓库与许可证说明](https://github.com/deepinsight/insightface)
- [InsightFace Model Zoo / BUFFALO 组成](https://github.com/deepinsight/insightface/blob/master/model_zoo/README.md)
- [InsightFace Python Library / ONNX Runtime 安装](https://github.com/deepinsight/insightface/blob/master/python-package/README.md)
- [InsightFace Server 容器和模型安装](https://github.com/deepinsight/insightface/blob/master/server/README.md)
- [InsightFace Server 统一许可说明](https://github.com/deepinsight/insightface/blob/master/server/LICENSING.md)
- [SAM 3 官方仓库、安装和能力](https://github.com/facebookresearch/sam3)
- [SAM 3 官方模型卡与门控权重](https://huggingface.co/facebook/sam3)
- [SAM 3 专用许可证](https://github.com/facebookresearch/sam3/blob/main/LICENSE)
- [Docker 资源限制](https://docs.docker.com/engine/containers/resource_constraints/)
- [Docker Volume 生命周期](https://docs.docker.com/engine/storage/volumes/)
- [Kubernetes Job](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Kubernetes CPU/内存/临时存储资源](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Kubernetes Init Containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/)
- [Kubernetes Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
