const KEY_PATTERNS = [/sk-[A-Za-z0-9_-]{8,}/g, /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi];

export function scrubSecrets(text: string, secrets: ReadonlyArray<string | null | undefined>): string {
  let result = text;
  for (const pattern of KEY_PATTERNS) result = result.replace(pattern, '[redacted]');
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join('[redacted]');
  }
  return result;
}
