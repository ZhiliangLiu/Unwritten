import type { Appearance } from '@unwritten/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { RadioGroup } from '../../shared/ui/RadioGroup.tsx';
import { useNotify } from '../../shared/ui/Toaster.tsx';
import { applyAppearance, readAppearance } from '../../theme/appearance.ts';
import { SETTINGS_SECTION_IDS } from './SettingsNav.tsx';
import styles from './AppearanceSection.module.css';

const THEME_OPTIONS = [
  { value: 'system', labelKey: 'settings:appearance.themeOption.system', icon: Monitor },
  { value: 'light', labelKey: 'settings:appearance.themeOption.light', icon: Sun },
  { value: 'dark', labelKey: 'settings:appearance.themeOption.dark', icon: Moon },
] as const;

const SIZE_OPTIONS = [
  { value: '1', labelKey: 'settings:appearance.sizeOption.1' },
  { value: '2', labelKey: 'settings:appearance.sizeOption.2' },
  { value: '3', labelKey: 'settings:appearance.sizeOption.3' },
  { value: '4', labelKey: 'settings:appearance.sizeOption.4' },
  { value: '5', labelKey: 'settings:appearance.sizeOption.5' },
] as const;

const FONT_OPTIONS = [
  { value: 'serif', labelKey: 'settings:appearance.fontOption.serif' },
  { value: 'sans', labelKey: 'settings:appearance.fontOption.sans' },
] as const;

const LEADING_OPTIONS = [
  { value: 'comfortable', labelKey: 'settings:appearance.leadingOption.comfortable' },
  { value: 'compact', labelKey: 'settings:appearance.leadingOption.compact' },
] as const;

export function AppearanceSection() {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const settingsQuery = useQuery({ queryKey: queryKeys.settings, queryFn: () => api.settings.get() });
  const current = settingsQuery.data ?? readAppearance();
  const latestSubmitted = useRef<Appearance | null>(null);

  const update = useMutation({
    mutationFn: (input: { previous: Appearance; next: Appearance }) => api.settings.update(input.next),
    scope: { id: 'appearance' },
    onError: (_error, input) => {
      if (latestSubmitted.current !== input.next) return;
      applyAppearance(input.previous);
      queryClient.setQueryData(queryKeys.settings, input.previous);
      notify({ title: t('settings:appearance.saveFailed'), tone: 'danger' });
    },
  });

  function change(patch: Partial<Appearance>) {
    const previous = current;
    const next = { ...current, ...patch };
    latestSubmitted.current = next;
    applyAppearance(next);
    queryClient.setQueryData(queryKeys.settings, next);
    update.mutate({ previous, next });
  }

  return (
    <>
      <section id={SETTINGS_SECTION_IDS.appearance} className={styles.section}>
        <h2 className={styles.heading}>{t('settings:appearance.heading')}</h2>
        <ErrorNotice error={settingsQuery.error} />
        <div className={styles.optionRow}>
          <RadioGroup
            label={t('settings:appearance.theme')}
            value={current.appearance}
            onValueChange={(value) => change({ appearance: value as Appearance['appearance'] })}
            options={THEME_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
              icon: option.icon,
            }))}
            appearance='segmented'
          />
        </div>
        <p className={styles.help}>{t('settings:appearance.themeHelp')}</p>
      </section>
      <section id={SETTINGS_SECTION_IDS.reading} className={styles.section}>
        <h2 className={styles.heading}>{t('settings:reading.heading')}</h2>
        <p className={styles.help}>{t('settings:reading.description')}</p>
        <div className={styles.optionRow}>
          <RadioGroup
            label={t('settings:appearance.proseSize')}
            value={current.proseSize}
            onValueChange={(value) => change({ proseSize: value as Appearance['proseSize'] })}
            options={SIZE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
            appearance='segmented'
          />
        </div>
        <div className={styles.optionRow}>
          <RadioGroup
            label={t('settings:appearance.proseFont')}
            value={current.proseFont}
            onValueChange={(value) => change({ proseFont: value as Appearance['proseFont'] })}
            options={FONT_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
            appearance='segmented'
          />
        </div>
        <div className={styles.optionRow}>
          <RadioGroup
            label={t('settings:appearance.proseLeading')}
            value={current.proseLeading}
            onValueChange={(value) => change({ proseLeading: value as Appearance['proseLeading'] })}
            options={LEADING_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
            appearance='segmented'
          />
        </div>
        <figure className={styles.sampleCard} aria-label={t('settings:appearance.preview')}>
          <p className={styles.sample}>{t('settings:appearance.sample')}</p>
        </figure>
      </section>
    </>
  );
}
