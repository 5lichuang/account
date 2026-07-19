# 网页访问令牌（Bearer）余额接入

## 适用范围

适用于登录控制台后取得 Access Token，并通过 `Authorization: Bearer` 请求只读余额接口的上游。部分站点还要求额外的用户标识请求头，本类型允许配置一个用户请求头名称和值。

第一版只查询余额，不自动提交账号、密码或验证码，也不自动续期。Access Token 到期后，由运营人员重新登录上游并在本项目“编辑配置”中替换。

## 配置字段

- 上游名称：用于看板识别账号。
- 服务地址：请求 URL 的协议、域名和可选公共前缀。
- 接口路径：以 `/` 开头的余额 GET 接口路径。
- Access Token：建议填写 `Authorization: Bearer` 后面的值；表单也兼容粘贴完整的 `Bearer ...`。
- 用户标识请求头名称：例如 `New-Api-User`。
- 用户标识请求头值：例如当前账号的数字 ID。
- 点数换算除数：把 `quota` 和 `used_quota` 换算为金额的正数。
- 币种：三位币种代码，例如 `CNY`。
- 低余额预警值：按换算后的金额判断。

服务端请求形式：

```http
GET {服务地址}{接口路径}
Authorization: Bearer {Access Token}
{用户标识请求头名称}: {用户标识请求头值}
Accept: application/json
```

请求不自动跟随 301、302 等重定向。修改服务地址或接口路径时必须同时输入新的 Access Token 和用户请求头值，防止旧凭证被发送到新站点；修改用户请求头名称时也必须重新输入请求头值。

## 数据宝 TopenRouter 示例

在登录后的浏览器开发者工具 Network 中找到 `user/self` 请求，配置：

```text
服务地址             https://www.topenrouter.com/prod-api
接口路径             /user/self
用户标识请求头名称   New-Api-User
用户标识请求头值     当前请求中的数字用户 ID
点数换算除数         500000
币种                 CNY
```

Access Token 取自该请求 `Authorization: Bearer` 后面的值。只能把新 Token 粘贴到可信本机运行的项目页面，不要发送到聊天，不要写入源码、`.env`、README、日志、提交记录或截图。

响应结构：

```json
{
  "success": true,
  "message": "",
  "data": {
    "username": "masked-user",
    "quota": 12345678900,
    "used_quota": 59876543,
    "request_count": 12345
  }
}
```

映射规则：

```text
可用余额 = quota / 500000
累计消耗 = used_quota / 500000
请求数   = request_count
币种     = CNY
```

示例对应可用余额 `24691.3578 CNY`、累计消耗 `119.753086 CNY`。页面按货币格式显示两位小数，原始点数仍保留在统一数据模型中。

## Token 到期与安全边界

- HTTP 401 表示 Access Token 已失效，需要重新登录并人工替换。
- HTTP 403 表示当前令牌或用户标识无权查询余额。
- 同步失败时保留最近一次成功余额，并更新错误状态和最后尝试时间。
- 完整 Access Token 和用户请求头值只保存在服务进程内存，公共接口不返回。
- 服务重启或重新构建后需要重新录入配置。
- 当前版本不使用 Cookie 自动换取新 Token；也不保存账号、密码或验证码。
