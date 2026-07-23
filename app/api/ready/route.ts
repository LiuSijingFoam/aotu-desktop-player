import { serverConfig } from "../../server/config";

export async function GET() {
  const configured = Boolean(
    serverConfig.apiBaseUrl &&
      serverConfig.h5HomeUrl &&
      serverConfig.appUserAgent,
  );
  return Response.json(
    { status: configured ? "ok" : "degraded" },
    {
      status: configured ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
