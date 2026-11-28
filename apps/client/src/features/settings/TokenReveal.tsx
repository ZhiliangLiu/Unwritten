import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { Button } from '../../shared/ui/Button.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import fieldStyles from '../../shared/ui/Field.module.css';
import styles from './TokenReveal.module.css';

export function TokenReveal({
  value,
  onValueChange,
  disabled,
}: {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const tokenId = useId();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const result = await api.image.services.generateToken();
      onValueChange(result.token);
    } catch (generateError) {
      setError(generateError);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className={styles.token}>
      <div>
        <Button variant='secondary' onClick={() => void generate()} disabled={disabled} busy={generating}>
          {t('settings:images.generateToken')}
        </Button>
      </div>
      {value ? (
        <div className={styles.reveal}>
          <label className={fieldStyles.label} htmlFor={tokenId}>
            {t('settings:images.newToken')}
          </label>
          <div className={styles.row}>
            <input
              id={tokenId}
              className={`${fieldStyles.control} ${fieldStyles.singleLine} ${fieldStyles.mono}`}
              value={value}
              readOnly
            />
            <Button
              variant='secondary'
              onClick={() => {
                void Promise.resolve(navigator.clipboard?.writeText(value)).catch(() => undefined);
              }}
            >
              {t('settings:images.copyToken')}
            </Button>
          </div>
          <p className={fieldStyles.description}>{t('settings:images.tokenOnce')}</p>
        </div>
      ) : null}
      <ErrorNotice error={error} />
    </div>
  );
}
