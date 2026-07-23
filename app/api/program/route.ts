import { AppError, withRoute } from "../../server/errors";
import { listFrom, toEpisode, toProgram } from "../../server/mappers";
import { readMemberSession } from "../../server/session";
import { callApi } from "../../server/upstream";

export async function GET(request: Request) {
  return withRoute(async () => {
    const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    if (!/^\d+$/.test(id)) {
      throw new AppError(422, "INVALID_PROGRAM", "节目编号格式不正确。");
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
        form: { cast_id: id },
      }),
    ]);

    return Response.json(
      {
        program: toProgram(detailResult.data),
        episodes: listFrom(itemsResult.data, "items", "data")
          .map((item) => toEpisode(item))
          .filter((item) => item.id),
      },
      {
        headers: {
          "Cache-Control": session ? "private, no-store" : "private, max-age=60",
        },
      },
    );
  });
}
