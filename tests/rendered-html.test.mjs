import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";
import test, { before } from "node:test";

process.env.ZHANGDAN_DB_PATH = ":memory:";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const workerPromise = import(workerUrl.href).then(({ default: worker }) => worker);

const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
};

let authCookie = null;

async function request(path, init = {}) {
  const { authenticated = true, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  if (authenticated && authCookie && !headers.has("cookie")) {
    headers.set("cookie", authCookie);
  }
  const worker = await workerPromise;
  return worker.fetch(
    new Request(new URL(path, "http://localhost"), {
      ...requestInit,
      headers,
    }),
    env,
    ctx,
  );
}

async function readJson(response) {
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  return response.json();
}

function containsProperty(value, propertyName) {
  if (Array.isArray(value)) {
    return value.some((item) => containsProperty(item, propertyName));
  }

  if (value && typeof value === "object") {
    if (Object.hasOwn(value, propertyName)) return true;
    return Object.values(value).some((item) =>
      containsProperty(item, propertyName),
    );
  }

  return false;
}

async function startMockUpstream(handler) {
  const server = createServer(handler);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

before(async () => {
  const protectedResponse = await request("/api/upstreams", {
    authenticated: false,
  });
  assert.equal(protectedResponse.status, 401);

  const homeResponse = await request("/", { authenticated: false });
  assert.match(String(homeResponse.status), /^30[2378]$/);
  assert.equal(new URL(homeResponse.headers.get("location"), "http://localhost").pathname, "/setup");

  const setupResponse = await request("/api/auth/setup", {
    authenticated: false,
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "x-forwarded-proto": "https",
    },
    body: JSON.stringify({
      username: "test-admin",
      password: "test-password-42!secure",
    }),
  });
  assert.equal(setupResponse.status, 201);
  const setCookie = setupResponse.headers.get("set-cookie");
  assert.ok(setCookie);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Max-Age=604800/i);
  assert.match(setCookie, /Secure/i);
  authCookie = setCookie.split(";", 1)[0];
});

test("管理员登录后可查看首页，刷新时不自动打开添加上游表单", async () => {
  const response = await request("/", {
    headers: { accept: "text/html" },
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /余额监控|上游余额(?:台|看板)/);
  assert.doesNotMatch(html, /Your site is taking shape|Codex is working/i);
  assert.doesNotMatch(html, /codex-preview[^>]*development/i);
  assert.doesNotMatch(html, /id="upstream-form-title"/i);
});

test("健康检查只返回服务状态且禁止缓存", async () => {
  const response = await request("/healthz");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const payload = await response.json();
  assert.deepEqual(payload, { status: "ok" });
  assert.equal(containsProperty(payload, "accounts"), false);
  assert.equal(containsProperty(payload, "credentials"), false);
});

test("未登录时全部上游管理接口均返回 401", async () => {
  const cases = [
    ["/api/upstreams", { method: "GET" }],
    [
      "/api/upstreams",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    ],
    [
      "/api/upstreams/demo-cloudsky",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "不应更新" }),
      },
    ],
    ["/api/upstreams/demo-cloudsky", { method: "DELETE" }],
    [
      "/api/upstreams/refresh",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    ],
  ];

  for (const [path, init] of cases) {
    const response = await request(path, { ...init, authenticated: false });
    assert.equal(response.status, 401, `${init.method} ${path}`);
    const payload = await readJson(response);
    assert.deepEqual(payload, { error: "请先登录" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("初始化关闭后不能创建第二个管理员", async () => {
  const response = await request("/api/auth/setup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify({
      username: "second-admin",
      password: "another-password-42!",
    }),
  });
  assert.equal(response.status, 409);
  const payload = await readJson(response);
  assert.match(payload.error, /已经创建/);
});

test("登录错误不枚举用户名并按 IP 与用户名限速", async () => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await request("/api/auth/login", {
      authenticated: false,
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        "x-forwarded-for": "203.0.113.21",
      },
      body: JSON.stringify({
        username: "missing-admin",
        password: "wrong-password-42!",
      }),
    });
    assert.equal(response.status, 401);
    assert.equal((await readJson(response)).error, "用户名或密码不正确");
  }

  const limitedResponse = await request("/api/auth/login", {
    authenticated: false,
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "x-forwarded-for": "203.0.113.21",
    },
    body: JSON.stringify({
      username: "missing-admin",
      password: "wrong-password-42!",
    }),
  });
  assert.equal(limitedResponse.status, 429);
  assert.ok(Number(limitedResponse.headers.get("retry-after")) > 0);
});

test("独立登录会话可退出且不会影响其他会话", async () => {
  const loginResponse = await request("/api/auth/login", {
    authenticated: false,
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "x-forwarded-for": "203.0.113.22",
    },
    body: JSON.stringify({
      username: "TEST-ADMIN",
      password: "test-password-42!secure",
    }),
  });
  assert.equal(loginResponse.status, 200);
  const loginCookie = loginResponse.headers.get("set-cookie");
  assert.ok(loginCookie);
  const secondSessionCookie = loginCookie.split(";", 1)[0];

  const authenticatedResponse = await request("/api/upstreams", {
    authenticated: false,
    headers: { cookie: secondSessionCookie },
  });
  assert.equal(authenticatedResponse.status, 200);

  const logoutResponse = await request("/api/auth/logout", {
    authenticated: false,
    method: "POST",
    headers: {
      cookie: secondSessionCookie,
      origin: "http://localhost",
    },
  });
  assert.equal(logoutResponse.status, 200);
  assert.match(logoutResponse.headers.get("set-cookie") ?? "", /Max-Age=0/i);

  const expiredResponse = await request("/api/upstreams", {
    authenticated: false,
    headers: { cookie: secondSessionCookie },
  });
  assert.equal(expiredResponse.status, 401);
  assert.equal((await readJson(expiredResponse)).error, "请先登录");

  const primarySessionResponse = await request("/api/upstreams");
  assert.equal(primarySessionResponse.status, 200);
});

