import type { ImageUsageSummary } from '@unwritten/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import styles from './ImageUsagePanel.module.css';

const NUMBER_FORMAT = new Intl.NumberFormat('zh-CN');
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const BYTES_PER_GIGABYTE = 1024 * 1024 * 1024;

function sizeFormat(unit: 'kilobyte' | 'megabyte' | 'gigabyte'): Intl.NumberFormat {
  return new Intl.NumberFormat('zh-CN', { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 1 });
}

export function formatStorageSize(bytes: number): string {
  if (bytes >= BYTES_PER_GIGABYTE) return sizeFormat('gigabyte').format(bytes / BYTES_PER_GIGABYTE);
  if (bytes >= BYTES_PER_MEGABYTE) return sizeFormat('megabyte').format(bytes / BYTES_PER_MEGABYTE);
  return sizeFormat('kilobyte').format(bytes / BYTES_PER_KILOBYTE);
}

type UsageWindow = ImageUsageSummary['services'][number]['last7Days'];

function UsageWindowRow({ label, usage }: { label: string; usage: UsageWindow }) {
  const { t } = useTranslation();
  return (
    <div className={styles.window}>
      <dt>{label}</dt>
      <dd>{t('settings:usage.images', { count: NUMBER_FORMAT.format(usage.images) })}</dd>
      <dd>
        {usage.inputTokens + usage.outputTokens === 0
          ? t('settings:usage.noTokens')
          : t('settings:usage.tokens', {
              input: NUMBER_FORMAT.format(usage.inputTokens),
              output: NUMBER_FORMAT.format(usage.outputTokens),
            })}
      </dd>
    </div>
  );
}

export function ImageUsagePanel() {
  const { t } = useTranslation();
  const api = useApi();
  const usage = useQuery({ queryKey: queryKeys.imageUsage, queryFn: () => api.image.usage.summary() });
  const storage = useQuery({ queryKey: queryKeys.imageStorage, queryFn: () => api.image.storage.summary() });

  return (
    <section className={styles.panel}>
      <h3 className={styles.heading}>{t('settings:usage.heading')}</h3>
      {usage.isPending ? <Skeleton variant='lines' count={2} /> : null}
      {usage.data?.services.map((service) => (
        <section key={service.serviceId} className={styles.service}>
          <h4 className={styles.name}>{service.name ?? service.serviceId}</h4>
          <dl className={styles.windows}>
            <UsageWindowRow label={t('settings:usage.last7Days')} usage={service.last7Days} />
            <UsageWindowRow label={t('settings:usage.last30Days')} usage={service.last30Days} />
          </dl>
        </section>
      ))}
      {storage.data ? (
        <p className={styles.storage}>
          {t('settings:usage.storage', {
            size: formatStorageSize(storage.data.bytes),
          })}
        </p>
      ) : null}
      <ErrorNotice error={usage.error ?? storage.error} />
    </section>
  );
}
