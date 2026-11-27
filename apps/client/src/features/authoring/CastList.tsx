import { useTranslation } from 'react-i18next';
import type { PreviewCastMember } from '@unwritten/contracts';
import styles from './CastList.module.css';

export function CastList({ cast }: { cast: PreviewCastMember[] }) {
  const { t } = useTranslation();

  return (
    <section className={styles.cast}>
      <h3 className={styles.heading}>{t('authoring:cast.headingOpening')}</h3>
      <ul className={styles.list}>
        {cast.map((member, index) => (
          <li key={`${index}`} className={styles.member}>
            <p className={styles.name}>{member.name}</p>
            {member.knownAs && member.knownAs !== member.name ? (
              <p className={styles.knownAs}>{t('authoring:cast.knownAs', { name: member.knownAs })}</p>
            ) : null}
            <p className={styles.profile}>{member.profile}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
