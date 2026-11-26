import type { LlmConfigView } from '@unwritten/contracts';
import { useTranslation } from 'react-i18next';
import { EndpointCard } from './EndpointCard.tsx';
import styles from './EndpointSection.module.css';

export function EndpointSection({ config, disabled }: { config: LlmConfigView; disabled: boolean }) {
  const { t } = useTranslation();

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{t('settings:endpoints.heading')}</h3>
      <div className={styles.list}>
        {config.endpoints.map((endpoint) => (
          <EndpointCard
            key={endpoint.id}
            endpoint={endpoint}
            purposes={config.purposes}
            revision={config.revision}
            disabled={disabled}
          />
        ))}
      </div>
    </section>
  );
}
