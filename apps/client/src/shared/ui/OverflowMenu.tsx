import { Menu } from '@base-ui/react/menu';
import { Ellipsis } from 'lucide-react';
import { IconButton } from './IconButton.tsx';
import styles from './OverflowMenu.module.css';

export function OverflowMenu({
  label,
  items,
}: {
  label: string;
  items: Array<{ label: string; onSelect: () => void; tone?: 'danger' }>;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger render={<IconButton label={label} icon={Ellipsis} />} />
      <Menu.Portal>
        <Menu.Positioner sideOffset={4}>
          <Menu.Popup className={styles.popup}>
            {items.map((item) => (
              <Menu.Item
                key={item.label}
                className={item.tone === 'danger' ? `${styles.item} ${styles.danger}` : styles.item}
                onClick={item.onSelect}
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
