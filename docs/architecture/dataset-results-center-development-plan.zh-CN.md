# Data-Juicer 结果中心开发方案

状态：需求已确认，已与用户登录方案对齐；本机原型已实现，待补齐正式输出契约、事件驱动发布、持久深链接与 S3 Adapter

范围：DSH Web + Data-Juicer Plan Flow；当前本机存储，后续 GPU 服务器 + S3

目标用户：开放注册后的登录用户；普通用户结果私有，管理员可跨用户管理

## 1. 目标

管线开始后，聊天中显示运行摘要；产生可进入结果中心的输出后，摘要提供“查看结果”按钮，点击进入独立结果详情页。DSH 左侧栏增加“结果中心”入口，只用于长期查看管线跑出的数据集结果、可视化、元数据和统计图表，不承担公共输入数据管理，也不充当运行错误中心。

第一版只把管线输出作为数据集内容，不提供输入数据管理。结果页支持：

- 图片、视频及普通输出文件预览；
- 质量分、标签及其分布图表展示；
- 按标签、文件名、文件类型筛选；
- 单文件下载；
- 整个数据集 ZIP 下载；
- 勾选部分文件后 ZIP 下载；
- JSON 格式化只读查看；
- JSONL 分页表格只读查看、搜索和原始文件下载；
- 手动删除数据集，并展示文件数与占用空间；
- 长期保留，不做自动过期；普通用户查看自己的存储占用，管理员查看全局占用和容量告警。

## 2. 已确认的产品决定

| 主题 | 第一版决定 |
|---|---|
| 左侧名称 | 结果中心 |
| 页面入口 | 聊天摘要“查看结果”按钮 + 左侧结果中心 |
| 左侧位置 | 顶部功能区中紧接“算子库”下方、位于“工作区”标题上方 |
| 数据范围 | 只展示输出；模型预留输入角色 |
| 支持模态 | 通用框架，首批实现图片、视频、JSON、JSONL 和普通文件 |
| 图片比较 | 不做原图对比、蒙版叠加和拖动对比 |
| 列表筛选 | 标签、文件名、文件类型 |
| 下载 | 单文件、全量 ZIP、勾选 ZIP |
| JSON/JSONL | 只读查看、搜索、下载，不支持网页编辑 |
| 可见性 | 普通用户只能查看和操作自己的结果；管理员可进入跨用户管理视图 |
| 删除权限 | 普通用户可删除自己的结果；管理员可删除任意用户结果；均需二次确认 |
| 结果粒度 | 每次运行产生独立结果；修改方案、输入或重新运行均不覆盖旧结果 |
| 数据集范围 | 只聚合当前用户拥有的输出结果；管理员可按用户和工作区筛选全部结果 |
| 历史数据 | 认证前的可用历史结果经报告确认后归首个管理员；无法确认的标记为 `unclaimed` |
| 失败任务 | Run 执行报错或没有输出的不进入结果中心；无执行错误且有可验证输出的非完整运行标记为“部分完成” |
| 数据量 | 当前几百条；接口仍采用服务端分页 |
| 保留策略 | 长期积累，允许手动删除，暂不自动过期 |
| 业务输出 | 保留 Run 的全部业务输出；样本媒体进入可视化区，JSON/JSONL、报告和模型附件进入“数据集文件”；日志、缓存、临时文件和私有运行状态排除 |
| 标签来源 | 每个 Plan 在 `output_contract` 中声明稳定机器 key、中文显示名和映射/阈值；页面与 Catalog 不根据文件名或自然语言猜测 |
| 文件角色 | 原图、结果、蒙版、叠加预览、视频和附件使用独立 `role`，不混入样本标签筛选 |
| 聊天跳转 | 登记成功后返回结构化 `dataset_ref`；默认跳到数据集详情，允许携带 `sample_id` 跳到具体样本；刷新、复制链接和重新登录后可恢复 |
| 发布中状态 | 本机校验或 S3 上传未完成时，聊天显示“正在发布结果”；仅在字节完整、清单校验和 Catalog 登记均成功后显示“查看结果” |
| 删除语义 | 用户看到的是删除；内部先写 `deleting`/tombstone，再删除本机或 S3 字节并失败重试；最小审计记录保留但不可恢复业务文件 |
| 当前存储 | 继续读取受控的本机 Run 输出，不复制数据 |
| 后续存储 | GPU 服务器使用 S3；稳定资源 ID 不变，Bucket 和前缀可配置、可迁移 |

## 3. 当前实现基线与缺口

截至当前本机原型：

- `web-dj.ps1` 默认以 `native` 启动 Plan Flow，本机 Run 使用 `local-process`；Broker 模式仍可显式切换；
- 原生 Worker 已能在成功终态生成 `result-manifest.json`；
- DSH 已有登录隔离、SQLite Catalog、左侧“结果中心”、列表、详情、图片/视频/JSON 预览、样本合并、筛选、分页、下载和删除原型；
- 聊天中的“查看结果”目前通过页面内部事件打开 `dataset_id`，还不是刷新和复制后可恢复的深链接；
- Catalog 当前依赖打开页面后扫描对话历史来发现 Run，不是 Run 终态主动触发的 Result Publication；
- 当前 `dataset-view.json` 仍可能由导入脚本或人工补写，Plan `output_contract` 尚未成为所有新 Run 的正式约束；
- 当前 SQLite 将资产集合内联在结果记录中，适合几百条原型数据，但在长期积累和 S3 阶段前应拆为可分页的样本与资产表。

因此，后续工作不是另建一套结果中心，而是把现有原型收敛成“运行输出兼容层 → Result Publication → DatasetCatalog → Local/S3 Adapter”的可靠链路。

现有运行链已经具备安全的输出收集和 `result-manifest.json`，但该文件只提供相对路径、SHA-256、大小、文件数和总字节数，不能表达：

- 文件的媒体类型和展示角色；
- 哪些文件是数据项，哪些是报告或元数据；
- 每个数据项的标签和质量指标；
- JSONL 中一条记录对应哪些输出文件；
- 页面可用的标题、摘要和统计；
- 安全的浏览、下载和删除标识。

现有 Broker 的 `GET /v1/runs/{run_id}` 只投影运行状态，不返回输出目录或文件路径。这一点应保持不变：不能为了页面展示把宿主机路径加入公共 Broker 接口。

现有 DSH 插件已经证明可以：

- 在左侧栏注册入口；
- 使用 `shell.auxiliary` 承载完整页面；
- 通过 DSH Host 注册同源 HTTP 路由；
- 只允许 Host 代理本机 `127.0.0.1` 的 Plan Flow 服务。

