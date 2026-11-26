import { eventsContract } from './procedures/events.ts';
import { llmContract } from './procedures/llm.ts';
import { logContract } from './procedures/log.ts';
import { playContract } from './procedures/play.ts';
import { settingsContract } from './procedures/settings.ts';
import { worksContract } from './procedures/works.ts';

export const contract = {
  llm: llmContract,
  works: worksContract,
  play: playContract,
  settings: settingsContract,
  events: eventsContract,
  log: logContract,
};
export type Contract = typeof contract;

export * from './errors.ts';
export * from './events.ts';
export * from './schemas/appearance.ts';
export * from './schemas/common.ts';
export * from './schemas/llm.ts';
export * from './schemas/log.ts';
export * from './schemas/play.ts';
export * from './schemas/story.ts';
export * from './schemas/works.ts';
