import type { CastMode, OpeningMode, Preview } from '@unwritten/contracts';
import { LanguageTagSchema } from '@unwritten/contracts';
import { listValueText } from '../story/status.ts';
import type { OpeningField, OpeningProposal, OpeningProposalContext } from '../story/opening-proposal.ts';
import { fixedTextPlaceholderErrors, parseOpeningProposal } from '../story/opening-proposal.ts';
import type { ProjStateDef, ValidatedChanges } from '../story/types.ts';

export const PREVIEW_TOOL_NAME = 'propose_preview';

export const PREVIEW_LIMITS = {
  titleMax: 40,
  blurbMax: 200,
  publicSettingMax: 1_000,
} as const;

export function previewToolParameters(mode: OpeningMode, castMode: CastMode): Record<string, unknown> {
  const slotNote =
    castMode === 'per_run' ? '每个人物位置用一行 new_entity 登记一个具体的人，加上 "slot":"位置编号"。\n' : '';
  const properties: Record<string, unknown> = {
    title: { type: 'string', description: '作品标题' },
    blurb: { type: 'string', description: '给玩家看的简介，一两句话，不剧透' },
    public_setting: { type: 'string', description: '简短的公开设定：世界、主角身份和处境' },
    options: {
      type: 'string',
      description: '推荐行动，每行一个 JSON：{"text":"…"}。【行动提示】要求提醒时写 {"text":"…","hint":"…"}',
    },
    place: { type: 'string', description: '开场结束时主角所在的地点' },
    time: { type: 'string', description: '开场结束时的故事时间' },
    language: { type: 'string', description: '作品语言的语言标签，例如 zh-CN' },
    present: {
      type: 'string',
      description: '开场结束时在场的人物，写 @编号 或本次新增人物的名字，用逗号分隔。只有主角时留空',
    },
    changes: {
      type: 'string',
      description:
        '每行一个 JSON。引用方案里的人物和事物写 @编号；引用本次新写的事实，先给那行起一个 "id"（如 "f1"），再写这个 id。para 是出处在正文里的段号，从 1 起。主角已经在方案里，不要新增主角。' +
        slotNote +
        '可用的类型：\n' +
        '{"type":"new_entity","kind":"character|place|item|group|other","name":"真名","known_as":"主角此刻的称呼，正文或选项会写到它时必填","profile":"一句话档案","para":"1"}\n' +
        '{"type":"name","entity":"@2","name":"称呼","holder":"@1","para":"2"}\n' +
        '{"type":"event","subject":"@2","object":"@1","statement":"一句话","witnesses":"@1,@2","para":"2"}\n' +
        '{"type":"trait","subject":"@2","key":"特征名","statement":"一句话","para":"2"}\n' +
        '{"type":"relation","subject":"@1","object":"@2","key":"acquaintance","stage":"heard_of|met|familiar","statement":"一句话","para":"2"}\n' +
        '{"type":"promise","subject":"@2","object":"@1","key":"约定名","status":"agreed|kept|broken","statement":"一句话","para":"3"}\n' +
        '{"type":"knowledge","fact":"f1","holder":"@1","level":"heard|suspects|confirmed|misled","perceived_statement":"他听到或相信的说法","via":"@2","para":"3"}\n' +
        '引用本次新写的事实要给它起 "id"，例如 {"type":"event",…,"id":"f1"}；每行的 id 不能重复。\n' +
        '开场里的 event 必须写明 witnesses。',
    },
    state: {
      type: 'string',
      description:
        '开局时状态栏的值，每行一个 JSON。数字、阶段、文字栏目：{"key":"栏目 key","value":"值","visible":"true|false"}；清单栏目每个条目一行：{"key":"栏目 key","item":"条目","status":"open"}。没写的栏目用方案里的开局值；没有要改的填空字符串',
    },
  };
  if (mode !== 'author_text') properties.prose = { type: 'string', description: '开场正文，段落之间空一行' };
  const required = [
    'title',
    'blurb',
    'public_setting',
    ...(mode === 'author_text' ? [] : ['prose']),
    'options',
    'place',
    'time',
    'language',
    'present',
    'changes',
    'state',
  ];
  return { type: 'object', properties, required, additionalProperties: false };
}

