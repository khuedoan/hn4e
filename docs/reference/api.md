# API reference

The backend exposes an HTTP API for archive generation.

## Endpoints

### GET /api/stories

Returns stories for the selection list.

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `feed` | `top` or `best` | `top` | HN Firebase feed to read from |
| `count` | integer | 100 | Number of stories to return; allowed values are 50, 100, 150, 200 |
| `timeRange` | integer | 86400 | Maximum story age in seconds; allowed values are 86400, 172800, 604800, 2592000, 31536000 |

Invalid values fall back to defaults.

### GET /api/generate

Starts archive generation and streams progress via Server-Sent Events (SSE).

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `ids` | comma-separated story IDs | required | Selected HN story IDs |
| `comments` | boolean | true | Set to `false` to omit comments |
| `maxCommentDepth` | integer | -1 | Maximum comment nesting depth; -1 means unlimited |
| `maxTopLevelComments` | integer | -1 | Maximum top-level comment threads per story; -1 means unlimited |
| `maxCommentsPerStory` | integer | -1 | Maximum total comments per story; -1 means unlimited |
| `qrCode` | boolean | true | Set to `false` to omit discussion QR codes |

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
| `extracting` | Loading selected HN stories, fetching comment trees, and extracting article content from URLs |
| `generating` | Building the EPUB file |
| `done` | Generation complete; `message` contains the download token |
| `error` | Generation failed; `message` contains the error description |

### GET /api/preview

Streams rendered article preview chapters via Server-Sent Events without generating an EPUB.

It accepts the same query parameters as `GET /api/generate`.

The endpoint emits `article` events with rendered chapter HTML and `progress` events with the same progress shape as generation.

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
