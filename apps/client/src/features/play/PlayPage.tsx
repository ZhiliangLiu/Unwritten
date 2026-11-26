import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { BookOpen, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StorySource, TurnRequestView } from '@unwritten/contracts';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { useFollowLatest } from '../../shared/hooks/useFollowLatest.ts';
import { readCssDuration } from '../../shared/lib/css-time.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { IconButton } from '../../shared/ui/IconButton.tsx';
import { LiveRegion } from '../../shared/ui/LiveRegion.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { ActionComposer } from './ActionComposer.tsx';
import { BackToLatest } from './BackToLatest.tsx';
import { FailedTurn } from './FailedTurn.tsx';
import { JournalSheet } from './JournalSheet.tsx';
import { OptionList } from './OptionList.tsx';
import { PendingTurn } from './PendingTurn.tsx';
import { ReplaceInputDialog } from './ReplaceInputDialog.tsx';
import { TurnArticle } from './TurnArticle.tsx';
import { paragraphAnchorId, turnHeadingId } from './anchors.ts';
import { useAnnouncement } from './useAnnouncement.ts';
import { usePlaySubmit } from './usePlaySubmit.ts';
import { useTurnVisibleSample } from './useTurnVisibleSample.ts';
import styles from './PlayPage.module.css';

interface ReplaceChoice {
  optionIndex: number;
  text: string;
}

