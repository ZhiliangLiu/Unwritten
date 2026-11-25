import { useTranslation } from "react-i18next";
import { errorCode, errorDetail } from "../api/errors.ts";
import styles from "../../app/app.module.css";

export function ErrorNotice({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const code = errorCode(error);
  const detail = errorDetail(error);
  return (
    <div className={styles.notice} role="alert">
      <p>{t(`errors:${code}`, { code })}</p>
      {detail ? <p className={styles.detail}>{detail}</p> : null}
    </div>
  );
}

export function LiveRegion({ message }: { message: string }) {
  return (
    <div className={styles.live} aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
