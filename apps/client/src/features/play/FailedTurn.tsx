import { useTranslation } from 'react-i18next';
import type { TurnRequestView } from '@unwritten/contracts';
import { Button } from '../../shared/ui/Button.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
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
      <p lang={language} className={styles.action}>
        <span className={styles.hidden}>{t('play:action.prefix')}</span>
        {request.action.text}
      </p>
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