test("演示账号只通过脱敏字段返回", async () => {
  const response = await request("/api/upstreams");
  assert.equal(response.status, 200);

  const payload = await readJson(response);
  assert.ok(Array.isArray(payload.accounts));
  assert.ok(payload.accounts.length >= 1);
  assert.equal(payload.refreshIntervalSeconds, 60);
  assert.equal(typeof payload.generatedAt, "string");
  assert.equal(containsProperty(payload, "apiKey"), false);

  const demo = payload.accounts[0];
  assert.equal(typeof demo.name, "string");
  assert.ok(demo.name.length > 0);
  assert.equal(typeof demo.maskedKey, "string");
  assert.match(demo.maskedKey, /[*•…]/);
});

test("创建真实上游时由服务端携带 Bearer Token 并返回脱敏余额", async (t) => {
  const secret = "test-api-key";
  const observed = {};
  const upstreamPayload = {
    success: true,
    data: {
      username: "operations@example.com",
      quota: 987654,
      used_quota: 123456,
      request_count: 4321,
      currency: "USD",
      balance_amount: 864.198,
      used_amount: 123.456,
      subscriptions: [
        {
          id: 72,
          plan_id: 9,
          plan_title: "Unlimited Ops",
          amount_total: 0,
          amount_used: 34567,
          amount_remain: 0,
          status: "active",
          start_time: 1767225600,
          end_time: 1769904000,
          next_reset_time: 0,
        },
      ],
    },
  };

  const mock = await startMockUpstream((incoming, outgoing) => {
    observed.method = incoming.method;
    observed.url = incoming.url;
    observed.authorization = incoming.headers.authorization;
    observed.accept = incoming.headers.accept;
    outgoing.writeHead(200, { "content-type": "application/json" });
    outgoing.end(JSON.stringify(upstreamPayload));
  });
  t.after(mock.close);

  const response = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "生产上游 A",
      baseUrl: mock.baseUrl,
      apiKey: secret,
      lowBalanceThreshold: 50,
    }),
  });

  assert.equal(response.status, 201);
  const payload = await readJson(response);

  assert.equal(observed.method, "GET");
  assert.equal(observed.url, "/api/usage/balance");
  assert.equal(observed.authorization, `Bearer ${secret}`);
  assert.match(observed.accept ?? "", /application\/json/i);

  assert.ok(Array.isArray(payload.accounts));
  assert.ok(payload.accounts.length >= 2, "演示账号与真实账号应同时存在");
  const created = payload.accounts.find((account) => account.name === "生产上游 A");
  assert.ok(created);
  assert.equal(created.baseUrl, mock.baseUrl);
  assert.equal(created.balancePath, "/api/usage/balance");
  assert.equal(typeof created.maskedKey, "string");
  assert.notEqual(created.maskedKey, secret);
  assert.equal(created.maskedKey.includes(secret), false);
  assert.equal(containsProperty(payload, "apiKey"), false);
  assert.equal(JSON.stringify(payload).includes(secret), false);

  assert.equal(created.usage.username, upstreamPayload.data.username);
  assert.equal(created.usage.quota, upstreamPayload.data.quota);
  assert.equal(created.usage.used_quota, upstreamPayload.data.used_quota);
  assert.equal(created.usage.request_count, upstreamPayload.data.request_count);
  assert.equal(created.usage.currency, upstreamPayload.data.currency);
  assert.equal(
    created.usage.balance_amount,
    upstreamPayload.data.balance_amount,
  );
  assert.equal(created.usage.used_amount, upstreamPayload.data.used_amount);
  assert.equal(created.usage.subscriptions.length, 1);
  assert.equal(created.usage.subscriptions[0].amount_total, 0);
  assert.equal(created.usage.subscriptions[0].next_reset_time, 0);

  const updateResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "生产上游 A（停用）",
        active: false,
        lowBalanceThreshold: 40,
      }),
    },
  );
  assert.equal(updateResponse.status, 200);
  const updatedPayload = await readJson(updateResponse);
  const updated = updatedPayload.accounts.find(
    (account) => account.id === created.id,
  );
  assert.ok(updated);
  assert.equal(updated.name, "生产上游 A（停用）");
  assert.equal(updated.active, false);
  assert.equal(updated.lowBalanceThreshold, 40);
  assert.equal(updated.sync.status, "idle");
  assert.equal(updated.usage.balance_amount, upstreamPayload.data.balance_amount);

  const deleteResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    { method: "DELETE" },
  );
  assert.equal(deleteResponse.status, 200);
  const deletedPayload = await readJson(deleteResponse);
  assert.equal(
    deletedPayload.accounts.some((account) => account.id === created.id),
    false,
  );
  assert.equal(containsProperty(deletedPayload, "apiKey"), false);
});

