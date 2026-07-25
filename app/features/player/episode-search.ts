import type { Episode } from "./types";

export function filterEpisodesByQuery<T extends Episode>(
  items: readonly T[],
  query: string,
): T[] {
  const terms = query
    .trim()
    .toLocaleLowerCase("zh-CN")
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return [...items];

  return items.filter((episode) => {
    const searchable = [
      episode.title,
      episode.programTitle,
      episode.publishedAt,
    ]
      .filter(Boolean)
      .join("\n")
      .toLocaleLowerCase("zh-CN");
    return terms.every((term) => searchable.includes(term));
  });
}
