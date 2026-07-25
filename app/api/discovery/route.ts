import { toEpisode, toProgram, listFrom, recordValue } from "../../server/mappers";
import { readMemberSession } from "../../server/session";
import { callApi, h5Home } from "../../server/upstream";
import { withRoute } from "../../server/errors";

const MAX_PROGRAM_PAGES = 500;
const VIP_STATUS_CACHE_TTL_MS = 10 * 60 * 1000;
const VIP_STATUS_PAGE_CONCURRENCY = 4;

type H5Home = {
  items?: unknown[];
};

type VipEvidence = {
  hasFree: boolean;
  hasVip: boolean;
};

let vipStatusCache:
  | {
      expiresAt: number;
      promise: Promise<Map<string, boolean>>;
    }
  | undefined;

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function collectVipEvidence(
  evidence: Map<string, VipEvidence>,
  items: unknown[],
) {
  for (const item of items) {
    const episode = toEpisode(item);
    if (!episode.programId || episode.isVip === undefined) continue;
    const current = evidence.get(episode.programId) ?? {
      hasFree: false,
      hasVip: false,
    };
    if (episode.isVip) current.hasVip = true;
    else current.hasFree = true;
    evidence.set(episode.programId, current);
  }
}

async function fetchVipStatuses() {
  const firstResult = await callApi("v1.broadcast_api/items", {
    form: { page: 1, play_type: "order" },
  });
  const firstContainer = record(firstResult.data);
  const evidence = new Map<string, VipEvidence>();
  collectVipEvidence(evidence, listFrom(firstResult.data, "data"));

  const lastPage = Math.min(
    positiveInteger(
      firstContainer.last_page ??
        firstContainer.page_count ??
        firstContainer.total_page,
    ) ??
      Math.ceil(
        (positiveInteger(firstContainer.total) ?? 0) /
          (positiveInteger(firstContainer.per_page) ?? 1),
      ),
    MAX_PROGRAM_PAGES,
  );

  for (
    let firstPage = 2;
    firstPage <= lastPage;
    firstPage += VIP_STATUS_PAGE_CONCURRENCY
  ) {
    const pageNumbers = Array.from(
      {
        length: Math.min(
          VIP_STATUS_PAGE_CONCURRENCY,
          lastPage - firstPage + 1,
        ),
      },
      (_, index) => firstPage + index,
    );
    const results = await Promise.all(
      pageNumbers.map((page) =>
        callApi("v1.broadcast_api/items", {
          form: { page, play_type: "order" },
        }),
      ),
    );
    for (const result of results) {
      collectVipEvidence(evidence, listFrom(result.data, "data"));
    }
  }

  return new Map(
    [...evidence].map(([programId, value]) => [
      programId,
      value.hasVip && !value.hasFree,
    ]),
  );
}

function loadVipStatuses() {
  const now = Date.now();
  if (vipStatusCache && vipStatusCache.expiresAt > now) {
    return vipStatusCache.promise;
  }

  const promise = fetchVipStatuses();
  vipStatusCache = {
    expiresAt: now + VIP_STATUS_CACHE_TTL_MS,
    promise,
  };
  void promise.catch(() => {
    if (vipStatusCache?.promise === promise) vipStatusCache = undefined;
  });
  return promise;
}

async function loadAllPrograms(token?: string) {
  const [vipStatuses, firstResult] = await Promise.all([
    loadVipStatuses().catch(() => new Map<string, boolean>()),
    callApi("v1.broadcast_api/list", {
      token,
      form: { page: 1 },
    }),
  ]);
  const programs = [];
  const seenIds = new Set<string>();
  let page = 1;
  let result = firstResult;

  while (page <= MAX_PROGRAM_PAGES) {
    const container = record(result.data);
    const pagePrograms = listFrom(result.data, "data")
      .map((value) => {
        const program = toProgram(value);
        const dynamicStatus = vipStatuses.get(program.id);
        return program.isVip === undefined && dynamicStatus !== undefined
          ? { ...program, isVip: dynamicStatus }
          : program;
      })
      .filter((item) => item.id);
    let added = 0;

    for (const program of pagePrograms) {
      if (seenIds.has(program.id)) continue;
      seenIds.add(program.id);
      programs.push(program);
      added += 1;
    }

    const currentPage =
      positiveInteger(container.current_page ?? container.page) ?? page;
    const lastPage = positiveInteger(
      container.last_page ??
        container.page_count ??
        container.total_page,
    );
    const total = positiveInteger(container.total ?? container.count);
    const perPage = positiveInteger(
      container.per_page ?? container.page_size ?? container.limit,
    );

    if (
      pagePrograms.length === 0 ||
      added === 0 ||
      (lastPage !== undefined && currentPage >= lastPage) ||
      (total !== undefined && programs.length >= total) ||
      (lastPage === undefined &&
        perPage !== undefined &&
        pagePrograms.length < perPage)
    ) {
      break;
    }

    page = Math.max(page + 1, currentPage + 1);
    result = await callApi("v1.broadcast_api/list", {
      token,
      form: { page },
    });
  }

  return programs;
}

export async function GET(request: Request) {
  return withRoute(async () => {
    const session = await readMemberSession(request);

    if (!session) {
      const [home, programs] = await Promise.all([
        h5Home<H5Home>(),
        loadAllPrograms(),
      ]);
      return Response.json(
        {
          source: "public",
          programs,
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

    const [itemsResult, programs] = await Promise.all([
      callApi("v1.broadcast_api/items", {
        token: session.token,
        form: { page: 1, play_type: "order" },
      }),
      loadAllPrograms(session.token),
    ]);

    return Response.json(
      {
        source: "member",
        programs,
        episodes: listFrom(itemsResult.data, "data")
          .map((item) => toEpisode(item))
          .filter((item) => item.id),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
