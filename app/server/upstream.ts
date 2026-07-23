import { APP_VERSION, serverConfig } from "./config";
import { AppError, UpstreamError } from "./errors";

type UpstreamEnvelope<T> = {
  code: number;
  msg?: string;
  data?: T;
};

type ApiOptions = {
  method?: "GET" | "POST";
  form?: Record<string, string | number | undefined>;
  query?: Record<string, string | number | undefined>;
  token?: string;
  upstreamCookie?: string;
};

export type UpstreamResult<T> = {
  data: T;
  setCookie?: string;
};

function apiUrl(
  path: string,
  query?: Record<string, string | number | undefined>,
) {
  const url = new URL(path.replace(/^\/+/, ""), serverConfig.apiBaseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

export async function callApi<T>(
  path: string,
  options: ApiOptions = {},
): Promise<UpstreamResult<T>> {
  const method = options.method ?? "POST";
  const headers = new Headers({
    Accept: "application/json",
    version: APP_VERSION,
    "User-Agent": serverConfig.appUserAgent,
  });

  if (options.token) headers.set("token", options.token);
  if (options.upstreamCookie) headers.set("Cookie", options.upstreamCookie);

  let body: URLSearchParams | undefined;
  if (method === "POST") {
    body = new URLSearchParams();
    for (const [key, value] of Object.entries(options.form ?? {})) {
      if (value !== undefined) body.set(key, String(value));
    }
    headers.set("Content-Type", "application/x-www-form-urlencoded");
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path, options.query), {
      method,
      headers,
      body,
      redirect: "follow",
    });
  } catch {
    throw new UpstreamError(
      502,
      "UPSTREAM_UNREACHABLE",
      "暂时无法连接凹凸宇宙服务。",
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | UpstreamEnvelope<T>
    | null;

  if (response.status === 401) {
    throw new UpstreamError(
      401,
      "SESSION_EXPIRED",
      "登录状态已过期，请重新登录。",
      response.status,
    );
  }

  if (!response.ok || !payload || payload.code !== 1) {
    const upstreamMessage = payload?.msg?.trim();
    throw new UpstreamError(
      response.status >= 500 ? 502 : 400,
      response.status === 403 ? "UPSTREAM_BLOCKED" : "UPSTREAM_REJECTED",
      upstreamMessage || "凹凸宇宙没有接受这次请求，请稍后重试。",
      response.status,
    );
  }

  return {
    data: payload.data as T,
    setCookie: response.headers.get("set-cookie") ?? undefined,
  };
}

export async function h5Home<T>(): Promise<T> {
  let response: Response;
  try {
    response = await fetch(serverConfig.h5HomeUrl, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        Origin: "https://m.aotuyuzhou.com",
        Referer: "https://m.aotuyuzhou.com/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "User-Agent": serverConfig.publicUserAgent,
      },
      redirect: "follow",
    });
  } catch {
    throw new UpstreamError(
      502,
      "PUBLIC_FEED_UNREACHABLE",
      "公开节目暂时无法载入。",
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | UpstreamEnvelope<T>
    | null;
  if (!response.ok || !payload || payload.code !== 1 || !payload.data) {
    throw new UpstreamError(
      502,
      "PUBLIC_FEED_UNAVAILABLE",
      "公开节目暂时无法载入。",
      response.status,
    );
  }
  return payload.data;
}

export function requireString(
  value: unknown,
  field: string,
  maxLength = 200,
) {
  if (typeof value !== "string") {
    throw new AppError(422, "INVALID_INPUT", `${field}格式不正确。`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AppError(422, "INVALID_INPUT", `${field}格式不正确。`);
  }
  return normalized;
}

export async function jsonBody(request: Request) {
  try {
    const value = (await request.json()) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new AppError(400, "INVALID_JSON", "请求内容格式不正确。");
  }
}
