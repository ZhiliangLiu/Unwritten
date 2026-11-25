import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../../shared/api/query.ts";
import { useApi } from "../../shared/api/context.tsx";
import { ErrorNotice } from "../../shared/ui/Notice.tsx";
import { formatRelative } from "../../shared/lib/format.ts";
import styles from "../../app/app.module.css";

export function LibraryPage() {
  const api = useApi();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const works = useQuery({ queryKey: queryKeys.works, queryFn: () => api.works.list() });
  const create = useMutation({
    mutationFn: () => api.works.create({ workId: crypto.randomUUID() }),
    onSuccess: (work) => navigate({ to: "/works/$workId/edit", params: { workId: work.id } }),
  });

  return (
    <section className={styles.page}>
      <h1 className={styles.heading}>{t("library:page.heading")}</h1>
      <div>
        <button className={styles.button} onClick={() => create.mutate()} disabled={create.isPending}>
          {t("library:action.create")}
        </button>
      </div>
      <ErrorNotice error={works.error ?? create.error} />
      {works.isLoading ? <p className={styles.muted}>{t("common:status.loading")}</p> : null}
      {works.data?.length === 0 ? (
        <div className={styles.card}>
          <h2>{t("library:empty.heading")}</h2>
          <p className={styles.muted}>{t("library:empty.description")}</p>
        </div>
      ) : null}
      <div className={styles.cards}>
        {works.data?.map((work) => (
          <article className={styles.card} key={work.id}>
            <h2>{(work.title ?? work.label) || t("library:empty.heading")}</h2>
            {work.blurb ? <p className={styles.muted}>{work.blurb}</p> : null}
            <p className={styles.muted}>
              {t(work.status === "playable" ? "library:card.playable" : "library:card.draft")} ·{" "}
              {t("library:card.updated", { time: formatRelative(work.updatedAt) })}
            </p>
            <div className={styles.row}>
              {work.status === "playable" && work.routeId ? (
                <Link className={styles.button} to="/play/$routeId" params={{ routeId: work.routeId }}>
                  {t(work.hasProgress ? "library:card.resume" : "library:card.play")}
                </Link>
              ) : null}
              <Link
                className={`${styles.button} ${styles.secondary}`}
                to="/works/$workId/edit"
                params={{ workId: work.id }}
              >
                {t("library:card.edit")}
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