test("网页 Bearer 上游携带动态用户头并按配置换算余额", async (t) => {
  const accessToken = "test-web-bearer-token-7Vq9";
  const userHeaderName = "New-Api-User";
  const userHeaderValue = "test-user-42017";
  const baseUrl = "https://web-balance.example";
  const balancePath = "/api/user/self";
  const quota = 12_345_678_900;
  const usedQuota = 59_876_543;
  const requestCount = 12_345;
  const observed = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const upstreamRequest = new Request(input, init);
    observed.push({
      url: upstreamRequest.url,
      method: upstreamRequest.method,
      authorization: upstreamRequest.headers.get("authorization"),
      userHeaderValue: upstreamRequest.headers.get(userHeaderName),
      accept: upstreamRequest.headers.get("accept"),
      redirect: upstreamRequest.redirect,
    });
    return Response.json({
      success: true,
      data: {
        quota,
        used_quota: usedQuota,
        request_count: requestCount,
      },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "web_bearer",
      name: "网页 Bearer 余额账号",
      baseUrl,
      balancePath,
      accessToken,
      userHeaderName,
      userHeaderValue,
      quotaDivisor: 500_000,
      balanceCurrency: "CNY",
      lowBalanceThreshold: 1_000,
    }),
  });

  assert.equal(response.status, 201);
  const payload = await readJson(response);
  const created = payload.accounts.find(
    (account) => account.name === "网页 Bearer 余额账号",
  );
  assert.ok(created);

  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0], {
    url: `${baseUrl}${balancePath}`,
    method: "GET",
    authorization: `Bearer ${accessToken}`,
    userHeaderValue,
    accept: "application/json",
    redirect: "manual",
  });
  assert.equal(created.provider, "web_bearer");
  assert.equal(created.baseUrl, baseUrl);
  assert.equal(created.balancePath, balancePath);
  assert.equal(created.maskedKey, "Bearer ••••••••");
  assert.equal(created.usage.username, created.name);
  assert.equal(created.usage.quota, quota);
  assert.equal(created.usage.used_quota, usedQuota);
  assert.equal(created.usage.request_count, requestCount);
  assert.equal(created.usage.balance_amount, 24_691.3578);
  assert.equal(created.usage.used_amount, 119.753086);
  assert.equal(created.usage.currency, "CNY");
  assert.equal(created.usage.recharge_balance_amount, null);
  assert.equal(created.usage.gift_balance_amount, null);
  assert.deepEqual(created.usage.subscriptions, []);

  assert.equal(containsProperty(payload, "credentials"), false);
  assert.equal(containsProperty(payload, "accessToken"), false);
  assert.equal(containsProperty(payload, "userHeaderValue"), false);
  assert.equal(JSON.stringify(payload).includes(accessToken), false);
  assert.equal(JSON.stringify(payload).includes(userHeaderValue), false);

  const blankCredentialResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "网页 Bearer 余额账号（保留凭证）",
        accessToken: "",
        userHeaderValue: "",
      }),
    },
  );
  assert.equal(blankCredentialResponse.status, 200);
  assert.equal(observed.length, 2);
  assert.equal(observed[1].authorization, `Bearer ${accessToken}`);
  assert.equal(observed[1].userHeaderValue, userHeaderValue);
  const blankCredentialPayload = await readJson(blankCredentialResponse);
  const blankCredentialAccount = blankCredentialPayload.accounts.find(
    (account) => account.id === created.id,
  );
  assert.equal(blankCredentialAccount.maskedKey, "Bearer ••••••••");
  assert.equal(containsProperty(blankCredentialPayload, "accessToken"), false);
  assert.equal(
    containsProperty(blankCredentialPayload, "userHeaderValue"),
    false,
  );
  assert.equal(
    JSON.stringify(blankCredentialPayload).includes(accessToken),
    false,
  );
  assert.equal(
    JSON.stringify(blankCredentialPayload).includes(userHeaderValue),
    false,
  );
});

test("网页 Bearer 上游变更连接或用户头时必须提交对应新凭证", async (t) => {
  const sourceToken = "test-source-web-token-3Lm7";
  const replacementToken = "test-replacement-web-token-6Rt2";
  const sourceHeaderName = "New-Api-User";
  const sourceHeaderValue = "test-source-user-331";
  const replacementHeaderName = "X-Account-Id";
  const replacementHeaderValue = "test-target-user-772";
  const sourceBaseUrl = "https://web-source.example";
  const sourcePath = "/internal/balance";
  const targetBaseUrl = "https://web-target.example";
  const targetPath = "/new/internal/balance";
  const observed = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const upstreamRequest = new Request(input, init);
    observed.push({
      url: upstreamRequest.url,
      authorization: upstreamRequest.headers.get("authorization"),
      sourceHeaderValue: upstreamRequest.headers.get(sourceHeaderName),
      replacementHeaderValue: upstreamRequest.headers.get(
        replacementHeaderName,
      ),
    });
    return Response.json({
      success: true,
      data: {
        username: "bound-web-session",
        quota: 10_000_000,
        used_quota: 1_000_000,
        request_count: 12,
      },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const createResponse = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "web_bearer",
      name: "网页 Bearer 连接绑定测试",
      baseUrl: sourceBaseUrl,
      balancePath: sourcePath,
      accessToken: sourceToken,
      userHeaderName: sourceHeaderName,
      userHeaderValue: sourceHeaderValue,
      quotaDivisor: 500_000,
      balanceCurrency: "CNY",
    }),
  });
  assert.equal(createResponse.status, 201);
  const createPayload = await readJson(createResponse);
  const created = createPayload.accounts.find(
    (account) => account.name === "网页 Bearer 连接绑定测试",
  );
  assert.ok(created);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].url, `${sourceBaseUrl}${sourcePath}`);
  assert.equal(observed[0].authorization, `Bearer ${sourceToken}`);
  assert.equal(observed[0].sourceHeaderValue, sourceHeaderValue);

  const baseUrlChangeResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: targetBaseUrl }),
    },
  );
  assert.equal(baseUrlChangeResponse.status, 400);
  assert.match(
    (await readJson(baseUrlChangeResponse)).error,
    /修改上游地址或接口路径时，必须重新输入 Access Token 和用户请求头值/,
  );
  assert.equal(observed.length, 1);

  const tokenOnlyPathChangeResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        balancePath: targetPath,
        accessToken: replacementToken,
      }),
    },
  );
  assert.equal(tokenOnlyPathChangeResponse.status, 400);
  assert.match(
    (await readJson(tokenOnlyPathChangeResponse)).error,
    /修改上游地址或接口路径时，必须重新输入 Access Token 和用户请求头值/,
  );
  assert.equal(observed.length, 1);

  const headerOnlyBaseUrlChangeResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: targetBaseUrl,
        userHeaderValue: replacementHeaderValue,
      }),
    },
  );
  assert.equal(headerOnlyBaseUrlChangeResponse.status, 400);
  assert.match(
    (await readJson(headerOnlyBaseUrlChangeResponse)).error,
    /修改上游地址或接口路径时，必须重新输入 Access Token 和用户请求头值/,
  );
  assert.equal(observed.length, 1);

  const headerNameChangeResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userHeaderName: replacementHeaderName }),
    },
  );
  assert.equal(headerNameChangeResponse.status, 400);
  assert.match(
    (await readJson(headerNameChangeResponse)).error,
    /修改用户请求头名称时，必须重新输入用户请求头值/,
  );
  assert.equal(observed.length, 1);

  const replacementResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: targetBaseUrl,
        balancePath: targetPath,
        accessToken: replacementToken,
        userHeaderName: replacementHeaderName,
        userHeaderValue: replacementHeaderValue,
      }),
    },
  );
  assert.equal(replacementResponse.status, 200);
  assert.equal(observed.length, 2);
  assert.deepEqual(observed[1], {
    url: `${targetBaseUrl}${targetPath}`,
    authorization: `Bearer ${replacementToken}`,
    sourceHeaderValue: null,
    replacementHeaderValue,
  });
  assert.equal(
    observed.some(
      (upstreamRequest) =>
        upstreamRequest.url.startsWith(targetBaseUrl) &&
        upstreamRequest.authorization === `Bearer ${sourceToken}`,
    ),
    false,
  );
  assert.equal(
    observed.some(
      (upstreamRequest) =>
        upstreamRequest.url.startsWith(targetBaseUrl) &&
        upstreamRequest.sourceHeaderValue === sourceHeaderValue,
    ),
    false,
  );
  const replacementPayload = await readJson(replacementResponse);
  assert.equal(containsProperty(replacementPayload, "accessToken"), false);
  assert.equal(containsProperty(replacementPayload, "userHeaderValue"), false);
  assert.equal(JSON.stringify(replacementPayload).includes(sourceToken), false);
  assert.equal(
    JSON.stringify(replacementPayload).includes(replacementToken),
    false,
  );
  assert.equal(
    JSON.stringify(replacementPayload).includes(replacementHeaderValue),
    false,
  );
});

