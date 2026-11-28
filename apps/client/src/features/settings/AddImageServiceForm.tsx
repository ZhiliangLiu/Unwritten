import type { ImageProtocol, OpenAiImageCompat, OpenAiSizeMode } from '@unwritten/contracts';
import { IDLE_MINUTES_MAX, IDLE_MINUTES_MIN, IMAGE_IDLE_MINUTES, OPENAI_IMAGE_DEFAULTS } from '@unwritten/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { Card } from '../../shared/ui/Card.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { Icon } from '../../shared/ui/Icon.tsx';
import { NumberField } from '../../shared/ui/NumberField.tsx';
import { RadioGroup } from '../../shared/ui/RadioGroup.tsx';
import { Select } from '../../shared/ui/Select.tsx';
import { TextField } from '../../shared/ui/TextField.tsx';
import { OpenAiCompatFields } from './OpenAiCompatFields.tsx';
import { prefillOpenAiOptions, OPENAI_REFERENCE_LIMIT } from './openai-prefill.ts';
import { TokenReveal } from './TokenReveal.tsx';
import styles from './ImageServiceForm.module.css';

const SIZE_MODE_LABEL_KEYS: Record<OpenAiSizeMode, string> = {
  fixed: 'settings:images.sizeModes.fixed',
  custom: 'settings:images.sizeModes.custom',
};

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

