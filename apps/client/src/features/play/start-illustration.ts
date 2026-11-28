import type { TFunction } from 'i18next';
import type { IllustrationStyle, StartIllustrationInfo, StartIllustrationInput } from '@unwritten/contracts';
import { IMAGE_TIER_LABEL_KEYS, STYLE_PRESET_LABEL_KEYS } from '../../shared/lib/image-labels.ts';

export function initialChoice(info: StartIllustrationInfo): StartIllustrationInput {
  return {
    enabled: info.available && info.autoEnabled,
    style: info.lastStyle ?? info.authorStyle,
    aspectPreference: info.defaults.aspectPreference,
    resolutionTier: info.defaults.resolutionTier,
    protagonistInFrame: false,
    protagonistAppearance: null,
    protagonistSnapshotId: null,
  };
}

function styleLabel(style: StartIllustrationInput['style'], t: TFunction): string | null {
  if (style.kind === 'preset') return t(STYLE_PRESET_LABEL_KEYS[style.preset]);
  const text = style.text.trim();
  return text === '' ? null : text;
}

export function summaryText(choice: StartIllustrationInput, t: TFunction): string {
  if (!choice.enabled) return t('play:start.illustration.textOnly');
  const parts = [
    t('play:start.illustration.enabled'),
    styleLabel(choice.style, t),
    choice.aspectPreference === 'auto' ? t('play:format.automatic') : choice.aspectPreference,
    t(IMAGE_TIER_LABEL_KEYS[choice.resolutionTier]),
  ].filter((part): part is string => part !== null);
  return t('play:start.illustration.summary', {
    parts: parts.join(t('play:start.illustration.separator')),
  });
}

export function toStartInput(choice: StartIllustrationInput, authorStyle: IllustrationStyle): StartIllustrationInput {
  const appearance = choice.protagonistAppearance?.trim() ?? '';
  const style = choice.style.kind === 'custom' && choice.style.text.trim() === '' ? authorStyle : choice.style;
  return {
    ...choice,
    style,
    protagonistAppearance: choice.protagonistInFrame && appearance !== '' ? appearance : null,
    protagonistSnapshotId: choice.protagonistInFrame ? choice.protagonistSnapshotId : null,
  };
}
