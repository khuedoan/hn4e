import epub, { type Chapter, type Options } from "epub-gen-memory";
import type { ExtractedArticle } from "./types.ts";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildStoryChapter(article: ExtractedArticle, index: number): Chapter {
  const { story, content, extracted } = article;
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

  return {
    title: `${story.title} (${story.points} points)`,
    content: body,
    filename: `chapter_${index + 1}.xhtml`,
  };
}

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
    `,
  };

  const chapters: Chapter[] = articles.map((a, i) => buildStoryChapter(a, i));

  return epub(options, chapters);
}
