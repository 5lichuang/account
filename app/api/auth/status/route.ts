import { authStatus } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return Response.json(await authStatus(request.headers.get("cookie")), {
    headers: { "Cache-Control": "no-store" },
  });
}
