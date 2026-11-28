import { eventsContract } from './procedures/events.ts';
import { illustrationContract } from './procedures/illustration.ts';
import { imageContract } from './procedures/image.ts';
import { llmContract } from './procedures/llm.ts';
import { logContract } from './procedures/log.ts';
import { playContract } from './procedures/play.ts';
import { portraitContract } from './procedures/portrait.ts';
import { settingsContract } from './procedures/settings.ts';
import { worksContract } from './procedures/works.ts';

export const contract = {
  llm: llmContract,
  works: worksContract,
  play: playContract,
  settings: settingsContract,
  events: eventsContract,
  log: logContract,
  image: imageContract,
  illustration: illustrationContract,
  portrait: portraitContract,
};
export type Contract = typeof contract;

export * from './errors.ts';
export * from './events.ts';
export * from './schemas/appearance.ts';
export * from './schemas/authoring.ts';
export * from './schemas/common.ts';
export * from './schemas/illustration.ts';
export * from './schemas/image.ts';
export * from './schemas/llm.ts';
export * from './schemas/log.ts';
export * from './schemas/play.ts';
export * from './schemas/story.ts';
export * from './schemas/works.ts';
