import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PageToolbar } from './PageToolbar.tsx';
import type { PageToolbarStart } from './PageToolbar.tsx';
import styles from './Page.module.css';

export function Page({
  title,
  heading,
  toolbar,
  subtitle,
  headerActions,
  width,
  children,
}: {
  title: string;
  heading: 'toolbar' | 'content';
  toolbar: { start: PageToolbarStart; titleBadge?: ReactNode; tools?: ReactNode };
  subtitle?: string;
  headerActions?: ReactNode;
  width: 'page' | 'prose';
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const firstRenderRef = useRef(true);

  useEffect(() => {
    document.title = t('common:app.documentTitle', { title });
    if (!firstRenderRef.current) return;
    firstRenderRef.current = false;
    containerRef.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [t, title]);

  return (
    <div ref={containerRef} className={styles.page}>
      <PageToolbar
        start={toolbar.start}
        title={heading === 'toolbar' ? title : undefined}
        titleBadge={toolbar.titleBadge}
        titleIsHeading={heading === 'toolbar'}
        tools={toolbar.tools}
      />
      <main className={width === 'prose' ? `${styles.main} ${styles.prose}` : `${styles.main} ${styles.content}`}>
        {heading === 'content' ? (
          <header className={styles.pageHeader}>
            <div className={styles.headingText}>
              <h1 className={styles.pageTitle} tabIndex={-1}>
                {title}
              </h1>
              {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
            </div>
            {headerActions ? <div className={styles.headerActions}>{headerActions}</div> : null}
          </header>
        ) : subtitle ? (
          <p className={styles.subtitle}>{subtitle}</p>
        ) : null}
        {children}
      </main>
    </div>
  );
}
