# Linux 开发环境复现

本文复现 `dsh-app` 的 `codex/user-authentication` 分支与 Data-Juicer 的
`codex/dj-plan-explorer` 分支。Linux 启动器不依赖固定绝对路径，但默认要求两个仓库位于同一父目录：

```text
~/src/
├── dsh-app/
└── data-juicer/
    └── .venv/
```

## 1. 系统依赖

安装 Git、Python 3.12、Node.js 24、Corepack 和常用编译工具。Ubuntu/Debian 示例：

```bash
sudo apt update
sudo apt install -y git python3.12 python3.12-venv build-essential
```

Node.js 建议通过发行版支持的 NodeSource、nvm 或组织内部镜像安装。安装后检查：

```bash
node --version
python3.12 --version
corepack --version
```

## 2. 克隆固定分支

```bash
mkdir -p ~/src
git clone --branch codex/user-authentication --single-branch \
  https://github.com/q499439909/dsh-app.git ~/src/dsh-app
git clone --branch codex/dj-plan-explorer --single-branch \
  https://github.com/q499439909/data-juicer.git ~/src/data-juicer
```

## 3. 安装依赖

```bash
cd ~/src/dsh-app
corepack enable
corepack pnpm install --frozen-lockfile

python3.12 -m venv ~/src/data-juicer/.venv
~/src/data-juicer/.venv/bin/python -m pip install --upgrade pip
~/src/data-juicer/.venv/bin/python -m pip install \
  -e "$HOME/src/data-juicer[tools,ai_services]"
```

## 4. 私有配置

```bash
cd ~/src/dsh-app
cp dj-plan-flow.env.example dj-plan-flow.env
cp dsh-auth.env.example dsh-auth.env
node packages/dsh-user-auth/lib/hash-invite.js 'your-invite-code'
```

把哈希结果写入 `dsh-auth.env`。Linux 可以删除模板中的 Windows 数据库路径，启动器会默认使用
`~/src/dsh-app/.dsh/auth.sqlite`；也可以写绝对 Linux 路径：

```dotenv
DSH_REGISTRATION_INVITE_HASH=$argon2id$...
DSH_AUTH_DATABASE_PATH=/home/your-user/src/dsh-app/.dsh/auth.sqlite
DSH_AUTH_SECURE_COOKIE=false
```

在 `dj-plan-flow.env` 中填写自己的 API key、base URL 和模型。两个真实 env 文件均被 Git 忽略。

## 5. 启动

```bash
cd ~/src/dsh-app
./web-dj.sh
```

默认监听：

- DSH Web：`127.0.0.1:57035`
- Plan Flow MCP：`127.0.0.1:8010`

仓库不在默认布局时，显式指定：

```bash
DJ_ROOT=/opt/data-juicer \
DJ_PYTHON=/opt/data-juicer/.venv/bin/python \
./web-dj.sh
```

DSH 当前出于安全原因只允许监听 `127.0.0.1`：它提供代码执行能力，不能直接绑定
`0.0.0.0`。从其他电脑访问时，在客户端建立 SSH 隧道：

```bash
ssh -N -L 57035:127.0.0.1:57035 ubuntu@SERVER_IP
```

保持该命令运行，并在客户端浏览器打开 `http://127.0.0.1:57035`。托管 Notebook
环境也可以使用平台提供的、带身份认证的端口转发功能。不要用 `socat`、裸 Nginx
反向代理或安全组直接把开发端口暴露到公网。

## 6. 验证

```bash
cd ~/src/dsh-app
node --test \
  packages/dsh-user-auth/test/*.test.mjs \
  packages/dsh-dj-plan-explorer/test/*.test.mjs \
  packages/dsh-dj-datasets/test/*.test.mjs \
  packages/dsh-dj-operator-library/test/*.test.mjs

cd ~/src/data-juicer
.venv/bin/python -m pytest tests/tools/plan_flow -q
```

Git 只复现代码。API 密钥、登录数据库、结果数据库、用户数据集、模型、运行输出和 Docker 镜像需要另行安全迁移；不要提交这些内容。
