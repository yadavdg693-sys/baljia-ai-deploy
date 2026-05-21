# forecasting

Lightweight time-series forecasting in pure JavaScript — moving averages,
linear regression, exponential smoothing. Read this skill BEFORE building any
"projected revenue", "expected churn", "next 30 days" feature. No external
deps required (no Prophet, no scikit, no heavy ML libs — those don't fit on
Render free).

Agents that skip this skill consistently:
1. Reach for Python / Prophet / TensorFlow.js — overkill, won't deploy
2. Plot a flat average and call it a "forecast"
3. Forget to handle missing data points and produce NaN charts
4. Use linear regression on cyclical data and predict negative revenue

---

## Pick the right method

| Data shape | Method | When |
|---|---|---|
| Noisy daily values, no trend | **Simple Moving Average (SMA)** | Smooth a chart for display |
| Recent values matter more | **Exponential Weighted Moving Average (EWMA)** | Anomaly detection, "current rate" |
| Clear linear trend (signups growing steadily) | **Linear Regression** | "Where will we be in 30 days?" |
| Trend + noise, want adaptive smoothing | **Holt's Linear (Double Exp. Smoothing)** | Better forecasts than plain LR for short horizons |
| Seasonality (weekly/monthly cycles) | **Holt-Winters (Triple Exp. Smoothing)** | Weekly retail, weekday-vs-weekend traffic |

**Default to EWMA + Holt's Linear.** Together they cover ~80% of founder-app use
cases (revenue projection, signup trend, usage growth).

---

## Helpers — copy into `lib/forecast.ts`

```ts
// lib/forecast.ts
// Pure JS time-series helpers. No deps.

export type Point = { t: number; y: number };  // t = unix ms or day index, y = value

// ─────────────────────────────────────────────
// 1. Simple Moving Average
// ─────────────────────────────────────────────
export function sma(values: number[], window: number): number[] {
  if (window <= 0) throw new Error('window must be > 0');
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    out.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return out;
}

// ─────────────────────────────────────────────
// 2. Exponential Weighted Moving Average
// alpha in (0, 1]. Higher = react faster, more noise. 0.3 is a sane default.
// ─────────────────────────────────────────────
export function ewma(values: number[], alpha = 0.3): number[] {
  if (alpha <= 0 || alpha > 1) throw new Error('alpha must be in (0, 1]');
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (const v of values) {
    prev = alpha * v + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}

// ─────────────────────────────────────────────
// 3. Linear Regression — y = slope * x + intercept
// Pass equally-spaced points. Returns slope + intercept + r² (fit quality).
// ─────────────────────────────────────────────
export function linearRegression(values: number[]): {
  slope: number; intercept: number; r2: number;
} {
  const n = values.length;
  if (n < 2) throw new Error('need at least 2 points');

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // r² for fit quality
  const meanY = sumY / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yHat = slope * i + intercept;
    ssRes += (values[i] - yHat) ** 2;
    ssTot += (values[i] - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slope, intercept, r2 };
}

export function projectLinear(values: number[], stepsAhead: number): number[] {
  const { slope, intercept } = linearRegression(values);
  const out: number[] = [];
  for (let i = 0; i < stepsAhead; i++) {
    const x = values.length + i;
    out.push(Math.max(0, slope * x + intercept));  // clamp to 0 for counts
  }
  return out;
}

// ─────────────────────────────────────────────
// 4. Holt's Linear (double exponential smoothing)
// Adapts to trend changes. Better than LR for short-horizon forecasts.
// alpha = level smoothing, beta = trend smoothing. Both in (0, 1).
// ─────────────────────────────────────────────
export function holtLinear(
  values: number[],
  stepsAhead: number,
  alpha = 0.4,
  beta = 0.2,
): number[] {
  if (values.length < 2) throw new Error('need at least 2 points');

  let level = values[0];
  let trend = values[1] - values[0];

  for (let i = 1; i < values.length; i++) {
    const prevLevel = level;
    level = alpha * values[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }

  const forecast: number[] = [];
  for (let h = 1; h <= stepsAhead; h++) {
    forecast.push(Math.max(0, level + h * trend));
  }
  return forecast;
}

// ─────────────────────────────────────────────
// 5. Fill missing days — turns sparse [{t, y}] into dense daily series
// ─────────────────────────────────────────────
export function fillDailyGaps(points: Point[], fillValue = 0): Point[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const out: Point[] = [];
  const start = startOfDayUTC(sorted[0].t);
  const end = startOfDayUTC(sorted[sorted.length - 1].t);
  const map = new Map(sorted.map((p) => [startOfDayUTC(p.t), p.y]));
  for (let t = start; t <= end; t += ONE_DAY) {
    out.push({ t, y: map.get(t) ?? fillValue });
  }
  return out;
}

function startOfDayUTC(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
```

