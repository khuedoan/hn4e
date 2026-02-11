import { join } from "node:path";
import { readFileSync } from "node:fs";
import { EPub, type Chapter, type Content, type Options } from "epub-gen-memory";
import { retryFetch } from "epub-gen-memory/dist/lib/util/other.js";
import QRCode from "qrcode";
import { Cache } from "./cache.ts";
import type { Comment, ExtractedArticle } from "./types.ts";

const TEMPLATES_DIR = join(import.meta.dir, "templates");
const TOC_NCX = readFileSync(join(TEMPLATES_DIR, "toc.ncx.ejs"), "utf-8");
const TOC_XHTML = readFileSync(join(TEMPLATES_DIR, "toc.xhtml.ejs"), "utf-8");
const EPUB_CSS = readFileSync(join(TEMPLATES_DIR, "epub.css"), "utf-8");

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Cap indentation at depth 5 to keep deeply nested threads readable on e-readers
const MAX_INDENT_DEPTH = 5;

const IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const imageCache = new Cache<Buffer>(IMAGE_CACHE_TTL_MS, 300);

// Subclass EPub to override image downloading with a cached version.
// All accessed properties (images, zip, options, log, warn) are declared
// as protected in the base class, so this is the intended extension point.
class CachedEPub extends EPub {
  constructor(options: Options, content: Content) {
    super(options, content);
  }

  protected async downloadAllImages(): Promise<void> {
    if (!this.images.length) {
      this.log("No images to download");
      return;
    }

    const oebps = this.zip.folder("OEBPS")!;
    const imagesFolder = oebps.folder("images")!;
    let index = 0;

    while (index < this.images.length) {
      const batch = this.images.slice(index, index + this.options.batchSize);
      const downloads = batch.map((image) => {
        const task = this.fetchImageWithCache(image.url);
        if (!this.options.ignoreFailedDownloads) return task;

        return task.catch(() => {
          this.warn(`Warning (image ${image.url}): Download failed`);
          return Buffer.from("");
        });
      });

      const results = await Promise.all(downloads);
      results.forEach((data, idx) => {
        const image = batch[idx];
        imagesFolder.file(`${image.id}.${image.extension}`, data);
      });

      index += this.options.batchSize;
    }
  }

  private async fetchImageWithCache(url: string): Promise<Buffer> {
    const cached = imageCache.get(url);
    if (cached) {
      this.log(`Image cache hit: ${url}`);
      return cached;
    }

    const data = await retryFetch(
      url,
      this.options.fetchTimeout,
      this.options.retryTimes,
      this.log,
    );
    imageCache.set(url, data);
    this.log(`Downloaded image ${url}`);
    return data;
  }
}

export function renderComments(comments: Comment[]): string {
  if (comments.length === 0) return "";

  // Build nested HTML so that each depth level's border-left wraps all its
  // children, keeping the indent visual continuous throughout the thread.
  const lines: string[] = [];
  let currentDepth = 0;

  for (const c of comments) {
    const indent = Math.min(c.depth, MAX_INDENT_DEPTH);

    // Close deeper nesting levels when moving back up
    while (currentDepth > indent) {
      lines.push("</div>");
      currentDepth--;
    }

    // Open new nesting levels when going deeper
    while (currentDepth < indent) {
      lines.push(
        `<div style="margin-left: 0.5em; border-left: 2px solid #ccc; padding-left: 0.5em;">`
      );
      currentDepth++;
    }

    lines.push(
      `<div style="margin-bottom: 0.8em;">`,
      `  <p><small><strong>${escapeHtml(c.author)}</strong></small></p>`,
      `  ${c.text}`,
      `</div>`
    );
  }

  // Close any remaining open nesting divs
  while (currentDepth > 0) {
    lines.push("</div>");
    currentDepth--;
  }

  return lines.join("\n");
}

export async function buildChapters(article: ExtractedArticle, index: number): Promise<Chapter[]> {
  const { story, content, extracted, comments } = article;
  const meta = `<p><small>
    <a href="${escapeHtml(story.url)}">${escapeHtml(story.url)}</a>
  </small></p><hr/>`;

  let body: string;
  if (extracted && content) {
    body = `${meta}${content}`;
  } else {
    body = `${meta}<p><em>Article content could not be extracted. Visit the link above to read the full article.</em></p>`;
  }

  const chapters: Chapter[] = [
    {
      title: `${story.title} (${story.points} points)`,
      content: body,
      filename: `story_${index + 1}.xhtml`,
    },
  ];

  const hnUrl = `https://news.ycombinator.com/item?id=${story.id}`;
  const qrDataUrl = await QRCode.toDataURL(hnUrl, { margin: 1, width: 150 });
  const qrHtml = `<p><img src="${qrDataUrl}" alt="QR code to HN discussion"/></p><hr/>`;

  chapters.push({
    title: `${comments.length} Comments`,
    content: qrHtml + renderComments(comments),
    filename: `comments_${index + 1}.xhtml`,
  });

  return chapters;
}

export async function generateEpub(articles: ExtractedArticle[]): Promise<Buffer> {
  const options: Options = {
    title: "Hacker News",
    author: ["Hacker News for E-readers"],
    publisher: "Hacker News for E-readers",
    description: `Hacker News archive with ${articles.length} stories, generated on ${new Date().toISOString().split("T")[0]}.`,
    tocTitle: "Hacker News",
    date: new Date().toISOString().split("T")[0],
    lang: "en",
    prependChapterTitles: true,
    ignoreFailedDownloads: true,
    tocNCX: TOC_NCX,
    tocXHTML: TOC_XHTML,
    css: EPUB_CSS,
  };

  const chapterArrays = await Promise.all(articles.map((a, i) => buildChapters(a, i)));
  const chapters: Chapter[] = chapterArrays.flat();

  const book = new CachedEPub(options, chapters);
  return book.genEpub();
}