test("网页 Bearer 上游失效或重定向时保留最近成功余额", async (t) => {
  const accessToken = "test-expiring-web-token-4Ns8";
  const userHeaderValue = "test-expiring-user-204";
  const baseUrl = "https://expiring-web-bearer.example";
  const balancePath = "/api/account/balance";
  const redirectTarget = "https://collector.attacker.example/web-token";
  const originalFetch = globalThis.fetch;
  const observed = [];
  let responseMode = "success";

  globalThis.fetch = async (input, init) => {
    const upstreamRequest = new Request(input, init);
    observed.push({
      url: upstreamRequest.url,
      authorization: upstreamRequest.headers.get("authorization"),
      redirect: upstreamRequest.redirect,
    });
    if (responseMode === "unauthorized") {
      return Response.json(
        { success: false, message: "invalid test access token" },
        { status: 401 },
      );
    }
    if (responseMode === "redirect") {
      return new Response(null, {
        status: 301,
        headers: { location: redirectTarget },
      });
    }
    return Response.json({
      success: true,
      data: {
        username: "expiring-web-user",
        quota: 90_000_000,
        used_quota: 10_000_000,
        request_count: 55,
      },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const createResponse = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "web_bearer",
      name: "网页 Bearer 失效测试",
      baseUrl,
      balancePath,
      accessToken,
      userHeaderName: "New-Api-User",
      userHeaderValue,
      quotaDivisor: 500_000,
      balanceCurrency: "CNY",
    }),
  });
  assert.equal(createResponse.status, 201);
  const createPayload = await readJson(createResponse);
  const created = createPayload.accounts.find(
    (account) => account.name === "网页 Bearer 失效测试",
  );
  assert.ok(created);
  assert.equal(created.sync.status, "success");
  const lastSuccessfulUsage = structuredClone(created.usage);

  responseMode = "unauthorized";
  const unauthorizedResponse = await request("/api/upstreams/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: created.id }),
  });
  assert.equal(unauthorizedResponse.status, 200);
  const unauthorizedPayload = await readJson(unauthorizedResponse);
  const unauthorizedAccount = unauthorizedPayload.accounts.find(
    (account) => account.id === created.id,
  );
  assert.equal(unauthorizedAccount.sync.status, "error");
  assert.match(
    unauthorizedAccount.sync.error,
    /上游网页访问令牌无效或已过期/,
  );
  assert.deepEqual(unauthorizedAccount.usage, lastSuccessfulUsage);

  responseMode = "redirect";
  const redirectResponse = await request("/api/upstreams/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: created.id }),
  });
  assert.equal(redirectResponse.status, 200);
  const redirectPayload = await readJson(redirectResponse);
  const redirectAccount = redirectPayload.accounts.find(
    (account) => account.id === created.id,
  );
  assert.equal(redirectAccount.sync.status, "error");
  assert.match(redirectAccount.sync.error, /上游接口发生重定向/);
  assert.deepEqual(redirectAccount.usage, lastSuccessfulUsage);

  assert.equal(observed.length, 3);
  assert.equal(observed.every((item) => item.redirect === "manual"), true);
  assert.equal(
    observed.every((item) => item.url === `${baseUrl}${balancePath}`),
    true,
  );
  assert.equal(
    observed.some(
      (item) =>
        item.url === redirectTarget &&
        item.authorization === `Bearer ${accessToken}`,
    ),
    false,
  );
  assert.equal(containsProperty(redirectPayload, "accessToken"), false);
  assert.equal(containsProperty(redirectPayload, "userHeaderValue"), false);
  assert.equal(JSON.stringify(redirectPayload).includes(accessToken), false);
  assert.equal(JSON.stringify(redirectPayload).includes(userHeaderValue), false);
});

