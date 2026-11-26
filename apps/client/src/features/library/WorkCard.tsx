import { Link, useNavigate } from '@tanstack/react-router';
import { CircleCheck, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkSummary } from '@unwritten/contracts';
import { formatRelative } from '../../shared/lib/format.ts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { buttonClassName } from '../../shared/ui/Button.tsx';
import { Card } from '../../shared/ui/Card.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import { OverflowMenu } from '../../shared/ui/OverflowMenu.tsx';
import styles from './WorkCard.module.css';

export function WorkCard({ work, onDelete }: { work: WorkSummary; onDelete: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const title = (work.title ?? work.label) || t('library:card.untitled');
  const routeId = work.status === 'playable' ? work.routeId : null;
  const entryLabel =
    routeId === null ? t('library:card.edit') : work.hasProgress ? t('library:card.resume') : t('library:card.play');

  return (
    <Card as='article'>
      <div className={styles.inner}>
        <div className={styles.heading}>
          <h2 className={styles.title}>{title}</h2>
          {work.status === 'playable' ? (
            <Badge tone='success' icon={CircleCheck}>
              {t('library:card.playable')}
            </Badge>
          ) : (
            <Badge tone='neutral'>{t('library:card.draft')}</Badge>
          )}
        </div>
        {work.blurb ? <p className={styles.blurb}>{work.blurb}</p> : null}
        <p className={styles.updated}>{t('library:card.updated', { time: formatRelative(work.updatedAt) })}</p>
        <div className={styles.footer}>
          {routeId !== null ? (
            <Link className={buttonClassName('secondary')} to='/play/$routeId' params={{ routeId }}>
              <Icon icon={Play} size='sm' />
              {entryLabel}
            </Link>
          ) : (
            <Link className={buttonClassName('secondary')} to='/works/$workId/edit' params={{ workId: work.id }}>
              {entryLabel}
            </Link>
          )}
          <OverflowMenu
            label={t('library:card.more', { title })}
            items={[
              ...(work.status === 'playable'
                ? [
                    {
                      label: t('library:card.viewDraft'),
                      onSelect: () => void navigate({ to: '/works/$workId/edit', params: { workId: work.id } }),
                    },
                  ]
                : []),
              { label: t('library:card.delete'), onSelect: onDelete, tone: 'danger' as const },
            ]}
          />
        </div>
      </div>
    </Card>
  );
}
