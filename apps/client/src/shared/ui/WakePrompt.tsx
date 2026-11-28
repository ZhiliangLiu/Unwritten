import { useEffect, useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/context.tsx';
import { useImageServiceState } from '../hooks/useImageServiceState.ts';
import { WAKE_REASON_LABEL_KEYS } from '../lib/image-labels.ts';
import { Button } from './Button.tsx';
import { ErrorNotice } from './ErrorNotice.tsx';
import { LiveRegion } from './LiveRegion.tsx';
import { VisuallyHidden } from './VisuallyHidden.tsx';
import styles from './WakePrompt.module.css';

interface WakeAnnouncement {
  url: string;
  text: string;
}

export function WakePrompt({ serviceId }: { serviceId: string | null }) {
  const api = useApi();
  const { t } = useTranslation();
  const headingId = useId();
  const { state, action, wakeFailure } = useImageServiceState(serviceId);
  const continueWake = useMutation({
    mutationFn: () => {
      if (serviceId === null) return Promise.resolve({});
      return api.image.wake.continue({ serviceId, requestId: crypto.randomUUID() });
    },
  });
  const [announcement, setAnnouncement] = useState<WakeAnnouncement | null>(null);

  useEffect(() => {
    if (state !== 'needs_action' || action === null || announcement?.url === action.url) return;
    const timer = setTimeout(() => {
      setAnnouncement({ url: action.url, text: t('common:wake.needsAction') });
    }, 0);
    return () => clearTimeout(timer);
  }, [action, announcement, state, t]);

  const failure = state === 'wake_failed' ? wakeFailure : null;
  const needsAction = state === 'needs_action' && action !== null;
  if (!needsAction && state !== 'waking' && failure === null) return null;

  return (
    <section className={styles.prompt} aria-labelledby={headingId}>
      <VisuallyHidden as='h2'>
        <span id={headingId}>{t('common:wake.heading')}</span>
      </VisuallyHidden>
      {state === 'needs_action' && action ? (
        <>
          <p className={styles.text}>{t('common:wake.needsAction')}</p>
          <div className={styles.actions}>
            <Button variant='secondary' onClick={() => window.open(action.url, '_blank', 'noopener,noreferrer')}>
              {t('common:wake.open')}
            </Button>
            <Button variant='primary' busy={continueWake.isPending} onClick={() => continueWake.mutate()}>
              {continueWake.isPending ? t('common:wake.continuing') : t('common:wake.continue')}
            </Button>
          </div>
          {continueWake.error ? <ErrorNotice error={continueWake.error} /> : null}
          <LiveRegion message={announcement?.url === action.url ? announcement.text : ''} />
        </>
      ) : null}
      {state === 'waking' ? <p className={styles.text}>{t('common:wake.waking')}</p> : null}
      {failure ? (
        <>
          <p className={styles.text}>{t('common:wake.failed')}</p>
          <p className={styles.reason}>
            {failure.reason ? t(WAKE_REASON_LABEL_KEYS[failure.reason]) : t(`errors:${failure.code}`)}
          </p>
        </>
      ) : null}
    </section>
  );
}
