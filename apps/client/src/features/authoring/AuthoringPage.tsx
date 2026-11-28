import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_WORK_SETTINGS, EMPTY_WORK_ANCHORS } from '@unwritten/contracts';
import type { PlanItem, WizardStep, WorkDetail } from '@unwritten/contracts';
import { errorCode } from '../../shared/api/errors.ts';
import { queryKeys } from '../../shared/api/query.ts';
import { useApi } from '../../shared/api/context.tsx';
import { reportSample } from '../../shared/lib/log.ts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { buttonClassName } from '../../shared/ui/Button.tsx';
import { EmptyState } from '../../shared/ui/EmptyState.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { GeneratingMarker } from '../../shared/ui/GeneratingMarker.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { useNotify } from '../../shared/ui/Toaster.tsx';
import { WakePrompt } from '../../shared/ui/WakePrompt.tsx';
import { BackgroundEditor } from './BackgroundEditor.tsx';
import { sameDraft, type DraftContent } from './draft.ts';
import { PlanPanel } from './PlanPanel.tsx';
import { PreviewPanel } from './PreviewPanel.tsx';
import { PublishedPanel } from './PublishedPanel.tsx';
import { WizardSteps } from './WizardSteps.tsx';
import styles from './AuthoringPage.module.css';

