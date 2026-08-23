# Data-Juicer + DSH 中文交接文档

## 目标

在 Windows 上将 Data-Juicer（DJ）接入 DeepSeek Harness（DSH），形成可控、可复现的数据处理流程：

1. 模型先检查并分析数据；
2. 给出处理方案，等待用户明确确认；
3. 保存可审计、可复跑的 recipe；
4. 校验并执行这份固定 recipe；
5. 检查输出并记录结果。

下一段对话要重点讨论：不要继续依赖 DJ 自带的一次性 MCP 执行方式，而是设计一个 plan-first MCP 适配层。

## 三个目录的职责

```text
D:\dsh-app  DSH 程序壳、DSH 配置、启动器、DSH Skills
D:\dj       Data-Juicer 安装目录和 Python 虚拟环境
D:\shishi   用户在 DSH Web 中选定的数据工作区
```

这三个角色必须分开理解。DJ 依赖可以放在 `D:\dj`，但用户数据、输出、recipe、执行清单和临时运行文件应放在当前工作区；当前工作区是 `D:\shishi`。

## 当前运行状态

通常通过下列地址打开 DJ 版 DSH Web：

```text
http://127.0.0.1:49429/
```

DJ 自带 `recipe-flow` MCP 服务配置为：

```text
http://127.0.0.1:8000/mcp
```

`D:\dsh-app\web-dj.cmd` 会调用 `web-dj.ps1`。这个 PowerShell 启动器会：

- 若 8000 端口未监听，则启动 DJ MCP 服务；
- 使用 `D:\dsh-app\dj-dsh.patch.yml` 启动带 DJ 配置的 DSH；
- 启动 MCP Python 进程时设置 `TEMP`、`TMP`、`TMPDIR` 为 `D:\shishi\.dj\tmp`；
- 在指定端口启动 DSH，通常是 49429。

注意：停止或重启启动器会中断正在执行的 MCP 调用。之前至少有一次真实 `run_data_recipe` 调用在重启中被中断，因此任何既有输出都必须检查，不能假设已完整完成。

## 已完成的工作

### Data-Juicer 已可用

- 仓库：`D:\dj\data-juicer-agents`
- Python：`D:\dj\data-juicer-agents\.venv\Scripts\python.exe`
- CLI：`D:\dj\data-juicer-agents\.venv\Scripts\djx.exe`
- `djx tool list` 已可运行。
- 本地算子目录的 `retrieve_operators` 已测试成功。

不要轻易把 `D:\dj\data-juicer-1.5.4` 以 editable 方式安装到当前环境；该机器可能缺少原生编译依赖。当前可用运行时是虚拟环境中已经安装的包。

### DSH Skills 已接入

十个 DSH 兼容的 DJ Skill 位于：

```text
D:\dsh-app\.dsh\skills
```

主 Skill：

```text
D:\dsh-app\.dsh\skills\data-juicer\SKILL.md
```

DSH 要求 Skill 名称使用 kebab-case，因此原 CoPAW 的下划线命名已转换。`prepare-dj-skills.ps1` 会从 CoPAW 源文件重新生成十个 Skill、替换命名、将文本转为 ASCII 以避免编码乱码，并重新写入本地规则。

主 Skill 已包含确认门：

- 检查数据、检索算子、分析方案可以在未确认时进行；
- 写 recipe 或处理数据前，必须展示输入输出路径、算子、参数、预期效果、风险、校验方式和超时设置；
- `好`、`继续`、CLI 的 `--yes` 和工具参数中的 `confirm: true` 都不算用户确认；
- 必须等待用户后续明确确认；
- 如果路径或关键参数变化，必须重新确认。

主 Skill 目前写有“优先使用 `mcp__dj__*` 工具”的规则。完成 plan-first MCP 后，应重新检查这条规则是否要改成仅优先使用新的正式 MCP 工具。

### DSH MCP 配置已接入

配置文件：

```text
D:\dsh-app\dj-dsh.patch.yml
```

该文件启用了 Skill、PowerShell、文件系统、搜索和 jobs，并插入了 MCP 客户端实例：

