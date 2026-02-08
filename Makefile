.POSIX:
.PHONY: default dev test

default: dev

dev:
	bun run dev

test:
	bun test
