# DSH × Data-Juicer 自定义算子生成链路：实现记录与踩坑总结

更新时间：2026-09-07  
适用代码：`D:\dsh-app`、`D:\dj\data-juicer-1.5.4`  
执行后端：Native `PlanRunner → LocalProcessBackend → DJ executor`，不包含 DockerBackend

## 1. 背景

DSH 需要同时使用两类能力：

- DJ Built-in Catalog：Data-Juicer 正式维护的高质量原生算子；
- User Custom Catalog：当前账号私有的补缺算子，允许处于 `validated` 或 `experimental` 状态。

自定义算子的目标不是直接修改 DJ 正式库，而是在确认原生能力缺口或原生效果不足后，由 Agent 生成一个 Data-Juicer 兼容算子，使用临时样本验证，成功后自动发布到当前账号目录。后续能力检索、Plan 编排和正式执行可以同时使用 DJ 与个人算子。

个人算子目录保持与 DJ 类别一致。当前实现以 `DSH_USER_DATA_ROOT` 和
`UserOperatorStore` 解析出的账号目录为准：

```text
<DSH_USER_DATA_ROOT>/<user-id>/
├── custom_operators/
│   ├── mapper/<operator-id>/
│   ├── filter/<operator-id>/
│   ├── selector/<operator-id>/
│   ├── deduplicator/<operator-id>/
│   ├── aggregator/<operator-id>/
│   ├── grouper/<operator-id>/
│   └── pipeline/<operator-id>/
├── operator_jobs/
├── operator_tmp/
└── operator_runtimes/
```

调用方不应自行拼接账号路径，只能通过 DJ MCP 返回的 `candidate_id`
引用个人算子。

## 2. 最终架构

```text
DSH Agent
   │
   ├─ search_capabilities
   │    ├─ provider=dj
   │    └─ provider=user
   │
   ├─ 确认原生能力缺口或质量不足
   │
   ├─ get_custom_operator_authoring_spec
   │    └─ 返回当前 DJ 版本对应的类别脚手架
   │
   ├─ develop_custom_operator
   │    ├─ 同步 AST 源码预检
   │    └─ 异步真实 DJ 验证
   │
   ├─ get_custom_operator_job
   │
   └─ 成功后进入当前账号 User Custom Catalog
```

版本相关的基类、方法和注册知识属于 DJ，不属于 DSH。接口 seam 因此放在 DJ MCP：DSH 只负责编排，DJ 负责告诉 Agent“当前版本怎样才是合法算子”，并执行最终验证。

## 3. 本次代码修改

### 3.1 新增 OperatorAuthoring 模块

文件：

```text
D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\operator_authoring.py
```

模块提供两个核心接口：

```python
operator_authoring.get_spec(category, modality)
operator_authoring.lint(name, category, source)
```

`get_spec` 支持以下类别：

- `mapper`
- `filter`
- `selector`
- `deduplicator`
- `aggregator`
- `grouper`
- `pipeline`

支持的 modality：

- `generic`
- `text`
- `image`
- `audio`
- `video`
- `multimodal`

返回内容包括：

- `dj_version`
- `contract_version=dj-operator-authoring/v2`
- `base_class`
- `required_methods`
- `forbidden_overrides`
- `registration`
- `source_scaffold`
- `modality_notes`
- `model_policy`：按“复用 DJ → 无模型 → API VLM → 远程模型 → 本地模型”选择一种策略，并说明依赖锁定、模型冻结、缓存和确认条件
- 可选融合注册约定，例如图像的 `LOADED_IMAGES`

### 3.2 新增 MCP 工具

文件：

```text
D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\server.py
```

新增只读工具：

```python
get_custom_operator_authoring_spec(
    category: str,
    modality: str = "generic",
)
```

工具由 DJ MCP 暴露，经现有 `/internal/operator-tools` 被 DSH 动态发现，最终名称为：

```text
mcp__dj__get_custom_operator_authoring_spec
```

`dj-bridge.js` 本身不需要硬编码新工具，因为它启动时会读取完整工具目录并逐项注册。本次只补充了动态发现的回归测试。

MCP 工具总数由 13 增加到 14。

### 3.3 develop_custom_operator 同步预检

文件：

```text
D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\user_operator_validation.py
```

`develop_custom_operator` 现在会在以下操作之前调用 `operator_authoring.lint`：

- 冻结 validation contract；
- 创建 job；
- 创建 draft；
- 复制测试媒体；
- 创建 operator_tmp；
- 启动异步 worker。

同步预检检查：

