import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { WorkDetail } from '@unwritten/contracts';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { Combobox } from '../../shared/ui/Combobox.tsx';
import { ErrorNotice } from '../../shared/ui/ErrorNotice.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';

const NO_REFERENCE = 'none';

function chapterOptions(titles: string[], t: TFunction): Array<{ value: string; label: string }> {
  let previousTitle = '';
  return titles.map((title, index) => {
    const label =
      title ||
      (previousTitle
        ? t('authoring:novel.continuedChapter', { title: previousTitle })
        : index === 0
          ? t('authoring:novel.untitledChapter')
          : t('authoring:novel.segment', { number: index + 1 }));
    if (title) previousTitle = title;
    return { value: String(index), label };
  });
}

export function NovelChapterPicker({
  workId,
  novel,
  busy,
  onChoose,
}: {
  workId: string;
  novel: NonNullable<WorkDetail['novelImport']>;
  busy: boolean;
  onChoose: (chapter: number, referenceChapter?: number) => void;
}) {
  const api = useApi();
  const { t } = useTranslation();
  const chapters = useQuery({
    queryKey: queryKeys.novelChapters(workId),
    queryFn: () => api.works.novelChapters({ workId }),
    staleTime: Infinity,
  });
  const [chosenChapter, setChosenChapter] = useState<string | null>(null);
  const [chosenReference, setChosenReference] = useState<string | null>(null);

  if (chapters.error) return <ErrorNotice error={chapters.error} />;
  if (!chapters.data) return <Skeleton variant='lines' count={2} />;

  const options = chapterOptions(chapters.data, t);
  const chapterValue = chosenChapter ?? String(novel.chapter);
  const referenceValue = chosenReference ?? String(novel.referenceChapter ?? NO_REFERENCE);
  const selectedReference =
    referenceValue === NO_REFERENCE || referenceValue === chapterValue ? undefined : Number(referenceValue);
  const sameChapter = Number(chapterValue) === novel.chapter;

  return (
    <>
      <Combobox
        label={t('authoring:novel.chapter')}
        value={chapterValue}
        onValueChange={setChosenChapter}
        options={options}
        description={t('authoring:novel.chapterHelp')}
        disabled={busy}
      />
      <Combobox
        label={t('authoring:novel.reference')}
        value={selectedReference === undefined ? NO_REFERENCE : String(selectedReference)}
        onValueChange={setChosenReference}
        options={[
          { value: NO_REFERENCE, label: t('authoring:novel.noReference') },
          ...options.filter((option) => option.value !== chapterValue),
        ]}
        description={t('authoring:novel.referenceHelp')}
        disabled={busy}
      />
      <div>
        <Button
          variant='secondary'
          disabled={busy || (sameChapter && selectedReference === novel.referenceChapter)}
          onClick={() => {
            onChoose(Number(chapterValue), selectedReference);
            setChosenChapter(null);
            setChosenReference(null);
          }}
        >
          {t(sameChapter ? 'authoring:novel.useReference' : 'authoring:novel.changeChapter')}
        </Button>
      </div>
    </>
  );
}
