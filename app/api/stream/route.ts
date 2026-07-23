import { APP_VERSION, mediaSalt, serverConfig } from "../../server/config";
import { AppError, withRoute } from "../../server/errors";
import { buildSignedMediaHeaders } from "../../server/media-signature";
import {
  createPlaybackTicket,
  readMemberSession,
  readPlaybackTicket,
  tokenHash,
} from "../../server/session";

const ALLOWED_MEDIA_HOSTS = [
  "media.aotuyuzhou.com",
  "nadist.autuyuzhou.com",
];

function validatedMediaUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError(422, "INVALID_MEDIA_URL", "媒体地址格式不正确。");
  }
  if (
    parsed.protocol !== "https:" ||
    !ALLOWED_MEDIA_HOSTS.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
    )
  ) {
    throw new AppError(403, "MEDIA_HOST_BLOCKED", "不允许代理这个媒体地址。");
  }
  return parsed;
}

async function playbackContext(request: Request, ticketValue: string) {
  const ticket = await readPlaybackTicket(ticketValue);
  const target = validatedMediaUrl(ticket.url);

  if (ticket.userId === "-1") {
    if (ticket.tokenHash !== (await tokenHash("public"))) {
      throw new AppError(401, "INVALID_PLAYBACK_TICKET", "播放凭证无效。");
    }
    return {
      ticket,
      target,
      playbackSession: {
        token: "public",
        userId: "-1",
        expiresAt: ticket.expiresAt,
      },
    };
  }

  const session = await readMemberSession(request);
  if (
    !session ||
    session.userId !== ticket.userId ||
    (await tokenHash(session.token)) !== ticket.tokenHash
  ) {
    throw new AppError(
      401,
      "PLAYBACK_SESSION_MISMATCH",
      "播放会话已失效，请重新登录。",
    );
  }

  return { ticket, target, playbackSession: session };
}

function signedHeaders(
  target: URL,
  userId: string,
  request: Request,
) {
  return buildSignedMediaHeaders({
    playUrl: target.toString(),
    userId,
    salt: mediaSalt(),
    version: APP_VERSION,
    userAgent: serverConfig.appUserAgent,
    range: request.headers.get("range"),
  });
}

async function fetchMedia(target: URL, request: Request, userId: string) {
  const init: RequestInit = {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: signedHeaders(target, userId, request),
    redirect: "follow",
  };
  let response = await fetch(target, init);
  if (
    !response.ok &&
    target.hostname === "nadist.autuyuzhou.com"
  ) {
    const replacement = new URL(target);
    replacement.hostname = "media.aotuyuzhou.com";
    response = await fetch(replacement, {
      ...init,
      headers: signedHeaders(replacement, userId, request),
    });
  }
  return response;
}

async function rewritePlaylist(
  source: string,
  baseUrl: URL,
  playbackSession: {
    token: string;
    userId: string;
    expiresAt: number;
  },
  episodeId: string,
) {
  const lines = source.split(/\r?\n/);
  return (
    await Promise.all(
      lines.map(async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        if (!trimmed.startsWith("#")) {
          const segment = validatedMediaUrl(new URL(trimmed, baseUrl).toString());
          const ticket = await createPlaybackTicket(
            playbackSession,
            episodeId,
            segment.toString(),
          );
          return `/api/stream?ticket=${encodeURIComponent(ticket)}`;
        }

        if (trimmed.includes('URI="')) {
          const match = trimmed.match(/URI="([^"]+)"/);
          if (!match) return line;
          const asset = validatedMediaUrl(new URL(match[1], baseUrl).toString());
          const ticket = await createPlaybackTicket(
            playbackSession,
            episodeId,
            asset.toString(),
          );
          return line.replace(
            match[1],
            `/api/stream?ticket=${encodeURIComponent(ticket)}`,
          );
        }
        return line;
      }),
    )
  ).join("\n");
}

async function handleStream(request: Request) {
  return withRoute(async () => {
    const ticketValue = new URL(request.url).searchParams.get("ticket") ?? "";
    if (!ticketValue || ticketValue.length > 10000) {
      throw new AppError(422, "INVALID_PLAYBACK_TICKET", "播放凭证格式不正确。");
    }
    const { ticket, target, playbackSession } = await playbackContext(
      request,
      ticketValue,
    );
    const response = await fetchMedia(target, request, ticket.userId);
    if (!response.ok || (request.method !== "HEAD" && !response.body)) {
      throw new AppError(502, "MEDIA_UNAVAILABLE", "音频暂时无法载入。");
    }

    const contentType = response.headers.get("content-type") ?? "";
    const isPlaylist =
      contentType.toLowerCase().includes("mpegurl") ||
      target.pathname.toLowerCase().endsWith(".m3u8");

    if (isPlaylist && request.method !== "HEAD") {
      const rewritten = await rewritePlaylist(
        await response.text(),
        target,
        playbackSession,
        ticket.episodeId,
      );
      return new Response(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const headers = new Headers({
      "Content-Type": contentType || "application/octet-stream",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const name of [
      "accept-ranges",
      "content-length",
      "content-range",
      "etag",
      "last-modified",
    ]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }

    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      headers,
    });
  });
}

export async function GET(request: Request) {
  return handleStream(request);
}

export async function HEAD(request: Request) {
  return handleStream(request);
}
