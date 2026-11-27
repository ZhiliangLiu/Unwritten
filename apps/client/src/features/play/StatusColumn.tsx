import { Circle, CircleCheck, CircleX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StatusColumnView } from '@unwritten/contracts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden.tsx';
import { StatusHistory } from './StatusHistory.tsx';
import styles from './StatusColumn.module.css';

declare module 'react' {
  interface CSSProperties {
    '--status-ratio'?: string;
  }
}

type StatusValue = StatusColumnView['value'];

const LIST_STATUS = {
  open: { icon: Circle, labelKey: 'play:status.item.open' },
  done: { icon: CircleCheck, labelKey: 'play:status.item.done' },
  failed: { icon: CircleX, labelKey: 'play:status.item.failed' },
} as const;

function NumberValue({ value, label }: { value: Extract<StatusValue, { display: 'number' }>; label: string }) {
  const { t } = useTranslation();
  const delta = value.previous === null ? 0 : value.value - value.previous;
  const deltaLabel =
    delta > 0 ? t('play:status.increase', { delta }) : delta < 0 ? t('play:status.decrease', { delta: -delta }) : null;
  const { min, max } = value;
  const hasRange = min !== null && max !== null;
  const ratio = hasRange ? Math.min(1, Math.max(0, (value.value - min) / (max - min))) : 0;
  const valueText = value.unit === null ? undefined : `${value.value}${value.unit}`;

  return (
    <>
      <span className={styles.number}>
        <span className={styles.numberValue}>
          {value.value}
          {value.unit}
        </span>
        {max === null ? null : <span className={styles.muted}>{t('play:status.ofMax', { max })}</span>}
        {deltaLabel === null ? null : <span className={styles.delta}>{deltaLabel}</span>}
      </span>
      {hasRange ? (
        <span className={styles.meter} style={{ '--status-ratio': `${ratio * 100}%` }}>
          <VisuallyHidden>
            <meter
              aria-label={label}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={value.value}
              aria-valuetext={valueText}
              min={min}
              max={max}
              value={value.value}
            />
          </VisuallyHidden>
          <span aria-hidden='true' className={styles.meterFill} />
        </span>
      ) : null}
    </>
  );
}

function StageValue({ value }: { value: Extract<StatusValue, { display: 'stage' }> }) {
  const { t } = useTranslation();

  return (
    <>
      <span className={styles.stage}>
        <span className={styles.stageName}>{value.stage}</span>
        <span className={styles.muted}>{t('play:status.step', { step: value.step, total: value.total })}</span>
      </span>
      {value.previousStep === null || value.previousStep === value.step ? null : (
        <span className={styles.previous}>{t('play:status.previousStep', { step: value.previousStep })}</span>
      )}
      <span aria-hidden='true' className={styles.segments}>
        {Array.from({ length: value.total }, (_, index) => (
          <span
            key={index}
            className={index < value.step ? `${styles.segment} ${styles.segmentFilled}` : styles.segment}
          />
        ))}
      </span>
    </>
  );
}

function ListValue({ value }: { value: Extract<StatusValue, { display: 'list' }> }) {
  const { t } = useTranslation();

  return (
    <ul className={styles.list}>
      {value.items.map((item) => {
        const status = LIST_STATUS[item.status];
        const changed = item.change === 'changed';
        return (
          <li key={item.item} className={changed ? `${styles.item} ${styles.itemChanged}` : styles.item}>
            <Icon icon={status.icon} size='sm' />
            <span className={styles.itemText}>{item.item}</span>
            {item.change === 'new' ? (
              <Badge tone='neutral'>{t('play:status.item.new')}</Badge>
            ) : changed ? (
              <Badge tone='neutral'>{t('play:status.item.changed')}</Badge>
            ) : null}
            {item.status === 'open' ? (
              <VisuallyHidden>{t('play:status.item.open')}</VisuallyHidden>
            ) : (
              <span className={styles.itemStatus}>{t(status.labelKey)}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TextValue({ value }: { value: Extract<StatusValue, { display: 'text' }> }) {
  const { t } = useTranslation();

  return (
    <>
      <p className={styles.text}>{value.value}</p>
      {value.previous === null || value.previous === value.value ? null : (
        <p className={styles.previous}>{t('play:status.previousText', { text: value.previous })}</p>
      )}
    </>
  );
}

export function StatusColumn({
  column,
  onJumpToTurn,
}: {
  column: StatusColumnView;
  onJumpToTurn: (turnId: string) => void;
}) {
  const { t } = useTranslation();
  const wide = column.value.display === 'stage' || column.value.display === 'list';
  const className = [styles.column, wide ? styles.wide : null, column.changed ? styles.changed : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className}>
      <dt className={styles.term}>
        <span className={styles.label}>{column.label}</span>
        {column.isNew ? <Badge tone='neutral'>{t('play:status.new')}</Badge> : null}
        {column.history.length > 0 ? <StatusHistory column={column} onJumpToTurn={onJumpToTurn} /> : null}
      </dt>
      <dd className={styles.value}>
        {column.value.display === 'number' ? <NumberValue value={column.value} label={column.label} /> : null}
        {column.value.display === 'stage' ? <StageValue value={column.value} /> : null}
        {column.value.display === 'list' ? <ListValue value={column.value} /> : null}
        {column.value.display === 'text' ? <TextValue value={column.value} /> : null}
      </dd>
    </div>
  );
}
