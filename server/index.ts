import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { fetchPopularStories } from "./hn.ts";
import { flattenComments, filterComments } from "./comments.ts";
import { extractArticle, extractArticles } from "./extract.ts";
import { generateEpub, buildChapters } from "./epub.ts";
import { Cache, ONE_HOUR } from "./cache.ts";
import type { Comment, CommentFilterOptions, Story, GenerationProgress } from "./types.ts";

const app = new Hono();

app.use("/*", cors());

// Return the story list for user selection before generating
const ALLOWED_COUNTS = [50, 100, 150, 200];
// 0 means "all time" (no time filter)
const ALLOWED_TIME_RANGES = [0, 86400, 172800, 604800, 2592000, 31536000];

app.get("/api/stories", async (c) => {
  const rawCount = parseInt(c.req.query("count") ?? "100");
  const count = ALLOWED_COUNTS.includes(rawCount) ? rawCount : 100;

  const rawTimeRange = parseInt(c.req.query("timeRange") ?? "86400");
  const timeRange = ALLOWED_TIME_RANGES.includes(rawTimeRange) ? rawTimeRange : 86400;

  const stories = await fetchPopularStories(count, timeRange);
  return c.json(stories);
});

// SSE endpoint that extracts selected stories and generates an EPUB.
// Accepts story IDs as a comma-separated query parameter since EventSource
// only supports GET requests.
const pendingDownloads = new Map<string, Buffer>();

