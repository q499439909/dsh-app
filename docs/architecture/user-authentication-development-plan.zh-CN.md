# DSH 用户登录与个人数据授权开发方案

状态：实施中；认证接入 seam 与注册/登录核心已完成，资源所有权尚未实施
范围：DSH Web、DSH 会话/任务、Data-Juicer 数据集结果中心、S3 对象存储接入  
首期部署：单台 GPU 服务器、少量体验用户  

## 1. 目标

为穿透或部署到公网的 DSH Web 增加完整的用户身份入口，并让用户只能访问自己创建的聊天、任务、上传文件和处理结果。

第一版实现：

- 使用邀请码注册；
- 用户名和密码登录，不接入邮箱；
- 使用服务端 Session Cookie 维持登录；
- 普通用户只能查看和操作自己的资源；
- 管理员可以管理账号并查看、处理全部用户资源；
- S3 输入数据区向所有已登录用户只读开放；
- 用户上传和处理结果写入 S3 私有用户区；
- S3 Bucket 和前缀均通过配置提供，不写死在业务代码中。

登录是访问控制和数据归属的基础，但不替代进程沙箱、容器隔离、磁盘配额或算力限额。这些运行隔离能力不在本方案首期范围内。

## 2. 已确认的产品决定

| 主题 | 第一版决定 |
|---|---|
| 注册方式 | 注册页面开放，但注册必须提供邀请码 |
| 初始邀请码 | 使用当前约定值，通过安全配置提供，可随时轮换；真实值不写入源码或本文档 |
| 登录凭据 | 用户名 + 密码 |
| 邮箱 | 不收集，不验证，不提供邮件找回 |
| 忘记密码 | 管理员重置为临时密码，并使旧会话失效 |
| 普通用户可见性 | 只能看到自己的聊天、任务、上传和结果数据集 |
| 管理员权限 | 可管理用户，并查看、删除所有用户资源 |
| S3 公共输入 | 配置为输入数据区的全部数据集对登录用户只读可用 |
| S3 私有数据 | 用户上传和管线结果按用户隔离 |
| 公共数据修改 | 普通用户不能修改或删除公共输入数据 |
| 公共数据产出 | 使用公共数据运行得到的结果归发起运行的用户 |
| 首期数据库 | 单机 SQLite；部署多实例前再迁移到 PostgreSQL |

“S3 都能访问”在本方案中的准确含义是：所有登录用户都能浏览、预览并选用配置好的公共输入数据区，但不能借此读取其他用户的上传区和结果区。服务器拥有的其他 S3 Bucket 或前缀不会自动暴露。

## 3. Session Cookie 的登录模型

登录成功后，服务器生成至少 256 bit 的随机 Session Token：

```text
浏览器 Cookie：保存原始随机 Token
认证数据库：只保存 Token 的 SHA-256 摘要、user_id、过期时间和撤销状态
```

浏览器后续访问 HTTP、WebSocket、预览和下载接口时自动携带 Cookie。服务器验证摘要后取得当前 `user_id`。浏览器不保存密码、用户权限列表或可长期独立使用的 JWT。

Cookie 规则：

- 名称使用 `__Host-dsh_session`；
- `HttpOnly`，网页 JavaScript 不可读取；
- 生产环境启用 `Secure`，只通过 HTTPS 发送；
- `SameSite=Lax`；
- `Path=/`，不设置 `Domain`；
- 默认 7 天滑动有效期，总有效期和滑动窗口可配置；
- 退出登录、禁用账号、重置密码时立即撤销服务器端会话。

本地 HTTP 开发环境使用不同的非 `__Host-` Cookie 名，避免为了本地调试削弱生产 Cookie 配置。

## 4. 模块设计

### 4.1 深模块 `IdentityAccess`

新增深模块 `IdentityAccess`，集中隐藏密码摘要、邀请码校验、Session 生命周期、账号状态和资源所有权判断。页面、HTTP 路由、WebSocket 和数据集模块只通过其小接口取得身份或执行授权，不自行解析 Cookie，也不复制权限判断。

建议外部接口：

