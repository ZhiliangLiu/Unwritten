import type { SetAutoIllustrationInput } from '@unwritten/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import styles from './AutoIllustrationPanel.module.css';

export function AutoIllustrationPanel({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const view = useQuery({ queryKey: queryKeys.autoIllustration, queryFn: () => api.image.autoIllustration.get() });
  const config = useQuery({ queryKey: queryKeys.imageConfig, queryFn: () => api.image.services.list() });
  const llm = useQuery({ queryKey: queryKeys.llm, queryFn: () => api.llm.providers.list() });
  const [confirming, setConfirming] = useState(false);

  const set = useMutation({
    mutationFn: (input: SetAutoIllustrationInput) => api.image.autoIllustration.set(input),
    onSuccess: (next) => queryClient.setQueryData(queryKeys.autoIllustration, next),
  });

  const current = view.data?.current ?? null;
  const service = current ? config.data?.services.find((candidate) => candidate.id === current.serviceId) : undefined;
  const endpoint = current
    ? llm.data?.endpoints.find((candidate) => candidate.id === current.background.endpointId)
    : undefined;
  const serviceName = service?.name ?? current?.serviceId ?? '';
  const endpointName = endpoint?.name ?? current?.background.endpointId ?? '';
  const confirmed = Boolean(view.data && !view.data.enabled && view.data.confirmed);

  return (
    <section className={styles.panel}>
      <h3 className={styles.heading}>{t('settings:auto.heading')}</h3>
      {view.isPending ? <Skeleton variant='lines' count={2} /> : null}
      {view.data ? (
        <>
          <label className={styles.checkbox}>
            <input
              type='checkbox'
              checked={view.data.enabled}
              onChange={(event) => {
                if (event.target.checked) setConfirming(true);
                else set.mutate({ enabled: false, confirm: null });
              }}
              disabled={disabled || set.isPending || current === null}
            />
            <span>{t('settings:auto.heading')}</span>
          </label>
          {current === null ? <p className={styles.notice}>{t('settings:auto.unavailable')}</p> : null}
          {confirmed ? <p className={styles.notice}>{t('settings:auto.reconfirm')}</p> : null}
        </>
      ) : null}
      <ErrorNotice error={view.error ?? set.error} />
      <ConfirmDialog
        open={confirming && current !== null}
        onOpenChange={setConfirming}
        title={t('settings:auto.confirmTitle')}
        description={`${t('settings:auto.backgroundReceives', {
          endpoint: endpointName,
          model: current?.background.modelId ?? '',
        })} ${t('settings:auto.serviceReceives', { service: serviceName })}`}
        confirmLabel={t('settings:auto.confirm')}
        tone='default'
        onConfirm={() => {
          if (!current) return;
          setConfirming(false);
          set.mutate({ enabled: true, confirm: current });
        }}
        busy={set.isPending}
      />
    </section>
  );
}
