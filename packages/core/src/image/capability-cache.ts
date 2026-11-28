import type { ImageCapabilities, ProbeResult } from '@unwritten/contracts';

export interface ProbeRecord {
  at: number;
  result: ProbeResult;
  notReadyReason: string | null;
  implementation: { name: string; version: string } | null;
  model: string | null;
  capabilities: ImageCapabilities | null;
}

export function createCapabilityCache(): {
  get(serviceId: string): ProbeRecord | null;
  set(serviceId: string, record: ProbeRecord): void;
  delete(serviceId: string): void;
} {
  const records = new Map<string, ProbeRecord>();
  return {
    get: (serviceId) => records.get(serviceId) ?? null,
    set(serviceId, record) {
      records.set(serviceId, record);
    },
    delete(serviceId) {
      records.delete(serviceId);
    },
  };
}
