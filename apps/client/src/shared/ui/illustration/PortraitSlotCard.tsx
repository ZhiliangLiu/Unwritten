import { useEffect, useId, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OutputPreferences, PortraitSlot, PortraitSlotView } from '@unwritten/contracts';
import { useApi } from '../../api/context.tsx';
import { useImageBlob } from '../../hooks/useImageBlob.ts';
import { prepareImportedImage } from '../../lib/image-import.ts';
import type { ImportProblem } from '../../lib/image-import.ts';
import { PORTRAIT_SLOT_LABEL_KEYS } from '../../lib/image-labels.ts';
import { Button } from '../Button.tsx';
import { ErrorNotice } from '../ErrorNotice.tsx';
import { GeneratingMarker } from '../GeneratingMarker.tsx';
import { Skeleton } from '../Skeleton.tsx';
import styles from './PortraitSlotCard.module.css';

const SLOT_HINT_KEYS: Record<PortraitSlot, string> = {
  front: 'authoring:portrait.slotHint.front',
  three_quarter: 'authoring:portrait.slotHint.three_quarter',
  full_body: 'authoring:portrait.slotHint.full_body',
};

const IMPORT_PROBLEM_KEYS: Record<ImportProblem, string> = {
  type: 'authoring:portrait.importProblem.type',
  too_large: 'authoring:portrait.importProblem.too_large',
  too_many_pixels: 'authoring:portrait.importProblem.too_many_pixels',
  decode: 'authoring:portrait.importProblem.decode',
  encode: 'authoring:portrait.importProblem.encode',
};

export function PortraitSlotCard({
  workId,
  setId,
  slot,
  view,
  expectedRev,
  updatedAt,
  format,
  canGenerate,
  onChanged,
  onError,
}: {
  workId: string;
  setId: string;
  slot: PortraitSlot;
  view: PortraitSlotView;
  expectedRev: number;
  updatedAt: number;
  format: OutputPreferences | null;
  canGenerate: boolean;
  onChanged: () => void;
  onError: (error: unknown) => void;
}) {
  const api = useApi();
  const { t } = useTranslation();
  const nameId = useId();
  const problemId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<ImportProblem | null>(null);
  const [preview, setPreview] = useState<{ url: string; file: File } | null>(null);
  const label = t(PORTRAIT_SLOT_LABEL_KEYS[slot]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const image = useImageBlob(
    view.image ? { view: { kind: 'work', workId }, image: { kind: 'portrait', setId, slot } } : null,
    updatedAt,
  );

  const upload = useMutation({
    mutationFn: (file: File) => api.portrait.upload({ requestId: crypto.randomUUID(), setId, slot, expectedRev, file }),
    onSuccess: () => {
      setPreview(null);
      setProblem(null);
      onChanged();
    },
    onError,
  });

  const generate = useMutation({
    mutationFn: () => {
      if (!format) return Promise.resolve(null);
      return api.portrait.generate({ requestId: crypto.randomUUID(), setId, slot, expectedRev, format });
    },
    onSuccess: onChanged,
    onError,
  });

  const update = useMutation({
    mutationFn: (kind: 'confirm' | 'remove') =>
      api.portrait.update({
        requestId: crypto.randomUUID(),
        setId,
        expectedRev,
        action: kind === 'remove' ? { kind: 'remove', slot } : { kind: 'confirm', slot },
      }),
    onSuccess: onChanged,
    onError,
  });

  const chooseFile = async (file: File) => {
    const prepared = await prepareImportedImage(file);
    if (!prepared.ok) {
      setProblem(prepared.problem);
      return;
    }
    setProblem(null);
    setPreview({ url: URL.createObjectURL(prepared.file), file: prepared.file });
  };

  return (
    <section className={styles.slot} aria-labelledby={nameId} aria-describedby={problem ? problemId : undefined}>
      <div className={styles.header}>
        <p className={styles.name} id={nameId}>
          {label}
        </p>
        <p className={styles.hint}>{t(SLOT_HINT_KEYS[slot])}</p>
      </div>
      <div className={styles.body}>
        <div className={styles.frame}>
          {preview ? (
            <img className={styles.image} src={preview.url} alt={t('authoring:portrait.slotAlt', { slot: label })} />
          ) : view.image ? (
            image.status === 'ready' ? (
              <img className={styles.image} src={image.url} alt={t('authoring:portrait.slotAlt', { slot: label })} />
            ) : image.status === 'error' ? (
              <ErrorNotice code={image.code} />
            ) : (
              <Skeleton variant='card' />
            )
          ) : view.task?.status === 'running' ? (
            <GeneratingMarker label={t('authoring:portrait.generating')} />
          ) : (
            <p className={styles.status}>{t('authoring:portrait.empty')}</p>
          )}
        </div>
        {view.image && view.task?.status === 'running' ? (
          <GeneratingMarker label={t('authoring:portrait.generating')} />
        ) : null}
        {view.task?.status === 'failed' ? <ErrorNotice code={view.task.error ?? 'unknown'} /> : null}
        {view.needsReview ? <p className={styles.status}>{t('authoring:portrait.needsReview')}</p> : null}
        {problem ? (
          <p className={styles.problem} id={problemId}>
            {t(IMPORT_PROBLEM_KEYS[problem])}
          </p>
        ) : null}
        {preview ? (
          <div className={styles.actions}>
            <Button size='sm' variant='primary' busy={upload.isPending} onClick={() => upload.mutate(preview.file)}>
              {t('authoring:portrait.useImage')}
            </Button>
            <Button size='sm' variant='secondary' onClick={() => setPreview(null)}>
              {t('common:action.cancel')}
            </Button>
          </div>
        ) : (
          <div className={styles.actions}>
            {view.needsReview ? (
              <Button size='sm' variant='secondary' busy={update.isPending} onClick={() => update.mutate('confirm')}>
                {t('authoring:portrait.confirm')}
              </Button>
            ) : null}
            <Button size='sm' variant='secondary' onClick={() => fileInput.current?.click()}>
              {t('authoring:portrait.choose')}
            </Button>
            <Button
              size='sm'
              variant='secondary'
              busy={generate.isPending}
              disabled={!canGenerate}
              onClick={() => generate.mutate()}
            >
              {view.task?.status === 'failed' ? t('common:action.retry') : t('authoring:portrait.generate')}
            </Button>
            {view.image ? (
              <Button size='sm' variant='text' busy={update.isPending} onClick={() => update.mutate('remove')}>
                {t('authoring:portrait.remove')}
              </Button>
            ) : null}
          </div>
        )}
      </div>
      <input
        ref={fileInput}
        className={styles.fileInput}
        type='file'
        tabIndex={-1}
        accept='image/png,image/jpeg,image/webp'
        aria-label={t('authoring:portrait.chooseNamed', { slot: label })}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void chooseFile(file);
        }}
      />
    </section>
  );
}
