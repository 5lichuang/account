export type SyncStatus = "idle" | "success" | "error";
export type UpstreamProvider =
  | "generic_bearer"
  | "web_bearer"
  | "aliyun_bss"
  | "cookie_session";

export type AccountSubscription = {
  id: number | null;
  plan_id: number | null;
  plan_title: string;
  amount_total: number | null;
  amount_used: number | null;
  amount_remain: number | null;
  total_amount: number | null;
  used_amount: number | null;
  remain_amount: number | null;
  status: string;
  start_time: number | null;
  end_time: number | null;
  next_reset_time: number | null;
};

export type AccountUsageData = {
  username: string;
  quota: number | null;
  used_quota: number | null;
  request_count: number | null;
  currency: string;
  balance_amount: number | null;
  recharge_balance_amount: number | null;
  gift_balance_amount: number | null;
  used_amount: number | null;
  subscriptions: AccountSubscription[];
};

type UpstreamCredentials =
  | {
      provider: "generic_bearer";
      apiKey: string;
    }
  | {
      provider: "aliyun_bss";
      accessKeyId: string;
      accessKeySecret: string;
    }
  | {
      provider: "cookie_session";
      sessionCookie: string;
    }
  | {
      provider: "web_bearer";
      accessToken: string;
      userHeaderValue: string;
    };

type UpstreamRecord = {
  id: string;
  name: string;
  provider: UpstreamProvider;
  baseUrl: string;
  balancePath: string;
  userHeaderName: string;
  quotaDivisor: number;
  balanceCurrency: string;
  credentials: UpstreamCredentials;
  lowBalanceThreshold: number;
  active: boolean;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  usage: AccountUsageData | null;
  sync: {
    status: SyncStatus;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    error: string | null;
  };
};

export type PublicUpstream = Omit<UpstreamRecord, "credentials"> & {
  maskedKey: string;
  health: "healthy" | "warning" | "error" | "paused" | "pending";
};

export type DashboardPayload = {
  accounts: PublicUpstream[];
  generatedAt: string;
  refreshIntervalSeconds: 60;
};

export type UpstreamInput = {
  provider?: unknown;
  name?: unknown;
  baseUrl?: unknown;
  balancePath?: unknown;
  apiKey?: unknown;
  accessKeyId?: unknown;
  accessKeySecret?: unknown;
  sessionCookie?: unknown;
  accessToken?: unknown;
  userHeaderName?: unknown;
  userHeaderValue?: unknown;
  quotaDivisor?: unknown;
  balanceCurrency?: unknown;
  lowBalanceThreshold?: unknown;
  active?: unknown;
};

export class InputError extends Error {}
export class NotFoundError extends Error {}

declare global {
  // The first version intentionally keeps credentials in the server process.
  // This global survives local hot reloads without exposing keys to the client.
  var __UPSTREAM_BALANCE_STORE__: Map<string, UpstreamRecord> | undefined;
}

const store =
  globalThis.__UPSTREAM_BALANCE_STORE__ ?? new Map<string, UpstreamRecord>();
globalThis.__UPSTREAM_BALANCE_STORE__ = store;

function migrateInMemoryRecords() {
  for (const [id, storedRecord] of store) {
    const legacy = storedRecord as unknown as {
      provider?: UpstreamProvider | "tokenpony_session";
      credentials?:
        | UpstreamCredentials
        | { provider: "tokenpony_session"; sessionCookie?: unknown };
      apiKey?: unknown;
    };

    if (storedRecord.usage) {
      storedRecord.usage.recharge_balance_amount ??= null;
      storedRecord.usage.gift_balance_amount ??= null;
    }
    storedRecord.userHeaderName ??= "";
    if (
      typeof storedRecord.quotaDivisor !== "number" ||
      !Number.isFinite(storedRecord.quotaDivisor) ||
      storedRecord.quotaDivisor <= 0
    ) {
      storedRecord.quotaDivisor = 1;
    }
    if (!/^[A-Z]{3}$/.test(storedRecord.balanceCurrency ?? "")) {
      storedRecord.balanceCurrency = "CNY";
    }

    if (legacy.credentials?.provider === "tokenpony_session") {
      legacy.provider = "cookie_session";
      legacy.credentials = {
        provider: "cookie_session",
        sessionCookie:
          typeof legacy.credentials.sessionCookie === "string"
            ? legacy.credentials.sessionCookie
            : "",
      };
      store.set(id, storedRecord);
      continue;
    }

    if (
      legacy.credentials?.provider === "generic_bearer" ||
      legacy.credentials?.provider === "web_bearer" ||
      legacy.credentials?.provider === "aliyun_bss" ||
      legacy.credentials?.provider === "cookie_session"
    ) {
      legacy.provider = legacy.credentials.provider;
      continue;
    }

    legacy.provider = "generic_bearer";
    legacy.credentials = {
      provider: "generic_bearer",
      apiKey: typeof legacy.apiKey === "string" ? legacy.apiKey : "",
    };
    delete legacy.apiKey;
    store.set(id, storedRecord);
  }
}

