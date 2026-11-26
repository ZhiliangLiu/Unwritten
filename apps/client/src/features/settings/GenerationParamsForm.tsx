import { THINKING_LEVELS } from '@unwritten/contracts';
import type { ThinkingFormat, ThinkingLevel } from '@unwritten/contracts';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../shared/ui/Icon.tsx';
import { NumberField } from '../../shared/ui/NumberField.tsx';
import { Select } from '../../shared/ui/Select.tsx';
import { THINKING_LEVEL_LABEL_KEYS } from './labels.ts';
import { fieldAvailability } from './params-form.ts';
import type { ParamsFormState } from './params-form.ts';
import styles from './GenerationParamsForm.module.css';

export function GenerationParamsForm({
  form,
  onChange,
  model,
  disabled,
}: {
  form: ParamsFormState;
  onChange: (form: ParamsFormState) => void;
  model: { reasoning: boolean | null; thinkingFormat: ThinkingFormat } | null;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const availability = fieldAvailability(form, model);
  const levels: Array<ThinkingLevel | 'unset'> = ['unset', ...THINKING_LEVELS];
  const thinkingOptions = levels.map((level) => ({ value: level, label: t(THINKING_LEVEL_LABEL_KEYS[level]) }));

  return (
    <div className={styles.form}>
      <div className={styles.pair}>
        <Select
          label={t('settings:params.thinking')}
          value={form.thinking}
          onValueChange={(value) => onChange({ ...form, thinking: value as ThinkingLevel | 'unset' })}
          options={thinkingOptions}
          disabled={disabled || !availability.thinking.enabled}
          description={!disabled && availability.thinking.reasonKey ? t(availability.thinking.reasonKey) : undefined}
        />
        <NumberField
          label={t('settings:params.thinkingBudget')}
          value={form.thinkingBudget}
          onValueChange={(value) => onChange({ ...form, thinkingBudget: value })}
          min={1}
          step={1}
          disabled={disabled || !availability.thinkingBudget.enabled}
          description={
            !disabled && availability.thinkingBudget.reasonKey ? t(availability.thinkingBudget.reasonKey) : undefined
          }
        />
      </div>
      <div className={styles.sampling}>
        <NumberField
          label={t('settings:params.temperature')}
          value={form.temperature}
          onValueChange={(value) => onChange({ ...form, temperature: value })}
          min={0}
          max={2}
          step={0.1}
          disabled={disabled}
        />
        <NumberField
          label={t('settings:params.topP')}
          value={form.topP}
          onValueChange={(value) => onChange({ ...form, topP: value })}
          min={0}
          max={1}
          step={0.05}
          disabled={disabled}
        />
        <NumberField
          label={t('settings:params.topK')}
          value={form.topK}
          onValueChange={(value) => onChange({ ...form, topK: value })}
          min={1}
          step={1}
          disabled={disabled}
        />
        <NumberField
          label={t('settings:params.minP')}
          value={form.minP}
          onValueChange={(value) => onChange({ ...form, minP: value })}
          min={0}
          max={1}
          step={0.01}
          disabled={disabled}
        />
      </div>
      {availability.samplingWarningKey && !disabled ? (
        <p className={styles.warning}>
          <span className={styles.warningIcon}>
            <Icon icon={TriangleAlert} size='sm' />
          </span>
          {t(availability.samplingWarningKey)}
        </p>
      ) : null}
      {!disabled ? <p className={styles.hint}>{t('settings:params.unsetHint')}</p> : null}
    </div>
  );
}
