import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileUp, Plus, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NOVEL_IMPORT_MAX_BYTES, NOVEL_IMPORT_PART_BYTES } from '@unwritten/contracts';
import { queryKeys } from '../../shared/api/query.ts';
import { useApi } from '../../shared/api/context.tsx';
import { reportSample } from '../../shared/lib/log.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { EmptyState } from '../../shared/ui/EmptyState.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { IconButton } from '../../shared/ui/IconButton.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden.tsx';
import { DeleteWorkDialog } from './DeleteWorkDialog.tsx';
import { WorkCard } from './WorkCard.tsx';
import styles from './LibraryPage.module.css';

export function LibraryPage() {
  const api = useApi();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const works = useQuery({ queryKey: queryKeys.works, queryFn: () => api.works.list() });
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [novel, setNovel] = useState<{ workId: string; file: File } | null>(null);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [novelTooLarge, setNovelTooLarge] = useState(false);
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

  const importNovel = useMutation({
    mutationFn: async ({ workId, file }: { workId: string; file: File }) => {
      setUploadedBytes(0);
      for (let offset = 0; offset < Math.max(file.size, 1); offset += NOVEL_IMPORT_PART_BYTES) {
        const part = file.slice(offset, offset + NOVEL_IMPORT_PART_BYTES, file.type);
        await api.works.importNovel({
          workId,
          file: new File([part], file.name, { type: file.type }),
          offset,
          totalBytes: file.size,
        });
        setUploadedBytes(offset + part.size);
      }
      return { workId };
    },
    onSuccess: ({ workId }) => navigate({ to: '/works/$workId/edit', params: { workId } }),
  });

  const target = works.data?.find((work) => work.id === deleteTarget) ?? null;
  const createWork = () => create.mutate();

  const actions = (
    <div className={styles.actions}>
      <Button variant='primary' icon={Plus} busy={create.isPending} onClick={createWork}>
        {t('library:action.create')}
      </Button>
      <Button variant='secondary' icon={FileUp} onClick={() => fileInput.current?.click()}>
        {t('library:action.importNovel')}
      </Button>
    </div>
  );

  return (
    <Page
      title={t('library:page.heading')}
      heading='content'
      subtitle={works.data ? t('library:page.count', { count: works.data.length }) : undefined}
      toolbar={{
        start: { kind: 'brand' },
        tools: <IconButton label={t('common:nav.settings')} icon={Settings} render={<Link to='/settings' />} />,
      }}
      headerActions={works.data && works.data.length > 0 ? actions : undefined}
      width='page'
    >
      <VisuallyHidden>
        <input
          ref={fileInput}
          type='file'
          tabIndex={-1}
          accept='.txt,text/plain'
          aria-label={t('library:novel.file')}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            importNovel.reset();
            setNovelTooLarge(file.size > NOVEL_IMPORT_MAX_BYTES);
            if (file.size <= NOVEL_IMPORT_MAX_BYTES) setNovel({ workId: crypto.randomUUID(), file });
          }}
        />
      </VisuallyHidden>
      {novelTooLarge ? <ErrorNotice code='novel_too_large' /> : null}
      {novel ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open && !importNovel.isPending) setNovel(null);
          }}
          title={t('library:novel.title')}
          description={
            importNovel.isPending
              ? t('library:novel.uploading', {
                  progress: new Intl.NumberFormat(i18n.language, { style: 'percent' }).format(
                    uploadedBytes / Math.max(novel.file.size, 1),
                  ),
                })
              : t('library:novel.description', { name: novel.file.name })
          }
          confirmLabel={t('library:action.importNovel')}
          tone='default'
          busy={importNovel.isPending}
          error={importNovel.error}
          onConfirm={() => importNovel.mutate(novel)}
        />
      ) : null}
      <ErrorNotice error={deleteError ?? works.error ?? create.error} />
      {works.isLoading ? <Skeleton variant='card' count={3} /> : null}
      {works.data?.length === 0 ? (
        <EmptyState
          title={t('library:empty.heading')}
          description={t('library:empty.description')}
          headingLevel={2}
          action={actions}
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
