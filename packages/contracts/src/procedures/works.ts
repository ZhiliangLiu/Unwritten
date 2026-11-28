import { oc } from '@orpc/contract';
import { z } from 'zod';
import {
  AdoptPreviewInputSchema,
  AdoptPreviewOutputSchema,
  AdoptStalePlanInputSchema,
  ConfirmPlanInputSchema,
  GeneratePlanInputSchema,
  GeneratePreviewInputSchema,
  PreviewJobViewSchema,
  RemovePlanItemInputSchema,
  SaveDraftInputSchema,
  SaveDraftOutputSchema,
  SetWizardStepInputSchema,
  UpdatePlanItemInputSchema,
  WorkDetailSchema,
  WorkIdInputSchema,
  WorkSummarySchema,
} from '../schemas/works.ts';
import { PlanJobViewSchema } from '../schemas/authoring.ts';
import { SetIllustrationStyleInputSchema } from '../schemas/illustration.ts';

export const worksContract = {
  list: oc.output(z.array(WorkSummarySchema)),
  create: oc.input(WorkIdInputSchema).output(WorkDetailSchema),
  get: oc.input(WorkIdInputSchema).output(WorkDetailSchema),
  saveDraft: oc.input(SaveDraftInputSchema).output(SaveDraftOutputSchema),
  generatePreview: oc.input(GeneratePreviewInputSchema).output(PreviewJobViewSchema),
  adoptPreview: oc.input(AdoptPreviewInputSchema).output(AdoptPreviewOutputSchema),
  generatePlan: oc.input(GeneratePlanInputSchema).output(PlanJobViewSchema),
  adoptStalePlan: oc.input(AdoptStalePlanInputSchema).output(SaveDraftOutputSchema),
  updatePlanItem: oc.input(UpdatePlanItemInputSchema).output(SaveDraftOutputSchema),
  removePlanItem: oc.input(RemovePlanItemInputSchema).output(SaveDraftOutputSchema),
  confirmPlan: oc.input(ConfirmPlanInputSchema).output(SaveDraftOutputSchema),
  setWizardStep: oc.input(SetWizardStepInputSchema).output(z.object({})),
  setIllustrationStyle: oc.input(SetIllustrationStyleInputSchema).output(z.object({})),
  delete: oc.input(WorkIdInputSchema).output(z.object({})),
};
