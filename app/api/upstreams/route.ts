import {
  createUpstream,
  getDashboardPayload,
  InputError,
  type UpstreamInput,
} from "@/lib/upstreams";
import { ApiRequestError, readJsonObject } from "@/lib/api-request";
import {
  AuthenticationRequiredError,
  requireRequestUser,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireRequestUser(request);
    return Response.json(getDashboardPayload(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof AuthenticationRequiredError ? error.message : "读取上游失败，请稍后重试" },
      {
        status: error instanceof AuthenticationRequiredError ? 401 : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireRequestUser(request);
    const input = (await readJsonObject(request)) as UpstreamInput;
    await createUpstream(input);
    return Response.json(getDashboardPayload(), {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status =
      error instanceof AuthenticationRequiredError
        ? 401
        : error instanceof InputError || error instanceof ApiRequestError
          ? 400
          : 500;
    const message =
      error instanceof AuthenticationRequiredError ||
      error instanceof InputError ||
      error instanceof ApiRequestError
        ? error.message
        : "新增上游失败，请稍后重试";
    return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
