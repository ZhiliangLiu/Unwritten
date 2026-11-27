import { useTranslation } from 'react-i18next';
import type { TurnRequestView } from '@unwritten/contracts';
import { Button } from '../../shared/ui/Button.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { PlayerAction } from './PlayerAction.tsx';
import styles from './FailedTurn.module.css';

export function FailedTurn({
  request,
  language,
  busy,
  onRetry,
  onRewrite,
}: {
  request: TurnRequestView;
  language: string;
  busy: boolean;
  onRetry: () => void;
  onRewrite: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className={styles.failed}>
      <PlayerAction text={request.action.text} language={language} />
      <ErrorNotice code={request.error ?? 'unknown'} diagnosticId={request.id} />
      <div className={styles.actions}>
        <Button variant='primary' busy={busy} onClick={onRetry}>
          {t('play:pending.retry')}
        </Button>
        <Button variant='secondary' onClick={onRewrite}>
          {t('play:pending.rewrite')}
        </Button>
      </div>
    </div>
  );
}
