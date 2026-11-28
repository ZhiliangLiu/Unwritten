import type {
  IllustrationStage,
  ImageServiceState,
  ImageTierPreference,
  LauncherFailureReason,
  PortraitSlot,
  StylePreset,
} from '@unwritten/contracts';

export const STYLE_PRESET_LABEL_KEYS: Record<StylePreset, string> = {
  watercolor: 'play:style.watercolor',
  ink: 'play:style.ink',
  anime: 'play:style.anime',
  painterly: 'play:style.painterly',
  cinematic: 'play:style.cinematic',
};

export const IMAGE_TIER_LABEL_KEYS: Record<ImageTierPreference, string> = {
  default: 'play:tier.default',
  '720': 'play:tier.720',
  '1k': 'play:tier.1k',
  '2k': 'play:tier.2k',
};

export const PORTRAIT_SLOT_LABEL_KEYS: Record<PortraitSlot, string> = {
  front: 'play:slot.front',
  three_quarter: 'play:slot.three_quarter',
  full_body: 'play:slot.full_body',
};

export const SERVICE_STATE_LABEL_KEYS: Record<ImageServiceState, string> = {
  ready: 'play:serviceState.ready',
  offline: 'play:serviceState.offline',
  waking: 'play:serviceState.waking',
  needs_action: 'play:serviceState.needs_action',
  wake_failed: 'play:serviceState.wake_failed',
  unknown: 'play:serviceState.unknown',
};

export const WAKE_REASON_LABEL_KEYS: Record<LauncherFailureReason, string> = {
  quota: 'play:wake.reason.quota',
  not_signed_in: 'play:wake.reason.not_signed_in',
  action_expired: 'play:wake.reason.action_expired',
  start_error: 'play:wake.reason.start_error',
};

export const ILLUSTRATION_STAGE_LABEL_KEYS: Record<IllustrationStage, string> = {
  wake: 'play:stage.wake',
  appearance: 'play:stage.appearance',
  shot: 'play:stage.shot',
  portrait: 'play:stage.portrait',
  generate: 'play:stage.generate',
  save: 'play:stage.save',
};
