import type { StartIllustrationInfo, StartIllustrationInput } from '@unwritten/contracts';
import { describe, expect, it } from 'vitest';
import { initialChoice, toStartInput } from './start-illustration.ts';

function info(overrides: Partial<StartIllustrationInfo>): StartIllustrationInfo {
  return {
    available: true,
    autoEnabled: true,
    authorStyle: { kind: 'preset', preset: 'watercolor' },
    lastStyle: null,
    defaults: { aspectPreference: 'auto', resolutionTier: '1k' },
    protagonistEntityId: null,
    ...overrides,
  };
}

function choice(overrides: Partial<StartIllustrationInput>): StartIllustrationInput {
  return {
    enabled: true,
    style: { kind: 'preset', preset: 'watercolor' },
    aspectPreference: 'auto',
    resolutionTier: '1k',
    protagonistInFrame: false,
    protagonistAppearance: null,
    protagonistSnapshotId: null,
    ...overrides,
  };
}

describe('initialChoice', () => {
  it('available 与 autoEnabled 都开着时默认有插图', () => {
    expect(initialChoice(info({ available: true, autoEnabled: true })).enabled).toBe(true);
  });

  it('自动出图没开时默认纯文字', () => {
    expect(initialChoice(info({ available: true, autoEnabled: false })).enabled).toBe(false);
  });

  it('没有出图服务时默认纯文字', () => {
    expect(initialChoice(info({ available: false, autoEnabled: false })).enabled).toBe(false);
    expect(initialChoice(info({ available: false, autoEnabled: true })).enabled).toBe(false);
  });

  it('上次选的画风优先于作者默认', () => {
    const lastStyle = { kind: 'preset', preset: 'ink' } as const;
    expect(initialChoice(info({ lastStyle })).style).toEqual(lastStyle);
    expect(initialChoice(info({ lastStyle: null })).style).toEqual(info({}).authorStyle);
  });
});

describe('toStartInput', () => {
  const authorStyle = { kind: 'preset', preset: 'watercolor' } as const;

  it('不入画时清掉形象和快照', () => {
    const input = toStartInput(
      choice({
        protagonistInFrame: false,
        protagonistAppearance: '短发，旧风衣',
        protagonistSnapshotId: '2f1d5c4a-8b7e-4a3f-9c2d-1e0f9a8b7c6d',
      }),
      authorStyle,
    );
    expect(input.protagonistAppearance).toBeNull();
    expect(input.protagonistSnapshotId).toBeNull();
  });

  it('入画时保留去空白后的形象和快照', () => {
    const snapshotId = '2f1d5c4a-8b7e-4a3f-9c2d-1e0f9a8b7c6d';
    const input = toStartInput(
      choice({ protagonistInFrame: true, protagonistAppearance: ' 短发，旧风衣 ', protagonistSnapshotId: snapshotId }),
      authorStyle,
    );
    expect(input.protagonistAppearance).toBe('短发，旧风衣');
    expect(input.protagonistSnapshotId).toBe(snapshotId);
  });

  it('纯文字也照传其余字段', () => {
    const input = toStartInput(choice({ enabled: false, aspectPreference: '3:4', resolutionTier: '2k' }), authorStyle);
    expect(input).toMatchObject({ enabled: false, aspectPreference: '3:4', resolutionTier: '2k' });
  });

  it('自定义画风留空时回退到作者默认', () => {
    const input = toStartInput(choice({ style: { kind: 'custom', text: '  ' } }), authorStyle);
    expect(input.style).toEqual(authorStyle);
  });
});
