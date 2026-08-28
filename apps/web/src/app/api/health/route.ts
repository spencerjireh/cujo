/** The container healthcheck. Reports this process only; it never calls cujo. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, service: "web" });
}
