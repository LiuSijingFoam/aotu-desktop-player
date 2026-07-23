import { AppError } from "../../server/errors";
import { toViewer } from "../../server/mappers";
import {
  clearMemberSessionCookie,
  readMemberSession,
} from "../../server/session";
import { callApi } from "../../server/upstream";
import { withRoute } from "../../server/errors";

export async function GET(request: Request) {
  return withRoute(async () => {
    const session = await readMemberSession(request);
    if (!session) {
      return Response.json(
        { authenticated: false },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    try {
      await callApi("token/check", { token: session.token });
      const profile = await callApi("user/getUserInfo", {
        token: session.token,
      });
      return Response.json(
        {
          authenticated: true,
          viewer: toViewer(profile.data),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (error instanceof AppError && error.status === 401) {
        return Response.json(
          { authenticated: false },
          {
            headers: {
              "Cache-Control": "no-store",
              "Set-Cookie": clearMemberSessionCookie(),
            },
          },
        );
      }
      throw error;
    }
  });
}
