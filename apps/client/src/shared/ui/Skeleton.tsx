import { useTranslation } from 'react-i18next';
import { VisuallyHidden } from './VisuallyHidden.tsx';
import styles from './Skeleton.module.css';

export function Skeleton({ variant, count = 1 }: { variant: 'lines' | 'card' | 'prose'; count?: number }) {
  const { t } = useTranslation();
  return (
    <div>
      <VisuallyHidden>{t('common:status.loading')}</VisuallyHidden>
      <div aria-hidden='true' className={styles.blocks}>
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className={`${styles.block} ${styles[variant]}`} />
        ))}
      </div>
    </div>
  );
}