export function AuthoringPage({ workId }: { workId: string }) {
  const api = useApi();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const [edit, setEdit] = useState<{ workId: string; draft: DraftContent } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [step, setStep] = useState<WizardStep | null>(null);
  const stepRegionRef = useRef<HTMLDivElement>(null);
  const focusStepAfterRender = useRef(false);
  const previewStartedAt = useRef<number | null>(null);
  const previewStartJob = useRef<string | null>(null);
  const reportedPreviewJob = useRef<string | null>(null);

  const work = useQuery({
    queryKey: queryKeys.work(workId),
    queryFn: () => api.works.get({ workId }),
  });

  const imageConfig = useQuery({ queryKey: queryKeys.imageConfig, queryFn: () => api.image.services.list() });

  const data = work.data;
  const previewJob = data?.latestPreviewJob ?? null;
  const planJob = data?.latestPlanJob ?? null;
  const preview = previewJob?.preview ?? null;
  const savedDraft = useMemo<DraftContent>(
    () => ({
      background: data?.draft.background ?? '',
      anchors: data?.draft.anchors ?? EMPTY_WORK_ANCHORS,
      settings: data?.draft.settings ?? DEFAULT_WORK_SETTINGS,
    }),
    [data?.draft.background, data?.draft.anchors, data?.draft.settings],
  );
  const localDraft = edit?.workId === workId ? edit.draft : null;
  const draft = localDraft ?? savedDraft;
  const localDirty = localDraft !== null && !sameDraft(localDraft, savedDraft);
  const stale = Boolean(
    previewJob && preview && (previewJob.basedOnContentRev !== data?.draft.contentRev || localDirty),
  );
  const currentStep: WizardStep = step ?? data?.draft.wizardStep ?? 'background';
  const contentRev =
    queryClient.getQueryData<WorkDetail>(queryKeys.work(workId))?.draft.contentRev ?? data?.draft.contentRev ?? 0;

  const invalidateWork = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: queryKeys.work(workId) });
  };

  const selectStep = (next: WizardStep) => {
    focusStepAfterRender.current = next !== currentStep;
    setStep(next);
    void api.works.setWizardStep({ workId, step: next }).catch(() => {});
  };

  const generatePlan = useMutation({
    mutationFn: (rev: number) => api.works.generatePlan({ workId, jobId: crypto.randomUUID(), contentRev: rev }),
    onSuccess: () => {
      invalidateWork();
      selectStep('plan');
    },
    onError: setError,
  });

  const adoptStalePlan = useMutation({
    mutationFn: (jobId: string) => api.works.adoptStalePlan({ workId, jobId }),
    onSuccess: invalidateWork,
    onError: setError,
  });

  const updatePlanItem = useMutation({
    mutationFn: (item: PlanItem) => api.works.updatePlanItem({ workId, baseContentRev: contentRev, item }),
    onSuccess: invalidateWork,
    onError: setError,
  });

  const removePlanItem = useMutation({
    mutationFn: (itemId: string) => api.works.removePlanItem({ workId, baseContentRev: contentRev, itemId }),
    onSuccess: invalidateWork,
    onError: setError,
  });

  const generatePreview = useMutation({
    mutationFn: (rev: number) => api.works.generatePreview({ workId, jobId: crypto.randomUUID(), contentRev: rev }),
    onSuccess: invalidateWork,
    onError: (cause) => {
      previewStartedAt.current = null;
      setError(cause);
    },
  });

  const confirmPlan = useMutation({
    mutationFn: (rev: number) => api.works.confirmPlan({ workId, baseContentRev: rev }),
    onSuccess: (result) => {
      invalidateWork();
      generatePreview.mutate(result.contentRev);
      selectStep('opening');
    },
    onError: (cause) => {
      previewStartedAt.current = null;
      setError(cause);
    },
  });

  const adoptPreview = useMutation({
    mutationFn: (jobId: string) => api.works.adoptPreview({ workId, jobId }),
    onSuccess: () => {
      invalidateWork();
      void queryClient.invalidateQueries({ queryKey: queryKeys.works });
    },
    onError: setError,
  });

  const applyDraft = useMutation({
    mutationFn: (rev: number) => api.works.applyDraft({ workId, baseContentRev: rev }),
    onSuccess: () => {
      invalidateWork();
      void queryClient.invalidateQueries({ queryKey: queryKeys.works });
      notify({ title: t('authoring:published.applied'), tone: 'success' });
    },
    onError: setError,
  });

  useEffect(() => {
    if (!previewJob || previewJob.status === 'running') return;
    if (previewJob.id === previewStartJob.current) return;
    if (previewStartedAt.current === null || reportedPreviewJob.current === previewJob.id) return;
    reportedPreviewJob.current = previewJob.id;
    reportSample(api, {
      metric: 'client.preview_visible',
      durationMs: performance.now() - previewStartedAt.current,
      outcome: previewJob.status === 'done' ? 'ok' : 'error',
      workId,
      jobId: previewJob.id,
    });
    previewStartedAt.current = null;
  }, [api, previewJob, workId]);

  useEffect(() => {
    if (!focusStepAfterRender.current) return;
    focusStepAfterRender.current = false;
    const heading = stepRegionRef.current?.querySelector<HTMLElement>('h2');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus();
  }, [currentStep]);

  const regeneratePreview = () => {
    if (!data) return;
    previewStartedAt.current = performance.now();
    previewStartJob.current = previewJob?.id ?? null;
    generatePreview.mutate(contentRev);
  };

  const available: Record<WizardStep, boolean> = {
    background: true,
    plan: Boolean(data?.draft.plan || planJob),
    opening: Boolean(data?.draft.plan?.confirmed || previewJob),
  };
  available[currentStep] = true;

  const title = data?.title ?? preview?.title ?? t('authoring:page.heading');
  const published = data?.status === 'playable';
  const notFound = !data && work.error !== null && errorCode(work.error) === 'not_found';

  return (
    <Page
      title={title}
      heading='toolbar'
      toolbar={{
        start: { kind: 'back', to: '/', label: t('common:nav.library') },
        titleBadge: data && !published ? <Badge tone='neutral'>{t('library:card.draft')}</Badge> : undefined,
      }}
      width='prose'
    >
      <WakePrompt serviceId={imageConfig.data?.selectedServiceId ?? null} />
      {notFound ? (
        <EmptyState
          headingLevel={2}
          title={t('errors:not_found')}
          action={
            <Link className={buttonClassName('secondary')} to='/'>
              {t('common:nav.library')}
            </Link>
          }
        />
      ) : (
        <ErrorNotice error={error ?? work.error} />
      )}
      {work.isLoading ? <Skeleton variant='lines' count={3} /> : null}
      {data && published ? (
        <PublishedPanel
          work={data}
          applying={applyDraft.isPending}
          dirty={localDirty}
          planConfirmed={Boolean(data.draft.plan?.confirmed)}
          planRunning={planJob?.status === 'running' || generatePlan.isPending}
          onApply={() => applyDraft.mutate(contentRev)}
        />
      ) : null}
      {data ? (
        <div className={styles.sections}>
          <WizardSteps current={currentStep} available={available} onSelect={selectStep} />
          <div ref={stepRegionRef} className={styles.step}>
            {currentStep === 'background' ? (
              <>
                <h2 className={styles.stepHeading}>{t('authoring:steps.background')}</h2>
                <BackgroundEditor
                  work={data}
                  draft={draft}
                  savedDraft={savedDraft}
                  onDraftChange={(next) => setEdit({ workId, draft: next })}
                  onGeneratePlan={(rev) => generatePlan.mutate(rev)}
                  generating={generatePlan.isPending || planJob?.status === 'running'}
                  planJob={planJob}
                />
              </>
            ) : null}
            {currentStep === 'plan' ? (
              <PlanPanel
                work={data}
                busy={generatePlan.isPending || planJob?.status === 'running'}
                onRegenerate={() => generatePlan.mutate(contentRev)}
                onAdoptStale={(jobId) => adoptStalePlan.mutate(jobId)}
                onUpdateItem={(item) => updatePlanItem.mutate(item)}
                onRemoveItem={(itemId) => removePlanItem.mutate(itemId)}
                onConfirm={() => {
                  previewStartedAt.current = performance.now();
                  previewStartJob.current = previewJob?.id ?? null;
                  confirmPlan.mutate(contentRev);
                }}
              />
            ) : null}
            {currentStep === 'opening' ? (
              <PreviewPanel
                preview={preview}
                stale={stale}
                published={published}
                status={
                  generatePreview.isPending || previewJob?.status === 'running' ? (
                    <GeneratingMarker label={t('authoring:preview.running')} />
                  ) : previewJob?.status === 'failed' ? (
                    <ErrorNotice code={previewJob.error ?? 'unknown'} diagnosticId={previewJob.id} />
                  ) : null
                }
                regenerating={generatePreview.isPending || previewJob?.status === 'running'}
                adopting={adoptPreview.isPending}
                onRegenerate={regeneratePreview}
                onAdopt={() => {
                  if (previewJob) adoptPreview.mutate(previewJob.id);
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </Page>
  );
}
