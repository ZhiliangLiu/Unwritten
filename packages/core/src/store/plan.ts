import {
  DEFAULT_WORK_SETTINGS,
  PlanItemSchema,
  PlanSourceSchema,
  type PlanItem,
  type PlanView,
  type WorkSettings,
} from '@unwritten/contracts';
import { z } from 'zod';
import {
  PUBLIC_SETTING_PLAN_ITEM_ID,
  StoredSettingsSchema,
  type StoredPlan,
  type StoredSettings,
  type VersionMeta,
} from './meta.ts';

const LegacyPlanItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  source: PlanSourceSchema,
});

function defaultStoredSettings(): StoredSettings {
  return {
    world: { ...DEFAULT_WORK_SETTINGS.world, rev: 0 },
    protagonist: { ...DEFAULT_WORK_SETTINGS.protagonist, rev: 0 },
    cast: { ...DEFAULT_WORK_SETTINGS.cast, rev: 0 },
    secrets: { ...DEFAULT_WORK_SETTINGS.secrets, rev: 0 },
    opening: { ...DEFAULT_WORK_SETTINGS.opening, rev: 0 },
    actions: { ...DEFAULT_WORK_SETTINGS.actions, rev: 0 },
    scenes: { ...DEFAULT_WORK_SETTINGS.scenes, rev: 0 },
    status: { ...DEFAULT_WORK_SETTINGS.status, rev: 0 },
  };
}

export function readSettings(meta: VersionMeta): StoredSettings {
  const raw = meta.settings as Partial<StoredSettings> | undefined;
  const defaults = defaultStoredSettings();
  if (!raw) return defaults;
  const parsed = StoredSettingsSchema.safeParse({
    world: raw.world ?? defaults.world,
    protagonist: raw.protagonist ?? defaults.protagonist,
    cast: raw.cast ?? defaults.cast,
    secrets: raw.secrets ?? defaults.secrets,
    opening: raw.opening ?? defaults.opening,
    actions: raw.actions ?? defaults.actions,
    scenes: raw.scenes ?? defaults.scenes,
    status: raw.status ?? defaults.status,
  });
  return parsed.success ? parsed.data : defaults;
}

export function settingsView(stored: StoredSettings): WorkSettings {
  return {
    world: { text: stored.world.text },
    protagonist: { text: stored.protagonist.text, fields: stored.protagonist.fields },
    cast: { text: stored.cast.text, mode: stored.cast.mode },
    secrets: { text: stored.secrets.text },
    opening: { text: stored.opening.text, mode: stored.opening.mode },
    actions: { text: stored.actions.text, hints: stored.actions.hints },
    scenes: { text: stored.scenes.text },
    status: { text: stored.status.text },
  };
}

export function readPlan(meta: VersionMeta): StoredPlan | null {
  const plan = meta.plan;
  if (!plan) return null;
  const items = (plan.items as unknown[]).flatMap((raw): PlanItem[] => {
    const parsed = PlanItemSchema.safeParse(raw);
    if (parsed.success) return [parsed.data];
    if (typeof raw !== 'object' || raw === null || 'kind' in raw) return [];
    const legacy = LegacyPlanItemSchema.safeParse(raw);
    if (!legacy.success) return [];
    return [
      {
        kind: 'summary',
        key: legacy.data.id === PUBLIC_SETTING_PLAN_ITEM_ID ? 'public_setting' : 'world',
        id: legacy.data.id,
        text: legacy.data.text,
        source: legacy.data.source,
      },
    ];
  });
  return { items, conflicts: plan.conflicts ?? [], confirmedRev: plan.confirmedRev ?? null };
}

export function readPublicSetting(meta: VersionMeta): string {
  const items = readPlan(meta)?.items ?? [];
  const publicSetting = items.find((item) => item.kind === 'summary' && item.key === 'public_setting');
  if (publicSetting?.kind === 'summary') return publicSetting.text;
  const world = items.find((item) => item.kind === 'summary' && item.key === 'world');
  return world?.kind === 'summary' ? world.text : '';
}

export function isPlanConfirmed(meta: VersionMeta, contentRev: number): boolean {
  return readPlan(meta)?.confirmedRev === contentRev;
}

export function planView(meta: VersionMeta, contentRev: number): PlanView | null {
  const plan = readPlan(meta);
  if (!plan) return null;
  return { items: plan.items, conflicts: plan.conflicts, confirmed: plan.confirmedRev === contentRev };
}
