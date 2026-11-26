import type { ConfigProblem as ConfigProblemData } from '@unwritten/contracts';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../shared/ui/Icon.tsx';
import styles from './ConfigProblem.module.css';

export function ConfigProblem({ problem }: { problem: ConfigProblemData }) {
  const { t } = useTranslation();

  return (
    <div className={styles.notice} role='alert'>
      <div className={styles.heading}>
        <span className={styles.icon}>
          <Icon icon={CircleAlert} />
        </span>
        <p className={styles.message}>
          {problem.kind === 'syntax'
            ? t('settings:problem.syntax', { line: problem.line, column: problem.column })
            : problem.kind === 'schema'
              ? t('settings:problem.schema', { path: problem.path })
              : t('settings:problem.tooNew')}
        </p>
      </div>
      {'message' in problem ? <p className={styles.detail}>{problem.message}</p> : null}
    </div>
  );
}
