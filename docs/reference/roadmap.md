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
- [x] feat(ui): simple web form for digest configuration
- [x] feat: optional max story count
- [ ] feat: toggle comments
- [ ] feat: support frontpage and popular selection
- [ ] feat: include condition for stories
- [ ] feat: include condition for comments

## v0.3.0

UX and performance improvements.

- [ ] perf: caching for article content
- [ ] perf: caching for comments

## v0.4.0

Support XTCH format for Xteink devices.

- [ ] feat(ui): output format selection
- [ ] feat(xtch): initial rendering pipeline
- [ ] feat(ui): support XTCH output

## vX.X.X

TBD.