test("Cookie 会话上游使用自定义接口并换算充值与馈赠余额", async (t) => {
  const sessionCookie =
    "session_id=cookie-session-original-7Vq9; device_id=device-42";
  const baseUrl = "https://session-billing.example";
  const balancePath = "/internal/account/balance";
  const personalRecharge = 1_234_567_890_000;
  const systemGift = 2_345_678_910_000;
  const totalPoints = personalRecharge + systemGift;
  const observed = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const upstreamRequest = new Request(input, init);
    observed.push({
      url: upstreamRequest.url,
      method: upstreamRequest.method,
      accept: upstreamRequest.headers.get("accept"),
      cookie: upstreamRequest.headers.get("cookie"),
      loginWay: upstreamRequest.headers.get("loginWay"),
      redirect: upstreamRequest.redirect,
    });
    return Response.json({
      code: 200,
      success: true,
      data: {
        personalRecharge,
        systemGift,
        total: totalPoints,
        subBalances: [
          { id: 161021, balance: systemGift, balanceType: 0 },
          { id: 155941, balance: personalRecharge, balanceType: 1 },
        ],
      },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "cookie_session",
      name: "网页登录会话上游",
      baseUrl,
      balancePath,
      sessionCookie,
      lowBalanceThreshold: 10_000,
    }),
  });

  assert.equal(response.status, 201);
  const payload = await readJson(response);
  const created = payload.accounts.find(
    (account) => account.name === "网页登录会话上游",
  );
  assert.ok(created);

  assert.equal(observed.length, 1);
  assert.equal(observed[0].method, "GET");
  assert.equal(observed[0].url, `${baseUrl}${balancePath}`);
  assert.match(observed[0].accept ?? "", /application\/json/i);
  assert.equal(observed[0].cookie, sessionCookie);
  assert.equal(observed[0].loginWay, "0");
  assert.equal(observed[0].redirect, "manual");

  assert.equal(created.provider, "cookie_session");
  assert.equal(created.baseUrl, baseUrl);
  assert.equal(created.balancePath, balancePath);
  assert.equal(created.maskedKey, "Cookie ••••••••");
  assert.equal(created.usage.quota, totalPoints);
  assert.equal(created.usage.balance_amount, 35_802.468);
  assert.equal(created.usage.recharge_balance_amount, 12_345.6789);
  assert.equal(created.usage.gift_balance_amount, 23_456.7891);
  assert.equal(created.usage.currency, "CNY");
  assert.equal(created.usage.used_quota, null);
  assert.equal(created.usage.request_count, null);
  assert.equal(created.usage.used_amount, null);
  assert.deepEqual(created.usage.subscriptions, []);

  assert.equal(containsProperty(payload, "credentials"), false);
  assert.equal(containsProperty(payload, "sessionCookie"), false);
  assert.equal(containsProperty(payload, "Cookie"), false);
  assert.equal(containsProperty(payload, "cookie"), false);
  assert.equal(JSON.stringify(payload).includes(sessionCookie), false);
  assert.equal(
    JSON.stringify(payload).includes("cookie-session-original-7Vq9"),
    false,
  );

  const blankCookieResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "网页登录会话上游（保留 Cookie）",
        sessionCookie: "",
      }),
    },
  );
  assert.equal(blankCookieResponse.status, 200);
  assert.equal(observed.length, 2);
  assert.equal(observed[1].cookie, sessionCookie);
  const blankCookiePayload = await readJson(blankCookieResponse);
  const blankCookieAccount = blankCookiePayload.accounts.find(
    (account) => account.id === created.id,
  );
  assert.equal(blankCookieAccount.maskedKey, "Cookie ••••••••");
  assert.equal(containsProperty(blankCookiePayload, "sessionCookie"), false);
  assert.equal(JSON.stringify(blankCookiePayload).includes(sessionCookie), false);
});

test("Cookie 会话上游兼容标准 balance_amount 响应", async (t) => {
  const sessionCookie = "sid=standard-balance-cookie-8Qp4";
  const baseUrl = "https://standard-wallet.example";
  const balancePath = "/api/usage/balance";
  const originalFetch = globalThis.fetch;
  const observed = {};

  globalThis.fetch = async (input, init) => {
    const upstreamRequest = new Request(input, init);
    observed.url = upstreamRequest.url;
    observed.cookie = upstreamRequest.headers.get("cookie");
    observed.redirect = upstreamRequest.redirect;
    return Response.json({
      success: true,
      data: {
        username: "standard-session-wallet",
        quota: 500,
        used_quota: 125,
        request_count: 36,
        currency: "USD",
        balance_amount: 375.25,
        used_amount: 124.75,
        subscriptions: [],
      },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "cookie_session",
      name: "标准 Cookie 余额协议",
      baseUrl,
      balancePath,
      sessionCookie,
    }),
  });

  assert.equal(response.status, 201);
  const payload = await readJson(response);
  const created = payload.accounts.find(
    (account) => account.name === "标准 Cookie 余额协议",
  );
  assert.ok(created);
  assert.equal(observed.url, `${baseUrl}${balancePath}`);
  assert.equal(observed.cookie, sessionCookie);
  assert.equal(observed.redirect, "manual");
  assert.equal(created.sync.status, "success");
  assert.equal(created.usage.username, "standard-session-wallet");
  assert.equal(created.usage.balance_amount, 375.25);
  assert.equal(created.usage.recharge_balance_amount, null);
  assert.equal(created.usage.gift_balance_amount, null);
  assert.equal(created.usage.currency, "USD");
  assert.equal(created.maskedKey, "Cookie ••••••••");
  assert.equal(containsProperty(payload, "sessionCookie"), false);
  assert.equal(JSON.stringify(payload).includes(sessionCookie), false);
});

test("Cookie 会话上游变更地址或路径时必须同时提交新 Cookie", async (t) => {
  const sourceCookie = "sid=origin-bound-cookie-3Lm7";
  const replacementCookie = "sid=replacement-cookie-6Rt2";
  const sourceBaseUrl = "https://cookie-source.example";
  const sourcePath = "/private/balance";
  const targetBaseUrl = "https://cookie-target.example";
  const targetPath = "/new/private/balance";
  const observed = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const upstreamRequest = new Request(input, init);
    observed.push({
      url: upstreamRequest.url,
      cookie: upstreamRequest.headers.get("cookie"),
    });
    return Response.json({
      success: true,
      data: {
        username: "origin-bound-session",
        currency: "CNY",
        balance_amount: 88,
        subscriptions: [],
      },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const createResponse = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "cookie_session",
      name: "Cookie 地址绑定测试",
      baseUrl: sourceBaseUrl,
      balancePath: sourcePath,
      sessionCookie: sourceCookie,
    }),
  });
  assert.equal(createResponse.status, 201);
  const createPayload = await readJson(createResponse);
  const created = createPayload.accounts.find(
    (account) => account.name === "Cookie 地址绑定测试",
  );
  assert.ok(created);
  assert.deepEqual(observed, [
    { url: `${sourceBaseUrl}${sourcePath}`, cookie: sourceCookie },
  ]);

  const baseUrlChangeResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: targetBaseUrl }),
    },
  );
  assert.equal(baseUrlChangeResponse.status, 400);
  assert.match(
    (await readJson(baseUrlChangeResponse)).error,
    /修改上游地址或接口路径时，必须重新输入 Cookie/,
  );
  assert.equal(observed.length, 1);

  const pathChangeResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ balancePath: targetPath }),
    },
  );
  assert.equal(pathChangeResponse.status, 400);
  assert.match(
    (await readJson(pathChangeResponse)).error,
    /修改上游地址或接口路径时，必须重新输入 Cookie/,
  );
  assert.equal(observed.length, 1);

  const replacementResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: targetBaseUrl,
        balancePath: targetPath,
        sessionCookie: replacementCookie,
      }),
    },
  );
  assert.equal(replacementResponse.status, 200);
  assert.equal(observed.length, 2);
  assert.deepEqual(observed[1], {
    url: `${targetBaseUrl}${targetPath}`,
    cookie: replacementCookie,
  });
  assert.equal(
    observed.some(
      (upstreamRequest) =>
        upstreamRequest.url.startsWith(targetBaseUrl) &&
        upstreamRequest.cookie === sourceCookie,
    ),
    false,
  );
  const replacementPayload = await readJson(replacementResponse);
  assert.equal(containsProperty(replacementPayload, "sessionCookie"), false);
  assert.equal(JSON.stringify(replacementPayload).includes(sourceCookie), false);
  assert.equal(
    JSON.stringify(replacementPayload).includes(replacementCookie),
    false,
  );

  const listPayload = await readJson(await request("/api/upstreams"));
  const updated = listPayload.accounts.find(
    (account) => account.id === created.id,
  );
  assert.equal(updated.baseUrl, targetBaseUrl);
  assert.equal(updated.balancePath, targetPath);
});