1. Python 语法；
2. 当前 DJ 版本的基类 import；
3. `OPERATORS` 注册表 import；
4. 声明类别与继承基类是否一致；
5. 必需方法是否存在；
6. 是否覆盖 DJ 禁止覆盖的方法；
7. 注册名是否与 proposal.name 一致；
8. 是否恰好注册一个新算子；
9. 是否与 DJ Built-in Catalog 重名；
10. 已知的错误或过时接口。

失败返回示例：

```json
{
  "ok": false,
  "error": {
    "code": "OPERATOR_SOURCE_INCOMPATIBLE",
    "message": "Generated source does not match the running DJ operator interface",
    "details": {
      "phase": "source_preflight",
      "contract_version": "dj-operator-authoring/v2",
      "diagnostics": []
    }
  }
}
```

这样，接口错误不会再进入异步任务，也不会留下待清理文件。

### 3.4 异步错误阶段化

静态预检无法判断的依赖加载、运行和验收错误仍由真实 worker 处理。job 现在增加：

```json
{
  "error_details": {
    "phase": "schema | execute | contract | publish | runtime_setup"
  }
}
```

Agent 可以区分：

- 源码结构不兼容；
- schema/import 阶段失败；
- 真正执行失败；
- 验收断言失败；
- 发布失败；
- 账号运行环境准备失败。

### 3.5 DSH Skill 修改

文件：

```text
D:\dsh-app\.dsh\skills\data-juicer-plan-flow-zh\SKILL.md
D:\dsh-app\.dsh\skills\data-juicer-plan-flow\SKILL.md
```

新增约束：

1. 确认 capability gap 后，必须调用一次 authoring spec；
2. 必须从 `source_scaffold` 开始实现；
3. 不得凭记忆猜 DJ 接口；
4. `OPERATOR_SOURCE_INCOMPATIBLE` 只按 diagnostics 修正；
5. 最多自动修正两次；
6. 禁止搜索全盘、Anaconda、DJ 源码目录或互联网寻找基类；
7. 仅当 job 为 `testing` 时轮询；
8. `failed/cancelled` 后立即停止轮询；
9. 自定义算子验证成功前，不得提前生成 postprocess 或业务输出目录。

### 3.6 文档和测试

更新：

```text
D:\dsh-app\docs\architecture\user-custom-operator-catalog-design.zh-CN.md
D:\dj\data-juicer-1.5.4\tests\tools\plan_flow\test_plan_flow.py
D:\dj\data-juicer-1.5.4\tests\tools\plan_flow\test_user_operators.py
D:\dsh-app\packages\dsh-user-auth\test\dj-bridge.test.mjs
```

新增：

```text
D:\dj\data-juicer-1.5.4\tests\tools\plan_flow\test_operator_authoring.py
```

## 4. 正确的 DJ 1.5.4 Filter 写法

本次失败代码使用了不存在的接口：

```python
from data_juicer.ops.base_filter import BaseFilter, OP_REGISTRY

@OP_REGISTRY.register()
class FaceClarityFilter(BaseFilter):
    def compute_stats(self, sample, context=False):
        ...

    def is_keep(self, sample):
        ...
```

DJ 1.5.4 的正确基本结构是：

```python
from data_juicer.ops.base_op import OPERATORS, Filter
from data_juicer.utils.constant import Fields

OP_NAME = "face_clarity_filter"


@OPERATORS.register_module(OP_NAME)
class FaceClarityFilter(Filter):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._init_parameters = self.remove_extra_parameters(locals())

    def compute_stats_single(self, sample, context=False):
        ...
        return sample

    def process_single(self, sample):
        return True
```

关键点：

- 没有 `data_juicer.ops.base_filter`；
- 没有 `BaseFilter`；
- 注册表是 `OPERATORS`；
- Filter 子类必须实现 `compute_stats_single` 和 `process_single`；
- DJ 1.5.4 明确禁止 Filter 子类覆盖 `compute_stats` 和 `process`；
- `is_keep` 不是当前 Filter 基类要求的方法。

## 5. 为什么之前的水印算子能运行

水印算子使用了正确的 DJ 1.5.4 Mapper 接口：

```python
from data_juicer.ops.base_op import OPERATORS, Mapper

@OPERATORS.register_module(OP_NAME)
class ImageWatermarkRemoveMapper(Mapper):
    def process_single(self, sample):
        ...
```

它能运行并不证明模型可以稳定地无模板生成任意 DJ 算子：

