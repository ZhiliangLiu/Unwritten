import { useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PreviewJobView, WorkDetail } from '@unwritten/contracts';
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

export const AUTOSAVE_DELAY_MS = 800;

export function BackgroundEditor({
  work,
  draft,
  savedDraft,
  onDraftChange,
  onGenerate,
  generating,
  previewJob,
}: {
  work: WorkDetail;
  draft: DraftContent;
  savedDraft: DraftContent;
  onDraftChange: (draft: DraftContent) => void;
  onGenerate: (contentRev: number) => void;
  generating: boolean;
  previewJob: PreviewJobView | null;
}) {
  const api = useApi();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const startedAt = useRef<number | null>(null);
  const reportedJob = useRef<string | null>(null);

  const save = async (next: DraftContent) => {
    const contentRev =
      queryClient.getQueryData<WorkDetail>(queryKeys.work(work.id))?.draft.contentRev ?? work.draft.contentRev;
    try {
      const result = await api.works.saveDraft({
        workId: work.id,
        baseContentRev: contentRev,
        background: next.background,
        anchors: next.anchors,
      });
      queryClient.setQueryData<WorkDetail>(queryKeys.work(work.id), (old) =>
        old
          ? { ...old, draft: { contentRev: result.contentRev, background: next.background, anchors: next.anchors } }
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

  const autosave = useAutosave({
    value: draft,
    savedValue: savedDraft,
    save,
    delayMs: AUTOSAVE_DELAY_MS,
    enabled: true,
    isEqual: sameDraft,
  });

  useEffect(() => {
    if (
      !previewJob ||
      previewJob.status === 'running' ||
      startedAt.current === null ||
      reportedJob.current === previewJob.id
    )
      return;
    reportedJob.current = previewJob.id;
    reportSample(api, {
      metric: 'client.preview_visible',
      durationMs: performance.now() - startedAt.current,
      outcome: previewJob.status === 'done' ? 'ok' : 'error',
      workId: work.id,
      jobId: previewJob.id,
    });
    startedAt.current = null;
  }, [api, previewJob, work.id]);

  const generate = async () => {
    startedAt.current = performance.now();
    await autosave.flush();
    const latest = queryClient.getQueryData<WorkDetail>(queryKeys.work(work.id));
    if (!latest || !sameDraft(latest.draft, draft)) return;
    onGenerate(latest.draft.contentRev);
  };

  const status =
    autosave.status === 'pending' || autosave.status === 'saving'
      ? t('authoring:background.status.saving')
      : autosave.status === 'saved'
        ? t('authoring:background.status.saved')
        : null;

  const liveMessage = generating
    ? t('authoring:preview.running')
    : previewJob?.status === 'failed'
      ? t('authoring:preview.failed')
      : previewJob?.status === 'done'
        ? t('authoring:preview.done')
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
          {filledAnchors > 0
            ? t('authoring:anchors.headingFilled', { count: filledAnchors })
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
          {t('authoring:preview.generate')}
        </Button>
        {status ? <p className={styles.status}>{status}</p> : null}
        {generating ? <GeneratingMarker label={t('authoring:preview.running')} /> : null}
      </div>
      <ErrorNotice
        error={autosave.error}
        message={errorCode(autosave.error) === 'stale_revision' ? t('authoring:background.status.stale') : undefined}
      />
      <LiveRegion message={liveMessage} />
    </section>
  );
}
