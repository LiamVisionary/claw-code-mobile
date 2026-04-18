import { Router } from "express";
import { db } from "../db/sqlite";

export const analyticsRouter = Router();

type Range = "24h" | "7d" | "30d" | "all";

const sinceFor = (range: Range): string | null => {
  if (range === "all") return null;
  const now = Date.now();
  const ms =
    range === "24h"
      ? 24 * 60 * 60 * 1000
      : range === "7d"
      ? 7 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;
  return new Date(now - ms).toISOString();
};

/**
 * GET /analytics/stats?range=30d
 * Aggregates messages by model so the Budgeting tab can render a pie
 * chart + table without each client having to scan every row.
 */
analyticsRouter.get("/analytics/stats", (req, res) => {
  const raw = typeof req.query.range === "string" ? req.query.range : "30d";
  const range: Range = (["24h", "7d", "30d", "all"] as const).includes(
    raw as Range
  )
    ? (raw as Range)
    : "30d";
  const since = sinceFor(range);

  const params: Record<string, unknown> = {};
  let whereSince = "";
  if (since) {
    whereSince = "AND datetime(createdAt) >= datetime(@since)";
    params.since = since;
  }

  const perModel = db
    .prepare(
      `SELECT
         model,
         COUNT(*)                   AS messageCount,
         SUM(COALESCE(costUsd, 0))  AS totalCostUsd,
         SUM(COALESCE(tokensIn, 0)) AS totalTokensIn,
         SUM(COALESCE(tokensOut, 0)) AS totalTokensOut,
         AVG(turnDurationMs)        AS avgTurnDurationMs
       FROM messages
       WHERE model IS NOT NULL
         ${whereSince}
       GROUP BY model
       ORDER BY totalCostUsd DESC`
    )
    .all(params) as Array<{
    model: string;
    messageCount: number;
    totalCostUsd: number;
    totalTokensIn: number;
    totalTokensOut: number;
    avgTurnDurationMs: number | null;
  }>;

  // Breakdown by composer-mode selection. Rows where the column is NULL
  // are pre-migration turns (before we started recording mode); the
  // COALESCE(...,'unknown') keeps them in the aggregate so counts match
  // the totals block rather than silently dropping them.
  const perPlanMode = db
    .prepare(
      `SELECT
         COALESCE(planMode, 'unknown') AS planMode,
         COUNT(*)                      AS messageCount,
         SUM(COALESCE(costUsd, 0))     AS totalCostUsd,
         SUM(COALESCE(tokensIn, 0))    AS totalTokensIn,
         SUM(COALESCE(tokensOut, 0))   AS totalTokensOut
       FROM messages
       WHERE role = 'assistant'
         ${whereSince}
       GROUP BY COALESCE(planMode, 'unknown')
       ORDER BY messageCount DESC`
    )
    .all(params) as Array<{
    planMode: "act" | "plan" | "unknown";
    messageCount: number;
    totalCostUsd: number;
    totalTokensIn: number;
    totalTokensOut: number;
  }>;

  const perReasoningEffort = db
    .prepare(
      `SELECT
         COALESCE(reasoningEffort, 'unknown') AS reasoningEffort,
         COUNT(*)                             AS messageCount,
         SUM(COALESCE(costUsd, 0))            AS totalCostUsd,
         SUM(COALESCE(tokensIn, 0))           AS totalTokensIn,
         SUM(COALESCE(tokensOut, 0))          AS totalTokensOut
       FROM messages
       WHERE role = 'assistant'
         ${whereSince}
       GROUP BY COALESCE(reasoningEffort, 'unknown')
       ORDER BY messageCount DESC`
    )
    .all(params) as Array<{
    reasoningEffort: "low" | "medium" | "high" | "unknown";
    messageCount: number;
    totalCostUsd: number;
    totalTokensIn: number;
    totalTokensOut: number;
  }>;

  const totals = perModel.reduce(
    (acc, row) => {
      acc.messageCount += row.messageCount;
      acc.totalCostUsd += row.totalCostUsd ?? 0;
      acc.totalTokensIn += row.totalTokensIn ?? 0;
      acc.totalTokensOut += row.totalTokensOut ?? 0;
      return acc;
    },
    {
      messageCount: 0,
      totalCostUsd: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
    }
  );

  res.json({
    range,
    since,
    totals,
    models: perModel,
    planModes: perPlanMode,
    reasoningEfforts: perReasoningEffort,
  });
});
