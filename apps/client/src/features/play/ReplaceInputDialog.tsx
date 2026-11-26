import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';

export function ReplaceInputDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('play:replace.title')}
      description={t('play:replace.description')}
      confirmLabel={t('play:replace.confirm')}
      cancelLabel={t('play:replace.cancel')}
      tone='default'
      onConfirm={onConfirm}
    />
  );
}
