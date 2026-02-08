import { EPub, type Chapter, type Content, type Options } from "epub-gen-memory";
import { retryFetch } from "epub-gen-memory/dist/lib/util/other.js";
import { Cache } from "./cache.ts";
import type { Comment, ExtractedArticle } from "./types.ts";

function escapeHtml(text: string): string {
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

function buildChapters(article: ExtractedArticle, index: number): Chapter[] {
  const { story, content, extracted, comments } = article;
  const hnUrl = `https://news.ycombinator.com/item?id=${story.id}`;
  const meta = `<p><small>
    <a href="${escapeHtml(story.url)}">${escapeHtml(story.url)}</a><br/>
    ${story.points} points | <a href="${hnUrl}">${story.commentCount} comments</a>
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

  if (comments.length > 0) {
    chapters.push({
      title: `${comments.length} Comments`,
      content: renderComments(comments),
      filename: `comments_${index + 1}.xhtml`,
    });
  }

  return chapters;
}

// Custom toc.ncx template that nests comment chapters under their story chapter.
// Comment chapters are identified by filename starting with "comments_".
const TOC_NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <head>
        <meta name="dtb:uid" content="<%= id %>" />
        <meta name="dtb:generator" content="epub-gen"/>
        <meta name="dtb:depth" content="2"/>
        <meta name="dtb:totalPageCount" content="0"/>
        <meta name="dtb:maxPageNumber" content="0"/>
    </head>
    <docTitle>
        <text><%= title %></text>
    </docTitle>
    <docAuthor>
        <text><%= author %></text>
    </docAuthor>
    <navMap>
        <% var _index = 0; %>
        <% for (var i = 0; i < content.length; i++) { %>
            <% var ch = content[i]; %>
            <% if (ch.excludeFromToc) continue; %>
            <% if (ch.filename.indexOf('comments_') === 0) continue; %>
            <navPoint id="content_<%= i %>_<%= ch.id %>" playOrder="<%= _index++ %>" class="chapter">
                <navLabel>
                    <text><%= ch.title %></text>
                </navLabel>
                <content src="<%= ch.filename %>"/>
                <% if (i + 1 < content.length && content[i + 1].filename.indexOf('comments_') === 0) { %>
                    <% var cc = content[i + 1]; %>
                    <navPoint id="content_<%= i + 1 %>_<%= cc.id %>" playOrder="<%= _index++ %>" class="chapter">
                        <navLabel>
                            <text><%= cc.title %></text>
                        </navLabel>
                        <content src="<%= cc.filename %>"/>
                    </navPoint>
                <% } %>
            </navPoint>
        <% } %>
    </navMap>
</ncx>`;

// Custom toc.xhtml template that nests comment chapters under their story chapter.
const TOC_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="<%- lang %>" lang="<%- lang %>">
<head>
    <title><%= title %></title>
    <meta charset="UTF-8" />
    <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
    <h1 class="h1"><%= tocTitle %></h1>
    <nav id="toc" epub:type="toc">
        <ol style="list-style: none">
            <% for (var i = 0; i < content.length; i++) { %>
                <% var ch = content[i]; %>
                <% if (ch.excludeFromToc) continue; %>
                <% if (ch.filename.indexOf('comments_') === 0) continue; %>
                <li class="table-of-content">
                    <a href="<%= ch.filename %>"><%= ch.title %></a>
                    <% if (i + 1 < content.length && content[i + 1].filename.indexOf('comments_') === 0) { %>
                        <ol style="list-style: none">
                            <li class="table-of-content">
                                <a href="<%= content[i + 1].filename %>"><%= content[i + 1].title %></a>
                            </li>
                        </ol>
                    <% } %>
                </li>
            <% } %>
        </ol>
    </nav>
</body>
</html>`;

export async function generateEpub(articles: ExtractedArticle[]): Promise<Buffer> {
  const options: Options = {
    title: "Hacker News Archive",
    author: ["Hacker News for E-readers"],
    publisher: "Hacker News for E-readers",
    description: `Hacker News archive with ${articles.length} stories, generated on ${new Date().toISOString().split("T")[0]}.`,
    tocTitle: "Table of Contents",
    date: new Date().toISOString().split("T")[0],
    lang: "en",
    prependChapterTitles: true,
    ignoreFailedDownloads: true,
    tocNCX: TOC_NCX,
    tocXHTML: TOC_XHTML,
    css: `
      body { font-family: serif; line-height: 1.6; }
      p { margin: 1em 0; }
      h1, h2, h3 { font-family: sans-serif; }
      a { color: #1a0dab; }
      small { color: #666; }
      hr { border: none; border-top: 1px solid #ccc; margin: 1em 0; }
      img { max-width: 100%; height: auto; }
      pre { white-space: pre-wrap; word-wrap: break-word; background: #f5f5f5; padding: 0.5em; }
      code { font-size: 0.9em; }
      blockquote { margin-left: 1em; padding-left: 1em; border-left: 3px solid #ccc; }
      h3 { margin-top: 1.5em; }
    `,
  };

  const chapters: Chapter[] = articles.flatMap((a, i) => buildChapters(a, i));

  const book = new CachedEPub(options, chapters);
  return book.genEpub();
}
