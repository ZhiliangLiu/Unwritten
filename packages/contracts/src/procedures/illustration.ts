import { oc } from '@orpc/contract';
import {
  DismissIllustrationInputSchema,
  IllustrationActionInputSchema,
  IllustrationViewSchema,
} from '../schemas/illustration.ts';

export const illustrationContract = {
  retry: oc.input(IllustrationActionInputSchema).output(IllustrationViewSchema),
  reroll: oc.input(IllustrationActionInputSchema).output(IllustrationViewSchema),
  dismiss: oc.input(DismissIllustrationInputSchema).output(IllustrationViewSchema),
};
