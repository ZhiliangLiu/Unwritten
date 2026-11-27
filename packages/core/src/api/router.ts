import { implement, os } from '@orpc/server';
import { contract, type ErrorCode } from '@unwritten/contracts';
import type { Services } from '../services.ts';
import { rpcError } from './rpc-error.ts';

export function createRouter(services: Services) {
  const errorMiddleware = os.middleware(async ({ next, path }, input) => {
    try {
      return await next();
    } catch (error) {
      throw rpcError(services.logger, error, path.join('.'), input);
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
      logs: {
        status: base.llm.logs.status.handler(({ context }) => context.services.llm.logsStatus()),
        list: base.llm.logs.list.handler(({ input, context }) => context.services.llm.listLogs(input)),
        get: base.llm.logs.get.handler(({ input, context }) => context.services.llm.getLog(input)),
      },
      test: base.llm.test.handler(({ input, context }) => context.services.llm.testConnection(input)),
    },
    works: {
      list: base.works.list.handler(({ context }) => context.services.library.list()),
      create: base.works.create.handler(({ input, context }) => context.services.library.create(input)),
      get: base.works.get.handler(({ input, context }) => context.services.library.get(input)),
      saveDraft: base.works.saveDraft.handler(({ input, context }) => context.services.library.saveDraft(input)),
      generatePreview: base.works.generatePreview.handler(({ input, context }) =>
        context.services.authoring.generatePreview(input),
      ),
      adoptPreview: base.works.adoptPreview.handler(({ input, context }) =>
        context.services.authoring.adoptPreview(input),
      ),
      generatePlan: base.works.generatePlan.handler(({ input, context }) =>
        context.services.authoring.generatePlan(input),
      ),
      adoptStalePlan: base.works.adoptStalePlan.handler(({ input, context }) =>
        context.services.authoring.adoptStalePlan(input),
      ),
      updatePlanItem: base.works.updatePlanItem.handler(({ input, context }) =>
        context.services.authoring.updatePlanItem(input),
      ),
      removePlanItem: base.works.removePlanItem.handler(({ input, context }) =>
        context.services.authoring.removePlanItem(input),
      ),
      confirmPlan: base.works.confirmPlan.handler(({ input, context }) =>
        context.services.authoring.confirmPlan(input),
      ),
      setWizardStep: base.works.setWizardStep.handler(({ input, context }) =>
        context.services.library.setWizardStep(input),
      ),
      delete: base.works.delete.handler(({ input, context }) => context.services.library.delete(input)),
    },
    play: {
      getRoute: base.play.getRoute.handler(({ input, context }) => context.services.play.getRoute(input)),
      submitAction: base.play.submitAction.handler(({ input, context }) => context.services.play.submitAction(input)),
      retry: base.play.retry.handler(({ input, context }) => context.services.play.retry(input)),
      getJournal: base.play.getJournal.handler(({ input, context }) => context.services.play.getJournal(input)),
      getStartInfo: base.play.getStartInfo.handler(({ input, context }) => context.services.play.getStartInfo(input)),
      start: base.play.start.handler(({ input, context }) => context.services.play.start(input)),
      getPlaythrough: base.play.getPlaythrough.handler(({ input, context }) =>
        context.services.play.getPlaythrough(input),
      ),
      retryOpening: base.play.retryOpening.handler(({ input, context }) => context.services.play.retryOpening(input)),
      getStatus: base.play.getStatus.handler(({ input, context }) => context.services.play.getStatus(input)),
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
