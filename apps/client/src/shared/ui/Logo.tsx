import paths from './logo-paths.json';
import styles from './Logo.module.css';

type LogoVariant = 'full' | 'simple';

function Mark({ variant }: { variant: LogoVariant }) {
  const mark = paths[variant];
  return (
    <svg className={styles.mark} viewBox={mark.viewBox} aria-hidden='true'>
      {mark.ink.map((path, index) => (
        <path key={index} d={path} className={styles.ink} />
      ))}
      {mark.accent.map((path, index) => (
        <path key={index} d={path} className={styles.accent} />
      ))}
    </svg>
  );
}

export function Logo({ variant, withWordmark = false }: { variant: LogoVariant; withWordmark?: boolean }) {
  return (
    <span className={styles.logo} aria-hidden='true'>
      <Mark variant={variant} />
      {withWordmark ? (
        <svg className={styles.wordmark} viewBox={paths.wordmark.viewBox}>
          {paths.wordmark.ink.map((path, index) => (
            <path key={index} d={path} className={styles.ink} />
          ))}
        </svg>
      ) : null}
    </span>
  );
}