test("Cookie 会话失效时保留最近一次成功余额", async (t) => {
  const sessionCookie = "sid=expiring-cookie-session-4Ns8";
  const baseUrl = "https://expiring-session.example";
  const balancePath = "/account/balance";
  const originalFetch = globalThis.fetch;
  let responseMode = "success";

  globalThis.fetch = async () => {
    if (responseMode === "http401") {
      return Response.json(
        { code: 40001, success: false, msg: "token不存在" },
        { status: 401 },
      );
    }
    if (responseMode === "business40001") {
      return Response.json({
        code: 40001,
        success: false,
        msg: "token不存在",
      });
    }
    return Response.json({
      code: 200,
      success: true,
      data: {
        personalRecharge: 12_345_000_000,
        systemGift: 6_789_000_000,
        subBalances: [{ balanceType: 14, balance: 9_999_999_999_999 }],
      },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const createResponse = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "cookie_session",
      name: "Cookie 会话过期测试",
      baseUrl,
      balancePath,
      sessionCookie,
    }),
  });
  assert.equal(createResponse.status, 201);
  const createPayload = await readJson(createResponse);
  const created = createPayload.accounts.find(
    (account) => account.name === "Cookie 会话过期测试",
  );
  assert.ok(created);
  assert.equal(created.sync.status, "success");
  const lastSuccessfulUsage = structuredClone(created.usage);

  for (const mode of ["http401", "business40001"]) {
    responseMode = mode;
    const refreshResponse = await request("/api/upstreams/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: created.id }),
    });
    assert.equal(refreshResponse.status, 200);

    const refreshPayload = await readJson(refreshResponse);
    const refreshed = refreshPayload.accounts.find(
      (account) => account.id === created.id,
    );
    assert.ok(refreshed);
    assert.equal(refreshed.sync.status, "error");
    assert.match(
      refreshed.sync.error,
      /上游登录会话已失效，请重新登录后更新 Cookie/,
    );
    assert.deepEqual(refreshed.usage, lastSuccessfulUsage);
    assert.equal(containsProperty(refreshPayload, "sessionCookie"), false);
    assert.equal(JSON.stringify(refreshPayload).includes(sessionCookie), false);
  }
});

test("Cookie 会话上游的 301 响应不会被跟随", async (t) => {
  const sessionCookie = "sid=redirect-cookie-session-2Fk6";
  const baseUrl = "https://redirecting-session.example";
  const balancePath = "/private/balance";
  const redirectTarget = "https://collector.attacker.example/capture";
  const observed = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const upstreamRequest = new Request(input, init);
    observed.push({
      url: upstreamRequest.url,
      cookie: upstreamRequest.headers.get("cookie"),
      redirect: upstreamRequest.redirect,
    });
    return new Response(null, {
      status: 301,
      headers: { location: redirectTarget },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "cookie_session",
      name: "Cookie 重定向防护测试",
      baseUrl,
      balancePath,
      sessionCookie,
    }),
  });

  assert.equal(response.status, 201);
  const payload = await readJson(response);
  const created = payload.accounts.find(
    (account) => account.name === "Cookie 重定向防护测试",
  );
  assert.ok(created);
  assert.equal(created.usage, null);
  assert.equal(created.sync.status, "error");
  assert.match(created.sync.error, /上游接口发生重定向/);

  assert.equal(observed.length, 1);
  assert.equal(observed[0].url, `${baseUrl}${balancePath}`);
  assert.equal(observed[0].cookie, sessionCookie);
  assert.equal(observed[0].redirect, "manual");
  assert.notEqual(new URL(observed[0].url).origin, new URL(redirectTarget).origin);
  assert.equal(
    observed.some(
      (request) =>
        new URL(request.url).origin === new URL(redirectTarget).origin &&
        request.cookie,
    ),
    false,
  );
  assert.equal(containsProperty(payload, "sessionCookie"), false);
  assert.equal(JSON.stringify(payload).includes(sessionCookie), false);
});

