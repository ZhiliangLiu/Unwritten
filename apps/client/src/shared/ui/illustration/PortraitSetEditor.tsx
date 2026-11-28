import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PORTRAIT_SLOTS } from '@unwritten/contracts';
import type { OutputOptionsView, OutputPreferences, PortraitTarget } from '@unwritten/contracts';
import { useApi } from '../../api/context.tsx';
import { errorCode } from '../../api/errors.ts';
import { queryKeys } from '../../api/query.ts';
import { IMAGE_TIER_LABEL_KEYS } from '../../lib/image-labels.ts';
import { Button } from '../Button.tsx';
import { Disclosure } from '../Disclosure.tsx';
import { ErrorNotice } from '../ErrorNotice.tsx';
import { Select } from '../Select.tsx';
import { Skeleton } from '../Skeleton.tsx';
import { PortraitSlotCard } from './PortraitSlotCard.tsx';
import styles from './PortraitSetEditor.module.css';

function tiersForAspect(output: OutputOptionsView, aspect: string): OutputOptionsView['tiers'] {
  const available = output.tiers.filter((entry) => entry.sizes[aspect] !== undefined);
  return available.length > 0 ? available : output.tiers;
}

function preferredFormat(output: OutputOptionsView | undefined): OutputPreferences | null {
  if (!output || output.aspects.length === 0 || output.tiers.length === 0) return null;
  const portraitAspects = output.aspects.filter((aspect) => {
    const [width, height] = aspect.split(':').map(Number);
    return width !== undefined && height !== undefined && width < height;
  });
  const aspectPreference = output.aspects.includes('3:4') ? '3:4' : (portraitAspects[0] ?? output.aspects[0]!);
  const tiers = tiersForAspect(output, aspectPreference);
  const resolutionTier = tiers.some((entry) => entry.tier === '1k') ? '1k' : tiers[0]!.tier;
  return { aspectPreference, resolutionTier };
}

