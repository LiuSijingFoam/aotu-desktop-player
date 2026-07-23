import { AppError, withRoute } from "../../server/errors";
import { serverConfig } from "../../server/config";

const ALLOWED_IMAGE_HOSTS = [
  "media.aotuyuzhou.com",
  "api.aotuyuzhou.com",
  "m.aotuyuzhou.com",
  "autofm.aotuyuzhou.com",
];

function imageUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError(422, "INVALID_IMAGE_URL", "图片地址格式不正确。");
  }
  if (
    parsed.protocol !== "https:" ||
    !ALLOWED_IMAGE_HOSTS.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
    )
  ) {
    throw new AppError(403, "IMAGE_HOST_BLOCKED", "不允许读取这个图片地址。");
  }
  return parsed;
}

export async function GET(request: Request) {
  return withRoute(async () => {
    const value = new URL(request.url).searchParams.get("url") ?? "";
    const target = imageUrl(value);
    const response = await fetch(target, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: "https://m.aotuyuzhou.com/",
        "User-Agent": serverConfig.publicUserAgent,
      },
      redirect: "follow",
    });

    if (!response.ok || !response.body) {
      throw new AppError(502, "IMAGE_UNAVAILABLE", "图片暂时无法载入。");
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw new AppError(502, "INVALID_IMAGE_RESPONSE", "图片响应格式不正确。");
    }

    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
    });
    const length = response.headers.get("content-length");
    const etag = response.headers.get("etag");
    if (length) headers.set("Content-Length", length);
    if (etag) headers.set("ETag", etag);

    return new Response(response.body, {
      status: 200,
      headers,
    });
  });
}
