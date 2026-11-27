import { LoaderCircle } from 'lucide-react';
import { Icon } from './Icon.tsx';
import styles from './GeneratingMarker.module.css';

export function GeneratingMarker({ label }: { label: string }) {
  return (
    <p className={styles.marker}>
      <span className={styles.icon}>
        <Icon icon={LoaderCircle} size='sm' />
      </span>
      <span>{label}</span>
    </p>
  );
}
