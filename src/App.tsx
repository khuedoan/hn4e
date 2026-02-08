import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Github, Loader2, MessageSquare, RefreshCw, Settings, ThumbsUp } from "lucide-react";

const SETTINGS_KEY = "hn4e-settings";

type ExportFormat = "epub" | "xtch";

interface Settings {
  includeComments: boolean;
  exportFormat: ExportFormat;
}

const DEFAULT_SETTINGS: Settings = {
  includeComments: true,
  exportFormat: "epub",
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // Ignore corrupted data
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

const COUNT_OPTIONS = [
  { value: "50", label: "50" },
  { value: "100", label: "100" },
  { value: "150", label: "150" },
  { value: "200", label: "200" },
] as const;

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

  const [count, setCount] = useState("100");
  const [timeRange, setTimeRange] = useState("86400");

  const [settings, setSettings] = useState<Settings>(loadSettings);

  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadToken, setDownloadToken] = useState<string | null>(null);

  const downloadRef = useRef<HTMLAnchorElement>(null);

  const fetchStories = useCallback(async () => {
    setIsFetching(true);
    setFetchError(null);
    setStories([]);
    setSelectedIds(new Set());
    setProgress(null);

    try {
      const response = await fetch(`/api/stories?count=${count}&timeRange=${timeRange}`);
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
  }, [count, timeRange]);

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
    const params = new URLSearchParams({ ids });
    if (!settings.includeComments) params.set("comments", "false");
    const eventSource = new EventSource(`/api/generate?${params}`);

    eventSource.addEventListener("progress", (event) => {
      const data: GenerationProgress = JSON.parse(event.data);
      setProgress(data);

      if (data.phase === "done") {
        setIsGenerating(false);
        eventSource.close();

        const token = data.message;
        setDownloadToken(token);
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
  }, [selectedIds, settings.includeComments]);

  // Extracting phase reports incremental progress, generating phase has no
  // granular progress so we hold at 90% until done.
  const progressPercent = progress
    ? progress.phase === "done"
      ? 100
      : progress.phase === "generating"
        ? 90
        : progress.total > 0
          ? Math.round((progress.current / progress.total) * 90)
          : 0
    : 0;

  useEffect(() => {
    fetchStories();
  }, [fetchStories]);

  return (
    <div className="mx-auto flex h-svh max-w-2xl flex-col gap-4 px-4 pt-6 pb-3">
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

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm text-muted-foreground">
        <span>Top</span>
        <Select value={count} onValueChange={setCount}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COUNT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span>for</span>
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
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={fetchStories}
          disabled={isFetching}
          className="ml-auto"
        >
          <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {fetchError && (
        <p className="text-sm text-destructive">{fetchError}</p>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-md border">
        <label
          className="flex items-center gap-3 border-b px-3 py-2 hover:bg-muted cursor-pointer sticky top-0 bg-background z-10"
        >
          <Checkbox
            checked={selectedIds.size === stories.length && stories.length > 0 ? true : selectedIds.size > 0 ? "indeterminate" : false}
            onCheckedChange={(checked) => checked ? selectAll() : deselectAll()}
            disabled={isGenerating || isFetching}
          />
          <span className="text-sm text-muted-foreground">
            Select all
          </span>
        </label>
        {isFetching && stories.length === 0 ? (
          <div className="flex-1">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 border-b px-3 py-2 last:border-b-0">
                <Skeleton className="mt-0.5 size-4 shrink-0 rounded-sm" />
                <div className="flex-1 min-w-0 space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-3 w-12" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : stories.length > 0 ? (
          stories.map((story) => (
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
          ))
        ) : null}
      </div>

      <div className="shrink-0 space-y-2">
        <div className="flex gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon">
                <Settings className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56">
              <div className="space-y-3">
                <p className="text-sm font-medium">Settings</p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={settings.includeComments}
                    onCheckedChange={(checked) => {
                      const next = { ...settings, includeComments: !!checked };
                      setSettings(next);
                      saveSettings(next);
                    }}
                  />
                  <Label className="cursor-pointer">Include comments</Label>
                </label>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Export format</Label>
                  <Select
                    value={settings.exportFormat}
                    onValueChange={(value: ExportFormat) => {
                      const next = { ...settings, exportFormat: value };
                      setSettings(next);
                      saveSettings(next);
                    }}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="epub">EPUB</SelectItem>
                      <SelectItem value="xtch" disabled className="text-muted-foreground/50">
                        XTCH (coming soon)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button
            className="flex-1"
            onClick={generate}
            disabled={selectedIds.size === 0 || isGenerating}
          >
            {isGenerating ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Generating...
              </>
            ) : (
              `Generate EPUB (${selectedIds.size})`
            )}
          </Button>
        </div>

        <div className="h-4 flex items-center justify-center">
          {progress?.phase === "done" ? (
            <span className="text-[0.65rem] text-muted-foreground">
              Export completed.{" "}
              <a
                href={`/api/download/${downloadToken}`}
                className="underline hover:text-foreground"
              >
                Click here if download did not start automatically.
              </a>
            </span>
          ) : progress?.phase === "error" ? (
            <span className="text-[0.65rem] text-destructive">{progress.message}</span>
          ) : (
            <Progress value={progressPercent} />
          )}
        </div>
      </div>

    </div>
  );
}

export default App;
