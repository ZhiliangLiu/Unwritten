import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REFERENCE = /^\{([^{}]+)\}$/;
const TYPOGRAPHY_FIELDS = {
  fontFamily: 'fontFamily',
  fontSize: 'dimension',
  fontWeight: 'fontWeight',
  letterSpacing: 'dimension',
  lineHeight: 'number',
};
const PREFERENCE_MEDIA = {
  'reduced-motion': 'prefers-reduced-motion: reduce',
  'contrast-more': 'prefers-contrast: more',
};

function flatten(group, prefix = '', inheritedType) {
  return Object.entries(group)
    .filter(([key]) => !key.startsWith('$'))
    .flatMap(([key, node]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      const type = node.$type ?? inheritedType;
      return '$value' in node ? [[path, { ...node, $type: type }]] : flatten(node, path, type);
    });
}

const variableName = (path) => `--uw-${path.replaceAll('.', '-')}`;
const kebab = (key) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const basePath = (path) => path.replace(/^(?:base|theme\.[^.]+)\./, '');
const metadata = (token) => token.$extensions?.unwritten ?? {};
const rules = (selector, declarations) =>
  declarations.length ? `${selector} {\n${declarations.map((declaration) => `  ${declaration}`).join('\n')}\n}` : '';
const mediaBlock = (condition, css) =>
  `@media (${condition}) {\n${css
    .split('\n')
    .map((line) => (line ? `  ${line}` : ''))
    .join('\n')}\n}`;
const joinBlocks = (...blocks) => blocks.filter(Boolean).join('\n\n') + '\n';

