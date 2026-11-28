import { eq } from 'drizzle-orm';
import type {
  AutoIllustrationTarget,
  AutoIllustrationView,
  ImageCapabilities,
  ImageSize,
  OutputOptionsView,
  OutputPreferences,
  SetAutoIllustrationInput,
} from '@unwritten/contracts';
import { DEFAULT_APPEARANCE, IMAGE_TIER_PREFERENCES, type ImageTierPreference } from '@unwritten/contracts';
import { appError } from '../errors.ts';
import type { Logger } from '../log/logger.ts';
import type { Database } from '../store/db.ts';
import {
  DEFAULT_ILLUSTRATION_SETTINGS,
  IllustrationSettingsSchema,
  type IllustrationSettings,
} from '../store/illustration-types.ts';
import { appSettings } from '../store/schema.ts';
import type { ProvidersState } from '../providers/file.ts';
import type { LlmService } from '../services.ts';

export function defaultIllustrationSettings(): IllustrationSettings {
  return {
    autoEnabled: false,
    confirmed: null,
    defaults: { ...DEFAULT_ILLUSTRATION_SETTINGS.defaults },
  };
}

export function readIllustrationSettings(db: Database, logger: Logger): IllustrationSettings {
  const row = db.select().from(appSettings).where(eq(appSettings.id, 1)).get();
  if (!row) return defaultIllustrationSettings();
  const parsed = IllustrationSettingsSchema.safeParse(row.illustration);
  if (parsed.success) return parsed.data;
  logger.record({ level: 'warn', module: 'image', event: 'image.settings.invalid' });
  return defaultIllustrationSettings();
}

export function writeIllustrationSettings(db: Database, settings: IllustrationSettings): IllustrationSettings {
  const validated = IllustrationSettingsSchema.parse(settings);
  const now = Date.now();
  db.insert(appSettings)
    .values({ id: 1, appearance: DEFAULT_APPEARANCE, illustration: validated, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.id, set: { illustration: validated, updatedAt: now } })
    .run();
  return validated;
}

function sameTarget(a: AutoIllustrationTarget, b: AutoIllustrationTarget): boolean {
  return (
    a.serviceId === b.serviceId &&
    a.model === b.model &&
    a.background.endpointId === b.background.endpointId &&
    a.background.modelId === b.background.modelId
  );
}

export function currentTarget(state: ProvidersState, llm: Pick<LlmService, 'resolve'>): AutoIllustrationTarget | null {
  if (state.status !== 'ok') return null;
  const serviceId = state.file.image.service;
  if (!serviceId) return null;
  const service = state.file.imageServices.find((candidate) => candidate.id === serviceId);
  if (!service) return null;
  const background = llm.resolve('background');
  if (!background) return null;
  return {
    serviceId,
    model: service.protocol === 'openai-images' ? (service.model ?? null) : null,
    background: { endpointId: background.endpointId, modelId: background.modelId },
  };
}

export function autoView(settings: IllustrationSettings, current: AutoIllustrationTarget | null): AutoIllustrationView {
  return {
    enabled:
      settings.autoEnabled &&
      settings.confirmed !== null &&
      current !== null &&
      sameTarget(settings.confirmed, current),
    current,
    confirmed: settings.confirmed,
  };
}

export function setAuto(
  settings: IllustrationSettings,
  input: SetAutoIllustrationInput,
  current: AutoIllustrationTarget | null,
): IllustrationSettings {
  if (!input.enabled) return { ...settings, autoEnabled: false, confirmed: null };
  if (current === null) throw appError('image_not_configured', 'no image service is configured');
  if (input.confirm === null || !sameTarget(input.confirm, current)) {
    throw appError('config_conflict', 'the confirmed recipient is stale');
  }
  return { ...settings, autoEnabled: true, confirmed: input.confirm };
}

export function outputOptions(
  settings: IllustrationSettings,
  capabilities: ImageCapabilities | null,
): OutputOptionsView {
  const aspects = capabilities?.aspects ?? [];
  const tiers: OutputOptionsView['tiers'] = [];
  for (const tier of IMAGE_TIER_PREFERENCES) {
    if (tier === 'default') {
      tiers.push({ tier, sizes: {} });
      continue;
    }
    const sizes: Record<string, ImageSize> = {};
    for (const aspect of aspects) {
      const size = capabilities?.resolutions[aspect]?.[tier];
      if (size) sizes[aspect] = size;
    }
    if (Object.keys(sizes).length > 0) tiers.push({ tier, sizes });
  }
  const preference = settings.defaults;
  const preferenceAvailable =
    preference.aspectPreference === 'auto'
      ? preference.resolutionTier === 'default' || hasTier(tiers, preference.resolutionTier)
      : aspects.includes(preference.aspectPreference) &&
        (preference.resolutionTier === 'default' ||
          Boolean(capabilities?.resolutions[preference.aspectPreference]?.[preference.resolutionTier]));
  return { preferences: preference, aspects, tiers, preferenceAvailable };
}

function hasTier(tiers: OutputOptionsView['tiers'], tier: ImageTierPreference): boolean {
  return tiers.some((entry) => entry.tier === tier && Object.keys(entry.sizes).length > 0);
}

export function setOutputPreferences(settings: IllustrationSettings, input: OutputPreferences): IllustrationSettings {
  return { ...settings, defaults: input };
}
