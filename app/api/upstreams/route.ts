import {
  createUpstream,
  getDashboardPayload,
  InputError,
  type UpstreamInput,
} from "@/lib/upstreams";
import { ApiRequestError, readJsonObject } from "@/lib/api-request";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getDashboardPayload(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  try {
    const input = (await readJsonObject(request)) as UpstreamInput;
    await createUpstream(input);
    return Response.json(getDashboardPayload(), {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status =
      error instanceof InputError || error instanceof ApiRequestError ? 400 : 500;
    const message =
      error instanceof InputError || error instanceof ApiRequestError
        ? error.message
        : "新增上游失败，请稍后重试";
    return Response.json({ error: message }, { status });
  }
}