export function buildCss(document) {
  for (const preference of Object.keys(document.override ?? {})) {
    if (!preference.startsWith('$') && !Object.hasOwn(PREFERENCE_MEDIA, preference)) {
      throw new Error(`不支持的 token 覆盖：${preference}`);
    }
  }
  const base = flatten(document.base);
  const themes = Object.entries(document.theme).filter(([key]) => !key.startsWith('$'));
  for (const [id] of themes) {
    if (!/^[a-z]+(?:-[a-z]+)*$/.test(id)) throw new Error(`Invalid theme id: ${id}`);
  }
  const source = new Map([
    ...base.map(([path, token]) => [`base.${path}`, token]),
    ...themes.flatMap(([id, theme]) => flatten(theme, `theme.${id}`)),
  ]);

  function sourceToken(path, prefix, type) {
    const token = source.get(path);
    if (!token) throw new Error(`Unknown token: ${path}`);
    if (!path.startsWith('base.') && !path.startsWith(`${prefix}.`)) {
      throw new Error(`${path} 不在 ${prefix} 的作用域内`);
    }
    if (token.$type !== type) throw new Error(`${path}: 需要 ${type}，实际为 ${token.$type}`);
    return token;
  }

  function literalValue(value, prefix, type) {
    const visited = new Set();
    for (let reference; typeof value === 'string' && (reference = REFERENCE.exec(value)?.[1]);) {
      if (visited.has(reference)) throw new Error(`循环引用：${value}`);
      visited.add(reference);
      value = sourceToken(reference, prefix, type).$value;
    }
    return value;
  }

  function serialize(type, value, context) {
    const { path, prefix, options, covered, literal = false } = context;
    const backdrop = type === 'dimension' && path.endsWith('-backdrop');
    const reference = typeof value === 'string' && REFERENCE.exec(value)?.[1];
    if (reference) {
      const token = sourceToken(reference, prefix, type);
      if (
        literal ||
        covered.has(reference) ||
        backdrop ||
        (type === 'dimension' && reference.endsWith('-backdrop')) ||
        (type === 'number' && options.unit !== metadata(token).unit)
      ) {
        if (type === 'transition' || type === 'shadow') {
          return serialize(type, literalValue(value, prefix, type), {
            ...context,
            options: metadata(token),
            literal: true,
          });
        }
        value = literalValue(value, prefix, type);
      } else {
        return `var(${variableName(basePath(reference))})`;
      }
    }
    const field = (fieldType, fieldValue) => serialize(fieldType, fieldValue, { ...context, options: {} });
    switch (type) {
      case 'color': {
        const rgb = value.components.map((component) => Math.round(component * 255));
        if (value.alpha !== undefined) return `rgb(${rgb.join(' ')} / ${value.alpha})`;
        return `#${rgb.map((component) => component.toString(16).padStart(2, '0')).join('')}`;
      }
      case 'dimension':
        if (backdrop) return value.value === 0 ? 'none' : `blur(${value.value}${value.unit})`;
        return `${value.value}${value.unit}`;
      case 'duration':
        return `${value.value}${value.unit}`;
      case 'cubicBezier':
        return value.join(',') === '0,0,1,1' ? 'linear' : `cubic-bezier(${value.join(', ')})`;
      case 'fontFamily':
        return [value]
          .flat()
          .map((family) => (/\s/.test(family) ? JSON.stringify(family) : family))
          .join(', ');
      case 'fontWeight':
        return String(value);
      case 'number':
        return `${value}${options.unit ?? ''}`;
      case 'shadow':
        return [value]
          .flat()
          .map((layer) =>
            typeof layer === 'string'
              ? field('shadow', layer)
              : [
                  layer.inset ? 'inset' : '',
                  ...['offsetX', 'offsetY', 'blur', 'spread'].map((key) => field('dimension', layer[key])),
                  field('color', layer.color),
                ]
                  .filter(Boolean)
                  .join(' '),
          )
          .join(', ');
      case 'transition': {
        const { duration, delay, timingFunction } = value;
        if (literalValue(duration, prefix, 'duration').value === 0) return 'none';
        const timing = [
          field('duration', duration),
          field('cubicBezier', timingFunction),
          field('duration', delay),
        ].join(' ');
        if (path === 'animation.pulse') {
          if (options.iteration !== 'infinite') throw new Error(`${path}: iteration 必须是 infinite`);
          return `uw-pulse ${timing} ${options.iteration}`;
        }
        if (
          !Array.isArray(options.properties) ||
          !options.properties.length ||
          !options.properties.every((property) => /^-?[a-z][a-z-]*$/.test(property) && property !== 'all')
        ) {
          throw new Error(`${path}: properties 必须列出过渡属性`);
        }
        return options.properties.map((property) => `${property} ${timing}`).join(', ');
      }
      default:
        throw new Error(`Unsupported token type for ${path}: ${type}`);
    }
  }

  function declarations(entries, { prefix, covered = new Set(), names = new Set() }) {
    return entries.flatMap(([path, token]) => {
      const context = { path, prefix, options: metadata(token), covered };
      const add = (name, value) => {
        if (names.has(name)) throw new Error(`${name} 重复声明（${prefix}.${path}）`);
        names.add(name);
        return `${name}: ${value};`;
      };
      const name = variableName(path);
      if (token.$type === 'typography') {
        const reference = typeof token.$value === 'string' && REFERENCE.exec(token.$value)?.[1];
        const original = reference && covered.has(reference);
        if (reference) sourceToken(reference, prefix, 'typography');
        return Object.entries(TYPOGRAPHY_FIELDS).map(([field, type]) => {
          const suffix = kebab(field);
          const value =
            reference && !original
              ? `var(${variableName(basePath(reference))}-${suffix})`
              : serialize(type, literalValue(token.$value, prefix, 'typography')[field], {
                  ...context,
                  literal: original,
                });
          return add(`${name}-${suffix}`, value);
        });
      }
      return add(name, serialize(token.$type, token.$value, context));
    });
  }

  function overridesFor(scope, selector) {
    const prefix = scope === 'base' ? scope : `theme.${scope}`;
    return Object.entries(PREFERENCE_MEDIA).map(([key, condition]) => {
      const group = document.override?.[key];
      const entries = flatten(group?.[scope] ?? {});
      const covered = new Set(entries.map(([path]) => `${prefix}.${path}`));
      if (scope !== 'base') for (const [path] of flatten(group?.base ?? {})) covered.add(`base.${path}`);
      const values = declarations(entries, { prefix, covered });
      if (scope === 'base' && key === 'reduced-motion') values.push('scroll-behavior: auto;');
      return values.length ? mediaBlock(condition, rules(selector, values)) : '';
    });
  }

  const preferences = base.flatMap(([path, token]) => {
    const { preference, options } = metadata(token);
    return Object.entries(options ?? {}).map(([key, value]) =>
      rules(
        `:root[data-uw-${preference}='${key}']`,
        declarations([[path, { ...token, $value: value }]], { prefix: 'base' }),
      ),
    );
  });
  const baseNames = new Set();
  const files = {
    'tokens.css': joinBlocks(
      rules(':root', declarations(base, { prefix: 'base', names: baseNames })),
      ...preferences,
      ...overridesFor('base', ':root'),
      rules(':root[data-uw-theme-switching]', ['--uw-transition-feedback: none;']),
      '@keyframes uw-pulse {\n  0%, 100% { opacity: 1; }\n  50% { opacity: var(--uw-opacity-muted); }\n}',
    ),
    'media.css':
      base
        .filter(([, token]) => metadata(token).media)
        .map(([path, token]) => {
          const name = path.replace(/^breakpoint\./, '');
          const width = serialize(token.$type, token.$value, {
            path,
            prefix: 'base',
            options: metadata(token),
            literal: true,
          });
          return `@custom-media --uw-${name} (${metadata(token).media.replace('value', width)});`;
        })
        .join('\n') + '\n',
  };

  for (const [id, theme] of themes) {
    const selector = `:root[data-uw-theme='${id}']`;
    files[`themes/${id}.css`] = joinBlocks(
      rules(selector, [
        `color-scheme: ${metadata(theme)['color-scheme']};`,
        ...declarations(flatten(theme), { prefix: `theme.${id}`, names: new Set(baseNames) }),
      ]),
      ...overridesFor(id, selector),
    );
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = process.argv[2] ?? fileURLToPath(new URL('../../apps/client/src/theme/', import.meta.url));
  const document = JSON.parse(readFileSync(new URL('./tokens.json', import.meta.url), 'utf8'));
  const files = buildCss(document);
  mkdirSync(join(output, 'themes'), { recursive: true });
  for (const [path, css] of Object.entries(files)) writeFileSync(join(output, path), css);
}
