import { useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AspectPreference, ImageTierPreference, IllustrationView, OutputPreferences } from '@unwritten/contracts';
import { useApi } from '../../shared/api/context.tsx';
import { errorCode } from '../../shared/api/errors.ts';
import { queryKeys } from '../../shared/api/query.ts';
import { ILLUSTRATION_STAGE_LABEL_KEYS, IMAGE_TIER_LABEL_KEYS } from '../../shared/lib/image-labels.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { Select } from '../../shared/ui/Select.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import type { IllustrationActions } from './useIllustrationActions.ts';
import styles from './IllustrationFailed.module.css';

function FormatDialog({
  open,
  onOpenChange,
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (format: OutputPreferences) => void;
  busy: boolean;
}) {
  const api = useApi();
  const { t } = useTranslation();
  const options = useQuery({
    queryKey: queryKeys.imageOutput,
    queryFn: () => api.image.outputPreferences.get(),
    enabled: open,
  });
  const [aspect, setAspect] = useState<AspectPreference | null>(null);
  const [tier, setTier] = useState<ImageTierPreference | null>(null);
  const preferences = options.data?.preferences;

  const confirm = () => {
    if (!preferences) return;
    onConfirm({
      aspectPreference: aspect ?? preferences.aspectPreference,
      resolutionTier: tier ?? preferences.resolutionTier,
    });
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Viewport className={styles.viewport}>
          <Dialog.Popup className={styles.dialog}>
            <Dialog.Title className={styles.dialogTitle}>{t('play:illustration.retryFormat')}</Dialog.Title>
            {options.error ? (
              <ErrorNotice error={options.error} />
            ) : options.data && preferences ? (
              <>
                <Select
                  label={t('play:format.aspect')}
                  value={aspect ?? preferences.aspectPreference}
                  onValueChange={(value) => setAspect(value as AspectPreference)}
                  options={[
                    { value: 'auto', label: t('play:format.automatic') },
                    ...options.data.aspects.map((value) => ({ value, label: value })),
                  ]}
                />
                <Select
                  label={t('play:format.tier')}
                  value={tier ?? preferences.resolutionTier}
                  onValueChange={(value) => setTier(value as ImageTierPreference)}
                  options={options.data.tiers.map((option) => ({
                    value: option.tier,
                    label: t(IMAGE_TIER_LABEL_KEYS[option.tier]),
                  }))}
                />
              </>
            ) : (
              <Skeleton variant='lines' count={2} />
            )}
            <div className={styles.dialogActions}>
              <Button variant='secondary' onClick={() => onOpenChange(false)}>
                {t('common:action.cancel')}
              </Button>
              <Button variant='primary' busy={busy} disabled={!preferences} onClick={confirm}>
                {t('common:action.retry')}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function IllustrationFailed({
  illustration,
  depth,
  paraAnchorId,
  actions,
}: {
  illustration: IllustrationView;
  depth: number;
  paraAnchorId: string;
  actions: IllustrationActions;
}) {
  const { t } = useTranslation();
  const [formatOpen, setFormatOpen] = useState(false);
  const stage = illustration.stage;
  const opensFormat = illustration.error === 'image_output_format_unavailable';
  const retryLabel =
    depth === 0 ? t('play:illustration.retryOpening') : t('play:illustration.retryNamed', { turn: depth });
  const dismissLabel =
    depth === 0 ? t('play:illustration.dismissOpening') : t('play:illustration.dismissNamed', { turn: depth });

  const retry = () => {
    if (opensFormat) {
      setFormatOpen(true);
      return;
    }
    actions.retry.mutate({ illustrationId: illustration.id });
  };

  const dismiss = () => {
    actions.dismiss.mutate(illustration.id, {
      onSuccess: () => document.getElementById(paraAnchorId)?.focus({ preventScroll: true }),
    });
  };

  return (
    <div className={styles.failed}>
      <p className={styles.reason}>
        {stage ? <span className={styles.stage}>{t(ILLUSTRATION_STAGE_LABEL_KEYS[stage])}</span> : null}
        <span>{t(`errors:${illustration.error ?? 'unknown'}`)}</span>
      </p>
      <div className={styles.actions}>
        <Button size='sm' variant='secondary' busy={actions.retry.isPending} onClick={retry}>
          {retryLabel}
        </Button>
        <Button size='sm' variant='text' busy={actions.dismiss.isPending} onClick={dismiss}>
          {dismissLabel}
        </Button>
      </div>
      {actions.retry.error ? (
        <p className={styles.actionError}>{t(`errors:${errorCode(actions.retry.error)}`)}</p>
      ) : null}
      {actions.dismiss.error ? (
        <p className={styles.actionError}>{t(`errors:${errorCode(actions.dismiss.error)}`)}</p>
      ) : null}
      <FormatDialog
        open={formatOpen}
        onOpenChange={setFormatOpen}
        busy={actions.retry.isPending}
        onConfirm={(format) => actions.retry.mutate({ illustrationId: illustration.id, format })}
      />
    </div>
  );
}
