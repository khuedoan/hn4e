import type { Story } from "./types.ts";
import { Cache, ONE_HOUR } from "./cache.ts";

const ALGOLIA_API = "https://hn.algolia.com/api/v1";

export const feedCache = new Cache<Story[]>(ONE_HOUR, 20);

interface AlgoliaHit {
  objectID: string;
  title: string;
  url: string | null;
  author: string;
  points: number;
  num_comments: number;
  created_at: string;
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
  nbHits: number;
  nbPages: number;
}

// Fetch top popular stories from HN Algolia API.
// Uses the search endpoint sorted by popularity (points) over the given time range.
export async function fetchPopularStories(count: number = 300, timeRangeSeconds: number = 86400): Promise<Story[]> {
  const cacheKey = `feed:${count}:${timeRangeSeconds}`;
  const cached = feedCache.get(cacheKey);
  if (cached) return cached;

  const stories: Story[] = [];
  const perPage = 50;
  const pages = Math.ceil(count / perPage);

  for (let page = 0; page < pages; page++) {
    const hitsThisPage = Math.min(perPage, count - stories.length);
    const timeFilter = timeRangeSeconds > 0
      ? `&numericFilters=created_at_i>${Math.floor(Date.now() / 1000) - timeRangeSeconds}`
      : "";
    const url = `${ALGOLIA_API}/search?tags=story&hitsPerPage=${hitsThisPage}&page=${page}${timeFilter}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Algolia API error: ${response.status} ${response.statusText}`);
    }

    const data: AlgoliaResponse = await response.json();
    for (const hit of data.hits) {
      stories.push({
        id: hit.objectID,
        title: hit.title,
        url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
        author: hit.author,
        points: hit.points,
        commentCount: hit.num_comments,
        createdAt: hit.created_at,
      });
    }

    if (data.hits.length < hitsThisPage) break;
  }

  const result = stories.slice(0, count);
  feedCache.set(cacheKey, result);
  return result;
}
