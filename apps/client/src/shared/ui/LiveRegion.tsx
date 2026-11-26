import styles from './LiveRegion.module.css';

export function LiveRegion({
  message,
  politeness = 'polite',
}: {
  message: string;
  politeness?: 'polite' | 'assertive';
}) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.region} aria-live={politeness} aria-atomic='true'>
        {message}
      </div>
    </div>
  );
}
