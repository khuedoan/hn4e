export interface Story {
  id: string;
  title: string;
  url: string;
  author: string;
  points: number;
  commentCount: number;
  createdAt: string;
}

export interface Comment {
  id: number;
  author: string;
  text: string;
  createdAt: string;
  depth: number;
}

export interface ExtractedArticle {
  story: Story;
  content: string | null;
  textContent: string | null;
  excerpt: string | null;
  // Whether extraction succeeded or fell back to title + URL
  extracted: boolean;
  comments: Comment[];
}

export interface CommentFilterOptions {
  maxCommentDepth: number; // -1 = unlimited
  maxCommentsPerStory: number; // -1 = unlimited
  maxTopLevelComments: number; // -1 = unlimited
}

export interface GenerationProgress {
  phase: "extracting" | "comments" | "generating" | "done" | "error";
  current: number;
  total: number;
  message: string;
}
