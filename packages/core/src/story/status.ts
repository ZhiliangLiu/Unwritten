import type { ListItemStatus, StatusColumnView, StatusValue, StatusView } from '@unwritten/contracts';
import { stateAt } from './projection.ts';
import { parseListValue, stageIndex } from './state.ts';
import type { ProjStateDef, ProjStateValue, StoryProjection } from './types.ts';

export const LIST_STATUS_TEXT = { open: '进行中', done: '已完成', failed: '落空' } as const;

type DisplayStatus = keyof typeof LIST_STATUS_TEXT;

function displayStatus(status: ListItemStatus): DisplayStatus | null {
  return status === 'gone' ? null : status;
}

export function listValueText(value: string | null): string {
  const entries = parseListValue(value).flatMap((entry) => {
    const status = displayStatus(entry.status);
    return status ? [{ item: entry.item, status }] : [];
  });
  if (entries.length === 0) return '空';
  return entries.map((entry) => `${entry.item}：${LIST_STATUS_TEXT[entry.status]}`).join('、');
}

function historyText(def: ProjStateDef, value: ProjStateValue): string | null {
  if (value.value === null) return null;
  switch (def.display) {
    case 'number':
      return def.config.unit ? `${value.value} ${def.config.unit}` : value.value;
    case 'stage':
    case 'text':
      return value.value;
    case 'list':
      return listValueText(value.value);
  }
}

function displayValue(def: ProjStateDef, head: ProjStateValue, parent: ProjStateValue | null): StatusValue | null {
  const value = head.value;
  if (value === null) return null;
  switch (def.display) {
    case 'number': {
      const current = Number(value);
      const previous = parent?.value === null || parent?.value === undefined ? null : Number(parent.value);
      return {
        display: 'number',
        value: current,
        min: def.config.min,
        max: def.config.max,
        unit: def.config.unit,
        previous: previous !== null && Number.isFinite(previous) ? previous : null,
      };
    }
    case 'stage': {
      const step = stageIndex(def.config, value) + 1;
      const previousStep = parent ? stageIndex(def.config, parent.value ?? '') + 1 : null;
      return {
        display: 'stage',
        stage: value,
        step,
        total: def.config.stages.length,
        previousStep: previousStep !== null && previousStep > 0 ? previousStep : null,
      };
    }
    case 'list': {
      const previousEntries = parent ? parseListValue(parent.value) : [];
      const items = parseListValue(value).flatMap((entry) => {
        const status = displayStatus(entry.status);
        if (!status) return [];
        const before = previousEntries.find((candidate) => candidate.item === entry.item);
        const change: 'new' | 'changed' | null = !parent
          ? null
          : !before
            ? 'new'
            : before.status !== entry.status
              ? 'changed'
              : null;
        return [{ item: entry.item, status, change }];
      });
      return { display: 'list', items };
    }
    case 'text':
      return { display: 'text', value, previous: parent ? parent.value : null };
  }
}

export function buildStatusView(p: StoryProjection, routeId: string): StatusView {
  const headDepth = p.chain.at(-1)?.depth ?? -1;
  const columns: StatusColumnView[] = [];
  const closed: StatusColumnView[] = [];
  const defs = [...p.stateDefs.values()].sort((left, right) => left.originDepth - right.originDepth);
  for (const def of defs) {
    if (def.hidden) continue;
    const head = stateAt(p, def.id, headDepth);
    if (!head || !head.visible) continue;
    const previous = stateAt(p, def.id, headDepth - 1);
    const parent = previous && previous.visible ? previous : null;
    const value = displayValue(def, head, parent);
    if (!value) continue;
    const history = p.stateValues
      .filter((candidate) => candidate.stateDefId === def.id && candidate.visible)
      .sort((left, right) => left.depth - right.depth)
      .flatMap((candidate) => {
        const text = historyText(def, candidate);
        return text === null ? [] : [{ turnId: candidate.turnId, depth: candidate.depth, text }];
      });
    const column: StatusColumnView = {
      id: def.id,
      label: def.label,
      isNew: parent === null,
      changed: head.turnId === p.headTurnId && parent !== null && head.value !== parent.value,
      value,
      history,
    };
    if (head.closed) closed.push(column);
    else columns.push(column);
  }
  return { routeId, headTurnId: p.headTurnId, columns, closed };
}
