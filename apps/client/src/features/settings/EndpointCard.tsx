import type { EndpointView, KeyChange, PurposeView } from '@unwritten/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { Button } from '../../shared/ui/Button.tsx';
import { Card } from '../../shared/ui/Card.tsx';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { OverflowMenu } from '../../shared/ui/OverflowMenu.tsx';
import { Select } from '../../shared/ui/Select.tsx';
import { TextField } from '../../shared/ui/TextField.tsx';
import { useNotify } from '../../shared/ui/Toaster.tsx';
import { beginEndpointEdit } from './endpoint-edit.ts';
import { PURPOSE_LABEL_KEYS } from './labels.ts';
import { ModelRow } from './ModelRow.tsx';
import styles from './EndpointCard.module.css';

const LIST_FORMAT = new Intl.ListFormat('zh-CN', { type: 'conjunction' });

export function EndpointCard({
  endpoint,
  purposes,
  revision,
  disabled,
}: {
  endpoint: EndpointView;
  purposes: PurposeView[];
  revision: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(endpoint.name);
  const [editKeyAction, setEditKeyAction] = useState<'keep' | 'set' | 'remove'>('keep');
  const [editKeyValue, setEditKeyValue] = useState('');
  const [newModelId, setNewModelId] = useState('');
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [deletingEndpoint, setDeletingEndpoint] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  function startEditing() {
    const next = beginEndpointEdit(endpoint);
    setEditName(next.name);
    setEditKeyAction(next.keyAction);
    setEditKeyValue(next.keyValue);
    setEditing(true);
  }

  function purposeList(names: string[]): string {
    return LIST_FORMAT.format(names);
  }

  const keyChange: KeyChange =
    editKeyAction === 'keep'
      ? { action: 'keep' }
      : editKeyAction === 'set'
        ? { action: 'set', value: editKeyValue }
        : { action: 'remove' };

  const update = useMutation({
    mutationFn: () =>
      api.llm.endpoints.update({
        baseRevision: revision,
        endpointId: endpoint.id,
        name: editName.trim(),
        key: keyChange,
      }),
    onSuccess: () => {
      setEditing(false);
      setEditKeyAction('keep');
      setEditKeyValue('');
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.llm });
    },
    onError: setActionError,
  });

  const addModel = useMutation({
    mutationFn: () =>
      api.llm.models.add({
        baseRevision: revision,
        endpointId: endpoint.id,
        modelId: newModelId.trim(),
      }),
    onSuccess: () => {
      setNewModelId('');
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.llm });
    },
    onError: setActionError,
  });

  const removeModel = useMutation({
    mutationFn: (modelId: string) =>
      api.llm.models.remove({
        baseRevision: revision,
        endpointId: endpoint.id,
        modelId,
      }),
    onSuccess: () => {
      setDeletingModelId(null);
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.llm });
    },
    onError: (error) => {
      setActionError(error);
      setDeletingModelId(null);
    },
  });

  const removeEndpoint = useMutation({
    mutationFn: () =>
      api.llm.endpoints.remove({
        baseRevision: revision,
        endpointId: endpoint.id,
      }),
    onSuccess: () => {
      setDeletingEndpoint(false);
      setActionError(null);
      notify({ title: t('settings:endpoint.deleted'), tone: 'success' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.llm });
    },
    onError: (error) => {
      setActionError(error);
      setDeletingEndpoint(false);
    },
  });

  const affectedByEndpoint = purposes.filter((purpose) => purpose.model?.endpointId === endpoint.id);
  const deletingModel = endpoint.models.find((model) => model.id === deletingModelId) ?? null;
  const affectedByModel = purposes.filter(
    (purpose) =>
      purpose.model?.endpointId === endpoint.id && deletingModel !== null && purpose.model.modelId === deletingModel.id,
  );
  const endpointDescription = [
    t('settings:endpoint.deleteDescription'),
    affectedByEndpoint.length > 0
      ? t('settings:endpoint.deleteAffects', {
          purposes: purposeList(affectedByEndpoint.map((purpose) => t(PURPOSE_LABEL_KEYS[purpose.purpose]))),
        })
      : null,
  ]
    .filter(Boolean)
    .join(' ');
  const modelDescription = [
    t('settings:model.deleteDescription'),
    affectedByModel.length > 0
      ? t('settings:endpoint.deleteAffects', {
          purposes: purposeList(affectedByModel.map((purpose) => t(PURPOSE_LABEL_KEYS[purpose.purpose]))),
        })
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  const keyBadge = endpoint.key.hasKey
    ? { tone: 'success' as const, label: t('settings:endpoint.keySet') }
    : endpoint.key.source === 'env'
      ? { tone: 'warning' as const, label: t('settings:endpoint.keyEnvMissing') }
      : { tone: 'neutral' as const, label: t('settings:endpoint.keyMissing') };

  return (
    <Card as='section'>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <div className={styles.titleRow}>
            <h4 className={styles.name}>{endpoint.name}</h4>
            <Badge tone={keyBadge.tone}>{keyBadge.label}</Badge>
          </div>
          <p className={styles.address}>{endpoint.baseUrl}</p>
        </div>
        <div className={styles.menu} inert={disabled || undefined}>
          <OverflowMenu
            label={t('settings:endpoint.more', { name: endpoint.name })}
            items={[
              { label: t('settings:endpoint.edit'), onSelect: startEditing },
              { label: t('settings:endpoint.delete'), onSelect: () => setDeletingEndpoint(true), tone: 'danger' },
            ]}
          />
        </div>
      </div>
      {editing ? (
        <div className={styles.edit}>
          <div className={styles.editFields}>
            <TextField
              label={t('settings:endpoint.name')}
              value={editName}
              onValueChange={setEditName}
              disabled={disabled}
            />
            <Select
              label={t('settings:endpoint.key')}
              value={editKeyAction}
              onValueChange={(value) => setEditKeyAction(value as 'keep' | 'set' | 'remove')}
              options={[
                { value: 'keep', label: t('settings:endpoint.keyKeep') },
                { value: 'set', label: t('settings:endpoint.keySetAction') },
                { value: 'remove', label: t('settings:endpoint.keyRemove') },
              ]}
              description={t('settings:endpoint.keyHelp')}
              disabled={disabled}
            />
            {editKeyAction === 'set' ? (
              <TextField
                label={t('settings:endpoint.keySetAction')}
                value={editKeyValue}
                onValueChange={setEditKeyValue}
                type='password'
                autoComplete='off'
                disabled={disabled}
              />
            ) : null}
          </div>
          <div className={styles.actions}>
            <Button
              variant='secondary'
              onClick={() => update.mutate()}
              disabled={disabled || editName.trim() === '' || (editKeyAction === 'set' && editKeyValue.trim() === '')}
              busy={update.isPending}
            >
              {t('settings:endpoint.save')}
            </Button>
            <Button variant='text' onClick={() => setEditing(false)}>
              {t('common:action.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
      <ul className={styles.models} aria-label={t('settings:model.heading')}>
        {endpoint.models.map((model) => (
          <li key={model.id} className={styles.modelItem}>
            <ModelRow
              endpointId={endpoint.id}
              model={model}
              revision={revision}
              canDelete={endpoint.models.length > 1}
              disabled={disabled}
              onDelete={() => setDeletingModelId(model.id)}
            />
          </li>
        ))}
      </ul>
      <div className={styles.addModel}>
        <TextField
          label={t('settings:model.newId')}
          value={newModelId}
          onValueChange={setNewModelId}
          disabled={disabled}
        />
        <Button
          variant='secondary'
          icon={Plus}
          onClick={() => addModel.mutate()}
          disabled={disabled || newModelId.trim() === ''}
          busy={addModel.isPending}
        >
          {t('settings:model.add')}
        </Button>
      </div>
      <ErrorNotice error={actionError} />
      <ConfirmDialog
        open={deletingModelId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingModelId(null);
        }}
        title={t('settings:model.deleteTitle', { id: deletingModel?.id ?? '' })}
        description={modelDescription}
        confirmLabel={t('settings:model.delete')}
        tone='danger'
        onConfirm={() => {
          if (deletingModel) removeModel.mutate(deletingModel.id);
        }}
        busy={removeModel.isPending}
      />
      <ConfirmDialog
        open={deletingEndpoint}
        onOpenChange={setDeletingEndpoint}
        title={t('settings:endpoint.deleteTitle', { name: endpoint.name })}
        description={endpointDescription}
        confirmLabel={t('settings:endpoint.delete')}
        tone='danger'
        onConfirm={() => removeEndpoint.mutate()}
        busy={removeEndpoint.isPending}
      />
    </Card>
  );
}
