import { Eye, EyeOff, Info, RefreshCw } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlanItem, WorkDetail } from '@unwritten/contracts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { Button } from '../../shared/ui/Button.tsx';
import { Card } from '../../shared/ui/Card.tsx';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { GeneratingMarker } from '../../shared/ui/GeneratingMarker.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import { LiveRegion } from '../../shared/ui/LiveRegion.tsx';
import { NovelChapterPicker } from './NovelChapterPicker.tsx';
import { PlanConflicts } from './PlanConflicts.tsx';
import { PlanItemCard } from './PlanItemCard.tsx';
import styles from './PlanPanel.module.css';

export function PlanPanel({
  work,
  busy,
  onRegenerate,
  onChooseNovelChapter,
  onAdoptStale,
  onUpdateItem,
  onRemoveItem,
  onConfirm,
}: {
  work: WorkDetail;
  busy: boolean;
  onRegenerate: () => void;
  onChooseNovelChapter?: (chapter: number, referenceChapter?: number) => void;
  onAdoptStale: (jobId: string) => void;
  onUpdateItem: (item: PlanItem) => void;
  onRemoveItem: (itemId: string) => void;
  onConfirm: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<PlanItem | null>(null);
  const backstageId = useId();
  const confirmReasonId = useId();

  const plan = work.draft.plan;
  const items = plan?.items ?? [];
  const latest = work.latestPlanJob;
  const running = latest?.status === 'running';
  const novel = work.novelImport;
  const progress = latest?.novelProgress;
  const status = progress
    ? t('authoring:novel.reading', {
        percent: new Intl.NumberFormat(i18n.language, { style: 'percent', roundingMode: 'floor' }).format(
          progress.processed / progress.total,
        ),
      })
    : t('authoring:plan.running');
  const empty = items.length === 0;
  const confirmed = plan?.confirmed === true;
  const confirmReason = empty
    ? t('authoring:plan.confirmDisabled.empty')
    : running
      ? t('authoring:plan.confirmDisabled.running')
      : null;

  const entities = items.filter((item): item is Extract<PlanItem, { kind: 'entity' }> => item.kind === 'entity');
  const secrets = items.filter((item): item is Extract<PlanItem, { kind: 'secret' }> => item.kind === 'secret');
  const endings = items.filter((item): item is Extract<PlanItem, { kind: 'ending' }> => item.kind === 'ending');
  const summaries = items.filter((item) => item.kind === 'summary');
  const states = items.filter((item) => item.kind === 'state');
  const scenes = items.filter((item) => item.kind === 'scene');
  const hiddenCount = secrets.length + (endings.length > 0 ? 1 : 0);

  const nameById = new Map(entities.map((entity) => [entity.id, entity.name]));

  const card = (item: PlanItem) => (
    <PlanItemCard
      key={item.id}
      item={item}
      workId={work.id}
      castMode={work.draft.settings.cast.mode}
      knowerNames={item.kind === 'secret' ? item.knowerIds.flatMap((id) => nameById.get(id) ?? []) : []}
      editing={editingId === item.id}
      onEdit={() => setEditingId(item.id)}
      onCancel={() => setEditingId(null)}
      onSave={(next) => {
        onUpdateItem(next);
        setEditingId(null);
      }}
      onRemove={() => setRemoveTarget(item)}
    />
  );

  const group = (heading: string, groupItems: PlanItem[]) =>
    groupItems.length === 0 ? null : (
      <section className={styles.group}>
        <h3 className={styles.groupHeading}>{heading}</h3>
        <Card>
          <ul className={styles.items}>{groupItems.map(card)}</ul>
        </Card>
      </section>
    );

  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>{t('authoring:plan.heading')}</h2>
      <p className={styles.intro}>{t('authoring:plan.intro')}</p>

      {busy ? <GeneratingMarker label={status} /> : null}
      <LiveRegion message={busy ? (progress ? t('authoring:novel.running') : status) : ''} />
      {novel && novel.chapterCount > 1 && onChooseNovelChapter ? (
        <div className={styles.group}>
          <NovelChapterPicker workId={work.id} novel={novel} busy={busy} onChoose={onChooseNovelChapter} />
        </div>
      ) : null}
      {latest?.status === 'failed' ? (
        <ErrorNotice
          code={latest.error ?? 'unknown'}
          diagnosticId={latest.id}
          action={
            <Button variant='secondary' onClick={onRegenerate}>
              {t('authoring:plan.regenerate')}
            </Button>
          }
        />
      ) : null}
      {latest?.stale ? (
        <Card as='section'>
          <div className={styles.stale}>
            <span className={styles.staleIcon}>
              <Icon icon={Info} />
            </span>
            <div className={styles.staleBody}>
              <h3 className={styles.staleTitle}>{t('authoring:plan.staleTitle')}</h3>
              <p className={styles.staleText}>{t('authoring:plan.stale')}</p>
            </div>
            <div className={styles.staleActions}>
              <Button variant='text' onClick={() => onAdoptStale(latest.id)}>
                {t('authoring:plan.adoptStale')}
              </Button>
              <Button variant='text' onClick={onRegenerate}>
                {t('authoring:plan.regenerate')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <PlanConflicts conflicts={plan?.conflicts ?? []} />

      {group(t('authoring:plan.group.summary'), summaries)}
      {group(
        t('authoring:plan.group.entities'),
        [...entities].sort((left, right) => Number(right.role === 'protagonist') - Number(left.role === 'protagonist')),
      )}
      {group(t('authoring:plan.group.state'), states)}
      {group(t('authoring:plan.group.scenes'), scenes)}

      {hiddenCount > 0 ? (
        <Card as='section'>
          <div className={styles.backstage}>
            <span className={styles.backstageIcon}>
              <Icon icon={expanded ? Eye : EyeOff} />
            </span>
            <div className={styles.backstageBody}>
              <h3 className={styles.backstageTitle}>
                {expanded
                  ? t('authoring:plan.secret.expandedTitle')
                  : t('authoring:plan.secret.foldedTitle', { count: hiddenCount })}
              </h3>
              <p className={styles.backstageHelp}>
                {expanded ? t('authoring:plan.secret.expandedHelp') : t('authoring:plan.secret.foldedHelp')}
              </p>
              {expanded ? null : (
                <>
                  {secrets.length > 0 ? (
                    <ul className={styles.secretTitles}>
                      {secrets.map((secret) => (
                        <li key={secret.id}>{secret.title}</li>
                      ))}
                    </ul>
                  ) : null}
                  <p className={styles.backstageHelp}>
                    {endings.length > 0 ? t('authoring:plan.ending.folded') : t('authoring:plan.ending.none')}
                  </p>
                </>
              )}
            </div>
            <Button
              variant='text'
              icon={expanded ? EyeOff : Eye}
              aria-expanded={expanded}
              aria-controls={backstageId}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? t('authoring:plan.secret.hide') : t('authoring:plan.secret.show')}
            </Button>
          </div>
        </Card>
      ) : null}

      <div id={backstageId}>{expanded ? group(t('authoring:plan.group.secrets'), [...secrets, ...endings]) : null}</div>

      <div className={styles.actions}>
        <Button variant='secondary' icon={RefreshCw} busy={busy} onClick={onRegenerate}>
          {t('authoring:plan.regenerate')}
        </Button>
        {confirmed ? <Badge tone='success'>{t('authoring:plan.confirmed')}</Badge> : null}
        <Button
          variant='primary'
          disabled={empty || running || busy}
          aria-describedby={confirmReason ? confirmReasonId : undefined}
          onClick={onConfirm}
        >
          {t('authoring:plan.confirm')}
        </Button>
        {confirmReason ? (
          <p className={styles.confirmReason} id={confirmReasonId}>
            {confirmReason}
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={t('authoring:plan.remove.title')}
        description={t('authoring:plan.remove.description')}
        confirmLabel={t('authoring:plan.remove.confirm')}
        tone='danger'
        onConfirm={() => {
          if (removeTarget) onRemoveItem(removeTarget.id);
          setRemoveTarget(null);
        }}
      />
    </section>
  );
}
