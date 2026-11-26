import { Toast as BaseToast } from '@base-ui/react/toast';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon.tsx';
import styles from './Toaster.module.css';

type ToastTone = 'success' | 'danger' | 'info';

function ToastList() {
  const { toasts } = BaseToast.useToastManager();
  return toasts.map((toast) => (
    <BaseToast.Root key={toast.id} toast={toast} className={styles.toast}>
      <BaseToast.Content className={styles.content}>
        <span className={styles.icon}>
          <Icon
            icon={toast.type === 'success' ? CircleCheck : toast.type === 'danger' ? CircleAlert : Info}
            size='sm'
          />
        </span>
        <BaseToast.Title className={styles.title} />
      </BaseToast.Content>
    </BaseToast.Root>
  ));
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <BaseToast.Provider>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className={styles.viewport} aria-label={t('common:toast.region')}>
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

export function useNotify(): (input: { title: string; tone: ToastTone }) => void {
  const manager = BaseToast.useToastManager();
  return (input) => {
    manager.add({ title: input.title, type: input.tone, priority: input.tone === 'danger' ? 'high' : 'low' });
  };
}
