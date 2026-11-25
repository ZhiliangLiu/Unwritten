import { describe, expect, it } from 'vitest';
import type { EndpointView } from '@unwritten/contracts';
import { beginEndpointEdit } from './endpoint-edit.ts';

function endpoint(id: string): EndpointView {
  return {
    id,
    name: `端点 ${id}`,
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:11434/v1',
    key: { hasKey: true, source: 'file', envVar: null },
    models: [{ id: `model-${id}`, contextWindow: null, maxTokens: null, tools: null }],
  };
}

describe('beginEndpointEdit', () => {
  it('每次打开编辑都从保留 key 开始', () => {
    expect(beginEndpointEdit(endpoint('a'))).toMatchObject({ keyAction: 'keep', keyValue: '' });
    expect(beginEndpointEdit(endpoint('b'))).toMatchObject({ keyAction: 'keep', keyValue: '' });
  });
});
