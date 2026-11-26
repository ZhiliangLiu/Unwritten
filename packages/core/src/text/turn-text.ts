import type { StoredOption } from '../store/meta.ts';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };
export type JsonLine = { line: number; value: unknown };

export function normalizeProse(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function splitParagraphs(prose: string): string[] {
  return normalizeProse(prose)
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.length > 0);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expandArrayLine(raw: string): string[] {
  if (!raw.trim().startsWith('[')) return [raw];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.map((item) => JSON.stringify(item)) : [raw];
  } catch {
    return [raw];
  }
}

export function parseJsonLines(text: string, label: string): ParseResult<JsonLine[]> {
  const result: JsonLine[] = [];
  const errors: string[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n').flatMap(expandArrayLine);
  lines.forEach((raw, index) => {
    if (!raw.trim()) return;
    const line = index + 1;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      errors.push(`第 ${line} 行 ${label}：不是合法的 JSON`);
      return;
    }
    if (!isObject(value)) {
      errors.push(`第 ${line} 行 ${label}：必须是对象`);
      return;
    }
    result.push({ line, value });
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: result };
}

export function parseOptionLines(
  text: string,
  limits: { min: number; max: number; textMax: number },
): ParseResult<StoredOption[]> {
  const parsed = parseJsonLines(text, 'options');
  if (!parsed.ok) return parsed;
  const errors: string[] = [];
  const options: StoredOption[] = [];
  for (const { line, value } of parsed.value) {
    const option = value as Record<string, unknown>;
    if ('hint' in option) errors.push(`第 ${line} 行 options：本作品不接受 hint`);
    if (typeof option.text !== 'string') {
      errors.push(`第 ${line} 行 options.text：必须是字符串`);
      continue;
    }
    const optionText = option.text.trim();
    if (!optionText) {
      errors.push(`第 ${line} 行 options.text：不能为空`);
      continue;
    }
    if (optionText.length > limits.textMax) {
      errors.push(`第 ${line} 行 options.text：不能超过 ${limits.textMax} 个字符`);
      continue;
    }
    options.push({ text: optionText });
  }
  if (options.length < limits.min || options.length > limits.max) {
    errors.push(`options：条数必须在 ${limits.min} 到 ${limits.max} 之间`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: options };
}
