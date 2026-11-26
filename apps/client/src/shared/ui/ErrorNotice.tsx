import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorCode, errorDetail, errorDiagnosticId } from '../api/errors.ts';
import { Icon } from './Icon.tsx';
import styles from './ErrorNotice.module.css';

type ErrorNoticeProps = { action?: ReactNode; diagnosticId?: string; message?: string } & (
  { error: unknown; code?: never; detail?: never } | { code: string; error?: never; detail?: string | null }
);

export function ErrorNotice(props: ErrorNoticeProps) {
  const { t } = useTranslation();
  if (props.code === undefined && props.error == null) return null;
  const code = props.code ?? errorCode(props.error);
  const detail = props.detail ?? errorDetail(props.error);
  const diagnosticId = props.diagnosticId ?? errorDiagnosticId(props.error);

  return (
    <div className={styles.notice} role='alert'>
      <div className={styles.heading}>
        <span className={styles.icon}>
          <Icon icon={CircleAlert} />
        </span>
        <p className={styles.message}>{props.message ?? t([`errors:${code}`, 'errors:unknown'], { code })}</p>
      </div>
      {detail ? (
        <div className={styles.detail}>
          <p className={styles.detailLabel}>{t('common:error.details')}</p>
          <p className={styles.detailText}>{detail}</p>
        </div>
      ) : null}
      {diagnosticId ? (
        <div className={styles.detail}>
          <p className={styles.detailLabel}>{t('common:error.diagnosticId')}</p>
          <p className={styles.detailText}>
            <bdi>{diagnosticId}</bdi>
          </p>
        </div>
      ) : null}
      {props.action ? <div className={styles.action}>{props.action}</div> : null}
    </div>
  );
}
