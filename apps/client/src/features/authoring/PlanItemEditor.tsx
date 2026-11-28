import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ENTITY_KINDS,
  PLAN_ENTITY_ROLES,
  PlanItemSchema,
  STATE_DISPLAYS,
  APPEARANCE_MAX_LENGTH,
} from '@unwritten/contracts';
import type { EntityKind, PlanEntityRole, PlanItem, StateDisplay } from '@unwritten/contracts';
import { Button } from '../../shared/ui/Button.tsx';
import { NumberField } from '../../shared/ui/NumberField.tsx';
import { RadioGroup } from '../../shared/ui/RadioGroup.tsx';
import { Select } from '../../shared/ui/Select.tsx';
import { TextArea } from '../../shared/ui/TextArea.tsx';
import { TextField } from '../../shared/ui/TextField.tsx';
import { PLAN_ENTITY_KIND_LABEL_KEYS, PLAN_ENTITY_ROLE_LABEL_KEYS, STATE_DISPLAY_LABEL_KEYS } from './plan-labels.ts';
import styles from './PlanItemEditor.module.css';

type FormProps<T extends PlanItem> = {
  item: T;
  onSave: (item: PlanItem) => void;
  onCancel: () => void;
  onRemove?: () => void;
};

function CheckField({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className={styles.check}>
      <input
        id={id}
        type='checkbox'
        className={styles.checkbox}
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      <label className={styles.checkLabel} htmlFor={id}>
        {label}
      </label>
    </div>
  );
}

function Actions({ onSave, onCancel, onRemove }: { onSave: () => void; onCancel: () => void; onRemove?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.actions}>
      <Button variant='primary' onClick={onSave}>
        {t('authoring:plan.item.save')}
      </Button>
      <Button variant='secondary' onClick={onCancel}>
        {t('authoring:plan.item.cancel')}
      </Button>
      {onRemove ? (
        <Button variant='danger' onClick={onRemove}>
          {t('authoring:plan.item.remove')}
        </Button>
      ) : null}
    </div>
  );
}

function SummaryForm({ item, onSave, onCancel, onRemove }: FormProps<Extract<PlanItem, { kind: 'summary' }>>) {
  const { t } = useTranslation();
  const [text, setText] = useState(item.text);
  const [invalid, setInvalid] = useState(false);

  const save = () => {
    const next: PlanItem = { ...item, text };
    if (!PlanItemSchema.safeParse(next).success) {
      setInvalid(true);
      return;
    }
    onSave(next);
  };

  return (
    <>
      <TextArea
        label={t('authoring:plan.field.text')}
        value={text}
        onValueChange={setText}
        error={invalid ? t('authoring:plan.edit.invalid') : undefined}
        minRows={2}
      />
      <Actions onSave={save} onCancel={onCancel} onRemove={onRemove} />
    </>
  );
}