数据集功能复用这些 seam，但不能把数据集逻辑塞进现有算子库插件。

## 4. 模块设计与归属

这里的“深模块”是代码设计术语，不表示目录更深或系统更复杂；它表示调用方只学习少量接口，而路径校验、索引恢复、筛选、归档和错误处理等复杂实现集中在模块内部。

结果中心跨越 DSH、Plan Flow 和存储模块，但各自承担不同职责：

```text
浏览器
  │ Session Cookie + dataset_id / asset_id
  ▼
DSH DatasetCatalog
  ├─ 从服务器请求上下文取得 Principal
  ├─ 所有权、管理员授权、索引、筛选和删除语义
  ├─ 左侧结果中心和聊天摘要
  ├─ 通过 RunOutputPort 读取运行事实与展示契约
  └─ 通过 ObjectCatalog 读取或删除结果字节

Run 终态 ──▶ ResultPublisher ──▶ DatasetCatalog
                    │
                    ├──────────▶ ObjectCatalog
                    ▼
Plan Flow RunOutputGateway
  ├─ 验证 workspace/task/plan/run 身份
  ├─ 验证 result-manifest 与 dataset-view
  ├─ 将 asset_id 安全解析为受控输出文件
  └─ 当前本机 Adapter 执行读取、归档和精确输出删除

ObjectCatalog
  ├─ 当前 LocalRunOutputAdapter
  └─ 后续 S3 Adapter
```

`ResultPublisher` 是运行终态与结果产品之间的深模块。调用方只提交可信 `Principal + sessionId + resultRef`；其实现隐藏清单校验、视图构建、Local/S3 发布、所有权登记、幂等、补偿和重试。不要让浏览器扫描对话历史来承担主发布职责；历史 reconcile 只作为重启恢复和旧数据导入的兜底。

### 4.1 DSH 深模块 `DatasetCatalog`

结果产品模块归 DSH 所有。其接口只使用可信 `Principal` 和不透明标识，不接受宿主机路径、S3 Key 或浏览器提交的 `ownerUserId`。`Principal` 只能由 Host 验证 Session Cookie 后从服务器请求上下文取得：

```ts
list(principal, query): Promise<DatasetPage>
registerRunResult(principal, sessionId, resultRef): Promise<DatasetRef | null>
get(principal, datasetId): Promise<DatasetDetail>
listItems(principal, datasetId, query): Promise<DatasetItemPage>
openAsset(principal, datasetId, assetId, disposition): Promise<AssetStream>
requestArchive(principal, datasetId, selection): Promise<ArchiveJob>
delete(principal, datasetId, confirmation): Promise<DeleteResult>
```

`DatasetCatalog` 负责：

- 所有查询在服务器端附加所有权条件；管理员跨用户查询必须显式进入管理视图；
- 校验会话、任务、Run 和结果的所有者一致，创建时自动写入 `owner_user_id`；
- 为每个首次登记的结果分配全局随机 `dataset_id`；
- 以 `workspace_id + task_id + plan_version + run_id` 作为内部唯一 origin key；
- 保存状态、标题、统计、标签和文件类型摘要；
- 提供列表、筛选、历史导入、重启 reconcile 和 tombstone；
- 集中决定列表、详情、预览、下载、归档和删除权限，HTTP 路由不得各自复制授权逻辑；
- 通过注入的 `RunOutputPort` 访问 Plan Flow，不自行理解 Python Run 目录结构；
- 通过 `ObjectCatalog` 访问结果字节，不自行拼接本机路径、Bucket 或对象键。

浏览器可以提交不透明 `workspace_id` 作为列表筛选条件，但 Catalog 必须先验证该工作区或结果对当前 `Principal` 可见。浏览器不能提交 `workspace_root`、`output_dir`、S3 Key 或任意文件路径；Host 只在服务器内部解析存储位置。

### 4.2 Plan Flow 深模块 `RunOutputGateway`

Plan Flow 继续拥有运行结果事实和文件安全规则。其接口位于 DSH 与 Plan Flow 的受信 seam：

```python
list_runs(trusted_workspace, cursor) -> RunPage
inspect_run(trusted_workspace, run_ref) -> VerifiedRunOutput
open_asset(trusted_workspace, run_ref, asset_id, range) -> AssetStream
create_archive(trusted_workspace, run_ref, selection) -> ArchiveJob
delete_outputs(trusted_workspace, run_ref, expected_manifest_hash) -> DeleteResult
```

这里的 `trusted_workspace` 可以包含宿主路径，因为它只存在于 DSH Host 到 loopback Plan Flow 的内部调用，不属于浏览器接口。生产使用带启动期共享凭据的 loopback HTTP Adapter；测试使用内存 Adapter。这是一个真实 seam，而不是让页面直接读取磁盘。

`RunOutputGateway` 负责当前 Plan Flow 运行事实和本机输出验证：

- 从 PlanStore 枚举 Run，但只向 Catalog 登记符合进入规则的结果；
- 校验输出目录确实属于该 Run；
- 读取并验证结果清单；
- 解析展示契约；
- 将 `asset_id` 映射为清单内相对文件；
- 拒绝绝对路径、路径穿越、符号链接和替换竞态；
- 推断有界 MIME 类型并支持视频 Range；
- 创建、复用、限额和清理 ZIP；
- 在清单 hash 仍一致时执行精确输出删除。

### 4.3 运行与存储 seam

DSH `DatasetCatalog` 依赖 `RunOutputPort` 读取 Run 状态、清单和展示契约，不直接依赖 HTTP 或 Plan Flow 文件布局。当前 HTTP Adapter 先用服务器内部的 `workspace_id` 从 `WorkspaceRegistry` 取得规范路径，再调用只监听 `127.0.0.1` 的 `RunOutputGateway`；内存 Adapter 用于接口级测试。

结果字节访问复用登录方案定义的深模块 `ObjectCatalog`。当前使用 `LocalRunOutputAdapter`，把受控资源 ID 解析到已验证的 Run 输出；部署 GPU 服务器后增加 S3 Adapter，结果写入配置的 `users/{user_id}/results/{task_id}/...`。这两个 Adapter 共享同一接口，因此切换存储不改变页面接口或 `dataset_id`。对象记录保存 `storage_kind`、内部定位和 `storage_location_version`，支持迁移期间同时读取旧、新位置。

`DatasetCatalog` 拥有“结果是什么、谁能操作”的产品语义；`ObjectCatalog` 拥有“字节在哪里、怎样安全读写”的存储语义；`RunOutputGateway` 拥有“Plan Flow 实际产出了什么”的运行事实。三者不得互相复制所有权或路径拼接规则。

