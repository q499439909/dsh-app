# DSH × Data-Juicer P0 / P1 修复记录

日期：2026-09-10。范围：按架构整改方案修改 DSH 宿主桥接、方案/结果界面、DJ Plan Flow 服务及两个 skill。代码已修改，未重启现有服务、未变更现有业务数据或擅自认领历史工作区。

## 1. 结果与设计边界

核心闭环由服务端代码管理：准备不可变版本 → 校验输入与输出契约 → 接收可信用户批准 → 幂等启动 Run → 受 deadline 约束执行 → 分别记录交付和验收。skill 保留需求理解、能力选择和解释结果，不再充当审批凭证或运行状态数据库。

本次主要修复当前实际使用的 **DSH 账号桥接 → DJ internal HTTP gateway → native worker** 路径。兼容 Broker/Docker 的现有测试仍保留；本次没有把 native 的全部新增能力移植为另一套容器调度系统。

## 2. P0 对照

| 原问题 | 已实现行为 | 主要代码 |
|---|---|---|
| Agent 可以批准自己生成的 Plan | DSH 不向 Agent 注册 approve_plan；internal tool gateway 也拒绝它。方案卡片通过同源 JSON POST 请求批准，宿主注入账号，DJ 检查账号、workspace/task 归属、版本 hash、有效性和运行环境。批准记录含 actor 与 decision_ref | DSH `dj-bridge.js`、plan-explorer `index.js`；DJ `server.py`、`service.py`、`store.py` |
| native 输入没有冻结 | prepare 时复制本地数据及媒体引用到 Plan 版本目录，改写 recipe 并登记 SHA-256；批准与运行前核验。原始文件后续变化不影响该版本，快照篡改阻断。失败保留原始 recipe 并标记草案无效 | `native_inputs.py`、`store.py` |
| 文案承诺的交付物没有实际步骤 | 受控流程必须声明 expected_outputs，每项绑定 recipe 的实际 export_path 或存在的 postprocess 索引；缺失或无效生产步骤在准备阶段报错。运行后检查文件、格式、字段与声明的数量条件 | `delivery.py`、`validation.py`、`local_worker.py` |

输入快照当前支持 JSON/JSONL、CSV/TSV、Parquet、文本；原始媒体目录先 inspect 为清单。远程/生成数据源及远程媒体需要先落地。单版本上限为 100000 个引用文件、10 GiB；不是全量大数据存储方案。媒体列需使用 DJ 标准名称或明确 image_key/video_key/audio_key。

“每个要求都被声明”仍需用户审查 Plan。结构校验能拒绝不存在的生成步骤，不能从任意自然语言自动证明业务要求已全部覆盖。不得把这项实现描述成语义理解的数学保证。

## 3. P1 对照

| 原问题 | 已实现行为 | 主要代码 |
|---|---|---|
| 重试会新建 Run | 宿主以 session + callId 注入 request_id；同请求同参数复用原 Run，参数冲突报错；新调用可显式重跑。启动失败保留请求映射，避免响应丢失后盲目重启 | `dj-bridge.js`、`runner.py` |
| native deadline 仅为字段 | run_plan 暴露 timeout_seconds，默认 3600 秒；独立 watchdog 覆盖模型准备、DJ 执行和后处理，不依赖 UI/get_run 轮询。范围 1～604800 秒 | `local_process.py`、`execution/supervisor.py` |
| cancel 返回早于清理 | 状态先进入 cancelling/cleanup_pending；等待进程树退出，必要时强停；确认清理后再写终态。状态使用跨进程锁，迟到 worker 回调不能覆盖终态 | `execution/supervisor.py`、`local_worker.py`、`runner.py` |
| 执行成功等于验收通过 | execution_status、delivery_status、acceptance_status、task_status 分开；输出写 acceptance.json。row_count、field_equals 可自动验证；manual 或未覆盖的文字标准保持 unverified。两类验证都通过才 completed | `delivery.py`、`local_worker.py` |
| 错误缺少可追踪产物 | worker 异常保存 report.md 与 failure-manifest.json；超时/丢失保留 Run 错误码和日志。失败诊断不伪装为业务成果 | `local_worker.py`、`execution/supervisor.py` |
| 跨账号资源边界不一致 | 独占 workspace registry + task owner，拒绝不同账号的嵌套重叠工作区；工作区会话创建/执行入口检查授权。DJ 输入、Plan、Run、结果文件/压缩包/删除检查账号归属 | `task_control.py`、`server.py`、`workspace-access.js` |
| 从聊天 JSON 推导结果归属 | 生产 reconcile 使用 DJ 权威账号 Run 列表，并再次核验结果 owner；聊天内容不再拥有认领权限。刷新使用同一结果 ID 更新状态，已删除结果不复活 | datasets `index.js`、`run-output-http.js`、`dataset-catalog.js` |
| 界面错过后续运行 | reconcile 仅合并正在进行的请求；结果卡自行查询运行状态；preparing_models/cancelling 继续等待；打开的结果列表周期刷新，方案页事件也触发刷新 | datasets/plan-explorer `client.js` |
| 个人算子开发环路无硬预算 | develop 与 validate 的 request_id/task scope 由宿主注入。每账号最多两个活动验证，每会话每天最多三次提交；相同请求重放不重复消耗。取消落盘；模型准备改为受同一 deadline 管理的子进程；宿主消失时 watchdog 清理 | `user_operator_validation.py`、`user_operator_prepare.py`、`operator_watchdog.py` |
| skill 过重 | 一个主入口；澄清、Plan 契约和自定义开发按需加载。requirements skill 仅作兼容转入。去掉固定三次确认和强制 TaskSpec 前置步骤 | 两个 skill 及 references |

