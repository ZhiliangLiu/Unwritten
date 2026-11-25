const KEY_PATTERNS = [/sk-[A-Za-z0-9_-]{8,}/g, /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi];

export function scrubSecrets(text: string, secrets: ReadonlyArray<string | null | undefined>): string {
  let result = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) result = result.split(secret).join('[redacted]');
  }
  for (const pattern of KEY_PATTERNS) result = result.replace(pattern, '[redacted]');
  return result;
}