任何公共响应不得返回 `trusted_workspace`、`output_dir`、日志绝对路径、容器 ID 或模型路径。

### 4.3.1 Result Publication 状态机

Host 观察到 Run 进入终态后，使用运行发起人的服务器 `Principal` 主动调用：

```ts
publish(principal, sessionId, resultRef): Promise<PublicationRef | null>
getPublication(principal, publicationId): Promise<PublicationStatus>
```

状态机：

```text
run terminal
  → validating
  → publishing
  → registering
  → available
        ↘ retryable_failure
        ↘ rejected（failed / 含执行错误 / 无业务输出）
```

- `validating`：验证 Run 身份、状态、业务输出清单和展示契约；
- `publishing`：Local Adapter 只确认受控本机定位，S3 Adapter 上传到私有 staging 前缀并逐对象校验；
- `registering`：在事务中写入所有者、origin 唯一键、存储版本、样本与资产索引；
- `available`：聊天卡片才显示“查看结果”，结果中心列表才对普通用户可见；
- `retryable_failure`：保留 publication 记录和安全错误码，后台幂等重试；不得留下对普通用户可见的半成品结果；
- `rejected`：按既定准入规则不登记，错误仍留在原聊天。

同一 origin 重复发布必须复用同一 publication/dataset，不重复上传、不重复登记。DSH 或 MCP 重启后由 Publication reconcile 继续未完成状态；对话历史扫描不再是正常运行的唯一发现方式。

### 4.4 两层结果契约

保留现有 `result-manifest.json` 作为不可变的物理文件清单和完整性事实；新增 `dataset-view.json` 作为展示语义清单。不要把两种职责合并。

`result-manifest.json` 继续回答“实际输出了哪些字节”。

`dataset-view.json` 回答“这些输出应如何作为数据集展示”。建议 schema：

```json
{
  "schema_version": 1,
  "title": "筛选后的视频数据集",
  "label_definitions": {
    "decision.keep": {"display_name": "保留"},
    "decision.drop": {"display_name": "删除"},
    "quality.hd": {"display_name": "高清"}
  },
  "metric_definitions": {
    "quality_score": {"display_name": "质量分", "type": "number", "min": 0, "max": 1}
  },
  "summary": {
    "record_count": 320,
    "labels": {"decision.keep": 280, "decision.drop": 40},
    "metrics": {
      "quality_score": {"min": 0.12, "max": 0.98, "mean": 0.81}
    }
  },
  "items": [
    {
      "item_id": "item_000001",
      "sample_id": "sample_000001",
      "asset_path": "videos/000001.mp4",
      "display_name": "000001.mp4",
      "media_type": "video/mp4",
      "role": "result",
      "labels": ["decision.keep", "quality.hd"],
      "metrics": {"quality_score": 0.91}
    }
  ],
  "documents": [
    {
      "asset_path": "result.jsonl",
      "kind": "jsonl"
    }
  ]
}
```

规则：

1. `asset_path` 必须存在于已验证的 `result-manifest.json` 中。
2. `item_id` 在单个数据集内唯一，不允许用宿主路径充当标识。
3. 同一样本的原图、结果、蒙版和叠加预览共享 `sample_id`，使用 `role`/`variant` 区分；文件角色不得进入标签筛选。
4. `labels` 只保存 `output_contract` 声明的稳定机器 key；页面用 `label_definitions.display_name` 展示中文，不允许 Catalog 根据文件名、自然语言或模型自由文本临时造标签。
5. `metrics` 第一版只接受已声明的有限数值和短字符串；数值必须满足类型、范围、单位和缺失策略。由数值阈值生成的分类标签，其阈值同样写入 `output_contract`。
6. 数据集级标签计数和指标分布由 Catalog 从样本事实汇总；展示契约可以携带预计算摘要，但登记时必须校验或重算，不能把手写摘要当唯一事实。
7. 管线没有生成 `dataset-view.json` 时，Catalog 生成只按文件类型分类的默认视图，确保旧管线仍可展示和下载。
8. 展示契约无效时不阻止已有可验证业务输出的 Run；数据集状态标记为 `partial`，另记 `presentation_health=degraded`，页面仍显示物理文件清单和契约错误。
9. 第一版允许 `items` 内联几百条；同时规定上限。超过上限时升级为 `items.jsonl` + 游标分页，页面接口不变。

`dataset-view.json` 的生产规则必须进入 Plan 的正式 `output_contract`，不能只靠每条管线自行约定。`output_contract` 至少声明：

- 数据项媒体路径字段；
- 标签字段及允许类型；
- 质量指标字段、数值范围和缺失策略；
- JSONL 记录与媒体输出的关联键；
- 展示契约输出位置和 schema 版本。

### 4.4.1 与现有 Data-Juicer 输出兼容

正式契约不得要求 Data-Juicer 改名或丢弃已有 JSON、JSONL、统计文件、图片、视频或模型附件。兼容层按以下顺序利用现有输出：

1. Run 完成后，Publisher 对输出目录做 allowlist 分类，只把业务输出写入 `result-manifest.json`；日志、缓存、临时文件、运行私有状态和临时 ZIP 排除。
2. 若 Plan 已声明 `output_contract`，Result View Builder 读取现有 JSON/JSONL 字段和媒体输出，生成 `dataset-view.json`，不重写原始业务文件。
3. JSONL 中引用的绝对输入路径仅作为来源事实，不直接成为可预览资产；需要展示的媒体必须是 Run 输出中的相对文件，本机阶段复制/生成到 Run 输出，S3 阶段由 Publisher 上传为结果对象。
4. 若同一样本已有多个输出文件，使用稳定 `sample_id` 合并，文件名只作为兼容回退，不作为长期身份。
5. 没有 `output_contract` 的旧 Run 仍登记为基础/降级视图：可查看物理文件、JSON/JSONL 和下载，但不猜测样本标签、质量指标或媒体关系。

因此现有 DJ 输出是业务事实来源，`result-manifest.json` 和 `dataset-view.json` 是非侵入式描述层，不会与现有文件冲突。

### 4.4.2 Run 输出最终化顺序

为避免“先写 manifest、后复制图片，导致 manifest 过期”，每个新 Run 必须按固定顺序最终化：

```text
DJ 算子完成
  → 枚举候选业务输出
  → Result View Builder 生成 dataset-view.json
  → 校验所有 asset_path 都落在候选业务输出内
  → 生成最终 result-manifest.json（包含 dataset-view，不包含 manifest 自身）
  → 冻结输出并把 Run 写为终态
  → 触发 Result Publication
```

