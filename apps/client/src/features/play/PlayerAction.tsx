import { useTranslation } from 'react-i18next';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden.tsx';
import styles from './PlayerAction.module.css';

export function PlayerAction({ text, language }: { text: string; language: string }) {
  const { t } = useTranslation();

  return (
    <p lang={language} className={styles.action}>
      <VisuallyHidden>{t('play:action.prefix')}</VisuallyHidden>
      {text}
    </p>
  );
}
