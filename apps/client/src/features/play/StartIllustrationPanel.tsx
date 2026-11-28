import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { APPEARANCE_MAX_LENGTH } from '@unwritten/contracts';
import type {
  AspectPreference,
  ImageSize,
  ImageTierPreference,
  StartIllustrationInfo,
  StartIllustrationInput,
} from '@unwritten/contracts';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { IMAGE_TIER_LABEL_KEYS } from '../../shared/lib/image-labels.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { Disclosure } from '../../shared/ui/Disclosure.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { GeneratingMarker } from '../../shared/ui/GeneratingMarker.tsx';
import { PortraitSetEditor } from '../../shared/ui/illustration/PortraitSetEditor.tsx';
import { StylePicker } from '../../shared/ui/illustration/StylePicker.tsx';
import { StylePreview } from '../../shared/ui/illustration/StylePreview.tsx';
import { RadioGroup } from '../../shared/ui/RadioGroup.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { TextArea } from '../../shared/ui/TextArea.tsx';
import { summaryText } from './start-illustration.ts';
import styles from './StartIllustrationPanel.module.css';

function sanitizeAppearance(value: string): string {
  return value.replace(/[\r\n]+/gu, '').slice(0, APPEARANCE_MAX_LENGTH);
}

export function StartIllustrationPanel({
  workId,
  info,
  choice,
  onChange,
}: {
  workId: string;
  info: StartIllustrationInfo;
  choice: StartIllustrationInput;
  onChange: (choice: StartIllustrationInput) => void;
}) {
  const api = useApi();
  const { t } = useTranslation();
  const config = useQuery({ queryKey: queryKeys.imageConfig, queryFn: () => api.image.services.list() });
  const output = useQuery({ queryKey: queryKeys.imageOutput, queryFn: () => api.image.outputPreferences.get() });
  const setChoice = (patch: Partial<StartIllustrationInput>) => onChange({ ...choice, ...patch });
  const suggest = useMutation({
    mutationFn: () => api.play.suggestAppearance({ workId }),
    onSuccess: (result) => setChoice({ protagonistAppearance: sanitizeAppearance(result.appearance) }),
  });

  if (!info.available) return null;

  const selectedService = config.data?.services.find((service) => service.id === config.data?.selectedServiceId);
  const offline = selectedService?.state === 'offline';
  const aspectValues = output.data
    ? output.data.aspects.includes(choice.aspectPreference) || choice.aspectPreference === 'auto'
      ? output.data.aspects
      : [choice.aspectPreference, ...output.data.aspects]
    : [];
  const visibleTiers = output.data
    ? output.data.tiers.filter(
        (entry) => choice.aspectPreference === 'auto' || entry.sizes[choice.aspectPreference] !== undefined,
      )
    : [];
  const dimensions = (size: ImageSize): string =>
    t('play:format.dimensions', { width: size.width, height: size.height });
  const previewProps = { workId, style: choice.style, viewWorkId: workId };

  return (
    <div className={styles.panel}>
      <Disclosure
        heading='h3'
        className={styles.disclosure}
        panelClassName={styles.body}
        summary={
          <>
            <span>{t('play:start.illustration.heading')}</span>
            <span className={styles.summary}>{summaryText(choice, t)}</span>
          </>
        }
      >
        {offline ? <p className={styles.note}>{t('errors:image_offline')}</p> : null}
        <div className={styles.group}>
          <div inert={!info.autoEnabled || undefined}>
            <RadioGroup
              label={t('play:start.illustration.modeLabel')}
              appearance='segmented'
              value={choice.enabled ? 'enabled' : 'textOnly'}
              onValueChange={(value) => setChoice({ enabled: value === 'enabled' })}
              options={[
                { value: 'enabled', label: t('play:start.illustration.enabled') },
                { value: 'textOnly', label: t('play:start.illustration.textOnly') },
              ]}
            />
          </div>
          {!info.autoEnabled ? <p className={styles.note}>{t('play:start.illustration.autoOff')}</p> : null}
        </div>
        <div className={styles.group}>
          <StylePicker
            value={choice.style}
            onChange={(style) => setChoice({ style })}
            authorDefault={info.authorStyle}
          />
          <p className={styles.note}>{t('play:start.illustration.styleLocked')}</p>
          <StylePreview {...previewProps} />
        </div>
        <div className={styles.group}>
          {output.isPending ? <Skeleton variant='lines' count={2} /> : null}
          {output.error ? <ErrorNotice error={output.error} /> : null}
          {output.data ? (
            <>
              <RadioGroup
                label={t('play:format.aspect')}
                value={choice.aspectPreference}
                onValueChange={(value) => setChoice({ aspectPreference: value as AspectPreference })}
                options={[
                  { value: 'auto', label: t('play:format.automatic') },
                  ...aspectValues.map((value) => ({ value, label: value })),
                ]}
                appearance='segmented'
              />
              <RadioGroup
                label={t('play:format.tier')}
                value={choice.resolutionTier}
                onValueChange={(value) => setChoice({ resolutionTier: value as ImageTierPreference })}
                options={visibleTiers.map((entry) => {
                  const size = choice.aspectPreference === 'auto' ? undefined : entry.sizes[choice.aspectPreference];
                  return {
                    value: entry.tier,
                    label: size
                      ? `${t(IMAGE_TIER_LABEL_KEYS[entry.tier])} · ${dimensions(size)}`
                      : t(IMAGE_TIER_LABEL_KEYS[entry.tier]),
                  };
                })}
                appearance='segmented'
              />
              {visibleTiers.length === 1 ? <p className={styles.note}>{t('settings:output.onlyTier')}</p> : null}
              {!output.data.preferenceAvailable ? (
                <p className={styles.note}>{t('settings:output.unavailable')}</p>
              ) : null}
              {choice.aspectPreference === 'auto' ? (
                <Disclosure summary={t('settings:output.multipleSizes')} panelClassName={styles.sizes}>
                  <ul>
                    {output.data.tiers.map((entry) => (
                      <li key={entry.tier}>
                        <p className={styles.tierName}>{t(IMAGE_TIER_LABEL_KEYS[entry.tier])}</p>
                        <ul>
                          {Object.entries(entry.sizes).map(([ratio, size]) => (
                            <li key={ratio}>
                              {ratio} · {dimensions(size)}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              ) : null}
            </>
          ) : null}
        </div>
        <div className={styles.group}>
          <RadioGroup
            label={t('play:start.illustration.protagonistLabel')}
            appearance='segmented'
            value={choice.protagonistInFrame ? 'inFrame' : 'outOfFrame'}
            onValueChange={(value) => setChoice({ protagonistInFrame: value === 'inFrame' })}
            options={[
              { value: 'inFrame', label: t('play:start.illustration.inFrame') },
              { value: 'outOfFrame', label: t('play:start.illustration.outOfFrame') },
            ]}
          />
        </div>
        {choice.protagonistInFrame ? (
          <div className={styles.group}>
            <TextArea
              label={t('play:start.illustration.appearance')}
              value={choice.protagonistAppearance ?? ''}
              onValueChange={(value) => setChoice({ protagonistAppearance: sanitizeAppearance(value) })}
            />
            <div className={styles.actions}>
              <Button variant='secondary' busy={suggest.isPending} onClick={() => suggest.mutate()}>
                {t('play:start.illustration.suggest')}
              </Button>
              {suggest.isPending ? <GeneratingMarker label={t('play:start.illustration.suggesting')} /> : null}
            </div>
            <ErrorNotice error={suggest.error} />
            <PortraitSetEditor
              workId={workId}
              scope='pending'
              target={{ kind: 'protagonist' }}
              appearance={choice.protagonistAppearance}
              mode='player'
              onSnapshot={(setId) => setChoice({ protagonistSnapshotId: setId })}
            />
          </div>
        ) : null}
      </Disclosure>
    </div>
  );
}
