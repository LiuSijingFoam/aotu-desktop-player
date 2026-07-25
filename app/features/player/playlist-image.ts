"use client";

import jsQR from "jsqr";
import QRCode from "qrcode";
import {
  createPlaylistSharePayload,
  parsePlaylistSharePayload,
  PLAYLIST_SHARE_PREFIX,
  SPECIAL_FAVORITES_PLAYLIST_ID,
  type CustomPlaylist,
} from "./playlists.ts";

const EXPORT_WIDTH = 1400;
const QR_SIZE = 360;
const POSTER_MARGIN = 56;
const HERO_HEIGHT = 420;
const LIST_HEADER_HEIGHT = 92;
const ROW_HEIGHT = 94;
const EMPTY_LIST_HEIGHT = 180;
const QR_PANEL_HEIGHT = 500;
const FOOTER_HEIGHT = 80;

const POSTER_COLORS = {
  paper: "#e9e4da",
  paperRaised: "#f7f4ed",
  paperMuted: "#ded8cc",
  ink: "#191918",
  inkSoft: "#2b2a28",
  muted: "#77736c",
  line: "#d3cdc1",
  accent: "#d94f63",
  accentDark: "#a92d42",
  white: "#fffdf8",
} as const;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("二维码中的播放列表数据格式不正确。");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(
    value.replace(/-/g, "+").replace(/_/g, "/") + padding,
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function compressText(value: string) {
  const bytes = new TextEncoder().encode(value);
  if (typeof CompressionStream === "undefined") {
    return `${PLAYLIST_SHARE_PREFIX}J:${bytesToBase64Url(bytes)}`;
  }
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return `${PLAYLIST_SHARE_PREFIX}D:${bytesToBase64Url(compressed)}`;
}

async function decompressText(value: string) {
  if (!value.startsWith(PLAYLIST_SHARE_PREFIX)) {
    throw new Error("没有识别到凹凸宇宙播放列表二维码。");
  }
  const encoded = value.slice(PLAYLIST_SHARE_PREFIX.length);
  const mode = encoded.slice(0, 2);
  const bytes = base64UrlToBytes(encoded.slice(2));
  if (mode === "J:") return new TextDecoder().decode(bytes);
  if (mode !== "D:" || typeof DecompressionStream === "undefined") {
    throw new Error("当前版本无法读取这张播放列表图片。");
  }
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new TextDecoder().decode(
    await new Response(stream).arrayBuffer(),
  );
}

export async function encodePlaylistQrData(playlist: CustomPlaylist) {
  return compressText(JSON.stringify(createPlaylistSharePayload(playlist)));
}

export async function decodePlaylistQrData(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await decompressText(value));
  } catch (error) {
    if (error instanceof Error && error.message.includes("播放列表")) {
      throw error;
    }
    throw new Error("二维码中的播放列表数据已经损坏。");
  }
  const playlist = parsePlaylistSharePayload(parsed);
  if (!playlist) throw new Error("二维码中的播放列表数据无效。");
  return playlist;
}

function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return "--:--";
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remaining = whole % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function fitText(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
) {
  if (context.measureText(value).width <= maxWidth) return value;
  let output = value;
  while (
    output.length > 1 &&
    context.measureText(`${output}…`).width > maxWidth
  ) {
    output = output.slice(0, -1);
  }
  return `${output}…`;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("播放列表图片生成失败。"));
    }, "image/png");
  });
}

function safeFileName(value: string) {
  const normalized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
  return normalized || "自定义播放列表";
}

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string | CanvasGradient,
) {
  roundedRect(context, x, y, width, height, radius);
  context.fillStyle = color;
  context.fill();
}

function strokeRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string,
  lineWidth = 1,
) {
  roundedRect(context, x, y, width, height, radius);
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.stroke();
}

function drawTrackedText(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  tracking: number,
) {
  let cursor = x;
  for (const character of value) {
    context.fillText(character, cursor, y);
    cursor += context.measureText(character).width + tracking;
  }
}

