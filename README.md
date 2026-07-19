# 多上游余额看板

面向运营人员的单页余额监控工具。它可以在一个页面管理多种上游，服务端负责 API Bearer Token、网页访问令牌、云厂商 AK/SK 签名或网页登录会话 Cookie，浏览器只接收脱敏后的账号和余额信息。

## 当前能力

- 支持兼容 Bearer 余额协议的上游。
- 支持 Bearer Access Token＋用户标识请求头的网页余额接口，并按可配置除数换算钱包点数。
- 支持阿里云 BSS `QueryAccountBalance`，展示 `AvailableAmount` 与币种。
- 支持配置服务地址、接口路径和 Cookie 的通用网页登录会话上游；自动识别标准余额协议和“充值余额＋馈赠金”点数协议。
- 支持多个账号的新增、编辑、停用、删除、手动刷新、低余额预警和同步错误提示。
- 首次启动创建唯一管理员，不开放普通用户注册；页面和管理 API 均要求登录。
- 管理员密码使用 scrypt 哈希，登录采用 7 天有效的服务端会话和 `HttpOnly` Cookie。
- 页面可见时约每 60 秒刷新一次；同步失败会保留上次成功余额并显示错误。
- API Key、网页 Access Token、用户请求头值、AccessKey ID、AccessKey Secret 与 Cookie 只保存在当前服务进程内存；浏览器只看到脱敏标识。

当前版本只持久化管理员和登录会话，没有持久化上游配置与凭证，也没有历史趋势、外部告警或服务端定时任务。服务重启或重新构建后，手动添加的上游账号、网页 Access Token 和 Cookie 会话仍会丢失，需要重新录入。

腾讯云第一阶段只支持单机、单容器私有部署：应用映射服务器 `127.0.0.1:3210`，通过 SSH 隧道访问，不开放公网端口。制作发布包、Docker 安装、健康检查和回滚流程见 [docs/deployment/tencent-cloud.md](docs/deployment/tencent-cloud.md) 。

## 环境要求

- Node.js `>=22.13.0`
- npm

## 本地启动

```bash
npm install
npm run dev
```

终端显示地址后，在浏览器打开本地页面，默认通常为 `http://localhost:3000/`。

生产构建与本地运行：

```bash
npm run build
npm run start
```

`npm run start` 默认将本地认证数据库写入忽略提交的 `.data/zhangdan.sqlite`。腾讯云 Docker 使用独立数据卷，不使用项目目录中的数据库文件。

## 首次创建管理员与登录

1. 第一次打开应用时，首页会自动跳转到 `/setup`。
2. 输入 3–32 位用户名，以及 12–128 个字符的密码。
3. 创建成功后自动进入看板；此后初始化入口关闭，只能通过 `/login` 登录。
4. 顶部账号区域可以退出登录。错误登录按客户端 IP 与规范化用户名限速。

管理员账号和未过期会话会在服务重启后保留。浏览器 Cookie 只保存随机会话令牌；数据库只保存该令牌的 SHA-256 摘要。忘记密码的第一版恢复流程见 [管理员登录与数据迁移](docs/authentication.md) 。

## 添加兼容 Bearer 上游

在页面点击“添加上游”，选择“兼容 API（Bearer）”，填写名称、Base URL、API Key、余额接口路径和预警值。页面当前默认路径为 `/api/usage/balance/`；如果上游文档使用其他路径，必须按其原始路径填写，包括是否需要末尾斜杠。

服务端请求形式：

```http
GET {Base URL}{余额接口路径}
Authorization: Bearer {API Key}
Accept: application/json
```

兼容上游响应结构：

```json
{
  "success": true,
  "data": {
    "username": "operator@example.com",
    "quota": 100000,
    "used_quota": 25000,
    "request_count": 1200,
    "currency": "USD",
    "balance_amount": 75,
    "used_amount": 25,
    "subscriptions": []
  }
}
```

