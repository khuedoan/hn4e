# API reference

The backend exposes an HTTP API for archive generation.

## Endpoints

### GET /api/generate

Starts archive generation and streams progress via Server-Sent Events (SSE).

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `count` | integer | 100 | Number of stories to include (1-300) |

**SSE events:**

Each event has `event: progress` and a JSON `data` payload:

```json
{
  "phase": "extracting",
  "current": 45,
  "total": 100,
  "message": "Extracted 45/100 articles..."
}
```

**Phases:**

| Phase | Description |
|---|---|
| `fetching` | Querying HN Algolia API for popular stories |
| `extracting` | Extracting article content from URLs |
| `generating` | Building the EPUB file |
| `done` | Generation complete; `message` contains the download token |
| `error` | Generation failed; `message` contains the error description |

### GET /api/download/:token

Download a generated EPUB file.

**Response (200 OK):**

Binary EPUB file with `Content-Type: application/epub+zip`.

**Response (404 Not Found):**

```json
{
  "error": "Download not found or expired"
}
```

Download tokens expire after 5 minutes.
