# Data sources reference

Hacker News for E-readers uses the official Hacker News Firebase API for story discovery, story metadata, and comment trees. Article content is fetched directly from source URLs.

## Hacker News Firebase API

Base URL: `https://hacker-news.firebaseio.com/v0`

### Story discovery

Stories are discovered from HN's native ranked feeds:

```
GET /topstories.json
GET /beststories.json
```

The frontend lets the user choose Top or Best. The server fetches IDs from the selected feed, loads item details in feed order, filters out deleted/dead/non-story items, applies the selected age cutoff locally, and stops after the requested count.

The age filter is a local cutoff over the current HN feed. It is not an all-time historical search.

### API response fields

Each feed item is loaded from:

```
GET /item/{storyId}.json
```

Story fields used from Firebase items:

| Field | Type | Description |
|---|---|---|
| `id` | integer | Story ID |
| `title` | string | Story title |
| `url` | string | Article URL (missing for Ask HN, Show HN text posts) |
| `score` | integer | Upvote count |
| `descendants` | integer | Total comment count |
| `by` | string | Submitter username |
| `time` | integer | Unix creation timestamp |
| `kids` | array | Top-level comment IDs |
| `type` | string | Item type; only `story` is used |

When `url` is missing, the story URL falls back to the HN discussion page.

### Comment trees

Firebase items expose comment trees as ID references through `kids`. When generating or previewing an archive, the server walks those IDs recursively and fetches each comment with `GET /item/{commentId}.json`.

| Field | Type | Description |
|---|---|---|
| `id` | integer | Comment ID |
| `by` | string | Username |
| `text` | string | Comment HTML |
| `time` | integer | Unix creation timestamp |
| `type` | string | Item type ("comment", "pollopt", etc.) |
| `kids` | array | Reply comment IDs |
| `deleted` | boolean | Deleted item marker |
| `dead` | boolean | Dead item marker |

The comment tree is flattened into a depth-annotated list via pre-order traversal. Deleted, dead, missing, and non-comment items are skipped.

## Article extraction

For each story URL, the server fetches the HTML and extracts the main content using Mozilla's Readability library (equivalent to Firefox Reader View).

### Extraction constraints

| Constraint | Value |
|---|---|
| Fetch timeout | 15 seconds |
| Max response size | 5 MB |
| Concurrency | 10 parallel extractions |

### Fallback behavior

| Condition | Fallback |
|---|---|
| URL fetch fails (timeout, DNS error) | Include title and URL only |
| Non-HTML content type | Include title and URL only |
| Response too large | Include title and URL only |
| Readability parse fails | Include title and URL only |
| HN self-post (no external URL) | Include title and URL only |