`quota` 是上游返回的原始点数，不等于人民币金额；具体换算由各上游定义。CloudSky 原始接口说明见[获取用户余额与使用情况](https://vertex-api-docs.icloudsky.com/docs/admin/getUsageBalance/index.html) 。

## 添加网页访问令牌（Bearer）上游

适用于登录控制台把 Access Token 保存在浏览器中，并通过 `Authorization: Bearer` 查询余额的站点。第一版只查询余额，不自动登录或续期；Token 到期后需要在“编辑配置”中人工替换。

服务端请求形式：

```http
GET {服务地址}{接口路径}
Authorization: Bearer {Access Token}
{用户标识请求头名称}: {用户标识请求头值}
Accept: application/json
```

响应中的 `quota` 和 `used_quota` 按配置的点数换算除数转换为金额：

```text
可用余额 = quota / 点数换算除数
累计消耗 = used_quota / 点数换算除数
```

数据宝 TopenRouter 的第一版配置：

- 服务地址：`https://www.topenrouter.com/prod-api`
- 接口路径：`/user/self`
- 用户标识请求头名称：`New-Api-User`
- 用户标识请求头值：当前登录账号请求中的数字用户 ID
- 点数换算除数：`500000`
- 币种：`CNY`
- Access Token：建议填写浏览器请求头中 `Authorization: Bearer` 后面的值；表单也兼容完整的 `Bearer ...`

不要使用已经发送到聊天、日志或截图中的 Token。完整操作、安全边界和响应格式见 [docs/upstreams/web-bearer.md](docs/upstreams/web-bearer.md) 。

## 添加阿里云余额监控

1. 创建独立 RAM 用户，优先授予最小 Action：`bss:DescribeAcccount`。`Acccount` 的三个 `c` 是阿里云官方名称。
2. 页面点击“添加上游”，上游类型选择“阿里云 BSS”。
3. 中国站使用 `https://business.aliyuncs.com`；国际站使用 `https://business.ap-southeast-1.aliyuncs.com`。
4. 填写 AccessKey ID、AccessKey Secret 和低余额预警值。
5. 提交后查看同步状态、可用额度和最后成功同步时间。

服务端使用 Web Crypto 完成 V3 `ACS3-HMAC-SHA256` 签名，只调用 `QueryAccountBalance`，不查询流水或资源账单。`QuotaLimit` 不映射为“钱包原始点数”，请求数、累计消耗和订阅信息对阿里云显示为不适用。

完整配置、权限、错误处理和运行边界见 [docs/upstreams/aliyun-bss.md](docs/upstreams/aliyun-bss.md) 。

## 添加网页登录会话（Cookie）上游

适用于没有公开余额 API、但登录页面会调用余额接口的中转站。服务地址、接口路径和 Cookie 均由运营人员根据浏览器请求填写：

```http
GET {服务地址}{接口路径}
Cookie: {登录会话 Cookie}
loginWay: 0
Accept: application/json
```

1. 在自己的浏览器中登录目标中转站，并手动完成验证码。
2. 打开开发者工具的 Network，刷新余额或用量页面并找到返回余额的 GET 请求。
3. 从 Request URL 拆出服务地址和接口路径；在 Request Headers 中只复制 `Cookie` 后面的值，不要包含 `Cookie:`。
4. 在本项目点击“添加上游”，选择“网页登录会话（Cookie）”，填写名称、服务地址、接口路径和 Cookie。
5. 提交后检查余额和同步状态；会话过期时重新登录并在“编辑配置”中替换 Cookie。

当前自动识别两种响应格式：

- 标准余额协议：`data.balance_amount`，并可包含 `quota`、`used_quota`、`request_count` 和 `subscriptions`。
- 点数拆分协议：`data.personalRecharge` 与 `data.systemGift`，按下面规则显示总余额、充值余额和馈赠金。

余额换算规则：

```text
可用总余额 = (personalRecharge + systemGift) / 100,000,000
充值余额   = personalRecharge / 100,000,000
馈赠金     = systemGift / 100,000,000
```

`subBalances` 是上述余额的拆分数据，不再重复累加。TokenPony 可填写服务地址 `https://www.tokenpony.cn` 和接口路径 `/cgw/authlink-facade/user/get_user_balance`；其他品牌使用各自实际请求。完整通用操作和限制见 [docs/upstreams/cookie-session.md](docs/upstreams/cookie-session.md) ，TokenPony 示例见 [docs/upstreams/tokenpony-session.md](docs/upstreams/tokenpony-session.md) 。如果新品牌的响应不属于上述两种结构，需要先提供脱敏响应样例，再增加对应解析格式。

## 轮询与运营判断

- 60 秒刷新由每个可见浏览器标签页触发，不是 24×7 服务端任务。
- 页面隐藏、关闭或设备休眠时不会持续查询；多个可见标签页会分别轮询。
- 同步失败时页面保留上次成功余额。必须结合“最后成功同步”时间判断数据是否仍有参考价值。
- 低余额阈值按接口返回币种比较，包含负余额场景。
- 网页 Access Token 到期后会显示同步失败，需要人工重新登录上游并在“编辑配置”中替换。
- 登录会话有有效期；出现会话失效提示后必须人工重新登录并更新 Cookie，不自动处理验证码。

## 数据保存与安全边界

- 管理员与登录会话持久化到 SQLite；密码仅保存 scrypt 哈希，会话仅保存令牌摘要。原始密码和会话令牌不得进入源码、日志或发布包。
- 完整凭证只在服务端内存中使用；`GET /api/upstreams` 只返回 `maskedKey`。Cookie 上游只返回固定会话掩码，不截取 Cookie 的头尾字符。
- 修改 Base URL、余额路径或阿里云 Endpoint 时，必须重新输入对应完整凭证；网页 Access Token 类型还会要求重新输入用户标识值，Cookie 上游不会把旧会话自动发送到新地址。
- 不要把真实 API Key、网页 Access Token、用户请求头值、AK、SK 或 Cookie 写入源码、README、`.env`、日志、提交记录或截图。
- 真实上游必须使用 HTTPS；通用上游的 HTTP 仅为本机模拟测试开放。
- 阿里云 Endpoint 仅允许两个官方白名单地址，并且不自动跟随重定向。
- Cookie 会话只发送到已保存的服务地址和接口路径，且不自动跟随 301/302 重定向。
- 工具只调用余额查询接口，不执行充值、续费、退款或其他上游写操作。
- 登录不能替代 HTTPS。SSH 隧道内可使用本地 HTTP；直接开放公网前必须配置 HTTPS，并确认反向代理不会让客户端伪造用于限速的来源 IP 请求头。

## 验证

```bash
npm test
npm run lint
```

`npm test` 会先执行生产构建，再直接调用构建后的 Worker。当前 25 项测试覆盖首次初始化、第二管理员拒绝、未登录接口拒绝、登录限速、退出失效，以及首页、Bearer 请求与映射、网页 Access Token 附加请求头与点数换算、阿里云 V3 签名、Cookie 会话双格式解析、充值与馈赠金换算、凭证脱敏、会话失效、重定向保护、权限错误、Endpoint 白名单、非法 URL、跨站写保护和修改地址时重新输入凭证等场景。
