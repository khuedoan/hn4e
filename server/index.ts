import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { fetchStories, fetchStoriesByIds, type FeedType } from "./hn.ts";
import { extractArticle, extractArticles } from "./extract.ts";
import { generateEpub, buildChapters } from "./epub.ts";
import type { CommentFilterOptions, GenerationProgress } from "./types.ts";

const app = new Hono();

app.use("/*", cors());

// Return the story list for user selection before generating
const ALLOWED_FEEDS: FeedType[] = ["top", "best"];
const ALLOWED_COUNTS = [50, 100, 150, 200];
const ALLOWED_TIME_RANGES = [86400, 172800, 604800, 2592000, 31536000];

app.get("/api/stories", async (c) => {
  const rawFeed = c.req.query("feed") ?? "top";
  const feed = ALLOWED_FEEDS.includes(rawFeed as FeedType) ? rawFeed as FeedType : "top";

  const rawCount = parseInt(c.req.query("count") ?? "100");
  const count = ALLOWED_COUNTS.includes(rawCount) ? rawCount : 100;

  const rawTimeRange = parseInt(c.req.query("timeRange") ?? "86400");
  const timeRange = ALLOWED_TIME_RANGES.includes(rawTimeRange) ? rawTimeRange : 86400;

  const stories = await fetchStories(feed, count, timeRange);
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
        total: ids.length,
        message: "Loading selected stories...",
      });

      const storiesWithComments = await fetchStoriesByIds(ids, includeComments, commentFilter);
      if (storiesWithComments.length === 0) {
        throw new Error("No selected stories could be loaded.");
      }

      const stories = storiesWithComments.map((s) => s.story);
      const commentsByStoryId = new Map(storiesWithComments.map((s) => [s.story.id, s.comments]));

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

      for (const article of articles) {
        article.comments = commentsByStoryId.get(article.story.id) ?? [];
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
        total: ids.length,
        message: "Loading selected stories...",
      });

      const storiesWithComments = await fetchStoriesByIds(ids, includeComments, commentFilter);
      if (storiesWithComments.length === 0) {
        throw new Error("No selected stories could be loaded.");
      }

      const stories = storiesWithComments.map((s) => s.story);
      const commentsByStoryId = new Map(storiesWithComments.map((s) => [s.story.id, s.comments]));

      await sendProgress({
        phase: "extracting",
        current: 0,
        total: stories.length,
        message: "Extracting article content...",
      });

      for (let i = 0; i < stories.length; i++) {
        const article = await extractArticle(stories[i]);

        article.comments = commentsByStoryId.get(article.story.id) ?? [];

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

app.use("/assets/*", serveStatic({ root: "./dist" }));
app.get("/favicon.svg", serveStatic({ path: "./dist/favicon.svg" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));

const port = parseInt(process.env.PORT ?? "3001");
console.log(`Server running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
  // Generation can take several minutes for 300 stories
  idleTimeout: 255,
};