最终 manifest 写入后不允许 Agent、页面或 Publisher 再向 Run 输出目录补文件或修改业务字节。任何必须复制的筛选图片、生成的蒙版或衍生预览都应属于 Plan/Result View Builder 的最终化阶段；若最终化后还需改变输出，必须创建新的 Run 或新的显式结果修订，而不是静默重写原结果。

Plan 校验阶段检查声明，运行后 `RunOutputGateway` 检查实际输出。旧 Plan 没有 `output_contract` 时使用默认文件视图，因此可浏览和下载，但不会凭空出现质量分或标签。

### 4.5 数据集身份、所有权和状态

`dataset_id` 是 DSH 首次登记 origin key 时生成的全局随机 ID。origin key 为 `workspace_id + task_id + plan_version + internal_run_id`，受唯一约束保护；重复 reconcile 返回同一个 `dataset_id`。每次运行都有新的 `internal_run_id`，因此修改方案、修改输入或重新运行都会生成新结果，不覆盖旧结果。不要从输出目录名派生 ID，也不要把 origin key 暴露给浏览器。

每条 `datasets`、`archive_jobs` 和缓存索引记录都保存 `owner_user_id`。所有者取运行发起人，不从用户名、目录或 S3 前缀反推。即使使用公共输入数据，结果所有者仍是发起运行的用户。管理员跨用户查看不改变所有者。

数据集状态映射：

| Run 状态 | 结果中心状态 | 可用功能 |
|---|---|---|
| starting/running | 不登记 | 只保留聊天运行卡片 |
| succeeded，清单和契约完整 | 可用 | 预览、筛选、下载、删除 |
| succeeded，存在可验证输出但契约不完整 | 部分完成 | 展示安全文件清单和契约提示 |
| cancelled，无报错且存在可验证输出 | 部分完成 | 展示取消前已验证的输出 |
| failed，或任意终态含执行错误 | 不登记 | 错误只留在原聊天/运行记录 |
| 任意状态且没有可验证输出 | 不登记 | 不进入结果中心 |
| lost | 不登记 | 诊断只留在原聊天/运行记录 |

### 4.6 全局索引与历史导入

当前本机阶段的数据仍保存在现有 Run 输出目录，不复制一份到新的数据集目录。Catalog 索引只保存：

- 数据集身份；
- `owner_user_id`；
- task/plan/run 引用；
- 状态、标题、时间；
- 文件数量与总字节数；
- 标签与类型的有界摘要；
- ZIP 缓存状态；
- `storage_kind`、内部存储定位和 `storage_location_version`。

Catalog 不保存图片、视频、完整 JSONL 或永久签名 URL。为避免当前 `assets_json` 随样本数膨胀，正式结构拆分为：

```text
datasets                    一次 Run 对应一个 Dataset Result
dataset_samples             可分页、可按文件名和标签检索的样本
dataset_assets              样本变体/文件角色、MIME、大小、hash、内部对象引用
dataset_documents           JSON/JSONL、报告和模型附件
dataset_label_definitions   稳定 key、显示名和来源 Plan
dataset_sample_labels       样本与标签关系
dataset_metrics             指标定义和有界索引值
result_publications         发布状态、重试和幂等事实
dataset_tombstones          删除后的最小审计事实
```

本机体验阶段继续使用 SQLite；GPU 服务器 + S3 部署阶段默认迁移到 PostgreSQL，以支持 Publisher、后台重试和多个 Web/Worker 进程并发。两者通过同一 CatalogStore interface 提供 Adapter，并运行同一契约测试；迁移只改变存储实现，不改变 `DatasetCatalog` interface 或不透明 ID。

索引使用 DSH 已有 `storageDomain`，建立全局 `datasets` domain，而不是写入各工作区 `.dj/datasets/`。索引保存内部 `workspace_id` 和所有权，但任何公共响应都不返回本机路径或 S3 定位。

启动时及定期 reconcile：

1. 从 `WorkspaceRegistry.list()` 读取已登记工作区，但不直接向普通用户暴露全局结果；
2. 通过 `RunOutputPort.listRuns()` 分页枚举历史和新增 Run；
3. 只登记满足进入规则且能确定 `owner_user_id` 的结果；
4. 按 origin key 幂等登记，刷新状态和有界摘要；
5. 工作区已移除、输出缺失或清单损坏时保留最小审计记录，但从普通结果列表移除。

认证上线前已有且符合进入规则的结果先生成迁移报告，确认后归属首个管理员账号；无法确认来源的记录进入仅管理员可见的 `unclaimed` 状态。迁移必须幂等并在事务中写入，不允许历史结果因缺少所有者而暴露给普通用户。后续切换 S3 Adapter 时，`DatasetCatalog` 接口和资源 ID 不变。

## 5. HTTP 接口与权限

### 5.1 浏览器可见的 DSH 同源接口

继续以独立插件 `@dsh-dj/datasets` 承载结果产品，所有浏览器请求只访问：

```text
GET    /api/dj/datasets
GET    /api/dj/datasets/{dataset_id}
GET    /api/dj/datasets/{dataset_id}/items
GET    /api/dj/datasets/{dataset_id}/assets/{asset_id}
POST   /api/dj/datasets/{dataset_id}/archives
GET    /api/dj/datasets/{dataset_id}/archives/{archive_id}
DELETE /api/dj/datasets/{dataset_id}
```

查询参数：

- `cursor`、`limit`：服务端分页；
- `q`：文件名搜索；
- `label`：标签筛选，可重复；
- `media_type`：文件类型筛选；
- `download=1`：单文件下载；否则支持浏览器安全的内联预览；
- `workspace_id`：可选的已登记工作区筛选；
- `owner_id`：仅管理员管理视图可用的所有者筛选；普通用户提交时拒绝；
- ZIP selection 只接受 `item_id[]` 或明确的 `all_business_outputs=true`，不接受路径或 glob。

“下载全部”包含 `result-manifest` 中所有业务输出，不包含内部索引、临时 ZIP、运行私有状态或宿主日志。勾选下载只包含选中数据项及展示契约声明的关联元数据。

结果登记由聊天/运行 Host 在服务器内部调用 `registerRunResult()`，不开放浏览器 `resolve` 接口。所有路由先经过现有 Session Cookie 认证，再把服务器生成的 `Principal` 传给 `DatasetCatalog`；请求体中的 `ownerUserId`、S3 Key 或路径字段一律拒绝。

### 5.2 Plan Flow 受信 loopback 接口

Plan Flow FastMCP 增加只供 DSH Host Adapter 使用的内部路由：

