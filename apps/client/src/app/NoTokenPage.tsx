import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './NoTokenPage.module.css';

export function NoTokenPage({ expired }: { expired: boolean }) {
  const { t } = useTranslation();
  const heading = t('common:noToken.heading');
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = t('common:app.documentTitle', { title: heading });
    headingRef.current?.focus();
  }, [heading, t]);
  return (
    <main className={styles.center}>
      <h1 className={styles.heading} tabIndex={-1} ref={headingRef}>
        {heading}
      </h1>
      <p>{expired ? t('common:noToken.expired') : t('common:noToken.description')}</p>
    </main>
  );
}
