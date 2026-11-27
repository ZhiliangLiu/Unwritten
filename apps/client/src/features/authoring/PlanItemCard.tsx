import { Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PlanItem } from '@unwritten/contracts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { IconButton } from '../../shared/ui/IconButton.tsx';
import { PlanItemEditor } from './PlanItemEditor.tsx';
import {
  PLAN_ENTITY_KIND_LABEL_KEYS,
  PLAN_ENTITY_ROLE_LABEL_KEYS,
  PLAN_SOURCE_LABEL_KEYS,
  PLAN_SUMMARY_LABEL_KEYS,
  STATE_DISPLAY_LABEL_KEYS,
} from './plan-labels.ts';
import { PlaceholderText } from './placeholder-text.tsx';
import styles from './PlanItemCard.module.css';

export function PlanItemCard({
  item,
  knowerNames,
  editing,
  onEdit,
  onCancel,
  onSave,
  onRemove,
}: {
  item: PlanItem;
  knowerNames: string[];
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (item: PlanItem) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();

  const title =
    item.kind === 'summary'
      ? t(PLAN_SUMMARY_LABEL_KEYS[item.key])
      : item.kind === 'entity'
        ? `${item.name} · ${
            item.role === 'other'
              ? t(PLAN_ENTITY_KIND_LABEL_KEYS[item.entityKind])
              : t(PLAN_ENTITY_ROLE_LABEL_KEYS[item.role])
          }`
        : item.kind === 'secret'
          ? t('authoring:plan.secret.titleLine', { title: item.title })
          : item.kind === 'state'
            ? `${item.label} · ${t(STATE_DISPLAY_LABEL_KEYS[item.display])}`
            : item.kind === 'scene'
              ? item.once
                ? t('authoring:plan.scene.once')
                : t('authoring:plan.scene.repeat')
              : t('authoring:plan.group.ending');

  const body =
    item.kind === 'summary' ? (
      <p className={styles.text}>
        <PlaceholderText text={item.text} />
      </p>
    ) : item.kind === 'entity' ? (
      <>
        {item.knownAs ? (
          <p className={styles.text}>{t('authoring:plan.entity.knownAs', { name: item.knownAs })}</p>
        ) : null}
        {item.slot ? <p className={styles.text}>{t('authoring:plan.entity.slot', { role: item.slot.role })}</p> : null}
        {item.slot ? (
          <p className={styles.text}>{t('authoring:plan.entity.encounter', { text: item.slot.encounter })}</p>
        ) : null}
        {item.profile ? (
          <p className={styles.text}>
            <PlaceholderText text={item.profile} />
          </p>
        ) : null}
      </>
    ) : item.kind === 'secret' ? (
      <>
        <p className={styles.text}>{t('authoring:plan.secret.statement', { text: item.statement })}</p>
        {knowerNames.length > 0 ? (
          <p className={styles.text}>{t('authoring:plan.secret.knowers', { names: knowerNames.join('、') })}</p>
        ) : null}
        {item.reveal ? <p className={styles.text}>{t('authoring:plan.secret.reveal', { text: item.reveal })}</p> : null}
      </>
    ) : item.kind === 'state' ? (
      <>
        {item.config.min !== null && item.config.max !== null ? (
          <p className={styles.text}>
            {t('authoring:plan.state.range', { min: item.config.min, max: item.config.max })}
          </p>
        ) : null}
        {item.config.unit ? (
          <p className={styles.text}>{t('authoring:plan.state.unit', { unit: item.config.unit })}</p>
        ) : null}
        {item.config.stages.length > 0 ? (
          <p className={styles.text}>{t('authoring:plan.state.stages', { stages: item.config.stages.join('、') })}</p>
        ) : null}
        {item.initial !== null ? (
          <p className={styles.text}>{t('authoring:plan.state.initial', { value: item.initial })}</p>
        ) : null}
      </>
    ) : item.kind === 'scene' ? (
      <>
        <p className={styles.text}>
          <PlaceholderText text={item.condition} />
        </p>
        <p className={styles.text}>
          <PlaceholderText text={item.outcome} />
        </p>
      </>
    ) : (
      <p className={styles.text}>
        <PlaceholderText text={item.text} />
      </p>
    );

  return (
    <li className={styles.item}>
      {editing ? (
        <PlanItemEditor item={item} onSave={onSave} onCancel={onCancel} onRemove={onRemove} />
      ) : (
        <>
          <div className={styles.head}>
            <p className={styles.title}>
              <span>{title}</span>
              <Badge tone='neutral'>{t(PLAN_SOURCE_LABEL_KEYS[item.source])}</Badge>
              {item.kind === 'state' && item.hidden ? (
                <Badge tone='neutral'>{t('authoring:plan.state.hidden')}</Badge>
              ) : null}
            </p>
            <IconButton label={t('authoring:plan.item.editLabel', { title })} icon={Pencil} onClick={onEdit} />
          </div>
          <div className={styles.body}>{body}</div>
        </>
      )}
    </li>
  );
}