```text
POST   /internal/run-outputs:list
POST   /internal/run-outputs:inspect
GET    /internal/run-outputs/{run_ref}/assets/{asset_id}
POST   /internal/run-outputs/{run_ref}/archives
GET    /internal/run-outputs/{run_ref}/archives/{archive_id}
DELETE /internal/run-outputs/{run_ref}
```

内部请求可以携带 Host 从 `WorkspaceRegistry` 解析出的规范路径，但必须满足：

- Plan Flow 明确监听 `127.0.0.1`，不监听公网地址；
- DSH 与 Plan Flow 启动时生成/加载独立内部凭据，请求必须携带并恒时比较；
- 浏览器路由不得透传 `workspace_root` 字段；
- `run_ref` 由 Plan Flow 返回并校验，不接受任意目录；
- 限制方法、请求体大小、响应头和超时；
- DSH Adapter 流式转发图片、视频、JSON/JSONL 和 ZIP，不把大文件整体读入 Node 内存；
- 删除 hop-by-hop headers；
- 对内联内容设置 `X-Content-Type-Options: nosniff`；
- 只允许清单内 MIME 类型；未知类型强制附件下载；
- 不向浏览器返回 `output_dir`、日志绝对路径或 Docker 信息。

### 5.3 查看、下载与删除权限

权限统一遵循登录方案：

1. 普通用户的列表固定附加 `owner_user_id = principal.userId`；
2. 详情、项目、预览、JSON/JSONL、下载、归档状态和删除都再次校验所有权；
3. 管理员可以进入明确标识的跨用户管理视图，页面始终显示结果所有者；
4. 普通用户可删除自己的结果，管理员可删除任意用户结果；
5. 删除要求当前 Session、CSRF token、当前 manifest hash 和二次确认；管理员跨用户删除还要求短期二次身份确认；
6. 未登录返回 401；已登录但不可见的资源统一返回不泄露存在性的响应；
7. 页面是否隐藏按钮不能代替后端授权。

不再创建独立的“数据集管理员凭据”或第二套管理员 Cookie。角色、禁用状态和 Session 生命周期全部复用 `IdentityAccess`，避免两套身份系统产生权限漂移。

## 6. 页面设计

### 6.1 左侧“结果中心”入口

复用算子库已经验证过的左侧入口模式，但实现为独立客户端插件。入口固定放在左侧顶部功能区的“算子库”正下方、“工作区”标题上方；顶部顺序为“记忆系统 → 算子库 → 结果中心”。点击后打开结果中心。名称使用“结果中心”，因为这里只展示管线输出；“数据集”保留为结果内部的数据模型称呼。

普通用户默认只列出自己的结果，可在自己可见的工作区范围内筛选。管理员可显式切换跨用户管理视图并按所有者、工作区筛选；移除工作区登记不会自动删除结果或物理输出。

列表卡片显示：

- 数据集标题；
- 状态；
- 创建时间和完成时间；
- 文件数、记录数、总大小；
- 主要文件类型；
- 主要标签；
- 所有者（仅管理员跨用户视图）；
- “查看”“下载全部”“删除”操作；普通用户只能操作自己的结果。

默认按最新更新时间倒序。提供状态、文件类型筛选；普通用户不显示无权访问的工作区或所有者筛选。

### 6.2 聊天摘要卡片

`run_plan/get_run` 只增加不含宿主路径的 `result_ref`，例如 `task_id + plan_version + run_id`。Plan Flow 不生成 DSH 全局 ID。Host 使用当前服务器 `Principal`、会话 ID 和 `result_ref` 调用 `ResultPublisher.publish()`；Publisher 经 RunOutputGateway 校验会话、任务、Run、业务输出和展示契约，再让 Catalog 按 origin key 幂等登记或复用。没有可登记结果时返回 `null`，聊天卡片继续显示运行状态或错误，但不显示“查看结果”。成功登记后返回页面使用的 `dataset_ref`：

```json
{
  "publication_id": "pub_...",
  "dataset_id": "ds_...",
  "status": "available",
  "title": "筛选后的视频数据集",
  "record_count": 320,
  "file_count": 325,
  "total_bytes": 104857600,
  "open_path": "/results/ds_...",
  "sample_open_path_template": "/results/ds_.../samples/{sample_id}"
}
```

浏览器不能自己构造 origin、所有者或存储位置；Host 从当前会话取得受控工作区，并让 `RunOutputGateway` 验证 `result_ref` 确实属于该工作区。历史 reconcile 和聊天登记同一个 origin 时必须得到同一个 `dataset_id` 和所有者，冲突时拒绝自动改写归属并记录审计。

DSH 客户端为该结构注册专用摘要渲染器。第一版采用有界轮询而不是假设存在服务端推送：运行中每 2 秒查询，连续一分钟后降为每 5 秒；页面隐藏时暂停，恢复时立即刷新；到达终态后继续轮询 Result Publication，依次显示“正在验证结果”“正在发布结果”“查看结果”或安全的发布失败提示。卡片重新挂载、DSH 重启或打开历史会话时根据 `publication_id/dataset_id` 恢复状态。符合进入规则且发布完成后显示“查看结果”按钮。普通文本回复不负责拼宿主路径。

工具调用结束不代表后台 Run 已结束，因此验收必须覆盖 `starting → running → succeeded/failed/cancelled/lost` 的卡片更新，而不只测试一次终态 JSON 渲染。

深链接规范：

```text
/results/{dataset_id}
/results/{dataset_id}/samples/{sample_id}
```

默认聊天按钮指向数据集详情；Agent 明确引用某条异常或代表样本时才携带 `sample_id`。路由解析后必须重新用当前 Session Cookie 鉴权；不可见、已删除或不存在的 ID 使用不泄露资源存在性的响应。链接允许复制、刷新、重新登录后回到原位置，并支持浏览器前进/后退。若当前 DSH 版本没有稳定的主区域路由注册接口，第一阶段使用最大化 `shell.auxiliary` 加 URL state Adapter 实现同样的公开路径语义；不要通过 DOM 替换主内容区，等稳定路由 seam 可用后只替换 Adapter。

### 6.3 数据集详情页

页面分为：

1. 顶部摘要：标题、状态、数量、大小、标签分布图、质量分分布和指标摘要；没有相应元数据时明确显示“未提供”，不伪造图表。
2. 工具栏：文件名搜索、标签筛选、文件类型筛选、全选当前筛选结果、批量下载、删除。
3. 内容区：卡片/表格视图。
4. JSON/JSONL 查看器：格式化、分页、列展开、搜索、原始下载。
5. 部分完成提示：解释哪些输出已验证、哪些展示契约缺失；执行错误仍回到原聊天查看。

