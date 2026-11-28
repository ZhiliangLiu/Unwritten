import type { ImageSize, OutputPreferences } from '@unwritten/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { IMAGE_TIER_LABEL_KEYS } from '../../shared/lib/image-labels.ts';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { RadioGroup } from '../../shared/ui/RadioGroup.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import styles from './OutputDefaultsPanel.module.css';

export function OutputDefaultsPanel({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const view = useQuery({ queryKey: queryKeys.imageOutput, queryFn: () => api.image.outputPreferences.get() });

  const set = useMutation({
    mutationFn: (preferences: OutputPreferences) => api.image.outputPreferences.set(preferences),
    onSuccess: (next) => queryClient.setQueryData(queryKeys.imageOutput, next),
  });

  const dimensions = (size: ImageSize): string =>
    t('play:format.dimensions', { width: size.width, height: size.height });

  if (view.isPending) {
    return (
      <section className={styles.panel}>
        <h3 className={styles.heading}>{t('settings:output.heading')}</h3>
        <Skeleton variant='lines' count={2} />
      </section>
    );
  }

  if (!view.data) {
    return (
      <section className={styles.panel}>
        <h3 className={styles.heading}>{t('settings:output.heading')}</h3>
        <ErrorNotice error={view.error ?? set.error} />
      </section>
    );
  }

  const preferences = view.data.preferences;
  const aspect = preferences.aspectPreference;
  const visibleTiers = view.data.tiers.filter((entry) => aspect === 'auto' || entry.sizes[aspect] !== undefined);
  const aspectOptions = view.data.aspects.includes(aspect)
    ? view.data.aspects
    : aspect === 'auto'
      ? view.data.aspects
      : [aspect, ...view.data.aspects];

  return (
    <section className={styles.panel}>
      <h3 className={styles.heading}>{t('settings:output.heading')}</h3>
      <div className={styles.options} inert={disabled || undefined}>
        <RadioGroup
          label={t('play:format.aspect')}
          value={aspect}
          onValueChange={(value) => set.mutate({ ...preferences, aspectPreference: value })}
          options={[
            { value: 'auto', label: t('play:format.automatic') },
            ...aspectOptions.map((value) => ({ value, label: value })),
          ]}
          appearance='segmented'
        />
        <RadioGroup
          label={t('play:format.tier')}
          value={preferences.resolutionTier}
          onValueChange={(value) =>
            set.mutate({ ...preferences, resolutionTier: value as OutputPreferences['resolutionTier'] })
          }
          options={visibleTiers.map((entry) => {
            const size = aspect === 'auto' ? undefined : entry.sizes[aspect];
            return {
              value: entry.tier,
              label: `${t(IMAGE_TIER_LABEL_KEYS[entry.tier])} · ${
                size ? dimensions(size) : t('settings:output.multipleSizes')
              }`,
            };
          })}
          appearance='segmented'
        />
      </div>
      {visibleTiers.length === 1 ? <p className={styles.notice}>{t('settings:output.onlyTier')}</p> : null}
      {!view.data.preferenceAvailable ? <p className={styles.notice}>{t('settings:output.unavailable')}</p> : null}
      {aspect === 'auto' ? (
        <details className={styles.sizes}>
          <summary>{t('settings:output.multipleSizes')}</summary>
          <ul>
            {view.data.tiers.map((entry) => (
              <li key={entry.tier}>
                <p className={styles.tierName}>{t(IMAGE_TIER_LABEL_KEYS[entry.tier])}</p>
                <ul>
                  {Object.entries(entry.sizes).map(([ratio, size]) => (
                    <li key={ratio}>
                      {ratio} · {dimensions(size)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <ErrorNotice error={set.error} />
    </section>
  );
}
