import type { FakeStep } from './fake-openai-server.ts';

export function rawToolStep(name: string, args: Record<string, string>): FakeStep {
  return { kind: 'tool_call', name, arguments: JSON.stringify(args) };
}

export function pingStep(): FakeStep {
  return rawToolStep('ping', {});
}

export function proposeTurnStep(input: {
  prose: string;
  options: string[];
  scene?: { place: string; time: string; present: string[] };
  ending?: boolean;
}): FakeStep {
  return rawToolStep('propose_turn', {
    prose: input.prose,
    options: input.options.map((text) => JSON.stringify({ text })).join('\n'),
    changes: input.scene
      ? JSON.stringify({
          type: 'scene',
          place: input.scene.place,
          time: input.scene.time,
          present: input.scene.present.join(','),
        })
      : '',
    ending: input.ending ? 'true' : 'false',
  });
}

export function proposePreviewStep(input: {
  title: string;
  blurb: string;
  publicSetting: string;
  prose: string;
  options: string[];
  place: string;
  time: string;
  language: string;
}): FakeStep {
  return rawToolStep('propose_preview', {
    title: input.title,
    blurb: input.blurb,
    public_setting: input.publicSetting,
    prose: input.prose,
    options: input.options.map((text) => JSON.stringify({ text })).join('\n'),
    place: input.place,
    time: input.time,
    language: input.language,
  });
}
