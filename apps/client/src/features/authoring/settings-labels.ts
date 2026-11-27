import type { CastMode, HintMode, OpeningMode, SettingSectionId } from '@unwritten/contracts';

export const CAST_MODE_LABEL_KEYS: Record<CastMode, string> = {
  fixed: 'authoring:settings.cast.mode.fixed',
  per_run: 'authoring:settings.cast.mode.per_run',
};

export const HINT_MODE_LABEL_KEYS: Record<HintMode, string> = {
  actions_only: 'authoring:settings.actions.hints.actions_only',
  known_consequences: 'authoring:settings.actions.hints.known_consequences',
};

export const OPENING_MODE_LABEL_KEYS: Record<OpeningMode, string> = {
  ai: 'authoring:settings.opening.mode.ai',
  situation: 'authoring:settings.opening.mode.situation',
  author_text: 'authoring:settings.opening.mode.author_text',
};

export const OPENING_TEXT_LABEL_KEYS: Record<OpeningMode, string> = {
  ai: 'authoring:settings.opening.text.ai',
  situation: 'authoring:settings.opening.text.situation',
  author_text: 'authoring:settings.opening.text.author_text',
};

export const OPENING_PLACEHOLDER_KEYS: Record<OpeningMode, string> = {
  ai: 'authoring:settings.opening.placeholder.ai',
  situation: 'authoring:settings.opening.placeholder.situation',
  author_text: 'authoring:settings.opening.placeholder.author_text',
};

export const SETTING_SECTION_HEADING_KEYS: Record<SettingSectionId, string> = {
  world: 'authoring:settings.section.world.heading',
  protagonist: 'authoring:settings.section.protagonist.heading',
  cast: 'authoring:settings.section.cast.heading',
  secrets: 'authoring:settings.section.secrets.heading',
  opening: 'authoring:settings.section.opening.heading',
  actions: 'authoring:settings.section.actions.heading',
  scenes: 'authoring:settings.section.scenes.heading',
  status: 'authoring:settings.section.status.heading',
};

export const SETTING_SECTION_HELP_KEYS: Record<SettingSectionId, string> = {
  world: 'authoring:settings.section.world.help',
  protagonist: 'authoring:settings.section.protagonist.help',
  cast: 'authoring:settings.section.cast.help',
  secrets: 'authoring:settings.section.secrets.help',
  opening: 'authoring:settings.section.opening.help',
  actions: 'authoring:settings.section.actions.help',
  scenes: 'authoring:settings.section.scenes.help',
  status: 'authoring:settings.section.status.help',
};

export const SETTING_SECTION_PLACEHOLDER_KEYS: Record<Exclude<SettingSectionId, 'opening'>, string> = {
  world: 'authoring:settings.section.world.placeholder',
  protagonist: 'authoring:settings.section.protagonist.placeholder',
  cast: 'authoring:settings.section.cast.placeholder',
  secrets: 'authoring:settings.section.secrets.placeholder',
  actions: 'authoring:settings.section.actions.placeholder',
  scenes: 'authoring:settings.section.scenes.placeholder',
  status: 'authoring:settings.section.status.placeholder',
};
