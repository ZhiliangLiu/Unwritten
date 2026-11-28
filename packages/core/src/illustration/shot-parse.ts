export type ShotLabel = 'PROMPT' | 'NEGATIVE' | 'CAPTION' | 'REFS' | 'ASPECT';

export type ParsedShot = { ok: true; fields: Partial<Record<ShotLabel, string>> } | { ok: false; errors: string[] };

export const SHOT_ERRORS = {
  format: '每个字段单独占一行，使用规定的英文标签、冒号和空格。',
  duplicate: '每个标签只写一次。',
  emptyPrompt: '请在 PROMPT 写一行非空的英文画面提示。',
  emptyCaption: '请在 CAPTION 写一行非空的画面说明。',
  captionTooLong: 'CAPTION 最多 200 字，只写一行。',
  invalidReference: 'REFS 只填在场人物可用的编号和视角，按画面主次排列，每个人只出现一次。',
  tooManyReferences: 'REFS 超过本次可用的参考图数量，请减少。',
  referenceOutOfRange: 'PROMPT 里的参考序号必须从 1 起，且对应 REFS 里的某一项。',
  invalidAspect: '请在 ASPECT 填一个给定的比例。',
  bannedName: '从英文提示词中删去人物真名，改用可见外貌或对应参考。',
  captionLeak: 'CAPTION 只用这一段主角已经知道的称呼，去掉后来才揭晓的内容。',
} as const;

const SHOT_LINE = /^(PROMPT|NEGATIVE|CAPTION|REFS|ASPECT):(?: (.*))?$/u;
const FENCE_OPEN = /^```[\w-]*$/u;
const FENCE_CLOSE = '```';

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlank(lines[start] ?? '')) start += 1;
  while (end > start && isBlank(lines[end - 1] ?? '')) end -= 1;
  return lines.slice(start, end);
}

function pushError(errors: string[], message: string): void {
  if (!errors.includes(message)) errors.push(message);
}

export function parseShotText(text: string): ParsedShot {
  let lines = trimBlankLines(text.split(/\r?\n/u));
  const first = lines[0]?.trim() ?? '';
  const last = lines.at(-1)?.trim() ?? '';
  if (lines.length >= 2 && FENCE_OPEN.test(first) && last === FENCE_CLOSE) {
    lines = trimBlankLines(lines.slice(1, -1));
  }

  const fields: Partial<Record<ShotLabel, string>> = {};
  const seen = new Set<ShotLabel>();
  const errors: string[] = [];

  for (const line of lines) {
    if (isBlank(line)) continue;
    const match = SHOT_LINE.exec(line);
    if (!match) {
      pushError(errors, SHOT_ERRORS.format);
      continue;
    }
    const label = match[1] as ShotLabel;
    if (seen.has(label)) {
      pushError(errors, SHOT_ERRORS.duplicate);
      continue;
    }
    seen.add(label);
    fields[label] = (match[2] ?? '').trim();
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, fields };
}