个人算子的预算目前是明确的保守默认值，未新增预算购买、延期、管理员重置 UI。耗尽后向用户说明，不通过改 ID 绕过。普通计划无需因这些开发细则增加固定确认。

## 4. 新 Plan 最小输出契约示例

```yaml
recipe:
  dataset_path: /workspace/input.jsonl
  export_path: ${RUN_OUTPUT}/result.jsonl
  process:
    - text_length_filter:
        min_len: 1
expected_outputs:
  - id: corpus
    path: result.jsonl
    format: jsonl
    producer:
      kind: recipe
    required_fields: [text]
    min_records: 1
acceptance_checks:
  - id: nonempty
    kind: row_count
    output_id: corpus
    min: 1
```

报告、筛选后清单、媒体复制等必须各有实际步骤与相应输出声明；不能只写“运行之后再处理”。图像质量、语义准确率等需另有可解释的评估证据；没有证据时保持未验证。

## 5. 部署与历史数据迁移

本次没有运行迁移命令，也没有重启现有服务。新规则默认拒绝未登记工作区，直接只替换其中一个服务可能造成兼容问题；应在没有活动 Run 时成套切换 DJ 和 DSH。

1. 保留两个仓库的修改及现有运行数据备份。DJ 环境需要 `filelock>=3.12`（本机已有 3.32.3）。DSH 使用本地 packages 时需确保安装产物/打包产物实际包含新文件，不能只更新源码后假定在线服务已加载。
2. DSH 与 DJ 使用同一 `DSH_USER_DATA_ROOT`，并保持原有 internal token 配置。不要将 token 写入 Plan 或用户可见参数。
3. 管理员核对真实账号 ID 和业务工作区后，运行下列本地管理命令。它没有暴露成 MCP tool，不会从聊天推断所有者。

```powershell
Set-Location D:/dj/data-juicer-1.5.4
D:/dj/.envs/dsh-dj/python.exe -X utf8 -m data_juicer.tools.plan_flow.control_admin `
  --user-data-root D:/dsh-app/.dsh/users `
  --workspace D:/your-business-workspace `
  --owner ACTUAL_ACCOUNT_ID
```

需要迁移的旧 task 逐个追加 `--migrate-task task_xxx`，可重复该参数。迁移只给明确指定的 task.yaml 写 owner，并保存 task.before-owner-migration.yaml；不会替换其他账号 owner，也不会改 Plan 内容或伪造审批。不要把示例占位符直接用于真实数据。

4. 历史 native Plan 缺少 input_snapshot、输出契约或可信审批记录时，创建新版本并在 UI 批准。不要直接补写旧 hash/approval.json。已迁移的历史成果可以读取，但不能因此宣称旧运行已经通过新验收规则。
5. 反向代理 HTTPS 部署要给 plan-explorer 配置准确的 `publicOrigin`；默认按请求连接和 Host 检查 Origin。不得通过允许任意 Origin 绕过审批入口。
6. 重启并刷新前端后，以已登记账号做一次小数据联调：准备 → 卡片批准 → 运行 → 结果刷新 → 第二次运行；另测越权账号访问、取消和旧 Plan 重新创建。

回退应同时回退 DSH/DJ 代码并暂停写入；保留 registry 和历史元数据备份，不自动删除新版本或运行成果。旧服务不理解新约束，因此回退也意味着暂时失去这些约束。

## 6. 验证

最终测试结果：DJ **189 passed、5 skipped**（135.03 秒）；DSH **40 passed**。5 项跳过分别为 4 项需显式启用的 Docker 实机测试，以及 1 项当前 Windows 无法创建符号链接的测试。`git diff --check` 在两个仓库均通过。执行命令：

```powershell
# DJ 仓库
D:/dj/.envs/dsh-dj/python.exe -X utf8 -m pytest tests/tools/plan_flow -q --disable-warnings
# DSH 仓库
node --test packages/dsh-user-auth/test/*.test.mjs packages/dsh-dj-plan-explorer/test/*.test.mjs packages/dsh-dj-datasets/test/*.test.mjs
```

新增覆盖包括真实子进程 deadline、真实父子进程取消、输入及媒体快照篡改、请求重放/冲突、开发预算、模型准备共享超时与持久化取消、验证宿主消失后清理、取消后迟到回写、HTTP 审批身份与跨账号拒绝。现有个人算子真实执行集成测试继续覆盖发布和清理。

## 7. 仍需区分的边界

- 本次是应用层身份与流程约束。native worker 及自定义 Python 仍与宿主处于同一 OS 权限域；移除了继承环境中的 DSH 管理凭证，但这不是恶意代码沙箱。面对不可信代码/多租户，需要独立系统账号或容器、文件 ACL、网络及凭证隔离。这属于部署隔离工作，不能靠 skill 补足。
- 后台 polling 是本次结果同步实现，没有新增消息队列/事件总线；Run 真相保存在 DJ，界面投影可重建。
- 尚未对正在使用的在线浏览器执行完整双账号、连续两次业务管线端到端验收，也未重跑真实大模型质量评估。不能把单元/集成测试通过说成生产切换完成。
- 旧审计探针和案例文件用于记录修复前行为，不作为修复后运行报告；新增契约测试是本次回归依据。
