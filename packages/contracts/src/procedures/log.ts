import { oc } from '@orpc/contract';
import { z } from 'zod';
import { ClientLogInputSchema } from '../schemas/log.ts';

export const logContract = { client: oc.input(ClientLogInputSchema).output(z.object({})) };