migrateInMemoryRecords();

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function demoSubscriptions(
  planTitle: string,
  amountTotal: number,
  amountUsed: number,
  currencyAmount: number,
): AccountSubscription[] {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const unlimited = amountTotal === 0;

  return [
    {
      id: planTitle === "团队标准版" ? 101 : 202,
      plan_id: planTitle === "团队标准版" ? 11 : 22,
      plan_title: planTitle,
      amount_total: amountTotal,
      amount_used: amountUsed,
      amount_remain: unlimited ? 0 : Math.max(0, amountTotal - amountUsed),
      total_amount: unlimited ? null : currencyAmount,
      used_amount: unlimited
        ? null
        : Number(((amountUsed / amountTotal) * currencyAmount).toFixed(2)),
      remain_amount: unlimited
        ? null
        : Number(
            (
              currencyAmount -
              (amountUsed / amountTotal) * currencyAmount
            ).toFixed(2),
          ),
      status: "active",
      start_time: nowSeconds - 14 * 86400,
      end_time: nowSeconds + 16 * 86400,
      next_reset_time: unlimited ? 0 : nowSeconds + 2 * 86400,
    },
  ];
}

function seedDemoAccounts() {
  if (store.size > 0) return;

  const now = iso(-42_000);
  const demos: UpstreamRecord[] = [
    {
      id: "demo-cloudsky",
      name: "云天畅想 · 演示",
      provider: "generic_bearer",
      baseUrl: "https://vertex-api.icloudsky.com",
      balancePath: "/api/usage/balance",
      userHeaderName: "",
      quotaDivisor: 1,
      balanceCurrency: "CNY",
      credentials: {
        provider: "generic_bearer",
        apiKey: "sk-demo-cloudsky-7A3F",
      },
      lowBalanceThreshold: 100,
      active: true,
      isDemo: true,
      createdAt: now,
      updatedAt: now,
      usage: {
        username: "operations-demo",
        quota: 428360,
        used_quota: 271640,
        request_count: 18492,
        currency: "CNY",
        balance_amount: 428.36,
        recharge_balance_amount: null,
        gift_balance_amount: null,
        used_amount: 271.64,
        subscriptions: demoSubscriptions("团队标准版", 700000, 271640, 700),
      },
      sync: {
        status: "success",
        lastAttemptAt: now,
        lastSuccessAt: now,
        error: null,
      },
    },
    {
      id: "demo-global-backup",
      name: "国际备用通道 · 演示",
      provider: "generic_bearer",
      baseUrl: "https://api.example.com",
      balancePath: "/api/usage/balance",
      userHeaderName: "",
      quotaDivisor: 1,
      balanceCurrency: "CNY",
      credentials: {
        provider: "generic_bearer",
        apiKey: "sk-demo-backup-18D2",
      },
      lowBalanceThreshold: 20,
      active: true,
      isDemo: true,
      createdAt: iso(-86_400_000),
      updatedAt: now,
      usage: {
        username: "global-backup",
        quota: 8750,
        used_quota: 91250,
        request_count: 3506,
        currency: "USD",
        balance_amount: 8.75,
        recharge_balance_amount: null,
        gift_balance_amount: null,
        used_amount: 91.25,
        subscriptions: demoSubscriptions("弹性不限量", 0, 34567, 0),
      },
      sync: {
        status: "success",
        lastAttemptAt: now,
        lastSuccessAt: now,
        error: null,
      },
    },
  ];

  for (const demo of demos) store.set(demo.id, demo);
}

seedDemoAccounts();

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, fallback = "", maxLength = 160) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : fallback;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cleanName(value: unknown) {
  const name = cleanText(value, "", 60);
  if (!name) throw new InputError("请输入上游名称");
  return name;
}

function cleanProvider(
  value: unknown,
  fallback: UpstreamProvider = "generic_bearer",
): UpstreamProvider {
  if (value === undefined) return fallback;
  if (
    value === "generic_bearer" ||
    value === "web_bearer" ||
    value === "aliyun_bss" ||
    value === "cookie_session"
  ) {
    return value;
  }
  throw new InputError("上游类型不受支持");
}

function cleanBaseUrl(value: unknown) {
  const raw = cleanText(value, "", 500);
  if (!raw) throw new InputError("请输入 Base URL");

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InputError("Base URL 格式不正确");
  }

  if (!(["http:", "https:"] as string[]).includes(parsed.protocol)) {
    throw new InputError("Base URL 仅支持 http 或 https");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new InputError("Base URL 不能包含凭据、查询参数或锚点");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (parsed.protocol === "http:" && !loopbackHosts.has(hostname)) {
    throw new InputError("真实上游必须使用 HTTPS；HTTP 仅限本机模拟测试");
  }
  if (
    hostname === "169.254.169.254" ||
    hostname === "100.100.100.200" ||
    hostname === "metadata.google.internal" ||
    hostname.startsWith("169.254.")
  ) {
    throw new InputError("Base URL 不能指向云平台元数据地址");
  }

  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

function cleanBalancePath(value: unknown) {
  const path = cleanText(value, "/api/usage/balance", 240);
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("..") ||
    path.includes("?") ||
    path.includes("#") ||
    /\s/.test(path)
  ) {
    throw new InputError("余额接口路径格式不正确");
  }
  return path;
}

const ALIYUN_ENDPOINTS = new Set([
  "https://business.aliyuncs.com",
  "https://business.ap-southeast-1.aliyuncs.com",
]);

