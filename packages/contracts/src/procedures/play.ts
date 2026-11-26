import { oc } from '@orpc/contract';
import {
  RetryInputSchema,
  RouteIdInputSchema,
  RouteViewSchema,
  SubmitActionInputSchema,
  TurnRequestViewSchema,
} from '../schemas/play.ts';
import { JournalViewSchema } from '../schemas/story.ts';

export const playContract = {
  getRoute: oc.input(RouteIdInputSchema).output(RouteViewSchema),
  submitAction: oc.input(SubmitActionInputSchema).output(TurnRequestViewSchema),
  retry: oc.input(RetryInputSchema).output(TurnRequestViewSchema),
  getJournal: oc.input(RouteIdInputSchema).output(JournalViewSchema),
};
