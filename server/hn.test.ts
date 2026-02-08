import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";
import { fetchPopularStories } from "./hn.ts";

function makeAlgoliaHit(i: number) {
  return {
    objectID: String(i),
    title: `Story ${i}`,
    url: `https://example.com/${i}` as string | null,
    author: `user${i}`,
    points: 100 - i,
    num_comments: 10,
    created_at: new Date().toISOString(),
  };
}

function makeAlgoliaResponse(hits: ReturnType<typeof makeAlgoliaHit>[]) {
  return { hits, nbHits: hits.length, nbPages: 1 };
}

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

beforeEach(() => {
  mockFetch = mock();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchPopularStories", () => {
  test("returns stories mapped from Algolia hits", async () => {
    const hits = [makeAlgoliaHit(1), makeAlgoliaHit(2)];
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(makeAlgoliaResponse(hits)), { status: 200 }),
    );

    const stories = await fetchPopularStories(2);

    expect(stories).toHaveLength(2);
    expect(stories[0].id).toBe("1");
    expect(stories[0].title).toBe("Story 1");
    expect(stories[0].url).toBe("https://example.com/1");
    expect(stories[0].author).toBe("user1");
    expect(stories[0].points).toBe(99);
    expect(stories[0].commentCount).toBe(10);
  });

  test("falls back to HN URL when story has no URL", async () => {
    const hit = makeAlgoliaHit(42);
    hit.url = null;
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(makeAlgoliaResponse([hit])), { status: 200 }),
    );

    const stories = await fetchPopularStories(1);

    expect(stories[0].url).toBe("https://news.ycombinator.com/item?id=42");
  });

  test("paginates when requesting more than 50 stories", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => makeAlgoliaHit(i));
    const page2 = Array.from({ length: 10 }, (_, i) => makeAlgoliaHit(50 + i));

    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeAlgoliaResponse(page1)), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeAlgoliaResponse(page2)), { status: 200 }),
      );

    const stories = await fetchPopularStories(60);

    expect(stories).toHaveLength(60);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test("throws on API error", () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 500, statusText: "Internal Server Error" }));

    expect(fetchPopularStories(1)).rejects.toThrow("Algolia API error: 500");
  });

  test("stops early if API returns fewer hits than requested", async () => {
    const hits = [makeAlgoliaHit(1)];
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(makeAlgoliaResponse(hits)), { status: 200 }),
    );

    const stories = await fetchPopularStories(10);

    expect(stories).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
