export const DEFAULT_CONTEXT_WINDOW = 32_768;
export const CJK_TOKENS_PER_CHAR = 2;
export const OTHER_CHARS_PER_TOKEN = 3;
export const MIN_DEFAULT_MAX_TOKENS = 256;
export const MAX_DEFAULT_MAX_TOKENS = 16_384;

const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u;

export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (CJK_CHAR.test(char)) cjk += 1;
    else other += 1;
  }
  return cjk * CJK_TOKENS_PER_CHAR + Math.ceil(other / OTHER_CHARS_PER_TOKEN);
}

export function defaultMaxTokens(contextWindow: number): number {
  return Math.min(MAX_DEFAULT_MAX_TOKENS, Math.max(MIN_DEFAULT_MAX_TOKENS, Math.floor(contextWindow / 4)));
}