test("阿里云余额使用 V3 签名并映射可用额度，AK/SK 不进入公共响应", async (t) => {
  const accessKeyId = "LTAI5tBalanceMonitorTest";
  const accessKeySecret = "aliyun-balance-secret-never-expose";
  const originalFetch = globalThis.fetch;
  const observed = {};

  globalThis.fetch = async (input, init) => {
    observed.calls = (observed.calls ?? 0) + 1;
    const upstreamRequest = new Request(input, init);
    observed.url = upstreamRequest.url;
    observed.method = upstreamRequest.method;
    observed.headers = upstreamRequest.headers;
    observed.body = await upstreamRequest.text();
    return Response.json({
      Code: "200",
      Message: "success",
      RequestId: "aliyun-request-id-for-test",
      Success: true,
      Data: {
        AvailableAmount: "6274.705467",
        AvailableCashAmount: "6000.00",
        CreditAmount: "274.705467",
        MybankCreditAmount: "0.00",
        Currency: "CNY",
        QuotaLimit: "999999.00",
      },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "aliyun_bss",
      name: "阿里云生产账号",
      baseUrl: "https://business.aliyuncs.com",
      accessKeyId,
      accessKeySecret,
      lowBalanceThreshold: 500,
    }),
  });

  assert.equal(response.status, 201);
  const payload = await readJson(response);
  const created = payload.accounts.find(
    (account) => account.name === "阿里云生产账号",
  );
  assert.ok(created);

  assert.equal(observed.url, "https://business.aliyuncs.com/");
  assert.equal(observed.calls, 1);
  assert.equal(observed.method, "POST");
  assert.equal(observed.body, "");
  assert.match(observed.headers.get("accept") ?? "", /application\/json/i);
  assert.equal(
    observed.headers.get("x-acs-action"),
    "QueryAccountBalance",
  );
  assert.equal(observed.headers.get("x-acs-version"), "2017-12-14");
  assert.match(
    observed.headers.get("x-acs-date") ?? "",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
  );
  assert.ok(observed.headers.get("x-acs-signature-nonce"));

  const payloadHash = createHash("sha256").update("").digest("hex");
  assert.equal(
    observed.headers.get("x-acs-content-sha256"),
    payloadHash,
  );

  const authorization = observed.headers.get("authorization") ?? "";
  const authorizationMatch = authorization.match(
    /^ACS3-HMAC-SHA256 Credential=([^,]+),SignedHeaders=([^,]+),Signature=([a-f0-9]{64})$/,
  );
  assert.ok(authorizationMatch);
  assert.equal(authorizationMatch[1], accessKeyId);
  const signedHeaders = authorizationMatch[2].split(";");
  const requestHost = new URL(observed.url).host;
  const canonicalHeaders =
    signedHeaders
      .map((name) => {
        const value =
          name === "host" ? requestHost : observed.headers.get(name);
        assert.ok(value, `缺少签名请求头 ${name}`);
        return `${name}:${value.trim()}`;
      })
      .join("\n") + "\n";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders.join(";"),
    payloadHash,
  ].join("\n");
  const stringToSign = `ACS3-HMAC-SHA256\n${createHash("sha256")
    .update(canonicalRequest)
    .digest("hex")}`;
  const expectedSignature = createHmac("sha256", accessKeySecret)
    .update(stringToSign)
    .digest("hex");
  assert.equal(authorizationMatch[3], expectedSignature);

  assert.equal(created.provider, "aliyun_bss");
  assert.equal(created.baseUrl, "https://business.aliyuncs.com");
  assert.equal(created.balancePath, "/");
  assert.equal(created.usage.balance_amount, 6274.705467);
  assert.equal(created.usage.currency, "CNY");
  assert.equal(created.usage.quota, null);
  assert.equal(created.usage.used_quota, null);
  assert.equal(created.usage.request_count, null);
  assert.equal(created.usage.used_amount, null);
  assert.deepEqual(created.usage.subscriptions, []);

  const editResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "aliyun_bss",
        name: "阿里云生产账号（运营）",
        lowBalanceThreshold: 800,
      }),
    },
  );
  assert.equal(editResponse.status, 200);
  assert.equal(observed.calls, 2);
  const editedPayload = await readJson(editResponse);
  const edited = editedPayload.accounts.find(
    (account) => account.id === created.id,
  );
  assert.equal(edited.name, "阿里云生产账号（运营）");
  assert.equal(edited.lowBalanceThreshold, 800);
  assert.equal(edited.usage.balance_amount, 6274.705467);

  const endpointChangeResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: "https://business.ap-southeast-1.aliyuncs.com",
      }),
    },
  );
  assert.equal(endpointChangeResponse.status, 400);
  assert.match(
    (await readJson(endpointChangeResponse)).error,
    /重新输入 AK 和 SK/,
  );
  assert.equal(observed.calls, 2);

  const partialCredentialResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessKeyId: "LTAI5tReplacement" }),
    },
  );
  assert.equal(partialCredentialResponse.status, 400);
  assert.match((await readJson(partialCredentialResponse)).error, /同时填写 AK 和 SK/);
  assert.equal(observed.calls, 2);

  const providerChangeResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "generic_bearer" }),
    },
  );
  assert.equal(providerChangeResponse.status, 400);
  assert.match((await readJson(providerChangeResponse)).error, /类型不能修改/);
  assert.equal(observed.calls, 2);

  assert.notEqual(created.maskedKey, accessKeyId);
  assert.match(created.maskedKey, /[*•…]/);
  assert.equal(containsProperty(payload, "credentials"), false);
  assert.equal(containsProperty(payload, "accessKeyId"), false);
  assert.equal(containsProperty(payload, "accessKeySecret"), false);
  assert.equal(JSON.stringify(payload).includes(accessKeyId), false);
  assert.equal(JSON.stringify(payload).includes(accessKeySecret), false);
});

test("阿里云权限错误会保留账号并返回安全提示", async (t) => {
  const accessKeyId = "LTAI5tNoPermissionTest";
  const accessKeySecret = "aliyun-no-permission-secret";
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    Response.json(
      {
        Code: "NoPermission",
        Message: "sensitive upstream diagnostic should stay hidden",
        RequestId: "permission-request-id",
      },
      { status: 400 },
    );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "aliyun_bss",
      name: "阿里云无权限账号",
      baseUrl: "https://business.aliyuncs.com",
      accessKeyId,
      accessKeySecret,
    }),
  });

  assert.equal(response.status, 201);
  const payload = await readJson(response);
  const created = payload.accounts.find(
    (account) => account.name === "阿里云无权限账号",
  );
  assert.ok(created);
  assert.equal(created.usage, null);
  assert.equal(created.sync.status, "error");
  assert.match(created.sync.error, /RAM 用户无权查询阿里云余额/);
  assert.equal(JSON.stringify(payload).includes(accessKeyId), false);
  assert.equal(JSON.stringify(payload).includes(accessKeySecret), false);
  assert.equal(JSON.stringify(payload).includes("sensitive upstream"), false);
});

