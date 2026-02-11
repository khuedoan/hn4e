import type { Comment, CommentFilterOptions } from "./types.ts";

const ALGOLIA_API = "https://hn.algolia.com/api/v1";

interface AlgoliaItem {
  id: number;
  author: string | null;
  text: string | null;
  created_at: string;
  type: string;
  children: AlgoliaItem[];
}

// Flatten a nested comment tree into a depth-annotated list (pre-order traversal).
// Skips dead/deleted comments (null author or null text).
export function flattenComments(children: AlgoliaItem[], depth: number = 0): Comment[] {
  const result: Comment[] = [];

  for (const child of children) {
    if (child.type !== "comment") continue;
    if (child.author && child.text) {
      result.push({
        id: child.id,
        author: child.author,
        text: child.text,
        createdAt: child.created_at,
        depth,
      });
    }
    result.push(...flattenComments(child.children ?? [], depth + 1));
  }

  return result;
}

// Fetch the full comment tree for a single story from the Algolia items API.
export async function fetchComments(storyId: string): Promise<Comment[]> {
  const response = await fetch(`${ALGOLIA_API}/items/${storyId}`);
  if (!response.ok) {
    return [];
  }

  const item: AlgoliaItem = await response.json();
  return flattenComments(item.children ?? []);
}

// Fetch comments for multiple stories in parallel with a concurrency limit.
export async function fetchCommentsForStories(
  storyIds: string[],
  onProgress?: (current: number, total: number) => void,
  concurrency: number = 10,
): Promise<Map<string, Comment[]>> {
  const results = new Map<string, Comment[]>();
  let completed = 0;

  const queue = [...storyIds];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const id = queue.shift()!;
      const comments = await fetchComments(id);
      results.set(id, comments);
      completed++;
      onProgress?.(completed, storyIds.length);
    }
  });

  await Promise.all(workers);
  return results;
}

// Filter a flat comment list by depth, top-level count, and total count.
// The flat list is in pre-order (tree traversal) so a depth-0 comment is
// followed by all its descendants before the next depth-0 comment.
export function filterComments(
  comments: Comment[],
  options: CommentFilterOptions,
): Comment[] {
  const { maxCommentDepth, maxTopLevelComments, maxCommentsPerStory } = options;

  let filtered = comments;

  // 1. Limit number of top-level comments (and their sub-threads).
  if (maxTopLevelComments >= 0) {
    const result: Comment[] = [];
    let topLevelSeen = 0;
    let including = true;

    for (const c of filtered) {
      if (c.depth === 0) {
        topLevelSeen++;
        including = topLevelSeen <= maxTopLevelComments;
      }
      if (including) {
        result.push(c);
      }
    }

    filtered = result;
  }

  // 2. Remove comments deeper than the max depth.
  if (maxCommentDepth >= 0) {
    filtered = filtered.filter((c) => c.depth <= maxCommentDepth);
  }

  // 3. Truncate to a total cap per story.
  if (maxCommentsPerStory >= 0) {
    filtered = filtered.slice(0, maxCommentsPerStory);
  }

  return filtered;
}
