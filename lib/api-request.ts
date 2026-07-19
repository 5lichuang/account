export class ApiRequestError extends Error {}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new ApiRequestError("拒绝来自其他站点的管理请求");
  }
}

export async function readJsonObject(request: Request) {
  assertSameOrigin(request);
  const text = await request.text();
  if (!text || text.length > 16_384) {
    throw new ApiRequestError("请求内容为空或过大");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiRequestError("请求内容不是有效 JSON");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiRequestError("请求内容必须是对象");
  }
  return value as Record<string, unknown>;
}

export async function readOptionalJsonObject(request: Request) {
  assertSameOrigin(request);
  const text = await request.text();
  if (!text) return null;
  if (text.length > 16_384) {
    throw new ApiRequestError("请求内容过大");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiRequestError("请求内容不是有效 JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiRequestError("请求内容必须是对象");
  }
  return value as Record<string, unknown>;
}
