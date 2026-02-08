import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { BookOpen, Download, Loader2, MessageSquare, ThumbsUp } from "lucide-react";

interface Story {
  id: string;
  title: string;
  url: string;
  author: string;
  points: number;
  commentCount: number;
  createdAt: string;
}

interface GenerationProgress {
  phase: "extracting" | "generating" | "done" | "error";
  current: number;
  total: number;
  message: string;
}

function App() {
  const [stories, setStories] = useState<Story[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [downloadToken, setDownloadToken] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const fetchStories = useCallback(async () => {
    setIsFetching(true);
    setFetchError(null);
    setStories([]);
    setSelectedIds(new Set());

    try {
      const response = await fetch("/api/stories");
      if (!response.ok) {
        throw new Error(`Failed to fetch stories: ${response.statusText}`);
      }
      const data: Story[] = await response.json();
      setStories(data);
      setSelectedIds(new Set());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setFetchError(message);
    } finally {
      setIsFetching(false);
    }
  }, []);

  const toggleStory = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(stories.map((s) => s.id)));
  }, [stories]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const generate = useCallback(() => {
    if (selectedIds.size === 0) return;

    setIsGenerating(true);
    setProgress(null);
    setDownloadToken(null);

    const ids = Array.from(selectedIds).join(",");
    const eventSource = new EventSource(`/api/generate?ids=${ids}`);

    eventSource.addEventListener("progress", (event) => {
      const data: GenerationProgress = JSON.parse(event.data);
      setProgress(data);

      if (data.phase === "done") {
        setDownloadToken(data.message);
        setIsGenerating(false);
        eventSource.close();
      }

      if (data.phase === "error") {
        setIsGenerating(false);
        eventSource.close();
      }
    });

    eventSource.onerror = () => {
      setProgress({
        phase: "error",
        current: 0,
        total: 0,
        message: "Connection to server lost.",
      });
      setIsGenerating(false);
      eventSource.close();
    };
  }, [selectedIds]);

  const reset = useCallback(() => {
    setStories([]);
    setSelectedIds(new Set());
    setProgress(null);
    setDownloadToken(null);
    setIsGenerating(false);
    setFetchError(null);
  }, []);

  const progressPercent = progress
    ? progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0
    : 0;

  const phaseLabel = progress
    ? {
        extracting: "Extracting articles",
        generating: "Generating EPUB",
        done: "Done",
        error: "Error",
      }[progress.phase]
    : null;

  useEffect(() => {
    fetchStories();
  }, [fetchStories]);

  const showSelection = stories.length > 0 && !isGenerating && !downloadToken;

  return (
    <div className="flex min-h-svh flex-col items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-2xl">
            <BookOpen className="size-6" />
            Hacker News for E-readers
          </CardTitle>
          <CardDescription>
            Generate an offline Hacker News archive for your e-reader.
            Top 100 popular stories from the last 24 hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isFetching && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Fetching stories from Hacker News...
            </div>
          )}

          {fetchError && (
            <div className="space-y-3">
              <p className="text-sm text-destructive">{fetchError}</p>
              <Button className="w-full" variant="outline" onClick={fetchStories}>
                Try again
              </Button>
            </div>
          )}

          {showSelection && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {selectedIds.size}/{stories.length} selected
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={selectAll}>
                    Select all
                  </Button>
                  <Button variant="ghost" size="sm" onClick={deselectAll}>
                    Deselect all
                  </Button>
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto rounded-md border">
                {stories.map((story) => (
                  <label
                    key={story.id}
                    className="flex items-start gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedIds.has(story.id)}
                      onCheckedChange={() => toggleStory(story.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug">{story.title}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <ThumbsUp className="size-3" />
                          {story.points}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageSquare className="size-3" />
                          {story.commentCount}
                        </span>
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={reset}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  size="lg"
                  onClick={generate}
                  disabled={selectedIds.size === 0}
                >
                  Generate EPUB ({selectedIds.size})
                </Button>
              </div>
            </>
          )}

          {isGenerating && progress && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{phaseLabel}</span>
                {progress.total > 0 && (
                  <span className="text-muted-foreground">
                    {progress.current}/{progress.total}
                  </span>
                )}
              </div>
              <Progress value={progressPercent} />
              <p className="text-muted-foreground text-sm">{progress.message}</p>
            </div>
          )}

          {isGenerating && !progress && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Connecting...
            </div>
          )}

          {progress?.phase === "error" && (
            <div className="space-y-3">
              <p className="text-sm text-destructive">{progress.message}</p>
              <Button className="w-full" variant="outline" onClick={generate}>
                Try again
              </Button>
            </div>
          )}

          {downloadToken && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground text-center">
                Archive generated successfully.
              </p>
              <Button className="w-full" size="lg" asChild>
                <a href={`/api/download/${downloadToken}`}>
                  <Download className="size-4" />
                  Download EPUB
                </a>
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={reset}
              >
                Generate another
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default App;
