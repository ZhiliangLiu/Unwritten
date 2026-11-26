import { Link } from '@tanstack/react-router';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkDetail } from '@unwritten/contracts';
import { buttonClassName } from '../../shared/ui/Button.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import styles from './PublishedPanel.module.css';

export function PublishedPanel({ work }: { work: WorkDetail }) {
  const { t } = useTranslation();
  const title = work.title ?? work.latestPreviewJob?.preview?.title ?? null;
  const blurb = work.blurb ?? work.latestPreviewJob?.preview?.blurb ?? null;

  return (
    <section className={styles.panel}>
      <h2 className={styles.heading}>{t('authoring:published.heading')}</h2>
      {title ? <h3 className={styles.title}>{title}</h3> : null}
      {blurb ? <p className={styles.blurb}>{blurb}</p> : null}
      <div className={styles.actions}>
        {work.routeId ? (
          <Link className={buttonClassName('primary')} to='/play/$routeId' params={{ routeId: work.routeId }}>
            <Icon icon={Play} size='sm' />
            {t('authoring:published.play')}
          </Link>
        ) : null}
        <Link className={buttonClassName('text')} to='/'>
          {t('authoring:published.back')}
        </Link>
      </div>
    </section>
  );
}
