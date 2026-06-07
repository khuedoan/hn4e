import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";
import { fetchStories, fetchStoriesByIds, feedCache, storyCache } from "./hn.ts";

const now = Math.floor(Date.now() / 1000);

function makeStoryItem(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: "story",
    title: `Story ${id}`,
    url: `https://example.com/${id}`,
    by: `user${id}`,
    score: 100 - id,
    descendants: 10,
    time: now,
    ...overrides,
  };
}

function makeCommentItem(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: "comment",
    by: `commenter${id}`,
    text: `Comment ${id}`,
    time: now,
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

beforeEach(() => {
  mockFetch = mock();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  feedCache.clear();
  storyCache.clear();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchStories", () => {
  test("returns top stories from the official HN API", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify([1, 2]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeStoryItem(1)), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeStoryItem(2)), { status: 200 }));

    const stories = await fetchStories("top", 2);

    expect(stories).toHaveLength(2);
    expect(stories[0]).toMatchObject({
      id: "1",
      title: "Story 1",
      url: "https://example.com/1",
      author: "user1",
      points: 99,
      commentCount: 10,
    });
    expect(mockFetch.mock.calls[0][0]).toBe("https://hacker-news.firebaseio.com/v0/topstories.json");
  });

  test("can fetch best stories", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify([3]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeStoryItem(3)), { status: 200 }));

    const stories = await fetchStories("best", 1);

    expect(stories.map((story) => story.id)).toEqual(["3"]);
    expect(mockFetch.mock.calls[0][0]).toBe("https://hacker-news.firebaseio.com/v0/beststories.json");
  });

  test("filters old items by time range while preserving API order", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify([1, 2, 3]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeStoryItem(1, { time: now - 100_000 })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeStoryItem(2, { score: 1 })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeStoryItem(3, { score: 999 })), { status: 200 }));

    const stories = await fetchStories("top", 2, 86400);

    expect(stories.map((story) => story.id)).toEqual(["2", "3"]);
    expect(stories.map((story) => story.points)).toEqual([1, 999]);
  });

  test("falls back to HN discussion URL when story has no URL", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify([42]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeStoryItem(42, { url: undefined })), { status: 200 }));

    const stories = await fetchStories("top", 1);

    expect(stories[0].url).toBe("https://news.ycombinator.com/item?id=42");
  });

  test("caches feed results by feed, count, and time range", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify([1]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeStoryItem(1)), { status: 200 }));

    await fetchStories("top", 1, 86400);
    await fetchStories("top", 1, 86400);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("fetchStoriesByIds", () => {
  const unlimited = {
    maxCommentDepth: -1,
    maxCommentsPerStory: -1,
    maxTopLevelComments: -1,
  };

  test("loads selected stories without comments", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(makeStoryItem(7, { kids: [70] })), { status: 200 }),
    );

    const entries = await fetchStoriesByIds(["7"], false, unlimited);

    expect(entries).toHaveLength(1);
    expect(entries[0].story.id).toBe("7");
    expect(entries[0].comments).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("loads comments recursively with depth annotations", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(makeStoryItem(1, { kids: [10] })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeCommentItem(10, { kids: [11] })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeCommentItem(11)), { status: 200 }));

    const entries = await fetchStoriesByIds(["1"], true, unlimited);

    expect(entries[0].comments).toEqual([
      { id: 10, author: "commenter10", text: "Comment 10", createdAt: new Date(now * 1000).toISOString(), depth: 0 },
      { id: 11, author: "commenter11", text: "Comment 11", createdAt: new Date(now * 1000).toISOString(), depth: 1 },
    ]);
  });

  test("applies comment limits while fetching", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(makeStoryItem(1, { kids: [10, 20] })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeCommentItem(10, { kids: [11] })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeCommentItem(11)), { status: 200 }));

    const entries = await fetchStoriesByIds(["1"], true, {
      maxCommentDepth: 1,
      maxCommentsPerStory: 2,
      maxTopLevelComments: 1,
    });

    expect(entries[0].comments.map((comment) => comment.id)).toEqual([10, 11]);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  test("skips invalid and non-story IDs", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(makeStoryItem(2, { type: "job" })), { status: 200 }),
    );

    const entries = await fetchStoriesByIds(["nope", "2"], false, unlimited);

    expect(entries).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
