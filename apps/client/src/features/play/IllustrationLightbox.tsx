import { useRef } from 'react';
import type { RefObject } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { IllustrationView } from '@unwritten/contracts';
import { errorCode } from '../../shared/api/errors.ts';
import { Button, buttonClassName } from '../../shared/ui/Button.tsx';
import { IconButton } from '../../shared/ui/IconButton.tsx';
import type { IllustrationActions } from './useIllustrationActions.ts';
import styles from './IllustrationLightbox.module.css';

const IMAGE_FILE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function IllustrationLightbox({
  open,
  onOpenChange,
  illustration,
  depth,
  paraAnchorId,
  image,
  returnFocus,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  illustration: IllustrationView;
  depth: number;
  paraAnchorId: string;
  image: { url: string; mime: string };
  returnFocus: RefObject<HTMLElement | null>;
  actions: IllustrationActions;
}) {
  const { t } = useTranslation();
  const focusParagraph = useRef(false);
  const rerolling = illustration.rerolling || actions.reroll.isPending;
  const caption = illustration.caption?.trim() ? illustration.caption : null;
  const extension = IMAGE_FILE_EXTENSIONS[image.mime] ?? 'png';
  const size = illustration.image;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Viewport className={styles.viewport}>
          <Dialog.Popup
            className={styles.popup}
            finalFocus={() => {
              if (focusParagraph.current) {
                focusParagraph.current = false;
                return document.getElementById(paraAnchorId);
              }
              return returnFocus.current;
            }}
          >
            <header className={styles.header}>
              <Dialog.Title className={styles.title}>{t('play:illustration.lightboxTitle')}</Dialog.Title>
              <Dialog.Close render={<IconButton label={t('common:action.close')} icon={X} />} />
            </header>
            <div className={styles.imageWrap}>
              <img className={styles.image} src={image.url} alt={caption ?? t('play:illustration.altFallback')} />
              <span className={styles.dim} aria-hidden='true' />
            </div>
            {caption ? <Dialog.Description className={styles.caption}>{caption}</Dialog.Description> : null}
            {size ? (
              <p className={styles.resolution}>
                {t('play:illustration.resolution', { width: size.width, height: size.height })}
              </p>
            ) : null}
            {illustration.error ? <p className={styles.error}>{t(`errors:${illustration.error}`)}</p> : null}
            {actions.reroll.error ? (
              <p className={styles.error}>{t(`errors:${errorCode(actions.reroll.error)}`)}</p>
            ) : null}
            {actions.dismiss.error ? (
              <p className={styles.error}>{t(`errors:${errorCode(actions.dismiss.error)}`)}</p>
            ) : null}
            <div className={styles.actions}>
              <Button variant='secondary' busy={rerolling} onClick={() => actions.reroll.mutate(illustration.id)}>
                {rerolling ? t('play:illustration.rerolling') : t('play:illustration.reroll')}
              </Button>
              <a
                className={`${buttonClassName('secondary')} ${styles.save}`}
                href={image.url}
                download={`illustration-${depth}.${extension}`}
              >
                {t('play:illustration.save')}
              </a>
              <Button
                variant='danger'
                busy={actions.dismiss.isPending}
                onClick={() => {
                  actions.dismiss.mutate(illustration.id, {
                    onSuccess: () => {
                      focusParagraph.current = true;
                      onOpenChange(false);
                    },
                  });
                }}
              >
                {t('play:illustration.dismiss')}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
