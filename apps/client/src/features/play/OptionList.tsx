import { useTranslation } from 'react-i18next';
import { isMacPlatform } from '../../shared/hooks/usePlatform.ts';
import { useShortcut } from '../../shared/hooks/useShortcut.ts';
import styles from './OptionList.module.css';

function OptionButton({
  index,
  text,
  shortcutsEnabled,
  onSelect,
}: {
  index: number;
  text: string;
  shortcutsEnabled: boolean;
  onSelect: (index: number) => void;
}) {
  useShortcut({ key: String(index), mod: true }, () => onSelect(index), {
    enabled: shortcutsEnabled && index <= 9,
  });

  return (
    <button
      type='button'
      className={styles.option}
      aria-keyshortcuts={index <= 9 ? (isMacPlatform() ? `Meta+${index}` : `Control+${index}`) : undefined}
      onClick={() => onSelect(index)}
    >
      <span className={styles.index}>{index}</span>
      <span>{text}</span>
    </button>
  );
}

export function OptionList({
  options,
  shortcutsEnabled,
  onSelect,
}: {
  options: Array<{ text: string }>;
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
          shortcutsEnabled={shortcutsEnabled}
          onSelect={onSelect}
        />
      ))}
    </fieldset>
  );
}
