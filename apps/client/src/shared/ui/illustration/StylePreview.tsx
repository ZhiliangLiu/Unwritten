import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { IllustrationStyle } from '@unwritten/contracts';
import { useApi } from '../../api/context.tsx';
import { queryKeys } from '../../api/query.ts';
import { useImageBlob } from '../../hooks/useImageBlob.ts';
import { Button } from '../Button.tsx';
import { ErrorNotice } from '../ErrorNotice.tsx';
import { GeneratingMarker } from '../GeneratingMarker.tsx';
import { Skeleton } from '../Skeleton.tsx';
import styles from './StylePreview.module.css';

function sameStyle(left: IllustrationStyle, right: IllustrationStyle): boolean {
  if (left.kind === 'preset') return right.kind === 'preset' && left.preset === right.preset;
  return right.kind === 'custom' && left.text === right.text;
}

export function StylePreview({
  workId,
  style,
  viewWorkId,
}: {
  workId: string;
  style: IllustrationStyle;
  viewWorkId: string;
}) {
  const api = useApi();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [previewed, setPreviewed] = useState<{ setId: string; style: IllustrationStyle } | null>(null);

  const config = useQuery({ queryKey: queryKeys.imageConfig, queryFn: () => api.image.services.list() });
  const noService = config.data !== undefined && config.data.selectedServiceId === null;
  const customEmpty = style.kind === 'custom' && style.text.trim().length === 0;

  const preview = useMutation({
    mutationFn: (requested: IllustrationStyle) =>
      api.portrait.preview({ requestId: crypto.randomUUID(), workId, style: requested }),
    onSuccess: (set, requested) => {
      setPreviewed({ setId: set.id, style: requested });
      queryClient.setQueryData(queryKeys.portraitSet(workId, set.id), set);
    },
  });

  const showsPreview = previewed !== null && sameStyle(previewed.style, style);
  const setId = showsPreview ? previewed.setId : null;
  const tracked = useQuery({
    queryKey: queryKeys.portraitSet(workId, setId ?? 'none'),
    queryFn: () => api.portrait.get({ setId: setId ?? '' }),
    enabled: setId !== null,
  });

  const set = setId === null ? null : (tracked.data ?? null);
  const front = set?.slots.find((slot) => slot.slot === 'front') ?? null;
  const image = useImageBlob(
    set && front?.image
      ? { view: { kind: 'work', workId: viewWorkId }, image: { kind: 'portrait', setId: set.id, slot: 'front' } }
      : null,
    set?.updatedAt ?? 0,
  );
  const generating = preview.isPending || front?.task?.status === 'running';
  const failed = front?.task?.status === 'failed' ? (front.task.error ?? 'unknown') : null;
  const requestedStyle = preview.variables;
  const previewError = preview.isError && requestedStyle && sameStyle(requestedStyle, style) ? preview.error : null;

  return (
    <div className={styles.preview}>
      <div className={styles.actions}>
        <Button
          variant='secondary'
          busy={preview.isPending}
          disabled={noService || customEmpty || config.isLoading}
          onClick={() => preview.mutate(style)}
        >
          {t('authoring:style.preview')}
        </Button>
        {noService ? <p className={styles.note}>{t('authoring:style.noService')}</p> : null}
      </div>
      {generating ? <GeneratingMarker label={t('authoring:style.previewing')} /> : null}
      {failed ? <ErrorNotice code={failed} /> : null}
      <ErrorNotice error={previewError ?? (showsPreview ? tracked.error : null)} />
      {image.status === 'error' ? <ErrorNotice code={image.code} /> : null}
      {front?.image && image.status === 'ready' ? (
        <img className={styles.image} src={image.url} alt={t('authoring:style.previewAlt')} />
      ) : front?.image && image.status === 'loading' ? (
        <Skeleton variant='card' />
      ) : null}
    </div>
  );
}