function cleanAliyunEndpoint(value: unknown) {
  const endpoint = cleanBaseUrl(value ?? "https://business.aliyuncs.com");
  const parsed = new URL(endpoint);

  if (endpoint !== parsed.origin) {
    throw new InputError("阿里云 Endpoint 不能包含额外路径");
  }
  if (!ALIYUN_ENDPOINTS.has(parsed.origin)) {
    throw new InputError("阿里云 Endpoint 仅支持中国站或国际站");
  }
  return parsed.origin;
}

function cleanThreshold(value: unknown, fallback = 20) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InputError("低余额阈值必须是非负数字");
  }
  return parsed;
}

function cleanApiKey(value: unknown, required: boolean) {
  const apiKey = cleanText(value, "", 1000);
  if (required && !apiKey) throw new InputError("请输入 API Key");
  return apiKey;
}

function cleanAccessKeyId(value: unknown, required: boolean) {
  const accessKeyId = cleanText(value, "", 256);
  if (required && !accessKeyId) throw new InputError("请输入 AccessKey ID");
  if (accessKeyId && /\s/.test(accessKeyId)) {
    throw new InputError("AccessKey ID 格式不正确");
  }
  return accessKeyId;
}

function cleanAccessKeySecret(value: unknown, required: boolean) {
  const accessKeySecret = cleanText(value, "", 1000);
  if (required && !accessKeySecret) {
    throw new InputError("请输入 AccessKey Secret");
  }
  return accessKeySecret;
}

function cleanSessionCookie(value: unknown, required: boolean) {
  if (value === undefined || value === null) {
    if (required) throw new InputError("请输入网页登录会话 Cookie");
    return "";
  }
  if (typeof value !== "string") {
    throw new InputError("网页登录会话 Cookie 格式不正确");
  }

  const sessionCookie = value.trim();
  if (required && !sessionCookie) {
    throw new InputError("请输入网页登录会话 Cookie");
  }
  if (/\r|\n/.test(sessionCookie)) {
    throw new InputError("网页登录会话 Cookie 不能包含换行符");
  }
  if (new TextEncoder().encode(sessionCookie).byteLength > 8_192) {
    throw new InputError("网页登录会话 Cookie 不能超过 8 KB");
  }
  return sessionCookie;
}

function cleanWebAccessToken(value: unknown, required: boolean) {
  if (value === undefined || value === null) {
    if (required) throw new InputError("请输入网页 Access Token");
    return "";
  }
  if (typeof value !== "string") {
    throw new InputError("网页 Access Token 格式不正确");
  }

  const rawAccessToken = value.trim();
  if (/\r|\n/.test(rawAccessToken)) {
    throw new InputError("网页 Access Token 不能包含换行符");
  }
  const accessToken = rawAccessToken.replace(/^Bearer(?:\s+|$)/i, "").trim();
  if (required && !accessToken) {
    throw new InputError("请输入网页 Access Token");
  }
  if (new TextEncoder().encode(accessToken).byteLength > 8_192) {
    throw new InputError("网页 Access Token 不能超过 8 KB");
  }
  return accessToken;
}

const RESERVED_USER_HEADER_NAMES = new Set([
  "accept",
  "accept-encoding",
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "forwarded",
  "host",
  "keep-alive",
  "origin",
  "proxy-authenticate",
  "proxy-authorization",
  "referer",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
  "x-forwarded-for",
  "x-real-ip",
]);

function cleanUserHeaderName(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new InputError("请输入用户标识请求头名称");
  }
  const name = value.trim();
  if (
    name.length > 128 ||
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
  ) {
    throw new InputError("用户标识请求头名称格式不正确");
  }

  const normalized = name.toLowerCase();
  if (
    RESERVED_USER_HEADER_NAMES.has(normalized) ||
    normalized.startsWith("proxy-") ||
    normalized.startsWith("sec-") ||
    normalized.startsWith("cf-") ||
    normalized.startsWith("x-forwarded-")
  ) {
    throw new InputError("该用户标识请求头名称不允许使用");
  }
  return name;
}

function cleanUserHeaderValue(value: unknown, required: boolean) {
  if (value === undefined || value === null) {
    if (required) throw new InputError("请输入用户标识请求头值");
    return "";
  }
  if (typeof value !== "string") {
    throw new InputError("用户标识请求头值格式不正确");
  }

  const headerValue = value.trim();
  if (required && !headerValue) {
    throw new InputError("请输入用户标识请求头值");
  }
  if (/\r|\n/.test(headerValue)) {
    throw new InputError("用户标识请求头值不能包含换行符");
  }
  if (new TextEncoder().encode(headerValue).byteLength > 4_096) {
    throw new InputError("用户标识请求头值不能超过 4 KB");
  }
  return headerValue;
}

function cleanQuotaDivisor(value: unknown, fallback = 1) {
  if (value === undefined || value === null) return fallback;
  const divisor = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(divisor) || divisor <= 0) {
    throw new InputError("点数换算除数必须是大于 0 的数字");
  }
  return divisor;
}

function cleanBalanceCurrency(value: unknown, fallback = "CNY") {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") {
    throw new InputError("余额币种必须是 3 位英文字母");
  }
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new InputError("余额币种必须是 3 位英文字母");
  }
  return currency;
}

