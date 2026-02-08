# HNE

Read Hacker News articles and comments on any E Ink devices.

## Usage

- Choose source:
    - Frontpage
    - Popular:
        - Time range (24h, 1 week, custom)
    - Max stories: default 300 (~10 pages)
- Include comments:
    - Enable: true/false
    - Max top level comments: default 20
    - Max nested comment depth: default 5
    - Max total comments per story: default 200
- Select format:
   - EPUB
   - XTCH for Xteink devices (fast page turns and consistent layout but larger file size)
- Download
- Copy the `.epub` (or `.xtch`) file to your devices using your preferred method (wirelessly, SD card, etc.)

## Development

Start development server:

```sh
make dev
```
