import { oc } from '@orpc/contract';
import { z } from 'zod';
import {
  AdoptPreviewInputSchema,
  AdoptPreviewOutputSchema,
  GeneratePreviewInputSchema,
  PreviewJobViewSchema,
  SaveBackgroundInputSchema,
  SaveBackgroundOutputSchema,
  WorkDetailSchema,
  WorkIdInputSchema,
  WorkSummarySchema,
} from '../schemas/works.ts';

export const worksContract = {
  list: oc.output(z.array(WorkSummarySchema)),
  create: oc.input(WorkIdInputSchema).output(WorkDetailSchema),
  get: oc.input(WorkIdInputSchema).output(WorkDetailSchema),
  saveBackground: oc.input(SaveBackgroundInputSchema).output(SaveBackgroundOutputSchema),
  generatePreview: oc.input(GeneratePreviewInputSchema).output(PreviewJobViewSchema),
  adoptPreview: oc.input(AdoptPreviewInputSchema).output(AdoptPreviewOutputSchema),
  delete: oc.input(WorkIdInputSchema).output(z.object({})),
};
