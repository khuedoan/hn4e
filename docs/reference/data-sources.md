# Data sources reference

Hacker News for E-readers uses the HN Search API (powered by Algolia) for story discovery, and fetches article content directly from source URLs.

## HN Search API (Algolia)

Base URL: `https://hn.algolia.com/api/v1`

### Story discovery

**Popular stories (last 24 hours):**

```
GET /search?tags=story&hitsPerPage={hitsPerPage}&page={page}&numericFilters=created_at_i>{startTimestamp}
```

Returns stories created within the last 24 hours. The Algolia index uses `customRanking: ['desc(points)', 'desc(num_comments)']`, so results are ranked by points and comment count by default.

Pagination uses 50 hits per page. Multiple requests are made when the requested count exceeds 50.

### API response fields

Story fields used:

| Field | Type | Description |
|---|---|---|
| `objectID` | string | Story ID |
| `title` | string | Story title |
| `url` | string | Article URL (null for Ask HN, Show HN text posts) |
| `points` | integer | Upvote count |
| `num_comments` | integer | Total comment count |
| `author` | string | Submitter username |
| `created_at` | string | ISO 8601 creation timestamp |

When `url` is null (Ask HN, Show HN), the story URL falls back to the HN discussion page.

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
