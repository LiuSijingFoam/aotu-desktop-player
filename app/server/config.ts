import { AppError } from "./errors";

export const APP_VERSION = "1.7.43";

export const serverConfig = {
  apiBaseUrl:
    process.env.AOTU_API_BASE_URL ?? "https://api.aotuyuzhou.com/api/",
  h5HomeUrl:
    process.env.AOTU_H5_HOME_URL ??
    "https://m.aotuyuzhou.com/api/v1.h5/home",
  appUserAgent:
    process.env.AOTU_APP_USER_AGENT ??
    "AppVersion:1.7.43;Desktop#DeviceModel:WebPlayer#AndroidVersion:13#APILevel:33#",
  publicUserAgent:
    process.env.AOTU_PUBLIC_USER_AGENT ??
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
};

export function sessionSecret() {
  const value = process.env.AOTU_SESSION_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV !== "production") {
    return "development-only-aotu-session-secret-change-before-deploy";
  }
  throw new AppError(
    503,
    "SERVER_NOT_CONFIGURED",
    "安全会话尚未配置，暂时不能登录。",
  );
}

export function mediaSalt() {
  const value = process.env.AOTU_MEDIA_SALT;
  if (value) return value;
  if (process.env.NODE_ENV !== "production") {
    return "bI9zp0NEhOqJPvrysxLMckS62RTwnUfY";
  }
  throw new AppError(
    503,
    "SERVER_NOT_CONFIGURED",
    "媒体代理尚未配置，暂时不能播放。",
  );
}
