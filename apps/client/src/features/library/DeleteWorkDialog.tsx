import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { WorkSummary } from '@unwritten/contracts';
import { queryKeys } from '../../shared/api/query.ts';
import { useApi } from '../../shared/api/context.tsx';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { useNotify } from '../../shared/ui/Toaster.tsx';

export function DeleteWorkDialog({
  work,
  open,
  onOpenChange,
  onError,
}: {
  work: WorkSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onError: (error: unknown) => void;
}) {
  const api = useApi();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const title = (work.title ?? work.label) || t('library:card.untitled');

  const remove = useMutation({
    mutationFn: () => api.works.delete({ workId: work.id }),
    onSuccess: () => {
      onOpenChange(false);
      notify({ title: t('library:delete.done'), tone: 'success' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.works });
    },
    onError,
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('library:delete.title', { title })}
      description={t('library:delete.description')}
      confirmLabel={t('library:delete.confirm')}
      tone='danger'
      busy={remove.isPending}
      onConfirm={() => remove.mutate()}
    />
  );
}
