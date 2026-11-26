import { Field } from '@base-ui/react/field';
import { useCallback, useId } from 'react';
import type { KeyboardEvent, Ref } from 'react';
import styles from './TextArea.module.css';

export function TextArea({
  label,
  value,
  onValueChange,
  description,
  error,
  placeholder,
  mono = false,
  disabled,
  minRows = 3,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  ref,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  description?: string;
  error?: string;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  minRows?: number;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy = [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ');

  const setRef = useCallback(
    (element: HTMLTextAreaElement | null) => {
      if (element) element.style.setProperty('--uw-textarea-rows', String(minRows));
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
    },
    [minRows, ref],
  );

  return (
    <Field.Root className={styles.field} disabled={disabled} invalid={Boolean(error)}>
      <Field.Label className={styles.label} htmlFor={id}>
        {label}
      </Field.Label>
      <textarea
        ref={setRef}
        id={id}
        className={`${styles.control} ${mono ? styles.mono : ''}`}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={onKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        placeholder={placeholder}
        disabled={disabled}
        rows={minRows}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
      />
      {description ? (
        <Field.Description className={styles.description} id={descriptionId}>
          {description}
        </Field.Description>
      ) : null}
      {error ? (
        <Field.Error className={styles.error} id={errorId} match>
          {error}
        </Field.Error>
      ) : null}
    </Field.Root>
  );
}
