import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { fetchPopularStories } from "./hn.ts";
import { extractArticles } from "./extract.ts";
import { generateEpub } from "./epub.ts";
import type { GenerationProgress } from "./types.ts";

const app = new Hono();

app.use("/*", cors());

// SSE endpoint that streams progress and ends with a download token.
// The generated EPUB is held in memory until downloaded (or 5 min timeout).
const pendingDownloads = new Map<string, Buffer>();

app.get("/api/generate", (c) => {
  const count = Math.min(Math.max(parseInt(c.req.query("count") ?? "100"), 1), 300);

  return streamSSE(c, async (stream) => {
    function sendProgress(progress: GenerationProgress) {
      return stream.writeSSE({
        event: "progress",
        data: JSON.stringify(progress),
      });
    }

    try {
      await sendProgress({
        phase: "fetching",
        current: 0,
        total: count,
        message: `Fetching ${count} popular stories from Hacker News...`,
      });

      const stories = await fetchPopularStories(count);

      await sendProgress({
        phase: "fetching",
        current: stories.length,
        total: count,
        message: `Fetched ${stories.length} stories.`,
      });

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

      const extracted = articles.filter((a) => a.extracted).length;
      await sendProgress({
        phase: "generating",
        current: 0,
        total: 1,
        message: `Generating EPUB (${extracted}/${articles.length} articles extracted)...`,
      });

      const epubBuffer = await generateEpub(articles);

      // Store the EPUB for download with a unique token
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

app.get("/api/download/:token", (c) => {
  const token = c.req.param("token");
  const buffer = pendingDownloads.get(token);

  if (!buffer) {
    return c.json({ error: "Download not found or expired" }, 404);
  }

  pendingDownloads.delete(token);

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
