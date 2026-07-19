import { ApiRequestError, readJsonObject } from "@/lib/api-request";
import {
  AuthConflictError,
  AuthInputError,
  setupAdmin,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = await readJsonObject(request);
    const result = await setupAdmin({
      username: input.username,
      password: input.password,
      request,
    });
    return Response.json(
      { ok: true, user: { username: result.user.username } },
      {
        status: 201,
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": result.cookie,
        },
      },
    );
  } catch (error) {
    const expected =
      error instanceof AuthInputError ||
      error instanceof AuthConflictError ||
      error instanceof ApiRequestError;
    return Response.json(
      { error: expected ? error.message : "创建管理员失败，请稍后重试" },
      {
        status: error instanceof AuthConflictError ? 409 : expected ? 400 : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
