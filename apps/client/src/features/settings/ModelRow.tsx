import { THINKING_FORMATS } from '@unwritten/contracts';
import type { ModelCapabilities } from '@unwritten/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { Button } from '../../shared/ui/Button.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { RadioGroup } from '../../shared/ui/RadioGroup.tsx';
import { Select } from '../../shared/ui/Select.tsx';
import { THINKING_FORMAT_LABEL_KEYS } from './labels.ts';
import styles from './ModelRow.module.css';

function reasoningToValue(reasoning: boolean | null): string {
  if (reasoning === true) return 'yes';
  if (reasoning === false) return 'no';
  return 'unknown';
}

function valueToReasoning(value: string): boolean | null {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

export function ModelRow({
  endpointId,
  model,
  revision,
  canDelete,
  disabled,
  onDelete,
}: {
  endpointId: string;
  model: ModelCapabilities;
  revision: string;
  canDelete: boolean;
  disabled: boolean;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();

  const update = useMutation({
    mutationFn: (input: { reasoning: boolean | null; thinkingFormat: ModelCapabilities['thinkingFormat'] }) =>
      api.llm.models.update({
        baseRevision: revision,
        endpointId,
        modelId: model.id,
        reasoning: input.reasoning,
        thinkingFormat: input.thinkingFormat,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.llm });
    },
  });

  const capabilityOptions = [
    { value: 'yes', label: t('settings:model.capability.yes') },
    { value: 'no', label: t('settings:model.capability.no') },
    { value: 'unknown', label: t('settings:model.capability.unknown') },
  ];
  const thinkingFormatOptions = THINKING_FORMATS.map((format) => ({
    value: format,
    label: t(THINKING_FORMAT_LABEL_KEYS[format]),
  }));
  const toolsLabel =
    model.tools === true
      ? t('settings:model.capability.yes')
      : model.tools === false
        ? t('settings:model.capability.no')
        : t('settings:model.capability.unknown');

  return (
    <div className={styles.row}>
      <div className={styles.header}>
        <span className={styles.modelId}>{model.id}</span>
        <span className={styles.tools}>
          <span>{t('settings:model.tools')}</span>
          <Badge tone={model.tools === true ? 'success' : model.tools === false ? 'danger' : 'neutral'}>
            {toolsLabel}
          </Badge>
        </span>
        <Button variant='text' size='sm' onClick={onDelete} disabled={disabled || !canDelete} className={styles.delete}>
          {t('settings:model.delete')}
        </Button>
      </div>
      <div className={styles.fields} inert={disabled || update.isPending || undefined}>
        <RadioGroup
          label={t('settings:model.reasoning')}
          value={reasoningToValue(model.reasoning)}
          onValueChange={(value) =>
            update.mutate({ reasoning: valueToReasoning(value), thinkingFormat: model.thinkingFormat })
          }
          options={capabilityOptions}
          orientation='horizontal'
          appearance='segmented'
        />
        <Select
          label={t('settings:model.thinkingFormat')}
          value={model.thinkingFormat}
          onValueChange={(value) =>
            update.mutate({ reasoning: model.reasoning, thinkingFormat: value as ModelCapabilities['thinkingFormat'] })
          }
          options={thinkingFormatOptions}
          disabled={disabled || update.isPending}
        />
      </div>
      {!canDelete ? <p className={styles.lastModel}>{t('settings:model.lastModel')}</p> : null}
      <ErrorNotice error={update.error} />
    </div>
  );
}
