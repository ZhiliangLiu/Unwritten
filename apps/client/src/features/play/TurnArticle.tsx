import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import type { TurnView } from '@unwritten/contracts';
import { IllustrationFrame } from './IllustrationFrame.tsx';
import { PlayerAction } from './PlayerAction.tsx';
import { paragraphAnchorId, turnHeadingId } from './anchors.ts';
import { placementOf } from './illustration-layout.ts';
import styles from './TurnArticle.module.css';

export function TurnArticle({
  turn,
  language,
  arriving,
  routeId,
}: {
  turn: TurnView;
  language: string;
  arriving: boolean;
  routeId: string;
}) {
  const { t } = useTranslation();
  const para = placementOf(turn);
  const illustrationView =
    turn.illustration && turn.illustration.status !== 'dismissed' && turn.illustration.status !== 'cancelled'
      ? turn.illustration
      : null;
  const anchorPara = Math.max(1, Math.min(para, turn.paragraphs.length));
  const illustration = illustrationView ? (
    <IllustrationFrame
      illustration={illustrationView}
      routeId={routeId}
      depth={turn.depth}
      paraAnchorId={paragraphAnchorId(turn.id, anchorPara)}
    />
  ) : null;

  return (
    <article
      aria-labelledby={turnHeadingId(turn.id)}
      data-uw-arriving={arriving ? '' : undefined}
      className={styles.article}
    >
      <h2 id={turnHeadingId(turn.id)} tabIndex={-1} className={styles.heading}>
        {turn.depth === 0 ? t('play:turn.opening') : t('play:turn.heading', { count: turn.depth })}
      </h2>
      {turn.action ? <PlayerAction text={turn.action.text} language={language} /> : null}
      <div lang={language} className={styles.paragraphs}>
        {para === 0 ? illustration : null}
        {turn.paragraphs.map((paragraph, index) => (
          <Fragment key={index}>
            <p
              id={paragraphAnchorId(turn.id, index + 1)}
              tabIndex={-1}
              data-uw-paragraph=''
              className={styles.paragraph}
            >
              {paragraph}
            </p>
            {para === index + 1 ? illustration : null}
          </Fragment>
        ))}
        {para > turn.paragraphs.length ? illustration : null}
      </div>
    </article>
  );
}
