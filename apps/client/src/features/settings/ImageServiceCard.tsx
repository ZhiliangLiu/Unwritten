import type {
  ImageCapabilities,
  ImageProtocol,
  ImageServiceView,
  KeyChange,
  KeyStatus,
  LauncherChange,
  LauncherState,
  OpenAiSizeMode,
  TestImageServiceResult,
} from '@unwritten/contracts';
import { IDLE_MINUTES_MAX, IDLE_MINUTES_MIN } from '@unwritten/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { formatRelative } from '../../shared/lib/format.ts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { Button } from '../../shared/ui/Button.tsx';
import { Card } from '../../shared/ui/Card.tsx';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { NumberField } from '../../shared/ui/NumberField.tsx';
import { Select } from '../../shared/ui/Select.tsx';
import { TextField } from '../../shared/ui/TextField.tsx';
import { prefillOpenAiOptions, OPENAI_REFERENCE_LIMIT } from './openai-prefill.ts';
import { TokenReveal } from './TokenReveal.tsx';
import styles from './ImageServiceCard.module.css';

const PROTOCOL_LABEL_KEYS: Record<ImageProtocol, string> = {
  'unwritten-image': 'settings:images.protocol.unwritten-image',
  'openai-images': 'settings:images.protocol.openai-images',
};

export const LAUNCHER_STATE_LABEL_KEYS: Record<LauncherState, string> = {
  stopped: 'settings:images.launcherState.stopped',
  starting: 'settings:images.launcherState.starting',
  needs_action: 'settings:images.launcherState.needs_action',
  running: 'settings:images.launcherState.running',
  stopping: 'settings:images.launcherState.stopping',
  failed: 'settings:images.launcherState.failed',
};

const SIZE_MODE_LABEL_KEYS: Record<OpenAiSizeMode, string> = {
  fixed: 'settings:images.sizeModes.fixed',
  custom: 'settings:images.sizeModes.custom',
};

const NOT_READY_REASON_KEYS: Record<string, string> = {
  starting: 'settings:images.notReady.starting',
  out_of_memory: 'settings:images.notReady.out_of_memory',
  workflow_error: 'settings:images.notReady.workflow_error',
};

function notReadyReasonKey(reason: string | null): string {
  return (reason ? NOT_READY_REASON_KEYS[reason] : undefined) ?? 'settings:images.notReady.other';
}

function CapabilitySummary({ capabilities }: { capabilities: ImageCapabilities }) {
  const { t } = useTranslation();
  return (
    <p className={styles.notice}>
      {[
        capabilities.maxReferences === 0
          ? t('settings:images.noReferences')
          : t('settings:images.references', { count: capabilities.maxReferences }),
        capabilities.negativePrompt ? t('settings:images.negativeSupported') : t('settings:images.negativeUnsupported'),
      ].join(t('settings:images.separator'))}
    </p>
  );
}

function keyBadge(key: KeyStatus): { tone: 'success' | 'warning' | 'neutral'; labelKey: string } {
  if (key.hasKey) return { tone: 'success', labelKey: 'settings:endpoint.keySet' };
  if (key.source === 'env') return { tone: 'warning', labelKey: 'settings:endpoint.keyEnvMissing' };
  return { tone: 'neutral', labelKey: 'settings:endpoint.keyMissing' };
}

function TestServiceResult({ result }: { result: TestImageServiceResult }) {
  const { t } = useTranslation();
  if (!result.ok) return <ErrorNotice code={result.code ?? 'unknown'} />;
  const service = result.service;
  return (
    <div className={styles.result}>
      {result.generated ? (
        <Badge tone='success'>
          {t('settings:images.testImageDone', { width: result.generated.width, height: result.generated.height })}
        </Badge>
      ) : service ? (
        <Badge tone={service.ready ? 'success' : 'warning'}>
          {service.ready ? t('settings:images.testReady') : t('settings:images.testNotReady')}
        </Badge>
      ) : (
        <Badge tone='success'>{t('settings:images.testReady')}</Badge>
      )}
      {service && !service.ready ? <p>{t(notReadyReasonKey(service.notReadyReason))}</p> : null}
      {service?.implementation ? (
        <p className={styles.implementation}>
          <bdi>
            {service.implementation.name} {service.implementation.version}
          </bdi>
        </p>
      ) : null}
      {service?.model ? (
        <p className={styles.implementation}>
          <bdi>{service.model}</bdi>
        </p>
      ) : null}
      {service?.capabilities ? <CapabilitySummary capabilities={service.capabilities} /> : null}
    </div>
  );
}