---

## End-to-end example: 30-day signup forecast

```ts
// src/app/api/forecast/signups/route.ts
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { fillDailyGaps, holtLinear, linearRegression } from '@/lib/forecast';

export async function GET() {
  // 1. Pull last 60 days of daily signup counts
  const result = await db.execute(sql`
    SELECT date_trunc('day', created_at) AS day, COUNT(*)::text AS count
    FROM users
    WHERE created_at >= NOW() - INTERVAL '60 days'
    GROUP BY 1 ORDER BY 1
  `);
  const rows = result.rows as Array<{ day: string; count: string }>;

  // 2. Densify (fill missing days with 0)
  const points = fillDailyGaps(
    rows.map((r) => ({ t: new Date(r.day).getTime(), y: Number(r.count) })),
  );
  const series = points.map((p) => p.y);

  if (series.length < 7) {
    return NextResponse.json({ error: 'Not enough history (need ≥ 7 days)' }, { status: 400 });
  }

  // 3. Forecast next 30 days with Holt's Linear
  const forecast = holtLinear(series, 30);

  // 4. Confidence note based on linear fit quality
  const { r2 } = linearRegression(series);
  const confidence = r2 > 0.7 ? 'high' : r2 > 0.4 ? 'medium' : 'low';

  return NextResponse.json({
    history: points,
    forecast: forecast.map((y, i) => ({
      t: points[points.length - 1].t + (i + 1) * 86_400_000,
      y: Math.round(y),
    })),
    confidence,
    method: 'holt-linear',
  });
}
```

---

## Choosing alpha / beta

You almost never need to tune these. Defaults that work:

| Use case | alpha | beta |
|---|---|---|
| Anomaly detection (EWMA) | 0.3 | — |
| "Recent rate" (EWMA) | 0.5 | — |
| Holt's Linear default | 0.4 | 0.2 |
| Holt's Linear, very noisy data | 0.2 | 0.1 |
| Holt's Linear, fast-changing trend | 0.6 | 0.4 |

If you must tune, do a grid-search over `alpha, beta ∈ {0.1, 0.2, ..., 0.9}` and
minimize MAE on a held-out tail (last 14 days). 81 combinations runs in under
50ms — don't import a library for this.

---

## Anti-patterns

| ❌ Wrong | ✅ Right |
|---|---|
| `npm install prophet` / `tensorflow.js` | Pure-JS helpers above |
| Plotting `mean(values)` as a "forecast" | Use Holt's Linear or LR |
| LR on signups data with weekly cycles | Acknowledge cycle exists; either ignore (short horizon) or use Holt-Winters |
| Forecasting from 3 data points | Require ≥ 7 points; return `{ error: 'not enough history' }` |
| Negative forecasts for counts (signups, sales) | Clamp with `Math.max(0, ...)` |
| Sparse data passed straight to SMA → wildly wrong window | Always `fillDailyGaps` first |
| Showing a forecast without uncertainty | Surface `confidence` (high/medium/low) from r² |

---

## Verification Checklist

- [ ] Input series is dense (no missing days) — used `fillDailyGaps`
- [ ] At least 7 data points present — otherwise return error, not garbage
- [ ] Forecast values clamped to `Math.max(0, ...)` for counts/revenue
- [ ] Confidence label exposed to UI (`high` / `medium` / `low`)
- [ ] No external forecasting deps in `package.json`
- [ ] Tested: feed in a known linear series (e.g. `[1,2,3,4,5,6,7]`) and verify projection ≈ `[8,9,10]`
