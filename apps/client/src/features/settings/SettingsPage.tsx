import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { buttonClassName } from '../../shared/ui/Button.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { AddEndpointForm } from './AddEndpointForm.tsx';
import { AppearanceSection } from './AppearanceSection.tsx';
import { ConfigProblem } from './ConfigProblem.tsx';
import { EndpointSection } from './EndpointSection.tsx';
import { PurposeSection } from './PurposeSection.tsx';
import { SETTINGS_SECTION_IDS, SettingsNav } from './SettingsNav.tsx';
import styles from './SettingsPage.module.css';

export function SettingsPage() {
  const { t } = useTranslation();
  const api = useApi();
  const config = useQuery({ queryKey: queryKeys.llm, queryFn: () => api.llm.providers.list() });
  const llmLogs = useQuery({ queryKey: queryKeys.llmLogStatus, queryFn: () => api.llm.logs.status() });
  const writesDisabled =
    config.data?.status === 'invalid' || config.data?.status === 'too_new' || Boolean(config.data?.problem);

  return (
    <Page
      title={t('settings:page.heading')}
      heading='custom'
      toolbar={{ start: { kind: 'back', to: '/', label: t('common:nav.library') } }}
      width='page'
    >
      <div className={styles.layout}>
        <div className={styles.rail}>
          <h1 className={styles.title} tabIndex={-1}>
            {t('settings:page.heading')}
          </h1>
          <SettingsNav />
        </div>
        <div className={styles.content}>
          {config.data?.problem ? <ConfigProblem problem={config.data.problem} /> : null}
          <ErrorNotice error={config.error} />
          <AppearanceSection />
          <section id={SETTINGS_SECTION_IDS.models} className={styles.models}>
            <h2 className={styles.heading}>{t('settings:models.heading')}</h2>
            <p className={styles.description}>{t('settings:purpose.description')}</p>
            {config.data ? (
              <>
                <PurposeSection
                  purposes={config.data.purposes}
                  endpoints={config.data.endpoints}
                  revision={config.data.revision}
                  disabled={writesDisabled}
                />
                <EndpointSection config={config.data} disabled={writesDisabled} />
                <AddEndpointForm config={config.data} disabled={writesDisabled} />
              </>
            ) : config.isPending ? (
              <Skeleton variant='lines' count={6} />
            ) : null}
          </section>
          {llmLogs.data?.enabled ? (
            <section className={styles.models}>
              <h2 className={styles.heading}>{t('settings:debug.heading')}</h2>
              <p className={styles.description}>{t('settings:debug.description')}</p>
              <div>
                <Link to='/debug/llm' className={`${buttonClassName('secondary')} ${styles.debugLink}`}>
                  {t('settings:debug.open')}
                </Link>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
