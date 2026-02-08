# Architecture

Hacker News for E-readers is a web application that fetches Hacker News content, extracts article text, and produces an EPUB file for download. This document explains the system design and the reasoning behind it.

## System components

The system has two components:

**Frontend** is a React single-page application built with Vite. It provides a generate button and shows generation progress via SSE. It is a static build served by the backend in production.

**API backend** is a Hono server running on Bun. It handles generation requests synchronously: fetching stories, extracting articles, and building the EPUB in a single request/response cycle. Progress is streamed to the client via Server-Sent Events. The generated EPUB is held in memory with a 5-minute expiry and downloaded via a token-based endpoint.

## Request lifecycle

1. The frontend opens an SSE connection to `GET /api/generate`.
2. The server fetches popular stories from the HN Algolia API.
3. For each story, the server fetches the article URL and extracts content using Readability.
4. The server generates an EPUB file with one chapter per story.
5. The EPUB is stored in memory with a unique token. The token is sent to the client as the final SSE event.
6. The frontend uses the token to download the file via `GET /api/download/:token`.
7. The in-memory buffer is deleted after download or after 5 minutes, whichever comes first.

## Why this stack

**React + Vite** because the frontend is straightforward (a button, progress display, download link) and these are well-understood tools. No server-side rendering is needed.

**Hono on Bun** for the backend because it is lightweight and supports SSE streaming. Bun provides fast startup and native TypeScript execution.

**Bun runtime** because the readability extraction toolchain (`@mozilla/readability` + `jsdom`) is a mature Node-compatible library. Keeping the backend in the same language as the extraction pipeline simplifies the codebase.

## Current limitations

- Generation is synchronous and in-process. Only one generation can run per request, and the server blocks during the pipeline.
- Generated files are held in memory. The server's memory usage scales with the number of concurrent generations.
- No caching. Every generation fetches stories and articles from scratch.
- No persistent storage. If the server restarts, pending downloads are lost.

These limitations are acceptable for personal use and will be addressed in future versions.
