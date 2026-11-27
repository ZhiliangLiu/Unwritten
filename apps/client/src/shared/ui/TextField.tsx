import { Field } from '@base-ui/react/field';
import styles from './Field.module.css';

export function TextField({
  label,
  value,
  onValueChange,
  description,
  error,
  placeholder,
  type,
  mono = false,
  disabled,
  autoComplete,
  className,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  description?: string;
  error?: string;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  className?: string;
}) {
  return (
    <Field.Root
      className={className ? `${styles.field} ${className}` : styles.field}
      disabled={disabled}
      invalid={Boolean(error)}
    >
      <Field.Label className={styles.label}>{label}</Field.Label>
      <Field.Control
        className={`${styles.control} ${styles.singleLine} ${mono ? styles.mono : ''}`}
        value={value}
        onValueChange={onValueChange}
        placeholder={placeholder}
        type={type}
        autoComplete={autoComplete}
      />
      {description ? <Field.Description className={styles.description}>{description}</Field.Description> : null}
      {error ? (
        <Field.Error className={styles.error} match>
          {error}
        </Field.Error>
      ) : null}
    </Field.Root>
  );
}