媒体行为：

- 图片列表使用按需生成的有界缩略图缓存，点击后才流式读取原始输出；
- 视频使用原生 `<video controls preload="metadata">`，服务端支持 Range 请求；
- JSON 设定最大格式化字节数，超限只提供下载；
- JSONL 按行建立轻量偏移索引，服务端分页读取，不一次加载整个文件；
- 未知二进制不内联，只显示名称、大小、哈希和下载按钮。

## 7. 下载和删除

### 7.1 单文件下载

下载只接受 `dataset_id + asset_id`。Catalog 先检查所有权，再让 `ObjectCatalog` 从已验证清单映射到本机文件或 S3 对象。响应支持：

- 正确 `Content-Type`；
- 安全的 `Content-Disposition` 文件名；
- `Content-Length`；
- 视频 Range 请求；
- 下载中断不产生服务端副本。

### 7.2 ZIP 下载

全量和勾选下载共用归档模块：

- 选择集按排序后的 `item_id` 计算 archive hash；
- 相同选择复用已存在且校验通过的 ZIP；
- 生成前估算未压缩总量并执行单归档大小、并发数和缓存总量上限；
- ZIP 在当前 Adapter 的受控缓存位置生成；S3 阶段可使用受控临时区并原子发布对象；
- 使用临时文件完成后原子发布；
- ZIP 内只使用数据集相对路径；
- 拒绝软链接、路径穿越和重复文件名；
- 页面轮询归档任务，完成后下载；
- DSH/Plan Flow 重启时清理未原子发布的临时归档，并 reconcile 已完成缓存；
- 下载、归档和删除使用同一数据集读写锁：活跃读取结束前删除进入 `deleting`，不再接受新读取；
- 删除数据集时一并删除 ZIP 缓存。

### 7.3 手动删除

结果所有者或管理员可以进入删除流程。删除确认框必须显示：

- 数据集名称；
- 文件数；
- 输出和缓存总大小；
- 删除不可恢复提示。

删除请求携带 Catalog 最近观察到的 manifest hash。Catalog 再次校验所有权或管理员角色。删除顺序：先原子标记 `deleting` 并写删除任务，立即阻止新预览和归档；等待活跃读取结束；再次验证精确 Run、存储定位和 manifest hash；通过当前 `ObjectCatalog` Adapter 删除输出、缩略图与 ZIP 缓存；最后原子写入包含原所有者的 tombstone。重复删除幂等。本机或 S3 删除暂时失败时保持 `deleting` 并后台重试，不恢复普通用户访问，也不谎报物理字节已清除；管理员可见失败原因和重试状态。普通列表移除已删除项；管理员审计视图可查看最小删除记录，但不能再读取文件。

第一版不删除 Plan、运行审计、会话消息和必要的脱敏错误摘要。后续若需要彻底删除，再增加独立的审计策略。

## 8. 存储容量策略

### 8.1 本机与 GPU 服务器 + S3 的一致接口和不同实现

| 环节 | 本机体验环境 | GPU 服务器 + S3 |
|---|---|---|
| Run 执行 | 本机 `local-process` 或显式 Broker | GPU Worker；执行模式与结果存储解耦 |
| Run 临时输出 | 受控本机 Run 目录 | Worker 临时目录 |
| 发布动作 | 校验后记录受控本机定位，不复制第二份业务字节 | 上传私有 staging 前缀，逐对象校验后原子提交存储定位 |
| 结果字节 | LocalRunOutputAdapter 读取 Run 目录 | S3 Adapter 读取 `users/{user_id}/results/{dataset_id}/...` |
| Catalog | SQLite，单进程体验 | PostgreSQL，支持 Publisher/后台任务/Web 多进程并发 |
| 浏览器访问 | DSH 鉴权后流式读取本机文件 | DSH 鉴权后流式代理，或生成短期、最小权限签名 URL |
| 公开身份 | `dataset_id`、`sample_id`、`asset_id` | 完全相同 |
| 删除 | tombstone 后删除精确 Run 输出和缓存 | tombstone 后批量删除精确对象版本和缓存，失败重试 |

S3 Bucket、region、endpoint 和用户前缀都是 Adapter 配置，不进入 Plan、聊天消息或浏览器响应。S3 对象键是内部定位，不是稳定身份；迁移 Bucket 或前缀时只更新 `storage_location_version`。本机已有结果不因开启 S3 自动移动，必须通过显式“复制 → hash 校验 → 切换定位 → 删除旧字节”迁移任务。

用户选择长期积累，因此第一版不做自动过期，但必须提供：

- 普通用户结果中心顶部显示自己的总文件数和总占用；管理员管理视图显示全局及按用户占用；
- 输出、缩略图/索引、ZIP 缓存分别统计；
- 本机 Adapter 配置磁盘告警阈值；S3 Adapter 配置 Bucket/配额告警阈值；
- 到达软阈值时显示告警；到达硬阈值时禁止新建 ZIP 和新管线，并返回明确容量错误；
- 配置单 ZIP 上限、ZIP 缓存总上限、缩略图缓存总上限和最大并发归档数；
- 按大小和时间排序，便于手动清理；
- 管线失败产生的 work/log 与可展示输出分开统计。

不要为第一版预生成全部视频转码。图片缩略图按需生成、按内容 hash 复用，并在缓存上限下按最近最少使用回收；原始输出长期保留，缓存可以重建。

## 9. 代码改动建议

### Data-Juicer

```text
D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\
├─ run_output_gateway.py       # RunOutputGateway 深模块
├─ run_output_schema.py        # dataset-view/output-contract 与稳定错误码
├─ result_view_builder.py      # 适配现有 JSON/JSONL/媒体输出，生成展示契约
├─ run_output_archive.py       # ZIP 任务、锁与缓存限额
├─ run_output_json.py          # JSON/JSONL 有界读取与分页
├─ dataset_artifacts.py        # 保留物理清单；增加展示契约验证
├─ store.py                    # 增加有界历史 Run 枚举
├─ service.py                  # 暴露受信用例
├─ server.py                   # 受信 loopback custom routes
├─ validation.py               # 验证 Plan output_contract
└─ runner.py                   # Run 终态关联输出契约，不生成 DSH dataset_id
```

### DSH 应用

