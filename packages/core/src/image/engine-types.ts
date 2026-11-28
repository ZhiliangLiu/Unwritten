export interface ImageDispatchGuard {
  model: string | null;
  assertCurrent(): void;
}

export interface ImageGenerateInput {
  serviceId: string;
  guard?: ImageDispatchGuard;
  prompt: string;
  negativePrompt: string | null;
  references: Array<{ mime: string; bytes: Uint8Array }>;
  aspect: string;
  size: { width: number; height: number } | null;
  quality: 'fast' | 'best';
  seed: number | null;
  signal: AbortSignal;
  ref: { workId: string | null; kind: 'illustration' | 'portrait' | 'test'; id: string | null };
  manual: boolean;
}

export interface ImageGenerateResult {
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  seed: number | null;
  serviceId: string;
  model: string | null;
  callId: string;
}
