import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DEFAULT_ILLUSTRATION_STYLE } from '@unwritten/contracts';
import type { IllustrationStyle, WorkDetail } from '@unwritten/contracts';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { StylePicker } from '../../shared/ui/illustration/StylePicker.tsx';
import { StylePreview } from '../../shared/ui/illustration/StylePreview.tsx';
import styles from './IllustrationStyleSection.module.css';

export function IllustrationStyleSection({ work }: { work: WorkDetail }) {
  const api = useApi();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [style, setStyle] = useState<IllustrationStyle>(work.illustrationStyle ?? DEFAULT_ILLUSTRATION_STYLE);
  const [error, setError] = useState<unknown>(null);
  const config = useQuery({ queryKey: queryKeys.imageConfig, queryFn: () => api.image.services.list() });

  const save = useMutation({
    mutationFn: (next: IllustrationStyle) => api.works.setIllustrationStyle({ workId: work.id, style: next }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.work(work.id) });
    },
    onError: setError,
  });

  if (!config.data || config.data.services.length === 0) return null;

  const choose = (next: IllustrationStyle) => {
    setStyle(next);
    if (next.kind === 'preset' || next.text.trim().length > 0) save.mutate(next);
  };

  const previewProps = { workId: work.id, style, viewWorkId: work.id };

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{t('authoring:style.heading')}</h3>
      <p className={styles.help}>{t('authoring:style.description')}</p>
      <StylePicker value={style} onChange={choose} />
      <StylePreview {...previewProps} />
      <ErrorNotice error={error} />
    </section>
  );
}
