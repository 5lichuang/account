import {
  getDashboardPayload,
  InputError,
  NotFoundError,
  removeUpstream,
  updateUpstream,
  type UpstreamInput,
} from "@/lib/upstreams";
import {
  ApiRequestError,
  assertSameOrigin,
  readJsonObject,
} from "@/lib/api-request";
import {
  AuthenticationRequiredError,
  requireRequestUser,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireRequestUser(request);
    const { id } = await context.params;
    const input = (await readJsonObject(request)) as UpstreamInput;
    await updateUpstream(id, input);
    return Response.json(getDashboardPayload(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status =
      error instanceof AuthenticationRequiredError
        ? 401
        : error instanceof InputError || error instanceof ApiRequestError
        ? 400
        : error instanceof NotFoundError
          ? 404
          : 500;
    const message =
      error instanceof AuthenticationRequiredError ||
      error instanceof InputError ||
      error instanceof ApiRequestError ||
      error instanceof NotFoundError
        ? error.message
        : "更新上游失败，请稍后重试";
    return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    await requireRequestUser(_request);
    assertSameOrigin(_request);
    const { id } = await context.params;
    removeUpstream(id);
    return Response.json(getDashboardPayload(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status =
      error instanceof AuthenticationRequiredError
        ? 401
        : error instanceof ApiRequestError
        ? 400
        : error instanceof NotFoundError
          ? 404
          : 500;
    const message =
      error instanceof AuthenticationRequiredError ||
      error instanceof ApiRequestError ||
      error instanceof NotFoundError
        ? error.message
        : "删除上游失败，请稍后重试";
    return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
