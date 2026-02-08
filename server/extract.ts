import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import type { Story, ExtractedArticle } from "./types.ts";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

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
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(story.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "HNE/0.1.0 (Hacker News E-reader archive generator)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { story, content: null, textContent: null, excerpt: null, extracted: false };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return { story, content: null, textContent: null, excerpt: null, extracted: false };
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_BYTES) {
      return { story, content: null, textContent: null, excerpt: null, extracted: false };
    }

    const html = await response.text();
    // Suppress jsdom CSS parsing warnings that are irrelevant for content extraction
    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(html, { url: story.url, virtualConsole });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      return { story, content: null, textContent: null, excerpt: null, extracted: false };
    }

    return {
      story,
      content: article.content,
      textContent: article.textContent ?? null,
      excerpt: article.excerpt ?? null,
      extracted: true,
    };
  } catch {
    return { story, content: null, textContent: null, excerpt: null, extracted: false };
  }
}

// Extract articles in parallel with a concurrency limit.
// Progress is reported after each batch completes to avoid out-of-order updates.
export async function extractArticles(
  stories: Story[],
  onProgress?: (current: number, total: number) => void,
  concurrency: number = 10,
): Promise<ExtractedArticle[]> {
  const results: ExtractedArticle[] = new Array(stories.length);

  for (let i = 0; i < stories.length; i += concurrency) {
    const batchEnd = Math.min(i + concurrency, stories.length);
    const batch = [];
    for (let j = i; j < batchEnd; j++) {
      batch.push(extractArticle(stories[j]).then((result) => { results[j] = result; }));
    }
    await Promise.all(batch);
    onProgress?.(batchEnd, stories.length);
  }

  return results;
}
