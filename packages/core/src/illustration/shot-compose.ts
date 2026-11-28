import type { IllustrationStyle } from '@unwritten/contracts';
import type { ShotResult } from './shot.ts';
import { styleFragment } from './style.ts';

const PROTAGONIST_OUT_OF_FRAME = 'first-person viewpoint, the viewpoint character is outside the frame';
const NO_NEGATIVE_PROMPT = 'keep the picture free of lettering, subtitles, labels, logos and watermarks';
const FIXED_NEGATIVE_PROMPT = 'text, lettering, subtitles, labels, logos, watermarks';
const REFERENCE = /\{\{ref:(\d+)\}\}/gu;

export function composeFinalPrompt(input: {
  shot: ShotResult;
  style: IllustrationStyle;
  protagonistInFrame: boolean;
  negativePrompt: boolean;
}): { prompt: string; negativePrompt: string | null } {
  const parts: string[] = [];
  const fragment = styleFragment(input.style);
  if (fragment) parts.push(fragment);
  if (input.shot.prompt) parts.push(input.shot.prompt);
  if (!input.protagonistInFrame) parts.push(PROTAGONIST_OUT_OF_FRAME);
  if (!input.negativePrompt) parts.push(NO_NEGATIVE_PROMPT);

  const negativePrompt = input.negativePrompt
    ? [input.shot.negative, FIXED_NEGATIVE_PROMPT].filter((part): part is string => Boolean(part)).join(', ')
    : null;
  return { prompt: parts.join(', '), negativePrompt };
}

export function dropReference(
  prompt: string,
  refs: ShotResult['refs'],
  index: number,
  replacement: string,
): { prompt: string; refs: ShotResult['refs'] } {
  const removed = index + 1;
  const rewritten = prompt.replace(REFERENCE, (match, digits: string) => {
    const reference = Number(digits);
    if (reference === removed) return replacement;
    if (reference > removed) return `{{ref:${reference - 1}}}`;
    return match;
  });
  return { prompt: rewritten, refs: refs.filter((_, position) => position !== index) };
}
