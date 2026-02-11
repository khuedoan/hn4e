import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";
import { flattenComments, fetchComments, fetchCommentsForStories, filterComments } from "./comments.ts";
import type { Comment } from "./types.ts";

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

describe("filterComments", () => {
  // A realistic flat comment list representing two top-level threads:
  // - comment A (depth 0) -> B (depth 1) -> C (depth 2)
  // - comment D (depth 0) -> E (depth 1)
  // - comment F (depth 0)
  const comments: Comment[] = [
    { id: 1, author: "a", text: "top A", createdAt: "2024-01-01T00:00:00Z", depth: 0 },
    { id: 2, author: "b", text: "reply B", createdAt: "2024-01-01T00:01:00Z", depth: 1 },
    { id: 3, author: "c", text: "reply C", createdAt: "2024-01-01T00:02:00Z", depth: 2 },
    { id: 4, author: "d", text: "top D", createdAt: "2024-01-01T00:03:00Z", depth: 0 },
    { id: 5, author: "e", text: "reply E", createdAt: "2024-01-01T00:04:00Z", depth: 1 },
    { id: 6, author: "f", text: "top F", createdAt: "2024-01-01T00:05:00Z", depth: 0 },
  ];

  const unlimited = { maxCommentDepth: -1, maxCommentsPerStory: -1, maxTopLevelComments: -1 };

  test("returns all comments when all options are unlimited", () => {
    const result = filterComments(comments, unlimited);
    expect(result).toEqual(comments);
  });

  test("limits top-level comments and keeps their sub-threads", () => {
    const result = filterComments(comments, { ...unlimited, maxTopLevelComments: 2 });

    // Should include threads A and D, but not F
    expect(result).toEqual([
      comments[0], // A (depth 0)
      comments[1], // B (depth 1)
      comments[2], // C (depth 2)
      comments[3], // D (depth 0)
      comments[4], // E (depth 1)
    ]);
  });

  test("limits top-level comments to 0 returns empty", () => {
    const result = filterComments(comments, { ...unlimited, maxTopLevelComments: 0 });
    expect(result).toEqual([]);
  });

  test("limits max comment depth", () => {
    const result = filterComments(comments, { ...unlimited, maxCommentDepth: 0 });

    expect(result).toEqual([
      comments[0], // A (depth 0)
      comments[3], // D (depth 0)
      comments[5], // F (depth 0)
    ]);
  });

  test("limits max comment depth to 1", () => {
    const result = filterComments(comments, { ...unlimited, maxCommentDepth: 1 });

    // Keeps depth 0 and 1, removes depth 2
    expect(result).toEqual([
      comments[0], // A (depth 0)
      comments[1], // B (depth 1)
      comments[3], // D (depth 0)
      comments[4], // E (depth 1)
      comments[5], // F (depth 0)
    ]);
  });

  test("limits max comments per story", () => {
    const result = filterComments(comments, { ...unlimited, maxCommentsPerStory: 3 });

    expect(result).toEqual([
      comments[0], // A
      comments[1], // B
      comments[2], // C
    ]);
  });

  test("combines all filters", () => {
    // Top-level limit 2 (threads A and D), depth limit 1, total cap 3
    const result = filterComments(comments, {
      maxTopLevelComments: 2,
      maxCommentDepth: 1,
      maxCommentsPerStory: 3,
    });

    // After top-level limit: A, B, C, D, E
    // After depth limit (<=1): A, B, D, E
    // After total cap (3): A, B, D
    expect(result).toEqual([
      comments[0], // A (depth 0)
      comments[1], // B (depth 1)
      comments[3], // D (depth 0)
    ]);
  });

  test("handles empty comment list", () => {
    const result = filterComments([], unlimited);
    expect(result).toEqual([]);
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
