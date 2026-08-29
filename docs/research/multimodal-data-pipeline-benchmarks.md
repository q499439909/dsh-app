# 图片/视频多模态数据处理管线：公开 Benchmark 与评测集调研

> 调研日期：2026-08-25。仅引用论文、官方项目页、官方仓库或官方数据卡。规模和许可只在一手来源明确时记录。

## 结论先行

与当前 Data-Juicer Plan-Flow 最相似、最值得借鉴的是 [DataComp](https://github.com/mlfoundations/datacomp)：固定模型、训练代码、超参数和算力预算，只允许参赛者改变数据筛选/混合策略，最后在 38 个下游测试集上比较效果。它说明“数据管线好不好”不能只看删了多少脏数据，而要同时看：

1. 管线内在质量：过滤器能否识别错配、低质量、不安全和重复样本；
2. 数据集级结果：保留率、分布、覆盖度、重复率、安全残留率是否达标；
3. 下游效用：同一训练配方下，清洗后的数据是否让模型表现更好，且成本是否合理。

图片侧已有较成熟的 DataComp。视频侧本次没有找到同等成熟、统一、可直接参赛的“Video DataComp”；公开工作通常把若干专项集组合起来：视频-文本对齐、感知/时序质量、安全、复制检测，再用固定的视频检索或生成模型训练协议检查下游效用。当前项目应采用这种组合式评测，而不是寻找一个包办所有问题的单一分数。

## 两类评测不要混淆

### A. 管线内在质量评测

这类数据集用于考察“评分器或过滤决策是否可信”。例如在 UnsafeBench 上测 NSFW/安全分类器的 F1，在 DISC21 上测近重复检测的 mAP，在 VideoComp 上测视频-文本打分器能否把正确描述排在扰动描述之前。

它们适合在部署或升级某个 DJ 算子/模型时运行，不应每次全量数据任务都完整重跑。

### B. 下游效用 Benchmark

这类 benchmark 回答“处理后的训练数据是否真的更有用”。做法是冻结模型、训练超参数、训练步数和评测集，只替换数据版本。DataComp 是图片-文本领域最标准的公开范式；视频侧可先复现 ReSpec 的固定视频检索协议，或建立项目自己的小算力固定训练配方。

## 推荐清单与优先级

优先级含义：P0 是当前系统应首先接入；P1 是专项增强；P2 是高算力或前沿研究路线。

高置信度 shortlist 如下，后文其余条目只作为专项备选：

| 目的 | 首选公开资源 | 它能回答什么 | 不能回答什么 |
|---|---|---|---|
| 图文数据筛选的最终效用 | DataComp；远期 DataComp-VLM | 同一训练预算下，哪版数据让模型更强 | 单条样本为什么脏 |
| 图像技术质量 | KonIQ-10k + SPAQ | IQA scorer 是否符合人类质量判断 | 图文是否对齐、数据是否有下游价值 |
| 视频技术质量 | KoNViD-1k + LSVQ | VQA scorer 对真实 UGC 的排序是否可靠 | caption 是否正确、视频是否安全 |
| 图文/文视频对齐 | SugarCrepe/Winoground + VideoComp | scorer 能否识别细粒度语义和时间错配 | 训练后模型是否整体更强 |
| 图片/视频安全 | UnsafeBench + SafeSora（研究许可约束） | 安全分类的逐类召回、误杀和鲁棒性 | 普通技术质量与美学 |
| 图片/视频近重复 | DISC21 + FIVR-200K | 编辑、重编码、场景重复能否找回 | 数据重复对模型收益的最终影响 |
| 生成视频多维质量 | VBench | 闪烁、平滑、动态、美学、成像与条件一致性 | 真实 UGC 的主观 MOS |
| 视频数据的下游理解效用 | Video-MME；低成本检索协议可用 ReSpec | 清洗后训练/微调的视频模型是否保留短中长视频理解能力 | 它不是数据质量过滤器，不能直接给样本定删留 |

### 1. 图文对齐与相关性

| 优先级 | Benchmark / 评测集 | 公开性、规模与任务 | 常用指标 | 对 Plan-Flow 的用途 |
|---|---|---|---|---|
| P0 | [SugarCrepe 官方仓库](https://github.com/RAIVNLab/sugar-crepe) / [NeurIPS 论文](https://proceedings.neurips.cc/paper_files/paper/2023/file/63461de0b4cb760fc498e85b18a7fe81-Paper-Datasets_and_Benchmarks.pdf) | 标注和评测代码公开，图像使用 COCO 2017 val。每题在正确 caption 与仅做细微组合变化的 hard negative 间选择，覆盖对象、属性、关系的替换、添加与交换。 | 二选一准确率；可按扰动类型分解 | 校准 `image-text similarity`/VLM 打分算子；不能只看普通 CLIP 均分，要检查对关系和词序错配的召回。 |
| P0 | [Winoground 官方数据](https://huggingface.co/datasets/facebook/winoground) / [CVPR 论文](https://openaccess.thecvf.com/content/CVPR2022/papers/Thrush_Winoground_Probing_Vision_and_Language_Models_for_Visio-Linguistic_Compositionality_CVPR_2022_paper.pdf) | 400 组人工构造的“两图两文”，两条 caption 用词相同、顺序和语义不同。公开数据入口可用；使用条件以数据卡为准。 | text score、image score、group score | 作为小而严格的回归集；升级 CLIP/VQA scorer 后必须保证 group score 不退化。 |
| P1 | [EqBen 官方仓库](https://github.com/Wangt-CN/EqBen) | 5 个子集，强调自然视频和合成引擎产生的“视觉最小变化”。全量原始数据约 100 GB；另有约 25K image-text pairs 的 10% 子集，标注与本地评测代码公开。仓库未明确给出数据集统一许可。 | Winoground 风格匹配/group score | 补足 SugarCrepe 主要改变文字的偏差，测试过滤器能否识别视觉侧的小变化。 |
| P1 | [CLIPScore 官方实现](https://github.com/jmhessel/clipscore) / [论文](https://arxiv.org/abs/2104.08718) | 不是固定评测集，而是无参考图文兼容性指标；官方代码 MIT。论文同时指出它在需要丰富外部语境的 caption 上较弱。 | CLIPScore、RefCLIPScore；与人工评分的相关性 | 可作为低成本管线特征，不应单独作为质量门禁；应先在 SugarCrepe/Winoground 上验证选用的 backbone 与阈值。 |

### 2. 图像技术质量与美学

| 优先级 | Benchmark / 评测集 | 公开性、规模与标注 | 常用指标 | 对 Plan-Flow 的用途 |
|---|---|---|---|---|
| P0 | [KonIQ-10k 官方数据库](https://database.mmsp-kn.de/koniq-10k-database.html) | 10,073 张自然失真图片，官方提供 5 GB 全尺寸图、分数与质量指示器；1,467 名众包标注者、约 120 万评分，提供 MOS。官方页可直接下载，但未在页面中明确统一许可。 | SRCC、PLCC、RMSE；高/低质量分类 F1 | 验证无参考 IQA 算子对真实模糊、噪声、曝光等问题的排序能力；用于确定过滤分位数，而非生搬 MOS 绝对阈值。 |
| P0 | [SPAQ 官方仓库](https://github.com/h4nwei/SPAQ) / [CVPR 论文](https://openaccess.thecvf.com/content_CVPR_2020/papers/Fang_Perceptual_Quality_Assessment_of_Smartphone_Photography_CVPR_2020_paper.pdf) | 11,125 张、来自 66 款手机；包含总体质量、亮度、色彩、对比度、噪声、锐度、场景和 EXIF。官方仓库提供下载，未明确数据集统一许可。 | MOS 的 SRCC/PLCC；各属性相关性 | 若目标数据含 UGC/手机图片，作为 KonIQ 的互补域；报告应分解 blur/noise/brightness，而非只给总质量分。 |
| P1 | [TAD66K 官方仓库](https://github.com/woshidandan/TANet-image-aesthetics-and-quality-assessment) / [IJCAI 论文](https://www.ijcai.org/proceedings/2022/0132.pdf) | 66K 图片、47 个主题，官方提供下载；每个主题独立标注，并提供主题相关美学标准。仓库未明确数据集统一许可。 | SRCC/PLCC、二分类准确率，按主题切片 | 校准美学过滤器，并检查是否因题材不同而误删；美学应作为软排序或配额采样特征，不宜一刀切。 |

补充说明：[AVA 原始论文](https://doi.org/10.1109/CVPR.2012.6247954) 是经典的大规模美学数据集，包含超过 250K 图片、1–10 分投票分布、60+ 语义类别和摄影风格标签；但原始图片依赖 DPChallenge，当前公开镜像完整性与再分发条件不统一，因此当前工程优先选择更易复现的 TAD66K。

### 3. 视频技术质量、美学与时序稳定性

| 优先级 | Benchmark / 评测集 | 公开性、规模与标注 | 常用指标 | 对 Plan-Flow 的用途 |
|---|---|---|---|---|
| P0 | [LSVQ 官方页面](https://www.colorado.edu/lab/live/live-fb-large-scale-social-video-quality-lsvq-database) / [官方代码与数据说明](https://github.com/baidut/PatchVQ) | 约 39K 个真实 UGC 视频，带主观质量分；官方页提供免费下载，并明确允许在保留版权声明和致谢条件下使用、修改与分发。 | SRCC、PLCC，常同时报告 LSVQ test 与 1080p 子集 | 验证 VQA 模型的总体技术质量排序；适合给全量数据生成质量分位数和低质候选队列。 |
| P0 | [KoNViD-1k 官方数据库](https://database.mmsp-kn.de/konvid-1k-database.html) | 1,200 个来自 YFCC100M 的 8 秒自然视频，含逐人 1–5 质量评分；约 2.3 GB，官方称对研究社区免费开放。 | SRCC、PLCC、RMSE | 小型、易跑的 VQA 回归集；用于每次更换视频采帧策略、编码器或阈值后的快速回归。 |
| P0 | [VideoScore / VideoFeedback 官方仓库](https://github.com/TIGER-AI-Lab/VideoScore) / [项目页](https://tiger-ai-lab.github.io/VideoScore/) | VideoFeedback 含 37.6K 个由 11 个生成模型产生的 text-video pairs，并对视觉质量、时序一致性、动态程度、文视频对齐、事实一致性做 1–4 分人工标注；VideoScore-Bench 约 7K 视频，含 Likert 分和偏好数据。仓库代码 MIT；数据通过官方 Hugging Face 链接提供。 | 对人工分的 Spearman 相关；pairwise accuracy | 同时校准生成视频的质量和文视频一致性 scorer；适合视频生成训练数据，不应替代真实 UGC 的 LSVQ/KoNViD。 |
| P1 | [VBench 官方仓库](https://github.com/Vchitect/VBench) / [CVPR 论文](https://openaccess.thecvf.com/content/CVPR2024/papers/Huang_VBench_Comprehensive_Benchmark_Suite_for_Video_Generative_Models_CVPR_2024_paper.pdf) | 公开提示集、评测代码和已采样视频；16 个维度。官方实现支持对自有视频运行主体/背景一致性、闪烁、运动平滑、动态、美学和成像质量等部分维度。 | 每维 0–1/归一化分、Quality Score、Semantic Score；项目用人类偏好验证指标对齐 | 可直接复用为 DJ 后处理评估器，给视频生成数据生成多维 metadata；不要只保留一个加权总分。 |
| P1 | [MaxWell / ExplainableVQA 官方仓库](https://github.com/VQAssessment/ExplainableVQA) | 官方释放 MaxWell 训练部分、标签、模型和推理代码；基于 DIVIDE-3K，把视频质量拆成美学、技术及可解释维度。仓库许可文件可见，具体数据使用条件应在下载时复核。 | SRCC/PLCC；美学/技术/解释维度分 | 当管线需要解释“为什么低质”并据此选择 DJ 算子时使用；比单一 MOS 更利于错误分析。 |

### 4. 视频-文本质量与时间/组合对齐

| 优先级 | Benchmark / 协议 | 公开性、规模与任务 | 常用指标 | 对 Plan-Flow 的用途 |
|---|---|---|---|---|
| P0 | [VideoComp 官方仓库](https://github.com/google-deepmind/video_comp) / [CVPR 论文](https://openaccess.thecvf.com/content/CVPR2025/papers/Kim_VideoComp_Advancing_Fine-Grained_Compositional_and_Temporal_Alignment_in_Video-Text_Models_CVPR_2025_paper.pdf) | 公开 ActivityNet-Comp 与 YouCook2-Comp 的训练/验证 JSON。为正确多事件描述构造三类 hard negative：时间重排、动作词替换、片段错配。代码 Apache-2.0，其他发布材料 CC-BY 4.0；原视频仍受 ActivityNet/YouCook2/YouTube 获取条件影响。 | 三类二分类准确率；`all` 为三类准确率乘积；检索可报 Recall@1 | 这是视频 caption/alignment 过滤器最值得优先接入的专项回归集；应分别报告 temporal/action/segment，避免平均分掩盖时间理解失败。 |
| P0 | [VideoScore-Bench 官方评测说明](https://github.com/TIGER-AI-Lab/VideoScore/blob/main/benchmark/README.md) | 约 7K 视频，汇集 VideoFeedback、EvalCrafter、GenAI-Bench 与 VBench 的人工 Likert/偏好数据，官方提供数据帧与评测脚本。 | VideoFeedback/EvalCrafter 用 Spearman；偏好集用 pairwise accuracy | 用来挑选自动视频质量/对齐 scorer；选定模型后，Plan 中固定模型版本、采帧数和 prompt。 |
| P1 | [ReSpec CVPR 2025 论文](https://openaccess.thecvf.com/content/CVPR2025/papers/Kim_ReSpec_Relevance_and_Specificity_Grounded_Online_Filtering_for_Learning_on_CVPR_2025_paper.pdf) | 不是独立打包 benchmark，而是一套可复现的视频数据过滤实验协议：在 WebVid2M、VideoCC3M 上过滤并训练，再在 MSR-VTT、DiDeMo、LSMDC、ActivityNet、YouCook2 五个视频检索任务上评估。 | 五任务 Recall@1/5/10 的平均值、相对保留比例/数据效率 | 目前最接近“视频版 DataComp”的公开参考协议。建议把其数据保留比例—下游 Recall 曲线作为本项目视频筛选实验模板。 |

### 5. 安全、NSFW 与有害内容

| 优先级 | Benchmark / 评测集 | 公开性、规模与标注 | 常用指标 | 对 Plan-Flow 的用途 |
|---|---|---|---|---|
| P0 | [UnsafeBench 官方项目页](https://unsafebench.github.io/) / [论文](https://arxiv.org/abs/2405.03486) | 10,146 张真实/生成图片，6,098 safe、4,048 unsafe，覆盖 sexual、violent、hateful 等 11 类；数据需向官方申请，仅限研究用途。还包含图像扰动鲁棒性评测。 | 总体及逐类 F1；Robust Accuracy、扰动下 MSE | 基准化图片安全算子；质量门应同时限制 unsafe 漏检率和 hard-benign 误杀率，不能只报 accuracy。 |
| P0 | [SafeSora 官方仓库](https://github.com/PKU-Alignment/safe-sora) | 57K+ text-video 多标签样本、12 类伤害；另有 51K+ 人工 helpfulness/harmlessness 偏好对和 600 条独立评测 prompt。官方 Hugging Face 可下载，数据 CC BY-NC 4.0，代码 Apache-2.0。 | macro/micro F1、逐类 precision/recall；偏好准确率；安全/无害胜率 | 视频安全过滤最实用的公开起点；可把 12 类映射为 Plan 的 policy taxonomy，并单独保留误杀与漏检样本供人工复核。 |
| P1 | [SafeWatch-Bench 官方项目页](https://safewatch-aiguard.github.io/) / [ICLR 论文](https://openreview.net/pdf?id=xjKz6IxgCX) | 2M+ 真实与生成视频，6 个大类、30+ 场景，含多标签与解释；规模很大，实际下载和使用条件需在申请页复核。 | 每类 accuracy、平均 accuracy、F1、AUPRC；解释评分；推理时间 | 用于更完整的视频 guardrail 研究和成本评估；不建议作为当前 MVP 的首个依赖。 |

安全数据含令人不适或违法风险内容。接入时需要访问控制、审计、最小化展示、缩略图遮罩，以及明确的非商业/研究限制；不能把公开可下载等同于可以商用。

### 6. 去重、近重复与评测污染

| 优先级 | Benchmark / 评测集 | 公开性、规模与任务 | 常用指标 | 对 Plan-Flow 的用途 |
|---|---|---|---|---|
| P0 | [DISC21 官方数据页](https://ai.meta.com/datasets/disc21-dataset/) / [官方 SSCD 实现](https://github.com/facebookresearch/sscd-copy-detection) | 1M reference、50K development query、50K test query，另有 1M 训练图；query 含人工/自动编辑、拼贴、重编码等变换，总量约 350 GB。官方说明源图经宽松许可筛选并去除可识别人脸。 | micro average precision、recall at fixed precision；挑战官方协议 | 验证图像近重复算子，而不仅是精确 hash；根据业务分别测“同图变换”“拼贴/局部复制”。 |
| P0 | [FIVR-200K 官方仓库](https://github.com/MKLab-ITI/FIVR-200K) | 225,960 个 YouTube 视频、4,687 个事件、100 个 query，标注 near duplicate、duplicate scene、complementary scene、incident scene、duplicate audio。代码/标注 Apache-2.0；视频通过 ID 下载，实际可得性会随 YouTube 漂移。 | DSVR/CSVR/ISVR 的 mAP；音频重复检索 mAP | 校准视频级近重复过滤器；报告应区分“完全/场景重复”和“同事件但互补”，避免错误删除有价值的不同视角。 |
| P1 | [VCSL 官方仓库](https://github.com/alipay/VCSL) / [CVPR 论文](https://openaccess.thecvf.com/content/CVPR2022/papers/He_A_Large-Scale_Comprehensive_Dataset_and_Copy-Overlap_Aware_Evaluation_Protocol_for_CVPR_2022_paper.pdf) | 面向片段级视频复制定位，官方提供 benchmark 代码、标注及下载说明；原始网络视频的持续可得性和媒体许可需逐源确认。 | copy-overlap-aware segment AP、定位精度/召回 | 对长视频尤为重要：检测“一个短片段被嵌入长视频”，这类污染不能靠视频级 embedding 去重可靠发现。 |

评测污染应额外设一条独立门禁：把所有下游 test/val 媒体做内容 hash、感知 hash 和 embedding 索引，在训练数据输出前做 exact + near-duplicate 检索。DataComp 的[官方规则](https://www.datacomp.ai/dcclip/)明确禁止使用下游测试图片，这一隔离原则应写入 Plan，而不是只在报告中提示。

### 7. 数据筛选对下游模型效用

| 优先级 | Benchmark / 协议 | 公开性与算力级别 | 核心指标 | 对 Plan-Flow 的用途 |
|---|---|---|---|---|
| P0 | [DataComp 官方仓库](https://github.com/mlfoundations/datacomp) / [官方站点](https://www.datacomp.ai/dcclip/) / [NeurIPS 论文](https://papers.nips.cc/paper_files/paper/2023/hash/56332d41d55ad7ad8024aac625881be7-Abstract-Datasets_and_Benchmarks.html) | Filtering 与 BYOD 两条赛道；4 个规模。small pool 已有 12.8M image-text pairs、约 450 GB tar；固定 CLIP 训练代码并在 38 个下游测试集评估。官方仓库提供下载、训练、评测与 baseline 代码。 | ImageNet zero-shot、检索、分布偏移等 38 项；官方聚合分；训练成本固定 | 直接借鉴其“固定模型与预算、只改数据”的实验设计。完整 small 仍偏重，MVP 可先做 100K–1M 的内部固定子集，但不要把结果称为官方 DataComp 分数。 |
| P0 | [ReSpec 视频筛选协议](https://openaccess.thecvf.com/content/CVPR2025/papers/Kim_ReSpec_Relevance_and_Specificity_Grounded_Online_Filtering_for_Learning_on_CVPR_2025_paper.pdf) | 见上：WebVid2M/VideoCC3M + 五个视频检索任务。不是官方竞赛包，复现时需自行冻结依赖和 split。 | R@1/5/10 与保留率/处理成本曲线 | 作为第一版视频下游效用 benchmark；至少比较 raw、基础规则、当前 DJ Plan 三条基线。 |
| P1 | [Video-MME 官方仓库](https://github.com/MME-Benchmarks/Video-MME) / [项目页](https://video-mme.github.io/home_page.html) / [CVPR 论文](https://openaccess.thecvf.com/content/CVPR2025/papers/Fu_Video-MME_The_First-Ever_Comprehensive_Evaluation_Benchmark_of_Multi-modal_LLMs_in_CVPR_2025_paper.pdf) | 900 个视频、254 小时、2,700 个人工多选问答；覆盖短、中、长视频，6 个大域/30 个子域，并可比较无字幕与带字幕设置。仅限学术研究，禁止商业使用和未经许可的复制、分发或修改。 | 总体 accuracy，以及按时长、领域、字幕设置切片的 accuracy | 用作“清洗后训练/微调的视频模型是否仍具视频理解能力”的下游测试。它不是视频质量数据集，不能用 QA 准确率直接决定单条训练样本删留。 |
| P2 | [DataComp-VLM 官方仓库](https://github.com/mlfoundations/dcvlm) / [论文](https://arxiv.org/abs/2606.28551) | 2026 年新发布。标准候选池最高约 6T 多模态 token，允许过滤、混合、格式化；模型 1B–8B、预算 6.25B–200B token，最多 52 个多模态任务。官方仓库已公开 candidate pool 和竞赛材料；small pool 仍达 187.5B token。 | 最高 52 个任务、9 个域的 core/extended aggregate | 更适合以后评估图片、文档、交错数据和 instruction data 的混合策略；当前阶段算力与工程复杂度过高，不应作为首个闭环。 |

## 建议接入当前 Data-Juicer Plan-Flow 的评测结构

### 1. 把评测写成 Plan 的一等对象

建议结构如下：

```yaml
evaluation:
  evaluator_regression:
    # 算子/评分器升级时运行，不必每个用户任务都全跑
    image_text_alignment: [sugarcrepe, winoground]
    image_quality: [koniq10k]
    video_quality: [konvid1k, videoscore_bench]
    video_text_alignment: [videocomp]
    image_safety: [unsafebench]
    video_safety: [safesora_label]
    image_dedup: [disc21]
    video_dedup: [fivr200k]

  task_golden_set:
    path: eval/task_golden.jsonl
    frozen_hash: sha256:...
    strata: [kept, removed, borderline, safety, duplicate]

  dataset_metrics:
    - input_output_count
    - retention_rate
    - score_distributions
    - exact_and_near_duplicate_rate
    - unsafe_residual_rate
    - alignment_failure_rate
    - modality_and_category_coverage

  downstream_utility:
    protocol: datacomp_like   # 或 respec_like
    baselines: [raw, basic_rules, previous_plan]
    fixed_recipe: eval/recipes/clip_small.yaml
    fixed_eval_splits_hash: sha256:...

  quality_gates:
    - metric: golden.good_sample_retention
      min: 0.98
    - metric: golden.bad_sample_recall
      min: 0.90
    - metric: safety.unsafe_recall
      min: 0.98
    - metric: dedup.false_positive_rate
      max: 0.01
    - metric: downstream.aggregate_delta_vs_raw
      min: 0.0
```

### 2. 三段式执行，避免成本失控

1. **Evaluator certification**：首次接入或更换评分模型时，在上述公开集上测试，产出模型卡式报告和阈值；结果按 evaluator 版本缓存。
2. **Canary/dry-run**：每个 Plan 在任务自己的冻结金标集和分层抽样上运行，展示保留/删除/边界样本与误删漏检。
3. **Full run + downstream**：全量运行后计算数据集指标；只有研究任务、版本发布或关键 Plan 变更才触发固定小模型训练和下游 benchmark。

### 3. 指标必须成对出现

- 过滤召回率必须配合好样本保留率/误删率；
- 去重率必须配合不同视角、互补片段的误合并率；
- 安全召回必须配合 hard-benign false positive rate；
- 平均图文/文视频相似度必须配合 hard-negative accuracy；
- 下游得分必须配合保留数据量、训练 token/样本数、GPU 小时和数据处理成本。

只追求“输出均分更高”会诱导管线删除大量困难但有价值的数据，也可能压缩长尾与文化多样性。

## 推荐的最小落地组合

### 第一阶段：不训练下游模型也能完成

1. 图文对齐：SugarCrepe + Winoground；
2. 图片质量：KonIQ-10k；
3. 视频质量：KoNViD-1k + VideoScore-Bench；
4. 文视频对齐：VideoComp；
5. 图片安全：UnsafeBench（申请获批后）；
6. 视频安全：SafeSora-Label；
7. 去重：DISC21 的可控子集 + FIVR-200K 可下载子集；
8. 每个真实任务再建立 200–1,000 条冻结、分层的项目金标集。

这一阶段主要评价 DJ 算子/评分器和阈值是否可信，可成为 `prepare_plan` 与正式批准之间的自动 canary。

### 第二阶段：建立“数据是否有用”的闭环

- 图片：先复用 DataComp 的 small 模型配方思想，自建固定 100K–1M 规模低成本协议；资源允许时再跑官方 DataComp small。
- 视频：复现 ReSpec 风格协议，固定视频编码器、训练步数和 MSR-VTT/DiDeMo/LSMDC/ActivityNet/YouCook2 splits，比较 `raw → basic filter → DJ plan_vNNN`。
- 若管线服务于视频 VLM 训练或微调，再增加 Video-MME，按短/中/长视频和字幕设置报告 accuracy；不要把它当成每次 Plan 都运行的样本过滤指标。
- 每次报告保留率—下游得分 Pareto 曲线，而不是只比较一个最高分。

### 第三阶段：研究级实验

- 做算子消融：逐个移除质量、对齐、安全、去重步骤；
- 至少 3 个随机种子并报告均值/方差；
- 跨域测试真实 UGC 与生成媒体；
- 评估阈值迁移、类别/语言/文化切片和长期数据漂移；
- 资源充分后接 DataComp-VLM，研究过滤之外的数据混合和格式化策略。

## 关键限制

1. 公开 benchmark 与你的真实数据分布不会完全一致，所以公开集用于认证评分器，任务金标集用于认证具体 Plan，两者都需要。
2. 很多视频数据只发布 URL/YouTube ID，时间久了会失效；必须保存 manifest、下载时间、checksum 和实际可用子集，不能直接声称复现论文的完整分数。
3. 生成媒体质量集（VBench、VideoFeedback）不能替代真实 UGC 质量集（LSVQ、KoNViD），反之亦然。
4. 安全和媒体数据常带非商业、申请或原平台条款；正式集成前需要逐项做许可审查。
5. CLIPScore、VBench 分数、VideoScore 等自动指标都是代理信号，不是事实真值；最终质量门需保留人工金标与错误分析。
