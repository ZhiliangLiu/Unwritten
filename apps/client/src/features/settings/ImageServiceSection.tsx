import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { Card } from '../../shared/ui/Card.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { Select } from '../../shared/ui/Select.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { AddImageServiceForm } from './AddImageServiceForm.tsx';
import { AutoIllustrationPanel } from './AutoIllustrationPanel.tsx';
import { ConfigProblem } from './ConfigProblem.tsx';
import { ImageServiceCard } from './ImageServiceCard.tsx';
import { ImageUsagePanel } from './ImageUsagePanel.tsx';
import { OutputDefaultsPanel } from './OutputDefaultsPanel.tsx';
import { SETTINGS_SECTION_IDS } from './SettingsNav.tsx';
import styles from './ImageServiceSection.module.css';

const NO_SERVICE = '';

export function ImageServiceSection() {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: queryKeys.imageConfig, queryFn: () => api.image.services.list() });
  const writesDisabled =
    config.data?.status === 'invalid' || config.data?.status === 'too_new' || Boolean(config.data?.problem);
  const selectedService = config.data?.services.find((service) => service.id === config.data?.selectedServiceId);

  const select = useMutation({
    mutationFn: (serviceId: string | null) =>
      api.image.select({ baseRevision: config.data?.revision ?? '', serviceId }),
    onSuccess: (next) => queryClient.setQueryData(queryKeys.imageConfig, next),
  });

  return (
    <section id={SETTINGS_SECTION_IDS.images} className={styles.section}>
      <h2 className={styles.heading}>{t('settings:images.heading')}</h2>
      <p className={styles.description}>{t('settings:images.description')}</p>
      <p className={styles.description}>{t('settings:images.privacy')}</p>
      {config.data?.problem ? <ConfigProblem problem={config.data.problem} /> : null}
      <ErrorNotice error={config.error ?? select.error} />
      {config.data ? (
        config.data.services.length === 0 ? (
          <AddImageServiceForm revision={config.data.revision} disabled={writesDisabled} />
        ) : (
          <>
            <Card as='section'>
              <h3 className={styles.cardHeading}>{t('settings:images.illustrationHeading')}</h3>
              <Select
                label={t('settings:images.selected')}
                value={selectedService?.id ?? NO_SERVICE}
                onValueChange={(value) => select.mutate(value === NO_SERVICE ? null : value)}
                options={[
                  { value: NO_SERVICE, label: t('settings:images.disabled') },
                  ...config.data.services.map((service) => ({ value: service.id, label: service.name })),
                ]}
                disabled={writesDisabled || select.isPending}
              />
              <AutoIllustrationPanel disabled={writesDisabled} />
              {selectedService ? (
                <OutputDefaultsPanel
                  disabled={writesDisabled}
                  capabilitiesKnown={selectedService.capabilities !== null}
                />
              ) : null}
            </Card>
            <section className={styles.services}>
              <h3 className={styles.subheading}>{t('settings:images.servicesHeading')}</h3>
              {config.data.services.map((service) => (
                <ImageServiceCard
                  key={service.id}
                  service={service}
                  revision={config.data.revision}
                  selected={config.data.selectedServiceId === service.id}
                  disabled={writesDisabled}
                />
              ))}
            </section>
            <AddImageServiceForm revision={config.data.revision} disabled={writesDisabled} />
            <ImageUsagePanel />
          </>
        )
      ) : config.isPending ? (
        <Skeleton variant='lines' count={6} />
      ) : null}
    </section>
  );
}
