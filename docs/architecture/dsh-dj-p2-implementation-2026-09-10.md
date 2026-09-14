# DSH × Data-Juicer P2 修复记录

日期：2026-09-10。对应架构方案中的四项 P2。已修改代码、配置与测试；没有重启在线服务、迁移生产任务或下载新模型。

## 1. 修复对照

| P2 问题 | 实现 | 核验点 |
|---|---|---|
| 输入画像不足、采样范围不清 | 新增 input_profile 模块；显式计数、采样、字段统计、字段绑定和质量状态。媒体目录按完整清单判断类型，包含音频 | 样本只有 2 行时仍可返回总行数 3；截断扫描不伪称全量；样本之外的媒体类型也进入清单描述 |
| 内置与个人算子评分尺度不同 | 逐条需求分别排列 BM25 与 token coverage，再合并 reciprocal rank；保留原始方法、分数、来源排名和合并排名 | 大数值 BM25 不凭数值压过个人候选；精确匹配优先；不同需求不共享最大分数来决定当前排序 |
| 配置与实际 MCP 接线不同 | 配置明确为 internal-http gateway，保留 mcp__dj__ 工具名兼容旧会话；增加协议/特性握手及实例校验，复用已注册 MCP tool 的参数模型 | 旧 transport、协议不符、缺必需特性被拒绝；服务重启后同构建重新握手，重放保持 request_id |
| 部署依赖本机路径、缺版本身份和分层健康 | 新增部署配置/清单，参数化源码、Python、工作区、HF 缓存、代理和端口。源码、运行环境、DSH 补丁及插件/skill 都有指纹。规划、账号控制、执行与观测分层 | 不再仅凭 TCP 端口判断可复用；DJ 构建与 DSH 部署指纹均需匹配；人脸/GPU/模型和 Langfuse 不阻断不需要它们的基础规划 |

沿用 P0/P1 的审批、owner、输入快照、幂等和取消控制，没有恢复 Agent 自行批准或信任聊天 JSON 认领结果的路径。

## 2. 输入画像契约

`inspect_input` 保留现有 dataset_path、samples、fields 等字段，并新增：

```json
{
  "record_count": 3,
  "profile": {
    "schema_version": 1,
    "status": "complete",
    "record_count": {"value": 3, "exact": true, "observed": 3},
    "sample": {"method": "head", "limit": 2, "size": 2, "representative": false},
    "field_statistics": {"scope": "sample", "records": 2},
    "quality": "not_evaluated",
    "media_content": "not_decoded"
  }
}
```

这是字段示意，实际返回还包括字段的 present/missing/null/types 和警告。

- `complete` 表示计数完成或获得精确 Parquet 元数据，**不表示全部数据做过质量评估**。字段统计始终明确标记 sample 范围。
- `partial` 表示触及扫描限制；总数为 null，observed 是已观察数量。`empty` 和 `unsupported` 单独返回；解析错误使用 INPUT_PARSE_FAILED。
- 文件扫描最多 8 MiB、默认最多 100000 条记录；`input.max_scan_records` 可调低。文件 SHA-256 仍读取整个文件，其范围另行标明。
- JSON 大于扫描上限时不完整解析，返回 partial 并建议 JSONL/Parquet。Parquet 使用元数据计数和首批采样，不再为了取少量样本读取整张表。
- 样本为 head，不声称具有统计代表性。大字符串/深层结构会截断；二进制与时间等值转换为可 JSON 表达的预览。不要将这些预览当成原始执行数据。
- 原始媒体目录创建 manifest，清单最多检查 100000 个文件；超过上限拒绝生成悄悄截断的执行清单。跳过 .dj、符号链接目录和 junction，防止重复吸收自身制品。
- 媒体目录的类型和生成字段来自全清单，其他文件的字段类型来自样本。媒体内容没有解码，没有新增图像质量模型。

自定义列名可在 input 中显式声明：

```json
{"path":"records.jsonl","bindings":{"text_keys":["caption"],"image_key":"photo"},"max_scan_records":10000}
```

显式绑定未在样本中出现时返回 BINDING_NOT_OBSERVED。Agent 应据此澄清或补充检查，并把确认后的字段映射写入 recipe；不把推断字段视为用户已经确认的业务语义。真正的执行输入冻结仍由 P0 的 Plan snapshot 负责。

