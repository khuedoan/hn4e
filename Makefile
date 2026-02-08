.POSIX:
.PHONY: default dev test

default: dev

dev:
	bun install
	bun run dev

test:
	bun test
