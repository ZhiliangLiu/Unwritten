import type {
  OpenAiImageCompat,
  OpenAiOutputFormat,
  OpenAiReferenceTransport,
  OpenAiResponseFormat,
} from '@unwritten/contracts';
import { useTranslation } from 'react-i18next';
import { Disclosure } from '../../shared/ui/Disclosure.tsx';
import { Select } from '../../shared/ui/Select.tsx';
import styles from './ImageServiceForm.module.css';

const OUTPUT_FORMAT_LABEL_KEYS: Record<OpenAiOutputFormat, string> = {
  webp: 'settings:images.compat.outputFormats.webp',
  png: 'settings:images.compat.outputFormats.png',
  jpeg: 'settings:images.compat.outputFormats.jpeg',
};

const RESPONSE_FORMAT_LABEL_KEYS: Record<OpenAiResponseFormat, string> = {
  omit: 'settings:images.compat.responseFormats.omit',
  b64_json: 'settings:images.compat.responseFormats.b64_json',
};

const REFERENCE_TRANSPORT_LABEL_KEYS: Record<OpenAiReferenceTransport, string> = {
  edits: 'settings:images.compat.referenceTransports.edits',
  inline: 'settings:images.compat.referenceTransports.inline',
};

export function OpenAiCompatFields({
  value,
  onChange,
  heading,
  disabled,
}: {
  value: OpenAiImageCompat;
  onChange: (next: OpenAiImageCompat) => void;
  heading: 'h4' | 'h5';
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Disclosure
      summary={t('settings:images.compat.heading')}
      heading={heading}
      className={styles.wide}
      panelClassName={styles.compatPanel}
    >
      <div className={styles.fields}>
        <Select
          label={t('settings:images.compat.outputFormat')}
          value={value.outputFormat}
          onValueChange={(next) => onChange({ ...value, outputFormat: next as OpenAiOutputFormat })}
          options={(Object.keys(OUTPUT_FORMAT_LABEL_KEYS) as OpenAiOutputFormat[]).map((format) => ({
            value: format,
            label: t(OUTPUT_FORMAT_LABEL_KEYS[format]),
          }))}
          description={t('settings:images.compat.outputFormatHelp')}
          disabled={disabled}
        />
        <Select
          label={t('settings:images.compat.responseFormat')}
          value={value.responseFormat}
          onValueChange={(next) => onChange({ ...value, responseFormat: next as OpenAiResponseFormat })}
          options={(Object.keys(RESPONSE_FORMAT_LABEL_KEYS) as OpenAiResponseFormat[]).map((format) => ({
            value: format,
            label: t(RESPONSE_FORMAT_LABEL_KEYS[format]),
          }))}
          description={t('settings:images.compat.responseFormatHelp')}
          disabled={disabled}
        />
        <Select
          label={t('settings:images.compat.referenceTransport')}
          value={value.referenceTransport}
          onValueChange={(next) => onChange({ ...value, referenceTransport: next as OpenAiReferenceTransport })}
          options={(Object.keys(REFERENCE_TRANSPORT_LABEL_KEYS) as OpenAiReferenceTransport[]).map((transport) => ({
            value: transport,
            label: t(REFERENCE_TRANSPORT_LABEL_KEYS[transport]),
          }))}
          description={t('settings:images.compat.referenceTransportHelp')}
          disabled={disabled}
        />
        <div className={styles.wide}>
          <label className={styles.checkbox}>
            <input
              type='checkbox'
              checked={value.disableWatermark}
              onChange={(event) => onChange({ ...value, disableWatermark: event.target.checked })}
              disabled={disabled}
            />
            <span>{t('settings:images.compat.disableWatermark')}</span>
          </label>
          <p className={styles.hint}>{t('settings:images.compat.disableWatermarkHelp')}</p>
        </div>
      </div>
    </Disclosure>
  );
}
