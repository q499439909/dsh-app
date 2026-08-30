# P0–P8 实施与验收报告

日期：2026-08-31  
范围：Windows 本机、DSH 控制面、Data-Juicer Plan Flow、Docker Desktop、`D:\data\face\images`

## 结论

P0–P8 的代码阶段已落地并按阶段提交。真实 P7 使用 500 张 FFHQ 测试图片，在 `network=none`、只读根文件系统、drop all capabilities 和资源上限下完成：输出 30 条记录与 30 个 PNG mask，面积三分位（小/中/大）和区域亮度二分位（暗/正常）的六个组合各 5 条。

第二个新任务复用了同一批准 Capability、两个独立 Operator Artifact 和同一 Runtime，没有重新构建镜像。机器可读证据位于 `artifacts/face-capability/p7-result.json`。

## 阶段提交

| 阶段 | Data-Juicer | DSH |
|---|---|---|
| P0 | `22676b6` | — |
| P1 | `e58b28e` | — |
| P2 | `0bec2ac` | — |
| P3 | `df5a3a3` | — |
| P4 | `5969e43` | — |
| P5 | `578e800` | — |
| P6 | `025f22a` | `7141d61` |
| P7 | `f1df625` | `d80ac31` |
| P8 | 见本报告对应提交 | 见本报告对应提交 |

## P7 证据摘要

- 输入 Snapshot：500 文件，只从源目录复制到 Run staging 一次；容器 recipe 不含 Windows 路径。
- `op-face-region-mask-v3`：OpenCV Haar 检测并生成椭圆 face-region mask。
- `op-masked-region-analysis-v2`：通用 masked luminance/area、分位分层选择、选择后制品物化。
- Runtime：`runtime-91c7ca92061048a9d2bfcbe4`。
- 镜像：`sha256:f69126e812b7b3c33942c0333478b50e1f132d9684dd136703ffe43d373a62c3`。
- 主验收：`task_094ba0949265/plan_v001`，30 条，六格各 5 条。
- 复用验收：`task_b9c5a361099b/plan_v001`，Runtime 与镜像 ID 相同。
- 输出：32 个文件（30 mask、JSONL、result manifest），全部进入递归 hash inventory。

“不同人”在当前 FFHQ 子集没有 subject ID，因此本轮只能以 30 个不同源样本保证样貌样本不重复，不能把它表述为经过人脸 embedding 验证的身份唯一。若正式业务要求身份级唯一，应增加独立、可批准的 face-embedding/dedup Capability，并把阈值写入 Plan。

## 已固定的失败矩阵

| 故障 | 行为 |
|---|---|
| 浮动 revision、非白名单源、未知许可证、pickle | Fetch 前拒绝 |
| hash 不符、大小超限、失败下载 | 删除隔离区，不污染 Store |
| Windows wheel 用于 Linux Runtime | `WHEEL_PLATFORM_MISMATCH` |
| Artifact/Capability approval hash 变化 | 拒绝批准或发布 |
| 两个 Artifact 的依赖版本冲突 | 构建前 `RUNTIME_DEPENDENCY_CONFLICT` |
| Runtime composition cache 损坏 | `RUNTIME_CACHE_CORRUPT`，不静默重建 |
| 输入越界、丢失媒体、symlink | Snapshot 阶段拒绝 |
| Windows 路径进入容器 recipe | container entry 拒绝 |
| 输出 symlink、文件数或字节超限 | Artifact Collector 拒绝 |
| 同标题任务输出目录碰撞 | 输出路径纳入 `task_id` |
| bootstrap 被 forkserver 重导入 | 使用标准 `__main__` 入口 |
| OpenCV 对象不可 pickle | worker 内惰性构造；批准 Artifact 不覆盖，发布 v2/v3 |
| DJ 退出 0 但结果为空/配额不足 | 以输出契约判失败，不以容器退出码单独判成功 |
| MCP 缺 Runtime/Broker 配置 | `BROKER_REQUIRED`，绝不回退共享 venv |
| Broker 请求夹带 image/mount/docker args | Pydantic `extra=forbid` 返回 422 |

## 运行与维护

正式 Broker 使用 `runtime_id`，旧 `capability_id` facade 仅保留旧 H1/H2 回归兼容：

```powershell
D:\dj\.envs\dsh-dj\python.exe -m data_juicer.tools.plan_flow.broker `
  --workspace D:\data\face `
  --worker-root D:\data\dj-worker-p7 `
  --allow-runtime runtime-91c7ca92061048a9d2bfcbe4 `
  --host 127.0.0.1 `
  --port 8765
```

MCP 只连接 loopback Broker。Agent 不得到 Docker socket、任意 shell 下载接口或宿主挂载参数。新 Capability 先完成隔离验证与第一次审批；Plan 组合完成后再进行第二次审批。

P7 目录中的 Linux wheel 不进 Git；`dependency-lock.json` 保存来源、平台、版本、大小和 SHA-256，本机 wheelhouse 作为可清理、可重新获取的 Artifact 缓存。
