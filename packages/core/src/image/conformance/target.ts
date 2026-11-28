export async function conformanceTarget(
  prefix: 'UNWRITTEN_IMAGE' | 'UNWRITTEN_LAUNCHER',
  startFake: () => Promise<{ url: string; token: string; close(): Promise<void> }>,
): Promise<{ url: string; token: string; real: boolean; close(): Promise<void> }> {
  const url = process.env[`${prefix}_CONFORMANCE_URL`];
  const token = process.env[`${prefix}_CONFORMANCE_TOKEN`];

  if (url !== undefined && token !== undefined) {
    return { url, token, real: true, async close() {} };
  }
  if (url !== undefined || token !== undefined) {
    throw new Error(`${prefix}_CONFORMANCE_URL and ${prefix}_CONFORMANCE_TOKEN must be set together`);
  }

  const fake = await startFake();
  return { url: fake.url, token: fake.token, real: false, close: () => fake.close() };
}
