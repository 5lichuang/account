import {
  getDashboardPayload,
  NotFoundError,
  refreshAccounts,
} from "@/lib/upstreams";
import { ApiRequestError, readOptionalJsonObject } from "@/lib/api-request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    let id: string | undefined;
    const input = await readOptionalJsonObject(request);
    if (input) {
      if (
        input.id !== undefined &&
        (typeof input.id !== "string" || !input.id.trim())
      ) {
        return Response.json({ error: "上游 ID 格式不正确" }, { status: 400 });
      }
      id = typeof input.id === "string" ? input.id.trim() : undefined;
    }

    await refreshAccounts(id);
    return Response.json(getDashboardPayload(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status =
      error instanceof ApiRequestError
        ? 400
        : error instanceof NotFoundError
          ? 404
          : 500;
    const message =
      error instanceof ApiRequestError || error instanceof NotFoundError
        ? error.message
        : "刷新上游失败，请稍后重试";
    return Response.json({ error: message }, { status });
  }
}
