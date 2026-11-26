import { ORPCError, implement, os } from '@orpc/server';
import { ERROR_CODES, type ErrorCode } from '@unwritten/contracts';
import { contract } from '@unwritten/contracts';
import { appError } from '../errors.ts';
import type { Services } from '../services.ts';

const errorCodes = new Set<string>(ERROR_CODES);

export function createRouter(services: Services) {
  const errorMiddleware = os.middleware(async ({ next }) => {
    try {
      return await next();
    } catch (error) {
      if (error instanceof ORPCError) {
        if (errorCodes.has(error.code)) {
          services.logger.record({
            level: 'warn',
            module: 'api',
            event: 'rpc.failed',
            data: { code: error.code },
          });
          throw error;
        }
        if (error.code === 'BAD_REQUEST') throw appError('invalid_input', error.message);
      }
      services.logger.record({ level: 'error', module: 'api', event: 'rpc.crashed', data: { code: 'internal' } });
      throw appError('internal', 'unexpected error');
    }
  });

  const base = implement(contract).$context<{ services: Services }>().use(errorMiddleware);

  return base.router({
    llm: {
      providers: {
        list: base.llm.providers.list.handler(({ context }) => context.services.llm.listProviders()),
      },
      endpoints: {
        create: base.llm.endpoints.create.handler(({ input, context }) => context.services.llm.createEndpoint(input)),
        update: base.llm.endpoints.update.handler(({ input, context }) => context.services.llm.updateEndpoint(input)),
        remove: base.llm.endpoints.remove.handler(({ input, context }) => context.services.llm.removeEndpoint(input)),
      },
      models: {
        add: base.llm.models.add.handler(({ input, context }) => context.services.llm.addModel(input)),
        update: base.llm.models.update.handler(({ input, context }) => context.services.llm.updateModel(input)),
        remove: base.llm.models.remove.handler(({ input, context }) => context.services.llm.removeModel(input)),
      },
      purposes: {
        set: base.llm.purposes.set.handler(({ input, context }) => context.services.llm.setPurpose(input)),
      },
      test: base.llm.test.handler(({ input, context }) => context.services.llm.testConnection(input)),
    },
    works: {
      list: base.works.list.handler(({ context }) => context.services.library.list()),
      create: base.works.create.handler(({ input, context }) => context.services.library.create(input)),
      get: base.works.get.handler(({ input, context }) => context.services.library.get(input)),
      saveBackground: base.works.saveBackground.handler(({ input, context }) =>
        context.services.library.saveBackground(input),
      ),
      generatePreview: base.works.generatePreview.handler(({ input, context }) =>
        context.services.authoring.generatePreview(input),
      ),
      adoptPreview: base.works.adoptPreview.handler(({ input, context }) =>
        context.services.authoring.adoptPreview(input),
      ),
      delete: base.works.delete.handler(({ input, context }) => context.services.library.delete(input)),
    },
    play: {
      getRoute: base.play.getRoute.handler(({ input, context }) => context.services.play.getRoute(input)),
      submitAction: base.play.submitAction.handler(({ input, context }) => context.services.play.submitAction(input)),
      retry: base.play.retry.handler(({ input, context }) => context.services.play.retry(input)),
      getJournal: base.play.getJournal.handler(({ input, context }) => context.services.play.getJournal(input)),
    },
    settings: {
      get: base.settings.get.handler(({ context }) => context.services.settings.get()),
      update: base.settings.update.handler(({ input, context }) => context.services.settings.update(input)),
    },
    events: {
      subscribe: base.events.subscribe.handler(async function* ({ context, signal }) {
        if (!signal) return;
        for await (const event of context.services.bus.subscribe(signal)) yield event;
      }),
    },
    log: {
      client: base.log.client.handler(({ input, context }) => {
        if (input.kind === 'event') {
          context.services.logger.record({
            level: 'error',
            module: 'client',
            event: 'client.error',
            data: { area: input.area, code: input.code },
          });
        } else {
          context.services.logger.sample({
            source: 'client',
            metric: input.metric,
            durationMs: input.durationMs,
            outcome: input.outcome,
            workId: 'workId' in input ? input.workId : undefined,
            jobId: 'jobId' in input ? input.jobId : undefined,
            requestId: 'requestId' in input ? input.requestId : undefined,
            attempt: 'attempt' in input ? input.attempt : undefined,
          });
        }
        return {};
      }),
    },
  });
}

export function createRouterWithServices(services: Services) {
  return createRouter(services);
}

export type { ErrorCode };
