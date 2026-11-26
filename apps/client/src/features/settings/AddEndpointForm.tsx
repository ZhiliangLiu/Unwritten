import type { LlmConfigView, TestConnectionResult } from '@unwritten/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Play, Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { Button } from '../../shared/ui/Button.tsx';
import { Card } from '../../shared/ui/Card.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import { TextField } from '../../shared/ui/TextField.tsx';
import styles from './AddEndpointForm.module.css';

function isPlainHttpToRemoteHost(baseUrl: string, apiKey: string): boolean {
  if (apiKey.trim() === '') return false;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:') return false;
  return !(
    url.hostname === 'localhost' ||
    url.hostname.startsWith('127.') ||
    url.hostname === '::1' ||
    url.hostname === '[::1]'
  );
}

export function AddEndpointForm({ config, disabled }: { config: LlmConfigView; disabled: boolean }) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [makeDefault, setMakeDefault] = useState(true);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  function reset() {
    setName('');
    setBaseUrl('');
    setModelId('');
    setApiKey('');
    setMakeDefault(true);
    setTestResult(null);
    setError(null);
  }

  const test = useMutation({
    mutationFn: () =>
      api.llm.test({
        baseUrl: baseUrl.trim(),
        modelId: modelId.trim(),
        key: apiKey.trim() ? { action: 'set', value: apiKey.trim() } : { action: 'none' },
      }),
    onSuccess: (result) => {
      setTestResult(result);
      setError(null);
    },
    onError: (mutationError) => {
      setTestResult(null);
      setError(mutationError);
    },
  });

  const create = useMutation({
    mutationFn: () =>
      api.llm.endpoints.create({
        requestId: crypto.randomUUID(),
        baseRevision: config.revision,
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        modelId: modelId.trim(),
        apiKey: apiKey.trim() || null,
        makeDefault,
      }),
    onSuccess: () => {
      reset();
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.llm });
    },
    onError: setError,
  });

  if (!open) {
    return (
      <Button variant='secondary' icon={Plus} onClick={() => setOpen(true)} disabled={disabled}>
        {t('settings:endpoint.add')}
      </Button>
    );
  }

  return (
    <Card as='section'>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <h3 className={styles.heading}>{t('settings:endpoint.add')}</h3>
        <TextField label={t('settings:endpoint.name')} value={name} onValueChange={setName} disabled={disabled} />
        <TextField
          label={t('settings:endpoint.address')}
          value={baseUrl}
          onValueChange={setBaseUrl}
          mono
          disabled={disabled}
        />
        <TextField
          label={t('settings:endpoint.modelId')}
          value={modelId}
          onValueChange={setModelId}
          mono
          disabled={disabled}
        />
        <TextField
          label={t('settings:endpoint.key')}
          value={apiKey}
          onValueChange={setApiKey}
          type='password'
          autoComplete='off'
          disabled={disabled}
        />
        {isPlainHttpToRemoteHost(baseUrl, apiKey) ? (
          <p className={styles.warning}>
            <span className={styles.warningIcon}>
              <Icon icon={TriangleAlert} size='sm' />
            </span>
            {t('settings:endpoint.httpWarning')}
          </p>
        ) : null}
        <label className={styles.checkbox}>
          <input
            type='checkbox'
            checked={makeDefault}
            onChange={(event) => setMakeDefault(event.target.checked)}
            disabled={disabled}
          />
          <span>{t('settings:endpoint.default')}</span>
        </label>
        {testResult ? (
          testResult.ok ? (
            <Badge tone='success' icon={CircleCheck}>
              {t('settings:endpoint.testOk')}
            </Badge>
          ) : (
            <ErrorNotice
              code={testResult.code ?? 'unknown'}
              detail={testResult.detail}
              diagnosticId={testResult.diagnosticId}
            />
          )
        ) : null}
        <div className={styles.actions}>
          <Button
            variant='secondary'
            icon={Play}
            onClick={() => test.mutate()}
            disabled={disabled || baseUrl.trim() === '' || modelId.trim() === ''}
            busy={test.isPending}
          >
            {test.isPending ? t('settings:endpoint.testing') : t('settings:endpoint.test')}
          </Button>
          <Button
            variant='secondary'
            type='submit'
            disabled={disabled || name.trim() === '' || baseUrl.trim() === '' || modelId.trim() === ''}
            busy={create.isPending}
          >
            {t('settings:endpoint.save')}
          </Button>
          <Button
            variant='text'
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            {t('common:action.cancel')}
          </Button>
        </div>
        <ErrorNotice error={error ?? create.error ?? test.error} />
      </form>
    </Card>
  );
}
