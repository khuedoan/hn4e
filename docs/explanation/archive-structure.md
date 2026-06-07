# Archive structure

This document explains how HN4E organizes content within a generated EPUB file and the reasoning behind the structure.

## Design goals

The archive structure is designed for two constraints:

1. E Ink devices have slow page turns and limited navigation compared to phones or tablets. Jumping to a specific story should be fast and predictable.
2. The reading experience should be self-contained. The archive should work completely offline with no network access.
3. The styling should gracefully degrade and remain readable even if the device ignores CSS styles.

## Book-level organization

Every archive is organized as one story chapter per selected HN story, followed by a nested comments chapter for that story.

Story chapters contain:

- A metadata block with the source URL.
- The extracted article content (reader view), or a fallback message if extraction failed.

Comments chapters contain:

- A QR code linking to the HN discussion, when enabled.
- The selected comment tree from the HN discussion, rendered with visual indentation for nesting.

## Chapter navigation

The EPUB table of contents lists one entry per story. Each story entry nests a comments entry titled with the story's point and comment counts.

## Chapter title format

Each story chapter uses the HN story title:

```
{title}
```

Each comments chapter follows the format:

```
{points} points, {commentCount} comments
```

## Comment rendering

Comments appear in the nested comments chapter.

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

Deleted, dead, missing, and non-comment items are skipped.
