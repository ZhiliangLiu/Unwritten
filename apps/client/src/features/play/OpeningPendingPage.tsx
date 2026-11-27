import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { Button, buttonClassName } from '../../shared/ui/Button.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { GeneratingMarker } from '../../shared/ui/GeneratingMarker.tsx';
import { LiveRegion } from '../../shared/ui/LiveRegion.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import styles from './OpeningPendingPage.module.css';

export function OpeningPendingPage({ playthroughId }: { playthroughId: string }) {
  const api = useApi();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const playthrough = useQuery({
    queryKey: queryKeys.playthrough(playthroughId),
    queryFn: () => api.play.getPlaythrough({ playthroughId }),
  });
  const retry = useMutation({
    mutationFn: (requestId: string) => api.play.retryOpening({ requestId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.playthrough(playthroughId) });
    },
  });

  const routeId = playthrough.data?.routeId ?? null;
  const opening = playthrough.data?.opening ?? null;

  useEffect(() => {
    if (!routeId) return;
    void navigate({ to: '/play/$routeId', params: { routeId }, replace: true });
  }, [navigate, routeId]);

  return (
    <Page
      title={playthrough.data?.workTitle?.trim() || t('play:page.untitled')}
      heading='toolbar'
      toolbar={{ start: { kind: 'back', to: '/', label: t('common:nav.library') } }}
      width='prose'
    >
      <section className={styles.section}>
        <ErrorNotice error={playthrough.error} />
        {!playthrough.data ? <Skeleton variant='prose' count={2} /> : null}
        {playthrough.data && !routeId ? (
          opening?.status === 'failed' ? (
            <>
              <h2 className={styles.heading}>{t('play:openingRequest.failed')}</h2>
              <ErrorNotice code={opening.error ?? 'unknown'} diagnosticId={opening.id} />
              <p className={styles.text}>{t('play:openingRequest.keptCast')}</p>
              <div className={styles.actions}>
                <Button
                  variant='primary'
                  icon={RotateCcw}
                  busy={retry.isPending}
                  onClick={() => retry.mutate(opening.id)}
                >
                  {t('play:openingRequest.retry')}
                </Button>
                <Link className={buttonClassName('text')} to='/'>
                  {t('play:openingRequest.back')}
                </Link>
              </div>
              <ErrorNotice error={retry.error} />
            </>
          ) : (
            <>
              <h2 className={styles.heading}>{t('play:openingRequest.pending')}</h2>
              <GeneratingMarker label={t('play:start.opening')} />
              <p className={styles.text}>{t('play:openingRequest.pendingHelp')}</p>
              <LiveRegion message={t('play:openingRequest.pending')} />
            </>
          )
        ) : null}
      </section>
    </Page>
  );
}
