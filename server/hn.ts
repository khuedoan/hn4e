import type { Comment, CommentFilterOptions, Story } from "./types.ts";
import { Cache, ONE_HOUR } from "./cache.ts";

const HN_API = "https://hacker-news.firebaseio.com/v0";
const COMMENT_BATCH_SIZE = 25;
const ITEM_BATCH_SIZE = 25;

export type FeedType = "top" | "best";

export interface StoryWithComments {
  story: Story;
  comments: Comment[];
}

interface HnItem {
  id: number;
  type?: string;
  by?: string;
  descendants?: number;
  kids?: number[];
  score?: number;
  text?: string;
  time?: number;
  title?: string;
  url?: string;
  deleted?: boolean;
  dead?: boolean;
}

export const feedCache = new Cache<Story[]>(ONE_HOUR, 20);
export const storyCache = new Cache<StoryWithComments>(ONE_HOUR, 300);

export async function fetchStories(
  feed: FeedType = "top",
  count: number = 300,
  timeRangeSeconds: number = 86400,
): Promise<Story[]> {
  const cacheKey = `feed:${feed}:${count}:${timeRangeSeconds}`;
  const cached = feedCache.get(cacheKey);
  if (cached) return cached;

  const response = await fetch(`${HN_API}/${feed}stories.json`);
  if (!response.ok) {
    throw new Error(`HN API error: ${response.status} ${response.statusText}`);
  }

  const ids: number[] = await response.json();
  const minTime = timeRangeSeconds > 0
    ? Math.floor(Date.now() / 1000) - timeRangeSeconds
    : 0;
  const stories: Story[] = [];

  for (let offset = 0; offset < ids.length && stories.length < count; offset += ITEM_BATCH_SIZE) {
    const items = await Promise.all(
      ids.slice(offset, offset + ITEM_BATCH_SIZE).map((id) => fetchItem(id)),
    );

    for (const item of items) {
      const story = itemToStory(item);
      if (!story || !item?.time) continue;

      if (minTime > 0 && item.time < minTime) {
        continue;
      }

      stories.push(story);
      if (stories.length >= count) break;
    }
  }

  feedCache.set(cacheKey, stories);
  return stories;
}

export async function fetchStoriesByIds(
  ids: string[],
  includeComments: boolean,
  commentFilter: CommentFilterOptions,
): Promise<StoryWithComments[]> {
  const entries = await Promise.all(
    ids.map(async (id): Promise<StoryWithComments | null> => {
      const numericId = parseHnId(id);
      if (numericId === null) return null;

      const cacheKey = storyCacheKey(numericId, includeComments, commentFilter);
      const cached = storyCache.get(cacheKey);
      if (cached) return cached;

      const item = await fetchItem(numericId);
      const story = itemToStory(item);
      if (!story) return null;

      const comments = includeComments
        ? await fetchComments(item?.kids ?? [], commentFilter)
        : [];
      const entry = { story, comments };

      storyCache.set(cacheKey, entry);
      return entry;
    }),
  );

  return entries.filter((entry): entry is StoryWithComments => entry !== null);
}

function storyCacheKey(
  id: number,
  includeComments: boolean,
  filter: CommentFilterOptions,
): string {
  if (!includeComments) {
    return `${id}:no-comments`;
  }
  return `${id}:comments:${filter.maxCommentDepth}:${filter.maxCommentsPerStory}:${filter.maxTopLevelComments}`;
}

function parseHnId(id: string): number | null {
  const numericId = Number(id);
  return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
}

function itemToStory(item: HnItem | null): Story | null {
  if (!item || item.deleted || item.dead || item.type !== "story" || !item.title || !item.time) {
    return null;
  }

  return {
    id: String(item.id),
    title: item.title,
    url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
    author: item.by ?? "",
    points: item.score ?? 0,
    commentCount: item.descendants ?? 0,
    createdAt: new Date(item.time * 1000).toISOString(),
  };
}

async function fetchItem(id: number): Promise<HnItem | null> {
  const response = await fetch(`${HN_API}/item/${id}.json`);
  if (!response.ok) {
    return null;
  }
  return response.json();
}

async function fetchComments(
  topLevelIds: number[],
  filter: CommentFilterOptions,
): Promise<Comment[]> {
  const limit = filter.maxCommentsPerStory >= 0
    ? filter.maxCommentsPerStory
    : Number.POSITIVE_INFINITY;
  const state = { remaining: limit };
  const ids = filter.maxTopLevelComments >= 0
    ? topLevelIds.slice(0, filter.maxTopLevelComments)
    : topLevelIds;

  return fetchCommentTree(ids, 0, filter.maxCommentDepth, state);
}

async function fetchCommentTree(
  ids: number[],
  depth: number,
  maxDepth: number,
  state: { remaining: number },
): Promise<Comment[]> {
  if (state.remaining <= 0 || (maxDepth >= 0 && depth > maxDepth)) {
    return [];
  }

  const comments: Comment[] = [];
  for (let offset = 0; offset < ids.length && state.remaining > 0; offset += COMMENT_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + COMMENT_BATCH_SIZE);
    const items = await Promise.all(batch.map((id) => fetchItem(id)));

    for (const item of items) {
      if (!item || item.type !== "comment" || item.dead) {
        continue;
      }

      if (!item.deleted && item.by && item.text && item.time && state.remaining > 0) {
        comments.push({
          id: item.id,
          author: item.by,
          text: item.text,
          createdAt: new Date(item.time * 1000).toISOString(),
          depth,
        });
        state.remaining--;
      }

      if (item.kids?.length && state.remaining > 0) {
        comments.push(...await fetchCommentTree(item.kids, depth + 1, maxDepth, state));
      }
    }
  }

  return comments;
}
