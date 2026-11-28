import { createHash } from 'node:crypto';

export function appearanceHash(text: string): string {
  return createHash('sha256').update(text.trim().normalize('NFC')).digest('hex');
}