```ts
interface IdentityAccess {
  register(input: RegisterInput, context: RequestContext): Promise<AuthSession>
  login(input: LoginInput, context: RequestContext): Promise<AuthSession>
  authenticate(credential: SessionCredential): Promise<Principal>
  logout(sessionId: SessionId): Promise<void>
  authorize(principal: Principal, action: Action, resource: ResourceRef): Promise<void>
}
```

接口只接收不透明的 `userId`、`sessionId` 和资源标识，不接收文件系统路径、S3 凭据或任意对象键。

`IdentityAccess` 的实现负责：

- 用户名规范化和唯一性；
- 密码摘要生成与验证；
- 邀请码验证和轮换；
- 登录失败限流；
- Session 创建、续期、撤销和清理；
- `admin`、`user` 两种角色；
- 用户启用、禁用和密码重置；
- 统一的所有权与管理员授权规则；
- 安全审计事件记录。

### 4.2 请求身份上下文

认证成功后，Host 为当前请求生成不可由浏览器伪造的上下文：

```ts
type Principal = {
  userId: UserId
  role: 'admin' | 'user'
  sessionId: SessionId
}
```

后续模块只从服务器上下文取得 `Principal`。创建聊天、任务、上传或结果时，后端自动写入 `principal.userId`；任何公共请求体都不接受 `ownerUserId`。

### 4.3 DSH 接入 seam

认证应安装在 DSH Host 的公共入口，而不是只做登录页面遮罩：

```text
浏览器
  │ Cookie
  ▼
DSH Host 认证门禁
  ├─ 页面和静态入口
  ├─ HTTP/RPC
  ├─ WebSocket 握手
  ├─ 附件预览与下载
  └─ Data-Juicer / 数据集路由
       │ Principal
       ▼
会话、任务、数据集和对象存储模块
```

登录、注册和必要的健康检查是匿名允许路由；其他 DSH 页面和接口默认拒绝匿名请求。WebSocket 必须在握手阶段验证 Cookie，断线重连时重新验证账号和 Session 状态。

实施前先做一个有界接入验证，确认当前 DSH 版本的 Host 路由、WebSocket 握手和会话列表查询分别可在哪个 seam 注入身份。若某项没有扩展点，应在 DSH Host 层增加一个集中 Adapter，不能靠前端过滤掩盖后端数据。

## 5. 数据模型

SQLite 使用 WAL 模式、外键约束和事务。建议首期表结构如下。

### 5.1 `users`

| 字段 | 说明 |
|---|---|
| `user_id` | 随机不透明 ID，主键 |
| `username_normalized` | 规范化用户名，唯一索引 |
| `username_display` | 页面显示用户名 |
| `password_hash` | Argon2id 密码摘要 |
| `role` | `admin` 或 `user` |
| `status` | `active` 或 `disabled` |
| `password_version` | 密码重置后递增，用于撤销旧会话 |
| `created_at` / `updated_at` | UTC 时间 |
| `last_login_at` | 最近成功登录时间 |

用户名先采用 3–32 个字符，允许中文、英文字母、数字、下划线和短横线；去除首尾空白并进行 Unicode 规范化后判断唯一性。保留字和具体字符规则应由确定性校验实现并覆盖测试。

密码首期要求至少 10 个字符、最多 128 个字符，不强制大小写或特殊字符组合。密码只保存 Argon2id 摘要，不记录明文，不写入日志。

### 5.2 `auth_sessions`

| 字段 | 说明 |
|---|---|
| `session_id` | 内部随机 ID |
| `token_hash` | Session Token 的 SHA-256 摘要，唯一索引 |
| `user_id` | 所属用户 |
| `password_version` | 创建时的密码版本 |
| `created_at` / `last_seen_at` | 创建和最近活动时间 |
| `idle_expires_at` / `absolute_expires_at` | 滑动和绝对过期时间 |
| `revoked_at` | 主动撤销时间 |
| `ip_hash` / `user_agent_summary` | 有界审计信息，不保存不必要的完整指纹 |

### 5.3 `auth_audit_events`

记录注册成功/失败、登录成功/失败、退出、禁用、恢复、密码重置和管理员跨用户操作。审计记录不能包含密码、邀请码、Cookie、S3 签名地址或完整对象内容。

