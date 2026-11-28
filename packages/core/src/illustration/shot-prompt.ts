import type { IllustrationStyle, PortraitSlot } from '@unwritten/contracts';
import type { SceneMaterials } from '../story/scene-projection.ts';
import { styleFragment } from './style.ts';

export const SHOT_SYSTEM_PROMPT =
  '给故事画一个定格镜头。只用提供的正文、当时可见的人物形象和场景线索。先找这一刻值得画的动作或细节，再选能看清它的构图。写清谁在做什么、朝向谁、手里有什么，以及东西在这一刻的位置或状态。用空间安排和视线区分多人；需要时用近景表现线索，用横图表现人物并排和地形关系，用竖图表现高度。尚未选择的行动、稍后才发生的结果、未揭晓的身份和内心留在画外。' +
  '\n\n' +
  '正面提示用英文。自定义画风只转成画面风格。内容边界只作为约束，不把其中的事实带进提示词或说明。使用提供的当时外貌，人物真名不进入正面或负面提示。选用参考人物时，按画面主次排 REF，把对应的 `{{ref:N}}` 放进正面提示，N 从 1 开始。人物在实际镜头中的朝向另写。没有参考时写可见外貌。主角是否入画照镜头要求。' +
  '\n\n' +
  '画面说明用作品语言，只描述画面上的动作、互动或细节，最多 200 字。明确比例时沿用它。自动比例有多个候选时，从给定的列表里选一个。按给定标签逐行输出，保持每项一行，不另写说明。';

export interface ShotInput {
  materials: SceneMaterials;
  language: string;
  style: IllustrationStyle;
  protagonistInFrame: boolean;
  aspects: string[];
  fixedAspect: string | null;
  referenceViews: Record<string, PortraitSlot[]>;
  maxReferences: number;
  negativePrompt: boolean;
  contentPolicy: string;
}

function oneLine(text: string): string {
  return text.replace(/\r?\n/gu, ' ').trim();
}

function styleText(style: IllustrationStyle): string {
  return styleFragment(style) ?? (style.kind === 'custom' ? style.text : '');
}

function autoAspect(input: ShotInput): boolean {
  return input.fixedAspect === null && input.aspects.length > 1;
}

function aspectText(input: ShotInput): string {
  if (input.fixedAspect !== null) return input.fixedAspect;
  const candidates = input.aspects.join(', ');
  return autoAspect(input) ? `自动选择（${candidates}）` : candidates || '无';
}

export function buildShotPrompt(input: ShotInput): string {
  const body = [
    '【已发生的正文】',
    `地点：${oneLine(input.materials.place ?? '')}`,
    `此前正文或开场处境：${oneLine(input.materials.earlierText ?? '')}`,
  ];
  input.materials.paragraphs.forEach((paragraph, index) => {
    body.push(`[段 ${index + 1}] ${paragraph}`);
  });

  const people = input.materials.people.map((person) => {
    const views = (input.referenceViews[person.code] ?? []).join(', ') || '无';
    return `${person.code} | 称呼=${oneLine(person.knownAs ?? '')} | 形象=${oneLine(person.appearance ?? '')} | 主角=${
      person.isProtagonist ? '是' : '否'
    } | 可用参考=${views}`;
  });
  if (people.length === 0) people.push('无');

  const tags = autoAspect(input) ? 'PROMPT, NEGATIVE, CAPTION, REFS, ASPECT' : 'PROMPT, NEGATIVE, CAPTION, REFS';
  const requirements = [
    '【镜头要求】',
    `作品语言：${oneLine(input.language)}`,
    `画风：${oneLine(styleText(input.style))}`,
    `主角入画：${input.protagonistInFrame ? '是' : '否'}`,
    `比例：${aspectText(input)}`,
    `最多参考图：${input.maxReferences}`,
    `负面提示词：${input.negativePrompt ? '支持' : '留空'}`,
    `内容边界（只作约束）：${oneLine(input.contentPolicy) || '无'}`,
    `输出标签：${tags}`,
  ];

  return [...body, '', '【在场的人】', ...people, '', ...requirements].join('\n');
}

export function buildCorrectionPrompt(original: string, previousOutput: string, errors: string[]): string {
  const lines = ['【你上一次的输出】', previousOutput, '', '【请修正】'];
  for (const error of errors) lines.push(`- ${error}`);
  lines.push('按原格式重写完整结果。');
  return `${original}\n\n${lines.join('\n')}`;
}
