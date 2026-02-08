import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { BookOpen, Download, Loader2 } from "lucide-react";

interface GenerationProgress {
  phase: "fetching" | "extracting" | "generating" | "done" | "error";
  current: number;
  total: number;
  message: string;
}

function App() {
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [downloadToken, setDownloadToken] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = useCallback(() => {
    setIsGenerating(true);
    setProgress(null);
    setDownloadToken(null);

    const eventSource = new EventSource("/api/generate");

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
  }, []);

  const progressPercent = progress
    ? progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0
    : 0;

  const phaseLabel = progress
    ? {
        fetching: "Fetching stories",
        extracting: "Extracting articles",
        generating: "Generating EPUB",
        done: "Done",
        error: "Error",
      }[progress.phase]
    : null;

  return (
    <div className="flex min-h-svh flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md">
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
          {!isGenerating && !downloadToken && (
            <Button className="w-full" size="lg" onClick={generate}>
              Generate EPUB
            </Button>
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
                onClick={() => {
                  setDownloadToken(null);
                  setProgress(null);
                }}
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
