import type { StoredAction, StoredScene, VersionMeta } from "../store/meta.ts";
import type { ResolvedModel } from "../llm/types.ts";
import type { TurnRow } from "./chain.ts";
import { NARRATOR_SYSTEM_PROMPT } from "./narrator-prompt.ts";

export interface NarratorContextInput {
  meta: VersionMeta;
  chain: TurnRow[];
  action: StoredAction;
  model: ResolvedModel;
  estimateTokens(text: string): number;
  toolSchemaText: string;
}

export type NarratorContext =
  | { ok: true; system: string; prompt: string; includedTurns: number; omittedTurns: number }
  | { ok: false; code: "context_too_small" };

function sceneBlock(scene: StoredScene): string {
  return [
    "【当前场景】",
    `地点：${scene.place || "未说明"}`,
    `时间：${scene.time || "未说明"}`,
    `在场：${scene.present.length ? scene.present.join("、") : "未说明"}`,
  ].join("\n");
}

function turnBlock(turn: TurnRow): string {
  if (turn.depth === 0) return `T0（开场）\n${turn.prose}`;
  return `T${turn.depth}\n玩家行动：${turn.action?.text ?? ""}\n${turn.prose}`;
}

function actionBlock(action: StoredAction): string {
  const hint =
    action.optionIndex === null
      ? "（这是玩家自己写的行动，按原意回应。）"
      : `（玩家选择了推荐行动第 ${action.optionIndex} 项。）`;
  return `【玩家这次的行动】\n${action.text}\n${hint}`;
}

export function buildNarratorContext(input: NarratorContextInput): NarratorContext {
  const head = input.chain.at(-1);
  if (!head) return { ok: false, code: "context_too_small" };
  const publicSetting = input.meta.plan?.items.find((item) => item.id === "public_setting")?.text ?? "";
  const language = input.meta.narration?.language ?? "zh-CN";
  const setting = `【作品设定】\n${input.meta.background}\n\n【公开设定】\n${publicSetting}`;
  const narration = `【叙事要求】\n作品语言：${language}。正文和选项都用这种语言写。`;
  const scene = sceneBlock(head.scene);
  const headBlock = turnBlock(head);
  const action = actionBlock(input.action);
  const required = [setting, narration, scene, headBlock, action];
  const requiredTokens = required.reduce((total, block) => total + input.estimateTokens(block), 0);
  const reserved = input.estimateTokens("【更早的回合】\n另有 99999 个更早的回合未列出。");
  const budget =
    input.model.contextWindow -
    input.model.maxOutputTokens -
    input.estimateTokens(input.toolSchemaText) -
    input.estimateTokens(NARRATOR_SYSTEM_PROMPT);
  if (requiredTokens > budget) return { ok: false, code: "context_too_small" };

  let available = budget - requiredTokens - reserved;
  const included: TurnRow[] = [];
  for (let index = input.chain.length - 2; index >= 0; index -= 1) {
    const turn = input.chain[index];
    if (!turn) break;
    const block = turnBlock(turn);
    const cost = input.estimateTokens(block);
    if (cost > available) break;
    included.unshift(turn);
    available -= cost;
  }

  const omitted = input.chain.length - 1 - included.length;
  const parts = [setting, narration, scene];
  if (omitted > 0) parts.push(`【更早的回合】\n另有 ${omitted} 个更早的回合未列出。`);
  if (included.length) parts.push("【最近的回合】", ...included.map((turn) => turnBlock(turn)));
  parts.push(headBlock, action);

  return {
    ok: true,
    system: NARRATOR_SYSTEM_PROMPT,
    prompt: parts.join("\n\n"),
    includedTurns: included.length + 1,
    omittedTurns: omitted,
  };
}
