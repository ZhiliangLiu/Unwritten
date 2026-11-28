#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON_PROJECTS = ['selfhost/colab', 'plugins/comfyui', 'selfhost/strata', 'plugins/colab-launcher'];

const filesByProject = new Map(PYTHON_PROJECTS.map((project) => [project, []]));
const filesOutside = [];
for (const file of process.argv.slice(2)) {
  const absolutePath = resolve(repoRoot, file);
  const project = PYTHON_PROJECTS.find((candidate) => {
    const path = relative(join(repoRoot, candidate), absolutePath);
    return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
  });
  if (project) filesByProject.get(project).push(relative(join(repoRoot, project), absolutePath));
  else filesOutside.push(file);
}

if (filesOutside.length > 0) {
  for (const file of filesOutside) console.error(`不在 Python 工具链目录里的文件：${file}`);
  process.exit(1);
}

for (const [project, files] of filesByProject) {
  if (files.length === 0) continue;
  for (const command of [
    ['ruff', 'check', '--fix'],
    ['ruff', 'format'],
  ]) {
    const result = spawnSync('uv', ['run', '--frozen', '--directory', project, ...command, ...files], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    if (result.error) {
      console.error(`运行 uv 失败：${result.error.message}`);
      process.exit(1);
    }
    if (result.status !== 0) process.exit(result.status);
  }
}