### 5.4 资源所有权

现有或新增索引至少补充：

```text
dsh_sessions.owner_user_id
jobs.owner_user_id
uploads.owner_user_id
datasets.owner_user_id
archive_jobs.owner_user_id
```

若 DSH 自身数据结构不适合直接增加字段，则新增受控映射表，以 DSH 的不透明会话/任务 ID 映射到 `user_id`。不通过目录名、用户名或 S3 前缀反推所有者。

所有普通用户查询都必须在服务器端附加 `owner_user_id = principal.userId`。读取单项资源时同时校验所有权，避免只保护列表、却能通过猜测 ID 打开详情或下载文件。

## 6. 注册、登录与管理流程

### 6.1 注册

1. 匿名用户提交用户名、密码和邀请码。
2. 按 IP 和规范化用户名执行限流。
3. 以恒定时间方式验证邀请码摘要。
4. 校验用户名和密码，创建普通用户。
5. 创建 Session Cookie，直接进入 DSH。
6. 写入不包含敏感值的注册审计事件。

初始邀请码使用当前约定值，通过 `DSH_REGISTRATION_INVITE_HASH` 配置。提供离线命令把明文邀请码转换为摘要；源码、本文档、数据库迁移和示例配置不包含真实邀请码。修改配置并重载后即可轮换，新注册立即使用新邀请码，既有账号不受影响。

由于当前约定值强度较低，部署公网时必须同时启用注册限流；正式扩大使用前应更换为至少 16 位随机邀请码。

### 6.2 登录

登录失败统一返回“用户名或密码错误”，不暴露账号是否存在。按 IP 和用户名双维度限流，连续失败使用递增短暂等待；达到阈值后记录审计，但第一版不做容易被恶意利用的永久账号锁死。

登录成功后轮换 Session Token，避免会话固定攻击。账号被禁用时拒绝登录，并使全部既有 Session 失效。

### 6.3 退出和会话管理

- 用户退出当前设备时撤销当前 Session；
- 可提供“退出所有设备”，撤销该用户全部 Session；
- Session 过期记录由后台定期清理；
- 密码重置后通过 `password_version` 使所有旧 Session 立即无效。

### 6.4 管理员

首个管理员账号通过部署命令在服务器终端创建，不允许通过公开注册获得 `admin` 角色。管理员页面支持：

- 用户列表和状态查询；
- 禁用、恢复用户；
- 设置一次性临时密码；
- 撤销用户全部 Session；
- 查看用户的聊天、任务和结果；
- 删除异常或违规资源；
- 查看安全审计事件。

危险操作要求管理员重新输入自己的密码或完成短期二次确认，防止管理员页面长时间打开时被误操作。

## 7. S3 数据访问与可迁移配置

### 7.1 访问区域

逻辑上划分三类对象区域，即使第一版使用同一个 Bucket：

```text
公共输入区：datasets/...                         所有登录用户只读
用户上传区：users/{user_id}/uploads/...          仅所属用户和管理员
用户结果区：users/{user_id}/results/{task_id}/... 仅所属用户和管理员
```

浏览器不提交真实 Bucket、宿主机路径或任意 S3 Key。页面使用 `datasetId`、`assetId`、`uploadId`、`taskId`；对象存储模块在服务器内部解析为允许的对象。

公共输入区可以配置一个或多个 Bucket/前缀。所谓“全部 S3 数据集”是这些已配置公共输入区中的全部数据集，不包括服务器 IAM 凭据能够读取的任意对象。

### 7.2 `ObjectCatalog` 接口

对象访问集中到深模块 `ObjectCatalog`：

```ts
interface ObjectCatalog {
  listPublicDatasets(query: PublicDatasetQuery): Promise<DatasetPage>
  createUpload(principal: Principal, input: UploadRequest): Promise<UploadTarget>
  openAsset(principal: Principal, assetId: AssetId): Promise<AssetStream>
  createResultTarget(principal: Principal, taskId: TaskId): Promise<ResultTarget>
  deleteOwnedResource(principal: Principal, resourceId: ResourceId): Promise<DeleteResult>
}
```

