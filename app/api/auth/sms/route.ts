import { AppError, withRoute } from "../../../server/errors";
import {
  preAuthCookie,
  tokenHash,
} from "../../../server/session";
import {
  callApi,
  jsonBody,
  requireString,
} from "../../../server/upstream";

function cookiePairs(setCookie?: string) {
  if (!setCookie) return undefined;
  return setCookie
    .split(/,(?=\s*[^;,=\s]+=[^;,]+)/)
    .map((cookie) => cookie.trim().split(";")[0])
    .filter(Boolean)
    .join("; ");
}

export async function POST(request: Request) {
  return withRoute(async () => {
    const body = await jsonBody(request);
    const mobile = requireString(body.mobile, "手机号", 11);
    if (!/^1\d{10}$/.test(mobile)) {
      throw new AppError(422, "INVALID_MOBILE", "请输入 11 位中国大陆手机号。");
    }

    const result = await callApi("sms/send", {
      form: {
        mobile,
        event: "mobilelogin",
      },
    });

    const loginContext = await preAuthCookie({
      upstreamCookie: cookiePairs(result.setCookie),
      mobileHash: await tokenHash(mobile),
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    return Response.json(
      { cooldown: 60 },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": loginContext,
        },
      },
    );
  });
}
