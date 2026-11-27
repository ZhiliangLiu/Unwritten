import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PlanConflict } from '@unwritten/contracts';
import { Icon } from '../../shared/ui/Icon.tsx';
import styles from './PlanConflicts.module.css';

export function PlanConflicts({ conflicts }: { conflicts: PlanConflict[] }) {
  const { t } = useTranslation();

  if (conflicts.length === 0) return null;

  return (
    <div className={styles.list}>
      {conflicts.map((conflict, index) => (
        <article key={`${index}`} className={styles.conflict}>
          <h3 className={styles.heading}>
            <span className={styles.icon}>
              <Icon icon={TriangleAlert} />
            </span>
            {t('authoring:plan.conflict.heading')}
          </h3>
          <blockquote className={styles.quote}>
            <p className={styles.label}>{t('authoring:plan.conflict.first')}</p>
            <p className={styles.text}>{conflict.first}</p>
          </blockquote>
          <blockquote className={styles.quote}>
            <p className={styles.label}>{t('authoring:plan.conflict.second')}</p>
            <p className={styles.text}>{conflict.second}</p>
          </blockquote>
          <p className={styles.impact}>{t('authoring:plan.conflict.impact', { text: conflict.impact })}</p>
        </article>
      ))}
    </div>
  );
}
