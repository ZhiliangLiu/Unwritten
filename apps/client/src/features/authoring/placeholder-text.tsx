import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import styles from './placeholder-text.module.css';

export const PROTAGONIST_PLACEHOLDER_PATTERN = /\{\{protagonist\.([^{}]+)\}\}/gu;

export function PlaceholderText({ text }: { text: string }) {
  const { t } = useTranslation();
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(PROTAGONIST_PLACEHOLDER_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push(text.slice(lastIndex, index));
    parts.push(
      <span key={`${index}`} className={styles.token}>
        {t('authoring:placeholder.token', { name: match[1] })}
      </span>,
    );
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return <>{parts}</>;
}