export type PreviewField = 'title' | 'blurb' | 'public_setting' | 'language' | OpeningField;

export interface PreviewParseResult {
  preview: Preview;
  changes: ValidatedChanges;
  initialState: OpeningProposal['initialState'];
  slotOf: Map<number, string>;
}

export type PreviewParse =
  { ok: true; value: PreviewParseResult } | { ok: false; errors: string[]; fields: PreviewField[] };

function initialStateText(def: ProjStateDef, value: string): string {
  if (def.display === 'list') return listValueText(value);
  if (def.display === 'number' && def.config.unit) return `${value} ${def.config.unit}`;
  return value;
}

export function parsePreviewArgs(args: Record<string, unknown>, ctx: OpeningProposalContext): PreviewParse {
  const errors: string[] = [];
  const fields = new Set<PreviewField>();
  const fail = (field: PreviewField, message: string) => {
    fields.add(field);
    errors.push(message);
  };
  const text = (field: 'title' | 'blurb' | 'public_setting' | 'language'): string | null => {
    const value = args[field];
    if (typeof value !== 'string') {
      fail(field, `参数 ${field} 必须是字符串`);
      return null;
    }
    return value;
  };

  const title = text('title')?.trim() ?? null;
  const blurb = text('blurb')?.trim() ?? null;
  const publicSetting = text('public_setting')?.trim() ?? null;
  const language = text('language');

  const required: Array<[PreviewField, string | null, number]> = [
    ['title', title, PREVIEW_LIMITS.titleMax],
    ['blurb', blurb, PREVIEW_LIMITS.blurbMax],
    ['public_setting', publicSetting, PREVIEW_LIMITS.publicSettingMax],
  ];
  for (const [name, value, max] of required) {
    if (value === null) continue;
    if (!value) fail(name, `参数 ${name} 不能为空`);
    else if (Array.from(value).length > max) fail(name, `参数 ${name} 不能超过 ${max} 个字符`);
  }
  for (const [name, value] of required) {
    if (!value) continue;
    for (const message of fixedTextPlaceholderErrors(`参数 ${name}`, value, ctx.forbiddenNames)) {
      fail('placeholder', message);
    }
  }
  if (language !== null && !LanguageTagSchema.safeParse(language).success) {
    fail('language', '参数 language 必须是合法的语言标签');
  }

  const proposal = parseOpeningProposal(args, ctx);
  if (!proposal.ok) {
    for (const message of proposal.errors) errors.push(message);
    for (const field of proposal.fields) fields.add(field);
  }
  if (errors.length || !proposal.ok) return { ok: false, errors, fields: [...fields] };

  const value = proposal.value;
  const cast = value.changes.entities
    .filter((entity) => !entity.protagonist)
    .map((entity) => ({
      kind: entity.kind,
      name: entity.name,
      knownAs: entity.knownAs,
      profile: entity.profile,
      protagonist: false,
    }));
  const defById = new Map([...ctx.projection.stateDefs.values()].map((def) => [def.id, def]));
  return {
    ok: true,
    value: {
      preview: {
        title: title ?? '',
        blurb: blurb ?? '',
        publicSetting: publicSetting ?? '',
        prose: value.prose,
        options: value.options,
        scene: { place: value.scene.place, time: value.scene.time },
        language: language ?? '',
        cast,
        needsReview: value.needsReview,
        initialState: value.initialState.flatMap((entry) => {
          const def = defById.get(entry.stateDefId);
          if (!def || entry.value === null) return [];
          return [{ label: def.label, text: initialStateText(def, entry.value), visible: entry.visible }];
        }),
      },
      changes: value.changes,
      initialState: value.initialState,
      slotOf: value.slotOf,
    },
  };
}
