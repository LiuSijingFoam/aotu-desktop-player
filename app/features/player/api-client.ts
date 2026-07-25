import type {
  ApiErrorBody,
  DiscoveryPayload,
  Episode,
  Program,
  ProgramPayload,
  SessionPayload,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const body = (await response.json().catch(() => null)) as
    | (T & ApiErrorBody)
    | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.code ?? "REQUEST_FAILED",
      body?.message ?? "请求没有完成，请稍后再试。",
    );
  }

  return body as T;
}

export const playerApi = {
  session: () => request<SessionPayload>("/api/session"),
  discovery: () => request<DiscoveryPayload>("/api/discovery"),
  sendCode: (mobile: string) =>
    request<{ cooldown: number }>("/api/auth/sms", {
      method: "POST",
      body: JSON.stringify({ mobile }),
    }),
  login: (mobile: string, code: string) =>
    request<SessionPayload>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ mobile, code }),
    }),
  logout: () =>
    request<{ success: true }>("/api/auth/logout", {
      method: "POST",
      body: "{}",
    }),
  search: (query: string) =>
    request<{ programs: Program[]; episodes: Episode[] }>(
      `/api/search?q=${encodeURIComponent(query)}`,
    ),
  program: (id: string, page = 1) =>
    request<ProgramPayload>(
      `/api/program?id=${encodeURIComponent(id)}&page=${encodeURIComponent(page)}`,
    ),
  episode: (id: string) =>
    request<{ episode: Episode }>(`/api/episode?id=${encodeURIComponent(id)}`),
};
