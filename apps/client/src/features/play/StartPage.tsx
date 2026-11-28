import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PROTAGONIST_VALUE_MAX_LENGTH } from '@unwritten/contracts';
import type { StartIllustrationInput } from '@unwritten/contracts';
import { useApi } from '../../shared/api/context.tsx';
import { errorCode } from '../../shared/api/errors.ts';
import { queryKeys } from '../../shared/api/query.ts';
import { Button, buttonClassName } from '../../shared/ui/Button.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { GeneratingMarker } from '../../shared/ui/GeneratingMarker.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { TextField } from '../../shared/ui/TextField.tsx';
import { WakePrompt } from '../../shared/ui/WakePrompt.tsx';
import { StartIllustrationPanel } from './StartIllustrationPanel.tsx';
import { initialChoice, toStartInput } from './start-illustration.ts';
import styles from './StartPage.module.css';

export function StartPage({ workId }: { workId: string }) {
  const api = useApi();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [playthroughId] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState<Record<string, string>>({});
  const [illustrationChoice, setIllustrationChoice] = useState<StartIllustrationInput | null>(null);

  const info = useQuery({
    queryKey: queryKeys.startInfo(workId),
    queryFn: () => api.play.getStartInfo({ workId }),
  });
  const imageConfig = useQuery({ queryKey: queryKeys.imageConfig, queryFn: () => api.image.services.list() });
  const fields = info.data?.fields ?? [];
  const illustrationInfo = info.data?.illustration ?? null;
  const illustration = illustrationInfo ? (illustrationChoice ?? initialChoice(illustrationInfo)) : null;
  const showsIllustration = illustrationInfo?.available === true;

  const start = useMutation({
    mutationFn: () =>
      api.play.start({
        workId,
        playthroughId,
        protagonist: Object.fromEntries(fields.map((field) => [field.name, values[field.name] ?? ''])),
        illustration:
          illustration && illustrationInfo ? toStartInput(illustration, illustrationInfo.authorStyle) : undefined,
      }),
    onSuccess: (playthrough) => {
      if (playthrough.routeId) {
        void navigate({ to: '/play/$routeId', params: { routeId: playthrough.routeId }, replace: true });
      } else {
        void navigate({
          to: '/playthroughs/$playthroughId',
          params: { playthroughId: playthrough.id },
          replace: true,
        });
      }
    },
  });

  const { isIdle, mutate } = start;
  useEffect(() => {
    if (!info.data || info.data.illustration.available || fields.length > 0 || !isIdle) return;
    mutate();
  }, [fields.length, info.data, isIdle, mutate]);

  const failure = start.error ?? info.error;

  return (
    <Page
      title={info.data?.title?.trim() || t('play:page.untitled')}
      heading='toolbar'
      toolbar={{ start: { kind: 'back', to: '/', label: t('common:nav.library') } }}
      width='prose'
    >
      <WakePrompt serviceId={imageConfig.data?.selectedServiceId ?? null} />
      <section className={styles.section}>
        <h2 className={styles.heading}>{t('play:start.heading')}</h2>
        <p className={styles.intro}>{t('play:start.intro')}</p>
        <ErrorNotice
          error={failure}
          action={
            errorCode(failure) === 'not_published' ? (
              <Link className={buttonClassName('text')} to='/'>
                {t('play:start.back')}
              </Link>
            ) : undefined
          }
        />
        {!info.data && !info.error ? <Skeleton variant='prose' count={2} /> : null}
        {start.isPending ? <GeneratingMarker label={t('play:start.opening')} /> : null}
        {fields.length > 0 || showsIllustration ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              start.mutate();
            }}
          >
            {fields.map((field) => (
              <TextField
                key={field.name}
                label={field.name}
                value={values[field.name] ?? ''}
                onValueChange={(value) =>
                  setValues((current) => ({
                    ...current,
                    [field.name]: value.slice(0, PROTAGONIST_VALUE_MAX_LENGTH),
                  }))
                }
                placeholder={field.defaultValue}
                description={t('play:start.fieldHelp', { value: field.defaultValue })}
              />
            ))}
            {illustrationInfo && illustration ? (
              <StartIllustrationPanel
                workId={workId}
                info={illustrationInfo}
                choice={illustration}
                onChange={setIllustrationChoice}
              />
            ) : null}
            <div className={styles.actions}>
              <Button type='submit' variant='primary' icon={Play} busy={start.isPending}>
                {t('play:start.submit')}
              </Button>
            </div>
          </form>
        ) : null}
      </section>
    </Page>
  );
}
