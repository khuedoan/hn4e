import { describe, test, expect } from "bun:test";
import JSZip from "jszip";
import { generateEpub, renderComments } from "./epub.ts";
import type { Comment, ExtractedArticle } from "./types.ts";

function makeArticle(overrides: Partial<ExtractedArticle> = {}): ExtractedArticle {
  return {
    story: {
      id: "1",
      title: "Test Story",
      url: "https://example.com/article",
      author: "testuser",
      points: 100,
      commentCount: 50,
      createdAt: new Date().toISOString(),
    },
    content: "<p>Article content.</p>",
    textContent: "Article content.",
    excerpt: "Article content.",
    extracted: true,
    comments: [],
    ...overrides,
  };
}

async function extractEpubContent(buffer: Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const files: Record<string, string> = {};
  for (const [name, file] of Object.entries(zip.files)) {
    if (!file.dir && name.endsWith(".xhtml")) {
      files[name] = await file.async("string");
    }
  }
  return files;
}

describe("generateEpub", () => {
  test("produces a valid EPUB buffer", async () => {
    const articles = [makeArticle()];
    const buffer = await generateEpub(articles);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.byteLength).toBeGreaterThan(0);
    // EPUB files are ZIP archives starting with PK magic bytes
    expect(buffer[0]).toBe(0x50); // P
    expect(buffer[1]).toBe(0x4b); // K
  });

  test("chapter title includes points", async () => {
    const articles = [makeArticle()];
    const buffer = await generateEpub(articles);
    const files = await extractEpubContent(buffer);

    const chapter = Object.values(files).find((c) => c.includes("Article content."));
    expect(chapter).toBeDefined();
    expect(chapter).toContain("Test Story (100 points)");
  });

  test("chapter metadata links comments to HN discussion", async () => {
    const articles = [makeArticle()];
    const buffer = await generateEpub(articles);
    const files = await extractEpubContent(buffer);

    const chapter = Object.values(files).find((c) => c.includes("Article content."));
    expect(chapter).toBeDefined();
    // "X comments" should link to HN
    expect(chapter).toContain('href="https://news.ycombinator.com/item?id=1"');
    expect(chapter).toContain("50 comments</a>");
    // Should not include author name in metadata
    expect(chapter).not.toContain("testuser");
  });

  test("includes fallback content for failed extractions", async () => {
    const articles = [
      makeArticle({
        content: null,
        textContent: null,
        excerpt: null,
        extracted: false,
      }),
    ];
    const buffer = await generateEpub(articles);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  test("handles multiple articles", async () => {
    const articles = [
      makeArticle({ story: { ...makeArticle().story, id: "1", title: "Story One" } }),
      makeArticle({ story: { ...makeArticle().story, id: "2", title: "Story Two" } }),
      makeArticle({
        story: { ...makeArticle().story, id: "3", title: "Story Three" },
        extracted: false,
        content: null,
      }),
    ];
    const buffer = await generateEpub(articles);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  test("creates separate comments chapter as subchapter", async () => {
    const comments: Comment[] = [
      { id: 101, author: "alice", text: "<p>Great article!</p>", createdAt: "2024-01-01T00:00:00Z", depth: 0 },
      { id: 102, author: "bob", text: "<p>I agree.</p>", createdAt: "2024-01-01T00:01:00Z", depth: 1 },
    ];
    const articles = [makeArticle({ comments })];
    const buffer = await generateEpub(articles);
    const files = await extractEpubContent(buffer);

    // Story and comments should be separate chapter files
    const storyChapter = Object.entries(files).find(([name]) => name.includes("story_"));
    const commentsChapter = Object.entries(files).find(([name]) => name.includes("comments_"));
    expect(storyChapter).toBeDefined();
    expect(commentsChapter).toBeDefined();

    // Story chapter should have article content but not comment text
    expect(storyChapter![1]).toContain("Article content.");
    expect(storyChapter![1]).not.toContain("Great article!");

    // Comments chapter should have the comment content
    expect(commentsChapter![1]).toContain("alice");
    expect(commentsChapter![1]).toContain("Great article!");
    expect(commentsChapter![1]).toContain("bob");
    expect(commentsChapter![1]).toContain("I agree.");
  });

  test("comments chapter appears nested in TOC", async () => {
    const comments: Comment[] = [
      { id: 101, author: "alice", text: "<p>Hello</p>", createdAt: "2024-01-01T00:00:00Z", depth: 0 },
    ];
    const articles = [makeArticle({ comments })];
    const buffer = await generateEpub(articles);

    const zip = await JSZip.loadAsync(buffer);
    const tocNcx = await zip.file("OEBPS/toc.ncx")!.async("string");
    const tocXhtml = await zip.file("OEBPS/toc.xhtml")!.async("string");

    // NCX should have nested navPoint for comments under the story navPoint
    expect(tocNcx).toContain("1 Comments");
    // The comments navPoint should be nested inside the story navPoint
    const storyNavPoint = tocNcx.indexOf("Test Story (100 points)");
    const commentsNavPoint = tocNcx.indexOf("1 Comments");
    expect(storyNavPoint).toBeGreaterThan(-1);
    expect(commentsNavPoint).toBeGreaterThan(storyNavPoint);

    // XHTML TOC should have nested list for comments
    expect(tocXhtml).toContain("1 Comments");
  });

  test("omits comments chapter when no comments", async () => {
    const articles = [makeArticle({ comments: [] })];
    const buffer = await generateEpub(articles);
    const files = await extractEpubContent(buffer);

    const commentsChapter = Object.entries(files).find(([name]) => name.includes("comments_"));
    expect(commentsChapter).toBeUndefined();
  });
});

describe("renderComments", () => {
  test("returns empty string for no comments", () => {
    expect(renderComments([])).toBe("");
  });

  test("renders comments with author and text", () => {
    const comments: Comment[] = [
      { id: 1, author: "alice", text: "<p>Hello</p>", createdAt: "2024-01-01T00:00:00Z", depth: 0 },
    ];
    const html = renderComments(comments);
    expect(html).toContain("alice");
    expect(html).toContain("<p>Hello</p>");
  });

  test("indents nested comments with nesting wrappers", () => {
    const comments: Comment[] = [
      { id: 1, author: "alice", text: "<p>Top</p>", createdAt: "2024-01-01T00:00:00Z", depth: 0 },
      { id: 2, author: "bob", text: "<p>Reply</p>", createdAt: "2024-01-01T00:01:00Z", depth: 1 },
      { id: 3, author: "carol", text: "<p>Deep</p>", createdAt: "2024-01-01T00:02:00Z", depth: 2 },
    ];
    const html = renderComments(comments);
    // Each nesting level opens a wrapper div with margin-left and border-left
    const wrapperCount = (html.match(/margin-left: 0\.5em; border-left: 2px solid #ccc/g) || []).length;
    expect(wrapperCount).toBe(2); // one for depth 1, one for depth 2
    // Top-level comment has no nesting wrapper
    expect(html).toContain("alice");
    expect(html).toContain("bob");
    expect(html).toContain("carol");
  });

  test("caps indentation at max depth", () => {
    const comments: Comment[] = [
      { id: 1, author: "deep", text: "<p>Very deep</p>", createdAt: "2024-01-01T00:00:00Z", depth: 10 },
    ];
    const html = renderComments(comments);
    // Should cap at depth 5, meaning 5 nesting wrapper divs
    const wrapperCount = (html.match(/margin-left: 0\.5em; border-left: 2px solid #ccc/g) || []).length;
    expect(wrapperCount).toBe(5);
  });

  test("closes nesting wrappers when depth decreases", () => {
    const comments: Comment[] = [
      { id: 1, author: "alice", text: "<p>Top</p>", createdAt: "2024-01-01T00:00:00Z", depth: 0 },
      { id: 2, author: "bob", text: "<p>Reply</p>", createdAt: "2024-01-01T00:01:00Z", depth: 1 },
      { id: 3, author: "carol", text: "<p>Sibling</p>", createdAt: "2024-01-01T00:02:00Z", depth: 0 },
    ];
    const html = renderComments(comments);
    // bob's reply should be inside a nesting wrapper, carol should be back at root level
    const bobIndex = html.indexOf("bob");
    const closeDivAfterBob = html.indexOf("</div>", html.indexOf("</div>", bobIndex) + 1);
    const carolIndex = html.indexOf("carol");
    // carol should appear after the nesting wrapper for bob is closed
    expect(carolIndex).toBeGreaterThan(closeDivAfterBob);
  });

  test("escapes author names in HTML", () => {
    const comments: Comment[] = [
      { id: 1, author: '<script>alert("xss")</script>', text: "<p>test</p>", createdAt: "2024-01-01T00:00:00Z", depth: 0 },
    ];
    const html = renderComments(comments);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
