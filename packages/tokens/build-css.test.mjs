import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildCss } from './build-css.mjs';

const tokens = JSON.parse(readFileSync(new URL('./tokens.json', import.meta.url), 'utf8'));
const css = buildCss(tokens);
const checker = fileURLToPath(new URL('../../scripts/check-tokens.mjs', import.meta.url));

function checkMutation(update, verdict) {
  const changed = structuredClone(tokens);
  update(changed);
  const dir = mkdtempSync(join(tmpdir(), 'unwritten-tokens-'));
  try {
    const fixture = join(dir, 'tokens.json');
    writeFileSync(fixture, JSON.stringify(changed));
    const { status, stderr } = spawnSync(process.execPath, [checker, fixture], { encoding: 'utf8' });
    assert.equal(status, verdict ? 1 : 0, stderr);
    if (verdict) assert.match(stderr, verdict);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return changed;
}

test('viewport, typography and reading preferences use the source tokens', () => {
  assert.match(css['media.css'], /@custom-media --uw-compact \(width < 48rem\)/);
  assert.match(css['tokens.css'], /--uw-typography-page-title-font-size: var\(--uw-text-2xl\)/);
  assert.match(css['tokens.css'], /data-uw-prose-size='5'[^}]*--uw-prose-size: var\(--uw-prose-size-scale-5\)/s);
  assert.match(css['tokens.css'], /:root \{[^}]*--uw-prose-indent: 2em;/s);
  assert.match(css['tokens.css'], /data-uw-prose-indent='0'[^}]*--uw-prose-indent: 0em;/s);
});

test('motion renders the declared aliases and disables looping for reduced motion', () => {
  assert.match(css['tokens.css'], /--uw-transition-feedback: color var\(--uw-motion-duration-fast\)/);
  assert.match(css['tokens.css'], /--uw-animation-pulse: uw-pulse var\(--uw-motion-duration-pulse\)/);
  assert.match(css['tokens.css'], /--uw-animation-spin: uw-spin var\(--uw-motion-duration-spin\)/);
  assert.match(
    css['tokens.css'],
    /prefers-reduced-motion: reduce[\s\S]*--uw-transition-panel: none;\s*--uw-animation-pulse: none;\s*--uw-animation-spin: none/,
  );
});

test('a token referencing a zero duration disables the transition', () => {
  const changed = structuredClone(tokens);
  changed.base.motion['duration-fast'].$value.value = 0;
  const { 'tokens.css': output } = buildCss(changed);
  assert.match(output, /--uw-transition-feedback: none;/);
  assert.match(output, /--uw-transition-press: none;/);
});

test('themes render aliases, layers and the original muted color in high contrast', () => {
  for (const id of ['light', 'dark']) {
    const theme = css[`themes/${id}.css`];
    assert.ok(theme.includes(`color-scheme: ${id};`));
    assert.match(theme, /--uw-material-chrome-bg: var\(--uw-color-surface\)/);
    assert.match(theme, /--uw-material-overlay-backdrop: none/);
    assert.match(theme, /--uw-elevation-overlay: [^;]+rgb\(/);
    const [, highContrast] = theme.split('@media (prefers-contrast: more)');
    const muted = tokens.theme[id].color['text-muted'].$value.hex;
    assert.ok(highContrast.includes(`--uw-color-text-muted: var(--uw-color-text);`));
    assert.ok(highContrast.includes(`--uw-color-text-subtle: ${muted};`));
  }
});

test('checks contrast after compositing transparent ink and checks primary button labels', () => {
  checkMutation((d) => {
    d.theme.light.color.ink.$value.alpha = 0;
  }, /ink 对 page 为 1\.00/);
  checkMutation((d) => {
    d.theme.light.color['text-on-accent'].$value = '{theme.light.color.accent}';
  }, /text-on-accent 对 accent 为 1\.00/);
  checkMutation((d) => {
    d.override['contrast-more'].light.color['text-muted'].$value = '{theme.light.color.surface}';
  }, /contrast-more.*text-muted 对 surface 为 1\.00/);
});

test('checks generated CSS collisions, reading options and references outside the active theme', () => {
  checkMutation((d) => {
    d.base.typography['page-title-font-size'] = d.base.text.xs;
  }, /--uw-typography-page-title-font-size.*重复/);
  checkMutation((d) => {
    d.base.prose.size.$extensions.unwritten.options['5'] = '{base.missing}';
  }, /base\.missing/);
  checkMutation((d) => {
    delete d.base.prose.font.$extensions.unwritten.options.sans;
  }, /base\.prose\.font.*选项不完整/);
  checkMutation((d) => {
    d.theme.light.material['chrome-bg'].$value = '{theme.dark.color.surface}';
  }, /theme\.dark\.color\.surface.*作用域/);
});

test('renders whole-role aliases and preserves overridden original values through alias chains', () => {
  const changed = checkMutation((d) => {
    d.base.typography['page-title'].$value = '{base.typography.section-title}';
    d.base.typography['page-title'].$extensions = d.base.typography['section-title'].$extensions;
    d.theme.light.color['text-muted'].$value = '{theme.light.color.ink-muted}';
  });
  const output = buildCss(changed);
  assert.match(
    output['tokens.css'],
    /--uw-typography-page-title-font-size: var\(--uw-typography-section-title-font-size\)/,
  );
  assert.match(output['themes/light.css'], /--uw-color-text-subtle: #/);
});

test('emits declared theme-specific motion overrides and resolves media and backdrop dimensions', () => {
  const changed = checkMutation((d) => {
    for (const id of ['light', 'dark']) {
      d.override['reduced-motion'][id] = {
        material: { 'overlay-backdrop': structuredClone(d.theme[id].material['overlay-backdrop']) },
      };
    }
    d.base.breakpoint.compact.$value = '{base.breakpoint.wide}';
    d.theme.light.material['overlay-backdrop'].$value = '{base.space.4}';
  });
  const output = buildCss(changed);
  assert.match(output['media.css'], /--uw-compact \(width < 80rem\)/);
  assert.match(output['themes/light.css'], /--uw-material-overlay-backdrop: blur\(1rem\)/);
  assert.match(output['themes/light.css'], /prefers-reduced-motion: reduce[^]*--uw-material-overlay-backdrop: none/);
});