```text
D:\dsh-app\packages\dsh-dj-datasets\
├─ package.json
├─ README.md
└─ lib\
   ├─ index.js                 # DatasetCatalog、所有权索引、权限和 Host 路由
   ├─ result-publisher.js      # Run 终态发布、幂等、重试和补偿
   ├─ catalog-store.js         # SQLite/PostgreSQL 共用的 CatalogStore interface
   ├─ catalog-store-sqlite.js  # 本机 Adapter
   ├─ catalog-store-postgres.js # GPU 服务器 Adapter
   ├─ run-output-http.js       # RunOutputPort 的 loopback HTTP Adapter
   ├─ local-object-catalog.js  # 当前本机结果 ObjectCatalog Adapter
   ├─ s3-object-catalog.js     # 后续服务器 S3 Adapter
   ├─ result-routes.js         # 可刷新/可复制的数据集与样本深链接 Adapter
   └─ client.js                # 左侧入口、列表、详情、聊天摘要渲染
```

同时修改：

- `D:\dsh-app\package.json`：加入本地包依赖；
- `D:\dsh-app\dj-dsh.patch.yml`：挂载 `dj-datasets`；
- `D:\dsh-app\web-dj.ps1`：为新插件创建 profile junction，固定 MCP 监听地址，并向 DSH/Plan Flow 注入内部凭据；S3 配置仅在服务器部署阶段注入；
- 相关 CSS/locale 资源：中文主文案，保留英文词典；
- DSH 插件注入 `identityAccess`、请求身份上下文、`workspaceRegistry`、`storageDomain`、`objectCatalog` 和 `webServer`；
- Plan/管线模板：在 `output_contract` 中声明质量分、标签、媒体关联，并生成 `dataset-view.json`。

不要把数据集功能继续追加进 `dsh-dj-operator-library`；两个模块的生命周期、接口和测试面不同。

## 10. 分阶段实施

### 阶段 A：收敛输出契约并兼容现有 DJ 文件

1. 固化 `Business Output` allowlist、`result-manifest` v1 和 `dataset-view` v1 schema。
2. 在 Plan `output_contract` 中声明样本键、媒体字段、文件角色、稳定标签 key/显示名、指标范围和缺失策略。
3. 实现 Result View Builder，直接利用现有 JSON、JSONL、stats 和媒体输出生成展示契约，不改名、不覆盖业务文件。
4. 对 JSONL 中的绝对输入路径执行明确策略：只保留来源事实；需要展示的媒体必须复制/生成到 Run 业务输出。
5. 保留旧 Run 默认文件视图和 `degraded` 回退。

完成标准：白衣筛选、人脸蒙版、视频 + JSONL 三类真实 Run 不经人工补文件即可生成合法清单；同一样本的多个变体按 `sample_id` 合并；标签、角色、指标互不混淆；旧 Run 仍可浏览下载。

### 阶段 B：事件驱动 Result Publication 与正式 Catalog

1. 实现 `ResultPublisher`，由 Run 终态主动触发验证、发布和登记；历史扫描降为恢复兜底。
2. 增加 `result_publications` 状态与幂等唯一键，支持重试、重启恢复和安全错误码。
3. 把当前 SQLite `assets_json` 拆成 datasets/samples/assets/documents/labels/metrics 表，并完成幂等迁移。
4. 保留现有 `IdentityAccess` 所有权校验、全局随机 ID、历史管理员归属、`unclaimed` 和 tombstone。
5. 提供 SQLite 与内存 CatalogStore Adapter 契约测试，为 PostgreSQL Adapter 固定 interface。

完成标准：一个全新本机 Run 从终态到结果中心全程无需打开页面触发、无需人工复制或手工登记；重复通知只产生一个 dataset；普通用户只能看到自己的结果；公共结构不含路径或 S3 Key。

### 阶段 C：聊天发布状态和持久深链接

1. 聊天卡片渲染 `validating → publishing → available/retryable_failure`。
2. 实现 `/results/{dataset_id}` 和 `/results/{dataset_id}/samples/{sample_id}` URL state/router Adapter。
3. 默认按钮进入数据集详情；结构化回复引用具体样本时可进入样本详情。
4. 支持复制链接、刷新、重新登录、浏览器前进/后退和无权访问响应。
5. 保留左侧“结果中心”入口，并确保它与聊天链接打开同一 Catalog 事实。

完成标准：运行结束后聊天自动出现“查看结果”；复制链接到新标签页并登录后仍进入同一详情；用户 A 的链接对用户 B 不泄露资源存在性。

### 阶段 D：补齐预览、下载和可恢复删除

1. 保留并加固现有图片、样本变体、视频 Range、JSON/JSONL、筛选和分页能力。
2. 实现缩略图与 JSONL 偏移索引上限。
3. 完成全量业务输出 ZIP、勾选样本 ZIP、归档进度、缓存和失败恢复。
4. 将删除改为任务化 `deleting → tombstone`，Local/S3 删除失败后台重试。
5. 完成普通用户/管理员占用统计和管理员删除审计。

完成标准：几百条混合输出可稳定预览和下载；`下载全部` 不含日志/缓存；删除后所有媒体和归档接口不可用，重试不会误删其他 Run。

### 阶段 E：本机真实端到端与容量验证

1. 使用图片筛选、蒙版多变体、视频 + JSONL、部分完成、无输出失败 Run 做真实测试。
2. 验证 DSH/MCP 重启后 publication、历史导入、索引、删除和归档恢复。
3. 验证穿透环境下大文件流、断线恢复和本机容量软/硬阈值。
4. 清除当前仅用于原型导入或人工补 `dataset-view` 的路径，确保正常链路只有一个发布入口。

完成标准：至少连续运行三次真实新任务，均无需人工介入自动进入当前用户结果中心，聊天深链接可用，失败/无输出不会误登记。

### 阶段 F：GPU 服务器、PostgreSQL 与 S3 Adapter

1. 实现 PostgreSQL CatalogStore Adapter，并从 SQLite 做可审计迁移。
2. 实现 S3 ObjectCatalog Adapter：上传私有 staging、逐对象 hash/size 校验、原子提交存储定位。
3. 保存 `storage_location_version`，支持本机旧结果与 S3 新结果并行读取。
4. 提供“复制 → 校验 hash → 更新定位 → 删除旧对象”的显式迁移任务，不因修改配置自动移动旧数据。
5. 验证短期签名 URL、Range、ZIP、异步删除重试、IAM 最小权限、配额、备份和恢复。

完成标准：页面、聊天深链接和所有不透明 ID 不变；只有发布完成的 S3 结果可见；用户只能访问自己的对象；Bucket、前缀或部署机器变化不需要修改业务代码。

## 11. 测试策略

以 DSH `DatasetCatalog` 接口和 Plan Flow `RunOutputGateway` 接口作为两个主要测试面，不直接测试其内部路径拼接函数。跨进程部分对 `RunOutputPort` 同时运行 HTTP Adapter contract test 和内存 Adapter contract test。

