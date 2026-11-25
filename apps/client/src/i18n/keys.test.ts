import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@unwritten/contracts";

const root = fileURLToPath(new URL("..", import.meta.url));
const i18nDir = join(root, "i18n");
const zhDir = join(i18nDir, "zh-CN");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function flatten(value: Record<string, unknown>, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") result.set(full, child);
    else if (child && typeof child === "object") {
      for (const [nested, text] of flatten(child as Record<string, unknown>, full)) result.set(nested, text);
    }
  }
  return result;
}

function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(zhDir, `${name}.json`), "utf8")) as Record<string, unknown>;
}

const sourceFiles = walk(join(root))
  .filter((file) => /\.(ts|tsx)$/.test(file))
  .filter((file) => !/\.test\./.test(file) && !file.startsWith(i18nDir) && !file.endsWith("routeTree.gen.ts"));

const used = new Set<string>();
const keyPattern = /\bt\(\s*["'`]([a-z]+):([A-Za-z0-9_.-]+)["'`]/g;
const jsxKeyPattern = /i18nKey=["']([a-z]+):([A-Za-z0-9_.-]+)["']/g;
for (const file of sourceFiles) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(keyPattern)) used.add(`${match[1]}:${match[2]}`);
  for (const match of text.matchAll(jsxKeyPattern)) used.add(`${match[1]}:${match[2]}`);
}

const namespaces = ["common", "errors", "library", "authoring", "play", "settings"] as const;
const resources = new Map(namespaces.map((name) => [name, flatten(load(name))]));

function hasKey(full: string): boolean {
  const [namespace, key] = full.split(":");
  if (!namespace || !key) return false;
  return (resources.get(namespace as (typeof namespaces)[number])?.get(key) ?? "").length > 0;
}

describe("i18n keys", () => {
  it("源码里用到的键都存在", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
    const missing = [...used].filter((key) => !hasKey(key));
    expect(missing).toEqual([]);
  });

  it("errors 与 ERROR_CODES 一一对应", () => {
    expect(new Set(Object.keys(load("errors")))).toEqual(new Set([...ERROR_CODES, "unknown"]));
  });

  it("所有叶子都是非空字符串", () => {
    for (const [namespace, map] of resources) {
      for (const [key, value] of map) expect(value, `${namespace}:${key}`).not.toBe("");
    }
  });

  it("列出未使用的键，但不让测试失败", () => {
    const unused: string[] = [];
    for (const [namespace, map] of resources) {
      if (namespace === "errors") continue;
      for (const key of map.keys()) if (!used.has(`${namespace}:${key}`)) unused.push(`${namespace}:${key}`);
    }
    if (unused.length) process.stdout.write(`未使用的文案键：${unused.join(", ")}\n`);
    expect(true).toBe(true);
  });
});
