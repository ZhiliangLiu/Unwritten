import type { ChainTurn, StoryProjection } from './types.ts';
import { KIND_LABEL } from './render.ts';

export type Resolved = { ok: true; id: string } | { ok: false; error: string };

export interface CodeBook {
  entityCode(entityId: string): string;
  factCode(factId: string): string;
  resolveEntity(token: string): Resolved;
  resolveFact(token: string): Resolved;
  resolveTurn(token: string): { ok: true; turn: ChainTurn } | { ok: false; error: string };
  issuedEntityIds(): string[];
  issuedFactIds(): string[];
}

export function createCodeBook(p: StoryProjection): CodeBook {
  const entityCodes = new Map<string, string>();
  const factCodes = new Map<string, string>();
  const reverseEntities = new Map<string, string>();
  const reverseFacts = new Map<string, string>();
  let nextEntity = 1;
  let nextFact = 1;

  const entityCode = (entityId: string): string => {
    const existing = entityCodes.get(entityId);
    if (existing) return existing;
    const code = `@${nextEntity}`;
    nextEntity += 1;
    entityCodes.set(entityId, code);
    reverseEntities.set(code, entityId);
    return code;
  };

  const factCode = (factId: string): string => {
    const existing = factCodes.get(factId);
    if (existing) return existing;
    const code = `#${nextFact}`;
    nextFact += 1;
    factCodes.set(factId, code);
    reverseFacts.set(code, factId);
    return code;
  };

  entityCode(p.protagonistId);

  return {
    entityCode,
    factCode,
    resolveEntity(token: string): Resolved {
      const trimmed = token.trim();
      const numbered = /^@(\d+)$/.exec(trimmed);
      if (numbered) {
        const entityId = reverseEntities.get(trimmed);
        if (entityId) return { ok: true, id: entityId };
        return { ok: false, error: `编号 ${trimmed} 不是本次给出的编号。` };
      }
      const candidates = p.names
        .filter((name) => name.name === trimmed)
        .map((name) => name.entityId)
        .filter((entityId, index, list) => list.indexOf(entityId) === index)
        .filter((entityId) => entityCodes.has(entityId));
      for (const entity of p.entities.values()) {
        if (entity.name === trimmed && entityCodes.has(entity.id) && !candidates.includes(entity.id)) {
          candidates.push(entity.id);
        }
      }
      if (candidates.length === 0) {
        return { ok: false, error: `找不到名为「${trimmed}」的人物或事物。请用编号引用，或先查 list_catalog。` };
      }
      if (candidates.length > 1) {
        const list = candidates
          .map((entityId) => {
            const entity = p.entities.get(entityId);
            const code = entityCode(entityId);
            return `${code}（${entity ? KIND_LABEL[entity.kind] : '其他'}，${entity?.name ?? ''}）`;
          })
          .join('、');
        return { ok: false, error: `「${trimmed}」对应多个：${list}。请用编号指明。` };
      }
      return { ok: true, id: candidates[0]! };
    },
    resolveFact(token: string): Resolved {
      const trimmed = token.trim();
      const factId = reverseFacts.get(trimmed);
      if (factId) return { ok: true, id: factId };
      return { ok: false, error: `编号 ${trimmed} 不是本次给出的事实编号。` };
    },
    resolveTurn(token: string): { ok: true; turn: ChainTurn } | { ok: false; error: string } {
      const trimmed = token.trim();
      const match = /^T(\d+)$/.exec(trimmed);
      if (!match) return { ok: false, error: `本路线没有回合 ${trimmed}。` };
      const turn = p.chain.find((candidate) => candidate.depth === Number(match[1]));
      if (!turn) return { ok: false, error: `本路线没有回合 ${trimmed}。` };
      return { ok: true, turn };
    },
    issuedEntityIds() {
      return [...entityCodes.keys()];
    },
    issuedFactIds() {
      return [...factCodes.keys()];
    },
  };
}
