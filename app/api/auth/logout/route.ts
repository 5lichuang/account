import { ApiRequestError, assertSameOrigin } from "@/lib/api-request";
import { clearSessionCookie, logout } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await logout(request);
    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": clearSessionCookie(request),
        },
      },
    );
  } catch (error) {
    const expected = error instanceof ApiRequestError;
    return Response.json(
      { error: expected ? error.message : "退出登录失败，请稍后重试" },
      {
        status: expected ? 400 : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
