import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RouteView } from '@unwritten/contracts';

export interface Announcement {
  message: string;
  politeness: 'polite' | 'assertive';
  seq: number;
}

interface AnnouncedState {
  identity: string;
  message: string;
  politeness: 'polite' | 'assertive';
}

const NO_ANNOUNCEMENT: Announcement = { message: '', politeness: 'polite', seq: 0 };

function announcementFor(route: RouteView | undefined, t: (key: string) => string): AnnouncedState | null {
  const pending = route?.pending;
  if (pending?.status === 'running') {
    return {
      identity: `${pending.id}:${pending.attempts}:running`,
      message: t('play:pending.running'),
      politeness: 'polite',
    };
  }
  if (pending?.status === 'failed') {
    return {
      identity: `${pending.id}:${pending.attempts}:failed`,
      message: t('play:pending.failed'),
      politeness: 'assertive',
    };
  }
  const latest = route?.turns.at(-1);
  if (latest?.originRequest) {
    return {
      identity: `${latest.originRequest.id}:${latest.originRequest.attempt}:done`,
      message: t('play:pending.complete'),
      politeness: 'polite',
    };
  }
  return null;
}

export function useAnnouncement(route: RouteView | undefined): Announcement {
  const { t } = useTranslation();
  const next = announcementFor(route, t);
  const [announcement, setAnnouncement] = useState<Announcement>(NO_ANNOUNCEMENT);
  const announcedIdentity = useRef<string | null>(next?.identity ?? null);
  const sequence = useRef(0);

  useEffect(() => {
    if (!next || next.identity === announcedIdentity.current) return;
    announcedIdentity.current = next.identity;
    sequence.current += 1;
    setAnnouncement({ message: next.message, politeness: next.politeness, seq: sequence.current });
  }, [next]);

  return announcement;
}
