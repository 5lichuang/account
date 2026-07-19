import { ApiRequestError, readJsonObject } from "@/lib/api-request";
import {
  AuthInputError,
  AuthRateLimitError,
  InvalidCredentialsError,
  login,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = await readJsonObject(request);
    const result = await login({
      username: input.username,
      password: input.password,
      request,
    });
    return Response.json(
      { ok: true, user: { username: result.user.username } },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": result.cookie,
        },
      },
    );
  } catch (error) {
    const expected =
      error instanceof AuthInputError ||
      error instanceof InvalidCredentialsError ||
      error instanceof AuthRateLimitError ||
      error instanceof ApiRequestError;
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (error instanceof AuthRateLimitError) {
      headers["Retry-After"] = String(error.retryAfterSeconds);
    }
    return Response.json(
      { error: expected ? error.message : "登录失败，请稍后重试" },
      {
        status: error instanceof AuthRateLimitError
          ? 429
          : error instanceof InvalidCredentialsError
            ? 401
            : expected
              ? 400
              : 500,
        headers,
      },
    );
  }
}
