import { oc } from '@orpc/contract';
import {
  PortraitAdoptInputSchema,
  PortraitDraftInputSchema,
  PortraitDraftViewSchema,
  PortraitGenerateInputSchema,
  PortraitGetInputSchema,
  PortraitPreviewInputSchema,
  PortraitSetViewSchema,
  PortraitUpdateInputSchema,
  PortraitUploadInputSchema,
} from '../schemas/illustration.ts';

export const portraitContract = {
  draft: oc.input(PortraitDraftInputSchema).output(PortraitDraftViewSchema),
  get: oc.input(PortraitGetInputSchema).output(PortraitSetViewSchema),
  upload: oc.input(PortraitUploadInputSchema).output(PortraitSetViewSchema),
  generate: oc.input(PortraitGenerateInputSchema).output(PortraitSetViewSchema),
  update: oc.input(PortraitUpdateInputSchema).output(PortraitSetViewSchema),
  adopt: oc.input(PortraitAdoptInputSchema).output(PortraitDraftViewSchema),
  preview: oc.input(PortraitPreviewInputSchema).output(PortraitSetViewSchema),
};