export function PortraitSetEditor({
  workId,
  scope,
  target,
  appearance,
  mode,
  onSnapshot,
}: {
  workId: string;
  scope: 'work' | 'pending';
  target: PortraitTarget;
  appearance: string | null;
  mode: 'author' | 'player';
  onSnapshot?: (setId: string) => void;
}) {
  const api = useApi();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const needFrontId = useId();
  const [error, setError] = useState<unknown>(null);
  const [preference, setPreference] = useState<OutputPreferences | null>(null);

  const targetKey = target.kind === 'entity' ? target.entityId : 'protagonist';
  const draftKey = queryKeys.portraitDraft(workId, scope, targetKey, appearance ?? '');
  const draftQuery = useQuery({
    queryKey: draftKey,
    queryFn: () => api.portrait.draft({ workId, scope, target, appearance }),
  });
  const config = useQuery({ queryKey: queryKeys.imageConfig, queryFn: () => api.image.services.list() });
  const output = useQuery({ queryKey: queryKeys.imageOutput, queryFn: () => api.image.outputPreferences.get() });

  const draft = draftQuery.data?.draft ?? null;
  const activeSetId = draftQuery.data?.activeSetId ?? null;
  const format = preference ?? preferredFormat(output.data);
  const tierOptions = output.data && format ? tiersForAspect(output.data, format.aspectPreference) : [];
  const effectiveTier =
    format && tierOptions.length > 0 && !tierOptions.some((entry) => entry.tier === format.resolutionTier)
      ? tierOptions.some((entry) => entry.tier === '1k')
        ? '1k'
        : tierOptions[0]!.tier
      : (format?.resolutionTier ?? null);
  const generateFormat = format && effectiveTier ? { ...format, resolutionTier: effectiveTier } : null;
  const selectedServiceId = config.data?.selectedServiceId ?? null;
  const serviceName = config.data?.services.find((service) => service.id === selectedServiceId)?.name ?? null;
  const hasFront = draft?.slots.some((slot) => slot.slot === 'front' && slot.image !== null) ?? false;
  const missingViews = draft?.slots.some((slot) => slot.slot !== 'front' && slot.image === null) ?? false;
  const needsReview = draft?.slots.some((slot) => slot.needsReview) ?? false;
  const canGenerate = selectedServiceId !== null && generateFormat !== null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: draftKey });
  };

  const refresh = () => {
    setError(null);
    invalidate();
  };

  const handleError = (cause: unknown) => {
    setError(cause);
    if (errorCode(cause) === 'stale_revision') invalidate();
  };

  const fillViews = useMutation({
    mutationFn: async () => {
      if (!draft || !generateFormat || !hasFront) return;
      let rev = draft.draftRev;
      for (const slot of ['three_quarter', 'full_body'] as const) {
        if (draft.slots.find((candidate) => candidate.slot === slot)?.image) continue;
        const next = await api.portrait.generate({
          requestId: crypto.randomUUID(),
          setId: draft.id,
          slot,
          expectedRev: rev,
          format: generateFormat,
        });
        rev = next.draftRev;
      }
    },
    onSuccess: refresh,
    onError: handleError,
  });

  const adopt = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('missing draft');
      return api.portrait.adopt({
        requestId: crypto.randomUUID(),
        setId: draft.id,
        expectedRev: draft.draftRev,
        mode: 'adopt',
        expectedActiveSetId: mode === 'player' ? null : activeSetId,
      });
    },
    onSuccess: (result) => {
      refresh();
      if (mode === 'player' && result.activeSetId) onSnapshot?.(result.activeSetId);
    },
    onError: handleError,
  });

  const retire = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('missing draft');
      return api.portrait.adopt({
        requestId: crypto.randomUUID(),
        setId: draft.id,
        expectedRev: draft.draftRev,
        mode: 'retire',
        expectedActiveSetId: activeSetId,
      });
    },
    onSuccess: refresh,
    onError: handleError,
  });

  if (draftQuery.isLoading) return <Skeleton variant='lines' count={3} />;
  if (draftQuery.error) return <ErrorNotice error={draftQuery.error} />;
  if (!draft) return null;

  return (
    <div className={styles.editor}>
      <ErrorNotice error={error} />
      {needsReview ? <p className={styles.hint}>{t('authoring:portrait.reviewHint')}</p> : null}
      <div className={styles.slots}>
        {PORTRAIT_SLOTS.map((slot) => {
          const view = draft.slots.find((candidate) => candidate.slot === slot);
          if (!view) return null;
          return (
            <PortraitSlotCard
              key={slot}
              workId={workId}
              setId={draft.id}
              slot={slot}
              view={view}
              expectedRev={draft.draftRev}
              updatedAt={draft.updatedAt}
              format={generateFormat}
              canGenerate={canGenerate && (slot === 'front' || hasFront)}
              onChanged={refresh}
              onError={handleError}
            />
          );
        })}
      </div>
      {generateFormat && output.data ? (
        <Disclosure summary={t('authoring:portrait.generateSettings')} panelClassName={styles.settingsBody}>
          <Select
            label={t('play:format.aspect')}
            value={generateFormat.aspectPreference}
            onValueChange={(aspectPreference) => setPreference({ ...generateFormat, aspectPreference })}
            options={output.data.aspects.map((aspect) => ({ value: aspect, label: aspect }))}
          />
          <Select
            label={t('play:format.tier')}
            value={generateFormat.resolutionTier}
            onValueChange={(resolutionTier) =>
              setPreference({
                ...generateFormat,
                resolutionTier: resolutionTier as OutputPreferences['resolutionTier'],
              })
            }
            options={tierOptions.map((entry) => ({
              value: entry.tier,
              label: t(IMAGE_TIER_LABEL_KEYS[entry.tier]),
            }))}
          />
        </Disclosure>
      ) : null}
      {serviceName ? (
        <p className={styles.notice}>{t('authoring:portrait.sendNotice', { service: serviceName })}</p>
      ) : null}
      <div className={styles.actions}>
        {missingViews ? (
          <Button
            variant='secondary'
            busy={fillViews.isPending}
            disabled={!canGenerate || !hasFront}
            onClick={() => fillViews.mutate()}
          >
            {t('authoring:portrait.fillViews')}
          </Button>
        ) : null}
        <Button
          variant='secondary'
          busy={adopt.isPending}
          disabled={!hasFront}
          aria-describedby={!hasFront ? needFrontId : undefined}
          onClick={() => adopt.mutate()}
        >
          {mode === 'player' ? t('authoring:portrait.useForPlaythrough') : t('authoring:portrait.adopt')}
        </Button>
        {mode === 'author' && activeSetId ? (
          <Button variant='text' busy={retire.isPending} onClick={() => retire.mutate()}>
            {t('authoring:portrait.retire')}
          </Button>
        ) : null}
      </div>
      {!hasFront ? (
        <p className={styles.hint} id={needFrontId}>
          {t('authoring:portrait.needFront')}
        </p>
      ) : null}
    </div>
  );
}
