import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon.tsx';
import { Logo } from './Logo.tsx';
import { VisuallyHidden } from './VisuallyHidden.tsx';
import styles from './PageToolbar.module.css';

export type PageToolbarStart = { kind: 'back'; to: '/' | '/settings'; label: string } | { kind: 'brand' };

export function PageToolbar({
  start,
  title,
  titleBadge,
  titleIsHeading,
  tools,
}: {
  start: PageToolbarStart;
  title?: string;
  titleBadge?: ReactNode;
  titleIsHeading: boolean;
  tools?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <header className={styles.toolbar}>
      <div className={styles.start}>
        {start.kind === 'back' ? (
          <Link to={start.to} className={styles.back}>
            <Icon icon={ArrowLeft} />
            <span>{start.label}</span>
          </Link>
        ) : (
          <>
            <Logo variant='simple' withWordmark />
            <VisuallyHidden>{t('common:app.name')}</VisuallyHidden>
          </>
        )}
      </div>
      <div className={styles.titleArea}>
        {title ? (
          titleIsHeading ? (
            <h1 className={styles.title} tabIndex={-1}>
              {title}
            </h1>
          ) : (
            <span className={styles.title}>{title}</span>
          )
        ) : null}
        {titleBadge}
      </div>
      <div className={styles.tools}>{tools}</div>
    </header>
  );
}
