import { Link } from '@tanstack/react-router';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkDetail } from '@unwritten/contracts';
import { Button, buttonClassName } from '../../shared/ui/Button.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import styles from './PublishedPanel.module.css';

export function PublishedPanel({
  work,
  applying,
  dirty,
  planConfirmed,
  planRunning,
  onApply,
}: {
  work: WorkDetail;
  applying: boolean;
  dirty: boolean;
  planConfirmed: boolean;
  planRunning: boolean;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const title = work.title ?? work.latestPreviewJob?.preview?.title ?? null;
  const blurb = work.blurb ?? work.latestPreviewJob?.preview?.blurb ?? null;

  return (
    <section className={styles.panel}>
      <h2 className={styles.heading}>{t('authoring:published.heading')}</h2>
      {title ? <h3 className={styles.title}>{title}</h3> : null}
      {blurb ? <p className={styles.blurb}>{blurb}</p> : null}
      <div className={styles.actions}>
        <Link className={buttonClassName('primary')} to='/works/$workId/start' params={{ workId: work.id }}>
          <Icon icon={Play} size='sm' />
          {t('authoring:published.play')}
        </Link>
        <Link className={buttonClassName('text')} to='/'>
          {t('authoring:published.back')}
        </Link>
      </div>
      {work.hasUnpublishedChanges ? (
        <div className={styles.apply}>
          <p className={styles.applyText}>
            {work.routeCount > 0
              ? t('authoring:published.applyHelp', { count: work.routeCount })
              : t('authoring:published.applyHelpNoRoutes')}
          </p>
          <div className={styles.applyActions}>
            <Button
              variant='secondary'
              busy={applying}
              disabled={dirty || !planConfirmed || planRunning}
              onClick={onApply}
            >
              {t('authoring:published.apply')}
            </Button>
            {dirty ? <p className={styles.applyStatus}>{t('authoring:published.saving')}</p> : null}
            {!dirty && planRunning ? (
              <p className={styles.applyStatus}>{t('authoring:published.planRunning')}</p>
            ) : null}
            {!dirty && !planRunning && !planConfirmed ? (
              <p className={styles.applyStatus}>{t('authoring:published.confirmFirst')}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
