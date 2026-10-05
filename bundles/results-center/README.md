# 结果中心（Results Center）

DSH 侧栏插件：可视化浏览 Data-Juicer（DJ）运行输出。

## 功能

- 侧栏图标「结果中心」，点击在主区域打开面板；
- **自动发现**所有已注册工作区 `outputs/` 目录下的 DJ 运行（`run_r*` 目录，含历史），有产出的运行排前；
- 运行卡片：任务 / 方案 / 运行号、状态、时间、输出数量，以及 `split_summary.json` 汇总徽章（如 cats / dogs / excluded）；
- 运行详情：
  - 依 JSONL 清单自动分组（如 cats / dogs / excluded / processed），网格缩略图 + 元数据徽章（category、capture、tags、exclusion_reason）；
  - 点击图片查看大图 + 完整元数据表（含 `__dj__meta__`）+ 下载；
  - 运行目录外的图片引用显示占位符（不越出 run 目录，见安全设计）；
  - 其他文件区：报告（`*.md`、`*.json` 等）在线预览与下载；
- 中英文界面，深浅色主题自适应。

## 数据来源

- 通过 Host 的 `workspaceRegistry` 服务枚举工作区，扫描 `<workspace>/outputs/**/run_r*`；
- 读取运行目录内 `result-manifest.json`、`split_summary.json` 与各 `*.jsonl`；
- 图片文件流式读取自运行目录本身。

## API（Host 半边注册的路由）

| 路由 | 作用 |
|---|---|
| `GET /api/results-center/runs` | 运行列表 |
| `GET /api/results-center/run?ref=<run目录>` | 单次运行的文件清单、分组与记录 |
| `GET /api/results-center/asset?ref=&path=` | 流式读取运行目录内的单个文件 |

## 安全设计

- 三条路由均为只读 GET，同源校验（Origin 不匹配拒绝）；
- `ref` 必须命中已发现工作区 `outputs` 下的 `run_r*` 目录，`path` 强制限制在该目录内（拒绝 `..`、绝对路径、盘符）；
- 响应带 `nosniff`；不暴露工作区 outputs 之外的任何文件。

## 安装

见[上级 README](../README.md)。前置：DSH ≥ 0.2.0-rc.2（需要 `sidebar.panellist` 与 `main` 插槽、`workspaceRegistry` 服务，均为标准内置）。

## 已知限制

- 每个工作区最多发现 100 个运行、每个运行最多 2000 个文件 / 每组 2000 条记录、JSONL 上限 20MB；
- 运行目录外的图片引用（如 DJ 冻结输入副本）不显示缩略图；
- 不读取 run 目录的 `__dj__stats__` 统计字段（后续可加）。
