import type {
  ImageProtocol,
  ImageServiceView,
  KeyChange,
  KeyStatus,
  LauncherChange,
  LauncherState,
  OpenAiImageCompat,
  OpenAiSizeMode,
  TestImageServiceResult,
} from '@unwritten/contracts';
import { IDLE_MINUTES_MAX, IDLE_MINUTES_MIN, OPENAI_IMAGE_DEFAULTS } from '@unwritten/contracts';
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
import { OverflowMenu } from '../../shared/ui/OverflowMenu.tsx';
import { Select } from '../../shared/ui/Select.tsx';
import { TextField } from '../../shared/ui/TextField.tsx';
import { OpenAiCompatFields } from './OpenAiCompatFields.tsx';
import { prefillOpenAiOptions, OPENAI_REFERENCE_LIMIT } from './openai-prefill.ts';
import { TokenReveal } from './TokenReveal.tsx';
import formStyles from './ImageServiceForm.module.css';
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

function keyBadge(key: KeyStatus): { tone: 'success' | 'warning' | 'neutral'; labelKey: string } {
  if (key.hasKey) return { tone: 'success', labelKey: 'settings:endpoint.keySet' };
  if (key.source === 'env') return { tone: 'warning', labelKey: 'settings:endpoint.keyEnvMissing' };
  return { tone: 'neutral', labelKey: 'settings:endpoint.keyMissing' };
}

function compatOf(service: ImageServiceView): OpenAiImageCompat {
  return {
    outputFormat: service.openai?.outputFormat ?? OPENAI_IMAGE_DEFAULTS.outputFormat,
    responseFormat: service.openai?.responseFormat ?? OPENAI_IMAGE_DEFAULTS.responseFormat,
    referenceTransport: service.openai?.referenceTransport ?? OPENAI_IMAGE_DEFAULTS.referenceTransport,
    disableWatermark: service.openai?.disableWatermark ?? OPENAI_IMAGE_DEFAULTS.disableWatermark,
  };
}

function TestServiceResult({ result }: { result: TestImageServiceResult }) {
  const { t } = useTranslation();
  if (!result.ok) return <ErrorNotice code={result.code ?? 'unknown'} />;
  const service = result.service;
  return (
    <p className={styles.result}>
      {result.generated ? (
        <Badge tone='success'>
          {t('settings:images.testImageDone', { width: result.generated.width, height: result.generated.height })}
        </Badge>
      ) : (
        <Badge tone={service && !service.ready ? 'warning' : 'success'}>
          {service && !service.ready ? t('settings:images.testNotReady') : t('settings:images.testReady')}
        </Badge>
      )}
      {service && !service.ready ? <span>{t(notReadyReasonKey(service.notReadyReason))}</span> : null}
    </p>
  );
}

function TestLauncherResult({ result }: { result: TestImageServiceResult }) {
  const { t } = useTranslation();
  if (!result.ok) return <ErrorNotice code={result.code ?? 'unknown'} />;
  if (!result.launcher) return null;
  const launcher = result.launcher;
  return (
    <p className={styles.result}>
      <Badge tone={launcher.ready ? 'neutral' : 'warning'}>{t(LAUNCHER_STATE_LABEL_KEYS[launcher.state])}</Badge>
      {launcher.ready ? null : <span>{t('settings:images.testNotReady')}</span>}
      <bdi className={styles.mono}>
        {launcher.implementation.name} {launcher.implementation.version}
      </bdi>
    </p>
  );
}

