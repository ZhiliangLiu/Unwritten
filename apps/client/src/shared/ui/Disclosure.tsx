import { Collapsible } from '@base-ui/react/collapsible';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import styles from './Disclosure.module.css';

export function Disclosure({
  summary,
  children,
  heading,
  open,
  onOpenChange,
  className,
  panelClassName,
}: {
  summary: ReactNode;
  children: ReactNode;
  heading?: 'h3' | 'h4';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  panelClassName?: string;
}) {
  const trigger = (
    <Collapsible.Trigger className={styles.trigger}>
      <span className={styles.chevron}>
        <Icon icon={ChevronRight} size='sm' />
      </span>
      <span className={styles.summary}>{summary}</span>
    </Collapsible.Trigger>
  );
  const Heading = heading;

  return (
    <Collapsible.Root
      className={className ? `${styles.root} ${className}` : styles.root}
      open={open}
      onOpenChange={onOpenChange}
    >
      {Heading ? <Heading className={styles.heading}>{trigger}</Heading> : trigger}
      <Collapsible.Panel className={panelClassName ? `${styles.panel} ${panelClassName}` : styles.panel}>
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
