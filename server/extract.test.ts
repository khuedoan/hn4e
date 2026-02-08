import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";
import { extractArticle, extractArticles } from "./extract.ts";
import type { Story } from "./types.ts";

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: "1",
    title: "Test Story",
    url: "https://example.com/article",
    author: "testuser",
    points: 100,
    commentCount: 50,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
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

describe("extractArticle", () => {
  test("extracts content from HTML page", async () => {
    const html = `
      <html><head><title>Test</title></head>
      <body><article><h1>Hello World</h1><p>This is a test article with enough content to be parsed by readability.</p></article></body>
      </html>`;
    mockFetch.mockResolvedValueOnce(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const result = await extractArticle(makeStory());

    expect(result.extracted).toBe(true);
    expect(result.content).toContain("Hello World");
    expect(result.story.id).toBe("1");
  });

  test("returns extracted=false for HN self-posts", async () => {
    const story = makeStory({ url: "https://news.ycombinator.com/item?id=123" });

    const result = await extractArticle(story);

    expect(result.extracted).toBe(false);
    expect(result.content).toBeNull();
    // Should not attempt to fetch
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("returns extracted=false on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 404 }));

    const result = await extractArticle(makeStory());

    expect(result.extracted).toBe(false);
  });

  test("returns extracted=false for non-HTML content", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("binary", { headers: { "content-type": "application/pdf" } }),
    );

    const result = await extractArticle(makeStory());

    expect(result.extracted).toBe(false);
  });

  test("returns extracted=false when content-length exceeds limit", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("", {
        headers: {
          "content-type": "text/html",
          "content-length": String(10 * 1024 * 1024),
        },
      }),
    );

    const result = await extractArticle(makeStory());

    expect(result.extracted).toBe(false);
  });

  test("returns extracted=false on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    const result = await extractArticle(makeStory());

    expect(result.extracted).toBe(false);
  });
});

describe("extractArticles", () => {
  test("processes stories in batches and reports progress", async () => {
    const html = `<html><head><title>T</title></head><body><article><p>Content for readability parser.</p></article></body></html>`;
    // 3 stories, concurrency 2 = 2 batches
    mockFetch.mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const stories = [makeStory({ id: "1" }), makeStory({ id: "2" }), makeStory({ id: "3" })];
    const progressCalls: [number, number][] = [];

    await extractArticles(
      stories,
      (current, total) => { progressCalls.push([current, total]); },
      2,
    );

    // Batch 1: items 0-1 (batchEnd=2), Batch 2: item 2 (batchEnd=3)
    expect(progressCalls).toEqual([[2, 3], [3, 3]]);
  });

  test("returns results in order matching input stories", async () => {
    const stories = [
      makeStory({ id: "1", url: "https://news.ycombinator.com/item?id=1" }),
      makeStory({ id: "2", url: "https://example.com/2" }),
    ];
    const html = `<html><head><title>T</title></head><body><article><p>Content.</p></article></body></html>`;
    mockFetch.mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const results = await extractArticles(stories, undefined, 10);

    expect(results[0].story.id).toBe("1");
    expect(results[0].extracted).toBe(false); // HN self-post
    expect(results[1].story.id).toBe("2");
  });
});
