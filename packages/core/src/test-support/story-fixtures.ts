import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { EntityKind, KnowledgeLevel, StateConfig, StateDisplay } from '@unwritten/contracts';
import type { Database } from '../store/db.ts';
import { indexTurnProse } from '../store/prose-index.ts';
import { copyAuthorSetting } from '../story/copy.ts';
import type { FactData, FactKind } from '../story/types.ts';

export interface SeedSpec {
  turns: Array<{
    prose: string;
    action?: string;
    parent?: number;
    place?: string;
    time?: string;
    presentKeys?: string[];
  }>;
  head?: number;
  entities: Array<{
    key: string;
    kind: EntityKind;
    name: string;
    profile?: string;
    protagonist?: boolean;
    originTurn?: number | null;
  }>;
  names?: Array<{
    entity: string;
    name: string;
    holder: string | null;
    originTurn?: number | null;
    para?: number;
  }>;
  facts?: Array<{
    key: string;
    kind: FactKind;
    subject?: string;
    object?: string;
    factKey?: string;
    statement: string;
    data?: FactData;
    originTurn?: number | null;
    para?: number;
  }>;
  knowledge?: Array<{
    fact: string;
    holder: string;
    level: KnowledgeLevel;
    perceived?: string;
    via?: string;
    originTurn?: number | null;
    para?: number;
  }>;
  stateDefs?: Array<{
    key: string;
    label: string;
    display: StateDisplay;
    config?: Partial<StateConfig>;
    hidden?: boolean;
    originTurn?: number | null;
  }>;
  stateValues?: Array<{
    state: string;
    turn: number;
    value: string | null;
    visible: boolean;
    closed?: boolean;
  }>;
}

export interface SeededStory {
  workId: string;
  versionId: string;
  draftVersionId?: string;
  playthroughId: string;
  routeId: string;
  headTurnId: string;
  turnIds: string[];
  ids: Record<string, string>;
}

