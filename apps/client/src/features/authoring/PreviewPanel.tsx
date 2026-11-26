import { useTranslation } from 'react-i18next';
import type { Preview } from '@unwritten/contracts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { Button } from '../../shared/ui/Button.tsx';
import { Card } from '../../shared/ui/Card.tsx';
import { CastList } from './CastList.tsx';
import styles from './PreviewPanel.module.css';

export function PreviewPanel({
  preview,
  stale,
  adopting,
  onAdopt,
}: {
  preview: Preview;
  stale: boolean;
  adopting: boolean;
  onAdopt: () => void;
}) {
  const { t } = useTranslation();
  const paragraphs = preview.prose.split(/\n{2,}/).filter((paragraph) => paragraph.length > 0);

  return (
    <article className={styles.panel}>
      <div className={styles.heading}>
        <h2 className={styles.title}>{t('authoring:preview.heading')}</h2>
        {stale ? <Badge tone='warning'>{t('authoring:preview.stale')}</Badge> : null}
      </div>
      {stale ? <p className={styles.staleHelp}>{t('authoring:preview.staleHelp')}</p> : null}
      <div className={styles.intro}>
        <h3 className={styles.workTitle}>{preview.title}</h3>
        {preview.blurb ? <p className={styles.blurb}>{preview.blurb}</p> : null}
      </div>
      <Card as='section'>
        <div className={styles.block}>
          <h3 className={styles.sectionTitle}>{t('authoring:preview.setting')}</h3>
          <p className={styles.setting}>{preview.publicSetting}</p>
        </div>
      </Card>
      {preview.cast.length > 0 ? (
        <Card as='section'>
          <div className={styles.block}>
            <CastList cast={preview.cast} />
          </div>
        </Card>
      ) : null}
      <div className={styles.prose}>
        {paragraphs.map((paragraph, index) => (
          <p key={`${index}`}>{paragraph}</p>
        ))}
      </div>
      {preview.options.length > 0 ? (
        <ol className={styles.options} aria-label={t('authoring:preview.options')}>
          {preview.options.map((option, index) => (
            <li key={`${index}`} className={styles.option}>
              {option.text}
            </li>
          ))}
        </ol>
      ) : null}
      <div className={styles.actions}>
        <Button variant='secondary' busy={adopting} disabled={stale || adopting} onClick={onAdopt}>
          {t('authoring:preview.adopt')}
        </Button>
      </div>
    </article>
  );
}