function maskApiKey(apiKey: string) {
  if (apiKey.length <= 8) return "••••••••";
  const prefix = apiKey.slice(0, Math.min(4, apiKey.length - 4));
  return `${prefix}••••••${apiKey.slice(-4)}`;
}

function parseSubscription(value: unknown): AccountSubscription | null {
  if (!isObject(value)) return null;
  return {
    id: finiteNumber(value.id),
    plan_id: finiteNumber(value.plan_id),
    plan_title: cleanText(value.plan_title, "未命名订阅", 120),
    amount_total: finiteNumber(value.amount_total),
    amount_used: finiteNumber(value.amount_used),
    amount_remain: finiteNumber(value.amount_remain),
    total_amount: finiteNumber(value.total_amount),
    used_amount: finiteNumber(value.used_amount),
    remain_amount: finiteNumber(value.remain_amount),
    status: cleanText(value.status, "unknown", 40),
    start_time: finiteNumber(value.start_time),
    end_time: finiteNumber(value.end_time),
    next_reset_time: finiteNumber(value.next_reset_time),
  };
}

function parseUsageResponse(value: unknown): AccountUsageData {
  if (!isObject(value) || value.success !== true || !isObject(value.data)) {
    throw new Error("上游响应结构与余额协议不兼容");
  }

  const data = value.data;
  const subscriptions = Array.isArray(data.subscriptions)
    ? data.subscriptions
        .map(parseSubscription)
        .filter((item): item is AccountSubscription => Boolean(item))
    : [];

  return {
    username: cleanText(data.username, "未提供账号名", 160),
    quota: finiteNumber(data.quota),
    used_quota: finiteNumber(data.used_quota),
    request_count: finiteNumber(data.request_count),
    currency: cleanText(data.currency, "--", 12).toUpperCase(),
    balance_amount: finiteNumber(data.balance_amount),
    recharge_balance_amount: null,
    gift_balance_amount: null,
    used_amount: finiteNumber(data.used_amount),
    subscriptions,
  };
}

function accountHealth(record: UpstreamRecord): PublicUpstream["health"] {
  if (!record.active) return "paused";
  if (record.sync.status === "error") return "error";
  if (!record.usage || record.sync.status === "idle") return "pending";
  if (
    record.usage.balance_amount !== null &&
    record.usage.balance_amount <= record.lowBalanceThreshold
  ) {
    return "warning";
  }
  return "healthy";
}

function toPublic(record: UpstreamRecord): PublicUpstream {
  const { credentials, ...safe } = record;
  const maskedKey =
    credentials.provider === "generic_bearer"
      ? maskApiKey(credentials.apiKey)
      : credentials.provider === "web_bearer"
        ? "Bearer ••••••••"
        : credentials.provider === "aliyun_bss"
          ? maskApiKey(credentials.accessKeyId)
          : "Cookie ••••••••";
  return {
    ...safe,
    maskedKey,
    health: accountHealth(record),
  };
}

async function readJsonWithLimit(response: Response, maxBytes = 524_288) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("上游响应过大");
  }

  if (!response.body) {
    throw new Error("上游未返回响应内容");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("上游响应过大");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("上游未返回有效 JSON");
  }
}

function decimalNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function bytesToHex(value: ArrayBuffer) {
  return Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(digest);
}

async function hmacSha256Hex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToHex(signature);
}

