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
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Eye, Github, List, Loader2, MessageSquare, RefreshCw, Settings, ThumbsUp } from "lucide-react";

const SETTINGS_KEY = "hn4e-settings";

type ExportFormat = "epub";

interface Settings {
  includeComments: boolean;
  includeQrCode: boolean;
  maxCommentDepth: number; // 1-10, or 11 for unlimited
  maxTopLevelComments: number; // 1-20, or 21 for unlimited
  maxCommentsPerStory: number; // 1-500, or 501 for unlimited
  exportFormat: ExportFormat;
}

const DEFAULT_SETTINGS: Settings = {
  includeComments: true,
  includeQrCode: true,
  maxCommentDepth: 5,
  maxTopLevelComments: 11, // unlimited since top-level filtering is aggressive
  maxCommentsPerStory: 200,
  exportFormat: "epub",
};

// Slider configs: the max slider position is one past the real max and means "Unlimited"
const SLIDER_CONFIGS = {
  maxCommentDepth: { min: 1, max: 10, unlimited: 11 },
  maxTopLevelComments: { min: 1, max: 20, unlimited: 21 },
  maxCommentsPerStory: { min: 1, max: 500, unlimited: 501 },
} as const;

function sliderLabel(value: number, unlimited: number): string {
  return value >= unlimited ? "\u221E" : String(value);
}

