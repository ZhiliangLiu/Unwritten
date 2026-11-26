import { useTranslation } from 'react-i18next';
import { Button } from '../../shared/ui/Button.tsx';
import styles from './BackToLatest.module.css';

export function BackToLatest({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();

  return (
    <Button variant='text' size='sm' className={styles.button} onClick={onClick}>
      {t('play:history.latest')}
    </Button>
  );
}
