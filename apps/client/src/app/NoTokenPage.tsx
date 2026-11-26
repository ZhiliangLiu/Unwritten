import { useTranslation } from 'react-i18next';
import styles from './NoTokenPage.module.css';

export function NoTokenPage() {
  const { t } = useTranslation();
  return (
    <div className={styles.center}>
      <h1 className={styles.heading}>{t('common:noToken.heading')}</h1>
      <p>{t('common:noToken.description')}</p>
    </div>
  );
}