主要文件：[input_profile.py](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/input_profile.py)、[discovery.py](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/discovery.py)。

## 3. 搜索排序契约

每条需求有独立 retrieval/ranking 记录，候选定义跨需求去重：

1. 内置候选在自己的 BM25 列表内排序；个人候选先按自身 token coverage 排序。
2. 精确名称/个人 candidate_id 匹配优先。
3. 跨来源使用 `1 / (60 + source_rank)` 合并排名，平局按 validated、provider、candidate_id 稳定排序。
4. 返回 method、raw_score、source_rank、rank、fusion_score。兼容 match_score 改为排名派生相关度，不是概率或质量分。

这消除了直接比较异尺度分数的问题，**没有证明召回率或语义准确率已经提高**。当前 top_k 上限仍为 3，质量改善需后续固定业务查询集评测。没有为此引入 embedding 服务或新模型。

主要文件：[operator_catalog_service.py](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/operator_catalog_service.py)。

## 4. 实际网关与握手

配置插件 ID 改为 `dj-http-gateway`，transport 为 `internal-http`，baseUrl 是不含 `/mcp` 的 loopback 服务根地址。标准 MCP 服务仍存在；当前 DSH 使用的是同一服务提供的内部 HTTP adapter。

- `/internal/operator-tools` GET 返回工具定义、协议名称 `dsh-dj-internal-http`、版本 1、特性、instance_id 与构建身份。
- POST 必须携带协商的版本和实例；错误分别为 PROTOCOL_MISMATCH、SERVICE_RESTARTED。账号身份仍由宿主注入，不从模型参数获得。
- gateway 与 MCP 使用同一个注册函数及参数验证模型，再进入相同业务服务。不存在 gateway 另写一套宽松 schema 的接线。
- DSH 启动要求必需特性；设置 DSH_DJ_EXPECTED_BUILD 时同时检查部署期望构建。默认 failOnStartupError=true。
- 若显式设为 false，发现失败只停用 DJ 工具并记录警告，不注册假工具、也不假称连接成功；恢复时重启 DSH。
- 同构建的服务重启会重新发现并核对工具定义，然后用原 request_id 重试一次；协议/构建/工具定义发生变化时明确要求成套更新，不静默降级。
- `mcp__dj__*` 工具前缀保留，只是兼容名称，不再用它证明底层 transport 类型。

主要文件：[dj-bridge.js](D:/dsh-app/packages/dsh-user-auth/lib/dj-bridge.js)、[server.py](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/server.py)、[dj-dsh.patch.yml](D:/dsh-app/dj-dsh.patch.yml)。

## 5. 部署配置、指纹与健康

新增 [dsh-deployment.json](D:/dsh-app/dsh-deployment.json)，当前本机路径集中在此文件；相对路径相对于 DSH 仓库解析。其他机器修改此配置，无需修改启动脚本源码。

[deployment-manifest.mjs](D:/dsh-app/scripts/deployment-manifest.mjs) 生成：

- DJ 源码 `.py/.json` 内容摘要，不仅记录 git commit；模型 catalog、pyproject 和 uv.lock 摘要。
- Python 版本和可执行文件摘要，已安装包名称/版本及 RECORD 元数据摘要。
- DSH 版本、Node 版本、pnpm-lock、补丁文件、插件、skill 内容摘要。
- 生效路径/端口/模式、生成的 patch 摘要及稳定 deploymentId。生成时间不参与 deploymentId。

正式启动时生成 `.dsh/deployment/manifest.json` 与 `.dsh/deployment/dj.patch.yml`，该目录已忽略提交。原始 patch 是模板，运行 patch 会同步四个 DJ 接入地址；账号工作区检查使用同一端口环境配置。含空格路径已验证，并修复 Windows PowerShell 5.1 的默认配置路径和子进程参数引用。

`/internal/health` 需内部认证，分别报告 process、planning、account_control、execution、observability。执行层保持 per_plan，不在启动时下载所有模型或要求 GPU。原人脸探针保留为按需 `-Profile face`；默认规划探针仅核查基础组件与锁文件。

复用已有 DJ 进程时必须通过健康、执行模式、协议和构建一致性检查。DSH 的 `/auth/deployment` 只返回启动时捕获的部署 ID；已有 DSH 进程的 ID 不匹配时也拒绝复用，不返回配置或凭证。

