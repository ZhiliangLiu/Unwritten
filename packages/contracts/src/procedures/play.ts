import { oc } from '@orpc/contract';
import {
  PlaythroughIdInputSchema,
  PlaythroughViewSchema,
  RetryInputSchema,
  RetryOpeningInputSchema,
  RouteIdInputSchema,
  RouteViewSchema,
  StartInfoSchema,
  StartPlaythroughInputSchema,
  StatusViewSchema,
  SubmitActionInputSchema,
  TurnRequestViewSchema,
} from '../schemas/play.ts';
import { JournalViewSchema } from '../schemas/story.ts';
import { WorkIdInputSchema } from '../schemas/works.ts';

export const playContract = {
  getRoute: oc.input(RouteIdInputSchema).output(RouteViewSchema),
  submitAction: oc.input(SubmitActionInputSchema).output(TurnRequestViewSchema),
  retry: oc.input(RetryInputSchema).output(TurnRequestViewSchema),
  getJournal: oc.input(RouteIdInputSchema).output(JournalViewSchema),
  getStartInfo: oc.input(WorkIdInputSchema).output(StartInfoSchema),
  start: oc.input(StartPlaythroughInputSchema).output(PlaythroughViewSchema),
  getPlaythrough: oc.input(PlaythroughIdInputSchema).output(PlaythroughViewSchema),
  retryOpening: oc.input(RetryOpeningInputSchema).output(PlaythroughViewSchema),
  getStatus: oc.input(RouteIdInputSchema).output(StatusViewSchema),
};