export function seedStory(db: Database, spec: SeedSpec): SeededStory {
  const workId = randomUUID();
  const versionId = randomUUID();
  const playthroughId = randomUUID();
  const routeId = randomUUID();
  const now = Date.now();
  const turnIds = spec.turns.map(() => randomUUID());
  const entityIds = new Map(spec.entities.map((entity) => [entity.key, randomUUID()]));
  const factIds = new Map((spec.facts ?? []).map((fact) => [fact.key, randomUUID()]));
  const stateDefIds = new Map((spec.stateDefs ?? []).map((def) => [def.key, randomUUID()]));

  db.run(
    sql`insert into works (id, draft_id, published_id, created_at, updated_at)
        values (${workId}, ${versionId}, ${versionId}, ${now}, ${now})`,
  );
  db.run(
    sql`insert into work_versions (id, work_id, kind, content_rev, source_rev, meta, created_at, updated_at)
        values (${versionId}, ${workId}, 'published', 1, 1, '{"background":""}', ${now}, ${now})`,
  );
  db.run(
    sql`insert into playthroughs (id, version_id, kind, root_turn_id, created_at)
        values (${playthroughId}, ${versionId}, 'play', ${turnIds[0] ?? ''}, ${now})`,
  );

  const depths: number[] = [];
  spec.turns.forEach((turn, index) => {
    const parent = turn.parent ?? index - 1;
    depths.push(parent < 0 ? 0 : (depths[parent] ?? 0) + 1);
  });
  spec.turns.forEach((turn, index) => {
    const parent = turn.parent ?? index - 1;
    const presentKeys = turn.presentKeys ?? [];
    const present = presentKeys.map((key) => spec.entities.find((entity) => entity.key === key)?.name ?? key);
    const presentIds = presentKeys.map((key) => entityIds.get(key) ?? '');
    db.run(
      sql`insert into turns (id, playthrough_id, parent_id, depth, action, prose, options, scene, status, created_at)
          values (${turnIds[index] ?? ''}, ${playthroughId}, ${parent < 0 ? null : (turnIds[parent] ?? null)},
                  ${depths[index] ?? 0}, ${turn.action ? JSON.stringify({ text: turn.action, optionIndex: null }) : null},
                  ${turn.prose}, '[]',
                  ${JSON.stringify({ place: turn.place ?? '', time: turn.time ?? '', present, presentIds })},
                  'committed', ${now})`,
    );
  });
  const headIndex = spec.head ?? spec.turns.length - 1;
  db.run(
    sql`insert into routes (id, playthrough_id, head_turn_id, created_at, updated_at)
        values (${routeId}, ${playthroughId}, ${turnIds[headIndex] ?? ''}, ${now}, ${now})`,
  );

  for (const entity of spec.entities) {
    const id = entityIds.get(entity.key) ?? '';
    db.run(
      sql`insert into entities (version_id, id, kind, name, profile, is_protagonist, origin_turn_id)
          values (${versionId}, ${id}, ${entity.kind}, ${entity.name},
                  ${JSON.stringify({ text: entity.profile ?? '' })}, ${entity.protagonist ? 1 : 0},
                  ${entity.originTurn === undefined || entity.originTurn === null ? null : (turnIds[entity.originTurn] ?? null)})`,
    );
  }
  for (const name of spec.names ?? []) {
    db.run(
      sql`insert into entity_names (version_id, entity_id, name, holder_id, origin_turn_id, source_para)
          values (${versionId}, ${entityIds.get(name.entity) ?? ''}, ${name.name},
                  ${name.holder === null ? null : (entityIds.get(name.holder) ?? null)},
                  ${name.originTurn === undefined || name.originTurn === null ? null : (turnIds[name.originTurn] ?? null)},
                  ${name.para ?? null})`,
    );
  }
  for (const fact of spec.facts ?? []) {
    db.run(
      sql`insert into facts (version_id, id, origin_turn_id, source_para, kind, subject_id, object_id, key, statement, data)
          values (${versionId}, ${factIds.get(fact.key) ?? ''},
                  ${fact.originTurn === undefined || fact.originTurn === null ? null : (turnIds[fact.originTurn] ?? null)},
                  ${fact.para ?? null}, ${fact.kind},
                  ${fact.subject ? (entityIds.get(fact.subject) ?? null) : null},
                  ${fact.object ? (entityIds.get(fact.object) ?? null) : null},
                  ${fact.factKey ?? null}, ${fact.statement},
                  ${fact.data ? JSON.stringify(fact.data) : null})`,
    );
  }
  for (const record of spec.knowledge ?? []) {
    db.run(
      sql`insert into knowledge (version_id, fact_id, holder_id, level, perceived_statement, via_id, origin_turn_id, source_para)
          values (${versionId}, ${factIds.get(record.fact) ?? ''}, ${entityIds.get(record.holder) ?? ''},
                  ${record.level}, ${record.perceived ?? null},
                  ${record.via ? (entityIds.get(record.via) ?? null) : null},
                  ${record.originTurn === undefined || record.originTurn === null ? null : (turnIds[record.originTurn] ?? null)},
                  ${record.para ?? null})`,
    );
  }
  for (const def of spec.stateDefs ?? []) {
    const config: StateConfig = {
      min: null,
      max: null,
      unit: null,
      stages: [],
      ...def.config,
    };
    db.run(
      sql`insert into state_defs (version_id, id, key, label, display, config, hidden, reveal, origin_turn_id, rev)
          values (${versionId}, ${stateDefIds.get(def.key) ?? ''}, ${def.key}, ${def.label}, ${def.display},
                  ${JSON.stringify(config)}, ${def.hidden ? 1 : 0}, null,
                  ${def.originTurn === undefined || def.originTurn === null ? null : (turnIds[def.originTurn] ?? null)}, 0)`,
    );
  }
  for (const value of spec.stateValues ?? []) {
    db.run(
      sql`insert into state_values (version_id, turn_id, state_def_id, value, visible, closed)
          values (${versionId}, ${turnIds[value.turn] ?? ''}, ${stateDefIds.get(value.state) ?? ''},
                  ${value.value}, ${value.visible ? 1 : 0}, ${value.closed ? 1 : 0})`,
    );
  }
  spec.turns.forEach((turn, index) => indexTurnProse(db, turnIds[index] ?? '', turn.prose));

  const ids: Record<string, string> = {};
  for (const [key, id] of entityIds) ids[key] = id;
  for (const [key, id] of factIds) ids[key] = id;
  for (const [key, id] of stateDefIds) ids[`state:${key}`] = id;

  return {
    workId,
    versionId,
    playthroughId,
    routeId,
    headTurnId: turnIds[headIndex] ?? '',
    turnIds,
    ids,
  };
}

