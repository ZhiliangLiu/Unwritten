import { useQuery } from '@tanstack/react-query';
import type { LlmLogContent, LlmLogDetail } from '@unwritten/contracts';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { errorCode } from '../../shared/api/errors.ts';
import { queryKeys } from '../../shared/api/query.ts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { EmptyState } from '../../shared/ui/EmptyState.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { SideSheet } from '../../shared/ui/SideSheet.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { dateTimeFormat, durationFormat, numberFormat } from './format.ts';
import styles from './LlmLogDetailSheet.module.css';

const STATUS_TONE = { ok: 'success', error: 'danger', aborted: 'warning' } as const;

function ContentPart({ part }: { part: LlmLogContent }) {
  const { t } = useTranslation();
  if (part.type === 'text') return <pre className={styles.body}>{part.text}</pre>;
  if (part.type === 'thinking') {
    return (
      <details className={styles.exchange}>
        <summary className={styles.summary}>{t('logs:detail.thinking')}</summary>
        <pre className={styles.body}>{part.thinking}</pre>
      </details>
    );
  }
  return (
    <div className={styles.toolCall}>
      <h3 className={styles.subheading}>{t('logs:detail.toolCall')}</h3>
      <p className={styles.toolName}>{part.name}</p>
      <pre className={styles.body}>{JSON.stringify(part.arguments, null, 2)}</pre>
      {part.argumentsError ? (
        <>
          <h3 className={styles.subheading}>{t('logs:detail.argumentsError')}</h3>
          <pre className={styles.body}>{part.argumentsError}</pre>
        </>
      ) : null}
    </div>
  );
}

function Overview({ data }: { data: LlmLogDetail }) {
  const { t } = useTranslation();
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>{t('logs:detail.overview')}</h2>
      <dl className={styles.meta}>
        <dt>{t('logs:field.createdAt')}</dt>
        <dd>{dateTimeFormat.format(data.createdAt)}</dd>
        <dt>{t('logs:field.purpose')}</dt>
        <dd>{data.purpose}</dd>
        <dt>{t('logs:field.work')}</dt>
        <dd>{data.workId ?? t('logs:field.none')}</dd>
        <dt>{t('logs:field.model')}</dt>
        <dd>
          {data.provider} / {data.model}
        </dd>
        <dt>{t('logs:field.status')}</dt>
        <dd>
          <Badge tone={STATUS_TONE[data.status]}>{data.status}</Badge>
        </dd>
        <dt>{t('logs:field.duration')}</dt>
        <dd>{data.durationMs === null ? t('logs:field.none') : durationFormat.format(data.durationMs)}</dd>
        <dt>{t('logs:field.tokens')}</dt>
        <dd>
          {data.inputTokens === null ? t('logs:field.none') : numberFormat.format(data.inputTokens)} /{' '}
          {data.outputTokens === null ? t('logs:field.none') : numberFormat.format(data.outputTokens)}
        </dd>
        <dt>{t('logs:field.ref')}</dt>
        <dd>{data.refKind ? `${data.refKind} ${data.refId ?? ''}`.trim() : t('logs:field.none')}</dd>
        {data.error ? (
          <>
            <dt>{t('logs:field.error')}</dt>
            <dd>{data.error}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

function Detail({ data }: { data: LlmLogDetail }) {
  const { t } = useTranslation();
  return (
    <>
      <Overview data={data} />
      <section className={styles.section}>
        <h2 className={styles.heading}>{t('logs:detail.input')}</h2>
        <h3 className={styles.subheading}>{t('logs:detail.system')}</h3>
        <pre className={styles.body}>{data.system}</pre>
        <h3 className={styles.subheading}>{t('logs:detail.prompt')}</h3>
        <pre className={styles.body}>{data.prompt}</pre>
      </section>
      <section className={styles.section}>
        <h2 className={styles.heading}>{t('logs:detail.reply')}</h2>
        {data.response && data.response.length > 0 ? (
          data.response.map((part, index) => <ContentPart key={index} part={part} />)
        ) : (
          <p className={styles.empty}>{t('logs:detail.noReply')}</p>
        )}
      </section>
      <section className={styles.section}>
        <h2 className={styles.heading}>{t('logs:detail.http')}</h2>
        {data.http.length > 0 ? (
          data.http.map((exchange) => (
            <details className={styles.exchange} key={exchange.seq}>
              <summary className={styles.summary}>
                {t('logs:detail.exchange', {
                  seq: exchange.seq,
                  method: exchange.method,
                  status: exchange.status === null ? t('logs:detail.noStatus') : exchange.status,
                  url: exchange.url,
                })}
              </summary>
              {exchange.error ? <p className={styles.exchangeError}>{exchange.error}</p> : null}
              <h3 className={styles.subheading}>{t('logs:detail.request')}</h3>
              <pre className={styles.body}>{exchange.requestBody ?? ''}</pre>
              <h3 className={styles.subheading}>{t('logs:detail.response')}</h3>
              <pre className={styles.body}>{exchange.responseBody ?? ''}</pre>
            </details>
          ))
        ) : (
          <p className={styles.empty}>{t('logs:detail.noHttp')}</p>
        )}
      </section>
    </>
  );
}

export function LlmLogDetailSheet({
  callId,
  onOpenChange,
}: {
  callId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const api = useApi();
  const { t } = useTranslation();
  const detail = useQuery({
    queryKey: queryKeys.llmLog(callId ?? ''),
    queryFn: () => {
      if (callId === null) throw new Error('callId is required');
      return api.llm.logs.get({ callId });
    },
    enabled: callId !== null,
  });

  return (
    <SideSheet open={callId !== null} onOpenChange={onOpenChange} title={t('logs:detail.title')}>
      {detail.isPending ? <Skeleton variant='lines' count={8} /> : null}
      {detail.error ? (
        errorCode(detail.error) === 'not_found' ? (
          <EmptyState
            headingLevel={2}
            title={t('logs:detail.missing.title')}
            description={t('logs:detail.missing.description')}
          />
        ) : (
          <ErrorNotice error={detail.error} />
        )
      ) : null}
      {detail.data ? <Detail data={detail.data} /> : null}
    </SideSheet>
  );
}