S3 是生产 Adapter；测试使用 MinIO 或内存对象存储 Adapter。对象键生成、范围校验、MIME、Range、下载文件名和短期签名地址均隐藏在模块实现中。

如使用预签名 URL，必须在签名前完成授权，URL 有效期尽量短，且 S3 Bucket 不允许公共匿名读取。更敏感的 JSON/JSONL 和日志可以由 Host 代理流式返回，避免生成可转发的长效地址。

### 7.3 路径以后能否修改

可以修改。Bucket、公共输入前缀、上传前缀和结果前缀均通过部署配置提供，业务表保存稳定的资源 ID 和内部存储定位，不把前缀拼接规则散落在调用方。

需要区分两种变化：

- 修改配置只影响新写入对象：直接更改配置即可；
- 已有对象也要迁移到新路径：需要执行对象复制、校验、更新内部定位和删除旧对象的迁移任务，不能只改前缀后假设旧数据会自动移动。

第一版为对象记录保留 `storage_location_version`，使以后迁移 Bucket 或前缀时可以并行读取旧、新位置，完成校验后再切换。

## 8. 页面和路由

### 8.1 匿名页面

- `/login`：用户名、密码、登录错误；
- `/register`：用户名、密码、确认密码、邀请码；
- 未登录访问其他页面时跳转登录，并保留安全的站内返回地址；
- 已登录访问登录或注册页时跳转 DSH 首页。

### 8.2 用户菜单

显示当前用户名，并提供：

- 账号基本信息；
- 修改密码；
- 退出当前设备；
- 退出所有设备。

### 8.3 管理页面

管理员入口不对普通用户渲染，后端仍必须独立校验管理员角色。管理员跨用户查看资源时页面明确显示当前资源所有者，避免误把他人数据当作自己的。

## 9. 与聊天、任务和结果中心的集成

### 9.1 聊天与任务

- 创建 DSH 会话时自动记录 `owner_user_id`；
- 左侧会话列表只查询当前用户的会话；
- 打开、继续、重命名、归档和删除会话时再次检查所有权；
- 创建 Data-Juicer 任务时从会话和 `Principal` 双重校验所有者一致；
- Worker 只接收内部 `taskId` 和受控输入引用，不信任浏览器提供的用户 ID 或对象路径。

### 9.2 数据集结果中心

现有数据集方案中的“所有体验者可查看全部数据集”决定由本方案替代：

- 普通用户列表固定为自己的数据集；
- 详情、预览、JSON/JSONL、单文件下载、批量下载和删除都检查所有权；
- 管理员可切换到跨用户管理视图；
- 管线使用公共输入后，输出 `owner_user_id` 仍是运行发起人；
- 聊天中的“查看数据集”按钮只携带不透明 `datasetId`，后端负责授权。

正式实施时需要同步修改数据集结果中心方案中的可见性、管理员删除和本地文件存储描述，避免两份方案互相冲突。

### 9.3 既有数据迁移

上线认证前产生的 DSH 会话、任务、上传和结果默认归属首个管理员账号。迁移程序先生成报告，再在事务中写入所有权；无法确定来源的记录进入管理员可见的 `unclaimed` 状态，不暴露给普通用户。

## 10. 安全要求

- 所有状态修改请求校验 `Origin`，并结合 `SameSite` Cookie 防止跨站请求伪造；
- HTML 和用户名输出统一转义，内容安全策略禁止不必要的内联脚本；
- 登录、注册、下载和高成本任务分别限流；
- 不在 URL 查询参数、日志或错误响应中出现密码、邀请码、Session Token、S3 凭据和预签名地址；
- 反向代理只信任明确配置的代理层，不直接信任任意 `X-Forwarded-*` 请求头；
- S3 IAM 只授予配置 Bucket/前缀所需权限，不使用管理员级云凭据；
- 数据库、认证配置和 S3 凭据不提交 Git；
- SQLite 数据库和关键配置定期备份，备份本身限制访问；
- 用户 ID 和资源 ID 使用不可预测随机值，但授权不能依赖“别人猜不到 ID”。

## 11. 实施阶段

### 阶段 A：接入验证

