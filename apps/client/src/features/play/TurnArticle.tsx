import { useTranslation } from 'react-i18next';
import type { TurnView } from '@unwritten/contracts';
import { paragraphAnchorId, turnHeadingId } from './anchors.ts';
import styles from './TurnArticle.module.css';

export function TurnArticle({ turn, language, arriving }: { turn: TurnView; language: string; arriving: boolean }) {
  const { t } = useTranslation();

  return (
    <article
      aria-labelledby={turnHeadingId(turn.id)}
      data-uw-arriving={arriving ? '' : undefined}
      className={styles.article}
    >
      <h2 id={turnHeadingId(turn.id)} tabIndex={-1} className={styles.heading}>
        {turn.depth === 0 ? t('play:turn.opening') : t('play:turn.heading', { count: turn.depth })}
      </h2>
      {turn.action ? (
        <p lang={language} className={styles.action}>
          <span className={styles.hidden}>{t('play:action.prefix')}</span>
          {turn.action.text}
        </p>
      ) : null}
      <div lang={language} className={styles.paragraphs}>
        {turn.paragraphs.map((paragraph, index) => (
          <p key={index} id={paragraphAnchorId(turn.id, index + 1)} tabIndex={-1} className={styles.paragraph}>
            {paragraph}
          </p>
        ))}
      </div>
    </article>
  );
}