export function seedNorthCape(db: Database, options?: { head?: number }): SeededStory {
  return seedStory(db, {
    head: options?.head,
    turns: [
      {
        prose:
          '雨下到第三天，北岬灯塔的灯还亮着。你提着行李走上栈桥，木板在脚下吱呀作响。\n\n栈桥尽头站着一个撑伞的女人。她把伞往你这边倾了倾，说末班渡轮已经停航。\n\n灯塔看守老周从值班室探出头，朝你们招手。',
        place: '北岬栈桥',
        time: '第三天傍晚',
        presentKeys: ['shen', 'zhou'],
      },
      {
        action: '把行李交给老周，问他今晚能不能借宿',
        prose: '老周接过行李，说值班室后面还有一张空床。\n\n撑伞的女人没有跟进来，她站在门口，看着海面。',
        place: '北岬栈桥',
        time: '第三天傍晚',
        presentKeys: ['shen', 'zhou'],
      },
      {
        action: '问撑伞的女人叫什么名字',
        prose: '她说她叫沈岚，在等下一班船。\n\n老周把一把铜钥匙放在桌上，说灯塔顶层的门只有这一把钥匙。',
        place: '北岬灯塔值班室',
        time: '第三天夜里',
        presentKeys: ['shen', 'zhou'],
      },
    ],
    entities: [
      { key: 'lin', kind: 'character', name: '林远', profile: '刚到北岬的邮差', protagonist: true },
      { key: 'shen', kind: 'character', name: '沈岚', profile: '说话很慢，总带着一把黑伞' },
      { key: 'zhou', kind: 'character', name: '老周', profile: '灯塔看守，话不多' },
      { key: 'tower', kind: 'place', name: '北岬灯塔', profile: '岬角尽头的白色灯塔' },
      { key: 'brassKey', kind: 'item', name: '铜钥匙', profile: '灯塔顶层门的钥匙', originTurn: 2 },
    ],
    names: [
      { entity: 'lin', name: '林远', holder: 'lin', originTurn: 0, para: 1 },
      { entity: 'shen', name: '撑伞的女人', holder: 'lin', originTurn: 0, para: 2 },
      { entity: 'shen', name: '沈岚', holder: 'lin', originTurn: 2, para: 1 },
      { entity: 'zhou', name: '老周', holder: 'lin', originTurn: 0, para: 3 },
      { entity: 'tower', name: '北岬灯塔', holder: 'lin', originTurn: 0, para: 1 },
      { entity: 'brassKey', name: '铜钥匙', holder: 'lin', originTurn: 2, para: 2 },
    ],
    facts: [
      {
        key: 'meet',
        kind: 'relation',
        subject: 'lin',
        object: 'shen',
        factKey: 'acquaintance',
        statement: '主角在栈桥上遇见撑伞的女人',
        data: { stage: 'met' },
        originTurn: 0,
        para: 2,
      },
      {
        key: 'ferry',
        kind: 'event',
        subject: 'shen',
        object: 'lin',
        statement: '沈岚告诉主角末班渡轮已经停航',
        originTurn: 0,
        para: 2,
      },
      {
        key: 'wait',
        kind: 'trait',
        subject: 'shen',
        factKey: '等待',
        statement: '她在等下一班船',
        originTurn: 2,
        para: 1,
      },
      {
        key: 'keyOnTable',
        kind: 'event',
        subject: 'zhou',
        object: 'brassKey',
        statement: '老周把灯塔顶层的铜钥匙放在桌上',
        originTurn: 2,
        para: 2,
      },
    ],
    knowledge: [
      { fact: 'ferry', holder: 'lin', level: 'confirmed', originTurn: 0, para: 2 },
      { fact: 'ferry', holder: 'shen', level: 'confirmed', originTurn: 0, para: 2 },
      { fact: 'keyOnTable', holder: 'lin', level: 'confirmed', originTurn: 2, para: 2 },
      { fact: 'keyOnTable', holder: 'zhou', level: 'confirmed', originTurn: 2, para: 2 },
      { fact: 'wait', holder: 'lin', level: 'confirmed', originTurn: 2, para: 1 },
    ],
  });
}

