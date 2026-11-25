import { oc } from '@orpc/contract';
import {
  CreateEndpointInputSchema,
  CreateEndpointOutputSchema,
  LlmConfigViewSchema,
  SetPurposeInputSchema,
  TestConnectionInputSchema,
  TestConnectionResultSchema,
  UpdateEndpointInputSchema,
} from '../schemas/llm.ts';

export const llmContract = {
  providers: { list: oc.output(LlmConfigViewSchema) },
  endpoints: {
    create: oc.input(CreateEndpointInputSchema).output(CreateEndpointOutputSchema),
    update: oc.input(UpdateEndpointInputSchema).output(LlmConfigViewSchema),
  },
  purposes: { set: oc.input(SetPurposeInputSchema).output(LlmConfigViewSchema) },
  test: oc.input(TestConnectionInputSchema).output(TestConnectionResultSchema),
};