```yaml
- insert:
    - id: mcp-dj
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: dj
        transport: streamable-http
        url: http://127.0.0.1:8000/mcp
        toolCallTimeoutMs: 1800000
        failOnStartupError: true
```

新增 DSH 插件时必须使用 `- insert:`。只写 `- id: mcp-dj` 会失败，因为普通 patch 只能覆盖已经存在的插件项。

### 当前 Recipe-Flow MCP 已连通

DSH 已成功连接并发现以下五个 MCP 工具：

```text
mcp__dj__get_global_config_schema
mcp__dj__get_dataset_load_strategies
mcp__dj__search_ops
mcp__dj__run_data_recipe
mcp__dj__analyze_dataset
```

当前实际运行的虚拟环境文件：

```text
D:\dj\data-juicer-agents\.venv\Lib\site-packages\data_juicer\tools\mcp_server.py
D:\dj\data-juicer-agents\.venv\Lib\site-packages\data_juicer\tools\DJ_mcp_recipe_flow.py
D:\dj\data-juicer-agents\.venv\Lib\site-packages\data_juicer\tools\DJ_mcp_granular_ops.py
D:\dj\data-juicer-agents\.venv\Lib\site-packages\data_juicer\tools\mcp_tool.py
```

`D:\dj\data-juicer-1.5.4` 中也有源码副本，但其哈希与当前虚拟环境不同；改那个源码副本不会影响正在运行的 MCP。

## 已确认的重要结论

### 自带 Recipe-Flow 不是可保存 Recipe 的工作流

`run_data_recipe` 只是把 `dataset_path`、`process`、`export_path`、`np` 和可选 `extra_config` 组成内存字典，然后立刻调用 `execute_op`。

它不会：

- 生成 plan ID；
- 保存 YAML 或 JSON recipe；
- 提供 dry-run；
- 生成可复现的已解析配置或执行清单；
- 强制要求人类确认。

它最终只返回输出路径。DSH 的工具调用历史和 MCP 服务端日志也许能看到参数，但二者都不是可审计的 recipe 工件。因此，自带 `recipe-flow` 适合快速实验，不适合正式、可复现的数据处理。

### Granular-Operators 也不能自动构建管道

`granular-ops` 会把每个算子动态暴露为一个 MCP 工具。每次调用只创建一个算子的 `process` 列表，并立刻执行 `execute_op`。

它不会把多个调用累积为一个 pipeline，也不会保存组合后的 recipe。默认还可能暴露非常大的工具目录。可以通过 `DJ_OPS_LIST_PATH` 限制暴露的算子集合，但这只能控制工具数量，不能解决可复现性问题。

Granular-Operators 适合单算子参数实验，例如单独比较一个去重算子的阈值；不适合作为正式流水线的主编排接口。

### Windows 临时文件问题已修复

原始错误：

```text
PermissionError: [Errno 13] Permission denied: ...job_dj_config_....json
```

`TEMP/TMP` 设置实际上已生效，临时文件确实进入 `D:\shishi\.dj\tmp`。真正原因不是目录无权限，而是 Windows 文件锁：`get_init_configs()` 使用 `tempfile.NamedTemporaryFile(delete=True)` 创建并保持打开临时文件，然后让 `jsonargparse` 按路径再次打开它；Windows 会拒绝这次重新打开。

已经修改实际运行时文件：

```text
D:\dj\data-juicer-agents\.venv\Lib\site-packages\data_juicer\config\config.py
```

修复逻辑为：使用 `delete=False` 创建文件，写完并关闭后再调用 `init_configs`，最后在 `finally` 中删除临时文件。直接执行 `get_init_configs()` 的验证已返回 `CONFIG_OK`。

这是对虚拟环境 site-package 的修改。更新或重装 `py-data-juicer` 后可能被覆盖；长期应将它做成受控的本地补丁或提交上游。

## 推荐的下一步架构：Plan-First MCP

不要继续把 `run_data_recipe` 扩展为一次性执行工具。应新增一个独立 MCP 模式或本地适配器，例如 `plan-flow`，接口保持小而明确：

```text
analyze_dataset
search_ops
prepare_recipe
save_recipe
validate_recipe
run_recipe
inspect_output
```

建议行为：

