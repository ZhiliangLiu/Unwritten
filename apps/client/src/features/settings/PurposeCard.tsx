import type { EndpointView, GenerationParams, ModelRef, PurposeView, TestConnectionResult } from '@unwritten/contracts';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../shared/api/context.tsx';
import { errorCode } from '../../shared/api/errors.ts';
import { queryKeys } from '../../shared/api/query.ts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { Button } from '../../shared/ui/Button.tsx';
import { Card } from '../../shared/ui/Card.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { Select } from '../../shared/ui/Select.tsx';
import { GenerationParamsForm } from './GenerationParamsForm.tsx';
import { PROBLEM_LABEL_KEYS, PURPOSE_HELP_KEYS, PURPOSE_LABEL_KEYS } from './labels.ts';
import { formFromParams, paramsFromForm } from './params-form.ts';
import type { ParamsFormState } from './params-form.ts';
import styles from './PurposeCard.module.css';

const MODEL_VALUE_SEPARATOR = '\u0000';

function encodeModel(ref: ModelRef): string {
  return `${ref.endpointId}${MODEL_VALUE_SEPARATOR}${ref.modelId}`;
}

function decodeModel(value: string): ModelRef | null {
  const [endpointId, modelId] = value.split(MODEL_VALUE_SEPARATOR);
  if (!endpointId || !modelId) return null;
  return { endpointId, modelId };
}

export function PurposeCard({
  purpose,
  endpoints,
  revision,
  disabled,
}: {
  purpose: PurposeView;
  endpoints: EndpointView[];
  revision: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const serverModelValue = purpose.model ? encodeModel(purpose.model) : '';
  const serverForm = formFromParams(purpose.params);
  const [draft, setDraft] = useState<{ model: string; form: ParamsFormState } | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const selection = draft?.model ?? serverModelValue;
  const form = draft?.form ?? serverForm;
  const dirty = draft !== null;

  const modelOptions = endpoints.flatMap((endpoint) =>
    endpoint.models.map((model) => ({
      value: encodeModel({ endpointId: endpoint.id, modelId: model.id }),
      label: `${endpoint.name} · ${model.id}`,
    })),
  );
  if (purpose.purpose !== 'default') {
    modelOptions.unshift({ value: '', label: t('settings:purpose.useDefault') });
  }

  const selectedRef = selection === '' ? null : decodeModel(selection);
  const selectedEndpoint = selectedRef ? endpoints.find((endpoint) => endpoint.id === selectedRef.endpointId) : null;
  const selectedModel = selectedRef
    ? (selectedEndpoint?.models.find((model) => model.id === selectedRef.modelId) ?? null)
    : null;
  const useDefault = purpose.purpose !== 'default' && selection === '';
  const formDisabled = disabled || useDefault;

  function changeForm(next: ParamsFormState) {
    setDraft({ model: selection, form: next });
    setSaved(false);
    setError(null);
  }

  function changeModel(value: string) {
    setDraft({ model: value, form });
    setSaved(false);
    setError(null);
  }

  const save = useMutation({
    mutationFn: (input: { model: ModelRef | null; params: GenerationParams }) =>
      api.llm.purposes.set({
        baseRevision: revision,
        purpose: purpose.purpose,
        model: input.model,
        params: input.params,
      }),
    onSuccess: (data, input) => {
      setDraft((current) => {
        if (!current) return current;
        const submittedModel = input.model ? encodeModel(input.model) : '';
        const unchanged =
          current.model === submittedModel &&
          JSON.stringify(paramsFromForm(current.form)) === JSON.stringify(input.params);
        return unchanged ? null : current;
      });
      setSaved(true);
      setError(null);
      queryClient.setQueryData(queryKeys.llm, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.llm });
    },
    onError: (mutationError) => {
      setSaved(false);
      setError(mutationError);
      if (errorCode(mutationError) === 'config_conflict') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.llm });
      }
    },
  });

  const testPurpose = useMutation({
    mutationFn: () => api.llm.test({ purpose: purpose.purpose }),
    onSuccess: (result) => {
      setTestResult(result);
      setError(null);
    },
    onError: (mutationError) => {
      setTestResult(null);
      setError(mutationError);
    },
  });

  const effectiveEndpoint = purpose.effectiveModel
    ? endpoints.find((endpoint) => endpoint.id === purpose.effectiveModel?.endpointId)
    : null;

  return (
    <Card as='section'>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h3 className={styles.title}>{t(PURPOSE_LABEL_KEYS[purpose.purpose])}</h3>
          {purpose.inherited ? <Badge tone='neutral'>{t('settings:purpose.useDefault')}</Badge> : null}
          {purpose.problem ? (
            <Badge tone='warning' icon={TriangleAlert}>
              {t(PROBLEM_LABEL_KEYS[purpose.problem])}
            </Badge>
          ) : null}
        </div>
        <p className={styles.help}>{t(PURPOSE_HELP_KEYS[purpose.purpose])}</p>
        {purpose.effectiveModel ? (
          <p className={styles.current}>
            {effectiveEndpoint?.name ?? purpose.effectiveModel.endpointId} ·{' '}
            <span className={styles.mono}>{purpose.effectiveModel.modelId}</span>
          </p>
        ) : null}
      </div>
      <Select
        label={t('settings:purpose.model')}
        value={selection}
        onValueChange={changeModel}
        options={modelOptions}
        disabled={disabled}
      />
      <GenerationParamsForm form={form} onChange={changeForm} model={selectedModel} disabled={formDisabled} />
      {useDefault ? <p className={styles.inherited}>{t('settings:purpose.inheritedParams')}</p> : null}
      <div className={styles.actions}>
        <Button
          variant='secondary'
          onClick={() => save.mutate({ model: selectedRef, params: paramsFromForm(form) })}
          disabled={disabled}
          busy={save.isPending}
        >
          {t('settings:purpose.save')}
        </Button>
        <Button variant='text' onClick={() => testPurpose.mutate()} disabled={disabled} busy={testPurpose.isPending}>
          {t('settings:purpose.test')}
        </Button>
        {dirty ? (
          <span className={styles.status}>{t('settings:purpose.dirty')}</span>
        ) : saved ? (
          <span className={styles.status}>{t('settings:purpose.saved')}</span>
        ) : null}
      </div>
      {testResult ? (
        <div className={styles.testResult}>
          {testResult.ok ? (
            <Badge tone='success' icon={CircleCheck}>
              {t('settings:endpoint.testOk')}
            </Badge>
          ) : (
            <>
              <p className={styles.testError}>
                {t(`errors:${testResult.code ?? 'unknown'}`, { code: testResult.code })}
              </p>
              {testResult.detail ? <p className={styles.detail}>{testResult.detail}</p> : null}
            </>
          )}
        </div>
      ) : null}
      <ErrorNotice error={error} />
    </Card>
  );
}
