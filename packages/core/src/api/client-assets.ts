import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Appearance } from '@unwritten/contracts';
import { appearanceAttributes } from '@unwritten/contracts';

export interface ClientAssets {
  dir: string;
  indexHtml: string;
  bootScript: string;
}

export function loadClientAssets(clientDir: string): ClientAssets | null {
  try {
    const indexHtml = readFileSync(join(clientDir, 'index.html'), 'utf8');
    const bootScript = readFileSync(join(clientDir, 'boot.inline.js'), 'utf8');
    if (!indexHtml.includes('<html lang="zh-CN">') || !indexHtml.includes('<head>')) {
      throw new Error('client index.html does not contain the expected anchors');
    }
    return { dir: clientDir, indexHtml, bootScript };
  } catch {
    return null;
  }
}

export function renderIndexHtml(assets: ClientAssets, nonce: string, appearance: Appearance): string {
  return assets.indexHtml
    .replace('<html lang="zh-CN">', `<html lang="zh-CN" ${appearanceAttributes(appearance)}>`)
    .replace('<head>', `<head><script nonce="${nonce}">${assets.bootScript}</script>`);
}

export function contentSecurityPolicy(nonce: string): string {
  return `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`;
}

export function newNonce(): string {
  return randomBytes(16).toString('base64');
}
