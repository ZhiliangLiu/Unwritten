import { useTranslation } from 'react-i18next';
import type { TurnRequestView } from '@unwritten/contracts';
import { GeneratingMarker } from '../../shared/ui/GeneratingMarker.tsx';
import { PlayerAction } from './PlayerAction.tsx';
import styles from './PendingTurn.module.css';

export function PendingTurn({ action, language }: { action: TurnRequestView['action']; language: string }) {
  const { t } = useTranslation();

  return (
    <article aria-busy='true' className={styles.pending}>
      <PlayerAction text={action.text} language={language} />
      <GeneratingMarker label={t('play:pending.running')} />
    </article>
  );
}
