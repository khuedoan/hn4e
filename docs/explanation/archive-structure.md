# Archive structure

This document explains how HN4E organizes content within a generated EPUB file and the reasoning behind the structure.

## Design goals

The archive structure is designed for two constraints:

1. E Ink devices have slow page turns and limited navigation compared to phones or tablets. Jumping to a specific story should be fast and predictable.
2. The reading experience should be self-contained. The archive should work completely offline with no network access.
3. The styling should gracefully degrade and remain readable even if the device ignores CSS styles.

## Book-level organization

Every archive is a flat list of story chapters (one per story), each containing:

- A metadata block with the URL, points, and a link to the HN discussion.
- The extracted article content (reader view), or a fallback message if extraction failed.
- The full comment tree from the HN discussion, rendered with visual indentation for nesting.

## Chapter navigation

The EPUB table of contents lists one entry per story. Story titles in the TOC include point counts (e.g., "Show HN: Something (142 points)") so readers can gauge interest from the chapter list.

## Chapter title format

Each story chapter title follows the format:

```
{title} (X points)
```

## Comment rendering

Comments appear after the article content within the same chapter, separated by a horizontal rule and a "N Comments" heading

```
N comments
```

Each comment shows the author name followed by the comment text:

```
user1
Lorem ipsum dolor sit amet, consectetur adipiscing elit.
  | user2
  | Nullam pellentesque consectetur ligula ac fermentum.
  |   | user4
  |   | Mauris fermentum orci ut commodo mattis.
  | user2
  | Vivamus aliquam egestas massa, ut suscipit diam fringilla ut.
```

Nested replies are wrapped in containers with a left border and indent at each depth level. The border runs continuously through all children of a thread, so the visual nesting guide persists even across long comment chains. Indentation is capped at depth 5 to keep deeply nested threads readable on narrow e-reader screens.

Deleted or dead comments (null author or text) are skipped, but their child replies are preserved at the original depth.
