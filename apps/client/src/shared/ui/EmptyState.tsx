import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import styles from './EmptyState.module.css';

export function EmptyState({
  title,
  description,
  action,
  icon,
  headingLevel,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: LucideIcon;
  headingLevel: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className={styles.empty}>
      {icon ? (
        <span className={styles.icon}>
          <Icon icon={icon} />
        </span>
      ) : null}
      <Heading className={styles.title}>{title}</Heading>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
