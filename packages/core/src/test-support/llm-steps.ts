import type { FakeStep } from './fake-openai-server.ts';
import type { ScriptStep } from './scripted-llm.ts';

export function rawToolStep(name: string, args: Record<string, string>): FakeStep {
  return { kind: 'tool_call', name, arguments: JSON.stringify(args) };
}

export function pingStep(): FakeStep {
  return rawToolStep('ping', {});
}

export function thinkingToolStep(
  name: string,
  args: Record<string, string>,
  thinking: string,
  chunkDelayMs: number,
): FakeStep {
  return { kind: 'thinking_then_tool_call', name, arguments: JSON.stringify(args), thinking, chunkDelayMs };
}

export function changeLine(fields: Record<string, string>): string {
  return JSON.stringify(fields);
}

export function changeLines(...lines: Array<Record<string, string>>): string {
  return lines.map(changeLine).join('\n');
}

export function proposeTurnStep(input: {
  prose: string;
  options: string[];
  scene?: { place: string; time: string; present: string[] };
  changes?: string;
  ending?: boolean;
  illustrate?: string;
}): FakeStep {
  return rawToolStep('propose_turn', {
    prose: input.prose,
    options: input.options.map((text) => JSON.stringify({ text })).join('\n'),
    changes:
      input.changes ??
      (input.scene
        ? JSON.stringify({
            type: 'scene',
            place: input.scene.place,
            time: input.scene.time,
            present: input.scene.present.join(','),
          })
        : ''),
    ending: input.ending ? 'true' : 'false',
    ...(input.illustrate === undefined ? {} : { illustrate: input.illustrate }),
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
  present?: string[];
  changes?: string;
  state?: string;
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
    present: (input.present ?? []).join(','),
    changes:
      input.changes ?? '{"type":"new_entity","kind":"character","name":"守夜人","known_as":"","profile":"","para":"1"}',
    state: input.state ?? '',
  });
}

export function proposeCastStep(cast: Array<Record<string, string>>): ScriptStep {
  return { args: { cast: cast.map((row) => JSON.stringify(row)).join('\n') } };
}

export function proposeOpeningStep(input: {
  prose: string;
  options: string[];
  place: string;
  time: string;
  present?: string[];
  changes?: string;
  state?: string;
}): ScriptStep {
  return {
    args: {
      prose: input.prose,
      options: input.options.map((text) => JSON.stringify({ text })).join('\n'),
      place: input.place,
      time: input.time,
      present: (input.present ?? []).join(','),
      changes: input.changes ?? '',
      state: input.state ?? '',
    },
  };
}

export function proposePlanStep(
  input: {
    language?: string;
    summary?: Array<Record<string, string>>;
    entities?: Array<Record<string, string>>;
    secrets?: Array<Record<string, string>>;
    state?: Array<Record<string, string>>;
    scenes?: Array<Record<string, string>>;
    ending?: string;
    conflicts?: Array<Record<string, string>>;
  } = {},
): FakeStep {
  return rawToolStep('propose_plan', {
    language: input.language ?? 'zh-CN',
    summary:
      input.summary !== undefined
        ? changeLines(...input.summary)
        : changeLines(
            { key: 'identity', text: '刚到灯塔镇的邮差，谁也不认识', from: 'ai' },
            { key: 'situation', text: '最后一班船靠岸时，镇上停了电', from: 'ai' },
          ),
    entities:
      input.entities !== undefined
        ? changeLines(...input.entities)
        : changeLines({
            ref: 'e1',
            kind: 'character',
            role: 'protagonist',
            name: '新来的邮差',
            profile: '二十多岁，记性好',
            from: 'ai',
          }),
    secrets: changeLines(...(input.secrets ?? [])),
    state: changeLines(...(input.state ?? [])),
    scenes: changeLines(...(input.scenes ?? [])),
    ending: input.ending ?? '',
    conflicts: changeLines(...(input.conflicts ?? [])),
  });
}
