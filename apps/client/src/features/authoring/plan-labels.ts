import type { EntityKind, PlanEntityRole, PlanSource, PlanSummaryKey, StateDisplay } from '@unwritten/contracts';

export const PLAN_SOURCE_LABEL_KEYS: Record<PlanSource, string> = {
  author: 'authoring:plan.source.author',
  ai: 'authoring:plan.source.ai',
  author_confirmed: 'authoring:plan.source.author_confirmed',
};

export const PLAN_SUMMARY_LABEL_KEYS: Record<PlanSummaryKey, string> = {
  identity: 'authoring:plan.summary.identity',
  tone: 'authoring:plan.summary.tone',
  situation: 'authoring:plan.summary.situation',
  world: 'authoring:plan.summary.world',
  public_setting: 'authoring:plan.summary.public_setting',
};

export const STATE_DISPLAY_LABEL_KEYS: Record<StateDisplay, string> = {
  number: 'authoring:plan.state.display.number',
  stage: 'authoring:plan.state.display.stage',
  list: 'authoring:plan.state.display.list',
  text: 'authoring:plan.state.display.text',
};

export const PLAN_ENTITY_ROLE_LABEL_KEYS: Record<PlanEntityRole, string> = {
  protagonist: 'authoring:plan.entity.role.protagonist',
  cast: 'authoring:plan.entity.role.cast',
  other: 'authoring:plan.entity.role.other',
};

export const PLAN_ENTITY_KIND_LABEL_KEYS: Record<EntityKind, string> = {
  character: 'authoring:plan.entityKind.character',
  place: 'authoring:plan.entityKind.place',
  item: 'authoring:plan.entityKind.item',
  group: 'authoring:plan.entityKind.group',
  other: 'authoring:plan.entityKind.other',
};
