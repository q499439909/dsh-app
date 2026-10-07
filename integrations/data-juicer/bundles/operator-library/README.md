# 算子库（Operator Library）

DSH 侧栏插件：检索与查阅全部 Data-Juicer（DJ）算子。

## 功能

- 侧栏图标「算子库」，点击在主区域打开面板；
- 全量算子目录（当前 DJ 版本 227 个），卡片含中文名、英文名、分类徽章、中文简介、模态/设备标签；
- 搜索：同时匹配中文名、英文名、中英文简介；
- 筛选：分类（mapper / filter / deduplicator / selector / aggregator / grouper / pipeline）、模态（文本/图片/音频/视频/多模态/通用）、设备（CPU/GPU）、来源（DJ 内置/我的自定义），可组合，支持单个清除与一键清除；
- 算子详情（按需加载，已看过的本地缓存）：中文介绍（可展开英文原文）、来源·状态·版本、**完整参数表**——每个参数含中文名、类型、必填/可选、默认值、中文说明与英文原文；
- 数据实时取自 DJ 服务，自定义算子（`develop_custom_operator` 产出）发布后即可在「我的自定义」里看到；
- 中英文界面，深浅色主题自适应。

## 前置条件

- DSH ≥ 0.2.0-rc.2；
- 本机 DJ plan-flow 服务在运行（即 DJ MCP 工具可用的那套服务，默认 `http://127.0.0.1:8010`）。服务未启动时面板显示「暂时不可用 + 重试」，不影响其他功能。

## 配置

DJ 服务地址默认 `http://127.0.0.1:8010`。如需覆盖，在你的 profile 补丁（`~/.dsh/profiles/<name>/cordis.patch.yml`）中加 id 定向配置：

```yaml
- id: operator-library
  config:
    upstreamBase: 'http://127.0.0.1:8010'
```

只接受 loopback HTTP 地址（127.0.0.1 / localhost / ::1），非法值会导致插件激活失败（fail-closed）。

## API（Host 半边注册的路由）

| 路由 | 作用 |
|---|---|
| `GET /api/operator-library/catalog` | 代理 DJ `/operator-catalog`（全量目录 + 切面） |
| `GET /api/operator-library/detail?name=<算子名>` | 代理 DJ `/operator-detail`（含参数表） |

两条路由均为只读 GET、同源校验；上游响应上限 2MB、超时 10s、形状校验后透传。

## 安装

见[上级 README](../README.md)。
