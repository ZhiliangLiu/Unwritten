import { AlertDialog } from '@base-ui/react/alert-dialog';
import { useTranslation } from 'react-i18next';
import { Button } from './Button.tsx';
import { ErrorNotice } from './ErrorNotice.tsx';
import styles from './ConfirmDialog.module.css';

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone,
  onConfirm,
  busy = false,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone: 'default' | 'danger';
  onConfirm: () => void;
  busy?: boolean;
  error?: unknown;
}) {
  const { t } = useTranslation();
  const cancel = cancelLabel ?? t('common:action.cancel');

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={styles.backdrop} />
        <AlertDialog.Viewport className={styles.viewport}>
          <AlertDialog.Popup className={styles.popup}>
            <AlertDialog.Title className={styles.title}>{title}</AlertDialog.Title>
            <AlertDialog.Description className={styles.description}>{description}</AlertDialog.Description>
            <ErrorNotice error={error} />
            <div className={styles.actions}>
              <Button variant='secondary' onClick={() => onOpenChange(false)}>
                {cancel}
              </Button>
              <Button variant={tone === 'danger' ? 'danger-solid' : 'primary'} busy={busy} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