function EntityForm({ item, onSave, onCancel, onRemove }: FormProps<Extract<PlanItem, { kind: 'entity' }>>) {
  const { t } = useTranslation();
  const [name, setName] = useState(item.name);
  const [knownAs, setKnownAs] = useState(item.knownAs ?? '');
  const [profile, setProfile] = useState(item.profile);
  const [appearance, setAppearance] = useState(item.appearance ?? '');
  const [entityKind, setEntityKind] = useState<EntityKind>(item.entityKind);
  const [role, setRole] = useState<PlanEntityRole>(item.role);
  const [slotRole, setSlotRole] = useState(item.slot?.role ?? '');
  const [encounter, setEncounter] = useState(item.slot?.encounter ?? '');
  const [invalid, setInvalid] = useState(false);
  const hasSlot = slotRole.trim().length > 0 || encounter.trim().length > 0;

  const save = () => {
    const next: PlanItem = {
      ...item,
      name,
      knownAs: knownAs.trim().length > 0 ? knownAs : null,
      profile,
      entityKind,
      role,
      appearance: appearance.trim().length > 0 ? appearance : null,
      slot: hasSlot ? { role: slotRole, encounter } : null,
    };
    if (!PlanItemSchema.safeParse(next).success) {
      setInvalid(true);
      return;
    }
    onSave(next);
  };

  return (
    <>
      <TextField
        label={t('authoring:plan.field.name')}
        value={name}
        onValueChange={setName}
        error={invalid ? t('authoring:plan.edit.invalid') : undefined}
      />
      <TextField label={t('authoring:plan.field.knownAs')} value={knownAs} onValueChange={setKnownAs} />
      <TextArea label={t('authoring:plan.field.profile')} value={profile} onValueChange={setProfile} minRows={2} />
      {entityKind === 'character' ? (
        <TextArea
          label={t('authoring:plan.appearance')}
          description={t('authoring:plan.appearanceHint')}
          value={appearance}
          onValueChange={(value) => setAppearance(value.slice(0, APPEARANCE_MAX_LENGTH))}
          minRows={1}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault();
          }}
        />
      ) : null}
      <Select
        label={t('authoring:plan.field.entityKind')}
        value={entityKind}
        onValueChange={(value) => setEntityKind(value as EntityKind)}
        options={ENTITY_KINDS.map((kind) => ({
          value: kind,
          label: t(PLAN_ENTITY_KIND_LABEL_KEYS[kind]),
        }))}
      />
      <RadioGroup
        label={t('authoring:plan.field.role')}
        orientation='horizontal'
        value={role}
        onValueChange={(value) => setRole(value as PlanEntityRole)}
        options={PLAN_ENTITY_ROLES.map((value) => ({
          value,
          label: t(PLAN_ENTITY_ROLE_LABEL_KEYS[value]),
        }))}
      />
      <TextField label={t('authoring:plan.field.slotRole')} value={slotRole} onValueChange={setSlotRole} />
      <TextArea
        label={t('authoring:plan.field.encounter')}
        value={encounter}
        onValueChange={setEncounter}
        minRows={2}
      />
      <Actions onSave={save} onCancel={onCancel} onRemove={onRemove} />
    </>
  );
}

function SecretForm({ item, onSave, onCancel, onRemove }: FormProps<Extract<PlanItem, { kind: 'secret' }>>) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(item.title);
  const [statement, setStatement] = useState(item.statement);
  const [reveal, setReveal] = useState(item.reveal);
  const [invalid, setInvalid] = useState(false);

  const save = () => {
    const next: PlanItem = { ...item, title, statement, reveal };
    if (!PlanItemSchema.safeParse(next).success) {
      setInvalid(true);
      return;
    }
    onSave(next);
  };

  return (
    <>
      <TextField
        label={t('authoring:plan.field.title')}
        value={title}
        onValueChange={setTitle}
        error={invalid ? t('authoring:plan.edit.invalid') : undefined}
      />
      <TextArea
        label={t('authoring:plan.field.statement')}
        value={statement}
        onValueChange={setStatement}
        minRows={2}
      />
      <TextArea label={t('authoring:plan.field.reveal')} value={reveal} onValueChange={setReveal} minRows={2} />
      <Actions onSave={save} onCancel={onCancel} onRemove={onRemove} />
    </>
  );
}

function StateForm({ item, onSave, onCancel, onRemove }: FormProps<Extract<PlanItem, { kind: 'state' }>>) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(item.label);
  const [display, setDisplay] = useState<StateDisplay>(item.display);
  const [min, setMin] = useState<number | null>(item.config.min);
  const [max, setMax] = useState<number | null>(item.config.max);
  const [unit, setUnit] = useState(item.config.unit ?? '');
  const [stages, setStages] = useState(item.config.stages.join('|'));
  const [hidden, setHidden] = useState(item.hidden);
  const [reveal, setReveal] = useState(item.reveal);
  const [initial, setInitial] = useState(item.initial ?? '');
  const [invalid, setInvalid] = useState(false);

  const save = () => {
    const next: PlanItem = {
      ...item,
      label,
      display,
      config: {
        min,
        max,
        unit: unit.trim().length > 0 ? unit : null,
        stages: stages
          .split('|')
          .map((stage) => stage.trim())
          .filter((stage) => stage.length > 0),
      },
      hidden,
      reveal,
      initial: initial.trim().length > 0 ? initial : null,
    };
    if (!PlanItemSchema.safeParse(next).success) {
      setInvalid(true);
      return;
    }
    onSave(next);
  };

  return (
    <>
      <TextField
        label={t('authoring:plan.field.label')}
        value={label}
        onValueChange={setLabel}
        error={invalid ? t('authoring:plan.edit.invalid') : undefined}
      />
      <Select
        label={t('authoring:plan.field.display')}
        value={display}
        onValueChange={(value) => setDisplay(value as StateDisplay)}
        options={STATE_DISPLAYS.map((value) => ({
          value,
          label: t(STATE_DISPLAY_LABEL_KEYS[value]),
        }))}
      />
      <div className={styles.row}>
        <NumberField label={t('authoring:plan.field.min')} value={min} onValueChange={setMin} />
        <NumberField label={t('authoring:plan.field.max')} value={max} onValueChange={setMax} />
        <TextField label={t('authoring:plan.field.unit')} value={unit} onValueChange={setUnit} />
      </div>
      <TextField label={t('authoring:plan.field.stages')} value={stages} onValueChange={setStages} />
      <TextField label={t('authoring:plan.field.initial')} value={initial} onValueChange={setInitial} />
      <TextArea label={t('authoring:plan.field.reveal')} value={reveal} onValueChange={setReveal} minRows={2} />
      <CheckField label={t('authoring:plan.field.hidden')} checked={hidden} onCheckedChange={setHidden} />
      <Actions onSave={save} onCancel={onCancel} onRemove={onRemove} />
    </>
  );
}

