import { Radio } from '@base-ui/react/radio';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import { useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './Icon.tsx';
import fieldStyles from './Field.module.css';
import styles from './RadioGroup.module.css';

export function RadioGroup({
  label,
  value,
  onValueChange,
  options,
  orientation = 'vertical',
  appearance = 'list',
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string; icon?: LucideIcon }>;
  orientation?: 'horizontal' | 'vertical';
  appearance?: 'list' | 'segmented';
}) {
  const labelId = useId();
  const segmented = appearance === 'segmented';

  return (
    <div className={fieldStyles.field}>
      <div className={fieldStyles.label} id={labelId}>
        {label}
      </div>
      <BaseRadioGroup
        aria-labelledby={labelId}
        className={[
          styles.group,
          segmented ? styles.segmented : styles.list,
          orientation === 'horizontal' ? styles.horizontal : styles.vertical,
        ].join(' ')}
        value={value}
        onValueChange={(next) => onValueChange(next)}
      >
        {options.map((option) => (
          <label key={option.value} className={segmented ? styles.segment : styles.option}>
            <Radio.Root value={option.value} className={segmented ? styles.radioSegmented : styles.radio}>
              <Radio.Indicator className={segmented ? styles.indicatorSegmented : styles.indicator} />
            </Radio.Root>
            {option.icon ? <Icon icon={option.icon} size='sm' /> : null}
            <span className={styles.optionLabel}>{option.label}</span>
          </label>
        ))}
      </BaseRadioGroup>
    </div>
  );
}
