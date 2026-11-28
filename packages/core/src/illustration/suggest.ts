import { and, eq } from 'drizzle-orm';
import { AppearanceTextSchema, type SuggestAppearanceOutput, type WorkIdInput } from '@unwritten/contracts';
import { appError } from '../errors.ts';
import type { LlmCompleteInput } from '../llm/types.ts';
import { LlmRunError } from '../llm/types.ts';
import type { LlmService } from '../services.ts';
import type { Database } from '../store/db.ts';
import type { VersionMeta } from '../store/meta.ts';
import { readPublicSetting, readSettings } from '../store/plan.ts';
import { entities, works, workVersions } from '../store/schema.ts';

export const SUGGEST_SYSTEM_PROMPT =
  '写一行主角的可见形象，供画面保持一致。用作品语言。只用已提供的公开外貌线索，可以补足日常外貌细节。写长相、身形、衣着或显眼特征，最多 300 字。只交形象文字，不写名字、身份、来历、秘密、标题或说明。';

const SUGGEST_CORRECTION = '上一次的形象不符合要求。请重写为一行不超过 300 字的外貌文字，只交形象本身。';

const MAX_REWRITES = 2;
const SUGGEST_MAX_OUTPUT_TOKENS = 200;

export interface SuggestAppearanceOptions {
  signal?: AbortSignal;
  guard?: NonNullable<LlmCompleteInput['guard']>;
}

export interface SuggestAppearanceDeps {
  db: Database;
  llm: Pick<LlmService, 'complete'>;
}

export function buildSuggestPrompt(
  input: { language: string; profile: string; setting: string },
  correction: boolean,
): string {
  const lines = [`作品语言：${input.language}`, `公开的主角档案：${input.profile}`, `公开的主角设定：${input.setting}`];
  if (correction) lines.push(SUGGEST_CORRECTION);
  return lines.join('\n');
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/u)[0]?.trim() ?? '';
}

export async function suggestAppearance(
  deps: SuggestAppearanceDeps,
  input: WorkIdInput,
  options: SuggestAppearanceOptions = {},
): Promise<SuggestAppearanceOutput> {
  const work = deps.db.select().from(works).where(eq(works.id, input.workId)).get();
  if (!work) throw appError('not_found', 'work not found');
  if (!work.publishedId) throw appError('not_published', 'work is not published');
  const version = deps.db.select().from(workVersions).where(eq(workVersions.id, work.publishedId)).get();
  if (!version) throw appError('not_found', 'version not found');
  const meta = version.meta as VersionMeta;
  const protagonist = deps.db
    .select()
    .from(entities)
    .where(and(eq(entities.versionId, version.id), eq(entities.isProtagonist, 1)))
    .get();
  const material = {
    language: meta.narration?.language?.trim() || '跟随背景所用的语言',
    profile: protagonist?.profile.text ?? '',
    setting: [readPublicSetting(meta), readSettings(meta).protagonist.text].filter((text) => text.trim()).join('\n'),
  };
  for (let corrections = 0; corrections <= MAX_REWRITES; corrections += 1) {
    const result = await deps.llm.complete({
      purpose: 'background',
      system: SUGGEST_SYSTEM_PROMPT,
      prompt: buildSuggestPrompt(material, corrections > 0),
      sessionId: input.workId,
      ref: { kind: 'illustration', id: input.workId, attempt: 1, workId: input.workId },
      maxOutputTokens: SUGGEST_MAX_OUTPUT_TOKENS,
      signal: options.signal,
      guard: options.guard,
    });
    const parsed = AppearanceTextSchema.safeParse(firstLine(result.text));
    if (parsed.success) return { appearance: parsed.data };
  }
  throw new LlmRunError('invalid_output', null);
}
