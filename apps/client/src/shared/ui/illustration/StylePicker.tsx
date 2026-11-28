import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ILLUSTRATION_STYLE_TEXT_MAX_LENGTH, STYLE_PRESETS } from '@unwritten/contracts';
import type { IllustrationStyle } from '@unwritten/contracts';
import { STYLE_PRESET_LABEL_KEYS } from '../../lib/image-labels.ts';
import { Button } from '../Button.tsx';
import { RadioGroup } from '../RadioGroup.tsx';
import { TextField } from '../TextField.tsx';
import styles from './StylePicker.module.css';

const CUSTOM_VALUE = 'custom';

function sameStyle(left: IllustrationStyle, right: IllustrationStyle): boolean {
  if (left.kind === 'preset' && right.kind === 'preset') return left.preset === right.preset;
  if (left.kind === 'custom' && right.kind === 'custom') return left.text === right.text;
  return false;
}

export function StylePicker({
  value,
  onChange,
  authorDefault,
}: {
  value: IllustrationStyle;
  onChange: (style: IllustrationStyle) => void;
  authorDefault?: IllustrationStyle;
}) {
  const { t } = useTranslation();
  const [customMode, setCustomMode] = useState(value.kind === 'custom');
  const customText = value.kind === 'custom' ? value.text : '';
  const showCustom = customMode || value.kind === 'custom';
  const selected = showCustom ? CUSTOM_VALUE : value.kind === 'preset' ? value.preset : CUSTOM_VALUE;

  const select = (next: string) => {
    if (next === CUSTOM_VALUE) {
      setCustomMode(true);
      onChange({ kind: 'custom', text: customText });
      return;
    }
    const preset = STYLE_PRESETS.find((candidate) => candidate === next);
    if (!preset) return;
    setCustomMode(false);
    onChange({ kind: 'preset', preset });
  };

  const changeCustomText = (text: string) => {
    onChange({ kind: 'custom', text: text.slice(0, ILLUSTRATION_STYLE_TEXT_MAX_LENGTH) });
  };

  const resetToAuthor = () => {
    if (!authorDefault) return;
    setCustomMode(false);
    onChange(authorDefault);
  };

  return (
    <div className={styles.picker}>
      <RadioGroup
        label={t('authoring:style.label')}
        appearance='segmented'
        value={selected}
        onValueChange={select}
        options={[
          ...STYLE_PRESETS.map((preset) => ({ value: preset, label: t(STYLE_PRESET_LABEL_KEYS[preset]) })),
          { value: CUSTOM_VALUE, label: t('authoring:style.custom') },
        ]}
      />
      {showCustom ? (
        <TextField label={t('authoring:style.customLabel')} value={customText} onValueChange={changeCustomText} />
      ) : null}
      {authorDefault && !sameStyle(value, authorDefault) ? (
        <div className={styles.reset}>
          <Button variant='text' onClick={resetToAuthor}>
            {t('authoring:style.resetToAuthor')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
