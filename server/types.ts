export interface Story {
  id: string;
  title: string;
  url: string;
  author: string;
  points: number;
  commentCount: number;
  createdAt: string;
}

export interface ExtractedArticle {
  story: Story;
  content: string | null;
  textContent: string | null;
  excerpt: string | null;
  // Whether extraction succeeded or fell back to title + URL
  extracted: boolean;
}

export interface GenerationProgress {
  phase: "extracting" | "generating" | "done" | "error";
  current: number;
  total: number;
  message: string;
}
