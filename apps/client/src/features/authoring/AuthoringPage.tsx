import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../../shared/api/query.ts";
import { useApi } from "../../shared/api/context.tsx";
import { ErrorNotice } from "../../shared/ui/Notice.tsx";
import styles from "../../app/app.module.css";

export function AuthoringPage({ workId }: { workId: string }) {
  const api = useApi();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const work = useQuery({
    queryKey: queryKeys.work(workId),
    queryFn: () => api.works.get({ workId }),
    refetchInterval: 1_000,
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const background = draft ?? work.data?.draft.background ?? "";

  const save = useMutation({
    mutationFn: () =>
      api.works.saveBackground({
        workId,
        baseContentRev: work.data?.draft.contentRev ?? 0,
        background,
      }),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.work(workId) });
    },
    onError: setError,
  });

  const generate = useMutation({
    mutationFn: async () => {
      const saved =
        background === work.data?.draft.background
          ? { contentRev: work.data?.draft.contentRev ?? 0 }
          : await api.works.saveBackground({
              workId,
              baseContentRev: work.data?.draft.contentRev ?? 0,
              background,
            });
      const id = crypto.randomUUID();
      setJobId(id);
      return api.works.generatePreview({ workId, jobId: id, contentRev: saved.contentRev });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.work(workId) }); },
    onError: setError,
  });

  const adopt = useMutation({
    mutationFn: async () => {
      if (!jobId) throw new Error("no preview");
      return api.works.adoptPreview({ workId, jobId });
    },
    onSuccess: (result) => navigate({ to: "/play/$routeId", params: { routeId: result.routeId } }),
    onError: setError,
  });

  if (!work.data) return <p className={styles.muted}>{t("common:status.loading")}</p>;
  const published = work.data.status === "playable";
  const preview = work.data.latestPreviewJob?.preview ?? null;
  const job = work.data.latestPreviewJob;
  const stale = Boolean(job && job.basedOnContentRev !== work.data.draft.contentRev);
  const localDirty = background !== work.data.draft.background;

  return (
    <section className={styles.page}>
      <h1 className={styles.heading}>{t("authoring:page.heading")}</h1>
      <ErrorNotice error={error ?? work.error} />
      <label className={styles.label}>
        {t("authoring:background.label")}
        <span className={styles.muted}>{t("authoring:background.help")}</span>
        <textarea
          className={styles.textarea}
          value={background}
          readOnly={published}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <div className={styles.row}>
        <button className={styles.button} onClick={() => save.mutate()} disabled={published || !localDirty || save.isPending}>
          {t("authoring:background.save")}
        </button>
        <button
          className={styles.button}
          onClick={() => generate.mutate()}
          disabled={published || generate.isPending || !background.trim()}
        >
          {t("authoring:preview.generate")}
        </button>
        {localDirty ? <span className={styles.muted}>{t("authoring:background.unsaved")}</span> : null}
      </div>
      {published ? (
        <div className={styles.card}>
          <h2>{t("authoring:published.heading")}</h2>
          <div className={styles.row}>
            {work.data.routeId ? (
              <Link className={styles.button} to="/play/$routeId" params={{ routeId: work.data.routeId }}>
                {t("authoring:published.play")}
              </Link>
            ) : null}
            <Link className={`${styles.button} ${styles.secondary}`} to="/">
              {t("authoring:published.back")}
            </Link>
          </div>
        </div>
      ) : null}
      {job?.status === "running" ? <p className={styles.muted}>{t("authoring:preview.running")}</p> : null}
      {preview ? (
        <article className={styles.card}>
          <h2>{t("authoring:preview.heading")}</h2>
          <h3>{preview.title}</h3>
          <p className={styles.muted}>{preview.blurb}</p>
          <h3>{t("authoring:preview.setting")}</h3>
          <p>{preview.publicSetting}</p>
          <div className={styles.prose}>{preview.prose}</div>
          <ol>
            {preview.options.map((option) => (
              <li key={option.text}>{option.text}</li>
            ))}
          </ol>
          <button
            className={styles.button}
            onClick={() => adopt.mutate()}
            disabled={published || stale || localDirty || adopt.isPending}
          >
            {t("authoring:preview.adopt")}
          </button>
        </article>
      ) : null}
    </section>
  );
}
