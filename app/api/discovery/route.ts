import { toEpisode, toProgram, listFrom, recordValue } from "../../server/mappers";
import { readMemberSession } from "../../server/session";
import { callApi, h5Home } from "../../server/upstream";
import { withRoute } from "../../server/errors";

type H5Home = {
  items?: unknown[];
  broad?: unknown[];
};

export async function GET(request: Request) {
  return withRoute(async () => {
    const session = await readMemberSession(request);

    if (!session) {
      const home = await h5Home<H5Home>();
      return Response.json(
        {
          source: "public",
          programs: (home.broad ?? []).map(toProgram).filter((item) => item.id),
          episodes: (home.items ?? [])
            .filter((item) => Number(recordValue(item, "is_vip")) === 0)
            .map((item) => toEpisode(item))
            .filter((item) => item.id),
        },
        {
          headers: {
            "Cache-Control": "private, max-age=120",
          },
        },
      );
    }

    const [itemsResult, programsResult] = await Promise.all([
      callApi("v1.broadcast_api/items", {
        token: session.token,
        form: { page: 1, play_type: "order" },
      }),
      callApi("v1.broadcast_api/list", {
        token: session.token,
        form: { page: 1 },
      }),
    ]);

    return Response.json(
      {
        source: "member",
        programs: listFrom(programsResult.data, "data")
          .map(toProgram)
          .filter((item) => item.id),
        episodes: listFrom(itemsResult.data, "data")
          .map((item) => toEpisode(item))
          .filter((item) => item.id),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
