# Archive structure

This document explains how HNE organizes content within a generated EPUB file and the reasoning behind the structure.

## Design goals

The digest structure is designed for two constraints:

1. E Ink devices have slow page turns and limited navigation compared to phones or tablets. Jumping to a specific story should be fast and predictable.
2. The reading experience should be self-contained. The digest should work completely offline with no network access.

## Book-level organization

Every digest is a flat list of story chapters (one per story), each containing:

- A metadata block with the URL, points, and a link to the HN discussion.
- The extracted article content (reader view), or a fallback message if extraction failed.

## Chapter navigation

The EPUB table of contents lists one entry per story. Story titles in the TOC include point counts (e.g., "Show HN: Something (142 points)") so readers can gauge interest from the chapter list.

## Chapter title format

Each story chapter title follows the format:

```
{title} (X points)
```
