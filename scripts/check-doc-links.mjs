#!/usr/bin/env node
// 检查 README.md、docs/*.md 与仓库里所有 AGENTS.md 中的相对链接：目标文件存在，锚点能对上目标文件的某个标题。
// 用法：node scripts/check-doc-links.mjs [仓库根目录]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
// .claude 下的 worktree 是整份仓库的副本，.turbo 是任务缓存，都不属于本仓库的文档。
const SKIP_DIRS = new Set(["node_modules", ".git", ".claude", ".turbo", ".data", "dist", "out", "release"]);

function agentsFiles(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : agentsFiles(rel);
    return e.name === "AGENTS.md" ? [rel] : [];
  });
}

const files = [
  ...new Set([
    "README.md",
    ...readdirSync(join(root, "docs"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => `docs/${f}`),
    ...agentsFiles(""),
  ]),
].filter((f) => existsSync(join(root, f)));

// 按 GitHub 的规则把标题转成锚点：小写，删掉字母、数字、空格、连字符、下划线以外的字符，空格换成连字符；重名依次加 -1、-2。
function anchorsOf(text) {
  const anchors = new Set();
  const seen = new Map();
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    const m = !inFence && /^#{1,6}\s+(.*)$/.exec(line);
    if (!m) continue;
    const base = m[1].trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

const cache = new Map();
const anchorsFor = (abs) => {
  if (!cache.has(abs)) cache.set(abs, anchorsOf(readFileSync(abs, "utf8")));
  return cache.get(abs);
};

// 格式错误的 % 编码当作失效链接上报，而不是让脚本崩溃。
const decode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

const problems = [];
for (const file of files) {
  const abs = join(root, file);
  const text = readFileSync(abs, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const [, href] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:/i.test(href)) continue; // http(s)、mailto 等外部链接不查
    const [path, anchor] = href.split("#");
    const target = path ? join(dirname(abs), path) : abs;
    if (!existsSync(target)) {
      problems.push(`${file}: 找不到文件 ${href}`);
    } else if (anchor && target.endsWith(".md") && !anchorsFor(target).has(decode(anchor))) {
      problems.push(`${file}: ${relative(root, target)} 里没有锚点 #${anchor}`);
    }
  }
}

for (const p of problems) console.error(p);
console.log(problems.length === 0 ? `链接检查通过（${files.length} 个文件）` : `发现 ${problems.length} 处失效链接`);
process.exit(problems.length === 0 ? 0 : 1);
