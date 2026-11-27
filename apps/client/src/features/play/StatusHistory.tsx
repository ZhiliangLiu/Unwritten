import { useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StatusColumnView } from '@unwritten/contracts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { IconButton } from '../../shared/ui/IconButton.tsx';
import styles from './StatusHistory.module.css';

export function StatusHistory({
  column,
  onJumpToTurn,
}: {
  column: StatusColumnView;
  onJumpToTurn: (turnId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const jumping = useRef(false);
  const title = t('play:status.historyTitle', { label: column.label });

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) jumping.current = false;
        setOpen(next);
      }}
    >
      <Popover.Trigger className={styles.trigger} render={<IconButton label={title} icon={History} />} />
      <Popover.Portal>
        <Popover.Positioner side='bottom' align='start' className={styles.positioner}>
          <Popover.Popup finalFocus={() => !jumping.current} className={styles.popup}>
            <Popover.Title className={styles.title}>{title}</Popover.Title>
            <ol className={styles.entries}>
              {column.history.map((entry, index) => (
                <li key={entry.turnId} className={styles.entry}>
                  <span className={styles.entryHead}>
                    <span>
                      {entry.depth === 0
                        ? t('play:status.historyOpening')
                        : t('play:status.historyEntry', { depth: entry.depth })}
                    </span>
                    {index === column.history.length - 1 ? (
                      <Badge tone='neutral'>{t('play:status.historyCurrent')}</Badge>
                    ) : null}
                  </span>
                  <p className={styles.entryText}>{entry.text}</p>
                  <button
                    type='button'
                    className={styles.jump}
                    onClick={() => {
                      jumping.current = true;
                      setOpen(false);
                      onJumpToTurn(entry.turnId);
                    }}
                  >
                    {t('play:status.jump')}
                  </button>
                </li>
              ))}
            </ol>
            <p className={styles.note}>{t('play:status.historyNote')}</p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
