import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './SettingsNav.module.css';

export const SETTINGS_SECTION_IDS = {
  appearance: 'settings-appearance',
  reading: 'settings-reading',
  models: 'settings-models',
} as const;

const SECTIONS = [
  { id: SETTINGS_SECTION_IDS.appearance, labelKey: 'settings:nav.appearance' },
  { id: SETTINGS_SECTION_IDS.reading, labelKey: 'settings:nav.reading' },
  { id: SETTINGS_SECTION_IDS.models, labelKey: 'settings:nav.models' },
] as const;

export function SettingsNav() {
  const { t } = useTranslation();
  const [active, setActive] = useState<string>(SETTINGS_SECTION_IDS.appearance);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const section = entry.target.closest('section');
          if (section) setActive(section.id);
        }
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    for (const section of SECTIONS) {
      const heading = document.getElementById(section.id)?.querySelector('h2');
      if (heading) observer.observe(heading);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav className={styles.nav} aria-label={t('settings:nav.label')}>
      {SECTIONS.map((section) => (
        <a
          key={section.id}
          className={styles.link}
          href={`#${section.id}`}
          aria-current={active === section.id ? 'true' : undefined}
        >
          {t(section.labelKey)}
        </a>
      ))}
    </nav>
  );
}
