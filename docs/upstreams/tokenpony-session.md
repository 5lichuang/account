# TokenPony 网页会话余额接入

## 接入范围

本项目通过通用“网页登录会话（Cookie）”类型查询 TokenPony 当前账户余额，不执行充值、消费、导出或其他写操作。TokenPony 尚未在公开文档中提供余额 API，因此当前配置使用登录页面调用的站内接口：

```http
GET https://www.tokenpony.cn/cgw/authlink-facade/user/get_user_balance
Cookie: {登录会话 Cookie}
loginWay: 0
Accept: application/json
```

在页面中分别填写服务地址 `https://www.tokenpony.cn` 和接口路径 `/cgw/authlink-facade/user/get_user_balance`。请求使用手动重定向模式；遇到 301、302 等响应时停止，不把 Cookie 转发到新地址。修改服务地址或接口路径时必须同时输入新的完整 Cookie。

## 获取并录入会话

1. 在自己的浏览器中打开 `https://www.tokenpony.cn/`，手动完成登录和验证码。
2. 打开开发者工具的 Network，进入或刷新“用量信息”页面。
3. 筛选 `get_user_balance`，选择该请求。
4. 在 Request Headers 中复制 `Cookie` 请求头的值，例如复制 `name=value; name2=value2`，不要复制 `Cookie:` 前缀。
5. 在本项目点击“添加上游”，选择“网页登录会话（Cookie）”，填写账号名称、上述服务地址、接口路径、Cookie 和低余额预警值。
6. 提交后确认页面出现可用总余额、充值余额、馈赠金和最后成功同步时间。

Cookie 是完整登录凭证。只能粘贴到可信本机运行的项目页面，不要发送到聊天，不要写入源码、`.env`、README、日志、提交记录或截图。

## 响应和余额口径

接口响应示例：

```json
{
  "code": 200,
  "success": true,
  "data": {
    "total": 10074012435373,
    "personalRecharge": 4396013412513,
    "systemGift": 5677999022860,
    "subBalances": []
  }
}
```

金额单位按 TokenPony 页面规则换算：

```text
充值余额   = personalRecharge / 100,000,000
馈赠金     = systemGift / 100,000,000
可用总余额 = (personalRecharge + systemGift) / 100,000,000
```

上面的示例对应：

```text
充值余额   ¥43,960.13412513
馈赠金     ¥56,779.99022860
可用总余额 ¥100,740.12435373
页面展示   ¥100,740.12
```

`subBalances` 是充值余额和馈赠金的拆分，不再累加，否则会重复计算。`data.total` 不作为额外的一笔余额加入总数。

## 同步和错误处理

- 页面可见时，当前项目约每 60 秒触发一次同步。
- 页面关闭、隐藏或设备休眠后不会继续同步；这不是服务端 24×7 定时任务。
- 同步失败时保留最近一次成功余额，并更新错误状态和最后尝试时间。
- HTTP 401、HTTP 403 或业务码 `40001` 显示“登录会话已失效”，需要重新登录并在“编辑配置”中更新 Cookie。
- HTTP 429 显示请求过于频繁；HTTP 3xx 显示接口发生重定向；HTTP 5xx 显示余额服务暂时不可用。
- 上游原始错误信息和 Cookie 不返回给浏览器。

## 当前限制

- 这是未公开文档化的站内接口，TokenPony 可能随时调整路径、字段或会话规则。
- 产品类型和连接参数是通用的，但本页余额字段及 `1 亿点 = 1 元` 的换算规则是 TokenPony 示例；其他品牌必须按其真实响应确认口径。
- 项目不会自动登录、识别验证码或刷新登录会话。
- Cookie 和账号配置只保存在服务进程内存；服务重启或重新构建后需要重新录入。
- 当前项目没有访问控制和加密持久化，只适合可信本机环境，不应部署到公网。
- 若需要 24×7 线上监控，应另行设计访问控制、加密存储、服务端调度和会话续期流程，不能直接复用当前内存版本。
