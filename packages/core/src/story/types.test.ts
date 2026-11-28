import { describe, expect, it } from 'vitest';
import { EMPTY_CHANGES, ValidatedChangesSchema, type ValidatedChanges } from './types.ts';

describe('ValidatedChanges', () => {
  it('能往返 JSON', () => {
    const changes: ValidatedChanges = {
      ...EMPTY_CHANGES,
      entities: [
        {
          line: 1,
          kind: 'character',
          name: '守夜人',
          knownAs: null,
          profile: '渡口的守夜人',
          appearance: null,
          para: 1,
          protagonist: false,
          slot: null,
        },
      ],
      names: [{ line: 2, entity: { existing: 'e' }, name: '守夜人', holder: { created: 1 }, para: 1 }],
      facts: [
        {
          line: 3,
          kind: 'event',
          subject: { created: 1 },
          object: null,
          key: null,
          statement: '守夜人点亮了灯',
          data: { note: '灯', count: 1 },
          para: 1,
          witnesses: [{ existing: 'e' }],
        },
      ],
      knowledge: [
        {
          line: 4,
          fact: { line: 3 },
          holder: { created: 1 },
          level: 'confirmed',
          perceived: null,
          via: null,
          para: 1,
        },
      ],
      scene: { place: '渡口', time: '夜里', present: [{ created: 1 }] },
    };
    expect(ValidatedChangesSchema.parse(JSON.parse(JSON.stringify(changes)))).toEqual(changes);
  });
});
