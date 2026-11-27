import { oc } from '@orpc/contract';
import {
  AddModelInputSchema,
  CreateEndpointInputSchema,
  CreateEndpointOutputSchema,
  LlmConfigViewSchema,
  LlmLogDetailSchema,
  LlmLogIdInputSchema,
  LlmLogListInputSchema,
  LlmLogListSchema,
  RemoveEndpointInputSchema,
  RemoveModelInputSchema,
  SetPurposeInputSchema,
  TestConnectionInputSchema,
  TestConnectionResultSchema,
  UpdateEndpointInputSchema,
  UpdateModelInputSchema,
} from '../schemas/llm.ts';

export const llmContract = {
  providers: { list: oc.output(LlmConfigViewSchema) },
  endpoints: {
    create: oc.input(CreateEndpointInputSchema).output(CreateEndpointOutputSchema),
    update: oc.input(UpdateEndpointInputSchema).output(LlmConfigViewSchema),
    remove: oc.input(RemoveEndpointInputSchema).output(LlmConfigViewSchema),
  },
  models: {
    add: oc.input(AddModelInputSchema).output(LlmConfigViewSchema),
    update: oc.input(UpdateModelInputSchema).output(LlmConfigViewSchema),
    remove: oc.input(RemoveModelInputSchema).output(LlmConfigViewSchema),
  },
  purposes: { set: oc.input(SetPurposeInputSchema).output(LlmConfigViewSchema) },
  test: oc.input(TestConnectionInputSchema).output(TestConnectionResultSchema),
  logs: {
    list: oc.input(LlmLogListInputSchema).output(LlmLogListSchema),
    get: oc.input(LlmLogIdInputSchema).output(LlmLogDetailSchema),
  },
};
