# DJ 按 uv.lock 校准环境：实施记录

日期：2026-09-11。用户已授权按现有 uv.lock 调整环境。本次同时更新了[trace 复盘方案](D:/dsh-app/docs/architecture/langfuse-0790e0b4-review-and-remediation-2026-09-10.md)。最新方案沿用标准 preset，以 skill 指导按需调用，补齐工具契约与工程边界；结构化问答审批等改造尚待实现，不要求新增 preset 或分状态裁剪工具。

## 结果

已构建、验证并切换到新环境：

`D:\dj\.envs\dsh-dj-uvlock-20260911\Scripts\python.exe`

DSH / DJ 已重载，在线健康及部署指纹一致。DSH 地址仍为 http://127.0.0.1:57035/，DJ 仍为 8010 端口，保留原来启用的 Langfuse 观测设置。

| 依赖 | 旧环境安装元数据 | 新环境安装元数据 | uv.lock |
|---|---|---|---|
| torch | 2.13.0 | 2.8.0 | 2.8.0 |
| torchvision | 0.28.0 | 0.23.0 | 0.23.0 |
| opencv-contrib-python | 4.11.0.86 | 4.11.0.86 | 4.11.0.86 |

新环境中 torch / torchvision 的运行时版本字符串分别是 `2.8.0+cpu`、`0.23.0+cpu`，安装元数据版本为表中值，实际 runtime-lock 检查已通过。

安装范围是原 Windows 数据处理服务所需的依赖闭包，共 147 个包；所有已安装包的版本均属于源 uv.lock 对当前平台/Python 适用的版本。没有强行安装全部可选 Linux/GPU extras，也没有为未使用的音频能力新增 torchaudio。该结论不等于所有 DJ 可选算子均已完成运行验证。

## 保持不变与变更

- 未修改 `D:\dj\data-juicer-1.5.4\uv.lock` 或 pyproject.toml。
- uv.lock SHA-256：`04d662d0fd6ec8ed1ffa98c1527ec947c883b0651ef71904496d3e0fbb66dc1e`。
- pyproject.toml SHA-256：`80974a68bec36fe957f27f1f2627e3343b0121812b561f19c42d494643994ef6`。
- [dsh-deployment.json](D:/dsh-app/dsh-deployment.json) 的 pythonExe 指向新环境；重新生成部署清单并重载 DJ、DSH。
- [web-dj.ps1](D:/dsh-app/web-dj.ps1) 兼容 Python 已位于 Scripts 目录的标准 Windows venv，避免错误追加 Scripts/Scripts。
- 未重跑用户的图片任务、修改 Plan、补写审批或迁移任务归属。

新环境采用标准 venv，包隔离，但基础解释器来自 `D:\dj\.envs\dsh-dj` 的 Conda Python 3.12.13。**旧目录既是回退环境，也是基础解释器来源，不要删除。** Windows venv 启动器会创建基础 Python 子进程，不能只凭监听进程 exe 看见旧目录就判断仍在使用旧包；本次同时核验了启动器父进程和服务返回的运行包指纹。

## 安装过程中的处理

1. 保存旧包清单、原部署配置、锁文件与哈希。
2. 通过 `uv export --frozen` 导出锁约束，沿用项目 `tool.uv.override-dependencies` 排除其他 OpenCV 发行包。
3. uv 安装时在更新 Windows PE 命令入口资源处两次失败，改用 pip 安装固定版本且带哈希的完整清单，并重装以修复可能的部分安装。没有关闭系统防护。
4. hf-xet 的导出约束包含小写 amd64，Windows 平台名称大小写差异使编译后的依赖清单曾选中 1.6.0。逐包检查发现后，在环境 requirements.in 中显式固定源锁的 1.1.5，重新生成清单并校正。源码锁文件未改。
5. 通过全部校验后，确认无活动 DJ worker，核对 PID/创建时间/命令行后停止旧 DJ、DSH 服务，再按新配置启动。保留原观测设置。

通用 `uv pip check` 仍报告一项元数据依赖差异：ultralytics 声明需要 opencv-python，但项目明确使用 opencv-contrib-python 并排除其他 OpenCV 包。此次遵循项目约束，没有伪造包元数据，也没有并装多个 cv2 包；通过实际 OpenCV 符号、人脸模型加载和算子初始化验证替代能力。

## 验证

| 检查 | 结果 |
|---|---|
| 147 个安装包与适用锁版本比较 | 通过，无版本漂移 |
| uv.lock / pyproject.toml 原始哈希 | 保持一致 |
| verify_runtime_lock，检查所有冻结的 audited packages | 通过 |
| torch Tensor + torchvision.ops.nms 实际运算 | 通过 |
| 唯一 OpenCV 发行包、Cascade 模型、人脸计数/比例算子初始化 | 通过 |
| DJ tests/tools/plan_flow | 199 passed，5 skipped，8 warnings，157.21 秒 |
| DSH 部署测试 | 3 passed |
| 在线 DJ health、DSH deploymentId、DJ build 指纹、venv 启动器 | 通过 |

当前部署 ID：`sha256:3e6197d42eaab8c52e35b04ecbe1477dd7bc6c47a215be5fa45cba5edbaa6dd5`。

运行包指纹：`sha256:9782a95d10e88c617faa8a0a8d087793a53125261c2c6cd8a4c3e0dc21ecde3d`。

原先因 torch 版本不一致而失败的检查已在新环境直接验证通过；这不代表用户原任务的全部模型、输入、业务验收或 UI 问题均已通过。

## 复核与回退资料

本地资料：[runtime-lock-20260911](D:/dsh-app/.dsh/diagnostics/runtime-lock-20260911)。包含 before.json、after.json、requirements.in、constraints.txt、overrides.txt、resolved.txt、原配置、source-hashes.json、在线检查结果及启动日志。

复核安装版本与实际运算：

```powershell
$env:PYTHONPATH = 'D:/dj/data-juicer-1.5.4'
D:/dj/.envs/dsh-dj-uvlock-20260911/Scripts/python.exe -X utf8 D:/dsh-app/.dsh/diagnostics/runtime-lock-20260911/verify-environment.py
D:/dj/.envs/dsh-dj-uvlock-20260911/Scripts/python.exe -X utf8 D:/dsh-app/.dsh/diagnostics/runtime-lock-20260911/check-live.py
```

如确需回退，先确认没有活动任务，再恢复保存的 deployment-before.json，重新生成部署清单并用同样的观测设置重载服务。回退只恢复先前部署，**旧环境仍存在依赖漂移**，不能把回退当作运行锁问题的修复。
