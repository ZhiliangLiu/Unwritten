import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useEnterToSubmit } from '../../shared/hooks/useEnterToSubmit.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { TextArea } from '../../shared/ui/TextArea.tsx';
import styles from './ActionComposer.module.css';

export function ActionComposer({
  value,
  onValueChange,
  onSubmit,
  disabled,
  inputRef,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useTranslation();
  const enter = useEnterToSubmit(onSubmit);

  return (
    <div className={styles.composer}>
      <TextArea
        ref={inputRef}
        label={t('play:input.label')}
        value={value}
        onValueChange={onValueChange}
        description={t('play:input.help')}
        placeholder={t('play:input.placeholder')}
        disabled={disabled}
        onKeyDown={enter.onKeyDown}
        onCompositionStart={enter.onCompositionStart}
        onCompositionEnd={enter.onCompositionEnd}
      />
      <div className={styles.footer}>
        <Button variant='primary' disabled={disabled || !value.trim()} onClick={onSubmit}>
          {t('play:input.submit')}
        </Button>
      </div>
    </div>
  );
}
