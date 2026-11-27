import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { isMacPlatform } from '../../shared/hooks/usePlatform.ts';
import { useShortcut } from '../../shared/hooks/useShortcut.ts';
import styles from './OptionList.module.css';

function OptionButton({
  index,
  text,
  hint,
  shortcutsEnabled,
  onSelect,
}: {
  index: number;
  text: string;
  hint: string | null;
  shortcutsEnabled: boolean;
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation();
  const hintId = useId();
  useShortcut({ key: String(index), mod: true }, () => onSelect(index), {
    enabled: shortcutsEnabled && index <= 9,
  });

  return (
    <button
      type='button'
      className={styles.option}
      aria-keyshortcuts={index <= 9 ? (isMacPlatform() ? `Meta+${index}` : `Control+${index}`) : undefined}
      aria-describedby={hint === null ? undefined : hintId}
      onClick={() => onSelect(index)}
    >
      <span className={styles.index}>{index}</span>
      <span className={styles.content}>
        <span>{text}</span>
        {hint === null ? null : (
          <span id={hintId} className={styles.hint}>
            {t('play:options.hint', { text: hint })}
          </span>
        )}
      </span>
    </button>
  );
}

export function OptionList({
  options,
  shortcutsEnabled,
  onSelect,
}: {
  options: Array<{ text: string; hint: string | null }>;
  shortcutsEnabled: boolean;
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <fieldset aria-label={t('play:options.label')} className={styles.group}>
      {options.map((option, index) => (
        <OptionButton
          key={index}
          index={index + 1}
          text={option.text}
          hint={option.hint}
          shortcutsEnabled={shortcutsEnabled}
          onSelect={onSelect}
        />
      ))}
    </fieldset>
  );
}
