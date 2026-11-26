import { readAnchors, type StoredAction, type VersionMeta } from '../store/meta.ts';
import type { ResolvedModel } from '../llm/types.ts';
import { NARRATOR_SYSTEM_PROMPT } from './narrator-prompt.ts';
import type { CodeBook } from '../story/codebook.ts';
import { appearedEntityIds, openPromises } from '../story/projection.ts';
import { renderEntityLine, renderEntityLineWithCode, renderPromiseLine, renderSceneBlock } from '../story/render.ts';
import type { ChainTurn, StoryProjection } from '../story/types.ts';

export interface NarratorContextInput {
  meta: VersionMeta;
  projection: StoryProjection;
  codebook: CodeBook;
  action: StoredAction;
  model: ResolvedModel;
  estimateTokens(text: string): number;
  toolSchemaText: string;
}

export type NarratorContext =
  | {
      ok: true;
      system: string;
      prompt: string;
      includedTurns: number;
      omittedTurns: number;
      summaryLines: number;
      indexEntities: number;
      contextTokens: number;
      anchorTokens: number;
    }
  | { ok: false; code: 'context_too_small' | 'work_setting_too_long'; anchorTokens: number };

function clip(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : `${chars.slice(0, max).join('')}…`;
}

function turnBlock(turn: ChainTurn, latest: boolean): string {
  const heading =
    turn.depth === 0 ? (latest ? 'T0（开场，最新）' : 'T0（开场）') : `T${turn.depth}${latest ? '（最新）' : ''}`;
  const lines = [heading];
  if (turn.action) lines.push(`玩家行动：${turn.action.text}`);
  turn.paragraphs.forEach((paragraph, index) => {
    if (index > 0) lines.push('');
    lines.push(`[${index + 1}] ${paragraph}`);
  });
  return lines.join('\n');
}

function actionBlock(action: StoredAction): string {
  const hint =
    action.optionIndex === null
      ? '（这是玩家自己写的行动，按原意回应。）'
      : `（玩家选择了推荐行动第 ${action.optionIndex} 项。）`;
  return `【玩家这次的行动】\n${action.text}\n${hint}`;
}