### 契约测试

- 合法/非法 `dataset-view.json`；
- 现有 DJ JSON/JSONL/stats/媒体文件在构建展示契约前后 hash 不变；
- 绝对输入路径不成为可预览 asset，复制到 Run 输出后的相对业务文件可以进入；
- 稳定标签 key 正确解析中文显示名，阈值映射可复现；文件角色和运行状态不会出现在样本标签筛选；
- 样本级事实能够重算数据集级标签计数和指标摘要，伪造摘要被拒绝或覆盖；
- 旧 Run 默认视图；
- 标签、文件名、文件类型筛选；
- 稳定分页和排序；
- succeeded/partial 状态映射以及 failed/无输出排除规则；
- 跨工作区历史导入、origin 幂等和全局 ID 唯一性；
- degraded 回退。
- Result Publication 重复通知、进程重启、发布失败重试和 origin 幂等。

### 安全测试

- `../`、绝对路径、UNC、盘符和编码路径穿越；
- 输出目录外文件、符号链接和替换竞态；
- 未知 dataset/asset/archive id；
- 浏览器提交 `workspace_root`、`output_dir` 或路径字段必须拒绝；
- 缺失/错误内部凭据不得调用 Plan Flow 受信路由；
- MIME 欺骗与 `nosniff`；
- ZIP Slip、重复路径和超大选择；
- 删除其他 Run、工作区根或 worker 根必须失败；
- 用户 A 无法列表、查看、下载、归档或删除用户 B 的结果；伪造 `ownerUserId`、S3 Key 或资源 ID 不得绕过；
- 所有者 Session、CSRF、manifest hash 或确认任一缺失时删除失败；管理员跨用户删除缺少二次确认时失败；
- 本机与 S3 Adapter 使用同一授权契约；短期签名地址只能在授权后生成；
- 公共响应不得包含 `D:\...`、容器 ID 或模型路径。

### 页面测试

- 处理中到成功的状态更新；
- 页面隐藏、恢复、历史会话重挂载和重启后的卡片状态恢复；
- 聊天按钮与左侧列表指向同一数据集；
- `/results/{dataset_id}` 与样本深链接支持复制、刷新、重新登录及前进/后退；
- `validating/publishing` 阶段不提前显示可用结果，完成后按钮原位更新；
- 左侧顶部顺序稳定为“记忆系统 → 算子库 → 结果中心 → 工作区”，折叠和刷新后位置不漂移；
- 图片懒加载和视频 Range；
- JSONL 分页、搜索；
- 筛选后勾选下载；
- 删除确认和删除后状态；
- 空结果/失败不进入中心、部分完成提示、契约损坏、文件缺失和容量不足。

### 真实验收

至少准备四条端到端 fixture：

1. 约 300 张图片，含标签和质量分；
2. 多个 MP4 和 JSONL 指标；
3. 混合图片、视频、JSON、未知文件；
4. 一个取消但存在可验证输出的 Run，以及一个执行失败或无输出、不应进入中心的 Run。

另使用普通用户 A、普通用户 B 和管理员验证所有资源接口隔离；使用两个不同运行验证每次运行产生独立结果；使用至少一个认证前历史 Run 验证归属迁移和 `unclaimed`。

本机验收必须从创建新 Plan/Run 开始，禁止预先手写 `dataset-view.json`、复制样本到结果目录或直接调用 Catalog 登记；只有这样才能证明自动链路成立。S3 验收还必须注入“部分对象上传成功后断线”，确认 staging 不可见、重试幂等、最终 available 后聊天链接和本机阶段格式完全一致。

## 12. 分阶段验收标准

1. 左侧“结果中心”紧接“算子库”下方并位于“工作区”上方；普通用户只看到自己的输出结果，管理员可进入明确标识的跨用户管理视图。
2. 聊天中符合进入规则的终态运行显示摘要和“查看结果”按钮。
3. 运行中聊天卡片能自动刷新到终态，重启后可恢复；失败、含错误或无输出的运行不进入结果中心。
4. 成功数据集能预览图片、播放视频、查看 JSON/JSONL。
5. 能按标签、文件名和文件类型筛选。
6. 能下载单文件、所有业务输出 ZIP 和勾选数据项 ZIP。
7. 无报错且有可验证输出的非完整运行标记为“部分完成”；执行错误留在原聊天。
8. 普通用户能查看自己的文件数和总占用；管理员能查看全局及按用户占用。
9. 普通用户只能查看、下载和删除自己的结果；管理员可管理全部；所有删除都不能越界。
10. 页面及浏览器 HTTP 响应不暴露宿主机绝对路径；内部 Plan Flow 路由不能被浏览器直接使用。
11. DSH 和 Plan Flow 重启后数据集、历史导入和归档状态均可恢复。
12. 认证前历史 Run 被幂等归属首个管理员，无法确认的结果不暴露给普通用户；不同运行不会覆盖。
13. 没有 `dataset-view.json` 的旧管线输出仍可基本浏览和下载。
14. 有 `output_contract` 的管线能稳定展示标签、质量指标和媒体关联。
15. 阶段 F 完成后，从本机切换到 S3 时页面接口和不透明资源 ID 不变，Bucket 和前缀可配置。
16. 新 Run 终态主动触发 Result Publication，不依赖用户打开结果中心或扫描最近对话；发布中聊天显示进度，发布成功后自动出现可刷新、可复制的详情链接。
17. 现有 DJ 业务输出保持原文件名和内容；展示契约只引用或解释它们，不覆盖原始 JSON/JSONL、媒体或模型附件。
18. 样本标签、文件角色、质量指标和运行状态在 schema、筛选和页面上保持独立；标签规则来自 Plan `output_contract`，页面不猜测。
19. S3 上传未完整校验时结果不对普通用户可见；删除失败保持不可访问并后台重试，管理员能看到状态。

## 13. 明确不在第一版范围内

- 用户间分享结果和公开结果链接；
- 远程用户上传图片/视频和上传后的临时文件生命周期；
- 自动过期与按用户配额；
- 第一阶段不启用 S3；阶段 F 在 GPU 服务器部署时实现；
- 网页编辑 JSON/JSONL；
- 原始输入管理；
- 原图/结果对比、蒙版叠加；
- 视频转码和多码率播放；
- 超大数据集的分布式索引；
- 跨 DSH 实例或跨主机的数据集聚合。

这些能力通过 Catalog 接口、展示契约和存储 Adapter 预留，不阻塞当前几百条数据的体验版。