async function aliyunV3Headers(
  endpoint: string,
  credentials: Extract<UpstreamCredentials, { provider: "aliyun_bss" }>,
) {
  const payloadHash = await sha256Hex("");
  const signedValues: Record<string, string> = {
    host: new URL(endpoint).host,
    "x-acs-action": "QueryAccountBalance",
    "x-acs-content-sha256": payloadHash,
    "x-acs-date": new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    "x-acs-signature-nonce": crypto.randomUUID(),
    "x-acs-version": "2017-12-14",
  };
  const sortedHeaders = Object.entries(signedValues).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const signedHeaders = sortedHeaders.map(([name]) => name).join(";");
  const canonicalHeaders = sortedHeaders
    .map(([name, value]) => `${name}:${value.trim()}`)
    .join("\n");
  const canonicalRequest = [
    "POST",
    "/",
    "",
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = `ACS3-HMAC-SHA256\n${await sha256Hex(canonicalRequest)}`;
  const signature = await hmacSha256Hex(
    credentials.accessKeySecret,
    stringToSign,
  );

  return {
    Accept: "application/json",
    Authorization:
      `ACS3-HMAC-SHA256 Credential=${credentials.accessKeyId},` +
      `SignedHeaders=${signedHeaders},Signature=${signature}`,
    "x-acs-action": signedValues["x-acs-action"],
    "x-acs-content-sha256": payloadHash,
    "x-acs-date": signedValues["x-acs-date"],
    "x-acs-signature-nonce": signedValues["x-acs-signature-nonce"],
    "x-acs-version": signedValues["x-acs-version"],
  };
}

function aliyunError(status: number, value: unknown) {
  const rawCode = isObject(value) ? cleanText(value.Code, "", 80) : "";
  const code = rawCode.replace(/[^A-Za-z0-9_.-]/g, "");
  if (/InvalidAccessKeyId/i.test(code)) {
    return new Error("阿里云 AccessKey ID 无效或已停用");
  }
  if (/Timestamp|SignatureNonce/i.test(code)) {
    return new Error("服务器时间或请求随机数未通过阿里云校验");
  }
  if (/Signature|InvalidAccessKey|IncompleteSignature/i.test(code)) {
    return new Error("阿里云 AccessKey Secret 无效或签名校验失败");
  }
  if (/NoPermission|NotAuthorized|Forbidden/i.test(code) || status === 403) {
    return new Error("RAM 用户无权查询阿里云余额");
  }
  if (/Throttl/i.test(code) || status === 429) {
    return new Error("阿里云请求过于频繁，请稍后重试");
  }
  if (/NotApplicable/i.test(code)) {
    return new Error("当前阿里云账号类型不支持余额查询");
  }
  if (/InternalError|UndefinedError/i.test(code) || status >= 500) {
    return new Error("阿里云余额服务暂时不可用");
  }
  if (code) return new Error(`阿里云余额查询失败（${code}）`);
  return new Error(`阿里云余额查询失败（HTTP ${status}）`);
}

function parseAliyunBalanceResponse(
  value: unknown,
  accountName: string,
): AccountUsageData {
  if (!isObject(value)) throw new Error("阿里云余额响应不是有效对象");
  if (value.Success !== true || String(value.Code) !== "200") {
    throw aliyunError(200, value);
  }
  if (!isObject(value.Data)) {
    throw new Error("阿里云余额响应缺少 Data");
  }

  const balanceAmount = decimalNumber(value.Data.AvailableAmount);
  if (balanceAmount === null) {
    throw new Error("阿里云余额响应缺少可用额度");
  }

  return {
    username: accountName,
    quota: null,
    used_quota: null,
    request_count: null,
    currency: cleanText(value.Data.Currency, "CNY", 12).toUpperCase(),
    balance_amount: balanceAmount,
    recharge_balance_amount: null,
    gift_balance_amount: null,
    used_amount: null,
    subscriptions: [],
  };
}

function webBearerHttpError(status: number) {
  if (status === 401) {
    return new Error("上游网页访问令牌无效或已过期");
  }
  if (status === 403) {
    return new Error("上游网页访问令牌无权查询余额");
  }
  if (status === 429) {
    return new Error("上游请求过于频繁，请稍后重试");
  }
  if (status >= 300 && status < 400) {
    return new Error("上游接口发生重定向，请检查服务地址或接口路径");
  }
  if (status >= 500) {
    return new Error("上游余额服务暂时不可用");
  }
  return new Error(`上游余额查询失败（HTTP ${status}）`);
}

function parseWebBearerResponse(
  value: unknown,
  accountName: string,
  quotaDivisor: number,
  balanceCurrency: string,
): AccountUsageData {
  if (!isObject(value) || value.success !== true || !isObject(value.data)) {
    throw new Error("上游响应结构与网页访问令牌余额协议不兼容");
  }

  const quota = finiteNumber(value.data.quota);
  if (quota === null) {
    throw new Error("上游网页访问令牌余额响应缺少 quota");
  }
  const usedQuota = finiteNumber(value.data.used_quota);
  const balanceAmount = quota / quotaDivisor;
  const usedAmount = usedQuota === null ? null : usedQuota / quotaDivisor;
  if (!Number.isFinite(balanceAmount) || !Number.isFinite(usedAmount ?? 0)) {
    throw new Error("上游网页访问令牌余额换算结果无效");
  }

  return {
    username: accountName,
    quota,
    used_quota: usedQuota,
    request_count: finiteNumber(value.data.request_count),
    currency: balanceCurrency,
    balance_amount: balanceAmount,
    recharge_balance_amount: null,
    gift_balance_amount: null,
    used_amount: usedAmount,
    subscriptions: [],
  };
}

function cookieSessionCode(value: unknown) {
  if (!isObject(value)) return "";
  if (typeof value.code !== "number" && typeof value.code !== "string") {
    return "";
  }
  return String(value.code).trim();
}

function cookieSessionHttpError(status: number) {
  if (status === 401 || status === 403) {
    return new Error("上游登录会话已失效，请重新登录后更新 Cookie");
  }
  if (status === 429) {
    return new Error("上游请求过于频繁，请稍后重试");
  }
  if (status >= 300 && status < 400) {
    return new Error("上游接口发生重定向，请检查服务地址或接口路径");
  }
  if (status >= 500) {
    return new Error("上游余额服务暂时不可用");
  }
  return new Error(`上游余额查询失败（HTTP ${status}）`);
}

function cookieSessionPoints(value: unknown, fieldName: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`上游余额响应中的 ${fieldName} 不是安全整数`);
  }
  return value;
}

