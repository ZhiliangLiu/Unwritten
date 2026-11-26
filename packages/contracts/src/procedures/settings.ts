import { oc } from '@orpc/contract';
import { AppearanceSchema } from '../schemas/appearance.ts';

export const settingsContract = {
  get: oc.output(AppearanceSchema),
  update: oc.input(AppearanceSchema).output(AppearanceSchema),
};
