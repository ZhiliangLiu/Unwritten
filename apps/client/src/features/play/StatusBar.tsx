import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { StatusColumn } from './StatusColumn.tsx';
import styles from './StatusBar.module.css';

export function StatusBar({ routeId, onJumpToTurn }: { routeId: string; onJumpToTurn: (turnId: string) => void }) {
  const api = useApi();
  const { t } = useTranslation();
  const headingId = useId();
  const [closedOpen, setClosedOpen] = useState(false);
  const status = useQuery({
    queryKey: queryKeys.status(routeId),
    queryFn: () => api.play.getStatus({ routeId }),
  });

  if (!status.data) return null;
  const { columns, closed } = status.data;
  if (columns.length === 0 && closed.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className={styles.bar}>
      <h2 id={headingId} className={styles.heading}>
        {t('play:status.heading')}
      </h2>
      {columns.length === 0 ? null : (
        <dl className={styles.columns}>
          {columns.map((column) => (
            <StatusColumn key={column.id} column={column} onJumpToTurn={onJumpToTurn} />
          ))}
        </dl>
      )}
      {closed.length === 0 ? null : (
        <div className={styles.closed}>
          <button
            type='button'
            aria-expanded={closedOpen}
            className={styles.closedToggle}
            onClick={() => setClosedOpen((value) => !value)}
          >
            <span>
              <Icon icon={closedOpen ? ChevronDown : ChevronRight} size='sm' />
            </span>
            <span>
              {t('play:status.closed', {
                count: closed.length,
                labels: closed.map((column) => column.label).join('、'),
              })}
            </span>
          </button>
          {closedOpen ? (
            <dl className={styles.columns}>
              {closed.map((column) => (
                <StatusColumn key={column.id} column={column} onJumpToTurn={onJumpToTurn} />
              ))}
            </dl>
          ) : null}
        </div>
      )}
    </section>
  );
}
