#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppearanceSchema } from '../packages/contracts/src/schemas/appearance.ts';
import { buildCss } from '../packages/tokens/build-css.mjs';

const tokensPath =
  process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'tokens', 'tokens.json');
const document = JSON.parse(readFileSync(tokensPath, 'utf8'));
const errors = [];
const REFERENCE = /^\{([^{}]+)\}$/;

const tokens = new Map();
function collectTokens(node, path, inheritedType) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    errors.push(`${path}: token 或分组必须是对象`);
    return;
  }
  const type = node.$type ?? inheritedType;
  if ('$value' in node) {
    if (!type) errors.push(`${path}: 缺少 $type`);
    tokens.set(path, { type, value: node.$value, extensions: node.$extensions?.unwritten ?? {} });
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    collectTokens(child, path ? `${path}.${key}` : key, type);
  }
}
collectTokens(document, '', undefined);

function resolveToken(path, seen = [], overrides) {
  if (seen.includes(path)) throw new Error(`循环引用：${[...seen, path].join(' → ')}`);
  const token = tokens.get(path);
  if (!token) throw new Error(`引用的 token 不存在：${path}`);
  const replacement = overrides?.get(path);
  return {
    type: token.type,
    value: resolveValue((replacement ?? token).value, [...seen, path], overrides, !!replacement),
  };
}

function resolveValue(value, seen, overrides, originalIfCovered) {
  const reference = typeof value === 'string' && REFERENCE.exec(value);
  if (reference) {
    if (originalIfCovered && overrides.has(reference[1])) return resolveToken(reference[1]).value;
    return resolveToken(reference[1], seen, overrides).value;
  }
  const resolveItem = (item) => resolveValue(item, seen, overrides, originalIfCovered);
  if (Array.isArray(value)) return value.map(resolveItem);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveItem(item)]));
  }
  return value;
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const COMPOSITE_FIELDS = {
  shadow: { color: 'color', offsetX: 'dimension', offsetY: 'dimension', blur: 'dimension', spread: 'dimension' },
  transition: { duration: 'duration', delay: 'duration', timingFunction: 'cubicBezier' },
  typography: {
    fontFamily: 'fontFamily',
    fontSize: 'dimension',
    fontWeight: 'fontWeight',
    letterSpacing: 'dimension',
    lineHeight: 'number',
  },
};

function shapeProblem(type, value) {
  switch (type) {
    case 'color': {
      if (value?.colorSpace !== 'srgb') return 'colorSpace 必须是 srgb';
      const { components, alpha, hex } = value;
      if (
        !Array.isArray(components) ||
        components.length !== 3 ||
        !components.every((c) => isNumber(c) && c >= 0 && c <= 1)
      ) {
        return 'components 必须是三个 0–1 的数';
      }
      if (alpha !== undefined && !(isNumber(alpha) && alpha >= 0 && alpha <= 1)) return 'alpha 必须在 0–1 之间';
      const hexFromComponents = `#${components
        .map((c) =>
          Math.round(c * 255)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')}`;
      if (hex !== undefined && (typeof hex !== 'string' || hex.toLowerCase() !== hexFromComponents)) {
        return `hex ${hex} 和 components 不一致`;
      }
      return null;
    }
    case 'dimension':
      return isNumber(value?.value) && ['px', 'rem'].includes(value.unit) ? null : '必须是 { value, unit: px | rem }';
    case 'duration':
      return isNumber(value?.value) && value.value >= 0 && ['ms', 's'].includes(value.unit)
        ? null
        : '必须是 { value ≥ 0, unit: ms | s }';
    case 'cubicBezier':
      return Array.isArray(value) &&
        value.length === 4 &&
        value.every(isNumber) &&
        [value[0], value[2]].every((x) => x >= 0 && x <= 1)
        ? null
        : '必须是四个数，x 坐标在 0–1 之间';
    case 'number':
      return isNumber(value) ? null : '必须是数字';
    case 'fontWeight':
      return isNumber(value) && value >= 1 && value <= 1000 ? null : '必须是 1–1000 的数字';
    case 'fontFamily':
      return typeof value === 'string' ||
        (Array.isArray(value) && value.length > 0 && value.every((f) => typeof f === 'string'))
        ? null
        : '必须是字体名或字体名数组';
    case 'shadow': {
      const layers = [value].flat(Infinity);
      if (!layers.length) return '至少需要一层投影';
      for (const layer of layers) {
        const problem = compositeProblem('shadow', layer);
        if (problem) return problem;
        if (layer.inset !== undefined && typeof layer.inset !== 'boolean') return 'inset 必须是布尔值';
      }
      return null;
    }
    case 'transition':
    case 'typography':
      return compositeProblem(type, value);
    default:
      return `不支持的 $type：${type}`;
  }
}

