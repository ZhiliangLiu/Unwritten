import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../../shared/api/query.ts";
import { useApi } from "../../shared/api/context.tsx";
import { ErrorNotice, LiveRegion } from "../../shared/ui/Notice.tsx";
import { useEnterToSubmit } from "../../shared/hooks/useEnterToSubmit.ts";
import styles from "../../app/app.module.css";

export function PlayPage({ routeId }: { routeId: string }) {
  const api = useApi();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [announcement, setAnnouncement] = useState("");
  const route = useQuery({
    queryKey: queryKeys.route(routeId),
    queryFn: () => api.play.getRoute({ routeId }),
    refetchInterval: 1_000,
  });

  const submit = useMutation({
    mutationFn: (input: { text: string; optionIndex: number | null }) =>
      api.play.submitAction({
        requestId: crypto.randomUUID(),
        routeId,
        expectedHeadTurnId: route.data?.headTurnId ?? "",
        action: { text: input.text, optionIndex: input.optionIndex },
      }),
    onSuccess: () => {
      setText("");
      setAnnouncement(t("play:pending.running"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.route(routeId) });
    },
    onError: setError,
  });

  const retry = useMutation({
    mutationFn: (requestId: string) => api.play.retry({ requestId }),
    onSuccess: () => {
      setAnnouncement(t("play:pending.running"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.route(routeId) });
    },
    onError: setError,
  });

  const enter = useEnterToSubmit(() => submit.mutate({ text: text.trim(), optionIndex: null }));

  if (!route.data) return <p className={styles.muted}>{t("common:status.loading")}</p>;
  const latest = route.data.turns.at(-1);
  const pending = route.data.pending;
  const busy = pending?.status === "running" || submit.isPending;

  return (
    <section className={styles.page}>
      <h1 className={styles.heading}>{route.data.workTitle ?? t("play:turn.opening")}</h1>
      <ErrorNotice error={error ?? route.error} />
      <LiveRegion message={announcement} />
      <div className={styles.history}>
        {route.data.turns.map((turn) => (
          <article className={styles.chapter} key={turn.id} lang={route.data.language}>
            <h2 className={styles.muted}>
              {turn.depth === 0 ? t("play:turn.opening") : t("play:turn.heading", { count: turn.depth })}
            </h2>
            {turn.action ? <p className={styles.action}>{turn.action.text}</p> : null}
            <div className={styles.prose}>{turn.prose}</div>
          </article>
        ))}
      </div>
      {pending?.status === "running" ? (
        <p className={styles.muted}>{t("play:pending.running")}</p>
      ) : null}
      {pending?.status === "failed" ? (
        <div className={styles.card}>
          <p>{t("play:pending.failed")}</p>
          <p className={styles.action}>{pending.action.text}</p>
          <button className={styles.button} onClick={() => retry.mutate(pending.id)} disabled={retry.isPending}>
            {t("play:pending.retry")}
          </button>
        </div>
      ) : null}
      {latest ? (
        <div className={styles.options}>
          {latest.options.map((option, index) => (
            <button
              key={option.text}
              className={`${styles.button} ${styles.secondary}`}
              onClick={() => submit.mutate({ text: option.text, optionIndex: index + 1 })}
              disabled={busy}
            >
              {option.text}
            </button>
          ))}
        </div>
      ) : null}
      <label className={styles.label}>
        {t("play:input.label")}
        <textarea
          className={styles.textarea}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onCompositionStart={enter.onCompositionStart}
          onCompositionEnd={enter.onCompositionEnd}
          onKeyDown={enter.onKeyDown}
          placeholder={t("play:input.placeholder")}
          disabled={busy}
        />
        <span className={styles.muted}>{t("play:input.help")}</span>
      </label>
      <button
        className={styles.button}
        onClick={() => submit.mutate({ text: text.trim(), optionIndex: null })}
        disabled={busy || !text.trim()}
      >
        {t("play:input.submit")}
      </button>
    </section>
  );
}