- 验证 DSH Host HTTP、RPC、WebSocket、静态页面和会话查询 seam；
- 建立最小认证门禁，证明匿名用户无法取得会话列表或建立已认证 WebSocket；
- 明确 DSH 升级时需要维护的补丁面。

### 阶段 B：认证核心

- 实现 SQLite schema 和迁移；
- 实现 `IdentityAccess`；
- 实现邀请码、注册、登录、退出和 Cookie；
- 提供创建管理员和生成邀请码摘要的服务器端命令。

### 阶段 C：页面与账号管理

- 实现登录、注册和用户菜单；
- 实现修改密码、退出所有设备；
- 实现管理员用户列表、禁用、恢复和密码重置。

### 阶段 D：资源所有权

- 为 DSH 会话、任务和上传建立所有权；
- 所有列表与单资源接口执行后端授权；
- 迁移既有资源到管理员账号；
- 加入越权访问审计。

### 阶段 E：S3 与结果中心

- 实现 `ObjectCatalog` 和 S3 Adapter；
- 配置公共输入区、用户上传区和用户结果区；
- 将 Data-Juicer 输入和结果改为不透明对象引用；
- 将数据集结果中心改为用户私有，并保留管理员管理视图。

### 阶段 F：安全验证与部署

- 完成限流、Origin 校验、安全响应头和日志脱敏；
- 在 HTTPS 反向代理和真实 WebSocket 下验证 Cookie；
- 完成 SQLite 与 S3 配置备份恢复演练；
- 使用普通用户、第二个普通用户和管理员进行端到端验收。

## 12. 测试策略

测试以 `IdentityAccess` 和 `ObjectCatalog` 的接口作为主要测试面，不依赖页面是否隐藏按钮。

至少覆盖：

1. 正确邀请码可注册，错误或轮换前的邀请码不可注册；
2. 重复用户名在并发注册时只有一个成功；
3. 密码摘要、登录限流和统一错误信息正确；
4. 退出、过期、禁用和密码重置后旧 Session 均失效；
5. 匿名 HTTP、RPC、WebSocket、预览和下载均被拒绝；
6. 用户 A 无法列表、打开、下载、归档、删除或继续用户 B 的资源；
7. 用户 A 即使提交用户 B 的资源 ID、S3 Key 或伪造 `ownerUserId` 也被拒绝；
8. 普通用户能读取公共输入，但不能修改或删除；
9. 公共输入产生的结果只属于发起用户；
10. 管理员跨用户操作成功并产生审计；
11. 路径穿越、任意 Bucket/Key、超范围 Range 和过期签名地址被拒绝；
12. SQLite 重启恢复、并发写入和迁移失败回滚正确；
13. 修改 S3 配置后新对象进入新位置，旧对象仍可按版本定位；
14. 现有未归属数据不会暴露给普通用户。

## 13. 验收标准

- 未登录用户除登录、注册和健康检查外无法读取任何 DSH 数据；
- 用户注册、登录、退出和修改密码流程完整可用；
- 用户只能看到自己的聊天、任务、上传和结果；
- 两个普通用户互相尝试所有资源接口均得到一致的无权限或不可见响应；
- 管理员可以管理账号和处理全部用户资源；
- 所有登录用户均可只读使用配置好的 S3 公共输入数据集；
- 用户上传和结果写入自己的 S3 区域，页面和公共响应不暴露服务器凭据；
- 邀请码、密码、Session Token 和 S3 凭据不进入源码、日志或浏览器可读存储；
- Bucket 和前缀可配置，新路径变更不要求修改业务代码；
- 在真实 HTTPS 穿透地址下完成注册、WebSocket 对话、运行管线、结果预览和下载的端到端验证。

## 14. 明确不在第一版实现

- 邮箱验证和邮件找回密码；
- OAuth、微信、GitHub 等第三方登录；
- 多因素认证；
- 用户自行修改用户名；
- 组织、团队、共享数据集和细粒度 ACL；
- 用户之间分享聊天或结果；
- 多台 Web 实例和多地域部署；
- 按用户计费；
- 沙箱、容器和 GPU 运行隔离。

这些能力以后可以基于稳定的 `user_id`、资源所有权和 `IdentityAccess` 接口扩展，不需要改变第一版的身份主键或资源归属模型。
