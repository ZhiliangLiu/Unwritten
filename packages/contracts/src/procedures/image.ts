import { oc } from '@orpc/contract';
import { z } from 'zod';
import { ImageFileInputSchema } from '../schemas/illustration.ts';
import {
  AutoIllustrationViewSchema,
  ContinueWakeInputSchema,
  CreateImageServiceInputSchema,
  CreateImageServiceOutputSchema,
  GeneratedTokenSchema,
  ImageConfigViewSchema,
  ImageStorageSummarySchema,
  ImageUsageSummarySchema,
  OutputOptionsViewSchema,
  OutputPreferencesSchema,
  PrewarmInputSchema,
  RemoveImageServiceInputSchema,
  SelectImageServiceInputSchema,
  SetAutoIllustrationInputSchema,
  TestImageServiceInputSchema,
  TestImageServiceResultSchema,
  UpdateImageServiceInputSchema,
} from '../schemas/image.ts';

export const imageContract = {
  services: {
    list: oc.output(ImageConfigViewSchema),
    create: oc.input(CreateImageServiceInputSchema).output(CreateImageServiceOutputSchema),
    update: oc.input(UpdateImageServiceInputSchema).output(ImageConfigViewSchema),
    remove: oc.input(RemoveImageServiceInputSchema).output(ImageConfigViewSchema),
    generateToken: oc.output(GeneratedTokenSchema),
    test: oc.input(TestImageServiceInputSchema).output(TestImageServiceResultSchema),
  },
  select: oc.input(SelectImageServiceInputSchema).output(ImageConfigViewSchema),
  outputPreferences: {
    get: oc.output(OutputOptionsViewSchema),
    set: oc.input(OutputPreferencesSchema).output(OutputOptionsViewSchema),
  },
  autoIllustration: {
    get: oc.output(AutoIllustrationViewSchema),
    set: oc.input(SetAutoIllustrationInputSchema).output(AutoIllustrationViewSchema),
  },
  usage: { summary: oc.output(ImageUsageSummarySchema) },
  storage: { summary: oc.output(ImageStorageSummarySchema) },
  file: oc.input(ImageFileInputSchema).output(z.file()),
  prewarm: oc.input(PrewarmInputSchema).output(z.object({})),
  wake: { continue: oc.input(ContinueWakeInputSchema).output(z.object({})) },
};