function compositeProblem(type, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '必须是对象';
  for (const [field, fieldType] of Object.entries(COMPOSITE_FIELDS[type])) {
    if (!(field in value)) return `缺少 ${field}`;
    const problem = shapeProblem(fieldType, value[field]);
    if (problem) return `${field}：${problem}`;
  }
  return null;
}

function referencedTypeProblem(value, expectedType) {
  const reference = typeof value === 'string' && REFERENCE.exec(value);
  if (reference) {
    const target = tokens.get(reference[1]);
    return target && target.type !== expectedType
      ? `引用 ${reference[1]} 的类型是 ${target.type}，这里需要 ${expectedType}`
      : null;
  }
  if (COMPOSITE_FIELDS[expectedType] && value && typeof value === 'object') {
    for (const layer of Array.isArray(value) ? value : [value]) {
      if (expectedType === 'shadow' && typeof layer === 'string') {
        const problem = referencedTypeProblem(layer, 'shadow');
        if (problem) return problem;
        continue;
      }
      for (const [field, fieldType] of Object.entries(COMPOSITE_FIELDS[expectedType])) {
        const problem = referencedTypeProblem(layer?.[field], fieldType);
        if (problem) return problem;
      }
    }
  }
  return null;
}

const resolved = new Map();
for (const [path, token] of tokens) {
  try {
    const typeProblem = referencedTypeProblem(token.value, token.type);
    if (typeProblem) errors.push(`${path}: ${typeProblem}`);
    const value = resolveToken(path).value;
    const problem = shapeProblem(token.type, value);
    if (problem) errors.push(`${path}: ${problem}`);
    else resolved.set(path, value);
    if (token.extensions.unit === 'em' && token.type !== 'number') errors.push(`${path}: 只有 number 可以标 em`);
  } catch (error) {
    errors.push(`${path}: ${error.message}`);
  }
}

const READING_PREFERENCES = [
  ['font', 'fontFamily', 'proseFont'],
  ['size', 'dimension', 'proseSize'],
  ['leading', 'number', 'proseLeading'],
  ['indent', 'number', 'proseIndent'],
];
for (const [name, type, field] of READING_PREFERENCES) {
  const keys = AppearanceSchema.shape[field].options;
  const path = `base.prose.${name}`;
  const token = tokens.get(path);
  const { preference, options } = token?.extensions ?? {};
  if (
    token?.type !== type ||
    preference !== `prose-${name}` ||
    !options ||
    Object.keys(options).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(options, key))
  ) {
    errors.push(`${path}: 缺少阅读偏好或选项不完整`);
    continue;
  }
  for (const key of keys) {
    try {
      const value = options[key];
      const problem = referencedTypeProblem(value, type) ?? shapeProblem(type, resolveValue(value, []));
      if (problem) throw new Error(problem);
    } catch (error) {
      errors.push(`${path}.options.${key}: ${error.message}`);
    }
  }
}

const pathsUnder = (prefix) =>
  new Set(
    [...tokens.keys()].filter((path) => path.startsWith(`${prefix}.`)).map((path) => path.slice(prefix.length + 1)),
  );
