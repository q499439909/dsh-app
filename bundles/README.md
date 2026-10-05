# DSH 插件（bundles/）

本目录下每个子目录是一个独立的 DSH 侧栏插件（bundle），面向 DSH Web GUI（`dsh web`）。

| 插件 | 功能 |
|---|---|
| [results-center/](results-center/) | 结果中心：浏览 Data-Juicer 运行输出——图片缩略图、数据分组、逐条元数据、报告预览与下载 |
| [operator-library/](operator-library/) | 算子库：检索全部 Data-Juicer 算子，分类/模态/设备/来源筛选，查看中文介绍与完整参数表 |

两个插件互相独立，可单独安装。

## 安装（换机器 / 分享给他人）

前置条件：DSH ≥ 0.2.0-rc.2，`dsh web` GUI 可正常访问。

1. 克隆本仓库（或拷贝需要的插件目录）到任意本地路径；
2. 在 DSH 会话中让 agent 安装，例如：

   > 把 `D:\path\to\repo\bundles\results-center` 安装为插件

   （或在 Web GUI 的插件管理器中选择 install bundle 并指向该目录）；

3. 安装后浏览器硬刷新（Ctrl+F5），侧栏出现对应图标。

说明：

- 插件以 link 方式装入 profile（`~/.dsh/profiles/<name>/node_modules/@local/...` 指回本目录），源码即本体，无需重启 DSH；
- 修改 `client.js`（界面）后硬刷新即可生效；修改 `index.js`（Host 路由）后建议重启 `dsh web`；
- 卸载：在插件管理器中 disable 或 remove 对应 bundle。
