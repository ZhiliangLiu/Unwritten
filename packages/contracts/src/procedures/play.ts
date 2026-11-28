import { oc } from '@orpc/contract';
import { z } from 'zod';
import {
  PlaythroughIdInputSchema,
  PlaythroughListItemSchema,
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
import { SuggestAppearanceInputSchema, SuggestAppearanceOutputSchema } from '../schemas/illustration.ts';

export const playContract = {
  getRoute: oc.input(RouteIdInputSchema).output(RouteViewSchema),
  submitAction: oc.input(SubmitActionInputSchema).output(TurnRequestViewSchema),
  retry: oc.input(RetryInputSchema).output(TurnRequestViewSchema),
  getJournal: oc.input(RouteIdInputSchema).output(JournalViewSchema),
  getStartInfo: oc.input(WorkIdInputSchema).output(StartInfoSchema),
  start: oc.input(StartPlaythroughInputSchema).output(PlaythroughViewSchema),
  getPlaythrough: oc.input(PlaythroughIdInputSchema).output(PlaythroughViewSchema),
  listPlaythroughs: oc.input(WorkIdInputSchema).output(z.array(PlaythroughListItemSchema)),
  retryOpening: oc.input(RetryOpeningInputSchema).output(PlaythroughViewSchema),
  getStatus: oc.input(RouteIdInputSchema).output(StatusViewSchema),
  suggestAppearance: oc.input(SuggestAppearanceInputSchema).output(SuggestAppearanceOutputSchema),
};
