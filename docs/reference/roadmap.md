# Roadmap

## v0.1.0

Basic end-to-end pipeline that fetches popular HN stories, extracts article
content and comments, and produces a downloadable EPUB file.

- [x] feat(ui): basic layout
- [x] feat: fetch popular stories from the HN Algolia API
- [x] feat: extract article content
- [x] feat: generate EPUB with one chapter per story
- [x] feat: filter articles to export
- [x] feat: fetch full comment trees as subchapter
- [x] feat: render nested comments with indentation after article

## v0.2.0

Add user-configurable options.

- [x] feat: configurable time range for popular source
- [x] feat: configurable max story count
- [x] feat(ui): better progress display
- [x] feat: settings for comments and output format

## v0.3.0

UX and performance improvements.

- [x] perf: caching for feed
- [x] perf: caching for article content
- [x] perf: caching for comments

## v0.4.0

- [x] feat: comment filtering
- [x] feat: preview before export
- [ ] feat: add QR code to Hacker News discussion

## Backlog

- [ ] feat: support XTCH format for Xteink devices
