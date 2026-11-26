import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorCode, errorDetail } from '../api/errors.ts';
import { Icon } from './Icon.tsx';
import styles from './ErrorNotice.module.css';

type ErrorNoticeProps = { action?: ReactNode } & ({ error: unknown; code?: never } | { code: string; error?: never });

export function ErrorNotice(props: ErrorNoticeProps) {
  const { t } = useTranslation();
  if (props.code === undefined && !props.error) return null;
  const code = props.code ?? errorCode(props.error);
  const detail = props.error ? errorDetail(props.error) : null;

  return (
    <div className={styles.notice} role='alert'>
      <div className={styles.heading}>
        <span className={styles.icon}>
          <Icon icon={CircleAlert} />
        </span>
        <p className={styles.message}>{t(`errors:${code}`, { code })}</p>
      </div>
      {detail ? (
        <div className={styles.detail}>
          <p className={styles.detailLabel}>{t('common:error.details')}</p>
          <p className={styles.detailText}>{detail}</p>
        </div>
      ) : null}
      {props.action ? <div className={styles.action}>{props.action}</div> : null}
    </div>
  );
}
