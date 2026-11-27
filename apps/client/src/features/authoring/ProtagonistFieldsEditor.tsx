import { Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PROTAGONIST_FIELDS_MAX, ProtagonistFieldSchema } from '@unwritten/contracts';
import type { ProtagonistField } from '@unwritten/contracts';
import { Button } from '../../shared/ui/Button.tsx';
import { IconButton } from '../../shared/ui/IconButton.tsx';
import { RadioGroup } from '../../shared/ui/RadioGroup.tsx';
import { TextField } from '../../shared/ui/TextField.tsx';
import styles from './ProtagonistFieldsEditor.module.css';

export function ProtagonistFieldsEditor({
  fields,
  onChange,
}: {
  fields: ProtagonistField[];
  onChange: (fields: ProtagonistField[]) => void;
}) {
  const { t } = useTranslation();
  const [local, setLocal] = useState(fields);
  const limitId = useId();

  const issuesFor = (values: ProtagonistField[]): Array<string | null> =>
    values.map((field, index) => {
      if (!ProtagonistFieldSchema.shape.name.safeParse(field.name).success) {
        return t('authoring:settings.protagonist.nameInvalid');
      }
      if (values.some((other, otherIndex) => otherIndex !== index && other.name === field.name)) {
        return t('authoring:settings.protagonist.nameDuplicate');
      }
      return null;
    });
  const nameErrors = issuesFor(local);
  const atLimit = local.length >= PROTAGONIST_FIELDS_MAX;
  const nameFieldIndex = local.findIndex((field) => field.isName);

  const update = (next: ProtagonistField[]) => {
    setLocal(next);
    if (
      issuesFor(next).every((error) => error === null) &&
      next.every((field) => field.defaultValue.trim().length > 0)
    ) {
      onChange(next);
    }
  };

  const setField = (index: number, patch: Partial<ProtagonistField>) => {
    update(local.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)));
  };

  return (
    <div className={styles.editor}>
      <h4 className={styles.heading}>{t('authoring:settings.protagonist.fieldsHeading')}</h4>
      <p className={styles.help}>{t('authoring:settings.protagonist.fieldsHelp')}</p>
      <div className={styles.rows}>
        {local.map((field, index) => (
          <div key={`${index}`} className={styles.row}>
            <TextField
              label={t('authoring:settings.protagonist.fieldName')}
              value={field.name}
              onValueChange={(name) => setField(index, { name })}
              error={nameErrors[index] ?? undefined}
            />
            <TextField
              label={t('authoring:settings.protagonist.defaultValue')}
              value={field.defaultValue}
              onValueChange={(defaultValue) => setField(index, { defaultValue })}
            />
            <IconButton
              label={t('authoring:settings.protagonist.remove', { name: field.name })}
              icon={X}
              onClick={() => update(local.filter((_, fieldIndex) => fieldIndex !== index))}
            />
          </div>
        ))}
      </div>
      <div className={styles.add}>
        <Button
          variant='text'
          icon={Plus}
          disabled={atLimit}
          aria-describedby={atLimit ? limitId : undefined}
          onClick={() => update([...local, { name: '', defaultValue: '', isName: false }])}
        >
          {t('authoring:settings.protagonist.add')}
        </Button>
        {atLimit ? (
          <p className={styles.limit} id={limitId}>
            {t('authoring:settings.protagonist.addLimit', { count: PROTAGONIST_FIELDS_MAX })}
          </p>
        ) : null}
      </div>
      <RadioGroup
        label={t('authoring:settings.protagonist.nameField')}
        value={nameFieldIndex < 0 ? 'none' : `${nameFieldIndex}`}
        onValueChange={(value) =>
          update(
            local.map((field, index) => ({
              ...field,
              isName: value !== 'none' && index === Number(value),
            })),
          )
        }
        options={[
          { value: 'none', label: t('authoring:settings.protagonist.nameFieldNone') },
          ...local.flatMap((field, index) => (field.name ? [{ value: `${index}`, label: field.name }] : [])),
        ]}
      />
    </div>
  );
}
