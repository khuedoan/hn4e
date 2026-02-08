# Roadmap

## v0.1.0

Basic end-to-end pipeline that fetches popular HN stories, extracts article
content, and produces a downloadable EPUB file.

- [x] feat(ui): basic layout
- [x] feat: fetch popular stories from the HN Algolia API
- [x] feat: extract article content
- [x] feat: generate an EPUB 3 with chapter-per-story structure

Chapter structure:

```markdown
- First story (X points)
- Second story (X points)
```

## v0.2.0

Add Hacker News comment threads to each story chapter.

- [ ] refactor: move content to sub chapter to prepare for comments
- [ ] feat: fetch full comment trees as subchapter
- [ ] feat: render nested comments with indentation after article

New chapter structure:

```markdown
- First story (X points)
    - Y Comments
- Second story (X points)
    - Y Comments
```

## v0.3.0

Add user-configurable options.

- [ ] feat(ui): simple web form for digest configuration
- [ ] feat: support frontpage and popular selection
- [ ] feat: configurable time range for popular source
- [ ] feat: include condition for stories
- [ ] feat: optional max story count (1-200)
- [ ] feat: toggle comments
- [ ] feat: include condition for comments

## v0.4.0

Support XTCH format for Xteink devices.

- [ ] feat(ui): output format selection
- [ ] feat(xtch): initial rendering pipeline
- [ ] feat(ui): support XTCH output

## v0.5.0

UX and performance improvements.

- [ ] perf: caching for article content
- [ ] perf: caching for comments
- [ ] feat: add option to generate index chapter.

## vX.X.X

TBD.
