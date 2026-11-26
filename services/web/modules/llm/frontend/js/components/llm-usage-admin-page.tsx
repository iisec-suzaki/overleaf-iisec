import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { debugConsole } from "@/utils/debugging";
import { getJSON } from "@/infrastructure/fetch-json";
import useAsync from "@/shared/hooks/use-async";
import Notification from "@/shared/components/notification";

type UsageRow = {
  userId: string;
  email: string;
  name: string;
  label: string;
  llmCalls: number;
  llmTokens: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  mcpCalls: number;
  mcpReadBytes: number;
  mcpWriteBytes: number;
  mcpTotalBytes: number;
};

type UsageReport = {
  ok: boolean;
  days: number;
  rows: UsageRow[];
  totals: {
    llmCalls: number;
    llmTokens: number;
    mcpCalls: number;
    mcpReadBytes: number;
    mcpWriteBytes: number;
    mcpTotalBytes: number;
  };
};

const WINDOWS = [7, 30, 90];

function formatBytes(n?: number | null): string {
  if (!n || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const val = n / Math.pow(1024, i);
  const rounded = i === 0 ? String(Math.round(val)) : val.toFixed(val >= 100 ? 0 : 1);
  return `${rounded} ${units[i]}`;
}

function formatNumber(n?: number | null): string {
  return (n ?? 0).toLocaleString();
}

export const LLMUsageAdminPage = function LLMUsageAdminPage() {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { runAsync, isLoading } = useAsync();

  const load = useCallback(() => {
    setError(null);
    runAsync(getJSON<UsageReport>(`/admin/usage/json?days=${days}`))
      .then((data) => setReport(data))
      .catch((err) => {
        debugConsole.error("admin/usage: load failed", err);
        setError(
          t(
            "admin_usage_load_error",
            "The usage report could not be loaded. Please try again.",
          ),
        );
      });
  }, [days, runAsync, t]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = report?.totals;
  const rows = report?.rows || [];

  return (
    <div style={{ padding: "var(--spacing-05)" }}>
      <h1>{t("admin_usage_title", "LLM & MCP Usage")}</h1>
      <p className="small">
        {t(
          "admin_usage_intro",
          "Who is using the LLM and the personal MCP server, and how much, over the selected window.",
        )}
      </p>

      <div className="d-flex gap-2 mb-2" style={{ alignItems: "center" }}>
        <label className="small" htmlFor="usage-window">
          {t("admin_usage_window", "Window")}
        </label>
        <select
          id="usage-window"
          className="form-control"
          style={{ maxWidth: "12rem" }}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          disabled={isLoading}
        >
          {WINDOWS.map((d) => (
            <option key={d} value={d}>
              {t("admin_usage_days_option", { days: d, defaultValue: `Last ${d} days` })}
            </option>
          ))}
        </select>
      </div>

      {error ? <Notification type="error" content={error} /> : null}

      {totals ? (
        <div className="well well-sm mb-2">
          <strong>{t("admin_usage_totals", "Totals")} ({days}d):</strong>{" "}
          {t("admin_usage_llm", "LLM")} {formatNumber(totals.llmCalls)}{" "}
          {t("admin_usage_calls", "calls")} · {formatNumber(totals.llmTokens)}{" "}
          {t("admin_usage_tokens", "tokens")} &nbsp;|&nbsp;{" "}
          {t("admin_usage_mcp", "MCP")} {formatNumber(totals.mcpCalls)}{" "}
          {t("admin_usage_calls", "calls")} ·{" "}
          {t("admin_usage_read", "Read")} {formatBytes(totals.mcpReadBytes)} ·{" "}
          {t("admin_usage_written", "Written")} {formatBytes(totals.mcpWriteBytes)}
        </div>
      ) : null}

      {rows.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>{t("admin_usage_user", "User")}</th>
              <th className="text-nowrap">
                {t("admin_usage_llm_calls", "LLM calls")}
              </th>
              <th className="text-nowrap">
                {t("admin_usage_llm_tokens", "LLM tokens")}
              </th>
              <th className="text-nowrap">
                {t("admin_usage_mcp_calls", "MCP calls")}
              </th>
              <th className="text-nowrap">{t("admin_usage_read", "Read")}</th>
              <th className="text-nowrap">
                {t("admin_usage_written", "Written")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId || "__site__"}>
                <td>
                  {r.label}
                  {r.name && r.email ? (
                    <span className="small text-muted"> ({r.name})</span>
                  ) : null}
                </td>
                <td className="small">{formatNumber(r.llmCalls)}</td>
                <td className="small">{formatNumber(r.llmTokens)}</td>
                <td className="small">{formatNumber(r.mcpCalls)}</td>
                <td className="small">{formatBytes(r.mcpReadBytes)}</td>
                <td className="small">{formatBytes(r.mcpWriteBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="small">
          {t(
            "admin_usage_no_data",
            "No usage recorded for this window yet.",
          )}
        </p>
      )}
    </div>
  );
};

export default LLMUsageAdminPage;
