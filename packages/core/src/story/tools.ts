import type { Database } from '../store/db.ts';
import type { TurnRequestLog } from '../store/meta.ts';
import {
  clipToolResult,
  renderCatalogPage,
  renderEntityDetail,
  renderSearchHits,
  renderTurnText,
  renderWhoKnows,
} from './render.ts';
import { CATALOG_CATEGORIES, type CatalogCategory } from './render.ts';
import type { CodeBook } from './codebook.ts';
import { searchStory } from './search.ts';
import type { StoryProjection } from './types.ts';

export interface StoryToolResult {
  text: string;
  terminate: boolean;
}

export interface StoryTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<StoryToolResult>;
}

export interface StoryToolsInput {
  db: Database;
  projection: StoryProjection;
  codebook: CodeBook;
  log: TurnRequestLog;
  onSample(sample: { tool: string; records: number; ok: boolean; durationMs: number }): void;
}

export const STORY_TOOL_NAMES = [
  'get_character',
  'get_place',
  'get_entity',
  'list_catalog',
  'who_knows',
  'search_story',
  'read_turn',
] as const;

const TOOL_SPECS = [
  {
    name: 'get_character',
    description: '查一个人物的完整档案：称呼、特征、关系、知道的事、最近和他有关的事件。',
    parameter: 'target',
    parameterDescription: '人物的编号（如 @3）或名字',
  },
  {
    name: 'get_place',
    description: '查一个地点的档案，以及在这里发生过的事。',
    parameter: 'target',
    parameterDescription: '地点的编号或名字',
  },
  {
    name: 'get_entity',
    description: '查物品、组织等其他事物的档案，以及和它有关的事。',
    parameter: 'target',
    parameterDescription: '编号或名字',
  },
  {
    name: 'list_catalog',
    description: '按类别列出本路线可见的条目，每页最多 30 条。',
    parameter: 'category',
    parameterDescription: 'characters、places、items、groups、others、promises、events、scenes 之一',
  },
  {
    name: 'who_knows',
    description: '查谁知道一件事、知道到什么程度、从谁那里得知。',
    parameter: 'fact',
    parameterDescription: '事实编号，如 #12',
  },
  {
    name: 'search_story',
    description: '在本路线的原文里搜索，返回命中的回合、段号和前后文。',
    parameter: 'query',
    parameterDescription: '要找的词或短语',
  },
  {
    name: 'read_turn',
    description: '读一个回合的玩家行动和完整正文，段落带段号。',
    parameter: 'turn',
    parameterDescription: '回合编号，如 T12',
  },
] as const;

function parametersFor(name: string): Record<string, unknown> {
  const spec = TOOL_SPECS.find((candidate) => candidate.name === name);
  if (!spec) return { type: 'object', properties: {}, required: [], additionalProperties: false };
  if (name === 'list_catalog') {
    return {
      type: 'object',
      properties: {
        category: { type: 'string', description: spec.parameterDescription },
        cursor: { type: 'string', description: '上一页末尾给出的游标，第一页留空' },
      },
      required: ['category', 'cursor'],
      additionalProperties: false,
    };
  }
  return {
    type: 'object',
    properties: { [spec.parameter]: { type: 'string', description: spec.parameterDescription } },
    required: [spec.parameter],
    additionalProperties: false,
  };
}

export function storyToolSchemaText(): string {
  return TOOL_SPECS.map(
    (spec) => `${spec.name}\n${spec.description}\n${JSON.stringify(parametersFor(spec.name))}`,
  ).join('\n');
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') throw new Error(`参数 ${key} 必须是字符串。`);
  return value;
}

export function createStoryTools(input: StoryToolsInput): StoryTool[] {
  const run = async (
    tool: string,
    args: Record<string, unknown>,
    execute: () => { text: string; records: string[] },
  ): Promise<StoryToolResult> => {
    const startedAt = performance.now();
    try {
      const result = execute();
      input.log.push({
        tool,
        ok: true,
        errors: [],
        args: Object.fromEntries(Object.entries(args).map(([key, value]) => [key, String(value)])),
        records: result.records,
      });
      input.onSample({ tool, records: result.records.length, ok: true, durationMs: performance.now() - startedAt });
      return { text: clipToolResult(result.text), terminate: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      input.log.push({
        tool,
        ok: false,
        errors: [message],
        args: Object.fromEntries(Object.entries(args).map(([key, value]) => [key, String(value)])),
      });
      input.onSample({ tool, records: 0, ok: false, durationMs: performance.now() - startedAt });
      throw new Error(message);
    }
  };

  return TOOL_SPECS.map((spec) => ({
    name: spec.name,
    description: spec.description,
    parameters: parametersFor(spec.name),
    async execute(args) {
      return run(spec.name, args, () => {
        if (spec.name === 'get_character' || spec.name === 'get_place' || spec.name === 'get_entity') {
          const token = stringArg(args, 'target');
          const resolved = input.codebook.resolveEntity(token);
          if (!resolved.ok) throw new Error(resolved.error);
          const entity = input.projection.entities.get(resolved.id);
          if (!entity) throw new Error('找不到这个条目。');
          if (spec.name === 'get_character' && entity.kind !== 'character') {
            throw new Error(`${input.codebook.entityCode(entity.id)} 不是人物，请用 get_place 或 get_entity。`);
          }
          if (spec.name === 'get_place' && entity.kind !== 'place') {
            throw new Error(`${input.codebook.entityCode(entity.id)} 不是地点，请用 get_character 或 get_entity。`);
          }
          if (spec.name === 'get_entity' && !['item', 'group', 'other'].includes(entity.kind)) {
            throw new Error(
              `${input.codebook.entityCode(entity.id)} 不是物品、组织或其他，请用 get_character 或 get_place。`,
            );
          }
          return { text: renderEntityDetail(input.projection, input.codebook, entity.id), records: [entity.id] };
        }
        if (spec.name === 'list_catalog') {
          const category = stringArg(args, 'category');
          if (!CATALOG_CATEGORIES.includes(category as CatalogCategory)) {
            throw new Error(`参数 category 必须是 ${CATALOG_CATEGORIES.join('、')} 之一。`);
          }
          const cursorRaw = stringArg(args, 'cursor');
          const cursor = cursorRaw === '' ? 0 : Number(cursorRaw);
          if (!Number.isInteger(cursor) || cursor < 0) throw new Error('参数 cursor 必须是非负整数。');
          return {
            text: renderCatalogPage(input.projection, input.codebook, category as CatalogCategory, cursor),
            records: [],
          };
        }
        if (spec.name === 'who_knows') {
          const factToken = stringArg(args, 'fact');
          const resolved = input.codebook.resolveFact(factToken);
          if (!resolved.ok) throw new Error(resolved.error);
          const records = [
            resolved.id,
            ...input.projection.knowledge
              .filter((record) => record.factId === resolved.id)
              .map((record) => record.holderId),
          ];
          return { text: renderWhoKnows(input.projection, input.codebook, resolved.id), records };
        }
        if (spec.name === 'search_story') {
          const query = stringArg(args, 'query');
          const hits = searchStory(input.db, input.projection, query);
          return { text: renderSearchHits(hits, query), records: [] };
        }
        const turnToken = stringArg(args, 'turn');
        const resolved = input.codebook.resolveTurn(turnToken);
        if (!resolved.ok) throw new Error(resolved.error);
        return { text: renderTurnText(resolved.turn), records: [] };
      });
    },
  }));
}
