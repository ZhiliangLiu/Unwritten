import { randomBytes } from 'node:crypto';

export function generateServiceToken(): string {
  return randomBytes(32).toString('base64url');
}
