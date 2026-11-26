import styles from './GeneratingMarker.module.css';

export function GeneratingMarker({ label }: { label: string }) {
  return (
    <p className={styles.marker}>
      <span aria-hidden='true' className={styles.dot} />
      <span>{label}</span>
    </p>
  );
}