1. `prepare_recipe` 接收意图和已选算子，规范化顺序和参数，返回标准 recipe 对象与内容 hash，但不写数据。
2. `save_recipe` 在当前工作区保存 YAML，例如 `D:\shishi\.dj\plans\<name>.yaml`。
3. `validate_recipe` 只加载并校验固定 YAML，不处理数据。
4. `run_recipe` 只接受已保存的 recipe 路径和明确确认参数；写入执行清单，记录 recipe hash、DJ 版本、开始结束时间、输入输出路径和统计结果。
5. `inspect_output` 输出结果画像，并关联到执行清单。

现有 `djx` Harness 已经包含接近这个流程的工具：`inspect_dataset`、`retrieve_operators`、`build_*`、`assemble_plan`、`plan_save`、`apply_recipe`。最好的新 MCP 是将这些 plan 导向能力暴露出去，而不是再发明一套不兼容 recipe 格式。

## 需要讨论的三种实现路线

### 方案 A：直接修改自带 Recipe-Flow

在 `DJ_mcp_recipe_flow.py` 中增加 `prepare_recipe`、`save_recipe`、`validate_recipe`、`run_recipe`，并修改 `mcp_server.py` 新增模式或扩展 `recipe-flow`。

优点：

- 最快；
- 复用现有服务和 MCP 发现机制。

缺点：

- 修改虚拟环境包，升级会覆盖；
- 将本地策略混进上游代码；
- 必须谨慎控制 MCP 工具规模。

### 方案 B：新增本地 Plan-Flow MCP 适配器

在虚拟环境包之外新增一个有版本控制的本地模块，例如放在 `D:\dsh-app` 或独立扩展目录。它可调用现有 `djx` plan 工具或 DJ Python API，同时保持稳定的 plan-first 接口。

优点：

- 不会被 DJ 升级覆盖；
- DSH 与 DJ 之间有清晰、可测试的接口；
- 可以明确保存确认状态和执行清单；
- 更适合独立测试和长期维护。

缺点：

- 初始实现工作更多。

推荐方案：方案 B。

### 方案 C：MCP 只做分析，CLI 继续正式执行

现有 `recipe-flow` MCP 只用于 `analyze_dataset` 和 `search_ops`，正式执行继续使用 `djx plan_save + apply_recipe`。

优点：

- 立即具备可复现性；
- 不需要先写新适配器。

缺点：

- 有两套执行表面；
- 模型必须正确选择；
- 不如统一的 plan-first MCP 整洁。

在方案 B 完成前，方案 C 是最安全的过渡状态。

## 不要重复踩的坑

1. 不要混淆 DJ 安装目录和 DSH 选定的数据工作区。
2. 不要在已占用端口上启动第二个 DSH 服务。
3. 不要在真实 recipe 调用执行中重启 MCP 或 DSH。
4. workspace-write 场景不要使用系统 Temp，应使用工作区内临时目录。
5. 即使目录可写，也不要武断地把所有 `PermissionError` 归因于沙箱；这里真正原因是 Windows `NamedTemporaryFile` 锁。
6. 不要把模型密钥、敏感样本或完整服务端配置写入 MCP 日志、recipe 或交接文档。
7. 不要把 MCP 日志或模型工具调用历史当作可复现工件。
8. 不要默认暴露全部 granular operators；需要时用白名单。
9. 不要修改源码副本后假设运行时已改变；先确认实际 import 路径。
10. DSH Skill 名称必须是 kebab-case，不能用 underscore_case。
11. 即使执行从 CLI 迁移到 MCP，也必须保留“先分析、再确认、后执行”的确认门。
12. DSH 新增插件时使用 `- insert:`；普通 id patch 只能覆盖已有插件。

## 给下一段对话的建议提示词

```text
阅读 D:\dsh-app\DJ_DSH_HANDOFF.zh-CN.md。请为 Data-Juicer 和 DSH 设计方案 B：本地 plan-first MCP 适配器。接口保持小：分析、检索、准备 recipe、保存、校验、执行、检查输出。适配器必须生成标准 YAML recipe 和执行清单，在执行前强制明确确认，以 D:\shishi 为活动工作区，且不得记录密钥。先给出设计和权衡，不要立即修改文件。
```
