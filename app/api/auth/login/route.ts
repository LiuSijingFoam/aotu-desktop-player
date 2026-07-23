import { AppError, withRoute } from "../../../server/errors";
import { rawId, recordValue, toViewer } from "../../../server/mappers";
import {
  clearPreAuthCookie,
  memberSessionCookie,
  readPreAuth,
  tokenHash,
} from "../../../server/session";
import {
  callApi,
  jsonBody,
  requireString,
} from "../../../server/upstream";

function valueRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(request: Request) {
  return withRoute(async () => {
    const body = await jsonBody(request);
    const mobile = requireString(body.mobile, "手机号", 11);
    const code = requireString(body.code, "验证码", 8);
    if (!/^1\d{10}$/.test(mobile)) {
      throw new AppError(422, "INVALID_MOBILE", "请输入 11 位中国大陆手机号。");
    }
    if (!/^\d{4,8}$/.test(code)) {
      throw new AppError(422, "INVALID_CODE", "请输入短信中的验证码。");
    }

    const preAuth = await readPreAuth(request);
    if (preAuth && preAuth.mobileHash !== (await tokenHash(mobile))) {
      throw new AppError(
        409,
        "LOGIN_CONTEXT_MISMATCH",
        "手机号已变化，请重新发送验证码。",
      );
    }

    const loginResult = await callApi("user/mobilelogin", {
      upstreamCookie: preAuth?.upstreamCookie,
      form: {
        mobile,
        captcha: code,
        bind_mobile: 0,
        token: "",
      },
    });
    const userInfo = valueRecord(recordValue(loginResult.data, "userinfo"));
    const token = String(userInfo.token ?? "").trim();
    if (!token) {
      throw new AppError(
        502,
        "TOKEN_MISSING",
        "登录成功，但官方服务没有返回有效会话。",
      );
    }

    const profileResult = await callApi("user/getUserInfo", { token });
    const viewer = toViewer(profileResult.data);
    const userId = viewer.id || rawId(userInfo);
    if (!userId) {
      throw new AppError(
        502,
        "USER_ID_MISSING",
        "登录成功，但官方服务没有返回用户标识。",
      );
    }

    const response = Response.json(
      {
        authenticated: true,
        viewer,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.headers.append(
      "Set-Cookie",
      await memberSessionCookie(token, userId),
    );
    response.headers.append("Set-Cookie", clearPreAuthCookie());
    return response;
  });
}
