import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '../../shared/api/query.ts';
import { useApi } from '../../shared/api/context.tsx';
import { reportSample } from '../../shared/lib/log.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { EmptyState } from '../../shared/ui/EmptyState.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { IconButton } from '../../shared/ui/IconButton.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { DeleteWorkDialog } from './DeleteWorkDialog.tsx';
import { WorkCard } from './WorkCard.tsx';
import styles from './LibraryPage.module.css';

export function LibraryPage() {
  const api = useApi();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const works = useQuery({ queryKey: queryKeys.works, queryFn: () => api.works.list() });
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const startedAt = useRef<number | null>(null);
  const reported = useRef(false);

  useEffect(() => {
    if (startedAt.current === null) startedAt.current = performance.now();
  }, []);

  useEffect(() => {
    if (reported.current || (!works.data && !works.error)) return;
    reported.current = true;
    reportSample(api, {
      metric: 'client.library_ready',
      durationMs: performance.now() - (startedAt.current ?? performance.now()),
      outcome: works.error ? 'error' : 'ok',
    });
  }, [api, works.data, works.error]);

  const create = useMutation({
    mutationFn: () => api.works.create({ workId: crypto.randomUUID() }),
    onSuccess: (work) => navigate({ to: '/works/$workId/edit', params: { workId: work.id } }),
  });

  const target = works.data?.find((work) => work.id === deleteTarget) ?? null;
  const createWork = () => create.mutate();

  return (
    <Page
      title={t('library:page.heading')}
      heading='content'
      subtitle={works.data ? t('library:page.count', { count: works.data.length }) : undefined}
      toolbar={{
        start: { kind: 'brand' },
        tools: <IconButton label={t('common:nav.settings')} icon={Settings} render={<Link to='/settings' />} />,
      }}
      headerActions={
        works.data && works.data.length > 0 ? (
          <Button variant='primary' icon={Plus} busy={create.isPending} onClick={createWork}>
            {t('library:action.create')}
          </Button>
        ) : undefined
      }
      width='page'
    >
      <ErrorNotice error={deleteError ?? works.error ?? create.error} />
      {works.isLoading ? <Skeleton variant='card' count={3} /> : null}
      {works.data?.length === 0 ? (
        <EmptyState
          title={t('library:empty.heading')}
          description={t('library:empty.description')}
          headingLevel={2}
          action={
            <Button variant='primary' icon={Plus} busy={create.isPending} onClick={createWork}>
              {t('library:action.create')}
            </Button>
          }
        />
      ) : null}
      {works.data && works.data.length > 0 ? (
        <div className={styles.grid}>
          {works.data.map((work) => (
            <WorkCard
              key={work.id}
              work={work}
              onDelete={() => {
                setDeleteError(null);
                setDeleteTarget(work.id);
              }}
            />
          ))}
        </div>
      ) : null}
      {target ? (
        <DeleteWorkDialog
          work={target}
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          onError={(error) => {
            setDeleteTarget(null);
            setDeleteError(error);
          }}
        />
      ) : null}
    </Page>
  );
}