function parseCookieSessionPointsResponse(
  value: unknown,
  accountName: string,
): AccountUsageData {
  const code = cookieSessionCode(value);
  if (
    !isObject(value) ||
    value.success !== true ||
    code !== "200" ||
    !isObject(value.data)
  ) {
    throw new Error("上游余额响应结构与 Cookie 会话协议不兼容");
  }

  const personalRecharge = cookieSessionPoints(
    value.data.personalRecharge,
    "personalRecharge",
  );
  const systemGift = cookieSessionPoints(value.data.systemGift, "systemGift");
  const totalPoints = personalRecharge + systemGift;
  if (!Number.isSafeInteger(totalPoints)) {
    throw new Error("上游余额合计超出安全整数范围");
  }

  return {
    username: accountName,
    quota: totalPoints,
    used_quota: null,
    request_count: null,
    currency: "CNY",
    balance_amount: totalPoints / 100_000_000,
    recharge_balance_amount: personalRecharge / 100_000_000,
    gift_balance_amount: systemGift / 100_000_000,
    used_amount: null,
    subscriptions: [],
  };
}

function parseCookieSessionResponse(
  value: unknown,
  accountName: string,
): AccountUsageData {
  const code = cookieSessionCode(value);
  if (code === "40001") {
    throw new Error("上游登录会话已失效，请重新登录后更新 Cookie");
  }
  if (code === "429") {
    throw new Error("上游请求过于频繁，请稍后重试");
  }

  if (
    isObject(value) &&
    isObject(value.data) &&
    (Object.hasOwn(value.data, "personalRecharge") ||
      Object.hasOwn(value.data, "systemGift"))
  ) {
    return parseCookieSessionPointsResponse(value, accountName);
  }
  return parseUsageResponse(value);
}

export function getDashboardPayload(): DashboardPayload {
  return {
    accounts: Array.from(store.values())
      .sort((a, b) => {
        if (a.isDemo !== b.isDemo) return a.isDemo ? 1 : -1;
        return a.createdAt.localeCompare(b.createdAt);
      })
      .map(toPublic),
    generatedAt: new Date().toISOString(),
    refreshIntervalSeconds: 60,
  };
}