- 该源码来自已有 DJ 风格实现的迁移，已经包含正确接口；
- Mapper 和 Filter 的方法约定不同；
- 本次人脸 Filter 是从零生成，模型猜中了其他框架或旧版本风格；
- 水印算子是 `execution_passed=true`，但 `acceptance_passed=false`；
- 水印算子当前状态是 `experimental`，不是视觉质量已经验证的 `validated`。

新预检已使用现有水印 Mapper 风格做兼容回归，原 candidate ID、版本和源码没有修改。

## 6. 本次实际遇到的问题

### 6.1 DSH 页面标题存在但页面空白

症状：浏览器标题显示 DeepSeek Harness，但页面没有内容。

实际原因：

- `web-dj.ps1` 发现 8010 已有监听后复用了旧 MCP；
- 旧 MCP 没有 `/internal/operator-tools`；
- DSH 的 `dj-bridge` 启动发现请求得到 HTTP 404；
- DSH 随后退出，57035 没有真实监听；
- 浏览器仍显示缓存的标题和空壳页面。

经验：

- 不能只看浏览器标题；
- 必须同时检查 57035、8010 监听、HTTP 200 和页面实际 DOM；
- 修改 MCP 工具或 route 后，刷新网页不够，必须重启 MCP 和 DSH；
- 启动脚本以后应增加兼容性探测，不能仅凭端口存在就复用旧进程。

### 6.2 最新会话看似卡住

会话时间线：

- 两次模型请求出现 `TRANSPORT / Connection error`，各重试 5 次；
- 自定义算子 job 在约 3 秒内已经失败；
- `get_custom_operator_job` 正确返回失败状态；
- Agent 随后搜索默认 Python、Anaconda、磁盘和 GitHub寻找 DJ 接口；
- 会话最终事件是 `aborted / user`，不是 MCP worker 死锁。

经验：

- “页面持续很久”不等于后端 job 仍在执行；
- 必须区分模型 transport、MCP 工具、异步 job、Agent 自身搜索四种状态；
- job 失败后应立即停止轮询和环境探索；
- DJ 接口知识应由 MCP 返回，不能让 Agent搜索宿主机。

### 6.3 自由源码接口过浅

原始 `develop_custom_operator` 只要求 Agent 提交完整 Python source，却没有提供当前 DJ 的 authoring contract。调用方必须知道：

- 当前 DJ 版本；
- 基类位置；
- 注册表；
- 方法签名；
- 禁止覆盖的方法；
- modality 融合约定。

这些复杂度泄漏到了 Agent，导致“同一功能有时成功、有时猜错”。新增 OperatorAuthoring 模块后，复杂度集中在 DJ 侧，DSH 只学习一个小接口。

### 6.4 测试失败可能留下 Windows 文件锁

在红色测试阶段，预检尚未实现，错误源码意外创建了异步 job。pytest 退出时，账号隔离 Python 环境的 `python.exe` 一度被 Windows 锁定，`TemporaryDirectory` 清理报 `WinError 5`。

处理原则：

- 先确认精确测试目录；
- 检查没有相关 worker 进程；
- 只清理该测试目录；
- 不删除工作区根目录或宽泛路径；
- 最终确认 `.test-tmp` 不存在、用户 `operator_tmp` 为空。

这进一步说明源码预检必须发生在运行环境和 job 创建之前。

### 6.5 工具面快照测试需要同步更新

新增 MCP 工具后，原测试仍断言工具数量为 13，因此全量回归出现唯一失败。更新后的期望为 14，并明确包含：

```text
get_custom_operator_authoring_spec
```

经验：工具列表既是兼容性约束，也是产品接口的一部分；新增或移除工具必须同步更新精确集合测试。

## 7. 测试策略与结果

采用的主要测试 seam：

1. `get_custom_operator_authoring_spec(category, modality)` 的返回契约；
2. `develop_custom_operator(...)` 在 job 创建前的可观察行为；
3. `/internal/operator-tools` 的真实工具发现和账号转发；
4. NativeBackend 的真实个人算子验证与 DJ+个人混合 Pipeline。

覆盖内容：

- 七类脚手架可解析；
- 未知 category/modality 被拒绝；
- 错误 `base_filter/BaseFilter/OP_REGISTRY` 被同步拒绝；
- Filter 错误覆盖 `compute_stats` 被拒绝；
- 缺少 required methods 被拒绝；
- 虚假本地基类被拒绝；
- DJ 原生算子重名被拒绝；
- 注册第二个算子被拒绝；
- 同步失败不创建 job/draft/temp；
- 异步 import 失败标记为 schema 阶段；
- MCP 目录包含新工具；
- DSH bridge 自动暴露新工具；
- Mapper 真实验证、自动发布和混合 Pipeline 正常；
- 取消、超时和临时目录清理正常；
- 跨账号访问继续被拒绝。

