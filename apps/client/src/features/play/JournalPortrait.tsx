import type { JournalPortrait as JournalPortraitView } from '@unwritten/contracts';
import { useImageBlob } from '../../shared/hooks/useImageBlob.ts';
import styles from './JournalSubject.module.css';

export function JournalPortrait({
  routeId,
  portrait,
  alt,
}: {
  routeId: string;
  portrait: JournalPortraitView;
  alt: string;
}) {
  const image = useImageBlob(
    { view: { kind: 'route', routeId }, image: { kind: 'portrait', setId: portrait.setId, slot: 'front' } },
    portrait.updatedAt,
  );
  if (image.status !== 'ready') return null;
  return <img className={styles.portrait} src={image.url} alt={alt} />;
}