const themeIds = Object.keys(document.theme ?? {}).filter((key) => !key.startsWith('$'));
for (const required of ['light', 'dark']) {
  if (!themeIds.includes(required)) errors.push(`缺少 theme.${required}`);
}
for (const themeId of themeIds) {
  if (!/^[a-z]+(?:-[a-z]+)*$/.test(themeId)) errors.push(`无效的主题 id：${themeId}`);
  const scheme = document.theme[themeId]?.$extensions?.unwritten?.['color-scheme'];
  if (!['light', 'dark'].includes(scheme)) errors.push(`theme.${themeId}: color-scheme 必须是 light 或 dark`);
}

function reportMismatchedPaths(leftPrefix, rightPrefix) {
  const left = pathsUnder(leftPrefix);
  const right = pathsUnder(rightPrefix);
  for (const path of left) if (!right.has(path)) errors.push(`${rightPrefix} 缺少 ${path}`);
  for (const path of right) if (!left.has(path)) errors.push(`${leftPrefix} 缺少 ${path}`);
}
for (const themeId of themeIds.slice(1)) reportMismatchedPaths(`theme.${themeIds[0]}`, `theme.${themeId}`);

for (const [overrideName, override] of Object.entries(document.override ?? {})) {
  const scopes = Object.keys(override ?? {}).filter((key) => !key.startsWith('$'));
  for (const scope of scopes) {
    if (scope !== 'base' && !themeIds.includes(scope))
      errors.push(`override.${overrideName}.${scope}: 不是 base，也不是主题 id`);
    const targetPrefix = scope === 'base' ? 'base' : `theme.${scope}`;
    for (const path of pathsUnder(`override.${overrideName}.${scope}`)) {
      const target = tokens.get(`${targetPrefix}.${path}`);
      const own = tokens.get(`override.${overrideName}.${scope}.${path}`);
      if (!target) errors.push(`override.${overrideName}.${scope}.${path}: 覆盖的 token 不存在`);
      else if (target.type !== own.type)
        errors.push(`override.${overrideName}.${scope}.${path}: 类型和被覆盖的 token 不同`);
    }
  }
  const themeScopes = scopes.filter((scope) => themeIds.includes(scope));
  for (const scope of themeScopes.slice(1)) {
    reportMismatchedPaths(`override.${overrideName}.${themeScopes[0]}`, `override.${overrideName}.${scope}`);
  }
  if (themeScopes.length > 0 && themeScopes.length !== themeIds.length) {
    errors.push(`override.${overrideName}: 覆盖了部分主题，必须覆盖全部 ${themeIds.join('、')}`);
  }
}

for (const [path, token] of tokens) {
  const value = resolved.get(path);
  if (token.type !== 'typography' || !value) continue;
  try {
    const tracking = resolveValue(token.extensions.tracking, []);
    if (!isNumber(tracking)) throw new Error('tracking 必须能解析为数字');
    const { fontSize, letterSpacing } = value;
    const expected = tracking * fontSize.value;
    const matchesUnit = expected === 0 || letterSpacing.unit === fontSize.unit;
    if (!matchesUnit || Math.abs(letterSpacing.value - expected) > 1e-6) {
      throw new Error(`letterSpacing 应为 tracking × fontSize = ${expected}${fontSize.unit}`);
    }
  } catch (error) {
    errors.push(`${path}: ${error.message}`);
  }
}