function TestLauncherResult({ result }: { result: TestImageServiceResult }) {
  const { t } = useTranslation();
  if (!result.ok) return <ErrorNotice code={result.code ?? 'unknown'} />;
  if (!result.launcher) return null;
  const launcher = result.launcher;
  return (
    <div className={styles.result}>
      <p className={styles.implementation}>
        <bdi>
          {launcher.implementation.name} {launcher.implementation.version}
        </bdi>
      </p>
      <Badge tone={launcher.ready ? 'success' : 'warning'}>
        {launcher.ready ? t('settings:images.testReady') : t('settings:images.testNotReady')}
      </Badge>
      <p>{t(LAUNCHER_STATE_LABEL_KEYS[launcher.state])}</p>
    </div>
  );
}

export function ImageServiceCard({
  service,
  revision,
  selected,
  disabled,
}: {
  service: ImageServiceView;
  revision: string;
  selected: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(service.name);
  const [editKeyAction, setEditKeyAction] = useState<'keep' | 'set' | 'remove'>('keep');
  const [editKeyValue, setEditKeyValue] = useState('');
  const [editModel, setEditModel] = useState(service.model ?? '');
  const [editMaxReferences, setEditMaxReferences] = useState<number | null>(service.openai?.maxReferences ?? 0);
  const [editSizes, setEditSizes] = useState<OpenAiSizeMode>(service.openai?.sizes ?? 'fixed');
  const [launcherEnabled, setLauncherEnabled] = useState(service.launcher !== null);
  const [launcherUrl, setLauncherUrl] = useState(service.launcher?.baseUrl ?? '');
  const [launcherToken, setLauncherToken] = useState('');
  const [idleMinutes, setIdleMinutes] = useState<number | null>(service.idleMinutes);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [paidConfirm, setPaidConfirm] = useState(false);
  const [testResult, setTestResult] = useState<TestImageServiceResult | null>(null);
  const [launcherResult, setLauncherResult] = useState<TestImageServiceResult | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  function startEditing() {
    setEditName(service.name);
    setEditKeyAction('keep');
    setEditKeyValue('');
    setEditModel(service.model ?? '');
    setEditMaxReferences(service.openai?.maxReferences ?? 0);
    setEditSizes(service.openai?.sizes ?? 'fixed');
    setLauncherEnabled(service.launcher !== null);
    setLauncherUrl(service.launcher?.baseUrl ?? '');
    setLauncherToken('');
    setIdleMinutes(service.idleMinutes);
    setActionError(null);
    setEditing(true);
  }

  function closeEditing() {
    setEditKeyValue('');
    setLauncherToken('');
    setActionError(null);
    setEditing(false);
  }

  const keyChange: KeyChange =
    editKeyAction === 'keep'
      ? { action: 'keep' }
      : editKeyAction === 'set'
        ? { action: 'set', value: editKeyValue.trim() }
        : { action: 'remove' };

  function launcherChange(): LauncherChange {
    const keepLauncherKey: KeyChange = { action: 'keep' };
    if (service.protocol !== 'unwritten-image' || !launcherEnabled) {
      return service.launcher ? { action: 'remove' } : { action: 'keep', key: keepLauncherKey };
    }
    if (service.launcher) {
      return launcherToken.trim()
        ? { action: 'set', baseUrl: service.launcher.baseUrl, apiKey: launcherToken.trim() }
        : { action: 'keep', key: keepLauncherKey };
    }
    return { action: 'set', baseUrl: launcherUrl.trim(), apiKey: launcherToken.trim() || null };
  }

  async function save() {
    setSaving(true);
    setActionError(null);
    try {
      const config = await api.image.services.update({
        baseRevision: revision,
        serviceId: service.id,
        name: editName.trim(),
        key: keyChange,
        model: service.protocol === 'openai-images' ? editModel.trim() : null,
        openai:
          service.protocol === 'openai-images' ? { maxReferences: editMaxReferences ?? 0, sizes: editSizes } : null,
        launcher: launcherChange(),
        idleMinutes: idleMinutes ?? service.idleMinutes,
      });
      queryClient.setQueryData(queryKeys.imageConfig, config);
      closeEditing();
    } catch (error) {
      setActionError(error);
    } finally {
      setSaving(false);
    }
  }

  const remove = useMutation({
    mutationFn: () => api.image.services.remove({ baseRevision: revision, serviceId: service.id }),
    onSuccess: (config) => {
      setDeleting(false);
      setActionError(null);
      queryClient.setQueryData(queryKeys.imageConfig, config);
    },
    onError: (error) => {
      setDeleting(false);
      setActionError(error);
    },
  });

  const test = useMutation({
    mutationFn: (paid: boolean) => api.image.services.test({ serviceId: service.id, target: 'service', paid }),
    onSuccess: (result) => {
      setTestResult(result);
      setActionError(null);
    },
    onError: (error) => {
      setTestResult(null);
      setActionError(error);
    },
  });

  const testLauncher = useMutation({
    mutationFn: () => api.image.services.test({ serviceId: service.id, target: 'launcher' }),
    onSuccess: (result) => {
      setLauncherResult(result);
      setActionError(null);
    },
    onError: (error) => {
      setLauncherResult(null);
      setActionError(error);
    },
  });

  const serviceKeyBadge = keyBadge(service.key);
  const launcherKeyBadge = service.launcher ? keyBadge(service.launcher.key) : null;

  return (
    <Card as='section'>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <div className={styles.titleRow}>
            <h3 className={styles.name}>{service.name}</h3>
            {service.probe?.result === 'ready' ? (
              <Badge tone='success'>{t('play:serviceState.ready')}</Badge>
            ) : service.probe ? (
              <Badge tone='warning'>{t(notReadyReasonKey(service.probe.notReadyReason))}</Badge>
            ) : null}
            <Badge tone={serviceKeyBadge.tone}>{t(serviceKeyBadge.labelKey)}</Badge>
          </div>
          <p className={styles.protocol}>
            <span>{t(PROTOCOL_LABEL_KEYS[service.protocol])}</span>
            <bdi className={styles.address}>{service.baseUrl}</bdi>
          </p>
        </div>
      </div>
      <div className={styles.facts}>
        {service.model ? (
          <p className={styles.meta}>
            <span>{t('settings:images.model')}</span> <bdi>{service.model}</bdi>
          </p>
        ) : null}
        {service.capabilities ? <CapabilitySummary capabilities={service.capabilities} /> : null}
        {service.probe || service.lastSuccessAt ? (
          <p className={styles.status}>
            {service.probe?.implementation ? (
              <bdi className={styles.implementation}>
                {service.probe.implementation.name} {service.probe.implementation.version}
              </bdi>
            ) : null}
            {service.probe?.model ? <bdi className={styles.implementation}>{service.probe.model}</bdi> : null}
            {service.probe ? (
              <span>{t('settings:images.lastProbe', { time: formatRelative(service.probe.at) })}</span>
            ) : null}
            {service.lastSuccessAt ? (
              <span>{t('settings:images.lastSuccess', { time: formatRelative(service.lastSuccessAt) })}</span>
            ) : null}
          </p>
        ) : null}
        {service.protocol === 'unwritten-image' && !service.launcher ? (
          <p className={styles.notice}>{t('settings:images.launcher.notConfigured')}</p>
        ) : null}
      </div>
      {service.protocol === 'unwritten-image' && service.launcher ? (
        <div className={styles.launcher}>
          <h4 className={styles.subheading}>{t('settings:images.launcher.heading')}</h4>
          <p className={styles.address}>{service.launcher.baseUrl}</p>
          {launcherKeyBadge ? <Badge tone={launcherKeyBadge.tone}>{t(launcherKeyBadge.labelKey)}</Badge> : null}
          <dl className={styles.details}>
            <div>
              <dt>{t('settings:images.launcher.idleMinutes')}</dt>
              <dd>{service.idleMinutes}</dd>
            </div>
          </dl>
          <div>
            <Button
              variant='secondary'
              onClick={() => testLauncher.mutate()}
              disabled={disabled}
              busy={testLauncher.isPending}
            >
              {t('settings:images.launcher.test')}
            </Button>
          </div>
          {launcherResult ? <TestLauncherResult result={launcherResult} /> : null}
        </div>
      ) : null}
      <div className={styles.actions}>
        <Button variant='secondary' onClick={() => test.mutate(false)} disabled={disabled} busy={test.isPending}>
          {test.isPending ? t('settings:images.testRunning') : t('settings:images.test')}
        </Button>
        {service.protocol === 'openai-images' ? (
          <Button variant='secondary' onClick={() => setPaidConfirm(true)} disabled={disabled || test.isPending}>
            {t('settings:images.testImage')}
          </Button>
        ) : null}
        <Button variant='text' onClick={startEditing} disabled={disabled}>
          {t('settings:images.edit')}
        </Button>
        <Button variant='text' onClick={() => setDeleting(true)} disabled={disabled}>
          {t('settings:images.remove')}
        </Button>
      </div>
      {testResult ? <TestServiceResult result={testResult} /> : null}
      {editing ? (
        <div className={styles.edit}>
          <div className={styles.editFields}>
            <TextField
              label={t('settings:images.name')}
              value={editName}
              onValueChange={setEditName}
              disabled={disabled}
            />
            <Select
              label={service.protocol === 'unwritten-image' ? t('settings:images.token') : t('settings:images.apiKey')}
              value={editKeyAction}
              onValueChange={(value) => setEditKeyAction(value as 'keep' | 'set' | 'remove')}
              options={[
                { value: 'keep', label: t('settings:endpoint.keyKeep') },
                { value: 'set', label: t('settings:endpoint.keySetAction') },
                { value: 'remove', label: t('settings:endpoint.keyRemove') },
              ]}
              disabled={disabled}
            />
            {editKeyAction === 'set' ? (
              <>
                <TextField
                  label={t('settings:endpoint.keySetAction')}
                  value={editKeyValue}
                  onValueChange={setEditKeyValue}
                  type='password'
                  autoComplete='off'
                  disabled={disabled}
                />
                {service.protocol === 'unwritten-image' ? (
                  <TokenReveal value={editKeyValue} onValueChange={setEditKeyValue} disabled={disabled} />
                ) : null}
              </>
            ) : null}
            {service.protocol === 'openai-images' ? (
              <>
                <TextField
                  label={t('settings:images.model')}
                  value={editModel}
                  onValueChange={(value) => {
                    setEditModel(value);
                    const prefill = prefillOpenAiOptions(value);
                    setEditMaxReferences(prefill.maxReferences);
                    setEditSizes(prefill.sizes);
                  }}
                  mono
                  disabled={disabled}
                />
                <NumberField
                  label={t('settings:images.referenceLimit')}
                  value={editMaxReferences}
                  onValueChange={setEditMaxReferences}
                  min={0}
                  max={OPENAI_REFERENCE_LIMIT}
                  step={1}
                  disabled={disabled}
                />
                <Select
                  label={t('settings:images.sizeMode')}
                  value={editSizes}
                  onValueChange={(value) => setEditSizes(value as OpenAiSizeMode)}
                  options={(Object.keys(SIZE_MODE_LABEL_KEYS) as OpenAiSizeMode[]).map((value) => ({
                    value,
                    label: t(SIZE_MODE_LABEL_KEYS[value]),
                  }))}
                  disabled={disabled}
                />
              </>
            ) : null}
          </div>
          {service.protocol === 'unwritten-image' ? (
            <div className={styles.launcher}>
              <h4 className={styles.subheading}>{t('settings:images.launcher.heading')}</h4>
              <label className={styles.checkbox}>
                <input
                  type='checkbox'
                  checked={launcherEnabled}
                  onChange={(event) => setLauncherEnabled(event.target.checked)}
                  disabled={disabled}
                />
                <span>{t('settings:images.launcher.enabled')}</span>
              </label>
              {launcherEnabled ? (
                <>
                  {service.launcher ? (
                    <p className={styles.address}>{service.launcher.baseUrl}</p>
                  ) : (
                    <TextField
                      label={t('settings:images.launcher.address')}
                      value={launcherUrl}
                      onValueChange={setLauncherUrl}
                      mono
                      disabled={disabled}
                    />
                  )}
                  <TextField
                    label={t('settings:images.launcher.token')}
                    value={launcherToken}
                    onValueChange={setLauncherToken}
                    type='password'
                    autoComplete='off'
                    disabled={disabled}
                  />
                  <TokenReveal value={launcherToken} onValueChange={setLauncherToken} disabled={disabled} />
                  <NumberField
                    label={t('settings:images.launcher.idleMinutes')}
                    value={idleMinutes}
                    onValueChange={setIdleMinutes}
                    min={IDLE_MINUTES_MIN}
                    max={IDLE_MINUTES_MAX}
                    step={1}
                    disabled={disabled}
                  />
                </>
              ) : null}
            </div>
          ) : null}
          <div className={styles.actions}>
            <Button
              variant='secondary'
              onClick={() => void save()}
              disabled={
                disabled ||
                editName.trim() === '' ||
                (editKeyAction === 'set' && editKeyValue.trim() === '') ||
                (service.protocol === 'unwritten-image' &&
                  launcherEnabled &&
                  !service.launcher &&
                  launcherUrl.trim() === '')
              }
              busy={saving}
            >
              {t('settings:images.save')}
            </Button>
            <Button variant='text' onClick={closeEditing}>
              {t('common:action.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
      <ErrorNotice error={actionError ?? test.error ?? testLauncher.error} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('settings:images.remove')}
        description={
          selected
            ? t('settings:images.removeSelectedConfirm', { name: service.name })
            : t('settings:images.removeConfirm', { name: service.name })
        }
        confirmLabel={t('settings:images.remove')}
        tone='danger'
        onConfirm={() => remove.mutate()}
        busy={remove.isPending}
      />
      <ConfirmDialog
        open={paidConfirm}
        onOpenChange={setPaidConfirm}
        title={t('settings:images.testImage')}
        description={t('settings:images.paidConfirm')}
        confirmLabel={t('settings:images.testImage')}
        tone='default'
        onConfirm={() => {
          setPaidConfirm(false);
          test.mutate(true);
        }}
        busy={test.isPending}
      />
    </Card>
  );
}