test("阿里云 Endpoint 必须使用官方白名单", async () => {
  const response = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "aliyun_bss",
      name: "伪造阿里云 Endpoint",
      baseUrl: "https://attacker.example",
      accessKeyId: "LTAI5tMustNotLeave",
      accessKeySecret: "endpoint-binding-secret",
    }),
  });

  assert.equal(response.status, 400);
  const payload = await readJson(response);
  assert.match(payload.error, /中国站或国际站/);
  assert.equal(JSON.stringify(payload).includes("LTAI5tMustNotLeave"), false);
  assert.equal(JSON.stringify(payload).includes("endpoint-binding-secret"), false);
});

test("兼容没有订阅的上游余额", async (t) => {
  const mock = await startMockUpstream((_incoming, outgoing) => {
    outgoing.writeHead(200, { "content-type": "application/json" });
    outgoing.end(
      JSON.stringify({
        success: true,
        data: {
          username: "wallet-only",
          quota: 200,
          used_quota: 75,
          request_count: 12,
          currency: "CNY",
          balance_amount: 125,
          used_amount: 75,
          subscriptions: [],
        },
      }),
    );
  });
  t.after(mock.close);

  const response = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "纯钱包上游",
      baseUrl: mock.baseUrl,
      apiKey: "sk-wallet-only-private",
    }),
  });

  assert.equal(response.status, 201);
  const payload = await readJson(response);
  const created = payload.accounts.find((account) => account.name === "纯钱包上游");
  assert.ok(created);
  assert.deepEqual(created.usage.subscriptions, []);
  assert.equal(created.usage.balance_amount, 125);
});

test("上游失败时保留账号并返回脱敏同步状态", async (t) => {
  const secret = "test-api-key";
  const mock = await startMockUpstream((_incoming, outgoing) => {
    outgoing.writeHead(503, { "content-type": "application/json" });
    outgoing.end(JSON.stringify({ error: `do not expose ${secret}` }));
  });
  t.after(mock.close);

  const response = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "故障上游",
      baseUrl: mock.baseUrl,
      apiKey: secret,
    }),
  });

  assert.equal(response.status, 201);
  const payload = await readJson(response);
  const created = payload.accounts.find((account) => account.name === "故障上游");
  assert.ok(created);
  assert.equal(created.usage, null);
  assert.equal(created.sync.status, "error");
  assert.equal(typeof created.sync.error, "string");
  assert.equal(JSON.stringify(payload).includes(secret), false);
  assert.equal(containsProperty(payload, "apiKey"), false);
});

test("非法 Base URL 在请求上游前返回 400", async () => {
  const secret = "test-api-key";
  const response = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "非法地址",
      baseUrl: "ftp://example.com?secret=1",
      apiKey: secret,
    }),
  });

  assert.equal(response.status, 400);
  const payload = await readJson(response);
  assert.equal(typeof payload.error, "string");
  assert.ok(payload.error.length > 0);
  assert.equal(JSON.stringify(payload).includes(secret), false);
});

test("修改上游地址时必须重新提交 API Key，旧密钥不会发往新地址", async (t) => {
  const secret = "test-api-key";
  const source = await startMockUpstream((_incoming, outgoing) => {
    outgoing.writeHead(200, { "content-type": "application/json" });
    outgoing.end(
      JSON.stringify({
        success: true,
        data: {
          username: "origin-bound",
          quota: 100,
          used_quota: 1,
          request_count: 1,
          currency: "USD",
          balance_amount: 99,
          used_amount: 1,
          subscriptions: [],
        },
      }),
    );
  });
  t.after(source.close);

  let targetRequests = 0;
  let leakedAuthorization = null;
  const target = await startMockUpstream((incoming, outgoing) => {
    targetRequests += 1;
    leakedAuthorization = incoming.headers.authorization;
    outgoing.writeHead(200, { "content-type": "application/json" });
    outgoing.end(JSON.stringify({ success: true, data: {} }));
  });
  t.after(target.close);

  const createResponse = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "密钥绑定测试",
      baseUrl: source.baseUrl,
      apiKey: secret,
    }),
  });
  assert.equal(createResponse.status, 201);
  const createdPayload = await readJson(createResponse);
  const created = createdPayload.accounts.find(
    (account) => account.name === "密钥绑定测试",
  );
  assert.ok(created);

  const patchResponse = await request(
    `/api/upstreams/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: target.baseUrl }),
    },
  );
  assert.equal(patchResponse.status, 400);
  const patchPayload = await readJson(patchResponse);
  assert.match(patchPayload.error, /重新输入 API Key/);
  assert.equal(targetRequests, 0);
  assert.equal(leakedAuthorization, null);
  assert.equal(JSON.stringify(patchPayload).includes(secret), false);

  const listPayload = await readJson(await request("/api/upstreams"));
  const unchanged = listPayload.accounts.find(
    (account) => account.id === created.id,
  );
  assert.equal(unchanged.baseUrl, source.baseUrl);
});

test("管理接口拒绝跨站写请求和无效 JSON", async () => {
  const crossOriginResponse = await request("/api/upstreams", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.example",
    },
    body: JSON.stringify({
      name: "跨站请求",
      baseUrl: "https://api.example.com",
      apiKey: "sk-cross-origin-secret",
    }),
  });
  assert.equal(crossOriginResponse.status, 400);

  const invalidJsonResponse = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null",
  });
  assert.equal(invalidJsonResponse.status, 400);

  const emptyIdResponse = await request("/api/upstreams/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "" }),
  });
  assert.equal(emptyIdResponse.status, 400);
});

test("非本机 HTTP 上游会在发送密钥前被拒绝", async () => {
  const response = await request("/api/upstreams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "明文 HTTP",
      baseUrl: "http://example.com",
      apiKey: "sk-http-secret",
    }),
  });
  assert.equal(response.status, 400);
  const payload = await readJson(response);
  assert.match(payload.error, /HTTPS/);
  assert.equal(JSON.stringify(payload).includes("sk-http-secret"), false);
});
