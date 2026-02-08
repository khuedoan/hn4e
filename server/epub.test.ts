import { describe, test, expect } from "bun:test";
import JSZip from "jszip";
import { generateEpub } from "./epub.ts";
import type { ExtractedArticle } from "./types.ts";

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
});