function ServiceFacts({ service }: { service: ImageServiceView }) {
  const { t } = useTranslation();
  const model = service.model ?? service.probe?.model ?? null;
  const implementation = service.probe?.implementation ?? null;
  const capabilities = service.capabilities;
  const launcherKey = service.launcher ? keyBadge(service.launcher.key) : null;
  const capabilitiesFromEarlierProbe =
    service.capabilitiesAt !== null && service.capabilitiesAt !== service.probe?.at ? service.capabilitiesAt : null;

  return (
    <>
      <dl className={styles.facts}>
        {model ? (
          <div className={styles.fact}>
            <dt>{t('settings:images.facts.model')}</dt>
            <dd>
              <bdi className={styles.mono}>{model}</bdi>
            </dd>
          </div>
        ) : null}
        {implementation ? (
          <div className={styles.fact}>
            <dt>{t('settings:images.facts.implementation')}</dt>
            <dd>
              <bdi className={styles.mono}>
                {implementation.name} {implementation.version}
              </bdi>
            </dd>
          </div>
        ) : null}
        {capabilities ? (
          <>
            <div className={styles.fact}>
              <dt>{t('settings:images.facts.references')}</dt>
              <dd>
                {capabilities.maxReferences === 0
                  ? t('settings:images.facts.referencesNone')
                  : t('settings:images.facts.referencesCount', { count: capabilities.maxReferences })}
              </dd>
            </div>
            <div className={styles.fact}>
              <dt>{t('settings:images.facts.negativePrompt')}</dt>
              <dd>
                {capabilities.negativePrompt
                  ? t('settings:images.facts.supported')
                  : t('settings:images.facts.unsupported')}
              </dd>
            </div>
          </>
        ) : null}
        {service.protocol === 'unwritten-image' ? (
          <div className={styles.fact}>
            <dt>{t('settings:images.facts.launcher')}</dt>
            <dd>
              {service.launcher && launcherKey ? (
                <span className={styles.launcher}>
                  <bdi className={styles.mono}>{service.launcher.baseUrl}</bdi>
                  <Badge tone={launcherKey.tone}>{t(launcherKey.labelKey)}</Badge>
                  <span>{t('settings:images.facts.launcherIdle', { minutes: service.idleMinutes })}</span>
                </span>
              ) : (
                t('settings:images.facts.launcherNone')
              )}
            </dd>
          </div>
        ) : null}
        {service.probe ? (
          <div className={styles.fact}>
            <dt>{t('settings:images.facts.lastProbe')}</dt>
            <dd>{formatRelative(service.probe.at)}</dd>
          </div>
        ) : null}
        {service.lastSuccessAt ? (
          <div className={styles.fact}>
            <dt>{t('settings:images.facts.lastSuccess')}</dt>
            <dd>{formatRelative(service.lastSuccessAt)}</dd>
          </div>
        ) : null}
      </dl>
      {capabilitiesFromEarlierProbe !== null ? (
        <p className={styles.note}>
          {t('settings:images.capabilitiesFrom', { time: formatRelative(capabilitiesFromEarlierProbe) })}
        </p>
      ) : null}
    </>
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
  const [editCompat, setEditCompat] = useState<OpenAiImageCompat>(() => compatOf(service));
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
    setEditCompat(compatOf(service));
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
          service.protocol === 'openai-images'
            ? { maxReferences: editMaxReferences ?? 0, sizes: editSizes, ...editCompat }
            : null,
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.imageConfig });
      void queryClient.invalidateQueries({ queryKey: queryKeys.imageOutput });
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

  return (
    <Card as='section'>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <div className={styles.titleRow}>
            <h4 className={styles.name}>{service.name}</h4>
            {selected ? <Badge tone='neutral'>{t('settings:images.inUse')}</Badge> : null}
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
        <div className={styles.menu} inert={disabled || undefined}>
          <OverflowMenu
            label={t('settings:images.more', { name: service.name })}
            items={[
              { label: t('settings:images.edit'), onSelect: startEditing },
              { label: t('settings:images.remove'), onSelect: () => setDeleting(true), tone: 'danger' },
            ]}
          />
        </div>
      </div>
      {editing ? (
        <div className={formStyles.form}>
          <div className={formStyles.fields}>
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
                  <div className={formStyles.wide}>
                    <TokenReveal value={editKeyValue} onValueChange={setEditKeyValue} disabled={disabled} />
                  </div>
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
                    const { maxReferences, sizes, ...compat } = prefillOpenAiOptions(value);
                    setEditMaxReferences(maxReferences);
                    setEditSizes(sizes);
                    setEditCompat(compat);
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
                <OpenAiCompatFields value={editCompat} onChange={setEditCompat} heading='h5' disabled={disabled} />
              </>
            ) : null}
          </div>
          {service.protocol === 'unwritten-image' ? (
            <div className={formStyles.group}>
              <h5 className={formStyles.groupHeading}>{t('settings:images.launcher.heading')}</h5>
              <label className={formStyles.checkbox}>
                <input
                  type='checkbox'
                  checked={launcherEnabled}
                  onChange={(event) => setLauncherEnabled(event.target.checked)}
                  disabled={disabled}
                />
                <span>{t('settings:images.launcher.enabled')}</span>
              </label>
              {launcherEnabled ? (
                <div className={formStyles.fields}>
                  {service.launcher ? (
                    <p className={`${styles.address} ${formStyles.wide}`}>{service.launcher.baseUrl}</p>
                  ) : (
                    <div className={formStyles.wide}>
                      <TextField
                        label={t('settings:images.launcher.address')}
                        value={launcherUrl}
                        onValueChange={setLauncherUrl}
                        mono
                        disabled={disabled}
                      />
                    </div>
                  )}
                  <TextField
                    label={t('settings:images.launcher.token')}
                    value={launcherToken}
                    onValueChange={setLauncherToken}
                    type='password'
                    autoComplete='off'
                    disabled={disabled}
                  />
                  <NumberField
                    label={t('settings:images.launcher.idleMinutes')}
                    value={idleMinutes}
                    onValueChange={setIdleMinutes}
                    min={IDLE_MINUTES_MIN}
                    max={IDLE_MINUTES_MAX}
                    step={1}
                    disabled={disabled}
                  />
                  <div className={formStyles.wide}>
                    <TokenReveal value={launcherToken} onValueChange={setLauncherToken} disabled={disabled} />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className={formStyles.actions}>
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
      ) : (
        <>
          <ServiceFacts service={service} />
          <div className={styles.actions}>
            <Button variant='secondary' onClick={() => test.mutate(false)} disabled={disabled} busy={test.isPending}>
              {test.isPending ? t('settings:images.testRunning') : t('settings:images.test')}
            </Button>
            {service.protocol === 'openai-images' ? (
              <Button variant='secondary' onClick={() => setPaidConfirm(true)} disabled={disabled || test.isPending}>
                {t('settings:images.testImage')}
              </Button>
            ) : null}
            {service.protocol === 'unwritten-image' && service.launcher ? (
              <Button
                variant='secondary'
                onClick={() => testLauncher.mutate()}
                disabled={disabled}
                busy={testLauncher.isPending}
              >
                {t('settings:images.launcher.test')}
              </Button>
            ) : null}
          </div>
          {testResult ? <TestServiceResult result={testResult} /> : null}
          {launcherResult ? <TestLauncherResult result={launcherResult} /> : null}
        </>
      )}
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
