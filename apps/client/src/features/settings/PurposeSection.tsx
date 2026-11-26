import { PURPOSES } from '@unwritten/contracts';
import type { EndpointView, PurposeView } from '@unwritten/contracts';
import { useTranslation } from 'react-i18next';
import { PurposeCard } from './PurposeCard.tsx';
import styles from './PurposeSection.module.css';

export function PurposeSection({
  purposes,
  endpoints,
  revision,
  disabled,
}: {
  purposes: PurposeView[];
  endpoints: EndpointView[];
  revision: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();

  return (
    <fieldset className={styles.list} aria-label={t('settings:purpose.heading')}>
      {PURPOSES.map((name) => {
        const purpose = purposes.find((item) => item.purpose === name);
        return purpose ? (
          <PurposeCard key={name} purpose={purpose} endpoints={endpoints} revision={revision} disabled={disabled} />
        ) : null;
      })}
    </fieldset>
  );
}
