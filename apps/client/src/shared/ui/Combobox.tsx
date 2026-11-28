import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { Field } from '@base-ui/react/field';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import fieldStyles from './Field.module.css';
import selectStyles from './Select.module.css';
import styles from './Combobox.module.css';

export const COMBOBOX_RESULT_LIMIT = 100;

interface ComboboxOption {
  value: string;
  label: string;
}

export function Combobox({
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
  options: ComboboxOption[];
  description?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Field.Root className={fieldStyles.field} disabled={disabled}>
      <Field.Label className={fieldStyles.label}>{label}</Field.Label>
      <BaseCombobox.Root
        items={options}
        value={options.find((option) => option.value === value) ?? null}
        onValueChange={(next) => {
          if (next) onValueChange(next.value);
        }}
        isItemEqualToValue={(item, current) => item.value === current.value}
        limit={COMBOBOX_RESULT_LIMIT}
        disabled={disabled}
      >
        <BaseCombobox.InputGroup className={styles.group}>
          <BaseCombobox.Input className={`${fieldStyles.control} ${fieldStyles.singleLine} ${styles.input}`} />
          <ChevronDown aria-hidden='true' className={styles.icon} />
        </BaseCombobox.InputGroup>
        <BaseCombobox.Portal>
          <BaseCombobox.Positioner sideOffset={4}>
            <BaseCombobox.Popup className={selectStyles.popup}>
              <BaseCombobox.Empty className={styles.empty}>{t('common:combobox.empty')}</BaseCombobox.Empty>
              <BaseCombobox.List>
                {(option: ComboboxOption) => (
                  <BaseCombobox.Item key={option.value} value={option} className={selectStyles.item}>
                    {option.label}
                    <BaseCombobox.ItemIndicator className={selectStyles.indicator}>
                      <Check aria-hidden='true' />
                    </BaseCombobox.ItemIndicator>
                  </BaseCombobox.Item>
                )}
              </BaseCombobox.List>
            </BaseCombobox.Popup>
          </BaseCombobox.Positioner>
        </BaseCombobox.Portal>
      </BaseCombobox.Root>
      {description ? <Field.Description className={fieldStyles.description}>{description}</Field.Description> : null}
    </Field.Root>
  );
}
