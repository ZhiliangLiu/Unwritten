import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { LlmLogCursor } from '@unwritten/contracts';
import { FileClock, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { Button } from '../../shared/ui/Button.tsx';
import { EmptyState } from '../../shared/ui/EmptyState.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { IconButton } from '../../shared/ui/IconButton.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { LlmLogDetailSheet } from './LlmLogDetailSheet.tsx';
import { dateTimeFormat, durationFormat } from './format.ts';
import styles from './LlmLogsPage.module.css';

const PAGE_SIZE = 50;
const STATUS_TONE = { ok: 'success', error: 'danger', aborted: 'warning' } as const;

export function LlmLogsPage() {
  const api = useApi();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: queryKeys.llmLogs,
    queryFn: ({ pageParam }) => api.llm.logs.list({ limit: PAGE_SIZE, before: pageParam }),
    initialPageParam: undefined as LlmLogCursor | undefined,
    getNextPageParam: (lastPage) => {
      const last = lastPage.items.at(-1);
      return lastPage.items.length < PAGE_SIZE || !last
        ? undefined
        : { createdAt: last.createdAt, callId: last.callId };
    },
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.llmLogs });
  };

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Page
      title={t('logs:page.heading')}
      heading='content'
      subtitle={t('logs:page.description')}
      toolbar={{
        start: { kind: 'back', to: '/settings', label: t('common:nav.settings') },
        tools: <IconButton label={t('logs:list.refresh')} icon={RefreshCw} onClick={refresh} />,
      }}
      width='page'
    >
      {list.isPending ? <Skeleton variant='lines' count={8} /> : null}
      {list.error ? <ErrorNotice error={list.error} /> : null}
      {list.data && items.length === 0 ? (
        <EmptyState
          headingLevel={2}
          icon={FileClock}
          title={t('logs:empty.title')}
          description={t('logs:empty.description')}
        />
      ) : null}
      {items.length > 0 ? (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.callId}>
              <button
                type='button'
                className={styles.row}
                aria-haspopup='dialog'
                onClick={() => setSelected(item.callId)}
              >
                <time className={styles.time} dateTime={new Date(item.createdAt).toISOString()}>
                  {dateTimeFormat.format(item.createdAt)}
                </time>
                <span>{item.purpose}</span>
                <span className={styles.model}>
                  {item.provider} / {item.model}
                </span>
                <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
                <span className={styles.duration}>
                  {item.durationMs === null ? t('logs:field.none') : durationFormat.format(item.durationMs)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {list.hasNextPage ? (
        <Button variant='secondary' busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          {t('logs:list.more')}
        </Button>
      ) : null}
      <LlmLogDetailSheet
        callId={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </Page>
  );
}
