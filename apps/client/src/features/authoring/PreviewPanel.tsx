import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { NeedsReview, Preview } from '@unwritten/contracts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { Button } from '../../shared/ui/Button.tsx';
import { Card } from '../../shared/ui/Card.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import { CastList } from './CastList.tsx';
import { PlaceholderText } from './placeholder-text.tsx';
import styles from './PreviewPanel.module.css';

const REVIEW_REASON_KEYS: Record<NeedsReview['reason'], string> = {
  hardcoded_name: 'authoring:preview.review.hardcoded_name',
  unknown_placeholder: 'authoring:preview.review.unknown_placeholder',
};

export function PreviewPanel({
  preview,
  stale,
  status,
  regenerating,
  adopting,
  onRegenerate,
  onAdopt,
}: {
  preview: Preview | null;
  stale: boolean;
  status: ReactNode;
  regenerating: boolean;
  adopting: boolean;
  onRegenerate: () => void;
  onAdopt: () => void;
}) {
  const { t } = useTranslation();
  const reviewId = useId();
  const paragraphs = preview ? preview.prose.split(/\n{2,}/).filter((paragraph) => paragraph.length > 0) : [];
  const needsReview = preview?.needsReview ?? [];
  const blocked = needsReview.length > 0;

  return (
    <article className={styles.panel}>
      <div className={styles.heading}>
        <h2 className={styles.title}>{t('authoring:opening.heading')}</h2>
        {stale ? <Badge tone='warning'>{t('authoring:preview.stale')}</Badge> : null}
      </div>
      <p className={styles.openingIntro}>{t('authoring:opening.intro')}</p>
      {stale ? <p className={styles.staleHelp}>{t('authoring:preview.staleHelp')}</p> : null}
      {status}
      {preview ? (
        <>
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
          {preview.initialState.length > 0 ? (
            <Card as='section'>
              <div className={styles.block}>
                <h3 className={styles.sectionTitle}>{t('authoring:preview.initialState')}</h3>
                <dl className={styles.stateList}>
                  {preview.initialState.map((entry, index) => (
                    <div key={`${index}`} className={styles.stateRow}>
                      <dt className={styles.stateLabel}>{entry.label}</dt>
                      <dd className={styles.stateValue}>
                        {entry.text}
                        {entry.visible ? null : (
                          <span className={styles.stateHidden}>{t('authoring:preview.initialHidden')}</span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Card>
          ) : null}
          <div className={styles.paper}>
            <div className={styles.intro}>
              <h3 className={styles.workTitle}>{preview.title}</h3>
              {preview.blurb ? <p className={styles.blurb}>{preview.blurb}</p> : null}
            </div>
            <div className={styles.prose}>
              {paragraphs.map((paragraph, index) => (
                <p key={`${index}`}>
                  <PlaceholderText text={paragraph} />
                </p>
              ))}
            </div>
            {preview.options.length > 0 ? (
              <ol className={styles.options} aria-label={t('authoring:preview.options')}>
                {preview.options.map((option, index) => (
                  <li key={`${index}`} className={styles.option}>
                    <div className={styles.optionBody}>
                      <span>
                        <PlaceholderText text={option.text} />
                      </span>
                      {option.hint ? (
                        <span className={styles.hint}>{t('authoring:preview.hint', { text: option.hint })}</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
          {blocked ? (
            <Card as='section'>
              <div id={reviewId} className={styles.review}>
                <div className={styles.reviewHeading}>
                  <Icon icon={TriangleAlert} />
                  <h3 className={styles.sectionTitle}>{t('authoring:preview.review.heading')}</h3>
                </div>
                <ul className={styles.reviewList}>
                  {needsReview.map((entry, index) => (
                    <li key={`${index}`} className={styles.reviewItem}>
                      <p className={styles.reviewWhere}>
                        {entry.where === 'prose'
                          ? t('authoring:preview.review.prose', { index: entry.index })
                          : t('authoring:preview.review.option', { index: entry.index })}
                        <span aria-hidden='true'> · </span>
                        {t(REVIEW_REASON_KEYS[entry.reason])}
                      </p>
                      <p className={styles.reviewText}>
                        <q>{entry.text}</q>
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
      <div className={styles.actions}>
        <Button variant='secondary' icon={RefreshCw} busy={regenerating} onClick={onRegenerate}>
          {t('authoring:preview.regenerate')}
        </Button>
        {blocked ? <p className={styles.blocked}>{t('authoring:preview.adoptBlocked')}</p> : null}
        <Button
          variant='primary'
          busy={adopting}
          disabled={!preview || stale || regenerating || blocked}
          aria-describedby={blocked ? reviewId : undefined}
          onClick={onAdopt}
        >
          {t('authoring:preview.adopt')}
        </Button>
      </div>
    </article>
  );
}
