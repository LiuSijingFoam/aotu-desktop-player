import { AppError, withRoute } from "../../server/errors";
import {
  listFrom,
  recordValue,
  toEpisode,
  toProgram,
} from "../../server/mappers";
import { readMemberSession } from "../../server/session";
import { callApi } from "../../server/upstream";

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: Request) {
  return withRoute(async () => {
    const searchParams = new URL(request.url).searchParams;
    const id = searchParams.get("id")?.trim() ?? "";
    const page = Number(searchParams.get("page") ?? "1");
    if (!/^\d+$/.test(id)) {
      throw new AppError(422, "INVALID_PROGRAM", "节目编号格式不正确。");
    }
    if (!Number.isInteger(page) || page < 1 || page > 500) {
      throw new AppError(422, "INVALID_PAGE", "节目页码格式不正确。");
    }
    const session = await readMemberSession(request);
    const token = session?.token;

    const [detailResult, itemsResult] = await Promise.all([
      callApi("v1.broadcast_api/castDetail", {
        token,
        form: { id },
      }),
      callApi("v1.broadcast_api/itemsByCast", {
        token,
        form: page > 1 ? { cast_id: id, page } : { cast_id: id },
      }),
    ]);

    const program = toProgram(detailResult.data);
    const episodes = listFrom(itemsResult.data, "items", "data")
      .map((item) => toEpisode(item))
      .filter((item) => item.id);
    const itemContainer = record(recordValue(itemsResult.data, "items"));
    const currentPage =
      positiveNumber(itemContainer.current_page ?? itemContainer.page) ?? page;
    const lastPage = positiveNumber(
      itemContainer.last_page ??
        itemContainer.page_count ??
        itemContainer.total_page,
    );
    const perPage =
      positiveNumber(
        itemContainer.per_page ??
          itemContainer.page_size ??
          itemContainer.limit,
      ) ?? episodes.length;
    const total =
      positiveNumber(itemContainer.total ?? itemContainer.count) ??
      program.episodeCount ??
      episodes.length;
    const hasMore = lastPage
      ? currentPage < lastPage
      : perPage > 0 && currentPage * perPage < total;

    return Response.json(
      {
        program,
        episodes,
        pagination: {
          page: currentPage,
          total,
          hasMore,
        },
      },
      {
        headers: {
          "Cache-Control": session ? "private, no-store" : "private, max-age=60",
        },
      },
    );
  });
}
