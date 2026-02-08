import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import type { Story, ExtractedArticle } from "./types.ts";
import { Cache, ONE_HOUR } from "./cache.ts";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

// Cache extracted content by URL so the same article linked from multiple
// stories is only fetched and parsed once. Stores only the extraction result
// fields to avoid holding story metadata or comments.
interface CachedExtraction {
  content: string | null;
  textContent: string | null;
  excerpt: string | null;
  extracted: boolean;
}

export const articleCache = new Cache<CachedExtraction>(ONE_HOUR, 300);

// Extract article content from a URL using Readability.
// Returns null content on failure (title + URL fallback is handled by the caller).
export async function extractArticle(story: Story): Promise<ExtractedArticle> {
  // HN self-posts (Ask HN, Show HN, etc.) point to HN itself
  if (story.url.includes("news.ycombinator.com/item")) {
    return {
      story,
      content: null,
      textContent: null,
      excerpt: null,
      extracted: false,
      comments: [],
    };
  }

  const cached = articleCache.get(story.url);
  if (cached) {
    return { story, ...cached, comments: [] };
  }

  const result = await fetchAndExtract(story.url);
  articleCache.set(story.url, result);

  return { story, ...result, comments: [] };
}

async function fetchAndExtract(url: string): Promise<CachedExtraction> {
  const fail: CachedExtraction = { content: null, textContent: null, excerpt: null, extracted: false };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "HN4E/0.1.0 (Hacker News for E-readers archive generator)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) return fail;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return fail;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_BYTES) {
      return fail;
    }

    const html = await response.text();
    // Suppress jsdom CSS parsing warnings that are irrelevant for content extraction
    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(html, { url, virtualConsole });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.content) return fail;

    return {
      content: article.content,
      textContent: article.textContent ?? null,
      excerpt: article.excerpt ?? null,
      extracted: true,
    };
  } catch {
    return fail;
  }
}

// Extract articles in parallel with a concurrency limit.
// Progress is reported after each individual article completes.
export async function extractArticles(
  stories: Story[],
  onProgress?: (current: number, total: number) => void,
  concurrency: number = 10,
): Promise<ExtractedArticle[]> {
  const results: ExtractedArticle[] = new Array(stories.length);
  let completed = 0;

  const queue = stories.map((story, index) => ({ story, index }));
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      results[item.index] = await extractArticle(item.story);
      completed++;
      onProgress?.(completed, stories.length);
    }
  });

  await Promise.all(workers);
  return results;
}
