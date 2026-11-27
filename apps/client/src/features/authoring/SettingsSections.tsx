import { useTranslation } from 'react-i18next';
import type { RefObject } from 'react';
import { CAST_MODES, HINT_MODES, OPENING_MODES, SETTING_SECTION_IDS } from '@unwritten/contracts';
import type { SettingSectionId, WorkSettings } from '@unwritten/contracts';
import { OverflowMenu } from '../../shared/ui/OverflowMenu.tsx';
import { RadioGroup } from '../../shared/ui/RadioGroup.tsx';
import { TextArea } from '../../shared/ui/TextArea.tsx';
import { ProtagonistFieldsEditor } from './ProtagonistFieldsEditor.tsx';
import {
  CAST_MODE_LABEL_KEYS,
  HINT_MODE_LABEL_KEYS,
  OPENING_MODE_LABEL_KEYS,
  OPENING_PLACEHOLDER_KEYS,
  OPENING_TEXT_LABEL_KEYS,
  SETTING_SECTION_HEADING_KEYS,
  SETTING_SECTION_HELP_KEYS,
  SETTING_SECTION_PLACEHOLDER_KEYS,
} from './settings-labels.ts';
import styles from './SettingsSections.module.css';

function withText(settings: WorkSettings, id: SettingSectionId, text: string): WorkSettings {
  switch (id) {
    case 'world':
      return { ...settings, world: { text } };
    case 'protagonist':
      return { ...settings, protagonist: { ...settings.protagonist, text } };
    case 'cast':
      return { ...settings, cast: { ...settings.cast, text } };
    case 'secrets':
      return { ...settings, secrets: { text } };
    case 'opening':
      return { ...settings, opening: { ...settings.opening, text } };
    case 'actions':
      return { ...settings, actions: { ...settings.actions, text } };
    case 'scenes':
      return { ...settings, scenes: { text } };
    case 'status':
      return { ...settings, status: { text } };
  }
}

export function SettingsSections({
  settings,
  onChange,
  openingTextRef,
}: {
  settings: WorkSettings;
  onChange: (settings: WorkSettings) => void;
  openingTextRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useTranslation();

  const insertField = (name: string) => {
    const textarea = openingTextRef?.current;
    if (!textarea) return;
    const token = `{{protagonist.${name}}}`;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${settings.opening.text.slice(0, start)}${token}${settings.opening.text.slice(end)}`;
    onChange(withText(settings, 'opening', next));
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className={styles.sections}>
      {SETTING_SECTION_IDS.map((id) => (
        <section key={id} className={styles.section}>
          <h3 className={styles.heading}>{t(SETTING_SECTION_HEADING_KEYS[id])}</h3>
          <p className={styles.help}>{t(SETTING_SECTION_HELP_KEYS[id])}</p>
          {id === 'cast' ? (
            <RadioGroup
              label={t('authoring:settings.cast.modeLabel')}
              appearance='segmented'
              value={settings.cast.mode}
              onValueChange={(mode) =>
                onChange({ ...settings, cast: { ...settings.cast, mode: mode as WorkSettings['cast']['mode'] } })
              }
              options={CAST_MODES.map((mode) => ({ value: mode, label: t(CAST_MODE_LABEL_KEYS[mode]) }))}
            />
          ) : null}
          {id === 'opening' ? (
            <RadioGroup
              label={t('authoring:settings.opening.modeLabel')}
              value={settings.opening.mode}
              onValueChange={(mode) =>
                onChange({
                  ...settings,
                  opening: { ...settings.opening, mode: mode as WorkSettings['opening']['mode'] },
                })
              }
              options={OPENING_MODES.map((mode) => ({ value: mode, label: t(OPENING_MODE_LABEL_KEYS[mode]) }))}
            />
          ) : null}
          {id === 'actions' ? (
            <RadioGroup
              label={t('authoring:settings.actions.hintsLabel')}
              value={settings.actions.hints}
              onValueChange={(hints) =>
                onChange({
                  ...settings,
                  actions: { ...settings.actions, hints: hints as WorkSettings['actions']['hints'] },
                })
              }
              options={HINT_MODES.map((mode) => ({ value: mode, label: t(HINT_MODE_LABEL_KEYS[mode]) }))}
            />
          ) : null}
          {id === 'opening' ? (
            <div className={styles.openingText}>
              <TextArea
                ref={openingTextRef}
                label={t(OPENING_TEXT_LABEL_KEYS[settings.opening.mode])}
                placeholder={t(OPENING_PLACEHOLDER_KEYS[settings.opening.mode])}
                value={settings.opening.text}
                onValueChange={(text) => onChange(withText(settings, 'opening', text))}
                minRows={2}
              />
              {settings.opening.mode === 'author_text' && settings.protagonist.fields.length > 0 ? (
                <OverflowMenu
                  label={t('authoring:settings.opening.insert')}
                  items={settings.protagonist.fields.map((field) => ({
                    label: field.name,
                    onSelect: () => insertField(field.name),
                  }))}
                />
              ) : null}
            </div>
          ) : (
            <div className={styles.plainText}>
              <TextArea
                label={t(SETTING_SECTION_HEADING_KEYS[id])}
                placeholder={t(SETTING_SECTION_PLACEHOLDER_KEYS[id])}
                value={settings[id].text}
                onValueChange={(text) => onChange(withText(settings, id, text))}
                minRows={2}
              />
            </div>
          )}
          {id === 'protagonist' ? (
            <ProtagonistFieldsEditor
              fields={settings.protagonist.fields}
              onChange={(fields) => onChange({ ...settings, protagonist: { ...settings.protagonist, fields } })}
            />
          ) : null}
        </section>
      ))}
    </div>
  );
}
