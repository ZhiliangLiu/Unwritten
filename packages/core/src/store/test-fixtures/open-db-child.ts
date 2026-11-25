import { openDatabase, DataDirLockedError } from '../db.ts';

const file = process.argv[2];
if (!file) process.exit(2);

try {
  openDatabase(file).close();
  process.send?.({ locked: false, name: 'ok' }, () => process.exit(0));
} catch (error) {
  process.send?.(
    { locked: error instanceof DataDirLockedError, name: error instanceof Error ? error.name : String(error) },
    () => process.exit(0),
  );
}
