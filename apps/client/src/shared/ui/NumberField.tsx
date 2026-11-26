import { Field } from '@base-ui/react/field';
import { NumberField as BaseNumberField } from '@base-ui/react/number-field';
import styles from './NumberField.module.css';

export function NumberField({
  label,
  value,
  onValueChange,
  min,
  max,
  step,
  description,
  disabled,
}: {
  label: string;
  value: number | null;
  onValueChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <Field.Root className={styles.field} disabled={disabled}>
      <Field.Label className={styles.label}>{label}</Field.Label>
      <BaseNumberField.Root
        className={styles.root}
        value={value}
        onValueChange={(next) => onValueChange(next)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
      >
        <BaseNumberField.Input className={styles.input} />
      </BaseNumberField.Root>
      {description ? <Field.Description className={styles.description}>{description}</Field.Description> : null}
    </Field.Root>
  );
}
