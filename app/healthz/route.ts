export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

export function GET() {
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers,
  });
}

export function HEAD() {
  return new Response(null, { status: 200, headers });
}