app.get("/api/generate", async (c) => {
  const ids = c.req.query("ids")?.split(",").filter(Boolean) ?? [];
  if (ids.length === 0) {
    return c.json({ error: "No story IDs provided" }, 400);
  }

  const includeComments = c.req.query("comments") !== "false";
  const includeQrCode = c.req.query("qrCode") !== "false";

  const commentFilter: CommentFilterOptions = {
    maxCommentDepth: parseInt(c.req.query("maxCommentDepth") ?? "-1") || -1,
    maxCommentsPerStory: parseInt(c.req.query("maxCommentsPerStory") ?? "-1") || -1,
    maxTopLevelComments: parseInt(c.req.query("maxTopLevelComments") ?? "-1") || -1,
  };

  // Fetch the full story data and comment trees for the selected IDs
  const storiesWithComments = await fetchStoriesByIds(ids);
  const stories = storiesWithComments.map((s) => s.story);
  const commentsByStoryId = new Map(storiesWithComments.map((s) => [s.story.id, s.comments]));

  return streamSSE(c, async (stream) => {
    function sendProgress(progress: GenerationProgress) {
      return stream.writeSSE({
        event: "progress",
        data: JSON.stringify(progress),
      });
    }

    try {
      await sendProgress({
        phase: "extracting",
        current: 0,
        total: stories.length,
        message: "Extracting article content...",
      });

      const articles = await extractArticles(stories, async (current, total) => {
        await sendProgress({
          phase: "extracting",
          current,
          total,
          message: `Extracted ${current}/${total} articles...`,
        });
      });

      // Attach comments to each extracted article
      for (const article of articles) {
        if (!includeComments) {
          article.comments = [];
        } else {
          const raw = commentsByStoryId.get(article.story.id) ?? [];
          article.comments = filterComments(raw, commentFilter);
        }
      }

      await sendProgress({
        phase: "generating",
        current: 0,
        total: 0,
        message: "Generating EPUB...",
      });

      const epubBuffer = await generateEpub(articles, { includeQrCode });

      const token = crypto.randomUUID();
      pendingDownloads.set(token, epubBuffer);

      // Clean up after 5 minutes
      setTimeout(() => pendingDownloads.delete(token), 5 * 60 * 1000);

      await sendProgress({
        phase: "done",
        current: 1,
        total: 1,
        message: token,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await sendProgress({
        phase: "error",
        current: 0,
        total: 0,
        message: `Generation failed: ${message}`,
      });
    }
  });
});

interface StoryWithComments {
  story: Story;
  comments: Comment[];
}

export const storyCache = new Cache<StoryWithComments>(ONE_HOUR, 300);

// Fetch stories and their comment trees by ID from the Algolia items API.
// The items endpoint returns the full nested comment tree, so we extract
// both story metadata and comments from a single request per story.
async function fetchStoriesByIds(ids: string[]): Promise<StoryWithComments[]> {
  const ALGOLIA_API = "https://hn.algolia.com/api/v1";

  const results: StoryWithComments[] = [];
  const uncachedIds: string[] = [];

  for (const id of ids) {
    const cached = storyCache.get(id);
    if (cached) {
      results.push(cached);
    } else {
      uncachedIds.push(id);
    }
  }

  const fetches = uncachedIds.map(async (id): Promise<StoryWithComments | null> => {
    const response = await fetch(`${ALGOLIA_API}/items/${id}`);
    if (!response.ok) return null;

    const item = await response.json();
    const story: Story = {
      id: String(item.id),
      title: item.title ?? "",
      url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
      author: item.author ?? "",
      points: item.points ?? 0,
      commentCount: item.children?.length ?? 0,
      createdAt: item.created_at ?? "",
    };
    const comments = flattenComments(item.children ?? []);
    const entry = { story, comments };
    storyCache.set(id, entry);
    return entry;
  });

  const fetched = await Promise.all(fetches);
  for (const r of fetched) {
    if (r) results.push(r);
  }

  return results;
}

// SSE endpoint that streams article HTML previews as they are extracted.
// Returns each article's rendered HTML content incrementally, styled to match
// the EPUB output, without generating an actual EPUB file.
app.get("/api/preview", async (c) => {
  const ids = c.req.query("ids")?.split(",").filter(Boolean) ?? [];
  if (ids.length === 0) {
    return c.json({ error: "No story IDs provided" }, 400);
  }

  const includeComments = c.req.query("comments") !== "false";
  const includeQrCode = c.req.query("qrCode") !== "false";

  const commentFilter: CommentFilterOptions = {
    maxCommentDepth: parseInt(c.req.query("maxCommentDepth") ?? "-1") || -1,
    maxCommentsPerStory: parseInt(c.req.query("maxCommentsPerStory") ?? "-1") || -1,
    maxTopLevelComments: parseInt(c.req.query("maxTopLevelComments") ?? "-1") || -1,
  };

  const storiesWithComments = await fetchStoriesByIds(ids);
  const stories = storiesWithComments.map((s) => s.story);
  const commentsByStoryId = new Map(storiesWithComments.map((s) => [s.story.id, s.comments]));

  return streamSSE(c, async (stream) => {
    function sendProgress(progress: GenerationProgress) {
      return stream.writeSSE({
        event: "progress",
        data: JSON.stringify(progress),
      });
    }

    try {
      await sendProgress({
        phase: "extracting",
        current: 0,
        total: stories.length,
        message: "Extracting article content...",
      });

      for (let i = 0; i < stories.length; i++) {
        const article = await extractArticle(stories[i]);

        if (!includeComments) {
          article.comments = [];
        } else {
          const raw = commentsByStoryId.get(article.story.id) ?? [];
          article.comments = filterComments(raw, commentFilter);
        }

        const chapters = await buildChapters(article, i, { includeQrCode });

        await stream.writeSSE({
          event: "article",
          data: JSON.stringify({
            storyId: article.story.id,
            title: article.story.title,
            chapters: chapters.map((ch) => ({
              title: ch.title ?? "",
              html: ch.content,
            })),
          }),
        });

        await sendProgress({
          phase: "extracting",
          current: i + 1,
          total: stories.length,
          message: `Extracted ${i + 1}/${stories.length} articles...`,
        });
      }

      await sendProgress({
        phase: "done",
        current: stories.length,
        total: stories.length,
        message: "Preview ready.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await sendProgress({
        phase: "error",
        current: 0,
        total: 0,
        message: `Preview failed: ${message}`,
      });
    }
  });
});

app.get("/api/download/:token", (c) => {
  const token = c.req.param("token");
  const buffer = pendingDownloads.get(token);

  if (!buffer) {
    return c.json({ error: "Download not found or expired" }, 404);
  }

  const date = new Date().toISOString().split("T")[0];
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/epub+zip",
      "Content-Disposition": `attachment; filename="hn-archive-${date}.epub"`,
      "Content-Length": buffer.byteLength.toString(),
    },
  });
});

const port = parseInt(process.env.PORT ?? "3001");
console.log(`Server running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
  // Generation can take several minutes for 300 stories
  idleTimeout: 255,
};