function sliderToParam(value: number, unlimited: number): string {
  return value >= unlimited ? "-1" : String(value);
}

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

  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewArticles, setPreviewArticles] = useState<{ title: string; chapters: { title: string; html: string }[] }[]>([]);
  const [previewProgress, setPreviewProgress] = useState<GenerationProgress | null>(null);
  const previewEventSourceRef = useRef<EventSource | null>(null);

  const downloadRef = useRef<HTMLAnchorElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);

  const fetchStories = useCallback(async () => {
    setIsFetching(true);
    setFetchError(null);
    setProgress(null);

    try {
      const response = await fetch(`/api/stories?count=${count}&timeRange=${timeRange}`);
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
    if (!settings.includeComments) {
      params.set("comments", "false");
    } else {
      params.set("maxCommentDepth", sliderToParam(settings.maxCommentDepth, SLIDER_CONFIGS.maxCommentDepth.unlimited));
      params.set("maxTopLevelComments", sliderToParam(settings.maxTopLevelComments, SLIDER_CONFIGS.maxTopLevelComments.unlimited));
      params.set("maxCommentsPerStory", sliderToParam(settings.maxCommentsPerStory, SLIDER_CONFIGS.maxCommentsPerStory.unlimited));
    }
    if (!settings.includeQrCode) {
      params.set("qrCode", "false");
    }
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
  }, [selectedIds, settings]);

  const togglePreview = useCallback(() => {
    if (isPreviewing) {
      // Close preview, abort any in-flight request
      previewEventSourceRef.current?.close();
      previewEventSourceRef.current = null;
      setIsPreviewing(false);
      return;
    }

    if (selectedIds.size === 0) return;

    setIsPreviewing(true);
    setPreviewArticles([]);
    setPreviewProgress(null);

    const ids = Array.from(selectedIds).join(",");
    const params = new URLSearchParams({ ids });
    if (!settings.includeComments) {
      params.set("comments", "false");
    } else {
      params.set("maxCommentDepth", sliderToParam(settings.maxCommentDepth, SLIDER_CONFIGS.maxCommentDepth.unlimited));
      params.set("maxTopLevelComments", sliderToParam(settings.maxTopLevelComments, SLIDER_CONFIGS.maxTopLevelComments.unlimited));
      params.set("maxCommentsPerStory", sliderToParam(settings.maxCommentsPerStory, SLIDER_CONFIGS.maxCommentsPerStory.unlimited));
    }
    if (!settings.includeQrCode) {
      params.set("qrCode", "false");
    }
    const eventSource = new EventSource(`/api/preview?${params}`);
    previewEventSourceRef.current = eventSource;

    eventSource.addEventListener("article", (event) => {
      const data = JSON.parse(event.data);
      setPreviewArticles((prev) => [...prev, { title: data.title, chapters: data.chapters }]);
    });

    eventSource.addEventListener("progress", (event) => {
      const data: GenerationProgress = JSON.parse(event.data);
      setPreviewProgress(data);

      if (data.phase === "done" || data.phase === "error") {
        eventSource.close();
        previewEventSourceRef.current = null;
      }
    });

    eventSource.onerror = () => {
      setPreviewProgress({
        phase: "error",
        current: 0,
        total: 0,
        message: "Connection to server lost.",
      });
      eventSource.close();
      previewEventSourceRef.current = null;
    };
  }, [isPreviewing, selectedIds, settings]);

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
          <img src="/favicon.svg" alt="HN4E" className="size-5" />
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

      {isPreviewing ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-md border" ref={previewScrollRef}>
          <div className="flex items-center gap-3 border-b px-3 py-2 sticky top-0 bg-background z-10">
            <Button variant="ghost" size="icon-sm" className="-my-1" onClick={togglePreview}>
              <ArrowLeft className="size-4" />
            </Button>
            {previewProgress && previewProgress.phase !== "done" && previewProgress.phase !== "error" && (
              <span className="text-xs text-muted-foreground">
                {previewProgress.current}/{previewProgress.total}
              </span>
            )}
            {previewArticles.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="-my-1 ml-auto" title="Table of contents">
                    <List className="size-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 max-h-80 overflow-y-auto p-2">
                  <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Table of contents</p>
                  {previewArticles.map((article, i) => (
                    <div key={i}>
                      <button
                        className="w-full text-left rounded px-2 py-1.5 text-sm hover:bg-muted truncate"
                        onClick={() => {
                          const el = document.getElementById(`preview-article-${i}-0`);
                          el?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                      >
                        {article.chapters[0]?.title ?? article.title}
                      </button>
                      {article.chapters.slice(1).map((ch, j) => (
                        <button
                          key={j}
                          className="w-full text-left rounded pl-6 pr-2 py-1 text-xs text-muted-foreground hover:bg-muted truncate"
                          onClick={() => {
                            const el = document.getElementById(`preview-article-${i}-${j + 1}`);
                            el?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                        >
                          {ch.title}
                        </button>
                      ))}
                    </div>
                  ))}
                </PopoverContent>
              </Popover>
            )}
          </div>
          <div className="epub-preview p-4">
            {previewArticles.map((article, i) => (
              <div key={i} className="mb-8 pb-8 border-b last:border-b-0">
                {article.chapters.map((ch, j) => (
                  <section
                    key={j}
                    id={`preview-article-${i}-${j}`}
                    className={`scroll-mt-12 ${j > 0 ? "mt-6" : ""}`}
                  >
                    <h2 className="font-sans text-lg font-semibold mb-2">{ch.title}</h2>
                    <div dangerouslySetInnerHTML={{ __html: ch.html }} />
                  </section>
                ))}
              </div>
            ))}
            {previewProgress?.phase === "error" && (
              <p className="text-sm text-destructive">{previewProgress.message}</p>
            )}
          </div>
        </div>
      ) : (
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
      )}

      <div className="shrink-0 space-y-2">
        <div className="flex gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon">
                <Settings className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64">
              <div className="space-y-4">
                <p className="text-sm font-medium">Settings</p>

                {/* Comments section */}
                <div className="space-y-3">
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
                  {settings.includeComments && (
                    <div className="space-y-3 pl-6">
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Label className="text-xs text-muted-foreground">Max comment depth</Label>
                          <span className="text-xs tabular-nums">{sliderLabel(settings.maxCommentDepth, SLIDER_CONFIGS.maxCommentDepth.unlimited)}</span>
                        </div>
                        <Slider
                          min={SLIDER_CONFIGS.maxCommentDepth.min}
                          max={SLIDER_CONFIGS.maxCommentDepth.unlimited}
                          step={1}
                          value={[settings.maxCommentDepth]}
                          onValueChange={([v]) => {
                            const next = { ...settings, maxCommentDepth: v };
                            setSettings(next);
                            saveSettings(next);
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Label className="text-xs text-muted-foreground">Max top-level comments</Label>
                          <span className="text-xs tabular-nums">{sliderLabel(settings.maxTopLevelComments, SLIDER_CONFIGS.maxTopLevelComments.unlimited)}</span>
                        </div>
                        <Slider
                          min={SLIDER_CONFIGS.maxTopLevelComments.min}
                          max={SLIDER_CONFIGS.maxTopLevelComments.unlimited}
                          step={1}
                          value={[settings.maxTopLevelComments]}
                          onValueChange={([v]) => {
                            const next = { ...settings, maxTopLevelComments: v };
                            setSettings(next);
                            saveSettings(next);
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Label className="text-xs text-muted-foreground">Max comments per story</Label>
                          <span className="text-xs tabular-nums">{sliderLabel(settings.maxCommentsPerStory, SLIDER_CONFIGS.maxCommentsPerStory.unlimited)}</span>
                        </div>
                        <Slider
                          min={SLIDER_CONFIGS.maxCommentsPerStory.min}
                          max={SLIDER_CONFIGS.maxCommentsPerStory.unlimited}
                          step={1}
                          value={[settings.maxCommentsPerStory]}
                          onValueChange={([v]) => {
                            const next = { ...settings, maxCommentsPerStory: v };
                            setSettings(next);
                            saveSettings(next);
                          }}
                        />
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={settings.includeQrCode}
                          onCheckedChange={(checked) => {
                            const next = { ...settings, includeQrCode: !!checked };
                            setSettings(next);
                            saveSettings(next);
                          }}
                        />
                        <Label className="text-xs text-muted-foreground cursor-pointer">QR code to discussion</Label>
                      </label>
                    </div>
                  )}
                </div>

                {/* Export section */}
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
              `Generate EPUB (${selectedIds.size} items)`
            )}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={togglePreview}
            disabled={selectedIds.size === 0 || isGenerating}
            title={isPreviewing ? "Close preview" : "Preview"}
          >
            <Eye className={`size-4 ${isPreviewing ? "text-primary" : ""}`} />
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
