import { useState } from 'react';
import type { ComponentProps } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tabs } from '@base-ui/react/tabs';
import type { JournalSubject as JournalSubjectView, StorySource } from '@unwritten/contracts';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { EmptyState } from '../../shared/ui/EmptyState.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { SideSheet } from '../../shared/ui/SideSheet.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { JournalLineItem, JournalSubject } from './JournalSubject.tsx';
import styles from './JournalSheet.module.css';

type JournalTab = 'all' | 'character' | 'place' | 'item' | 'events';

const JOURNAL_TABS: Array<{ value: JournalTab; labelKey: string }> = [
  { value: 'all', labelKey: 'play:journal.tab.all' },
  { value: 'character', labelKey: 'play:journal.tab.character' },
  { value: 'place', labelKey: 'play:journal.tab.place' },
  { value: 'item', labelKey: 'play:journal.tab.item' },
  { value: 'events', labelKey: 'play:journal.tab.events' },
];

export function JournalSheet({
  open,
  onOpenChange,
  routeId,
  onJump,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routeId: string;
  onJump: (source: StorySource) => void;
  finalFocus: ComponentProps<typeof SideSheet>['finalFocus'];
}) {
  const api = useApi();
  const { t } = useTranslation();
  const [tab, setTab] = useState<JournalTab>('all');
  const journal = useQuery({
    queryKey: queryKeys.journal(routeId),
    queryFn: () => api.play.getJournal({ routeId }),
    enabled: open,
  });

  const renderSubjects = (subjects: JournalSubjectView[]) => (
    <ul className={styles.subjects}>
      {subjects.map((subject) => (
        <JournalSubject key={subject.entityId} subject={subject} onJump={onJump} />
      ))}
    </ul>
  );

  const renderTab = (value: JournalTab) => {
    if (!journal.data) return null;
    const subjects =
      value === 'all'
        ? journal.data.subjects
        : value === 'events'
          ? []
          : journal.data.subjects.filter((subject) => subject.kind === value);
    const events = journal.data.events;
    const showEvents = value === 'all' || value === 'events';
    const showSubjects = value !== 'events';
    const empty = (showSubjects ? subjects.length === 0 : true) && (showEvents ? events.length === 0 : true);

    if (empty) {
      return (
        <EmptyState
          headingLevel={3}
          title={t('play:journal.empty.heading')}
          description={t('play:journal.empty.description')}
        />
      );
    }

    return (
      <>
        {showSubjects && subjects.length > 0 ? renderSubjects(subjects) : null}
        {showEvents && events.length > 0 ? (
          <>
            {value === 'all' ? <h3 className={styles.groupHeading}>{t('play:journal.group.events')}</h3> : null}
            <ul className={styles.events}>
              {events.map((line) => (
                <JournalLineItem key={line.id} line={line} onJump={onJump} />
              ))}
            </ul>
          </>
        ) : null}
      </>
    );
  };

  return (
    <SideSheet open={open} onOpenChange={onOpenChange} title={t('play:journal.title')} finalFocus={finalFocus}>
      {journal.isLoading ? <Skeleton variant='lines' count={4} /> : null}
      {journal.error ? <ErrorNotice error={journal.error} /> : null}
      {journal.data ? (
        <Tabs.Root value={tab} onValueChange={(value) => setTab(value as JournalTab)}>
          <Tabs.List className={styles.tabs}>
            {JOURNAL_TABS.map((item) => (
              <Tabs.Tab key={item.value} value={item.value} className={styles.tab}>
                {t(item.labelKey)}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          {JOURNAL_TABS.map((item) => (
            <Tabs.Panel key={item.value} value={item.value} className={styles.panel}>
              {renderTab(item.value)}
            </Tabs.Panel>
          ))}
        </Tabs.Root>
      ) : null}
    </SideSheet>
  );
}
