import type { ImageCapabilities, ImageQuality, ImageSize } from '@unwritten/contracts';
import { IMAGE_ASPECT_TOLERANCE, IMAGE_MAX_PIXELS } from './limits.ts';
import { aspectMatches } from './validate.ts';

export const SERVICE_INFO_PROTOCOL = 'unwritten-image/1';
export const NOT_READY_REASONS = ['starting', 'out_of_memory', 'workflow_error'] as const;
export type NotReadyReason = (typeof NOT_READY_REASONS)[number];

export interface ServiceInfo {
  implementation: { name: string; version: string };
  model: string | null;
  ready: boolean;
  notReadyReason: NotReadyReason | null;
  capabilities: ImageCapabilities;
}

type ParseServiceInfo = { ok: true; info: ServiceInfo } | { ok: false; issue: string };

const TIER_ORDER = ['720', '1k', '2k'] as const;
const TIER_SHORT_EDGE: Record<(typeof TIER_ORDER)[number], number> = { '720': 720, '1k': 1024, '2k': 2048 };
const SHORT_EDGE_TOLERANCE = 16;
const QUALITIES = new Set<ImageQuality>(['fast', 'best']);
const REQUIRED_ASPECTS = ['3:2', '3:4'];

function invalid(issue: string): { ok: false; issue: string } {
  return { ok: false, issue };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function gcd(first: number, second: number): number {
  let a = first;
  let b = second;
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function parseAspect(value: string): { width: number; height: number } | null {
  const match = /^([1-9]\d*):([1-9]\d*)$/u.exec(value);
  if (match === null) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (gcd(width, height) !== 1) return null;
  return { width, height };
}

function parseImplementation(raw: unknown): { name: string; version: string } | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.name !== 'string' || typeof raw.version !== 'string') return null;
  return { name: raw.name, version: raw.version };
}

function knownNotReadyReason(value: string): NotReadyReason | null {
  return (NOT_READY_REASONS as readonly string[]).includes(value) ? (value as NotReadyReason) : null;
}

function parseResolutions(
  raw: Record<string, unknown>,
  aspects: Set<string>,
): { ok: true; resolutions: Record<string, Record<string, ImageSize>> } | { ok: false; issue: string } {
  const resolutions: Record<string, Record<string, ImageSize>> = {};
  for (const [aspect, tiersRaw] of Object.entries(raw)) {
    if (!aspects.has(aspect)) return invalid(`capabilities.resolutions has unknown aspect ${aspect}`);
    if (!isRecord(tiersRaw)) return invalid(`capabilities.resolutions.${aspect} must be an object`);
    const tiers: Record<string, ImageSize> = {};
    let previousPixels = 0;
    for (const tier of TIER_ORDER) {
      const sizeRaw = tiersRaw[tier];
      if (sizeRaw === undefined) continue;
      if (!isRecord(sizeRaw) || !isPositiveInteger(sizeRaw.width) || !isPositiveInteger(sizeRaw.height)) {
        return invalid(`capabilities.resolutions.${aspect}.${tier} must have positive integer width and height`);
      }
      const { width, height } = sizeRaw;
      const shortEdge = Math.min(width, height);
      if (Math.abs(shortEdge - TIER_SHORT_EDGE[tier]) > SHORT_EDGE_TOLERANCE) {
        return invalid(
          `capabilities.resolutions.${aspect}.${tier} short edge ${shortEdge} is not close to ${TIER_SHORT_EDGE[tier]}`,
        );
      }
      if (!aspectMatches(width, height, aspect, IMAGE_ASPECT_TOLERANCE)) {
        return invalid(`capabilities.resolutions.${aspect}.${tier} does not match aspect ${aspect}`);
      }
      const pixels = width * height;
      if (pixels > IMAGE_MAX_PIXELS) {
        return invalid(`capabilities.resolutions.${aspect}.${tier} exceeds the pixel limit`);
      }
      if (pixels <= previousPixels) {
        return invalid(`capabilities.resolutions.${aspect} pixel counts must strictly increase by tier`);
      }
      previousPixels = pixels;
      tiers[tier] = { width, height };
    }
    resolutions[aspect] = tiers;
  }
  return { ok: true, resolutions };
}

