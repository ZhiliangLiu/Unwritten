import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import styles from './Badge.module.css';

function toneClass(tone: 'neutral' | 'success' | 'warning' | 'danger'): string {
  if (tone === 'success') return `${styles.badge} ${styles.success}`;
  if (tone === 'warning') return `${styles.badge} ${styles.warning}`;
  if (tone === 'danger') return `${styles.badge} ${styles.danger}`;
  return styles.badge!;
}

export function Badge({
  tone,
  icon,
  children,
}: {
  tone: 'neutral' | 'success' | 'warning' | 'danger';
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span className={toneClass(tone)}>
      {icon ? <Icon icon={icon} size='sm' /> : null}
      {children}
    </span>
  );
}
