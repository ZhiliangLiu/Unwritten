import { Button as BaseButton } from '@base-ui/react/button';
import type { LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Icon } from './Icon.tsx';
import styles from './IconButton.module.css';

type IconButtonProps = Omit<ComponentProps<typeof BaseButton>, 'className' | 'children'> & {
  label: string;
  icon: LucideIcon;
  variant?: 'text' | 'secondary';
};

export function IconButton({ label, icon, variant = 'text', type = 'button', ...rest }: IconButtonProps) {
  return (
    <BaseButton
      {...rest}
      type={type}
      aria-label={label}
      className={`${styles.button} ${variant === 'secondary' ? styles.secondary : styles.text}`}
    >
      <Icon icon={icon} />
    </BaseButton>
  );
}
