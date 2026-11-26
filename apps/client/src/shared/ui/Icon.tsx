import type { LucideIcon } from 'lucide-react';
import styles from './Icon.module.css';

export function Icon({ icon: IconComponent, size = 'md' }: { icon: LucideIcon; size?: 'sm' | 'md' }) {
  return <IconComponent aria-hidden='true' className={size === 'sm' ? styles.sm : styles.md} />;
}
