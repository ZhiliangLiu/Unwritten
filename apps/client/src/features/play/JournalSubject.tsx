import { useTranslation } from 'react-i18next';
import type {
  EntityKind,
  JournalLine,
  JournalSubject as JournalSubjectView,
  KnowledgeLevel,
  StorySource,
} from '@unwritten/contracts';
import { Badge } from '../../shared/ui/Badge.tsx';
import { Button } from '../../shared/ui/Button.tsx';
import styles from './JournalSubject.module.css';

export const ENTITY_KIND_LABEL_KEYS: Record<EntityKind, string> = {
  character: 'play:journal.group.character',
  place: 'play:journal.group.place',
  item: 'play:journal.group.item',
  group: 'play:journal.group.group',
  other: 'play:journal.group.other',
};

export const KNOWLEDGE_LEVEL_LABEL_KEYS: Record<KnowledgeLevel, string> = {
  heard: 'play:journal.level.heard',
  suspects: 'play:journal.level.suspects',
  confirmed: 'play:journal.level.confirmed',
  misled: 'play:journal.level.misled',
};

export function JournalLineItem({ line, onJump }: { line: JournalLine; onJump: (source: StorySource) => void }) {
  const { t } = useTranslation();
  const source = line.source;
  const sourceLabel = source
    ? source.depth === 0
      ? t('play:journal.source.opening', { para: source.para })
      : t('play:journal.source.turn', { depth: source.depth, para: source.para })
    : null;

  return (
    <li className={styles.line}>
      <div className={styles.textRow}>
        {line.level === 'confirmed' ? null : <Badge tone='neutral'>{t(KNOWLEDGE_LEVEL_LABEL_KEYS[line.level])}</Badge>}
        <p className={styles.text}>{line.text}</p>
      </div>
      {source && sourceLabel ? (
        <Button
          variant='text'
          size='sm'
          className={styles.jump}
          aria-label={t('play:journal.jump', { source: sourceLabel })}
          onClick={() => onJump(source)}
        >
          {t('play:journal.jumpText', { source: sourceLabel })}
        </Button>
      ) : null}
    </li>
  );
}

export function JournalSubject({
  subject,
  onJump,
}: {
  subject: JournalSubjectView;
  onJump: (source: StorySource) => void;
}) {
  const { t } = useTranslation();

  return (
    <li className={styles.subject}>
      <div className={styles.heading}>
        <h3 className={styles.name}>{subject.name}</h3>
        <Badge tone='neutral'>{t(ENTITY_KIND_LABEL_KEYS[subject.kind])}</Badge>
      </div>
      <ul className={styles.lines}>
        {subject.lines.map((line) => (
          <JournalLineItem key={line.id} line={line} onJump={onJump} />
        ))}
      </ul>
    </li>
  );
}
