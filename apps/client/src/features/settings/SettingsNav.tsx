import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './SettingsNav.module.css';

export const SETTINGS_SECTION_IDS = {
  appearance: 'settings-appearance',
  reading: 'settings-reading',
  models: 'settings-models',
  images: 'settings-images',
} as const;

const SECTIONS = [
  { id: SETTINGS_SECTION_IDS.appearance, labelKey: 'settings:nav.appearance' },
  { id: SETTINGS_SECTION_IDS.reading, labelKey: 'settings:nav.reading' },
  { id: SETTINGS_SECTION_IDS.models, labelKey: 'settings:nav.models' },
  { id: SETTINGS_SECTION_IDS.images, labelKey: 'settings:nav.images' },
] as const;

const ACTIVE_LINE_TOLERANCE = 1;

export function SettingsNav() {
  const { t } = useTranslation();
  const [active, setActive] = useState<string>(SETTINGS_SECTION_IDS.appearance);

  useEffect(() => {
    const headings = SECTIONS.flatMap((section) => {
      const heading = document.getElementById(section.id)?.querySelector('h2');
      return heading ? [{ id: section.id, heading }] : [];
    });
    const toolbar = document.querySelector('header');
    const updateActive = () => {
      const activeLine = (toolbar?.getBoundingClientRect().bottom ?? 0) + ACTIVE_LINE_TOLERANCE;
      let current: string = SETTINGS_SECTION_IDS.appearance;
      for (const { id, heading } of headings) {
        if (heading.getBoundingClientRect().top <= activeLine) current = id;
      }
      setActive(current);
    };
    updateActive();
    window.addEventListener('scroll', updateActive, { passive: true });
    window.addEventListener('resize', updateActive);
    return () => {
      window.removeEventListener('scroll', updateActive);
      window.removeEventListener('resize', updateActive);
    };
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
