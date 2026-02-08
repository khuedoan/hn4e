import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookOpen, Github, Loader2, MessageSquare, RefreshCw, ThumbsUp } from "lucide-react";

const TIME_RANGE_OPTIONS = [
  { value: "86400", label: "1 day" },
  { value: "172800", label: "2 days" },
  { value: "604800", label: "1 week" },
  { value: "2592000", label: "1 month" },
  { value: "31536000", label: "1 year" },
  { value: "0", label: "all time" },
] as const;

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
  phase: "extracting" | "comments" | "generating" | "done" | "error";
  current: number;
  total: number;
  message: string;
}

function App() {
  const [stories, setStories] = useState<Story[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [timeRange, setTimeRange] = useState("86400");

  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const downloadRef = useRef<HTMLAnchorElement>(null);

  const fetchStories = useCallback(async () => {
    setIsFetching(true);
    setFetchError(null);
    setStories([]);
    setSelectedIds(new Set());
    setProgress(null);

    try {
      const response = await fetch(`/api/stories?timeRange=${timeRange}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch stories: ${response.statusText}`);
      }
      const data: Story[] = await response.json();
      setStories(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setFetchError(message);
    } finally {
      setIsFetching(false);
    }
  }, [timeRange]);

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

    const ids = Array.from(selectedIds).join(",");
    const eventSource = new EventSource(`/api/generate?ids=${ids}`);

    eventSource.addEventListener("progress", (event) => {
      const data: GenerationProgress = JSON.parse(event.data);
      setProgress(data);

      if (data.phase === "done") {
        setIsGenerating(false);
        eventSource.close();

        // Auto-download the generated EPUB
        const token = data.message;
        const link = downloadRef.current;
        if (link) {
          link.href = `/api/download/${token}`;
          link.click();
        }
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

  const progressPercent = progress
    ? progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0
    : 0;

  const phaseLabel = progress
    ? {
        extracting: "Extracting articles",
        comments: "Fetching comments",
        generating: "Generating EPUB",
        done: "Done",
        error: "Error",
      }[progress.phase]
    : null;

  useEffect(() => {
    fetchStories();
  }, [fetchStories]);

  return (
    <div className="mx-auto flex h-svh max-w-2xl flex-col gap-4 px-4 py-6">
      {/* Hidden link for auto-download */}
      <a ref={downloadRef} className="sr-only" download />

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <BookOpen className="size-5" />
          <h1 className="text-xl font-semibold">Hacker News for E-readers</h1>
          <a
            href="https://github.com/khuedoan/hn4e"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            <Github className="size-3" />
            GitHub
          </a>
        </div>
        <p className="text-sm text-muted-foreground">
          Generate an offline Hacker News archive for your e-readers.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm text-muted-foreground">
          <span>Top stories for</span>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_RANGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          {stories.length > 0 && (
            <>
              <Button variant="ghost" size="xs" onClick={selectAll}>
                All
              </Button>
              <Button variant="ghost" size="xs" onClick={deselectAll}>
                None
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={fetchStories}
            disabled={isFetching}
          >
            <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {fetchError && (
        <p className="text-sm text-destructive">{fetchError}</p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
        {isFetching && stories.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Fetching stories from Hacker News...
          </div>
        ) : stories.length > 0 ? (
          <>
            {stories.map((story) => (
              <label
                key={story.id}
                className="flex items-start gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50 cursor-pointer"
              >
                <Checkbox
                  checked={selectedIds.has(story.id)}
                  onCheckedChange={() => toggleStory(story.id)}
                  disabled={isGenerating}
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
          </>
        ) : null}
      </div>

      {!isGenerating && (
        <Button
          className="w-full shrink-0"
          onClick={generate}
          disabled={selectedIds.size === 0}
        >
          Generate EPUB ({selectedIds.size})
        </Button>
      )}

      {isGenerating && (
        <div
          className="relative h-10 shrink-0 overflow-hidden rounded-md bg-green-100"
        >
          {progress?.phase === "extracting" ? (
            <div
              className="absolute inset-y-0 left-0 bg-green-500 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          ) : null}
          <div className="relative flex h-full items-center justify-center gap-2 text-sm font-medium text-green-900">
            <Loader2 className="size-4 animate-spin" />
            {!progress
              ? "Connecting..."
              : progress.phase === "extracting"
                ? `${phaseLabel} (${progress.current}/${progress.total})`
                : "Generating EPUB..."}
          </div>
        </div>
      )}

      {!isGenerating && progress?.phase === "error" && (
        <p className="text-sm text-destructive">{progress.message}</p>
      )}

      {!isGenerating && progress?.phase === "done" && (
        <p className="text-sm text-muted-foreground">
          Download started automatically.
        </p>
      )}

    </div>
  );
}

export default App;
