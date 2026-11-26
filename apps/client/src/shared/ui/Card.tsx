import type { ReactNode } from 'react';
import styles from './Card.module.css';

export function Card({ as: Tag = 'div', children }: { as?: 'article' | 'section' | 'div'; children: ReactNode }) {
  return <Tag className={styles.card}>{children}</Tag>;
}