function wrapText(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  maxLines: number,
) {
  const characters = [...value.trim()];
  const lines: string[] = [];
  const forbiddenLineStarts = new Set([
    "）",
    "】",
    "》",
    "」",
    "』",
    "，",
    "。",
    "！",
    "？",
    "、",
    "：",
    "；",
  ]);
  const forbiddenLineEnds = new Set(["（", "【", "《", "「", "『"]);
  while (characters.length > 0 && lines.length < maxLines) {
    let line = "";
    while (
      characters.length > 0 &&
      context.measureText(line + characters[0]).width <= maxWidth
    ) {
      line += characters.shift();
    }
    if (!line && characters.length > 0) line = characters.shift() ?? "";
    while (
      characters.length > 0 &&
      forbiddenLineStarts.has(characters[0])
    ) {
      line += characters.shift();
    }
    const trailingCharacter = line.at(-1);
    if (
      trailingCharacter &&
      forbiddenLineEnds.has(trailingCharacter) &&
      line.length > 1
    ) {
      line = line.slice(0, -1);
      characters.unshift(trailingCharacter);
    }
    if (lines.length === maxLines - 1 && characters.length > 0) {
      line = fitText(context, line + characters.join(""), maxWidth);
      characters.length = 0;
    }
    lines.push(line);
  }
  return lines.length > 0 ? lines : [""];
}

function formatTotalDuration(playlist: CustomPlaylist) {
  const seconds = playlist.items.reduce(
    (total, episode) =>
      total +
      (episode.duration && Number.isFinite(episode.duration)
        ? Math.max(0, episode.duration)
        : 0),
    0,
  );
  if (seconds <= 0) return "时长待解锁";
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours === 0) return `${minutes} 分钟`;
  return remaining > 0 ? `${hours} 小时 ${remaining} 分` : `${hours} 小时`;
}

function playlistProgramCount(playlist: CustomPlaylist) {
  return new Set(
    playlist.items.map(
      (episode) =>
        episode.programId ??
        episode.programTitle ??
        `episode:${episode.id}`,
    ),
  ).size;
}

function drawBrandMark(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
) {
  fillRoundedRect(
    context,
    x,
    y,
    52,
    52,
    15,
    POSTER_COLORS.accent,
  );
  const barHeights = [16, 28, 38, 25, 14];
  barHeights.forEach((height, index) => {
    fillRoundedRect(
      context,
      x + 10 + index * 7,
      y + (52 - height) / 2,
      4,
      height,
      2,
      POSTER_COLORS.white,
    );
  });

  context.fillStyle = POSTER_COLORS.white;
  context.font =
    '700 22px "LXGW WenKai Screen", "Microsoft YaHei UI", sans-serif';
  context.fillText("凹凸宇宙", x + 72, y + 23);
  context.fillStyle = "rgba(255,253,248,0.55)";
  context.font =
    '600 11px "Microsoft YaHei UI", sans-serif';
  drawTrackedText(context, "DESKTOP PLAYER", x + 72, y + 44, 2.2);
}

