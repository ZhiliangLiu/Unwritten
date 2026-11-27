import { useTranslation } from 'react-i18next';
import { WIZARD_STEPS } from '@unwritten/contracts';
import type { WizardStep } from '@unwritten/contracts';
import styles from './WizardSteps.module.css';

const STEP_LABEL_KEYS: Record<WizardStep, string> = {
  background: 'authoring:steps.background',
  plan: 'authoring:steps.plan',
  opening: 'authoring:steps.opening',
};

export function WizardSteps({
  current,
  available,
  onSelect,
}: {
  current: WizardStep;
  available: Record<WizardStep, boolean>;
  onSelect: (step: WizardStep) => void;
}) {
  const { t } = useTranslation();

  return (
    <nav className={styles.nav} aria-label={t('authoring:steps.label')}>
      <ol className={styles.list}>
        {WIZARD_STEPS.map((step, index) => (
          <li key={step} className={styles.item}>
            <button
              type='button'
              className={styles.step}
              aria-current={current === step ? 'step' : undefined}
              disabled={!available[step]}
              onClick={() => onSelect(step)}
            >
              <span className={styles.number} aria-hidden='true'>
                {index + 1}
              </span>
              {t(STEP_LABEL_KEYS[step])}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
