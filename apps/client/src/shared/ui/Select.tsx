import { Field } from '@base-ui/react/field';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import fieldStyles from './Field.module.css';
import styles from './Select.module.css';

export function Select({
  label,
  value,
  onValueChange,
  options,
  description,
  disabled,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string; description?: string }>;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <Field.Root className={fieldStyles.field} disabled={disabled}>
      <Field.Label className={fieldStyles.label}>{label}</Field.Label>
      <BaseSelect.Root
        value={value}
        onValueChange={(next) => {
          if (typeof next === 'string') onValueChange(next);
        }}
        disabled={disabled}
        items={options}
      >
        <BaseSelect.Trigger className={`${fieldStyles.control} ${fieldStyles.singleLine} ${styles.trigger}`}>
          <BaseSelect.Value className={styles.value} />
          <BaseSelect.Icon className={styles.icon}>
            <ChevronDown aria-hidden='true' />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal>
          <BaseSelect.Positioner sideOffset={4} alignItemWithTrigger={false}>
            <BaseSelect.Popup className={styles.popup}>
              <BaseSelect.List>
                {options.map((option) => (
                  <BaseSelect.Item key={option.value} value={option.value} className={styles.item}>
                    <span className={styles.itemBody}>
                      <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                      {option.description ? <span className={styles.itemDescription}>{option.description}</span> : null}
                    </span>
                    <BaseSelect.ItemIndicator className={styles.indicator}>
                      <Check aria-hidden='true' />
                    </BaseSelect.ItemIndicator>
                  </BaseSelect.Item>
                ))}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
      {description ? <Field.Description className={fieldStyles.description}>{description}</Field.Description> : null}
    </Field.Root>
  );
}
