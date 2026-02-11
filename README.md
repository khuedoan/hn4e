# HN4E - Hacker News for E-readers

HN4E generates offline archives of popular Hacker News articles,
packaged into EPUB files optimized for E Ink readers.

## Features

![Screenshot](https://github.com/user-attachments/assets/bdb181f0-5c41-4566-91fc-e8006fb1b6af)

- Browse popular Hacker News stories with configurable time range and count
- Select which stories to include in the archive
- Extract full article content from linked URLs
- Include threaded comments (optional)
- Download as EPUB for offline reading on e-readers
- Fast as fuck

Generated output:

| Chapters | Content | Comments |
| -- | -- | -- |
| <img width="480" height="800" alt="image" src="https://github.com/user-attachments/assets/50d564d7-281b-4153-91d9-e013f49c684d" /> | <img width="480" height="800" alt="image" src="https://github.com/user-attachments/assets/8efd4859-084a-4164-9b72-688367dee1f8" /> | <img width="480" height="800" alt="image" src="https://github.com/user-attachments/assets/10eaa0ea-b2d9-4273-9f53-d6272ed15957" /> |

## Usage

1. Open the web app.
2. Select the stories you want.
3. Generate and download the EPUB.
4. Copy the file to your device.

## Development

Start development server:

```sh
make dev
```

Run tests:

```sh
make test
```
