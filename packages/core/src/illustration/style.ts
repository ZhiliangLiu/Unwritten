import { DEFAULT_ILLUSTRATION_STYLE, type IllustrationStyle, type StylePreset } from '@unwritten/contracts';

export const STYLE_PRESET_PROMPTS: Record<StylePreset, string> = {
  watercolor: 'watercolor illustration, transparent washes, soft pigment edges, paper grain',
  ink: 'ink wash illustration, expressive brushwork, restrained tonal washes, open negative space',
  anime: 'cel animation illustration, clean contours, flat color shapes, precise cel shading',
  painterly: 'painterly illustration, textured brushstrokes, layered color, soft edges and deliberate focal detail',
  cinematic: 'cinematic realism, natural textures, motivated lighting, clear foreground and background separation',
};

export function styleFragment(style: IllustrationStyle): string | null {
  return style.kind === 'preset' ? STYLE_PRESET_PROMPTS[style.preset] : null;
}

export function styleRecord(style: IllustrationStyle): IllustrationStyle {
  return style;
}

export function effectiveStyle(stored: IllustrationStyle | null | undefined): IllustrationStyle {
  return stored ?? DEFAULT_ILLUSTRATION_STYLE;
}
