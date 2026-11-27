import type { LlmPurpose, PurposeProblem, ThinkingFormat, ThinkingLevel } from '@unwritten/contracts';

export const PURPOSE_LABEL_KEYS: Record<LlmPurpose, string> = {
  default: 'settings:purpose.name.default',
  narrator: 'settings:purpose.name.narrator',
  author_chat: 'settings:purpose.name.author_chat',
  background: 'settings:purpose.name.background',
};

export const PURPOSE_HELP_KEYS: Record<LlmPurpose, string> = {
  default: 'settings:purpose.help.default',
  narrator: 'settings:purpose.help.narrator',
  author_chat: 'settings:purpose.help.author_chat',
  background: 'settings:purpose.help.background',
};

export const THINKING_LEVEL_LABEL_KEYS: Record<ThinkingLevel | 'unset', string> = {
  unset: 'settings:params.thinkingLevel.unset',
  off: 'settings:params.thinkingLevel.off',
  minimal: 'settings:params.thinkingLevel.minimal',
  low: 'settings:params.thinkingLevel.low',
  medium: 'settings:params.thinkingLevel.medium',
  high: 'settings:params.thinkingLevel.high',
  xhigh: 'settings:params.thinkingLevel.xhigh',
  max: 'settings:params.thinkingLevel.max',
};

export const THINKING_FORMAT_LABEL_KEYS: Record<ThinkingFormat, string> = {
  auto: 'settings:thinkingFormat.auto',
  openai: 'settings:thinkingFormat.openai',
  qwen: 'settings:thinkingFormat.qwen',
  'qwen-chat-template': 'settings:thinkingFormat.qwen-chat-template',
  deepseek: 'settings:thinkingFormat.deepseek',
  openrouter: 'settings:thinkingFormat.openrouter',
  zai: 'settings:thinkingFormat.zai',
};

export const PROBLEM_LABEL_KEYS: Record<PurposeProblem, string> = {
  not_configured: 'settings:purpose.problem.not_configured',
  model_missing: 'settings:purpose.problem.model_missing',
  no_tools: 'settings:purpose.problem.no_tools',
};
