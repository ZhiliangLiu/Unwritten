import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { History, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PlaythroughListItem } from '@unwritten/contracts';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { formatRelative } from '../../shared/lib/format.ts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { buttonClassName } from '../../shared/ui/Button.tsx';
import { EmptyState } from '../../shared/ui/EmptyState.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import styles from './PlaythroughsPage.module.css';

const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' });

function PlaythroughRow({ item }: { item: PlaythroughListItem }) {
  const { t } = useTranslation();
  const scene = [item.place, item.time].filter(Boolean).join(t('play:playthroughs.separator'));
  const turn =
    item.turnCount === null
      ? null
      : item.turnCount === 0
        ? t('play:turn.opening')
        : t('play:playthroughs.turnCount', { count: item.turnCount });
  const progress = [scene, turn].filter(Boolean).join(t('play:playthroughs.separator'));
  const meta = [progress, t('play:playthroughs.updated', { time: formatRelative(item.updatedAt) })]
    .filter(Boolean)
    .join(t('play:playthroughs.separator'));
  const state =
    item.routeId === null
      ? { tone: 'warning' as const, label: t('play:playthroughs.state.opening') }
      : item.ended
        ? { tone: 'success' as const, label: t('play:playthroughs.state.ended') }
        : { tone: 'neutral' as const, label: t('play:playthroughs.state.playing') };
  const content = (
    <>
      <span className={styles.body}>
        <span className={styles.title}>
          {item.protagonistName || t('play:playthroughs.created', { date: dateFormat.format(item.createdAt) })}
        </span>
        <span className={styles.meta}>{meta}</span>
      </span>
      <Badge tone={state.tone}>{state.label}</Badge>
    </>
  );

  return (
    <li>
      {item.routeId ? (
        <Link className={styles.row} to='/play/$routeId' params={{ routeId: item.routeId }}>
          {content}
        </Link>
      ) : (
        <Link className={styles.row} to='/playthroughs/$playthroughId' params={{ playthroughId: item.id }}>
          {content}
        </Link>
      )}
    </li>
  );
}

export function PlaythroughsPage({ workId }: { workId: string }) {
  const api = useApi();
  const { t } = useTranslation();
  const work = useQuery({ queryKey: queryKeys.work(workId), queryFn: () => api.works.get({ workId }) });
  const list = useQuery({
    queryKey: queryKeys.playthroughs(workId),
    queryFn: () => api.play.listPlaythroughs({ workId }),
  });
  const title = work.data?.title?.trim() || t('play:page.untitled');
  const items = list.data ?? [];

  return (
    <Page
      title={title}
      heading='toolbar'
      toolbar={{ start: { kind: 'back', to: '/', label: t('common:nav.library') } }}
      width='prose'
    >
      <section className={styles.section}>
        <header className={styles.header}>
          <div className={styles.headingText}>
            <h2 className={styles.heading}>{t('play:playthroughs.heading')}</h2>
            <p className={styles.intro}>{t('play:playthroughs.intro')}</p>
          </div>
          <Link className={buttonClassName('primary')} to='/works/$workId/start' params={{ workId }}>
            <Icon icon={Play} size='sm' />
            {t('play:playthroughs.start')}
          </Link>
        </header>
        <ErrorNotice error={work.error ?? list.error} />
        {list.isPending ? <Skeleton variant='lines' count={4} /> : null}
        {list.data?.length === 0 && !list.error ? (
          <EmptyState
            headingLevel={2}
            icon={History}
            title={t('play:playthroughs.empty.heading')}
            description={t('play:playthroughs.empty.description')}
          />
        ) : null}
        {items.length > 0 ? (
          <ul className={styles.list}>
            {items.map((item) => (
              <PlaythroughRow key={item.id} item={item} />
            ))}
          </ul>
        ) : null}
      </section>
    </Page>
  );
}
