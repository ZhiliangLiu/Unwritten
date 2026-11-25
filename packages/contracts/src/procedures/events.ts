import { eventIterator, oc } from '@orpc/contract';
import { CoreEventSchema } from '../events.ts';

export const eventsContract = { subscribe: oc.output(eventIterator(CoreEventSchema)) };
