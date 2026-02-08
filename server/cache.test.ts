import { describe, test, expect } from "bun:test";
import { Cache } from "./cache.ts";

describe("Cache", () => {
  test("returns undefined for missing keys", () => {
    const cache = new Cache<string>(60_000, 10);
    expect(cache.get("missing")).toBeUndefined();
  });

  test("stores and retrieves values", () => {
    const cache = new Cache<string>(60_000, 10);
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");
  });

  test("has() returns true for existing keys and false for missing", () => {
    const cache = new Cache<string>(60_000, 10);
    cache.set("a", "1");
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  test("reports correct size", () => {
    const cache = new Cache<string>(60_000, 10);
    expect(cache.size).toBe(0);
    cache.set("a", "1");
    cache.set("b", "2");
    expect(cache.size).toBe(2);
  });

  test("expired entries return undefined", async () => {
    const cache = new Cache<string>(50, 10);
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");

    await new Promise((r) => setTimeout(r, 100));
    expect(cache.get("key")).toBeUndefined();
  });

  test("expired entries are removed from size count on access", async () => {
    const cache = new Cache<string>(50, 10);
    cache.set("key", "value");
    expect(cache.size).toBe(1);

    await new Promise((r) => setTimeout(r, 100));
    cache.get("key");
    expect(cache.size).toBe(0);
  });

  test("evicts oldest entry when maxEntries is exceeded", () => {
    const cache = new Cache<string>(60_000, 3);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    expect(cache.size).toBe(3);

    // Adding a 4th entry should evict "a" (oldest)
    cache.set("d", "4");
    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
    expect(cache.get("d")).toBe("4");
  });

  test("re-setting a key refreshes its position in eviction order", () => {
    const cache = new Cache<string>(60_000, 3);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");

    // Re-set "a" so it moves to the end; "b" is now the oldest
    cache.set("a", "updated");

    cache.set("d", "4");
    expect(cache.get("a")).toBe("updated");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe("3");
    expect(cache.get("d")).toBe("4");
  });

  test("works with maxEntries of 1", () => {
    const cache = new Cache<number>(60_000, 1);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);

    cache.set("b", 2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.size).toBe(1);
  });
});
