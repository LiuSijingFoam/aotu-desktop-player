import { AppError, withRoute } from "../../server/errors";
import {
  rawIsVip,
  rawPlayUrl,
  recordValue,
  toEpisode,
  toViewer,
} from "../../server/mappers";
import {
  createPlaybackTicket,
  readMemberSession,
} from "../../server/session";
import { callApi, h5Home } from "../../server/upstream";

type H5Home = {
  items?: unknown[];
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function GET(request: Request) {
  return withRoute(async () => {
    const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    if (!/^\d+$/.test(id)) {
      throw new AppError(422, "INVALID_EPISODE", "单集编号格式不正确。");
    }
    const session = await readMemberSession(request);

    if (!session) {
      const home = await h5Home<H5Home>();
      const item = (home.items ?? []).find(
        (entry) => String(asRecord(entry).id ?? "") === id,
      );
      if (!item || rawIsVip(item)) {
        throw new AppError(
          401,
          "LOGIN_REQUIRED",
          "请先登录会员账号，再播放这期节目。",
        );
      }
      const playUrl = rawPlayUrl(item);
      if (!playUrl) {
        throw new AppError(
          409,
          "AUDIO_UNAVAILABLE",
          "该节目的音频地址暂不可用。",
        );
      }
      const publicSession = {
        token: "public",
        userId: "-1",
        expiresAt: Date.now() + 12 * 60 * 60 * 1000,
      };
      const ticket = await createPlaybackTicket(publicSession, id, playUrl);
      return Response.json(
        {
          episode: toEpisode(item, {
            audioUrl: `/api/stream?ticket=${encodeURIComponent(ticket)}`,
          }),
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const [detailResult, profileResult] = await Promise.all([
      callApi("v1.broadcast_api/itemDetail", {
        token: session.token,
        form: { id },
      }),
      callApi("user/getUserInfo", { token: session.token }),
    ]);
    const viewer = toViewer(profileResult.data);

    if (rawIsVip(detailResult.data) && !viewer.isVip) {
      throw new AppError(
        403,
        "VIP_REQUIRED",
        "这期节目需要有效会员资格。",
      );
    }

    const album = asRecord(recordValue(detailResult.data, "album_info"));
    const albumId = String(album.id ?? "").trim();
    if (albumId) {
      const albumResult = await callApi("v1.album/detail", {
        token: session.token,
        form: { id: albumId },
      });
      if (Number(recordValue(albumResult.data, "is_buy")) !== 1) {
        throw new AppError(
          403,
          "ALBUM_PURCHASE_REQUIRED",
          "这期节目属于单独购买的专辑，请先在官方 App 中购买。",
        );
      }
    }

    const playUrl = rawPlayUrl(detailResult.data);
    if (!playUrl) {
      throw new AppError(
        409,
        "AUDIO_UNAVAILABLE",
        "官方服务没有为当前账号返回可播放地址。",
      );
    }
    const ticket = await createPlaybackTicket(session, id, playUrl);

    return Response.json(
      {
        episode: toEpisode(detailResult.data, {
          audioUrl: `/api/stream?ticket=${encodeURIComponent(ticket)}`,
        }),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
