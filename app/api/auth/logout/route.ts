import {
  clearMemberSessionCookie,
  clearPreAuthCookie,
} from "../../../server/session";

export async function POST() {
  const response = Response.json(
    { success: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.headers.append("Set-Cookie", clearMemberSessionCookie());
  response.headers.append("Set-Cookie", clearPreAuthCookie());
  return response;
}
