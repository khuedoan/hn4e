import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { fetchPopularStories } from "./hn.ts";
import { extractArticles } from "./extract.ts";
import { generateEpub } from "./epub.ts";
import type { Story, GenerationProgress } from "./types.ts";

const app = new Hono();

app.use("/*", cors());

// Return the story list for user selection before generating
app.get("/api/stories", async (c) => {
  const count = Math.min(Math.max(parseInt(c.req.query("count") ?? "100"), 1), 300);
  const stories = await fetchPopularStories(count);
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

  // Fetch the full story data for the selected IDs
  const stories = await fetchStoriesByIds(ids);

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

      const extracted = articles.filter((a) => a.extracted).length;
      await sendProgress({
        phase: "generating",
        current: 0,
        total: 1,
        message: `Generating EPUB (${extracted}/${articles.length} articles extracted)...`,
      });

      const epubBuffer = await generateEpub(articles);

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

// Fetch stories by their IDs from the Algolia API
async function fetchStoriesByIds(ids: string[]): Promise<Story[]> {
  const ALGOLIA_API = "https://hn.algolia.com/api/v1";
  const results: Story[] = [];

  // Algolia supports fetching individual items by ID
  const fetches = ids.map(async (id) => {
    const response = await fetch(`${ALGOLIA_API}/items/${id}`);
    if (!response.ok) return null;

    const item = await response.json();
    return {
      id: String(item.id),
      title: item.title ?? "",
      url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
      author: item.author ?? "",
      points: item.points ?? 0,
      commentCount: item.children?.length ?? 0,
      createdAt: item.created_at ?? "",
    } satisfies Story;
  });

  const settled = await Promise.all(fetches);
  for (const story of settled) {
    if (story) results.push(story);
  }

  return results;
}

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
