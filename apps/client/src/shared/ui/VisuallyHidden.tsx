import type { ElementType, ReactNode } from 'react';
import styles from './VisuallyHidden.module.css';

export function VisuallyHidden({ children, as: Tag = 'span' }: { children: ReactNode; as?: ElementType }) {
  return <Tag className={styles.visuallyHidden}>{children}</Tag>;
}