export function PlayPage({ routeId }: { routeId: string }) {
  const api = useApi();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const actionsHeadingId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const actionSectionRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [jumpTarget, setJumpTarget] = useState<HTMLElement | null>(null);
  const previousLatestRef = useRef<string | null>(null);
  const highlightSeq = useRef(0);
  const [initialTurns, setInitialTurns] = useState<{ routeId: string; ids: Set<string> } | null>(null);
  const [text, setText] = useState('');
  const [journalOpen, setJournalOpen] = useState(false);
  const [replaceChoice, setReplaceChoice] = useState<ReplaceChoice | null>(null);
  const [dismissedFailureId, setDismissedFailureId] = useState<string | null>(null);
  const [focusInputSeq, setFocusInputSeq] = useState(0);
  const [highlight, setHighlight] = useState<{ id: string; seq: number } | null>(null);

  const route = useQuery({
    queryKey: queryKeys.route(routeId),
    queryFn: () => api.play.getRoute({ routeId }),
  });
  const followLatest = useFollowLatest({ contentRef, sentinelRef });
  const { submit, retry, startedAt, activeRequest } = usePlaySubmit({
    routeId,
    headTurnId: route.data?.headTurnId ?? null,
  });
  useTurnVisibleSample({ api, route: route.data, activeRequest, startedAt });
  const announcement = useAnnouncement(route.data);

  let initialTurnIds = initialTurns?.ids ?? null;
  if (route.data && initialTurns?.routeId !== route.data.id) {
    initialTurnIds = new Set(route.data.turns.map((turn) => turn.id));
    setInitialTurns({ routeId: route.data.id, ids: initialTurnIds });
  }

  const latest = route.data?.turns.at(-1);
  const latestTurnId = latest?.id ?? null;
  const pending = route.data?.pending ?? null;
  const running = pending?.status === 'running';
  const failed = pending?.status === 'failed' && pending.id !== dismissedFailureId ? pending : null;
  const requestInProgress = running || submit.isPending || retry.isPending;
  const showActions = Boolean(route.data) && !requestInProgress && !failed;

  useEffect(() => {
    if (focusInputSeq === 0) return;
    inputRef.current?.focus();
  }, [focusInputSeq]);

  useEffect(() => {
    if (!latestTurnId) return;
    const previous = previousLatestRef.current;
    previousLatestRef.current = latestTurnId;
    if (previous === null || previous === latestTurnId) return;
    if (!followLatest.atLatest) return;
    const section = actionSectionRef.current;
    if (section && section.contains(document.activeElement)) {
      document.getElementById(turnHeadingId(latestTurnId))?.focus();
    }
  }, [followLatest.atLatest, latestTurnId]);

  useEffect(() => {
    if (!highlight) return;
    const element = document.getElementById(highlight.id);
    if (!element) return;
    element.setAttribute('data-uw-changed', '');
    const timer = window.setTimeout(
      () => {
        element.removeAttribute('data-uw-changed');
      },
      readCssDuration('--uw-motion-duration-highlight', element),
    );
    return () => {
      window.clearTimeout(timer);
      element.removeAttribute('data-uw-changed');
    };
  }, [highlight]);

  const submitAction = (actionText: string, optionIndex: number | null) => {
    const trimmed = actionText.trim();
    if (!trimmed) return;
    submit.mutate({ text: trimmed, optionIndex }, { onSuccess: () => setText('') });
  };

  const selectOption = (index: number) => {
    const option = latest?.options[index - 1];
    if (!option) return;
    if (text.trim()) {
      setReplaceChoice({ optionIndex: index, text: option.text });
      return;
    }
    submitAction(option.text, index);
  };

  const openJournal = () => {
    setJumpTarget(null);
    setJournalOpen(true);
  };

  const closeReplace = () => {
    setReplaceChoice(null);
    inputRef.current?.focus();
  };

  const confirmReplace = () => {
    if (!replaceChoice) return;
    submitAction(replaceChoice.text, replaceChoice.optionIndex);
    setText('');
    setReplaceChoice(null);
  };

  const retryFailed = (request: TurnRequestView) => {
    retry.mutate({ requestId: request.id, attempts: request.attempts });
  };

  const rewriteFailed = (request: TurnRequestView) => {
    setDismissedFailureId(request.id);
    setText(request.action.text);
    setFocusInputSeq((seq) => seq + 1);
  };

  const jumpToSource = (source: StorySource) => {
    const targetId = paragraphAnchorId(source.turnId, source.para);
    const target = document.getElementById(targetId);
    if (!target) return;
    setJumpTarget(target);
    setJournalOpen(false);
    target.scrollIntoView({ block: 'center' });
    highlightSeq.current += 1;
    setHighlight({ id: targetId, seq: highlightSeq.current });
  };

  const backToLatest = () => {
    followLatest.scrollToLatest();
    if (latestTurnId) document.getElementById(turnHeadingId(latestTurnId))?.focus();
  };

  const latestArriving = Boolean(latest && initialTurnIds && !initialTurnIds.has(latest.id));

  return (
    <Page
      title={route.data?.workTitle?.trim() || t('play:page.untitled')}
      heading='toolbar'
      toolbar={{
        start: { kind: 'back', to: '/', label: t('common:nav.library') },
        tools: (
          <>
            <Button
              variant='text'
              size='sm'
              icon={BookOpen}
              aria-expanded={journalOpen}
              className={journalOpen ? styles.journalOpen : undefined}
              onClick={openJournal}
            >
              {t('play:journal.open')}
            </Button>
            <IconButton
              label={t('common:nav.settings')}
              icon={Settings}
              onClick={() => navigate({ to: '/settings' })}
            />
            {route.data && !followLatest.atLatest ? <BackToLatest onClick={backToLatest} /> : null}
          </>
        ),
      }}
      width='prose'
    >
      <div aria-hidden='true' className={styles.paper} />
      <div className={styles.reading}>
        <ErrorNotice error={route.error ?? submit.error ?? retry.error} />
        {!route.data && !route.error ? <Skeleton variant='prose' count={3} /> : null}
        {route.data ? (
          <>
            <div ref={contentRef} className={styles.content}>
              {route.data.turns.map((turn) => (
                <TurnArticle
                  key={turn.id}
                  turn={turn}
                  language={route.data.language}
                  arriving={Boolean(initialTurnIds && !initialTurnIds.has(turn.id))}
                />
              ))}
              {running && pending ? <PendingTurn action={pending.action} language={route.data.language} /> : null}
              {failed ? (
                <FailedTurn
                  request={failed}
                  language={route.data.language}
                  busy={retry.isPending}
                  onRetry={() => retryFailed(failed)}
                  onRewrite={() => rewriteFailed(failed)}
                />
              ) : null}
              <div ref={sentinelRef} />
            </div>
            {showActions ? (
              <section
                key={latestTurnId ?? 'actions'}
                ref={actionSectionRef}
                aria-labelledby={actionsHeadingId}
                data-uw-arriving={latestArriving ? '' : undefined}
                className={styles.actions}
              >
                <h2 id={actionsHeadingId} className={styles.actionsHeading}>
                  {t('play:action.heading')}
                </h2>
                {latest ? (
                  <OptionList
                    options={latest.options}
                    shortcutsEnabled={!replaceChoice && !journalOpen}
                    onSelect={selectOption}
                  />
                ) : null}
                <ActionComposer
                  value={text}
                  onValueChange={setText}
                  onSubmit={() => submitAction(text, null)}
                  disabled={requestInProgress}
                  inputRef={inputRef}
                />
              </section>
            ) : null}
          </>
        ) : null}
      </div>
      <LiveRegion key={announcement.seq} message={announcement.message} politeness={announcement.politeness} />
      <ReplaceInputDialog
        open={replaceChoice !== null}
        onOpenChange={(open) => {
          if (!open) closeReplace();
        }}
        onConfirm={confirmReplace}
      />
      <JournalSheet
        open={journalOpen}
        onOpenChange={setJournalOpen}
        routeId={routeId}
        onJump={jumpToSource}
        finalFocus={jumpTarget ? () => jumpTarget : undefined}
      />
    </Page>
  );
}