export function seedLighthouseTown(db: Database): SeededStory {
  const keySceneId = randomUUID();
  const openingProse =
    '船靠岸的时候，整座镇子黑着。\n\n{{protagonist.名字}}拎着邮袋走下跳板，只看见山顶的灯塔还亮着。\n\n一个提着马灯的人站在码头尽头，像是在等谁。';
  const background = '灯塔镇只在夜里通电。新来的邮差要把一袋没有收件人的旧信送出去。';
  const seeded = seedStory(db, {
    turns: [
      {
        prose: openingProse,
        place: '码头',
        time: '夜里',
        presentKeys: ['linchao'],
      },
      {
        action: '向守灯人问路',
        prose: '守灯人抬手指了指山顶的灯。\n\n他说，邮局在街尾，灯塔不在镇上。',
        place: '码头',
        time: '夜里',
        presentKeys: ['linchao'],
      },
      {
        action: '独自登上灯塔顶',
        prose: '你推开灯塔顶层的门，风从窗口灌进来。\n\n守灯人已经站在里面，他说起上一任邮差的事。',
        place: '灯塔顶',
        time: '深夜',
        presentKeys: ['linchao'],
      },
    ],
    entities: [
      { key: 'protagonist', kind: 'character', name: '新来的邮差', profile: '二十多岁，记性好', protagonist: true },
      { key: 'linchao', kind: 'character', name: '林潮', profile: '守灯人，五十岁上下，话少' },
      { key: 'lighthouse', kind: 'place', name: '灯塔', profile: '山顶的灯塔，只在夜里亮着' },
      { key: 'postOffice', kind: 'place', name: '邮局', profile: '镇尾的邮局' },
    ],
    names: [
      { entity: 'protagonist', name: '新来的邮差', holder: 'protagonist', originTurn: 0, para: 1 },
      { entity: 'linchao', name: '守灯人', holder: 'protagonist', originTurn: 0, para: 3 },
      { entity: 'lighthouse', name: '灯塔', holder: 'protagonist', originTurn: 0, para: 2 },
      { entity: 'postOffice', name: '邮局', holder: 'protagonist', originTurn: 1, para: 2 },
      { entity: 'linchao', name: '林潮', holder: 'protagonist', originTurn: 2, para: 2 },
    ],
    facts: [
      {
        key: 'secret',
        kind: 'secret',
        subject: 'linchao',
        statement: '上一任邮差在灯塔里住过一年，后来乘夜船离开',
        data: { title: '上一任邮差的去向', reveal: '主角拿到第三封旧信时' },
        para: 2,
      },
      {
        key: 'sceneHit',
        kind: 'scene_hit',
        factKey: keySceneId,
        statement: '关键场面已经发生。',
        originTurn: 2,
        para: 2,
      },
      {
        key: 'askWay',
        kind: 'event',
        subject: 'linchao',
        object: 'protagonist',
        statement: '主角向守灯人问路',
        originTurn: 1,
        para: 1,
      },
      {
        key: 'previousPostman',
        kind: 'event',
        subject: 'linchao',
        statement: '林潮讲起上一任邮差',
        originTurn: 2,
        para: 2,
      },
    ],
    knowledge: [
      { fact: 'secret', holder: 'linchao', level: 'confirmed', para: 2 },
      { fact: 'askWay', holder: 'protagonist', level: 'confirmed', originTurn: 1, para: 1 },
      { fact: 'askWay', holder: 'linchao', level: 'confirmed', originTurn: 1, para: 1 },
      { fact: 'previousPostman', holder: 'protagonist', level: 'confirmed', originTurn: 2, para: 2 },
      { fact: 'previousPostman', holder: 'linchao', level: 'confirmed', originTurn: 2, para: 2 },
    ],
    stateDefs: [
      { key: '潮位', label: '潮位', display: 'number', config: { min: 0, max: 10, unit: '米' } },
      { key: '信任', label: '信任', display: 'stage', config: { stages: ['陌生', '相识', '信任', '决裂'] } },
      { key: '旧信', label: '旧信', display: 'list' },
      { key: '真名', label: '真名', display: 'text', hidden: true },
    ],
    stateValues: [
      { state: '潮位', turn: 0, value: '3', visible: true },
      { state: '信任', turn: 0, value: '陌生', visible: false },
      { state: '旧信', turn: 0, value: '[]', visible: true },
      { state: '信任', turn: 1, value: '相识', visible: true },
      { state: '旧信', turn: 2, value: '[{"item":"第一封","status":"done"}]', visible: true },
    ],
  });

  const protagonistId = seeded.ids.protagonist ?? '';
  const linchaoId = seeded.ids.linchao ?? '';
  const lighthouseId = seeded.ids.lighthouse ?? '';
  const secretId = seeded.ids.secret ?? '';
  const tideId = seeded.ids['state:潮位'] ?? '';
  const trustId = seeded.ids['state:信任'] ?? '';
  const lettersId = seeded.ids['state:旧信'] ?? '';
  const realNameId = seeded.ids['state:真名'] ?? '';

  const settings = {
    world: { text: '灯塔镇只在夜里通电。', rev: 0 },
    protagonist: {
      text: '新来的邮差，二十多岁，记性好。',
      fields: [
        { name: '名字', defaultValue: '阿岚', isName: true },
        { name: '职业', defaultValue: '邮差', isName: false },
      ],
      rev: 0,
    },
    cast: { text: '主要人物固定。', mode: 'fixed', rev: 0 },
    secrets: { text: '每个人都藏着一点旧事。', rev: 0 },
    opening: { text: openingProse, mode: 'author_text', rev: 0 },
    actions: { text: '', hints: 'known_consequences', rev: 0 },
    scenes: { text: '', rev: 0 },
    status: { text: '', rev: 0 },
  };

  const planItems = [
    { id: randomUUID(), source: 'ai', kind: 'summary', key: 'identity', text: '刚下船的邮差，谁也不认识' },
    { id: randomUUID(), source: 'ai', kind: 'summary', key: 'tone', text: '安静，带一点悬疑' },
    { id: randomUUID(), source: 'ai', kind: 'summary', key: 'situation', text: '最后一班船靠岸时，镇上停了电' },
    { id: randomUUID(), source: 'ai', kind: 'summary', key: 'world', text: '灯塔镇只在夜里通电' },
    {
      id: protagonistId,
      source: 'author',
      kind: 'entity',
      entityKind: 'character',
      role: 'protagonist',
      name: '新来的邮差',
      knownAs: null,
      profile: '二十多岁，记性好',
      appearance: null,
      slot: null,
    },
    {
      id: linchaoId,
      source: 'author',
      kind: 'entity',
      entityKind: 'character',
      role: 'cast',
      name: '林潮',
      knownAs: '守灯人',
      profile: '守灯人，五十岁上下，话少',
      appearance: null,
      slot: null,
    },
    {
      id: lighthouseId,
      source: 'author',
      kind: 'entity',
      entityKind: 'place',
      role: 'other',
      name: '灯塔',
      knownAs: null,
      profile: '山顶的灯塔，只在夜里亮着',
      appearance: null,
      slot: null,
    },
    {
      id: secretId,
      source: 'author',
      kind: 'secret',
      title: '上一任邮差的去向',
      statement: '上一任邮差在灯塔里住过一年，后来乘夜船离开',
      subjectId: linchaoId,
      knowerIds: [linchaoId],
      reveal: '主角拿到第三封旧信时',
    },
    {
      id: tideId,
      source: 'author',
      kind: 'state',
      key: '潮位',
      label: '潮位',
      display: 'number',
      config: { min: 0, max: 10, unit: '米', stages: [] },
      hidden: false,
      reveal: '',
      initial: '3',
    },
    {
      id: trustId,
      source: 'author',
      kind: 'state',
      key: '信任',
      label: '信任',
      display: 'stage',
      config: { min: null, max: null, unit: null, stages: ['陌生', '相识', '信任', '决裂'] },
      hidden: false,
      reveal: '',
      initial: '陌生',
    },
    {
      id: lettersId,
      source: 'author',
      kind: 'state',
      key: '旧信',
      label: '旧信',
      display: 'list',
      config: { min: null, max: null, unit: null, stages: [] },
      hidden: false,
      reveal: '',
      initial: '[]',
    },
    {
      id: realNameId,
      source: 'author',
      kind: 'state',
      key: '真名',
      label: '真名',
      display: 'text',
      config: { min: null, max: null, unit: null, stages: [] },
      hidden: true,
      reveal: '主角拿到第三封旧信时',
      initial: null,
    },
    {
      id: keySceneId,
      source: 'author',
      kind: 'scene',
      condition: '主角第一次独自登上灯塔顶',
      outcome: '林潮讲起上一任邮差',
      once: true,
    },
    { id: randomUUID(), source: 'author', kind: 'ending', text: '三封旧信都送到收件人手里' },
  ];
  const keyScenes = [
    { id: keySceneId, condition: '主角第一次独自登上灯塔顶', outcome: '林潮讲起上一任邮差', once: true },
  ];
  const ending = '三封旧信都送到收件人手里';

  const draftVersionId = randomUUID();
  const now = Date.now();
  const plan = { items: planItems, conflicts: [], confirmedRev: 1 };
  const draftMeta = {
    background,
    settings,
    plan,
    keyScenes,
    ending,
    wizardStep: 'opening',
  };
  const publishedMeta = {
    background,
    settings,
    plan,
    keyScenes,
    ending,
    narration: { language: 'zh-CN' },
    opening: {
      prose: openingProse,
      options: [
        { text: '向提灯的人问路', hint: '他会告诉你灯塔在哪里' },
        { text: '先去邮局', hint: null },
      ],
      scene: { place: '码头', time: '夜里', present: ['守灯人'], presentIds: [linchaoId] },
      changes: {
        entities: [
          {
            line: 1,
            kind: 'character',
            name: '新来的邮差',
            knownAs: null,
            profile: '二十多岁，记性好',
            para: 1,
            protagonist: true,
            slot: null,
          },
          {
            line: 2,
            kind: 'character',
            name: '林潮',
            knownAs: '守灯人',
            profile: '守灯人，五十岁上下，话少',
            para: 3,
            protagonist: false,
            slot: null,
          },
          {
            line: 3,
            kind: 'place',
            name: '灯塔',
            knownAs: null,
            profile: '山顶的灯塔，只在夜里亮着',
            para: 2,
            protagonist: false,
            slot: null,
          },
        ],
        names: [],
        facts: [
          {
            line: 4,
            kind: 'event',
            subject: { created: 2 },
            object: { created: 1 },
            key: null,
            statement: '一个提着马灯的人站在码头尽头，像是在等谁',
            data: null,
            para: 3,
            witnesses: [{ created: 1 }, { created: 2 }],
          },
        ],
        knowledge: [],
        scene: null,
        states: [],
        stateItems: [],
        newStates: [],
        secrets: [],
        sceneHits: [],
      },
      createdIds: { '1': protagonistId, '2': linchaoId, '3': lighthouseId },
      initialState: [
        { stateDefId: tideId, value: '3', visible: true },
        { stateDefId: trustId, value: '陌生', visible: false },
        { stateDefId: lettersId, value: '[]', visible: true },
      ],
      template: false,
    },
  };

  db.run(
    sql`insert into work_versions (id, work_id, kind, content_rev, meta, created_at, updated_at)
        values (${draftVersionId}, ${seeded.workId}, 'draft', 1, '{"background":""}', ${now}, ${now})`,
  );
  copyAuthorSetting(db, { fromVersionId: seeded.versionId, toVersionId: draftVersionId });
  db.run(sql`update work_versions set meta = ${JSON.stringify(draftMeta)} where id = ${draftVersionId}`);
  db.run(sql`update work_versions set meta = ${JSON.stringify(publishedMeta)} where id = ${seeded.versionId}`);
  db.run(sql`update works set draft_id = ${draftVersionId} where id = ${seeded.workId}`);

  return {
    ...seeded,
    draftVersionId,
    ids: { ...seeded.ids, 'scene:towerTop': keySceneId },
  };
}
