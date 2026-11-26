import { Button as BaseButton } from '@base-ui/react/button';
import type { LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Icon } from './Icon.tsx';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger' | 'danger-solid';
export type ButtonSize = 'sm' | 'md';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: styles.primary!,
  secondary: styles.secondary!,
  text: styles.text!,
  danger: styles.danger!,
  'danger-solid': styles.dangerSolid!,
};

export function buttonClassName(variant: ButtonVariant, size: ButtonSize = 'md'): string {
  return `${styles.button} ${VARIANT_CLASS[variant]} ${size === 'sm' ? styles.sm : styles.md}`;
}

type ButtonProps = Omit<ComponentProps<typeof BaseButton>, 'className'> & {
  variant: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  busy?: boolean;
  className?: string;
};

export function Button({
  variant,
  size = 'md',
  icon,
  busy = false,
  disabled,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <BaseButton
      {...rest}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy ? true : undefined}
      className={className ? `${buttonClassName(variant, size)} ${className}` : buttonClassName(variant, size)}
    >
      {icon ? <Icon icon={icon} size={size === 'sm' ? 'sm' : 'md'} /> : null}
      {children}
    </BaseButton>
  );
}
