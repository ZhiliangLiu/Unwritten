import { z } from 'zod';

export const AppearanceSchema = z.object({
  appearance: z.enum(['system', 'light', 'dark']),
  proseSize: z.enum(['1', '2', '3', '4', '5']),
  proseFont: z.enum(['serif', 'sans']),
  proseLeading: z.enum(['comfortable', 'compact']),
});
export type Appearance = z.infer<typeof AppearanceSchema>;

export const DEFAULT_APPEARANCE: Appearance = {
  appearance: 'system',
  proseSize: '3',
  proseFont: 'serif',
  proseLeading: 'comfortable',
};

export function appearanceAttributes(input: Appearance): string {
  const value = AppearanceSchema.parse(input);
  return [
    `data-uw-appearance="${value.appearance}"`,
    `data-uw-prose-size="${value.proseSize}"`,
    `data-uw-prose-font="${value.proseFont}"`,
    `data-uw-prose-leading="${value.proseLeading}"`,
  ].join(' ');
}