async function fetchUsage(record: UpstreamRecord) {
  if (record.isDemo) return record.usage;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    if (record.credentials.provider === "aliyun_bss") {
      const response = await fetch(`${record.baseUrl}/`, {
        method: "POST",
        headers: await aliyunV3Headers(record.baseUrl, record.credentials),
        redirect: "manual",
        signal: controller.signal,
      });

      let body: unknown = null;
      try {
        body = await readJsonWithLimit(response);
      } catch (error) {
        if (response.ok) throw error;
      }
      if (!response.ok) throw aliyunError(response.status, body);
      return parseAliyunBalanceResponse(body, record.name);
    }

    if (record.credentials.provider === "cookie_session") {
      const response = await fetch(`${record.baseUrl}${record.balancePath}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Cookie: record.credentials.sessionCookie,
          loginWay: "0",
        },
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });

      if (!response.ok) throw cookieSessionHttpError(response.status);
      const body = await readJsonWithLimit(response);
      return parseCookieSessionResponse(body, record.name);
    }

    if (record.credentials.provider === "web_bearer") {
      const headers = new Headers({
        Accept: "application/json",
        Authorization: `Bearer ${record.credentials.accessToken}`,
      });
      headers.set(record.userHeaderName, record.credentials.userHeaderValue);
      const response = await fetch(`${record.baseUrl}${record.balancePath}`, {
        method: "GET",
        headers,
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });

      if (!response.ok) throw webBearerHttpError(response.status);
      const body = await readJsonWithLimit(response);
      return parseWebBearerResponse(
        body,
        record.name,
        record.quotaDivisor,
        record.balanceCurrency,
      );
    }

    const response = await fetch(`${record.baseUrl}${record.balancePath}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${record.credentials.apiKey}`,
      },
      redirect: "manual",
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 401) throw new Error("API Key 无效或已过期");
      if (response.status === 403) throw new Error("当前 API Key 无权查询余额");
      if (response.status === 429) throw new Error("上游请求过于频繁，请稍后重试");
      throw new Error(`上游暂时不可用（HTTP ${response.status}）`);
    }

    const body = await readJsonWithLimit(response);
    return parseUsageResponse(body);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("连接上游超时（10 秒）");
    }
    if (
      error instanceof Error &&
      (error.message.startsWith("上游") ||
        error.message.startsWith("阿里云"))
    ) {
      throw error;
    }
    if (
      error instanceof Error &&
      (error.message.includes("API Key") ||
        error.message.includes("AccessKey") ||
        error.message.includes("签名") ||
        error.message.includes("RAM") ||
        error.message.includes("服务器时间") ||
        error.message.includes("无权"))
    ) {
      throw error;
    }
    throw new Error("无法连接上游，请检查地址或网络");
  } finally {
    clearTimeout(timeout);
  }
}

export async function refreshUpstream(record: UpstreamRecord) {
  const attemptedAt = new Date().toISOString();
  record.sync.lastAttemptAt = attemptedAt;

  if (!record.active) {
    record.sync.status = "idle";
    record.sync.error = null;
    record.updatedAt = attemptedAt;
    return;
  }

  try {
    const usage = await fetchUsage(record);
    record.usage = usage;
    record.sync.status = "success";
    record.sync.lastSuccessAt = attemptedAt;
    record.sync.error = null;
  } catch (error) {
    record.sync.status = "error";
    record.sync.error =
      error instanceof Error ? error.message : "上游同步失败，请稍后重试";
  }
  record.updatedAt = new Date().toISOString();
}

export async function createUpstream(input: UpstreamInput) {
  const realAccountCount = Array.from(store.values()).filter(
    (account) => !account.isDemo,
  ).length;
  if (realAccountCount >= 25) {
    throw new InputError("第一版最多保存 25 个真实上游账号");
  }

  const now = new Date().toISOString();
  const provider = cleanProvider(input.provider);
  const userHeaderName =
    provider === "web_bearer" ? cleanUserHeaderName(input.userHeaderName) : "";
  const quotaDivisor =
    provider === "web_bearer" ? cleanQuotaDivisor(input.quotaDivisor) : 1;
  const balanceCurrency =
    provider === "web_bearer"
      ? cleanBalanceCurrency(input.balanceCurrency)
      : "CNY";
  let connection: Pick<
    UpstreamRecord,
    "provider" | "baseUrl" | "balancePath" | "credentials"
  >;
  if (provider === "aliyun_bss") {
    connection = {
      provider,
      baseUrl: cleanAliyunEndpoint(input.baseUrl),
      balancePath: "/",
      credentials: {
        provider,
        accessKeyId: cleanAccessKeyId(input.accessKeyId, true),
        accessKeySecret: cleanAccessKeySecret(input.accessKeySecret, true),
      },
    };
  } else if (provider === "cookie_session") {
    connection = {
      provider,
      baseUrl: cleanBaseUrl(input.baseUrl),
      balancePath: cleanBalancePath(input.balancePath),
      credentials: {
        provider,
        sessionCookie: cleanSessionCookie(input.sessionCookie, true),
      },
    };
  } else if (provider === "web_bearer") {
    connection = {
      provider,
      baseUrl: cleanBaseUrl(input.baseUrl),
      balancePath: cleanBalancePath(input.balancePath),
      credentials: {
        provider,
        accessToken: cleanWebAccessToken(input.accessToken, true),
        userHeaderValue: cleanUserHeaderValue(input.userHeaderValue, true),
      },
    };
  } else {
    connection = {
      provider,
      baseUrl: cleanBaseUrl(input.baseUrl),
      balancePath: cleanBalancePath(input.balancePath),
      credentials: {
        provider,
        apiKey: cleanApiKey(input.apiKey, true),
      },
    };
  }
  const record: UpstreamRecord = {
    id: crypto.randomUUID(),
    name: cleanName(input.name),
    ...connection,
    userHeaderName,
    quotaDivisor,
    balanceCurrency,
    lowBalanceThreshold: cleanThreshold(input.lowBalanceThreshold),
    active: input.active === undefined ? true : input.active === true,
    isDemo: false,
    createdAt: now,
    updatedAt: now,
    usage: null,
    sync: {
      status: "idle",
      lastAttemptAt: null,
      lastSuccessAt: null,
      error: null,
    },
  };

  store.set(record.id, record);
  await refreshUpstream(record);
  return toPublic(record);
}

export async function updateUpstream(id: string, input: UpstreamInput) {
  const record = store.get(id);
  if (!record) throw new NotFoundError("未找到这个上游账号");

  const requestedProvider = cleanProvider(input.provider, record.provider);
  if (requestedProvider !== record.provider) {
    throw new InputError("上游类型不能修改，请新建另一个账号");
  }

  const draft: UpstreamRecord = {
    ...record,
    credentials: { ...record.credentials },
    sync: { ...record.sync },
  };
  const nextName =
    input.name === undefined ? record.name : cleanName(input.name);
  const nextThreshold =
    input.lowBalanceThreshold === undefined
      ? record.lowBalanceThreshold
      : cleanThreshold(input.lowBalanceThreshold);

  draft.name = nextName;
  draft.lowBalanceThreshold = nextThreshold;

  if (
    record.provider === "aliyun_bss" &&
    draft.credentials.provider === "aliyun_bss"
  ) {
    const nextBaseUrl =
      input.baseUrl === undefined
        ? record.baseUrl
        : cleanAliyunEndpoint(input.baseUrl);
    if (input.balancePath !== undefined && input.balancePath !== "/") {
      throw new InputError("阿里云余额接口路径固定为 /");
    }
    const submittedAccessKeyId =
      input.accessKeyId === undefined
        ? ""
        : cleanAccessKeyId(input.accessKeyId, false);
    const submittedAccessKeySecret =
      input.accessKeySecret === undefined
        ? ""
        : cleanAccessKeySecret(input.accessKeySecret, false);
    const submittedOneCredential =
      Boolean(submittedAccessKeyId) !== Boolean(submittedAccessKeySecret);

    if (submittedOneCredential) {
      throw new InputError("更新阿里云凭证时必须同时填写 AK 和 SK");
    }
    if (
      nextBaseUrl !== record.baseUrl &&
      (!submittedAccessKeyId || !submittedAccessKeySecret)
    ) {
      throw new InputError("修改阿里云 Endpoint 时，必须重新输入 AK 和 SK");
    }

    draft.baseUrl = nextBaseUrl;
    draft.balancePath = "/";
    if (submittedAccessKeyId && submittedAccessKeySecret) {
      draft.credentials = {
        provider: "aliyun_bss",
        accessKeyId: submittedAccessKeyId,
        accessKeySecret: submittedAccessKeySecret,
      };
    }
  } else if (
    record.provider === "web_bearer" &&
    draft.credentials.provider === "web_bearer"
  ) {
    const nextBaseUrl =
      input.baseUrl === undefined ? record.baseUrl : cleanBaseUrl(input.baseUrl);
    const nextBalancePath =
      input.balancePath === undefined
        ? record.balancePath
        : cleanBalancePath(input.balancePath);
    const nextUserHeaderName =
      input.userHeaderName === undefined
        ? record.userHeaderName
        : cleanUserHeaderName(input.userHeaderName);
    const nextQuotaDivisor =
      input.quotaDivisor === undefined
        ? record.quotaDivisor
        : cleanQuotaDivisor(input.quotaDivisor);
    const nextBalanceCurrency =
      input.balanceCurrency === undefined
        ? record.balanceCurrency
        : cleanBalanceCurrency(input.balanceCurrency);
    const submittedToken =
      input.accessToken === undefined
        ? ""
        : cleanWebAccessToken(input.accessToken, false);
    const submittedHeaderValue =
      input.userHeaderValue === undefined
        ? ""
        : cleanUserHeaderValue(input.userHeaderValue, false);
    const connectionChanged =
      nextBaseUrl !== record.baseUrl || nextBalancePath !== record.balancePath;
    const headerNameChanged = nextUserHeaderName !== record.userHeaderName;

    if (connectionChanged && (!submittedToken || !submittedHeaderValue)) {
      throw new InputError(
        "修改上游地址或接口路径时，必须重新输入 Access Token 和用户请求头值",
      );
    }
    if (headerNameChanged && !submittedHeaderValue) {
      throw new InputError(
        "修改用户请求头名称时，必须重新输入用户请求头值",
      );
    }

    draft.baseUrl = nextBaseUrl;
    draft.balancePath = nextBalancePath;
    draft.userHeaderName = nextUserHeaderName;
    draft.quotaDivisor = nextQuotaDivisor;
    draft.balanceCurrency = nextBalanceCurrency;
    if (submittedToken || submittedHeaderValue) {
      draft.credentials = {
        provider: "web_bearer",
        accessToken: submittedToken || record.credentials.accessToken,
        userHeaderValue:
          submittedHeaderValue || record.credentials.userHeaderValue,
      };
    }
  } else if (
    record.provider === "cookie_session" &&
    draft.credentials.provider === "cookie_session"
  ) {
    const nextBaseUrl =
      input.baseUrl === undefined
        ? record.baseUrl
        : cleanBaseUrl(input.baseUrl);
    const nextBalancePath =
      input.balancePath === undefined
        ? record.balancePath
        : cleanBalancePath(input.balancePath);
    const submittedCookie =
      input.sessionCookie === undefined
        ? ""
        : cleanSessionCookie(input.sessionCookie, false);
    const connectionChanged =
      nextBaseUrl !== record.baseUrl || nextBalancePath !== record.balancePath;

    if (connectionChanged && !submittedCookie) {
      throw new InputError(
        "修改上游地址或接口路径时，必须重新输入 Cookie",
      );
    }

    draft.baseUrl = nextBaseUrl;
    draft.balancePath = nextBalancePath;
    if (submittedCookie) {
      draft.credentials = {
        provider: "cookie_session",
        sessionCookie: submittedCookie,
      };
    }
  } else if (
    record.provider === "generic_bearer" &&
    draft.credentials.provider === "generic_bearer"
  ) {
    const nextBaseUrl =
      input.baseUrl === undefined ? record.baseUrl : cleanBaseUrl(input.baseUrl);
    const nextBalancePath =
      input.balancePath === undefined
        ? record.balancePath
        : cleanBalancePath(input.balancePath);
    const submittedKey =
      input.apiKey === undefined ? "" : cleanApiKey(input.apiKey, false);
    const connectionChanged =
      nextBaseUrl !== record.baseUrl || nextBalancePath !== record.balancePath;

    if (connectionChanged && !submittedKey) {
      throw new InputError("修改上游地址或接口路径时，必须重新输入 API Key");
    }

    draft.baseUrl = nextBaseUrl;
    draft.balancePath = nextBalancePath;
    if (submittedKey) {
      draft.credentials = { provider: "generic_bearer", apiKey: submittedKey };
    }
  }

  if (input.active !== undefined) {
    if (typeof input.active !== "boolean") {
      throw new InputError("启用状态格式不正确");
    }
    draft.active = input.active;
  }

  draft.updatedAt = new Date().toISOString();
  await refreshUpstream(draft);
  store.set(id, draft);
  return toPublic(draft);
}

export function removeUpstream(id: string) {
  if (!store.has(id)) throw new NotFoundError("未找到这个上游账号");
  store.delete(id);
}

export async function refreshAccounts(id?: string) {
  if (id !== undefined) {
    const record = store.get(id);
    if (!record) throw new NotFoundError("未找到这个上游账号");
    await refreshUpstream(record);
    return;
  }
  const records = Array.from(store.values());
  for (let index = 0; index < records.length; index += 5) {
    await Promise.all(records.slice(index, index + 5).map(refreshUpstream));
  }
}
