import { z } from 'zod';
import {
  ListItemStatusSchema,
  STATE_UNIT_MAX_LENGTH,
  type ListItemStatus,
  type StateConfig,
  type StateDisplay,
} from '@unwritten/contracts';

const TEXT_VALUE_MAX_LENGTH = 200;

export type StateCheck<T> = { ok: true; value: T } | { ok: false; error: string };

export function checkStateConfig(display: StateDisplay, config: StateConfig): StateCheck<StateConfig> {
  switch (display) {
    case 'number':
      if (config.stages.length > 0) return { ok: false, error: '数字栏目不需要阶段名。' };
      if (config.min !== null && config.max !== null && config.min >= config.max) {
        return { ok: false, error: '数字栏目的 min 必须小于 max。' };
      }
      if (config.unit !== null && Array.from(config.unit).length > STATE_UNIT_MAX_LENGTH) {
        return { ok: false, error: '数字栏目的单位不能超过 10 个字。' };
      }
      return { ok: true, value: config };
    case 'stage':
      if (config.stages.length < 2 || new Set(config.stages).size !== config.stages.length) {
        return { ok: false, error: '阶段栏目至少要有两个不同的阶段名。' };
      }
      if (config.min !== null || config.max !== null || config.unit !== null) {
        return { ok: false, error: '阶段栏目不需要 min、max 或单位。' };
      }
      return { ok: true, value: config };
    case 'list':
      if (config.min !== null || config.max !== null || config.unit !== null || config.stages.length > 0) {
        return { ok: false, error: '清单栏目不需要 min、max、单位或阶段名。' };
      }
      return { ok: true, value: config };
    case 'text':
      if (config.min !== null || config.max !== null || config.unit !== null || config.stages.length > 0) {
        return { ok: false, error: '文字栏目不需要 min、max、单位或阶段名。' };
      }
      return { ok: true, value: config };
  }
}

export function checkStateValue(def: { display: StateDisplay; config: StateConfig }, raw: string): StateCheck<string> {
  switch (def.display) {
    case 'number': {
      const trimmed = raw.trim();
      if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return { ok: false, error: '数字栏目的值必须是十进制数字。' };
      const value = Number(trimmed);
      if (def.config.min !== null && value < def.config.min) {
        return { ok: false, error: '值超出了 min 到 max 的范围。' };
      }
      if (def.config.max !== null && value > def.config.max) {
        return { ok: false, error: '值超出了 min 到 max 的范围。' };
      }
      return { ok: true, value: String(value) };
    }
    case 'stage':
      if (!def.config.stages.includes(raw)) {
        return { ok: false, error: `阶段栏目的值必须是这些阶段之一：${def.config.stages.join('、')}。` };
      }
      return { ok: true, value: raw };
    case 'list':
      return { ok: false, error: '清单栏目用 state_item 改条目，不写 value。' };
    case 'text':
      if (raw.trim().length === 0 || Array.from(raw).length > TEXT_VALUE_MAX_LENGTH) {
        return { ok: false, error: '文字栏目的值不能为空，也不能超过 200 个字。' };
      }
      return { ok: true, value: raw };
  }
}

export interface ListEntry {
  item: string;
  status: ListItemStatus;
}

const ListEntrySchema = z.object({ item: z.string(), status: ListItemStatusSchema });

export function parseListValue(value: string | null): ListEntry[] {
  if (value === null) return [];
  try {
    const parsed = z.array(ListEntrySchema).safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function mergeListItems(previous: string | null, changes: ListEntry[]): string {
  const entries = parseListValue(previous);
  for (const change of changes) {
    const existing = entries.find((entry) => entry.item === change.item);
    if (existing) existing.status = change.status;
    else entries.push({ ...change });
  }
  return JSON.stringify(entries);
}

export function stageIndex(config: StateConfig, value: string): number {
  return config.stages.indexOf(value);
}
