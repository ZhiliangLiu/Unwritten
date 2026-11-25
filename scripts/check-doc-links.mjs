#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const NON_REPO_CONTENT_DIRS = new Set(["node_modules", ".git", ".claude", ".turbo", ".data", "dist", "out", "release"]);
const EXTERNAL_LINK = /^[a-z]+:/i;
const FENCED_CODE_BLOCK = /```[\s\S]*?```/g;
const INLINE_CODE = /(`+)[^\n]*?\1/g;
const MARKDOWN_LINK_TARGET = /\]\(([^)\s]+)\)/g;

function findAgentsFiles(dir) {
  return readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return NON_REPO_CONTENT_DIRS.has(entry.name) ? [] : findAgentsFiles(path);
    return entry.name === "AGENTS.md" ? [path] : [];
  });
}

function markdownIn(dir) {
  const path = join(repoRoot, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path).filter((name) => name.endsWith(".md")).map((name) => `${dir}/${name}`);
}

const markdownFiles = [
  ...new Set([
    "README.md",
    ...markdownIn("docs"),
    ...markdownIn("tasks"),
    ...findAgentsFiles(""),
  ]),
].filter((path) => existsSync(join(repoRoot, path)));

function githubHeadingAnchors(markdown) {
  const anchors = new Set();
  const timesSeen = new Map();
  let insideFence = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) insideFence = !insideFence;
    const heading = !insideFence && /^#{1,6}\s+(.*)$/.exec(line);
    if (!heading) continue;
    const slug = heading[1].trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
    const duplicateIndex = timesSeen.get(slug) ?? 0;
    timesSeen.set(slug, duplicateIndex + 1);
    anchors.add(duplicateIndex === 0 ? slug : `${slug}-${duplicateIndex}`);
  }
  return anchors;
}

const anchorsByFile = new Map();
function anchorsOfFile(absolutePath) {
  if (!anchorsByFile.has(absolutePath)) {
    anchorsByFile.set(absolutePath, githubHeadingAnchors(readFileSync(absolutePath, "utf8")));
  }
  return anchorsByFile.get(absolutePath);
}

function decodeAnchorOrNull(anchor) {
  try {
    return decodeURIComponent(anchor);
  } catch {
    return null;
  }
}

const brokenLinks = [];
for (const file of markdownFiles) {
  const absolutePath = join(repoRoot, file);
  const textOutsideCodeBlocks = readFileSync(absolutePath, "utf8").replace(FENCED_CODE_BLOCK, "").replace(INLINE_CODE, "");
  for (const [, href] of textOutsideCodeBlocks.matchAll(MARKDOWN_LINK_TARGET)) {
    if (EXTERNAL_LINK.test(href)) continue;
    const [path, anchor] = href.split("#");
    const target = path ? join(dirname(absolutePath), path) : absolutePath;
    if (!existsSync(target)) {
      brokenLinks.push(`${file}: 找不到文件 ${href}`);
    } else if (anchor && target.endsWith(".md") && !anchorsOfFile(target).has(decodeAnchorOrNull(anchor))) {
      brokenLinks.push(`${file}: ${relative(repoRoot, target)} 里没有锚点 #${anchor}`);
    }
  }
}

for (const message of brokenLinks) console.error(message);
console.log(
  brokenLinks.length === 0 ? `链接检查通过（${markdownFiles.length} 个文件）` : `发现 ${brokenLinks.length} 处失效链接`,
);
process.exit(brokenLinks.length === 0 ? 0 : 1);
