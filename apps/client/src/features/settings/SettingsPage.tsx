import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../../shared/api/query.ts";
import { useApi } from "../../shared/api/context.tsx";
import { ErrorNotice } from "../../shared/ui/Notice.tsx";
import styles from "../../app/app.module.css";

export function SettingsPage() {
  const api = useApi();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: queryKeys.llm, queryFn: () => api.llm.providers.list() });
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [makeDefault, setMakeDefault] = useState(true);
  const [testResult, setTestResult] = useState<{ ok: boolean; code: string | null } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const test = useMutation({
    mutationFn: () =>
      api.llm.test({
        baseUrl,
        modelId,
        key: apiKey.trim() ? { action: "set", value: apiKey.trim() } : { action: "none" },
      }),
    onSuccess: (result) => setTestResult({ ok: result.ok, code: result.code }),
    onError: setError,
  });

  const create = useMutation({
    mutationFn: () =>
      api.llm.endpoints.create({
        requestId: crypto.randomUUID(),
        baseRevision: config.data?.revision ?? "absent",
        name,
        baseUrl,
        modelId,
        apiKey: apiKey.trim() || null,
        makeDefault,
      }),
    onSuccess: () => {
      setApiKey("");
      setTestResult(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.llm });
    },
    onError: setError,
  });

  const setDefault = useMutation({
    mutationFn: ({ endpointId, model }: { endpointId: string; model: string }) =>
      api.llm.purposes.set({
        baseRevision: config.data?.revision ?? "absent",
        purpose: "default",
        model: { endpointId, modelId: model },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.llm }),
    onError: setError,
  });

  return (
    <section className={styles.page}>
      <h1 className={styles.heading}>{t("settings:page.heading")}</h1>
      <ErrorNotice error={error ?? config.error} />
      <div className={styles.card}>
        <h2>{t("settings:current.heading")}</h2>
        {config.data?.defaultModel ? (
          <p>
            {config.data.defaultModel.endpointId} · {config.data.defaultModel.modelId}
          </p>
        ) : (
          <p className={styles.muted}>{t("settings:current.empty")}</p>
        )}
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <h2>{t("settings:endpoint.add")}</h2>
        <label className={styles.label}>
          {t("settings:endpoint.name")}
          <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className={styles.label}>
          {t("settings:endpoint.address")}
          <input className={styles.input} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
        </label>
        <label className={styles.label}>
          {t("settings:endpoint.modelId")}
          <input className={styles.input} value={modelId} onChange={(event) => setModelId(event.target.value)} />
        </label>
        <label className={styles.label}>
          {t("settings:endpoint.key")}
          <input
            className={styles.input}
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <span className={styles.muted}>{t("settings:endpoint.keyHelp")}</span>
        </label>
        <label className={styles.row}>
          <input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} />
          {t("settings:endpoint.default")}
        </label>
        <div className={styles.row}>
          <button type="button" className={styles.button} onClick={() => test.mutate()} disabled={test.isPending}>
            {t(test.isPending ? "settings:endpoint.testing" : "settings:endpoint.test")}
          </button>
          <button type="submit" className={styles.button} disabled={create.isPending}>
            {t("settings:endpoint.save")}
          </button>
        </div>
        {testResult ? (
          <p className={styles.muted}>
            {t(testResult.ok ? "settings:endpoint.testOk" : `errors:${testResult.code ?? "unknown"}`, {
              code: testResult.code,
            })}
          </p>
        ) : null}
      </form>
      <div className={styles.cards}>
        {config.data?.endpoints.map((endpoint) => (
          <article className={styles.card} key={endpoint.id}>
            <h2>{endpoint.name}</h2>
            <p className={styles.muted}>{endpoint.baseUrl}</p>
            <p>
              {endpoint.models.map((model) => model.id).join(", ")} ·{" "}
              {t(
                endpoint.key.hasKey
                  ? "settings:endpoint.keySet"
                  : endpoint.key.source === "env"
                    ? "settings:endpoint.keyEnvMissing"
                    : "settings:endpoint.keyMissing",
              )}
            </p>
            {endpoint.models[0] ? (
              <button
                className={`${styles.button} ${styles.secondary}`}
                onClick={() => setDefault.mutate({ endpointId: endpoint.id, model: endpoint.models[0]!.id })}
              >
                {t("settings:endpoint.default")}
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