function parseCapabilities(raw: unknown): { ok: true; capabilities: ImageCapabilities } | { ok: false; issue: string } {
  if (!isRecord(raw)) return invalid('capabilities must be an object');
  if (!isNonNegativeInteger(raw.maxReferences))
    return invalid('capabilities.maxReferences must be a non-negative integer');
  if (!isPositiveInteger(raw.maxReferenceBytes)) {
    return invalid('capabilities.maxReferenceBytes must be a positive integer');
  }
  if (!isPositiveInteger(raw.maxPromptLength))
    return invalid('capabilities.maxPromptLength must be a positive integer');
  if (typeof raw.seed !== 'boolean') return invalid('capabilities.seed must be a boolean');
  if (typeof raw.negativePrompt !== 'boolean') return invalid('capabilities.negativePrompt must be a boolean');

  const qualitiesRaw = raw.qualities;
  if (!Array.isArray(qualitiesRaw) || qualitiesRaw.length === 0) {
    return invalid('capabilities.qualities must be a non-empty array');
  }
  const qualities: ImageQuality[] = [];
  for (const value of qualitiesRaw) {
    if (typeof value !== 'string' || !QUALITIES.has(value as ImageQuality)) {
      return invalid('capabilities.qualities contains an unknown quality');
    }
    qualities.push(value as ImageQuality);
  }
  if (!qualities.includes('best')) return invalid('capabilities.qualities must include best');

  const aspectsRaw = raw.aspects;
  if (!Array.isArray(aspectsRaw) || aspectsRaw.length === 0) {
    return invalid('capabilities.aspects must be a non-empty array');
  }
  const aspects: string[] = [];
  for (const value of aspectsRaw) {
    if (typeof value !== 'string' || parseAspect(value) === null) {
      return invalid('capabilities.aspects contains an invalid aspect');
    }
    if (aspects.includes(value)) return invalid(`capabilities.aspects repeats ${value}`);
    aspects.push(value);
  }
  for (const required of REQUIRED_ASPECTS) {
    if (!aspects.includes(required)) return invalid(`capabilities.aspects must include ${required}`);
  }

  let resolutions: Record<string, Record<string, ImageSize>> = {};
  if (raw.resolutions !== undefined) {
    if (!isRecord(raw.resolutions)) return invalid('capabilities.resolutions must be an object');
    const parsed = parseResolutions(raw.resolutions, new Set(aspects));
    if (!parsed.ok) return parsed;
    resolutions = parsed.resolutions;
  }

  return {
    ok: true,
    capabilities: {
      maxReferences: raw.maxReferences,
      maxReferenceBytes: raw.maxReferenceBytes,
      maxPromptLength: raw.maxPromptLength,
      seed: raw.seed,
      negativePrompt: raw.negativePrompt,
      qualities,
      aspects,
      resolutions,
    },
  };
}

export function parseServiceInfo(raw: unknown): ParseServiceInfo {
  if (!isRecord(raw)) return invalid('service info must be an object');
  if (raw.protocol !== SERVICE_INFO_PROTOCOL) return invalid(`protocol must be ${SERVICE_INFO_PROTOCOL}`);
  const implementation = parseImplementation(raw.implementation);
  if (implementation === null) return invalid('implementation must have string name and version');
  if (typeof raw.ready !== 'boolean') return invalid('ready must be a boolean');
  if (raw.notReadyReason !== null && raw.notReadyReason !== undefined && typeof raw.notReadyReason !== 'string') {
    return invalid('notReadyReason must be a string or null');
  }
  if (raw.model !== undefined && raw.model !== null && typeof raw.model !== 'string') {
    return invalid('model must be a string or null');
  }
  const parsedCapabilities = parseCapabilities(raw.capabilities);
  if (!parsedCapabilities.ok) return parsedCapabilities;

  return {
    ok: true,
    info: {
      implementation,
      model: typeof raw.model === 'string' ? raw.model : null,
      ready: raw.ready,
      notReadyReason: typeof raw.notReadyReason === 'string' ? knownNotReadyReason(raw.notReadyReason) : null,
      capabilities: parsedCapabilities.capabilities,
    },
  };
}