function relativeLuminance(components) {
  const [r, g, b] = components.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(foreground, background) {
  const rendered = ({ components }) => components.map((channel) => Math.round(channel * 255) / 255);
  const behind = rendered(background);
  const alpha = foreground.alpha ?? 1;
  const visible = rendered(foreground).map((channel, i) => channel * alpha + behind[i] * (1 - alpha));
  const [lighter, darker] = [relativeLuminance(visible), relativeLuminance(behind)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const SURFACES = [
  'bg',
  'surface',
  'surface-raised',
  'surface-sunken',
  'surface-hover',
  'surface-pressed',
  'surface-selected',
];
const CONTRAST_REQUIREMENTS = [
  { foregrounds: ['text'], backgrounds: SURFACES, min: 4.5 },
  { foregrounds: ['text-muted'], backgrounds: SURFACES, min: 4.5 },
  { foregrounds: ['text-subtle'], backgrounds: SURFACES, min: 3 },
  { foregrounds: ['ink'], backgrounds: ['page'], min: 10, max: 12 },
  { foregrounds: ['accent-text'], backgrounds: SURFACES, min: 4.5 },
  { foregrounds: ['text-on-accent'], backgrounds: ['accent', 'accent-hover', 'accent-pressed'], min: 4.5 },
  { foregrounds: ['ink-action'], backgrounds: ['page', 'surface-sunken'], min: 4.5 },
  { foregrounds: ['success', 'warning', 'danger', 'info'], backgrounds: ['surface'], min: 4.5 },
  ...['success', 'warning', 'danger', 'info'].map((name) => ({
    foregrounds: [name],
    backgrounds: [`${name}-soft`],
    min: 4.5,
  })),
  { foregrounds: ['border-control'], backgrounds: SURFACES, min: 3 },
  { foregrounds: ['focus-ring'], backgrounds: SURFACES, min: 3 },
];

const REQUIRED_THEME_PATHS = [
  'color.text-on-accent',
  'color.border',
  'color.accent',
  'color.accent-hover',
  'color.accent-pressed',
  'color.accent-soft',
  'color.success-soft',
  'color.warning-soft',
  'color.danger-soft',
  'color.info-soft',
  'color.ink-muted',
  'color.ink-selection',
  'color.ink-highlight',
  'color.scrim',
  'elevation.surface',
  'elevation.overlay',
  'material.chrome-bg',
  'material.chrome-backdrop',
  'material.overlay-bg',
  'material.overlay-backdrop',
  'material.overlay-border',
  'material.overlay-elevation',
];

const contrastBackgrounds = new Set(CONTRAST_REQUIREMENTS.flatMap(({ backgrounds }) => backgrounds));
function checkContrast(themeId, overrides) {
  const label = overrides ? `theme.${themeId} (contrast-more)` : `theme.${themeId}`;
  const colorOf = (name) => {
    const path = `theme.${themeId}.color.${name}`;
    if (tokens.get(path)?.type !== 'color' || !resolved.has(path)) return undefined;
    return overrides ? resolveToken(path, [], overrides).value : resolved.get(path);
  };
  for (const background of contrastBackgrounds) {
    if ((colorOf(background)?.alpha ?? 1) !== 1) errors.push(`${label}: ${background} 必须是不透明的底色`);
  }
  for (const { foregrounds, backgrounds, min, max } of CONTRAST_REQUIREMENTS) {
    for (const foreground of foregrounds) {
      for (const background of backgrounds) {
        if (!colorOf(foreground) || !colorOf(background)) {
          errors.push(`${label}: 对比度检查缺少 ${colorOf(foreground) ? background : foreground}`);
          continue;
        }
        const ratio = contrastRatio(colorOf(foreground), colorOf(background));
        if (ratio < min || (max !== undefined && ratio > max)) {
          const range = max === undefined ? `≥ ${min}` : `${min}–${max}`;
          errors.push(`${label}: ${foreground} 对 ${background} 为 ${ratio.toFixed(2)} : 1，要求 ${range}`);
        }
      }
    }
  }
}

for (const themeId of themeIds) {
  for (const path of REQUIRED_THEME_PATHS) {
    if (!resolved.has(`theme.${themeId}.${path}`)) errors.push(`theme.${themeId} 缺少 ${path}`);
  }
  checkContrast(themeId);
}

if (!errors.length) {
  try {
    buildCss(document);
    for (const themeId of themeIds) {
      const overrides = new Map();
      for (const [prefix, source] of [
        ['base', 'base'],
        [`theme.${themeId}`, themeId],
      ]) {
        const scoped = `override.contrast-more.${source}`;
        for (const path of pathsUnder(scoped)) overrides.set(`${prefix}.${path}`, tokens.get(`${scoped}.${path}`));
      }
      if (overrides.size) checkContrast(themeId, overrides);
    }
  } catch (error) {
    errors.push(error.message);
  }
}

for (const message of errors) console.error(message);
console.log(errors.length === 0 ? `token 检查通过（${tokens.size} 个 token）` : `发现 ${errors.length} 处问题`);
process.exit(errors.length === 0 ? 0 : 1);
