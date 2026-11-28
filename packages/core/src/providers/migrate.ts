import { PROVIDERS_FILE_VERSION } from './schema.ts';

export function upgradeProvidersObject(parsed: unknown): { value: unknown; fromVersion: 1 | 2 | null } {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { value: parsed, fromVersion: null };
  }
  const record = parsed as Record<string, unknown>;
  if (record.version === 1) {
    return {
      value: {
        ...record,
        version: PROVIDERS_FILE_VERSION,
        imageServices: 'imageServices' in record ? record.imageServices : [],
        image: 'image' in record ? record.image : { service: null },
      },
      fromVersion: 1,
    };
  }
  if (record.version === 2) return { value: parsed, fromVersion: 2 };
  return { value: parsed, fromVersion: null };
}
