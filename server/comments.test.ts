import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";
import { flattenComments, fetchComments, fetchCommentsForStories } from "./comments.ts";

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

beforeEach(() => {
  mockFetch = mock();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("flattenComments", () => {
  test("flattens a simple comment tree", () => {
    const tree = [
      {
        id: 1,
        author: "alice",
        text: "Top-level comment",
        created_at: "2024-01-01T00:00:00Z",
        type: "comment",
        children: [
          {
            id: 2,
            author: "bob",
            text: "Reply to alice",
            created_at: "2024-01-01T00:01:00Z",
            type: "comment",
            children: [],
          },
        ],
      },
    ];

    const result = flattenComments(tree);

    expect(result).toEqual([
      { id: 1, author: "alice", text: "Top-level comment", createdAt: "2024-01-01T00:00:00Z", depth: 0 },
      { id: 2, author: "bob", text: "Reply to alice", createdAt: "2024-01-01T00:01:00Z", depth: 1 },
    ]);
  });

  test("skips deleted comments (null author or text)", () => {
    const tree = [
      {
        id: 1,
        author: null,
        text: null,
        created_at: "2024-01-01T00:00:00Z",
        type: "comment",
        children: [
          {
            id: 2,
            author: "bob",
            text: "Reply to deleted",
            created_at: "2024-01-01T00:01:00Z",
            type: "comment",
            children: [],
          },
        ],
      },
    ];

    const result = flattenComments(tree);

    // Deleted parent is skipped but its child is still included (at depth 1)
    expect(result).toEqual([
      { id: 2, author: "bob", text: "Reply to deleted", createdAt: "2024-01-01T00:01:00Z", depth: 1 },
    ]);
  });

  test("skips non-comment types", () => {
    const tree = [
      {
        id: 1,
        author: "alice",
        text: "A poll option",
        created_at: "2024-01-01T00:00:00Z",
        type: "pollopt",
        children: [],
      },
    ];

    const result = flattenComments(tree);

    expect(result).toEqual([]);
  });

  test("handles deeply nested comments", () => {
    const tree = [
      {
        id: 1, author: "a", text: "depth 0", created_at: "2024-01-01T00:00:00Z", type: "comment",
        children: [{
          id: 2, author: "b", text: "depth 1", created_at: "2024-01-01T00:01:00Z", type: "comment",
          children: [{
            id: 3, author: "c", text: "depth 2", created_at: "2024-01-01T00:02:00Z", type: "comment",
            children: [],
          }],
        }],
      },
    ];

    const result = flattenComments(tree);

    expect(result).toHaveLength(3);
    expect(result[0].depth).toBe(0);
    expect(result[1].depth).toBe(1);
    expect(result[2].depth).toBe(2);
  });

  test("returns empty array for empty children", () => {
    expect(flattenComments([])).toEqual([]);
  });
});

describe("fetchComments", () => {
  test("fetches and flattens comments from Algolia items API", async () => {
    const apiResponse = {
      id: 100,
      author: "poster",
      text: null,
      created_at: "2024-01-01T00:00:00Z",
      type: "story",
      children: [
        {
          id: 101,
          author: "commenter",
          text: "Great article!",
          created_at: "2024-01-01T01:00:00Z",
          type: "comment",
          children: [],
        },
      ],
    };

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(apiResponse), { status: 200 }),
    );

    const comments = await fetchComments("100");

    expect(comments).toHaveLength(1);
    expect(comments[0].author).toBe("commenter");
    expect(comments[0].text).toBe("Great article!");
    expect(comments[0].depth).toBe(0);
  });

  test("returns empty array on API error", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 500 }));

    const comments = await fetchComments("100");

    expect(comments).toEqual([]);
  });
});

describe("fetchCommentsForStories", () => {
  test("fetches comments for multiple stories and reports progress", async () => {
    const makeResponse = (id: number) => ({
      id,
      author: "poster",
      text: null,
      created_at: "2024-01-01T00:00:00Z",
      type: "story",
      children: [
        {
          id: id * 10 + 1,
          author: `user${id}`,
          text: `Comment on ${id}`,
          created_at: "2024-01-01T01:00:00Z",
          type: "comment",
          children: [],
        },
      ],
    });

    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(makeResponse(1)), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeResponse(2)), { status: 200 }));

    const progressCalls: [number, number][] = [];
    const results = await fetchCommentsForStories(
      ["1", "2"],
      (current, total) => { progressCalls.push([current, total]); },
      1, // concurrency=1 for deterministic ordering
    );

    expect(results.size).toBe(2);
    expect(results.get("1")!).toHaveLength(1);
    expect(results.get("2")!).toHaveLength(1);
    expect(progressCalls).toEqual([[1, 2], [2, 2]]);
  });
});
