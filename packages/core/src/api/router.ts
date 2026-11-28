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
      applyDraft: base.works.applyDraft.handler(({ input, context }) => context.services.authoring.applyDraft(input)),
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
      setIllustrationStyle: base.works.setIllustrationStyle.handler(({ input, context }) =>
        context.services.illustration.setWorkStyle(input),
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
      listPlaythroughs: base.play.listPlaythroughs.handler(({ input, context }) =>
        context.services.play.listPlaythroughs(input),
      ),
      retryOpening: base.play.retryOpening.handler(({ input, context }) => context.services.play.retryOpening(input)),
      getStatus: base.play.getStatus.handler(({ input, context }) => context.services.play.getStatus(input)),
      suggestAppearance: base.play.suggestAppearance.handler(({ input, context }) =>
        context.services.illustration.suggestAppearance(input),
      ),
    },
    settings: {
      get: base.settings.get.handler(({ context }) => context.services.settings.get()),
      update: base.settings.update.handler(({ input, context }) => context.services.settings.update(input)),
    },
    image: {
      services: {
        list: base.image.services.list.handler(({ context }) => context.services.image.listServices()),
        create: base.image.services.create.handler(({ input, context }) => context.services.image.createService(input)),
        update: base.image.services.update.handler(({ input, context }) => context.services.image.updateService(input)),
        remove: base.image.services.remove.handler(({ input, context }) => context.services.image.removeService(input)),
        generateToken: base.image.services.generateToken.handler(({ context }) =>
          context.services.image.generateToken(),
        ),
        test: base.image.services.test.handler(({ input, context }) => context.services.image.testService(input)),
      },
      select: base.image.select.handler(({ input, context }) => context.services.image.select(input)),
      outputPreferences: {
        get: base.image.outputPreferences.get.handler(({ context }) => context.services.image.getOutputOptions()),
        set: base.image.outputPreferences.set.handler(({ input, context }) =>
          context.services.image.setOutputPreferences(input),
        ),
      },
      autoIllustration: {
        get: base.image.autoIllustration.get.handler(({ context }) => context.services.image.getAutoIllustration()),
        set: base.image.autoIllustration.set.handler(({ input, context }) =>
          context.services.image.setAutoIllustration(input),
        ),
      },
      usage: { summary: base.image.usage.summary.handler(({ context }) => context.services.image.usageSummary()) },
      storage: {
        summary: base.image.storage.summary.handler(({ context }) => context.services.illustration.storageSummary()),
      },
      file: base.image.file.handler(({ input, context }) => context.services.illustration.file(input)),
      prewarm: base.image.prewarm.handler(({ input, context }) => context.services.illustration.prewarm(input)),
      wake: {
        continue: base.image.wake.continue.handler(({ input, context }) => context.services.image.continueWake(input)),
      },
    },
    illustration: {
      retry: base.illustration.retry.handler(({ input, context }) => context.services.illustration.retry(input)),
      reroll: base.illustration.reroll.handler(({ input, context }) => context.services.illustration.reroll(input)),
      dismiss: base.illustration.dismiss.handler(({ input, context }) => context.services.illustration.dismiss(input)),
    },
    portrait: {
      draft: base.portrait.draft.handler(({ input, context }) => context.services.illustration.portraitDraft(input)),
      get: base.portrait.get.handler(({ input, context }) => context.services.illustration.portraitGet(input)),
      upload: base.portrait.upload.handler(({ input, context }) => context.services.illustration.portraitUpload(input)),
      generate: base.portrait.generate.handler(({ input, context }) =>
        context.services.illustration.portraitGenerate(input),
      ),
      update: base.portrait.update.handler(({ input, context }) => context.services.illustration.portraitUpdate(input)),
      adopt: base.portrait.adopt.handler(({ input, context }) => context.services.illustration.portraitAdopt(input)),
      preview: base.portrait.preview.handler(({ input, context }) =>
        context.services.illustration.portraitPreview(input),
      ),
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
