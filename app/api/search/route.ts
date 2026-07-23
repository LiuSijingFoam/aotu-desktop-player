import { AppError, withRoute } from "../../server/errors";
import { listFrom, toEpisode, toProgram } from "../../server/mappers";
import { requireMemberSession } from "../../server/session";
import { callApi } from "../../server/upstream";

export async function GET(request: Request) {
  return withRoute(async () => {
    const session = await requireMemberSession(request);
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 2 || query.length > 100) {
      throw new AppError(
        422,
        "INVALID_QUERY",
        "请输入至少两个字的搜索关键词。",
      );
    }

    const result = await callApi("v1/broadcast_api/search", {
      method: "GET",
      token: session.token,
      query: { keyword: query },
    });

    return Response.json(
      {
        programs: listFrom(result.data, "broadcast")
          .map(toProgram)
          .filter((item) => item.id),
        episodes: listFrom(result.data, "items")
          .map((item) => toEpisode(item))
          .filter((item) => item.id),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
