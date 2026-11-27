import { useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SETTING_SECTION_IDS } from '@unwritten/contracts';
import type { PlanJobView, WorkDetail } from '@unwritten/contracts';
import { queryKeys } from '../../shared/api/query.ts';
import { useApi } from '../../shared/api/context.tsx';
import { errorCode } from '../../shared/api/errors.ts';
import { useAutosave } from '../../shared/hooks/useAutosave.ts';
import { reportSample } from '../../shared/lib/log.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { GeneratingMarker } from '../../shared/ui/GeneratingMarker.tsx';
import { LiveRegion } from '../../shared/ui/LiveRegion.tsx';
import { TextArea } from '../../shared/ui/TextArea.tsx';
import styles from './BackgroundEditor.module.css';
import { sameDraft, type DraftContent } from './draft.ts';
import { SettingsSections } from './SettingsSections.tsx';

export const AUTOSAVE_DELAY_MS = 800;

function filledSettingsCount(settings: DraftContent['settings']): number {
  return (
    SETTING_SECTION_IDS.filter((id) => settings[id].text.trim().length > 0).length +
    (settings.cast.mode !== 'fixed' ? 1 : 0) +
    (settings.opening.mode !== 'ai' ? 1 : 0) +
    (settings.actions.hints !== 'actions_only' ? 1 : 0) +
    settings.protagonist.fields.length
  );
}

export function BackgroundEditor({
  work,
  draft,
  savedDraft,
  onDraftChange,
  onGeneratePlan,
  generating,
  planJob,
}: {
  work: WorkDetail;
  draft: DraftContent;
  savedDraft: DraftContent;
  onDraftChange: (draft: DraftContent) => void;
  onGeneratePlan: (contentRev: number) => void;
  generating: boolean;
  planJob: PlanJobView | null;
}) {
  const api = useApi();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const startedAt = useRef<number | null>(null);
  const reportedJob = useRef<string | null>(null);
  const openingTextRef = useRef<HTMLTextAreaElement>(null);

  const save = async (next: DraftContent) => {
    const contentRev =
      queryClient.getQueryData<WorkDetail>(queryKeys.work(work.id))?.draft.contentRev ?? work.draft.contentRev;
    try {
      const result = await api.works.saveDraft({
        workId: work.id,
        baseContentRev: contentRev,
        background: next.background,
        anchors: next.anchors,
        settings: next.settings,
      });
      queryClient.setQueryData<WorkDetail>(queryKeys.work(work.id), (old) =>
        old
          ? {
              ...old,
              draft: {
                ...old.draft,
                contentRev: result.contentRev,
                background: next.background,
                anchors: next.anchors,
                settings: next.settings,
              },
            }
          : old,
      );
    } catch (error) {
      if (errorCode(error) === 'stale_revision') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.work(work.id) });
      }
      throw error;
    }
  };

  const filledAnchors = Object.values(draft.anchors).filter((value) => value.trim().length > 0).length;
  const filledItems = filledAnchors + filledSettingsCount(draft.settings);

  const autosave = useAutosave({
    value: draft,
    savedValue: savedDraft,
    save,
    delayMs: AUTOSAVE_DELAY_MS,
    enabled: true,
    isEqual: sameDraft,
  });

  useEffect(() => {
    if (!planJob || planJob.status === 'running' || startedAt.current === null || reportedJob.current === planJob.id)
      return;
    reportedJob.current = planJob.id;
    reportSample(api, {
      metric: 'client.plan_visible',
      durationMs: performance.now() - startedAt.current,
      outcome: planJob.status === 'done' ? 'ok' : 'error',
      workId: work.id,
      jobId: planJob.id,
    });
    startedAt.current = null;
  }, [api, planJob, work.id]);

  const generate = async () => {
    startedAt.current = performance.now();
    await autosave.flush();
    const latest = queryClient.getQueryData<WorkDetail>(queryKeys.work(work.id));
    if (!latest || !sameDraft(latest.draft, draft)) return;
    onGeneratePlan(latest.draft.contentRev);
  };

  const status =
    autosave.status === 'pending' || autosave.status === 'saving'
      ? t('authoring:background.status.saving')
      : autosave.status === 'saved'
        ? t('authoring:background.status.saved')
        : null;

  const liveMessage = generating
    ? t('authoring:plan.running')
    : planJob?.status === 'failed'
      ? t('authoring:plan.failed')
      : planJob?.status === 'done'
        ? t('authoring:plan.done')
        : '';

  return (
    <section className={styles.editor}>
      <TextArea
        label={t('authoring:background.label')}
        description={t('authoring:background.help')}
        placeholder={t('authoring:background.placeholder')}
        value={draft.background}
        onValueChange={(next) => onDraftChange({ ...draft, background: next })}
        minRows={4}
      />
      <details className={styles.anchors}>
        <summary className={styles.anchorsSummary}>
          {filledItems > 0
            ? t('authoring:anchors.headingFilled', { count: filledItems })
            : t('authoring:anchors.heading')}
        </summary>
        <div className={styles.anchorsBody}>
          <p className={styles.anchorsHelp}>{t('authoring:anchors.help')}</p>
          <TextArea
            label={t('authoring:anchors.narration.label')}
            placeholder={t('authoring:anchors.narration.placeholder')}
            value={draft.anchors.narrationDirective}
            onValueChange={(next) =>
              onDraftChange({ ...draft, anchors: { ...draft.anchors, narrationDirective: next } })
            }
            minRows={2}
          />
          <TextArea
            label={t('authoring:anchors.content.label')}
            placeholder={t('authoring:anchors.content.placeholder')}
            value={draft.anchors.contentPolicy}
            onValueChange={(next) => onDraftChange({ ...draft, anchors: { ...draft.anchors, contentPolicy: next } })}
            minRows={2}
          />
          <TextArea
            label={t('authoring:anchors.improvisation.label')}
            placeholder={t('authoring:anchors.improvisation.placeholder')}
            value={draft.anchors.improvisationScope}
            onValueChange={(next) =>
              onDraftChange({ ...draft, anchors: { ...draft.anchors, improvisationScope: next } })
            }
            minRows={2}
          />
          <p className={styles.settingsIntro}>{t('authoring:settings.intro')}</p>
          <SettingsSections
            settings={draft.settings}
            onChange={(settings) => onDraftChange({ ...draft, settings })}
            openingTextRef={openingTextRef}
          />
        </div>
      </details>
      <div className={styles.actions}>
        <Button
          variant='primary'
          icon={Play}
          busy={generating}
          disabled={generating || draft.background.trim().length === 0}
          onClick={() => void generate()}
        >
          {work.draft.plan ? t('authoring:plan.regenerate') : t('authoring:plan.generate')}
        </Button>
        {status ? <p className={styles.status}>{status}</p> : null}
        {generating ? <GeneratingMarker label={t('authoring:plan.running')} /> : null}
      </div>
      <ErrorNotice
        error={autosave.error}
        message={errorCode(autosave.error) === 'stale_revision' ? t('authoring:background.status.stale') : undefined}
      />
      <LiveRegion message={liveMessage} />
    </section>
  );
}
