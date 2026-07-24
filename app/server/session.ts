import { sessionSecret } from "./config";
import { AppError } from "./errors";

const SESSION_COOKIE = "aotu_member_session";
const PREAUTH_COOKIE = "aotu_login_context";
const MAX_SESSION_AGE = 60 * 60 * 24 * 30;
const MAX_PREAUTH_AGE = 60 * 10;

export type MemberSession = {
  token: string;
  userId: string;
  expiresAt: number;
};

export type PreAuthSession = {
  upstreamCookie?: string;
  mobileHash: string;
  expiresAt: number;
};

type PlaybackTicket = {
  kind: "playback";
  url: string;
  episodeId: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
};

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey() {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(sessionSecret()),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function seal(value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    plaintext,
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return bytesToBase64Url(combined);
}

async function open<T>(value: string): Promise<T | null> {
  try {
    const combined = base64UrlToBytes(value);
    if (combined.byteLength < 29) return null;
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await encryptionKey(),
      ciphertext,
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    return null;
  }
}

function cookieValue(request: Request, name: string) {
  const source = request.headers.get("cookie") ?? "";
  for (const part of source.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function cookieHeader(
  name: string,
  value: string,
  maxAge: number,
  secure =
    process.env.AOTU_COOKIE_SECURE !== "0" &&
    process.env.NODE_ENV === "production",
) {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export async function readMemberSession(request: Request) {
  const encoded = cookieValue(request, SESSION_COOKIE);
  if (!encoded) return null;
  const session = await open<MemberSession>(encoded);
  if (
    !session?.token ||
    !session.userId ||
    !session.expiresAt ||
    session.expiresAt <= Date.now()
  ) {
    return null;
  }
  return session;
}

export async function requireMemberSession(request: Request) {
  const session = await readMemberSession(request);
  if (!session) {
    throw new AppError(401, "LOGIN_REQUIRED", "请先登录会员账号。");
  }
  return session;
}

export async function memberSessionCookie(token: string, userId: string) {
  const value = await seal({
    token,
    userId,
    expiresAt: Date.now() + MAX_SESSION_AGE * 1000,
  } satisfies MemberSession);
  return cookieHeader(SESSION_COOKIE, value, MAX_SESSION_AGE);
}

export function clearMemberSessionCookie() {
  return cookieHeader(SESSION_COOKIE, "", 0);
}

export async function preAuthCookie(session: PreAuthSession) {
  return cookieHeader(PREAUTH_COOKIE, await seal(session), MAX_PREAUTH_AGE);
}

export async function readPreAuth(request: Request) {
  const encoded = cookieValue(request, PREAUTH_COOKIE);
  if (!encoded) return null;
  const session = await open<PreAuthSession>(encoded);
  if (!session || session.expiresAt <= Date.now()) return null;
  return session;
}

export function clearPreAuthCookie() {
  return cookieHeader(PREAUTH_COOKIE, "", 0);
}

export async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function createPlaybackTicket(
  session: MemberSession,
  episodeId: string,
  url: string,
) {
  return seal({
    kind: "playback",
    url,
    episodeId,
    userId: session.userId,
    tokenHash: await tokenHash(session.token),
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  } satisfies PlaybackTicket);
}

export async function readPlaybackTicket(value: string) {
  const ticket = await open<PlaybackTicket>(value);
  if (
    ticket?.kind !== "playback" ||
    !ticket.url ||
    !ticket.episodeId ||
    !ticket.userId ||
    !ticket.tokenHash ||
    ticket.expiresAt <= Date.now()
  ) {
    throw new AppError(
      401,
      "PLAYBACK_TICKET_EXPIRED",
      "播放凭证已过期，请重新选择这期节目。",
    );
  }
  return ticket;
}
