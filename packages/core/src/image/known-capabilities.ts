import { eq } from 'drizzle-orm';
import { ImageCapabilitiesSchema, type ImageCapabilities } from '@unwritten/contracts';
import type { Database } from '../store/db.ts';
import { imageServiceCapabilities } from '../store/schema.ts';

export interface KnownCapabilities {
  capabilities: ImageCapabilities;
  at: number;
}

export interface KnownCapabilitiesStore {
  get(serviceId: string): KnownCapabilities | null;
  save(serviceId: string, known: KnownCapabilities): void;
  remove(serviceId: string): void;
}

export function createKnownCapabilitiesStore(db: Database): KnownCapabilitiesStore {
  return {
    get(serviceId) {
      const row = db
        .select()
        .from(imageServiceCapabilities)
        .where(eq(imageServiceCapabilities.serviceId, serviceId))
        .get();
      if (!row) return null;
      const parsed = ImageCapabilitiesSchema.safeParse(row.capabilities);
      return parsed.success ? { capabilities: parsed.data, at: row.probedAt } : null;
    },
    save(serviceId, known) {
      const values = { capabilities: known.capabilities, probedAt: known.at };
      db.insert(imageServiceCapabilities)
        .values({ serviceId, ...values })
        .onConflictDoUpdate({ target: imageServiceCapabilities.serviceId, set: values })
        .run();
    },
    remove(serviceId) {
      db.delete(imageServiceCapabilities).where(eq(imageServiceCapabilities.serviceId, serviceId)).run();
    },
  };
}
