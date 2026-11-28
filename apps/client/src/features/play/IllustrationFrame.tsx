import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { IllustrationView } from '@unwritten/contracts';
import { useApi } from '../../shared/api/context.tsx';
import { useImageBlob } from '../../shared/hooks/useImageBlob.ts';
import { useImageServiceState } from '../../shared/hooks/useImageServiceState.ts';
import { reportSample } from '../../shared/lib/log.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { IllustrationFailed } from './IllustrationFailed.tsx';
import { IllustrationLightbox } from './IllustrationLightbox.tsx';
import { frameAspect } from './illustration-layout.ts';
import { useIllustrationActions } from './useIllustrationActions.ts';
import styles from './IllustrationFrame.module.css';

declare module 'react' {
  interface CSSProperties {
    '--uw-illustration-aspect'?: number | null;
  }
}

const reportedIllustrationIds = new Set<string>();

function useReadingAnchor() {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const paragraphs = () => Array.from(document.querySelectorAll<HTMLElement>('[data-uw-paragraph]'));
    const readingParagraph = () => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement) {
        const focusedParagraph = paragraphs().find((paragraph) => paragraph === focused);
        if (focusedParagraph) return focusedParagraph;
      }
      return (
        paragraphs().find((paragraph) => {
          const rect = paragraph.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < window.innerHeight;
        }) ?? null
      );
    };
    let target = readingParagraph();
    let previousTop = target?.getBoundingClientRect().top ?? null;
    const keep = () => {
      target = readingParagraph();
      previousTop = target?.getBoundingClientRect().top ?? null;
    };
    window.addEventListener('scroll', keep, { passive: true });
    const observer = new ResizeObserver(() => {
      if (!target) {
        keep();
        return;
      }
      const current = target.getBoundingClientRect().top;
      if (previousTop !== null && current !== previousTop) window.scrollBy(0, current - previousTop);
      previousTop = target.getBoundingClientRect().top;
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', keep);
      const before = previousTop;
      const anchor = target;
      requestAnimationFrame(() => {
        const after = anchor?.getBoundingClientRect().top ?? null;
        if (before !== null && after !== null && after !== before) window.scrollBy(0, after - before);
      });
    };
  }, []);

  return ref;
}

export function IllustrationFrame({
  illustration,
  routeId,
  paraAnchorId,
  depth,
}: {
  illustration: IllustrationView;
  routeId: string;
  paraAnchorId: string;
  depth: number;
}) {
  const api = useApi();
  const { t } = useTranslation();
  const service = useImageServiceState(illustration.serviceId);
  const actions = useIllustrationActions(routeId);
  const anchorRef = useReadingAnchor();
  const returnFocus = useRef<HTMLButtonElement>(null);
  const observedAt = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [loadedImage, setLoadedImage] = useState<{ url: string; mime: string } | null>(null);
  const blob = useImageBlob(
    illustration.status === 'done'
      ? { view: { kind: 'route', routeId }, image: { kind: 'illustration', illustrationId: illustration.id } }
      : null,
    illustration.updatedAt,
  );

  useEffect(() => {
    if (observedAt.current === null) observedAt.current = performance.now();
  }, []);

  const image = illustration.rerolling
    ? (loadedImage ?? (blob.status === 'ready' ? { url: blob.url, mime: blob.mime } : null))
    : blob.status === 'ready'
      ? { url: blob.url, mime: blob.mime }
      : loadedImage;

  const aspect = frameAspect(illustration);
  const caption = illustration.caption?.trim() ? illustration.caption : null;
  const busy = illustration.status === 'queued' || illustration.status === 'running';
  const statusLabel =
    illustration.status === 'queued' && service.state === 'waking'
      ? t('play:illustration.waking')
      : illustration.status === 'queued' && service.state === 'needs_action'
        ? t('play:illustration.waitingAuth')
        : busy && aspect === null
          ? t('play:illustration.composing')
          : illustration.status === 'queued'
            ? t('play:illustration.queued')
            : t('play:illustration.drawing');

  const imageLoaded = (event: SyntheticEvent<HTMLImageElement>) => {
    const url = event.currentTarget.getAttribute('src');
    if (!url) return;
    const mime = blob.status === 'ready' ? blob.mime : loadedImage?.mime;
    if (!mime) return;
    void event.currentTarget.decode().then(
      () => {
        setLoadedImage({ url, mime });
        if (reportedIllustrationIds.has(illustration.id)) return;
        reportedIllustrationIds.add(illustration.id);
        reportSample(api, {
          metric: 'client.illustration_visible',
          durationMs: performance.now() - (observedAt.current ?? performance.now()),
          outcome: 'ok',
          requestId: illustration.id,
        });
      },
      () => {},
    );
  };

  return (
    <div ref={anchorRef} className={styles.root}>
      {illustration.status === 'failed' ? (
        <IllustrationFailed illustration={illustration} depth={depth} paraAnchorId={paraAnchorId} actions={actions} />
      ) : null}
      {busy && aspect === null ? (
        <p className={styles.statusLine} aria-busy='true'>
          {statusLabel}
        </p>
      ) : null}
      {busy && aspect !== null ? (
        <div
          className={styles.frame}
          data-uw-illustration-frame=''
          aria-busy='true'
          style={{ '--uw-illustration-aspect': aspect }}
        >
          <p className={styles.status}>{statusLabel}</p>
        </div>
      ) : null}
      {illustration.status === 'done' ? (
        blob.status === 'error' ? (
          <div className={styles.loadFailure}>
            <p className={styles.loadFailureText}>
              {blob.code === 'image_file_missing' ? t('play:illustration.missing') : t(`errors:${blob.code}`)}
            </p>
            <Button
              size='sm'
              variant='secondary'
              busy={actions.reroll.isPending}
              onClick={() => actions.reroll.mutate(illustration.id)}
            >
              {t('play:illustration.reroll')}
            </Button>
          </div>
        ) : (
          <div className={styles.frame} data-uw-illustration-frame='' style={{ '--uw-illustration-aspect': aspect }}>
            <button
              ref={returnFocus}
              type='button'
              className={styles.openButton}
              aria-label={t('play:illustration.open')}
              onClick={() => setOpen(true)}
            >
              <span className={styles.imageWrap}>
                {image ? (
                  <img
                    className={styles.image}
                    data-uw-decoded={loadedImage?.url === image.url ? '' : undefined}
                    src={image.url}
                    alt={caption ?? t('play:illustration.altFallback')}
                    onLoad={imageLoaded}
                  />
                ) : null}
                <span className={styles.dim} aria-hidden='true' />
              </span>
            </button>
          </div>
        )
      ) : null}
      {open && image ? (
        <IllustrationLightbox
          open={open}
          onOpenChange={setOpen}
          illustration={illustration}
          depth={depth}
          paraAnchorId={paraAnchorId}
          image={image}
          returnFocus={returnFocus}
          actions={actions}
        />
      ) : null}
    </div>
  );
}
