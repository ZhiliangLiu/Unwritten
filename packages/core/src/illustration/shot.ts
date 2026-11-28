import type { PortraitSlot } from '@unwritten/contracts';
import type { Logger, SampleOutcome } from '../log/logger.ts';
import type { LlmCompleteInput, LlmRunRef } from '../llm/types.ts';
import { LlmRunError } from '../llm/types.ts';
import type { LlmService } from '../services.ts';
import { parseShotText, SHOT_ERRORS, type ShotLabel } from './shot-parse.ts';
import { buildCorrectionPrompt, buildShotPrompt, SHOT_SYSTEM_PROMPT, type ShotInput } from './shot-prompt.ts';

export const SHOT_CAPTION_MAX_LENGTH = 200;
const SHOT_MAX_CORRECTIONS = 2;
const SHOT_MAX_OUTPUT_TOKENS = 800;

export interface ShotResult {
  prompt: string;
  negative: string | null;
  caption: string;
  refs: Array<{ code: string; view: PortraitSlot }>;
  aspect: string;
  corrections: number;
}

export interface ShotDeps {
  llm: Pick<LlmService, 'complete'>;
  logger: Pick<Logger, 'sample'>;
}

export interface ShotOptions {
  signal?: AbortSignal;
  guard?: NonNullable<LlmCompleteInput['guard']>;
}

const REF_ITEM = /^C(\d+):(front|three_quarter|full_body)$/u;
const REF_REFERENCE = /\{\{ref:(\d+)\}\}/gu;

function pushError(errors: string[], message: string): void {
  if (!errors.includes(message)) errors.push(message);
}

function parseReferences(value: string, input: ShotInput): { refs: ShotResult['refs']; valid: boolean } {
  const refs: ShotResult['refs'] = [];
  const seen = new Set<string>();
  let valid = true;
  for (const item of value.split(',')) {
    const match = REF_ITEM.exec(item.trim());
    const view = match?.[2] as PortraitSlot | undefined;
    const person = match ? input.materials.people.find((candidate) => candidate.code === `C${match[1]}`) : undefined;
    const allowed = person ? (input.referenceViews[person.code] ?? []) : [];
    if (!match || !view || !person || !allowed.includes(view) || seen.has(person.code)) {
      valid = false;
      continue;
    }
    seen.add(person.code);
    refs.push({ code: person.code, view });
  }
  return { refs, valid };
}

function validateShot(
  fields: Partial<Record<ShotLabel, string>>,
  input: ShotInput,
): { errors: string[]; result: ShotResult | null } {
  const errors: string[] = [];
  const prompt = fields.PROMPT ?? '';
  const caption = fields.CAPTION ?? '';
  const negative = input.negativePrompt ? (fields.NEGATIVE ?? '') : '';

  if (!prompt) pushError(errors, SHOT_ERRORS.emptyPrompt);
  if (!caption) pushError(errors, SHOT_ERRORS.emptyCaption);
  if (Array.from(caption).length > SHOT_CAPTION_MAX_LENGTH) pushError(errors, SHOT_ERRORS.captionTooLong);

  const refsValue = (fields.REFS ?? '').trim();
  const refs = refsValue ? parseReferences(refsValue, input) : { refs: [], valid: true };
  if (!refs.valid) pushError(errors, SHOT_ERRORS.invalidReference);
  if (refs.refs.length > input.maxReferences) pushError(errors, SHOT_ERRORS.tooManyReferences);
  for (const match of prompt.matchAll(REF_REFERENCE)) {
    const index = Number(match[1]);
    if (!Number.isInteger(index) || index < 1 || index > refs.refs.length) {
      pushError(errors, SHOT_ERRORS.referenceOutOfRange);
      break;
    }
  }

  const autoAspect = input.fixedAspect === null && input.aspects.length > 1;
  const writtenAspect = (fields.ASPECT ?? '').trim();
  if (autoAspect && !input.aspects.includes(writtenAspect)) pushError(errors, SHOT_ERRORS.invalidAspect);
  const aspect = autoAspect ? writtenAspect : (input.fixedAspect ?? input.aspects[0] ?? '');

  const lowerPrompt = prompt.toLowerCase();
  const lowerNegative = negative.toLowerCase();
  if (
    input.materials.bannedNames.some(
      (name) => lowerPrompt.includes(name.toLowerCase()) || lowerNegative.includes(name.toLowerCase()),
    )
  ) {
    pushError(errors, SHOT_ERRORS.bannedName);
  }
  if (input.materials.unknownNames.some((name) => caption.includes(name))) {
    pushError(errors, SHOT_ERRORS.captionLeak);
  }

  if (errors.length > 0) return { errors, result: null };
  return {
    errors,
    result: {
      prompt,
      negative: negative || null,
      caption,
      refs: refs.refs,
      aspect,
      corrections: 0,
    },
  };
}

function isInterruption(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof LlmRunError && error.code === 'interrupted')
  );
}

export async function describeShot(
  deps: ShotDeps,
  input: ShotInput,
  ref: LlmRunRef,
  options: ShotOptions = {},
): Promise<ShotResult> {
  const startedAt = performance.now();
  const autoAspect = input.fixedAspect === null && input.aspects.length > 1;
  const original = buildShotPrompt(input);
  let corrections = 0;
  let refsCount = 0;
  let previousOutput = '';
  let previousErrors: string[] = [];
  let outcome: SampleOutcome = 'error';
  try {
    for (let attempt = 0; attempt <= SHOT_MAX_CORRECTIONS; attempt += 1) {
      corrections = attempt;
      const prompt = attempt === 0 ? original : buildCorrectionPrompt(original, previousOutput, previousErrors);
      const completion = await deps.llm.complete({
        purpose: 'background',
        system: SHOT_SYSTEM_PROMPT,
        prompt,
        sessionId: `illustration-${ref.id}`,
        ref,
        maxOutputTokens: SHOT_MAX_OUTPUT_TOKENS,
        signal: options.signal,
        guard: options.guard,
      });
      previousOutput = completion.text;
      const parsed = parseShotText(completion.text);
      if (parsed.ok) {
        const validated = validateShot(parsed.fields, input);
        if (validated.result) {
          refsCount = validated.result.refs.length;
          outcome = 'ok';
          return { ...validated.result, corrections: attempt };
        }
        previousErrors = validated.errors;
      } else {
        previousErrors = parsed.errors;
      }
    }
    throw new LlmRunError('invalid_output', null);
  } catch (error) {
    outcome = isInterruption(error) ? 'interrupted' : 'error';
    throw error;
  } finally {
    deps.logger.sample({
      metric: 'illustration.shot',
      durationMs: performance.now() - startedAt,
      outcome,
      workId: ref.workId ?? undefined,
      requestId: ref.id,
      attempt: ref.attempt,
      data: { corrections, refs: refsCount, autoAspect },
    });
  }
}