function drawVinylArtwork(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
) {
  context.save();
  const glow = context.createRadialGradient(
    centerX - 45,
    centerY - 55,
    10,
    centerX,
    centerY,
    205,
  );
  glow.addColorStop(0, "rgba(217,79,99,0.44)");
  glow.addColorStop(0.46, "rgba(217,79,99,0.12)");
  glow.addColorStop(1, "rgba(217,79,99,0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(centerX, centerY, 215, 0, Math.PI * 2);
  context.fill();

  const vinyl = context.createRadialGradient(
    centerX - 48,
    centerY - 55,
    8,
    centerX,
    centerY,
    172,
  );
  vinyl.addColorStop(0, "#4b4945");
  vinyl.addColorStop(0.2, "#2c2b29");
  vinyl.addColorStop(1, "#10100f");
  context.fillStyle = vinyl;
  context.beginPath();
  context.arc(centerX, centerY, 172, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "rgba(255,255,255,0.09)";
  context.lineWidth = 2;
  [74, 96, 118, 140, 158].forEach((radius) => {
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.stroke();
  });

  context.fillStyle = POSTER_COLORS.accent;
  context.beginPath();
  context.arc(centerX, centerY, 48, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = POSTER_COLORS.ink;
  context.beginPath();
  context.arc(centerX, centerY, 10, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "rgba(255,253,248,0.4)";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(
    centerX,
    centerY,
    151,
    Math.PI * 1.12,
    Math.PI * 1.68,
  );
  context.stroke();

  const waveHeights = [16, 31, 48, 69, 42, 25, 57, 36, 19];
  waveHeights.forEach((height, index) => {
    fillRoundedRect(
      context,
      centerX - 112 + index * 25,
      centerY + 194 - height / 2,
      5,
      height,
      3,
      index === 3 ? POSTER_COLORS.accent : "rgba(255,253,248,0.34)",
    );
  });
  context.restore();
}

function drawMetaPill(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
) {
  context.font =
    '600 17px "LXGW WenKai Screen", "Microsoft YaHei UI", sans-serif';
  const width = context.measureText(value).width + 34;
  fillRoundedRect(
    context,
    x,
    y,
    width,
    42,
    21,
    "rgba(255,253,248,0.08)",
  );
  strokeRoundedRect(
    context,
    x,
    y,
    width,
    42,
    21,
    "rgba(255,253,248,0.13)",
  );
  context.fillStyle = "rgba(255,253,248,0.76)";
  context.fillText(value, x + 17, y + 27);
  return width;
}

function drawPosterBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  context.fillStyle = POSTER_COLORS.paper;
  context.fillRect(0, 0, width, height);

  const topGlow = context.createRadialGradient(
    width,
    0,
    0,
    width,
    0,
    760,
  );
  topGlow.addColorStop(0, "rgba(217,79,99,0.13)");
  topGlow.addColorStop(1, "rgba(217,79,99,0)");
  context.fillStyle = topGlow;
  context.fillRect(0, 0, width, Math.min(height, 900));

  context.strokeStyle = "rgba(25,25,24,0.045)";
  context.lineWidth = 1;
  for (let x = -height; x < width + height; x += 54) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + height, height);
    context.stroke();
  }
}

export async function exportPlaylistImage(playlist: CustomPlaylist) {
  const qrData = await encodePlaylistQrData(playlist);
  const qrCanvas = document.createElement("canvas");
  try {
    await QRCode.toCanvas(qrCanvas, qrData, {
      width: QR_SIZE,
      margin: 3,
      errorCorrectionLevel: "L",
      color: {
        dark: "#171716",
        light: "#ffffff",
      },
    });
  } catch {
    throw new Error(
      "这个播放列表包含的节目太多，二维码容量不足。请拆分为两个列表后再导出。",
    );
  }

  await Promise.all([
    document.fonts
      ?.load('68px "LXGW WenKai Screen"')
      .catch(() => {}),
    document.fonts
      ?.load('26px "LXGW WenKai Screen"')
      .catch(() => {}),
  ]);

  const listBodyHeight =
    playlist.items.length > 0
      ? playlist.items.length * ROW_HEIGHT
      : EMPTY_LIST_HEIGHT;
  const heroTop = POSTER_MARGIN;
  const listTop = heroTop + HERO_HEIGHT + 34;
  const listBodyTop = listTop + LIST_HEADER_HEIGHT;
  const qrPanelTop = listBodyTop + listBodyHeight + 42;
  const footerTop = qrPanelTop + QR_PANEL_HEIGHT;
  const canvas = document.createElement("canvas");
  canvas.width = EXPORT_WIDTH;
  canvas.height = footerTop + FOOTER_HEIGHT + POSTER_MARGIN;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前设备无法生成播放列表图片。");

  drawPosterBackground(context, canvas.width, canvas.height);

  const contentWidth = canvas.width - POSTER_MARGIN * 2;
  const heroGradient = context.createLinearGradient(
    POSTER_MARGIN,
    heroTop,
    canvas.width - POSTER_MARGIN,
    heroTop + HERO_HEIGHT,
  );
  heroGradient.addColorStop(0, POSTER_COLORS.inkSoft);
  heroGradient.addColorStop(0.58, POSTER_COLORS.ink);
  heroGradient.addColorStop(1, "#10100f");
  fillRoundedRect(
    context,
    POSTER_MARGIN,
    heroTop,
    contentWidth,
    HERO_HEIGHT,
    38,
    heroGradient,
  );
  strokeRoundedRect(
    context,
    POSTER_MARGIN,
    heroTop,
    contentWidth,
    HERO_HEIGHT,
    38,
    "rgba(255,253,248,0.12)",
    2,
  );

  context.save();
  roundedRect(
    context,
    POSTER_MARGIN,
    heroTop,
    contentWidth,
    HERO_HEIGHT,
    38,
  );
  context.clip();
  context.strokeStyle = "rgba(255,253,248,0.035)";
  context.lineWidth = 1;
  for (
    let x = POSTER_MARGIN + 24;
    x < canvas.width - POSTER_MARGIN;
    x += 52
  ) {
    context.beginPath();
    context.moveTo(x, heroTop);
    context.lineTo(x, heroTop + HERO_HEIGHT);
    context.stroke();
  }
  context.restore();

  drawBrandMark(context, 94, heroTop + 34);
  drawVinylArtwork(context, 1092, heroTop + 205);

  context.fillStyle = POSTER_COLORS.accent;
  context.font =
    '700 15px "Microsoft YaHei UI", sans-serif';
  drawTrackedText(
    context,
    playlist.id === SPECIAL_FAVORITES_PLAYLIST_ID
      ? "SPECIAL FAVORITES / 特别收藏"
      : "CURATED PLAYLIST / 自定义播放列表",
    94,
    heroTop + 154,
    1.6,
  );

  context.fillStyle = POSTER_COLORS.white;
  context.font =
    '700 68px "LXGW WenKai Screen", "Microsoft YaHei UI", sans-serif';
  const titleLines = wrapText(context, playlist.name, 710, 2);
  const titleBaseline =
    titleLines.length === 1 ? heroTop + 276 : heroTop + 244;
  titleLines.forEach((line, index) => {
    context.fillText(line, 94, titleBaseline + index * 74);
  });

  let pillX = 94;
  const pillY = heroTop + 350;
  pillX +=
    drawMetaPill(
      context,
      `${playlist.items.length} 期节目`,
      pillX,
      pillY,
    ) + 10;
  pillX +=
    drawMetaPill(
      context,
      formatTotalDuration(playlist),
      pillX,
      pillY,
    ) + 10;
  drawMetaPill(
    context,
    `${playlistProgramCount(playlist)} 个栏目`,
    pillX,
    pillY,
  );

  context.fillStyle = POSTER_COLORS.accentDark;
  context.font =
    '700 13px "Microsoft YaHei UI", sans-serif';
  drawTrackedText(context, "TRACK LIST", 76, listTop + 28, 2.4);
  context.fillStyle = POSTER_COLORS.ink;
  context.font =
    '700 38px "LXGW WenKai Screen", "Microsoft YaHei UI", sans-serif';
  context.fillText("节目清单", 76, listTop + 72);

  const trackCountLabel = `${String(playlist.items.length).padStart(
    2,
    "0",
  )} TRACKS`;
  context.font = '700 15px "Microsoft YaHei UI", sans-serif';
  const trackCountWidth = context.measureText(trackCountLabel).width + 34;
  fillRoundedRect(
    context,
    canvas.width - POSTER_MARGIN - trackCountWidth,
    listTop + 26,
    trackCountWidth,
    42,
    21,
    POSTER_COLORS.paperMuted,
  );
  context.fillStyle = POSTER_COLORS.inkSoft;
  context.fillText(
    trackCountLabel,
    canvas.width - POSTER_MARGIN - trackCountWidth + 17,
    listTop + 53,
  );

  fillRoundedRect(
    context,
    POSTER_MARGIN,
    listBodyTop,
    contentWidth,
    listBodyHeight,
    28,
    POSTER_COLORS.paperRaised,
  );
  strokeRoundedRect(
    context,
    POSTER_MARGIN,
    listBodyTop,
    contentWidth,
    listBodyHeight,
    28,
    POSTER_COLORS.line,
  );

  if (playlist.items.length === 0) {
    fillRoundedRect(
      context,
      84,
      listBodyTop + 50,
      80,
      80,
      24,
      "rgba(217,79,99,0.11)",
    );
    const emptyBars = [20, 40, 58, 34, 17];
    emptyBars.forEach((height, index) => {
      fillRoundedRect(
        context,
        103 + index * 11,
        listBodyTop + 90 - height / 2,
        5,
        height,
        3,
        index === 2 ? POSTER_COLORS.accent : POSTER_COLORS.accentDark,
      );
    });
    context.fillStyle = POSTER_COLORS.ink;
    context.font =
      '700 27px "LXGW WenKai Screen", "Microsoft YaHei UI", sans-serif';
    context.fillText("这张节目单还在等待第一期", 196, listBodyTop + 82);
    context.fillStyle = POSTER_COLORS.muted;
    context.font =
      '400 19px "LXGW WenKai Screen", "Microsoft YaHei UI", sans-serif';
    context.fillText(
      "回到应用，点击节目旁的“加入列表”开始编排。",
      196,
      listBodyTop + 116,
    );
  } else {
    context.save();
    roundedRect(
      context,
      POSTER_MARGIN,
      listBodyTop,
      contentWidth,
      listBodyHeight,
      28,
    );
    context.clip();
    playlist.items.forEach((episode, index) => {
      const rowY = listBodyTop + index * ROW_HEIGHT;
      if (index % 2 === 1) {
        context.fillStyle = "rgba(222,216,204,0.32)";
        context.fillRect(
          POSTER_MARGIN,
          rowY,
          contentWidth,
          ROW_HEIGHT,
        );
      }
      if (index < playlist.items.length - 1) {
        context.strokeStyle = POSTER_COLORS.line;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(82, rowY + ROW_HEIGHT);
        context.lineTo(canvas.width - 82, rowY + ROW_HEIGHT);
        context.stroke();
      }

      fillRoundedRect(
        context,
        82,
        rowY + 23,
        48,
        48,
        15,
        index === 0
          ? POSTER_COLORS.accent
          : "rgba(25,25,24,0.065)",
      );
      context.fillStyle =
        index === 0 ? POSTER_COLORS.white : POSTER_COLORS.muted;
      context.font = '700 17px "Microsoft YaHei UI", sans-serif';
      context.textAlign = "center";
      context.fillText(
        String(index + 1).padStart(2, "0"),
        106,
        rowY + 54,
      );
      context.textAlign = "left";

      context.fillStyle = POSTER_COLORS.ink;
      context.font =
        '700 25px "LXGW WenKai Screen", "Microsoft YaHei UI", sans-serif';
      context.fillText(
        fitText(context, episode.title, 900),
        158,
        rowY + 40,
      );
      context.fillStyle = POSTER_COLORS.muted;
      context.font =
        '400 17px "LXGW WenKai Screen", "Microsoft YaHei UI", sans-serif';
      const episodeMeta = `${episode.programTitle ?? "凹凸宇宙"}${
        episode.isVip ? "  ·  VIP" : ""
      }`;
      context.fillText(
        fitText(context, episodeMeta, 760),
        158,
        rowY + 69,
      );

      context.textAlign = "right";
      context.fillStyle = POSTER_COLORS.inkSoft;
      context.font = '600 18px "Microsoft YaHei UI", sans-serif';
      context.fillText(
        formatDuration(episode.duration),
        canvas.width - 90,
        rowY + 55,
      );
      context.textAlign = "left";
    });
    context.restore();
  }

  const qrPanelGradient = context.createLinearGradient(
    POSTER_MARGIN,
    qrPanelTop,
    canvas.width - POSTER_MARGIN,
    qrPanelTop + QR_PANEL_HEIGHT,
  );
  qrPanelGradient.addColorStop(0, POSTER_COLORS.inkSoft);
  qrPanelGradient.addColorStop(1, "#10100f");
  fillRoundedRect(
    context,
    POSTER_MARGIN,
    qrPanelTop,
    contentWidth,
    QR_PANEL_HEIGHT,
    38,
    qrPanelGradient,
  );

  context.save();
  roundedRect(
    context,
    POSTER_MARGIN,
    qrPanelTop,
    contentWidth,
    QR_PANEL_HEIGHT,
    38,
  );
  context.clip();
  const qrGlow = context.createRadialGradient(
    POSTER_MARGIN,
    qrPanelTop + QR_PANEL_HEIGHT,
    0,
    POSTER_MARGIN,
    qrPanelTop + QR_PANEL_HEIGHT,
    620,
  );
  qrGlow.addColorStop(0, "rgba(217,79,99,0.28)");
  qrGlow.addColorStop(1, "rgba(217,79,99,0)");
  context.fillStyle = qrGlow;
  context.fillRect(
    POSTER_MARGIN,
    qrPanelTop,
    contentWidth,
    QR_PANEL_HEIGHT,
  );
  context.restore();

  context.fillStyle = POSTER_COLORS.accent;
  context.font = '700 13px "Microsoft YaHei UI", sans-serif';
  drawTrackedText(
    context,
    "SCAN TO IMPORT / 扫码导入",
    100,
    qrPanelTop + 78,
    2,
  );
  context.fillStyle = POSTER_COLORS.white;
  context.font =
    '700 44px "LXGW WenKai Screen", "Microsoft YaHei UI", sans-serif';
  context.fillText("把这份节目单", 100, qrPanelTop + 148);
  context.fillText("带到另一台电脑", 100, qrPanelTop + 204);

  context.strokeStyle = "rgba(255,253,248,0.12)";
  context.beginPath();
  context.moveTo(100, qrPanelTop + 244);
  context.lineTo(810, qrPanelTop + 244);
  context.stroke();

  [1, 2].forEach((step, index) => {
    const stepY = qrPanelTop + 290 + index * 67;
    fillRoundedRect(
      context,
      100,
      stepY - 26,
      42,
      42,
      14,
      index === 0
        ? POSTER_COLORS.accent
        : "rgba(255,253,248,0.1)",
    );
    context.fillStyle = POSTER_COLORS.white;
    context.font = '700 16px "Microsoft YaHei UI", sans-serif';
    context.textAlign = "center";
    context.fillText(String(step), 121, stepY + 1);
    context.textAlign = "left";
    context.font =
      '500 19px "LXGW WenKai Screen", "Microsoft YaHei UI", sans-serif';
    context.fillStyle = "rgba(255,253,248,0.78)";
    context.fillText(
      index === 0
        ? "打开“播放列表”，点击右上角“导入图片”"
        : "选择这张图片，节目清单会自动恢复",
      160,
      stepY + 1,
    );
  });

  context.fillStyle = "rgba(255,253,248,0.43)";
  context.font =
    '400 16px "LXGW WenKai Screen", "Microsoft YaHei UI", sans-serif';
  context.fillText(
    "无需账号同步 · 二维码不包含账号、播放记录或音频",
    100,
    qrPanelTop + 445,
  );

  const qrCardX = 902;
  const qrCardY = qrPanelTop + 48;
  const qrCardSize = 404;
  fillRoundedRect(
    context,
    qrCardX,
    qrCardY,
    qrCardSize,
    qrCardSize,
    28,
    POSTER_COLORS.white,
  );
  context.drawImage(
    qrCanvas,
    qrCardX + 22,
    qrCardY + 22,
    QR_SIZE,
    QR_SIZE,
  );
  context.fillStyle = "rgba(255,253,248,0.5)";
  context.font = '600 12px "Microsoft YaHei UI", sans-serif';
  context.textAlign = "center";
  context.fillText(
    `PLAYLIST QR · ${String(playlist.items.length).padStart(2, "0")}`,
    qrCardX + qrCardSize / 2,
    qrPanelTop + 476,
  );
  context.textAlign = "left";

  context.strokeStyle = "rgba(25,25,24,0.14)";
  context.beginPath();
  context.moveTo(POSTER_MARGIN, footerTop + 30);
  context.lineTo(canvas.width - POSTER_MARGIN, footerTop + 30);
  context.stroke();
  context.fillStyle = POSTER_COLORS.ink;
  context.font =
    '700 17px "LXGW WenKai Screen", "Microsoft YaHei UI", sans-serif';
  context.fillText("凹凸宇宙桌面收听", POSTER_MARGIN, footerTop + 65);
  context.fillStyle = POSTER_COLORS.muted;
  context.font =
    '400 15px "LXGW WenKai Screen", "Microsoft YaHei UI", sans-serif';
  context.textAlign = "right";
  context.fillText(
    "一张图片，收好下一段声音旅程",
    canvas.width - POSTER_MARGIN,
    footerTop + 65,
  );
  context.textAlign = "left";

  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(playlist.name)}-播放列表.png`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function imageBitmapFromFile(file: File) {
  if ("createImageBitmap" in window) return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function scanCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(pixels.data, pixels.width, pixels.height, {
    inversionAttempts: "attemptBoth",
  })?.data;
}

export async function importPlaylistImage(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择 PNG、JPG 或其他图片文件。");
  }
  const source = await imageBitmapFromFile(file);
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const cropHeight = Math.min(
    sourceHeight,
    Math.max(680, Math.round(sourceWidth * 0.55)),
  );
  const scale = Math.min(1, 1800 / sourceWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前设备无法读取这张图片。");
  context.drawImage(
    source,
    0,
    sourceHeight - cropHeight,
    sourceWidth,
    cropHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  let data = scanCanvas(canvas);

  if (!data && sourceHeight <= sourceWidth * 3) {
    const fullScale = Math.min(1, 1800 / sourceWidth, 2600 / sourceHeight);
    canvas.width = Math.max(1, Math.round(sourceWidth * fullScale));
    canvas.height = Math.max(1, Math.round(sourceHeight * fullScale));
    const fullContext = canvas.getContext("2d");
    fullContext?.drawImage(source, 0, 0, canvas.width, canvas.height);
    data = scanCanvas(canvas);
  }

  if ("close" in source && typeof source.close === "function") source.close();
  if (!data) {
    throw new Error("没有在图片底部识别到播放列表二维码。");
  }
  return decodePlaylistQrData(data);
}
