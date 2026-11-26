import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorCode } from '../../shared/api/errors.ts';
import { queryKeys } from '../../shared/api/query.ts';
import { useApi } from '../../shared/api/context.tsx';
import { Badge } from '../../shared/ui/Badge.tsx';
import { buttonClassName } from '../../shared/ui/Button.tsx';
import { EmptyState } from '../../shared/ui/EmptyState.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { BackgroundEditor } from './BackgroundEditor.tsx';
import { PreviewPanel } from './PreviewPanel.tsx';
import { PublishedPanel } from './PublishedPanel.tsx';
import styles from './AuthoringPage.module.css';

export function AuthoringPage({ workId }: { workId: string }) {
  const api = useApi();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [edit, setEdit] = useState<{ workId: string; text: string } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const work = useQuery({
    queryKey: queryKeys.work(workId),
    queryFn: () => api.works.get({ workId }),
  });

  const generate = useMutation({
    mutationFn: (contentRev: number) => api.works.generatePreview({ workId, jobId: crypto.randomUUID(), contentRev }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.work(workId) });
    },
    onError: setError,
  });

  const adopt = useMutation({
    mutationFn: (jobId: string) => api.works.adoptPreview({ workId, jobId }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.work(workId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.works });
    },
    onError: setError,
  });

  const data = work.data;
  const previewJob = data?.latestPreviewJob ?? null;
  const preview = previewJob?.preview ?? null;
  const localText = edit?.workId === workId ? edit.text : null;
  const text = localText ?? data?.draft.background ?? '';
  const localDirty = localText !== null && localText !== data?.draft.background;
  const stale = Boolean(
    previewJob && preview && (previewJob.basedOnContentRev !== data?.draft.contentRev || localDirty),
  );

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
      {data && published ? <PublishedPanel work={data} /> : null}
      {data && !published ? (
        <div className={styles.sections}>
          <BackgroundEditor
            work={data}
            value={text}
            onValueChange={(next) => setEdit({ workId, text: next })}
            onGenerate={(contentRev) => generate.mutate(contentRev)}
            generating={generate.isPending || previewJob?.status === 'running'}
            previewJob={previewJob}
          />
          {previewJob?.status === 'failed' ? <ErrorNotice code={previewJob.error ?? 'unknown'} /> : null}
          {preview ? (
            <PreviewPanel
              preview={preview}
              stale={stale}
              adopting={adopt.isPending}
              onAdopt={() => {
                if (previewJob) adopt.mutate(previewJob.id);
              }}
            />
          ) : null}
        </div>
      ) : null}
    </Page>
  );
}