最终结果：

```text
DJ tests/tools/plan_flow + tests/config/test_config_functions.py
213 passed, 5 skipped

DSH datasets + plan-explorer + user-auth
37 passed
```

新增 authoring 文件通过 Black、isort 和 Python 编译检查。5 个 skipped 为既有 Docker 相关用例，本次没有实现 DockerBackend。

## 8. 部署后验收

重启 DJ MCP 和 DSH 后进行了真实接口验证：

```text
DSH HTTP status       = 200
MCP tool count        = 14
authoring tool exists = true
DJ version            = 1.5.4
Filter required       = compute_stats_single, process_single
```

向真实 MCP 提交错误 Filter 源码：

```text
error.code          = OPERATOR_SOURCE_INCOMPATIBLE
error.details.phase = source_preflight
job files before    = 6
job files after     = 6
```

这证明错误源码被同步拒绝，没有创建异步验证任务。随后使用浏览器实际检查了页面 DOM，侧边栏、会话、账号和输入区均正常渲染。

## 9. 使用流程

推荐的 Agent 调用顺序：

```text
1. search_capabilities
2. get_capability_schemas
3. 确认 capability gap / 原生质量不足
4. get_custom_operator_authoring_spec(category, modality)
5. 从 source_scaffold 生成完整源码
6. develop_custom_operator
7. 若 source_preflight 失败，只按 diagnostics 修正
8. 若返回 job_id，仅在 testing 时调用 get_custom_operator_job
9. validated/experimental 后读取个人 candidate schema
10. 绑定 operator_bindings 并 prepare_plan
11. 用户批准后运行
```

个人算子绑定示例：

```yaml
operator_bindings:
  - step_index: 2
    provider: user
    operator_id: face_clarity_filter
    version: <content-hash>
```

禁止传递：

- user ID；
- 自定义源码路径；
- `custom_operator_paths`；
- 服务器密钥；
- 自报的 external operator name。

## 10. 缓存与资源规则

本次没有改变 DJ 和模型缓存规则：

- 个人算子代码、契约和验证记录进入当前账号目录；
- 新增依赖安装到账号隔离 Python 环境，不覆盖共享 DJ 环境；
- DJ assets、Hugging Face、Transformers、Torch、ModelScope 继续沿用启动进程传入的现有缓存；
- 模型不复制到 `operator_tmp`；
- 本地模型引用冻结内容 hash；
- 临时测试媒体和运行输出在 job 结束后删除。

## 11. 已知限制

1. AST 预检只验证 DJ 接口结构，不判断算法质量。
2. `validated` 只表示冻结的 JSON 验收断言通过，不等于视觉或语义质量普遍可靠。
3. 七类脚手架是最小合法结构；Deduplicator、Grouper、Pipeline 等 dataset-level 算子后续可以增加更具体但仍版本化的使用说明。
4. 第三方依赖是否可用仍需异步 runtime/schema 验证。
5. 模型服务的 `TRANSPORT` 错误独立于 DJ MCP，不能靠算子预检解决。
6. 当前启动脚本仍应进一步增强旧 MCP 兼容性探测，避免仅按端口复用旧进程。

## 12. 后续建议

按优先级建议继续：

1. `web-dj.ps1/web-dj.sh` 在复用 8010 前探测 `/internal/operator-tools` 和必需工具集合；
2. 在 DSH UI 中把 `source_preflight/schema/execute/contract/publish` 显示为明确阶段；
3. 为 image/audio/video 增加经过验证的 modality 示例，但保持单一 authoring spec 工具；
4. 增加真实图片质量验收 adapter，区分“能运行”和“效果达标”；
5. 为模型 TRANSPORT 重试单独提供状态，不再混入 DJ 工具失败；
6. 记录 authoring contract version 到已发布算子 manifest，方便 DJ 升级时做兼容性审计。

## 13. 核心结论

自定义算子可以由 Agent 生成，但不能让 Agent 猜测 DJ 插件接口。正确的职责分配是：

- DSH Agent 决定需要什么能力并生成算法实现；
- DJ MCP 提供当前版本的 authoring contract；
- DJ 在创建 job 前验证源码结构；
- NativeBackend 使用真实 DJ 执行临时测试；
- 通过后只发布到当前账号 Custom Catalog；
- Built-in Catalog 保持高质量、受维护，不被实验算子污染。