function SceneForm({ item, onSave, onCancel, onRemove }: FormProps<Extract<PlanItem, { kind: 'scene' }>>) {
  const { t } = useTranslation();
  const [condition, setCondition] = useState(item.condition);
  const [outcome, setOutcome] = useState(item.outcome);
  const [once, setOnce] = useState(item.once);
  const [invalid, setInvalid] = useState(false);

  const save = () => {
    const next: PlanItem = { ...item, condition, outcome, once };
    if (!PlanItemSchema.safeParse(next).success) {
      setInvalid(true);
      return;
    }
    onSave(next);
  };

  return (
    <>
      <TextArea
        label={t('authoring:plan.field.condition')}
        value={condition}
        onValueChange={setCondition}
        error={invalid ? t('authoring:plan.edit.invalid') : undefined}
        minRows={2}
      />
      <TextArea label={t('authoring:plan.field.outcome')} value={outcome} onValueChange={setOutcome} minRows={2} />
      <CheckField label={t('authoring:plan.field.once')} checked={once} onCheckedChange={setOnce} />
      <Actions onSave={save} onCancel={onCancel} onRemove={onRemove} />
    </>
  );
}

function EndingForm({ item, onSave, onCancel, onRemove }: FormProps<Extract<PlanItem, { kind: 'ending' }>>) {
  const { t } = useTranslation();
  const [text, setText] = useState(item.text);
  const [invalid, setInvalid] = useState(false);

  const save = () => {
    const next: PlanItem = { ...item, text };
    if (!PlanItemSchema.safeParse(next).success) {
      setInvalid(true);
      return;
    }
    onSave(next);
  };

  return (
    <>
      <TextArea
        label={t('authoring:plan.field.text')}
        value={text}
        onValueChange={setText}
        error={invalid ? t('authoring:plan.edit.invalid') : undefined}
        minRows={2}
      />
      <Actions onSave={save} onCancel={onCancel} onRemove={onRemove} />
    </>
  );
}

export function PlanItemEditor({
  item,
  onSave,
  onCancel,
  onRemove,
}: {
  item: PlanItem;
  onSave: (item: PlanItem) => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const remove = item.kind === 'entity' && item.role === 'protagonist' ? undefined : onRemove;
  const form =
    item.kind === 'summary' ? (
      <SummaryForm item={item} onSave={onSave} onCancel={onCancel} onRemove={remove} />
    ) : item.kind === 'entity' ? (
      <EntityForm item={item} onSave={onSave} onCancel={onCancel} onRemove={remove} />
    ) : item.kind === 'secret' ? (
      <SecretForm item={item} onSave={onSave} onCancel={onCancel} onRemove={remove} />
    ) : item.kind === 'state' ? (
      <StateForm item={item} onSave={onSave} onCancel={onCancel} onRemove={remove} />
    ) : item.kind === 'scene' ? (
      <SceneForm item={item} onSave={onSave} onCancel={onCancel} onRemove={remove} />
    ) : (
      <EndingForm item={item} onSave={onSave} onCancel={onCancel} onRemove={remove} />
    );

  return <div className={styles.editor}>{form}</div>;
}
