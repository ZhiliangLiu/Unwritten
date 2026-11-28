import { Link } from '@tanstack/react-router';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buttonClassName } from '../../shared/ui/Button.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import styles from './EndedPanel.module.css';

export function EndedPanel({ workId }: { workId: string }) {
  const { t } = useTranslation();

  return (
    <section className={styles.panel}>
      <h2 className={styles.heading}>{t('play:ended.heading')}</h2>
      <p className={styles.description}>{t('play:ended.description')}</p>
      <div className={styles.actions}>
        <Link className={buttonClassName('primary')} to='/works/$workId/start' params={{ workId }}>
          <Icon icon={RotateCcw} />
          {t('play:ended.restart')}
        </Link>
        <Link className={buttonClassName('text')} to='/works/$workId/playthroughs' params={{ workId }}>
          {t('play:ended.playthroughs')}
        </Link>
        <Link className={buttonClassName('text')} to='/'>
          {t('play:ended.back')}
        </Link>
      </div>
    </section>
  );
}
