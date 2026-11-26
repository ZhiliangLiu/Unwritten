import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from './IconButton.tsx';
import styles from './SideSheet.module.css';

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function SideSheet({
  open,
  onOpenChange,
  title,
  children,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  finalFocus?: ComponentProps<typeof Dialog.Popup>['finalFocus'];
}) {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!open || !body || body.querySelector(FOCUSABLE)) return;
    body.setAttribute('role', 'group');
    body.setAttribute('aria-label', title);
    body.tabIndex = 0;
  }, [open, title]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.sheet} finalFocus={finalFocus}>
          <header className={styles.header}>
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
            <Dialog.Close render={<IconButton label={t('common:action.close')} icon={X} />} />
          </header>
          <div ref={bodyRef} className={styles.body}>
            {children}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
