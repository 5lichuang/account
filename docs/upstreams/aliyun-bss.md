# 阿里云账户余额接入指南（BssOpenApi）

> 适用项目：`zhangdan` 多上游余额看板  
> API：`QueryAccountBalance`  
> 版本：`2017-12-14`  
> 当前状态：V3 适配器、页面录入与模拟测试已实现  
> 更新：2026-07-17

## 1. 当前能力与运行边界

- Provider 标识为 `aliyun_bss`，当前只查询账户可用额度，不查询资金流水、交易明细或资源账单。
- 服务端使用阿里云 V3 `ACS3-HMAC-SHA256` 签名，通过 `POST /` 调用 `QueryAccountBalance`。
- 页面在可见时约每 60 秒触发一次刷新，也支持手动刷新；隐藏、关闭或休眠时不会在后台持续监控。
- 多个可见标签页会分别轮询。当前没有服务端定时任务、60 秒 TTL 或跨标签请求合并。
- 同步失败会保留上次成功余额并标红。运营判断余额时必须同时查看“最后成功同步”时间，旧余额不代表当前余额。
- 所有配置与凭证只保存在当前服务进程内存；重启或重新构建后需要重新录入。
- 当前没有登录鉴权、加密持久化、历史趋势或跨实例一致性，只适合可信本地环境，不应部署到公网。

## 2. 页面录入

点击“添加上游”，按以下方式填写：

1. 上游类型选择“阿里云 BSS”。
2. 账号名称填写运营侧可识别的名称，例如“阿里云生产账号”。
3. Endpoint 选择对应站点：
   - 中国站：`https://business.aliyuncs.com`
   - 国际站：`https://business.ap-southeast-1.aliyuncs.com`
4. 填写 RAM 用户的 AccessKey ID 和 AccessKey Secret。
5. 设置低余额预警值，单位跟随接口返回币种。
6. 保持“启用余额监控”后提交。

Endpoint 只允许上面两个官方地址，接口路径固定为 `/`。Provider 创建后不可修改；普通编辑可将 AK/SK 留空以保留现有凭证，修改 Endpoint 时必须同时重新输入 AK/SK，避免旧凭证被发送到新地址。

当前服务端接收的阿里云配置字段为：

```ts
type AliyunBssUpstreamInput = {
  provider: "aliyun_bss";
  name: string;
  baseUrl:
    | "https://business.aliyuncs.com"
    | "https://business.ap-southeast-1.aliyuncs.com";
  accessKeyId: string;
  accessKeySecret: string;
  lowBalanceThreshold?: number;
  active?: boolean;
};
```

## 3. RAM 凭证与最小权限

建议为余额监控创建独立 RAM 用户，并只授予接口页声明的最小 Action。`Acccount` 的三个 `c` 是阿里云官方名称，不要自行改写。

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["bss:DescribeAcccount"],
      "Resource": "*"
    }
  ]
}
```

`AliyunBSSReadOnlyAccess` 也能使用，但权限范围更大，不是最小权限首选。

安全边界：

- AccessKey Secret 永不返回浏览器，也不应进入日志、README、`.env`、截图或提交记录。
- 浏览器接口只返回脱敏后的 AccessKey ID 标识。
- 修改 Endpoint 时必须重新提交完整 AK/SK。
- 本工具只执行余额查询，不执行充值、提现、退款、调账或其他上游写操作。

## 4. 当前 V3 请求

```http
POST https://business.aliyuncs.com/
Accept: application/json
Authorization: ACS3-HMAC-SHA256 Credential=...
x-acs-action: QueryAccountBalance
x-acs-content-sha256: <empty-body SHA-256>
x-acs-date: <UTC ISO 8601>
x-acs-signature-nonce: <UUID>
x-acs-version: 2017-12-14

<empty body>
```

该接口没有业务请求参数。当前实现用 Web Crypto 完成 V3 签名：计算空请求体 SHA-256，构造 canonical request，计算待签名字符串，再以 AccessKey Secret 执行 HMAC-SHA256。项目没有安装阿里云 Node.js SDK，也不使用旧版 V2/HMAC-SHA1 表单签名。

本产品采用每个可见页面约 60 秒一次的保守刷新策略；阿里云当前官方流控为每秒 10 次，60 秒不是阿里云强制限制。

## 5. 响应与字段映射

成功响应至少需要满足 HTTP 2xx、`Success === true`、`Code === "200"`，并包含可解析的 `Data.AvailableAmount`。

```json
{
  "Code": "200",
  "Success": true,
  "Data": {
    "AvailableAmount": "10000.00",
    "Currency": "CNY"
  }
}
```

| 阿里云字段 | 看板字段 | 当前处理 |
|---|---|---|
| `Data.AvailableAmount` | `balance_amount` | 解析为监控用数字；可能为负数，低于阈值即预警 |
| `Data.Currency` | `currency` | 转为大写币种代码 |
| 本地账号名称 | `username` | 接口不返回运营名称，使用页面配置名称 |
| `Data.QuotaLimit` | `quota` | 不映射，避免误标为“钱包原始点数” |
| 现金、信控、网商额度 | — | 当前不展示 |
| 用量、请求数、订阅 | 对应字段 | 统一为 `null` 或空数组 |

本工具用于余额监控与阈值判断，不是会计账本；界面金额按币种格式化展示。

## 6. 错误与运营判断

| 现象 | 页面提示或处理 |
|---|---|
| AccessKey ID 无效或停用 | 提示检查 AccessKey ID |
| Secret 错误或签名不一致 | 提示签名校验失败 |
| 系统时间或 Nonce 校验失败 | 提示检查服务器时间 |
| `NoPermission` / `NotAuthorized` / `Forbidden` | 提示 RAM 用户无余额查询权限 |
| `Throttling` / HTTP 429 | 提示稍后重试 |
| `NotApplicable` | 提示当前账号类型不支持 |
| HTTP 5xx | 提示阿里云余额服务暂时不可用 |

阿里云原始 `Message` 不直接展示，避免把上游诊断信息或敏感上下文带到浏览器。

当前 Endpoint 与路径固定，并使用 `redirect: manual`。若看到 HTTP 301，通常表示地址或路径填写错误，不能把重定向当成成功响应继续携带凭证。

## 7. 已验证状态

- V3 请求头、canonical request 与 HMAC-SHA256 签名由独立实现重新计算校验。
- `AvailableAmount` / `Currency` 已映射到统一余额模型。
- AK/SK 不进入公共响应；Endpoint 白名单、改地址重输凭证、权限错误脱敏均有回归测试。
- 生产构建、lint 和 12 项端到端测试通过。
- 桌面与约 430px 窄屏表单已完成视觉检查。
- 真实阿里云 AK/SK 联调仍需运营人员在本地页面录入后验证；项目中未保存真实凭证。

## 8. 官方资料

- QueryAccountBalance：https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-queryaccountbalance
- OpenAPI 元数据：https://api.aliyun.com/meta/v1/products/BssOpenApi/versions/2017-12-14/apis/QueryAccountBalance/api.json
- Endpoint：https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-endpoint
- V3 请求与签名：https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature
- 流控：https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-quota