清单是部署身份记录，不是完整系统镜像：DSH 的补丁摘要记录仓库制品，不单独证明用户 profile 内每个第三方包都已按补丁安装；运行环境 RECORD 摘要也不是逐文件反篡改沙箱。包安装和更新仍需现有包管理流程，P0/P1 的应用权限边界仍不等于 OS 隔离。

## 6. 个人算子依赖缓存

补齐方案中与运行环境身份相关的缓存缺口：overlay runtime ID 加入基座源码、锁文件、Python 和安装包身份。路径不变而基座变化时，不再复用旧 ready marker；正式运行提示先重新验证。

安装额外依赖时使用 pip report 保存每个制品 SHA-256。缺少必要 hash 不标记 ready；保留记录不含下载 URL。仍使用精确包版本，不自动更新共享 DJ 环境。

旧个人算子的已发布版本不删除，但旧 overlay 缓存可能需要调用 validate_custom_operator 重新验证后才能运行。这是有意的缓存失效，不应手工补写 ready.json 绕过。

主要文件：[deployment.py](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/deployment.py)、[user_operator_runtime.py](D:/dj/data-juicer-1.5.4/data_juicer/tools/plan_flow/user_operator_runtime.py)。

## 7. 启用步骤

1. 沿用 [P0/P1 迁移要求](D:/dsh-app/docs/architecture/dsh-dj-p0-p1-implementation-2026-09-10.md)，先明确账号和工作区授权；本次没有代填历史 owner。
2. 检查 dsh-deployment.json。HF_HOME 以该配置/命令行覆盖值为准，其他模型缓存变量保留现有环境配置行为。observability 默认 false；需要 Langfuse 时显式启用，并配置既有凭证文件。
3. 做配置预检和基础运行环境检查，均不会启动在线服务：

```powershell
Set-Location D:/dsh-app
./web-dj.ps1 -CheckOnly
./scripts/test-dj-runtime.ps1 -PythonExe D:/dj/.envs/dsh-dj/python.exe -DjRoot D:/dj/data-juicer-1.5.4 -Profile planning
```

临时覆盖示例：

```powershell
./web-dj.ps1 -CheckOnly -McpPort 8124 -Port 57124 -WorkspaceRoot 'D:/business data'
```

`-CheckOnly` 输出解析后的配置与身份，不读取凭证文件、不授权工作区、不启动服务；路径本身不会因此自动创建。其他覆盖参数包括 -DeploymentFile、-DjRoot、-PythonExe、-CacheRoot、-ProxyUrl、-ExecutionMode、-EnableObservability。

4. 在没有活动业务任务的窗口成套重启 DJ 与 DSH，再按原入口运行 `./web-dj.ps1`。老服务会被协议/构建检查拒绝，脚本不擅自终止原有进程。
5. 验证 inspect_input 的画像范围、个人候选搜索、新 Plan 批准/执行，以及结果更新。反向代理部署在配置中填写精确 publicOrigin。

## 8. 测试及实际执行范围

最终结果：

- DJ：**199 passed、5 skipped**，133.38 秒；5 个跳过项为 4 项需显式启用的 Docker 实机测试和 1 项当前 Windows 无法创建符号链接的测试。
- DSH：**46 passed**，含新增网关、部署和启动身份测试。
- 两个仓库 `git diff --check` 通过。

```powershell
# DJ 仓库
D:/dj/.envs/dsh-dj/python.exe -X utf8 -m pytest tests/tools/plan_flow -q --disable-warnings
# DSH 仓库
node --test scripts/test/*.test.mjs packages/dsh-user-auth/test/*.test.mjs packages/dsh-dj-plan-explorer/test/*.test.mjs packages/dsh-dj-datasets/test/*.test.mjs
```

已新增回归覆盖：样本与精确计数区分、截断/空/未知/损坏输入、目录样本外模态、Parquet 首批采样、异尺度排名、协议/实例/参数模型、dirty source 指纹、基座变化缓存失效、依赖制品 hash、网关重启重放、DSH 启动身份固定和配置参数覆盖。

已在 Windows PowerShell 5.1 运行自定义端口和含空格路径的 CheckOnly，两次生成的 deploymentId 一致；基础规划探针通过。没有执行生产浏览器完整联调、Docker 实机验证、远程额外包下载测试或新的模型质量评测。