export function AddImageServiceForm({ revision, disabled }: { revision: string; disabled: boolean }) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState<string>(() => crypto.randomUUID());
  const [protocol, setProtocol] = useState<ImageProtocol>('unwritten-image');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [maxReferences, setMaxReferences] = useState<number | null>(0);
  const [sizes, setSizes] = useState<OpenAiSizeMode>('fixed');
  const [compat, setCompat] = useState<OpenAiImageCompat>(OPENAI_IMAGE_DEFAULTS);
  const [launcherEnabled, setLauncherEnabled] = useState(false);
  const [launcherUrl, setLauncherUrl] = useState('');
  const [launcherApiKey, setLauncherApiKey] = useState('');
  const [idleMinutes, setIdleMinutes] = useState<number | null>(IMAGE_IDLE_MINUTES);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function reset() {
    setProtocol('unwritten-image');
    setName('');
    setBaseUrl('');
    setApiKey('');
    setModel('');
    setMaxReferences(0);
    setSizes('fixed');
    setCompat(OPENAI_IMAGE_DEFAULTS);
    setLauncherEnabled(false);
    setLauncherUrl('');
    setLauncherApiKey('');
    setIdleMinutes(IMAGE_IDLE_MINUTES);
    setError(null);
  }

  function close() {
    reset();
    setOpen(false);
  }

  function changeModel(value: string) {
    setModel(value);
    const { maxReferences: prefillReferences, sizes: prefillSizes, ...prefillCompat } = prefillOpenAiOptions(value);
    setMaxReferences(prefillReferences);
    setSizes(prefillSizes);
    setCompat(prefillCompat);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.image.services.create({
        requestId,
        baseRevision: revision,
        name: name.trim(),
        protocol,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || null,
        model: protocol === 'openai-images' ? model.trim() : null,
        openai: protocol === 'openai-images' ? { maxReferences: maxReferences ?? 0, sizes, ...compat } : null,
        launcher:
          protocol === 'unwritten-image' && launcherEnabled
            ? { baseUrl: launcherUrl.trim(), apiKey: launcherApiKey.trim() || null }
            : null,
        idleMinutes: protocol === 'unwritten-image' && launcherEnabled ? (idleMinutes ?? IMAGE_IDLE_MINUTES) : null,
      });
      queryClient.setQueryData(queryKeys.imageConfig, result.config);
      close();
    } catch (submitError) {
      setError(submitError);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant='secondary'
        icon={Plus}
        onClick={() => {
          setRequestId(crypto.randomUUID());
          setOpen(true);
        }}
        disabled={disabled}
      >
        {t('settings:images.add')}
      </Button>
    );
  }

  return (
    <Card as='section'>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h3 className={styles.groupHeading}>{t('settings:images.add')}</h3>
        <RadioGroup
          label={t('settings:images.protocolLabel')}
          value={protocol}
          onValueChange={(value) => {
            setProtocol(value as ImageProtocol);
            setApiKey('');
          }}
          options={[
            { value: 'unwritten-image', label: t('settings:images.protocol.unwritten-image') },
            { value: 'openai-images', label: t('settings:images.protocol.openai-images') },
          ]}
          appearance='segmented'
        />
        <div className={styles.fields}>
          <TextField label={t('settings:images.name')} value={name} onValueChange={setName} disabled={disabled} />
          <TextField
            label={t('settings:images.address')}
            value={baseUrl}
            onValueChange={setBaseUrl}
            mono
            disabled={disabled}
          />
          <TextField
            label={protocol === 'unwritten-image' ? t('settings:images.token') : t('settings:images.apiKey')}
            value={apiKey}
            onValueChange={setApiKey}
            type='password'
            autoComplete='off'
            disabled={disabled}
          />
          {protocol === 'openai-images' ? (
            <TextField
              label={t('settings:images.model')}
              value={model}
              onValueChange={changeModel}
              mono
              disabled={disabled}
            />
          ) : null}
          {protocol === 'unwritten-image' ? (
            <div className={styles.wide}>
              <TokenReveal value={apiKey} onValueChange={setApiKey} disabled={disabled} />
            </div>
          ) : null}
          {isPlainHttpToRemoteHost(baseUrl, apiKey) ? (
            <p className={`${styles.warning} ${styles.wide}`}>
              <span className={styles.warningIcon}>
                <Icon icon={TriangleAlert} size='sm' />
              </span>
              {t('settings:images.plainHttpWarning')}
            </p>
          ) : null}
          {protocol === 'openai-images' ? (
            <>
              <NumberField
                label={t('settings:images.referenceLimit')}
                value={maxReferences}
                onValueChange={setMaxReferences}
                min={0}
                max={OPENAI_REFERENCE_LIMIT}
                step={1}
                disabled={disabled}
              />
              <Select
                label={t('settings:images.sizeMode')}
                value={sizes}
                onValueChange={(value) => setSizes(value as OpenAiSizeMode)}
                options={(Object.keys(SIZE_MODE_LABEL_KEYS) as OpenAiSizeMode[]).map((value) => ({
                  value,
                  label: t(SIZE_MODE_LABEL_KEYS[value]),
                }))}
                disabled={disabled}
              />
              <OpenAiCompatFields value={compat} onChange={setCompat} heading='h4' disabled={disabled} />
            </>
          ) : null}
        </div>
        {protocol === 'unwritten-image' ? (
          <div className={styles.group}>
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
              <div className={styles.fields}>
                <div className={styles.wide}>
                  <TextField
                    label={t('settings:images.launcher.address')}
                    value={launcherUrl}
                    onValueChange={setLauncherUrl}
                    mono
                    disabled={disabled}
                  />
                </div>
                <TextField
                  label={t('settings:images.launcher.token')}
                  value={launcherApiKey}
                  onValueChange={setLauncherApiKey}
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
                <div className={styles.wide}>
                  <TokenReveal value={launcherApiKey} onValueChange={setLauncherApiKey} disabled={disabled} />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className={styles.actions}>
          <Button
            variant='secondary'
            type='submit'
            disabled={
              disabled ||
              name.trim() === '' ||
              baseUrl.trim() === '' ||
              (protocol === 'openai-images' && model.trim() === '') ||
              (protocol === 'unwritten-image' && launcherEnabled && launcherUrl.trim() === '')
            }
            busy={submitting}
          >
            {t('settings:images.save')}
          </Button>
          <Button variant='text' onClick={close}>
            {t('common:action.cancel')}
          </Button>
        </div>
        <ErrorNotice error={error} />
      </form>
    </Card>
  );
}