export function buildNarratorContext(input: NarratorContextInput): NarratorContext {
  const anchors = readAnchors(input.meta);
  const narrationDirective = anchors.narrationDirective.trim();
  const contentPolicy = anchors.contentPolicy.trim();
  const improvisationScope = anchors.improvisationScope.trim();
  const anchorTokens =
    input.estimateTokens(narrationDirective) +
    input.estimateTokens(contentPolicy) +
    input.estimateTokens(improvisationScope);
  const head = input.projection.chain.at(-1);
  if (!head) return { ok: false, code: 'context_too_small', anchorTokens };
  const publicSetting = input.meta.plan?.items.find((item) => item.id === 'public_setting')?.text ?? '';
  const language = input.meta.narration?.language ?? 'zh-CN';
  const protagonist = input.projection.entities.get(input.projection.protagonistId);
  if (!protagonist) return { ok: false, code: 'context_too_small', anchorTokens };
  const setting = publicSetting
    ? `【作品设定】\n${input.meta.background}\n\n【公开设定】\n${publicSetting}`
    : `【作品设定】\n${input.meta.background}`;
  const narration = [`【叙事要求】\n作品语言：${language}。正文和选项都用这种语言写。`, narrationDirective]
    .filter(Boolean)
    .join('\n');
  const contentBlock = contentPolicy ? `【内容边界】\n${contentPolicy}` : '';
  const improvisationBlock = improvisationScope ? `【即兴范围】\n${improvisationScope}` : '';
  const protagonistBlock = `【主角】\n@1 ${protagonist.name} · ${clip(protagonist.profile || '未写档案', 40)}`;
  const scene = renderSceneBlock(input.projection, input.codebook);
  const headBlock = turnBlock(head, true);
  const action = actionBlock(input.action);
  const required = [
    setting,
    improvisationBlock,
    narration,
    contentBlock,
    protagonistBlock,
    scene,
    headBlock,
    action,
  ].filter(Boolean);
  const budget =
    input.model.contextWindow -
    input.model.maxOutputTokens -
    input.estimateTokens(input.toolSchemaText) -
    input.estimateTokens(NARRATOR_SYSTEM_PROMPT);
  const requiredTokens = required.reduce((total, block) => total + input.estimateTokens(block), 0);
  const reserved =
    input.estimateTokens('另有 99999 个未出场的人物和地点，可用 list_catalog 查看。') +
    input.estimateTokens('【更早的回合】\n另有 99999 个更早的回合未列出，可用 search_story 或 read_turn 取回。');
  if (requiredTokens + reserved > budget) {
    const withoutAnchors = requiredTokens - anchorTokens + reserved;
    return { ok: false, code: withoutAnchors <= budget ? 'work_setting_too_long' : 'context_too_small', anchorTokens };
  }

  let available = budget - requiredTokens - reserved;
  const promiseLines: string[] = [];
  const promises = openPromises(input.projection);
  let promiseOmitted = 0;
  for (const [index, promise] of promises.entries()) {
    const cost = input.estimateTokens(`- #99 @99 → @99：${promise.statement}\n`);
    if (cost > available) {
      promiseOmitted = promises.length - index;
      break;
    }
    promiseLines.push(renderPromiseLine(input.projection, input.codebook, promise));
    available -= cost;
  }
  if (promiseOmitted) {
    const line = `另有 ${promiseOmitted} 条约定未列出，可用 list_catalog 查看。`;
    promiseLines.push(line);
    available -= input.estimateTokens(`${line}\n`);
  }

  const appeared = appearedEntityIds(input.projection);
  const indexEntities = [...input.projection.entities.values()]
    .filter((entity) => entity.id !== input.projection.protagonistId)
    .sort((left, right) => {
      const leftAppeared = appeared.has(left.id) ? 0 : 1;
      const rightAppeared = appeared.has(right.id) ? 0 : 1;
      if (leftAppeared !== rightAppeared) return leftAppeared - rightAppeared;
      if (left.originDepth !== right.originDepth) return right.originDepth - left.originDepth;
      return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    });
  const indexLines: string[] = [];
  let indexOmitted = 0;
  for (const [index, entity] of indexEntities.entries()) {
    const cost = input.estimateTokens(`${renderEntityLineWithCode(input.projection, '@99', entity.id)}\n`);
    if (cost > available) {
      indexOmitted = indexEntities.length - index;
      break;
    }
    indexLines.push(renderEntityLine(input.projection, input.codebook, entity.id));
    available -= cost;
  }
  if (indexOmitted) {
    const line = `另有 ${indexOmitted} 个未出场的人物和地点，可用 list_catalog 查看。`;
    indexLines.push(line);
    available -= input.estimateTokens(`${line}\n`);
  }

  const earlier = input.projection.chain.slice(0, -1);
  const recent: ChainTurn[] = [];
  for (let index = earlier.length - 1; index >= 0; index -= 1) {
    const turn = earlier[index];
    if (!turn) break;
    const block = turnBlock(turn, false);
    const cost = input.estimateTokens(`${block}\n\n`);
    if (cost > available) break;
    recent.unshift(turn);
    available -= cost;
  }

  const summaryTurns = earlier.filter((turn) => !recent.includes(turn));
  const summaryLines: string[] = [];
  let omittedTurns = 0;
  const newestFirst = [...summaryTurns].reverse();
  for (const [index, turn] of newestFirst.entries()) {
    const summary = input.projection.summaries.get(turn.id) ?? (turn.action ? `玩家行动：${turn.action.text}` : '开场');
    const line = `T${turn.depth} ${summary}`;
    const cost = input.estimateTokens(`${line}\n`);
    if (cost > available) {
      omittedTurns = newestFirst.length - index;
      break;
    }
    summaryLines.push(line);
    available -= cost;
  }
  summaryLines.reverse();

  const parts: string[] = [setting, improvisationBlock, narration, contentBlock, protagonistBlock, scene].filter(
    Boolean,
  );
  if (indexLines.length) parts.push(`【人物与事物索引】\n${indexLines.join('\n')}`);
  if (promiseLines.length) parts.push(`【未了结的约定】\n${promiseLines.join('\n')}`);
  if (summaryLines.length || omittedTurns > 0) {
    const earlierLines = [...summaryLines];
    if (omittedTurns > 0)
      earlierLines.push(`另有 ${omittedTurns} 个更早的回合未列出，可用 search_story 或 read_turn 取回。`);
    parts.push(`【更早的回合】\n${earlierLines.join('\n')}`);
  }
  if (recent.length) parts.push(`【最近的回合】\n${recent.map((turn) => turnBlock(turn, false)).join('\n\n')}`);
  parts.push(headBlock, action);
  const prompt = parts.join('\n\n');
  return {
    ok: true,
    system: NARRATOR_SYSTEM_PROMPT,
    prompt,
    includedTurns: recent.length + 1,
    omittedTurns,
    summaryLines: summaryLines.length,
    indexEntities: indexLines.filter((line) => line.startsWith('- ')).length,
    contextTokens: input.estimateTokens(prompt),
    anchorTokens,
  };
}
