import { createHash } from "node:crypto";

export type MediaHeaderOptions = {
  playUrl: string;
  userId: string;
  salt: string;
  version: string;
  userAgent: string;
  range?: string | null;
  epochSeconds?: number;
};

export function buildSignedMediaHeaders(options: MediaHeaderOptions) {
  const epoch = options.epochSeconds ?? Math.floor(Date.now() / 1000);
  const tkey = `${epoch}${options.userId}`;
  const authkey = createHash("md5")
    .update(`${options.playUrl}${options.salt}${tkey}`, "utf8")
    .digest("hex");
  const headers = new Headers({
    Accept: "*/*",
    "auto-client": `autofm-${options.version}`,
    authkey,
    Referer: "https://autofm.aotuyuzhou.com/",
    tkey,
    tversion: options.version,
    "User-Agent": options.userAgent,
  });
  if (options.range) headers.set("Range", options.range);
  return headers;
}
