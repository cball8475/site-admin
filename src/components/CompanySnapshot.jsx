// CompanySnapshot.jsx — comprehensive FSC business snapshot
// Pulls from florence-crm-api (v2.11.0+):
//   /stats, /leads/analytics, /ads/metrics, /seo/metrics, /prospects
// Each section is independent — one source failing won't crash the whole tile.
//
// Required Netlify env: VITE_CRM_API_URL, VITE_CRM_API_TOKEN

import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  ComposedChart, Line, Legend,
} from 'recharts';

const API_BASE = import.meta.env.VITE_CRM_API_URL || '';
const API_TOKEN = import.meta.env.VITE_CRM_API_TOKEN || '';

// ── Styles ─────────────────────────────────────────────────────────────────
const C = {
  bg: '#070d14', panel: '#0e1a26', card: '#142031',
  border: 'rgba(99,179,237,0.12)', borderStrong: 'rgba(99,179,237,0.22)',
  muted: 'rgba(200,223,240,0.4)', faint: 'rgba(200,223,240,0.25)', text: '#c8dff0',
  green: '#22c55e', amber: '#f59e0b', blue: '#38bdf8', red: '#ef4444', purple: '#a78bfa',
};

// ── Status (RYG) ──────────────────────────────────────────────────────────
// Status = 'green' | 'yellow' | 'red' | null (neutral, no bar shown)
const STATUS_COLOR = {
  green: '#22c55e',
  yellow: '#f59e0b',
  red: '#ef4444',
};

// Trend-based status: compare current vs previous period.
// Volatility floor: if both periods are below `minSample`, return null (neutral).
// `lowerBetter`: for spend, CPC, position — flips so down = good.
// `yellowMax`: % degradation that's still yellow (default 25). Beyond → red.
function trendStatus(current, previous, opts = {}) {
  const { lowerBetter = false, minSample = 0, yellowMax = 25 } = opts;
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (c < minSample && p < minSample) return null;
  if (!p) return null;
  let pct = ((c - p) / p) * 100;
  if (lowerBetter) pct = -pct;
  if (pct >= 0) return 'green';
  if (pct >= -yellowMax) return 'yellow';
  return 'red';
}

// Absolute-band status: bucket a single value against fixed thresholds.
// `lowerBetter`: ≤ greenAt is green (e.g. position, CPC).
function absoluteStatus(value, opts = {}) {
  const { greenAt, yellowAt, lowerBetter = false } = opts;
  const v = Number(value);
  if (isNaN(v)) return null;
  if (lowerBetter) {
    if (v <= greenAt) return 'green';
    if (v <= yellowAt) return 'yellow';
    return 'red';
  }
  if (v >= greenAt) return 'green';
  if (v >= yellowAt) return 'yellow';
  return 'red';
}

const fontStack = "'IBM Plex Sans', system-ui, sans-serif";
const monoStack = "'IBM Plex Mono', monospace";

// ── Utilities ──────────────────────────────────────────────────────────────
const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtMoneyDecimal = (n) => '$' + Number(n || 0).toFixed(2);
const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');
const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const daysBetween = (iso1, iso2) => {
  const a = new Date(iso1), b = new Date(iso2);
  return Math.round((b - a) / 86400000);
};

function deltaPct(current, previous) {
  if (!previous || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

async function fetchJson(path, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${path} → ${res.status}: ${body.slice(0, 120)}`);
  }
  return res.json();
}

// ── Tiny components ────────────────────────────────────────────────────────
function Delta({ value, suffix = '%', invert = false }) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  const isPositive = n > 0;
  const isGood = invert ? !isPositive : isPositive;
  const color = n === 0 ? C.muted : isGood ? C.green : C.red;
  const arrow = n > 0 ? '↑' : n < 0 ? '↓' : '—';
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color, marginLeft: 6 }}>
      {arrow}{Math.abs(n)}{suffix}
    </span>
  );
}

function StatCard({ label, value, sub, accent, status }) {
  const barColor = status ? STATUS_COLOR[status] : null;
  const valueColor = barColor || accent || C.text;
  return (
    <div style={{
      flex: '1 1 160px', minWidth: 0,
      padding: barColor ? '17px 16px 14px' : '14px 16px',
      background: C.panel, border: `1px solid ${C.border}`,
      borderRadius: 10,
      position: 'relative', overflow: 'hidden',
    }}>
      {barColor && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: barColor,
        }} />
      )}
      <div style={{
        fontSize: 10, color: C.muted, textTransform: 'uppercase',
        letterSpacing: 0.8, fontWeight: 600, marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontSize: 22, fontWeight: 700, color: valueColor,
        fontFamily: monoStack, lineHeight: 1.1,
      }}>{value}</div>
      {sub != null && (
        <div style={{ marginTop: 4, fontSize: 11, color: C.muted, fontFamily: monoStack }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Section({ title, right, children }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div style={{
          fontSize: 11, color: C.muted, textTransform: 'uppercase',
          letterSpacing: 1, fontWeight: 600,
        }}>{title}</div>
        {right && <div style={{ fontSize: 11, color: C.faint, fontFamily: monoStack }}>{right}</div>}
      </div>
      {children}
    </div>
  );
}

function ErrorBanner({ section, error }) {
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 8,
      background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
      fontSize: 12, color: C.red, fontFamily: monoStack,
    }}>
      {section} unavailable — {error}
    </div>
  );
}

function PendingPanel({ message }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 8,
      background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)',
      fontSize: 12, color: C.amber, fontFamily: monoStack,
    }}>
      {message}
    </div>
  );
}

function BreakdownTable({ rows, labelKey = 'label', valueKey = 'value', total }) {
  const safeRows = rows || [];
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: '8px 0',
    }}>
      {safeRows.length === 0 && (
        <div style={{ padding: '8px 14px', fontSize: 12, color: C.faint, fontFamily: monoStack }}>
          No data
        </div>
      )}
      {safeRows.map((row, i) => {
        const label = row[labelKey] ?? '—';
        const value = Number(row[valueKey] || 0);
        const pct = total > 0 ? (value / total) * 100 : 0;
        return (
          <div key={i} style={{ padding: '6px 14px', position: 'relative' }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${pct}%`, background: 'rgba(56,189,248,0.06)',
              borderRight: pct > 0 && pct < 100 ? '1px solid rgba(56,189,248,0.15)' : 'none',
            }} />
            <div style={{
              position: 'relative', display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', fontSize: 12.5,
            }}>
              <span style={{ color: C.text, textTransform: 'capitalize' }}>{String(label)}</span>
              <span style={{ color: C.muted, fontFamily: monoStack, fontWeight: 600 }}>{fmtNum(value)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function CompanySnapshot() {
  const [days, setDays] = useState(7);

  // Each section has its own state — one failure doesn't crash the rest
  const [stats, setStats] = useState(null);
  const [leadsAnalytics, setLeadsAnalytics] = useState(null);
  const [ads, setAds] = useState(null);
  const [seo, setSeo] = useState(null);
  const [operators, setOperators] = useState(null);
  const [competitors, setCompetitors] = useState(null);
  const [backlinks, setBacklinks] = useState(null);

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  async function loadAll() {
    setLoading(true);
    setErrors({});
    const errs = {};

    const sources = [
      ['stats', '/stats', setStats],
      ['leadsAnalytics', `/leads/analytics?days=${days}`, setLeadsAnalytics],
      ['ads', `/ads/metrics?days=${days}`, setAds],
      ['seo', `/seo/metrics?days=${days}`, setSeo],
      ['operators', '/prospects?operator_status=pilot_active', setOperators],
      ['competitors', '/competitors/auction-insights', setCompetitors],
      ['backlinks', '/seo/backlinks', setBacklinks],
    ];

    await Promise.all(sources.map(async ([key, path, setter]) => {
      try {
        const data = await fetchJson(path);
        setter(data);
      } catch (e) {
        errs[key] = e.message;
        setter(null);
      }
    }));

    setErrors(errs);
    setLoading(false);
  }

  // ─── Initial loading state ──────────────────────────────────────────────
  if (loading && !stats && !ads && !seo) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontFamily: fontStack }}>
        Loading company snapshot…
      </div>
    );
  }

  return (
    <div style={{ fontFamily: fontStack, color: C.text, paddingBottom: 40 }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 18, flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <h2 style={{
            margin: 0, fontSize: 18, fontWeight: 700, color: C.text,
            letterSpacing: -0.3,
          }}>
            Company Snapshot
          </h2>
          <div style={{
            fontSize: 11, color: C.muted, fontFamily: monoStack, marginTop: 4,
          }}>
            {ads?.current_range
              ? `${fmtDate(ads.current_range.start)} → ${fmtDate(ads.current_range.end)}`
              : `Last ${days} days`}
            {' · vs prior period'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setDays(d)} style={{
              padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              fontFamily: fontStack,
              background: days === d ? 'rgba(56,189,248,0.18)' : 'transparent',
              color: days === d ? C.blue : C.muted,
              border: `1px solid ${days === d ? 'rgba(56,189,248,0.4)' : C.border}`,
              cursor: 'pointer',
            }}>
              {d}d
            </button>
          ))}
          <button onClick={loadAll} title="Refresh" style={{
            marginLeft: 6, padding: '5px 10px', borderRadius: 6,
            fontSize: 11, fontFamily: fontStack,
            background: 'transparent', color: C.muted,
            border: `1px solid ${C.border}`, cursor: 'pointer',
          }}>
            ↻
          </button>
        </div>
      </div>

      {/* ── Top KPI Row ────────────────────────────────────────────────── */}
      {(() => {
        // Status for top KPIs — bespoke per metric per the agreed thresholds
        const activeOps = stats?.active_operators ?? 0;
        const activePilots = stats?.active_pilots ?? 0;
        const opsStatus = activeOps >= 1 ? 'green' : activePilots >= 1 ? 'yellow' : 'red';

        const leadsStatus = leadsAnalytics?.total_leads != null
          ? absoluteStatus(leadsAnalytics.total_leads, { greenAt: 10, yellowAt: 3 })
          : null;

        // Conversion: only judge if at least 3 leads have resolved
        const convResolved = leadsAnalytics?.resolved ?? 0;
        const convPct = parseFloat(leadsAnalytics?.conversion_rate); // "18.5%" → 18.5
        const convStatus = (convResolved >= 3 && !isNaN(convPct))
          ? absoluteStatus(convPct, { greenAt: 15, yellowAt: 5 })
          : null;

        // Revenue: green if any revenue at all; null otherwise (pre-CSA, $0 expected)
        const revenue = leadsAnalytics?.total_revenue ?? 0;
        const revStatus = revenue > 0 ? 'green' : null;

        return (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <StatCard
              label="Active Operators"
              value={stats?.active_operators ?? '—'}
              sub={
                stats?.active_pilots != null
                  ? `${stats.active_pilots} on trial`
                  : null
              }
              status={opsStatus}
            />
            <StatCard
              label={`Leads (${days}d)`}
              value={leadsAnalytics?.total_leads ?? '—'}
              sub={
                leadsAnalytics?.avg_response_time_minutes != null
                  ? `${Math.round(leadsAnalytics.avg_response_time_minutes)}m avg response`
                  : null
              }
              status={leadsStatus}
            />
            <StatCard
              label="Conversion"
              value={leadsAnalytics?.conversion_rate ?? '—'}
              sub={
                leadsAnalytics?.converted != null && leadsAnalytics?.resolved != null
                  ? `${leadsAnalytics.converted} of ${leadsAnalytics.resolved} resolved`
                  : null
              }
              status={convStatus}
            />
            <StatCard
              label={`Revenue (${days}d)`}
              value={fmtMoney(leadsAnalytics?.total_revenue || 0)}
              sub={
                ads?.current?.totals?.spend != null
                  ? `Ad spend: ${fmtMoneyDecimal(ads.current.totals.spend)}`
                  : null
              }
              status={revStatus}
            />
          </div>
        );
      })()}

      {errors.stats && <div style={{ marginTop: 10 }}><ErrorBanner section="Stats" error={errors.stats} /></div>}
      {errors.leadsAnalytics && <div style={{ marginTop: 10 }}><ErrorBanner section="Lead analytics" error={errors.leadsAnalytics} /></div>}

      {/* ── Operator Status ────────────────────────────────────────────── */}
      <Section title="Operator Status">
        {errors.operators ? (
          <ErrorBanner section="Operators" error={errors.operators} />
        ) : (
          <OperatorPanel operators={operators?.prospects || []} stats={stats} />
        )}
      </Section>

      {/* ── Lead Pipeline ──────────────────────────────────────────────── */}
      <Section
        title="Lead Pipeline"
        right={stats?.total_leads ? `${stats.total_leads} total leads` : null}
      >
        {errors.stats ? (
          <ErrorBanner section="Pipeline" error={errors.stats} />
        ) : (
          <PipelinePanel stats={stats} leadsAnalytics={leadsAnalytics} />
        )}
      </Section>

      {/* ── Google Ads ─────────────────────────────────────────────────── */}
      <Section
        title="Google Ads — FSC 1"
        right={ads?.current_range ? `${fmtDate(ads.current_range.start)} → ${fmtDate(ads.current_range.end)}` : null}
      >
        {errors.ads ? (
          <ErrorBanner section="Google Ads" error={errors.ads} />
        ) : ads ? (
          <AdsPanel ads={ads} />
        ) : null}
      </Section>

      {/* ── Competitors (Google Ads Auction Insights) ──────────────────── */}
      <Section
        title="Competitive Landscape"
        right={competitors?.period_label || null}
      >
        {errors.competitors ? (
          errors.competitors.includes('404') || errors.competitors.includes('Not found') ? (
            <PendingPanel message="Competitor endpoint not yet deployed — deploy worker v2.11.2 to enable." />
          ) : (
            <ErrorBanner section="Competitors" error={errors.competitors} />
          )
        ) : competitors ? (
          <CompetitorsPanel data={competitors} />
        ) : null}
      </Section>

      {/* ── SEO / GSC ──────────────────────────────────────────────────── */}
      <Section
        title="SEO — Search Console"
        right={seo?.current_range ? `${fmtDate(seo.current_range.start)} → ${fmtDate(seo.current_range.end)}` : null}
      >
        {errors.seo ? (
          errors.seo.includes('404') || errors.seo.includes('Not found') ? (
            <PendingPanel message="SEO endpoint not yet deployed — deploy worker v2.11.0 to enable." />
          ) : (
            <ErrorBanner section="SEO" error={errors.seo} />
          )
        ) : seo ? (
          <SeoPanel seo={seo} />
        ) : null}
      </Section>

      {/* ── Backlinks ──────────────────────────────────────────────────── */}
      <Section
        title="Backlinks (off-page SEO)"
        right={backlinks?.uploaded_at ? `Last updated ${fmtDate(backlinks.uploaded_at)}` : null}
      >
        {errors.backlinks ? (
          errors.backlinks.includes('404') || errors.backlinks.includes('Not found') ? (
            <PendingPanel message="Backlinks endpoint not yet deployed — deploy worker v2.11.3 to enable." />
          ) : (
            <ErrorBanner section="Backlinks" error={errors.backlinks} />
          )
        ) : backlinks ? (
          <BacklinksPanel data={backlinks} />
        ) : null}
      </Section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div style={{
        marginTop: 24, paddingTop: 12, borderTop: `1px solid ${C.border}`,
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10, color: C.faint, fontFamily: monoStack,
      }}>
        <span>florence-crm-api · windsor.ai · 1hr cache</span>
        <span>{ads?.fetched_at ? new Date(ads.fetched_at).toLocaleTimeString() : ''}</span>
      </div>
    </div>
  );
}

// ── Operator Status Panel ──────────────────────────────────────────────────
function OperatorPanel({ operators, stats }) {
  if (!operators || operators.length === 0) {
    return (
      <div style={{
        padding: '14px 16px', background: C.panel, border: `1px solid ${C.border}`,
        borderRadius: 8, fontSize: 12.5, color: C.muted,
      }}>
        No active operators on trial. Convert pilot to CSA or recruit new pilot.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {operators.map((op) => {
        // William trial: started 4/7, ends 6/6 (60 days)
        // Use sequence_started or pilot_completed_date as start anchor
        // Fallback: just show static info
        const trialStart = op.sequence_started || op.created_at;
        const today = new Date().toISOString().slice(0, 10);
        const daysIn = trialStart ? daysBetween(trialStart.slice(0, 10), today) : null;
        const trialLength = 60;
        const daysRemaining = daysIn != null ? Math.max(0, trialLength - daysIn) : null;
        const pct = daysIn != null ? Math.min(100, (daysIn / trialLength) * 100) : 0;

        return (
          <div key={op.id} style={{
            padding: '14px 16px', background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 10,
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              marginBottom: 10, flexWrap: 'wrap', gap: 8,
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                  {op.name || op.short_name}
                </div>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: monoStack, marginTop: 2 }}>
                  {op.contact_name || '—'}
                  {op.phone ? ` · ${op.phone}` : ''}
                  {op.default_zone ? ` · Zone ${op.default_zone}` : ''}
                </div>
              </div>
              <div style={{
                padding: '3px 10px', borderRadius: 999, fontSize: 10.5, fontWeight: 600,
                background: 'rgba(245,158,11,0.15)', color: C.amber,
                border: '1px solid rgba(245,158,11,0.3)',
              }}>
                PILOT ACTIVE
              </div>
            </div>

            {daysIn != null && (
              <>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', fontSize: 11,
                  color: C.muted, fontFamily: monoStack, marginBottom: 4,
                }}>
                  <span>Day {daysIn} of {trialLength}</span>
                  <span>{daysRemaining}d remaining</span>
                </div>
                <div style={{
                  height: 6, background: 'rgba(56,189,248,0.08)', borderRadius: 3,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${pct}%`, height: '100%',
                    background: pct > 80 ? C.amber : C.blue,
                    transition: 'width 0.3s',
                  }} />
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Lead Pipeline Panel ────────────────────────────────────────────────────
function PipelinePanel({ stats, leadsAnalytics }) {
  if (!stats) return null;

  // Normalize stats arrays for display
  const bySource = (leadsAnalytics?.by_source || stats.leads_by_source || []).map(r => ({
    label: r.source || 'unknown', value: r.c,
  })).sort((a, b) => b.value - a.value);

  const byZone = (leadsAnalytics?.by_zone || stats.leads_by_zone || []).map(r => ({
    label: r.zone ? `Zone ${r.zone}` : 'Unzoned', value: r.c,
  })).sort((a, b) => b.value - a.value);

  const byOutcome = (leadsAnalytics?.by_outcome || stats.leads_by_outcome || []).map(r => ({
    label: r.outcome || 'pending', value: r.c,
  })).sort((a, b) => b.value - a.value);

  const totalSource = bySource.reduce((s, r) => s + r.value, 0);
  const totalZone = byZone.reduce((s, r) => s + r.value, 0);
  const totalOutcome = byOutcome.reduce((s, r) => s + r.value, 0);

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12,
    }}>
      <div>
        <div style={{
          fontSize: 10, color: C.faint, fontFamily: monoStack,
          marginBottom: 6, fontWeight: 600,
        }}>BY SOURCE</div>
        <BreakdownTable rows={bySource} total={totalSource} />
      </div>
      <div>
        <div style={{
          fontSize: 10, color: C.faint, fontFamily: monoStack,
          marginBottom: 6, fontWeight: 600,
        }}>BY ZONE</div>
        <BreakdownTable rows={byZone} total={totalZone} />
      </div>
      <div>
        <div style={{
          fontSize: 10, color: C.faint, fontFamily: monoStack,
          marginBottom: 6, fontWeight: 600,
        }}>BY OUTCOME</div>
        <BreakdownTable rows={byOutcome} total={totalOutcome} />
      </div>
    </div>
  );
}

// ── Ads Panel ──────────────────────────────────────────────────────────────
function AdsPanel({ ads }) {
  const t = ads.current?.totals || {};
  const p = ads.previous?.totals || {};
  const daily = (ads.daily || []).map(d => ({
    ...d,
    label: d.date ? new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
  }));

  const outOfZoneClicks = (ads.out_of_zone || []).reduce((s, g) => s + Number(g.clicks || 0), 0);

  // Status calcs — see thresholds in CompanySnapshot doc block
  const ctrNum = parseFloat(String(t.ctr ?? '').replace('%', ''));
  const cpcNum = parseFloat(String(t.cpc ?? '').replace('$', ''));
  const status = {
    spend: trendStatus(t.spend, p.spend, { lowerBetter: true, minSample: 5 }),
    clicks: trendStatus(t.clicks, p.clicks, { minSample: 3 }),
    impressions: trendStatus(t.impressions, p.impressions, { minSample: 50 }),
    ctr: !isNaN(ctrNum) ? absoluteStatus(ctrNum, { greenAt: 3, yellowAt: 1 }) : null,
    cpc: !isNaN(cpcNum) && cpcNum > 0 ? absoluteStatus(cpcNum, { greenAt: 3, yellowAt: 6, lowerBetter: true }) : null,
    // Conversions: green ≥1, yellow if 0 (only if there was meaningful spend)
    conv: t.conversions >= 1 ? 'green' : (Number(t.spend) >= 5 ? 'yellow' : null),
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <MiniStat label="Spend" value={fmtMoneyDecimal(t.spend)} delta={deltaPct(t.spend, p.spend)} invert status={status.spend} />
        <MiniStat label="Clicks" value={fmtNum(t.clicks)} delta={deltaPct(t.clicks, p.clicks)} status={status.clicks} />
        <MiniStat label="Impressions" value={fmtNum(t.impressions)} delta={deltaPct(t.impressions, p.impressions)} status={status.impressions} />
        <MiniStat label="CTR" value={t.ctr || '—'} status={status.ctr} />
        <MiniStat label="CPC" value={t.cpc || '—'} status={status.cpc} />
        <MiniStat label="Conv" value={fmtNum(t.conversions)} delta={deltaPct(t.conversions, p.conversions)} status={status.conv} />
      </div>

      {outOfZoneClicks > 0 && (
        <div style={{
          padding: '8px 12px', marginBottom: 12, borderRadius: 6,
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
          fontSize: 12, color: C.amber, fontWeight: 500,
        }}>
          ⚠ {outOfZoneClicks} click{outOfZoneClicks > 1 ? 's' : ''} from out-of-zone cities — review geo targeting
        </div>
      )}

      {daily.length > 0 && (
        <div style={{
          background: C.panel, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: 12,
        }}>
          <div style={{
            fontSize: 10, color: C.faint, textTransform: 'uppercase',
            letterSpacing: 0.8, fontWeight: 600, marginBottom: 8,
          }}>Daily Clicks vs Spend</div>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={daily} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,179,237,0.08)" />
              <XAxis
                dataKey="label" tick={{ fontSize: 10, fill: C.muted }}
                axisLine={{ stroke: C.border }} tickLine={false}
              />
              <YAxis yAxisId="left" allowDecimals={false}
                tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="right" orientation="right"
                tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{
                  background: C.bg, border: `1px solid ${C.borderStrong}`,
                  borderRadius: 6, fontSize: 12, color: C.text,
                }}
                cursor={{ fill: 'rgba(56,189,248,0.06)' }}
                formatter={(value, name) => name === 'Spend' ? [`$${Number(value).toFixed(2)}`, name] : [value, name]}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="rect" />
              <Bar yAxisId="left" dataKey="clicks" name="Clicks" radius={[3, 3, 0, 0]}>
                {daily.map((entry, i) => (
                  <Cell key={i} fill={entry.clicks > 0 ? C.blue : 'rgba(56,189,248,0.2)'} />
                ))}
              </Bar>
              <Line yAxisId="right" type="monotone" dataKey="spend" name="Spend"
                stroke={C.purple} strokeWidth={2} dot={{ r: 3, fill: C.purple }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, delta, invert, status }) {
  const barColor = status ? STATUS_COLOR[status] : null;
  return (
    <div style={{
      flex: '1 1 100px', minWidth: 0,
      padding: barColor ? '11px 12px 8px' : '8px 12px',
      background: C.panel, border: `1px solid ${C.border}`,
      borderRadius: 8,
      position: 'relative', overflow: 'hidden',
    }}>
      {barColor && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: barColor,
        }} />
      )}
      <div style={{
        fontSize: 9.5, color: C.muted, textTransform: 'uppercase',
        letterSpacing: 0.6, fontWeight: 600, marginBottom: 3,
      }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: barColor || C.text, fontFamily: monoStack }}>
        {value}
        <Delta value={delta} invert={invert} />
      </div>
    </div>
  );
}

// ── Competitors Panel ──────────────────────────────────────────────────────
function CompetitorsPanel({ data }) {
  const rows = data?.rows || [];
  if (rows.length === 0) {
    return (
      <div style={{
        padding: '14px 16px', background: C.panel, border: `1px solid ${C.border}`,
        borderRadius: 8, fontSize: 12.5, color: C.muted,
      }}>
        No competitor data uploaded yet.
      </div>
    );
  }

  // Helper: render a value safely (handles {value, is_upper_bound} or null)
  const fmtPct = (cell) => {
    if (!cell) return '—';
    return cell.is_upper_bound ? `<${cell.value}%` : `${cell.value.toFixed(2)}%`;
  };
  const num = (cell) => (cell ? cell.value : 0);

  // Pull FSC's row
  const me = rows.find(r => r.domain === 'You');
  const competitors = rows.filter(r => r.domain !== 'You');

  // Sort by impression share (desc, treating <10% as 9 for sort purposes)
  const byImprShare = [...competitors].sort((a, b) => num(b.impression_share) - num(a.impression_share));

  // Top ranking threats: highest position_above_rate (% of times they outrank you)
  const topThreats = [...competitors]
    .filter(r => r.position_above_rate)
    .sort((a, b) => num(b.position_above_rate) - num(a.position_above_rate))
    .slice(0, 3);

  // Most direct competitors: highest overlap_rate
  const mostDirect = [...competitors]
    .filter(r => r.overlap_rate)
    .sort((a, b) => num(b.overlap_rate) - num(a.overlap_rate))
    .slice(0, 3);

  // Bar chart data: impression share, FSC highlighted
  const chartData = [
    { domain: 'You (FSC)', value: num(me?.impression_share), isFsc: true },
    ...byImprShare.map(r => ({
      domain: r.domain.length > 22 ? r.domain.slice(0, 20) + '…' : r.domain,
      fullDomain: r.domain,
      value: num(r.impression_share),
      isUpper: r.impression_share?.is_upper_bound,
      isFsc: false,
    })),
  ];

  return (
    <div style={{ display: 'grid', gap: 12 }}>

      {/* Hero: FSC's standing */}
      {me && (
        <div style={{
          padding: '14px 18px',
          background: 'rgba(34,197,94,0.06)',
          border: `1px solid rgba(34,197,94,0.25)`,
          borderRadius: 10,
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <div style={{
              fontSize: 10, color: C.green, textTransform: 'uppercase',
              letterSpacing: 0.8, fontWeight: 600, marginBottom: 4,
            }}>Your impression share</div>
            <div style={{
              fontSize: 28, fontWeight: 700, color: C.green,
              fontFamily: monoStack, lineHeight: 1,
            }}>
              {num(me.impression_share).toFixed(1)}%
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>
              Top of page rate · <span style={{ color: C.text, fontWeight: 600 }}>{fmtPct(me.top_of_page_rate)}</span>
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>
              Absolute top rate · <span style={{ color: C.text, fontWeight: 600 }}>{fmtPct(me.abs_top_of_page_rate)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Impression share comparison chart */}
      <div style={{
        background: C.panel, border: `1px solid ${C.border}`,
        borderRadius: 8, padding: 14,
      }}>
        <div style={{
          fontSize: 10, color: C.faint, textTransform: 'uppercase',
          letterSpacing: 0.8, fontWeight: 600, marginBottom: 8,
        }}>Impression share — you vs competitors</div>
        <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 28)}>
          <BarChart data={chartData} layout="vertical"
            margin={{ top: 4, right: 40, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,179,237,0.06)" horizontal={false} />
            <XAxis type="number" domain={[0, Math.max(40, num(me?.impression_share) + 5)]}
              tick={{ fontSize: 10, fill: C.muted }}
              tickFormatter={(v) => `${v}%`}
              axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="domain" width={170}
              tick={{ fontSize: 11, fill: C.text }}
              axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{
              background: C.bg, border: `1px solid ${C.borderStrong}`,
              borderRadius: 6, fontSize: 12, color: C.text,
            }} cursor={{ fill: 'rgba(56,189,248,0.06)' }}
              formatter={(v, _, item) => {
                const r = item?.payload;
                return [(r?.isUpper ? '<' : '') + Number(v).toFixed(2) + '%', 'Impression share'];
              }}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.isFsc ? C.green : C.blue} fillOpacity={entry.isFsc ? 1 : 0.6} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Two-column: most direct + biggest threats */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 10,
      }}>
        {/* Most direct competitors */}
        <div style={{
          background: C.panel, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: 12,
        }}>
          <div style={{
            fontSize: 10, color: C.blue, textTransform: 'uppercase',
            letterSpacing: 0.8, fontWeight: 600, marginBottom: 4,
          }}>Most direct competitors</div>
          <div style={{ fontSize: 10, color: C.faint, marginBottom: 8, lineHeight: 1.4 }}>
            Highest auction overlap with you
          </div>
          {mostDirect.map((c, i) => (
            <div key={i} style={{
              paddingTop: i === 0 ? 0 : 8, paddingBottom: 8,
              borderTop: i > 0 ? `1px solid ${C.border}` : 'none',
            }}>
              <div style={{ fontSize: 12.5, color: C.text, marginBottom: 3, fontWeight: 500 }}>
                {c.domain}
              </div>
              <div style={{
                fontSize: 10.5, color: C.muted, fontFamily: monoStack,
                display: 'flex', gap: 12, flexWrap: 'wrap',
              }}>
                <span>Overlap <span style={{ color: C.blue, fontWeight: 600 }}>{fmtPct(c.overlap_rate)}</span></span>
                <span>Imp share {fmtPct(c.impression_share)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Biggest ranking threats */}
        <div style={{
          background: C.panel, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: 12,
        }}>
          <div style={{
            fontSize: 10, color: C.red, textTransform: 'uppercase',
            letterSpacing: 0.8, fontWeight: 600, marginBottom: 4,
          }}>Biggest ranking threats</div>
          <div style={{ fontSize: 10, color: C.faint, marginBottom: 8, lineHeight: 1.4 }}>
            % of head-to-head auctions where they appear above you
          </div>
          {topThreats.map((c, i) => (
            <div key={i} style={{
              paddingTop: i === 0 ? 0 : 8, paddingBottom: 8,
              borderTop: i > 0 ? `1px solid ${C.border}` : 'none',
            }}>
              <div style={{ fontSize: 12.5, color: C.text, marginBottom: 3, fontWeight: 500 }}>
                {c.domain}
              </div>
              <div style={{
                fontSize: 10.5, color: C.muted, fontFamily: monoStack,
                display: 'flex', gap: 12, flexWrap: 'wrap',
              }}>
                <span>Beats you <span style={{ color: C.red, fontWeight: 600 }}>{fmtPct(c.position_above_rate)}</span></span>
                <span>Overlap {fmtPct(c.overlap_rate)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Full table — collapsible-feeling small text */}
      <details style={{
        background: C.panel, border: `1px solid ${C.border}`,
        borderRadius: 8, overflow: 'hidden',
      }}>
        <summary style={{
          padding: '10px 14px', cursor: 'pointer', userSelect: 'none',
          fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: 0.5,
          textTransform: 'uppercase',
        }}>
          Full competitor table ({competitors.length})
        </summary>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderTop: `1px solid ${C.border}` }}>
                {['Domain', 'Imp share', 'Overlap', 'Pos above', 'Top of page', 'Abs top', 'Outrank'].map(h => (
                  <th key={h} style={{
                    padding: '7px 10px',
                    textAlign: h === 'Domain' ? 'left' : 'right',
                    color: C.faint, fontWeight: 600, fontSize: 10,
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[me, ...byImprShare].filter(Boolean).map((r, i) => (
                <tr key={i} style={{
                  borderTop: `1px solid ${C.border}`,
                  background: r.domain === 'You' ? 'rgba(34,197,94,0.04)' : 'transparent',
                }}>
                  <td style={{
                    padding: '6px 10px', color: r.domain === 'You' ? C.green : C.text,
                    fontWeight: r.domain === 'You' ? 700 : 400,
                  }}>{r.domain}</td>
                  {['impression_share', 'overlap_rate', 'position_above_rate',
                    'top_of_page_rate', 'abs_top_of_page_rate', 'outranking_share'].map(k => (
                    <td key={k} style={{
                      padding: '6px 10px', textAlign: 'right',
                      fontFamily: monoStack, color: C.muted,
                    }}>{fmtPct(r[k])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ── Backlinks Panel ────────────────────────────────────────────────────────
function BacklinksPanel({ data }) {
  const links = data?.links || [];
  const total = data?.total_referring_domains || links.length;
  const editorialCount = data?.editorial_count ?? 0;
  const breakdown = data?.type_breakdown || {};

  // Health assessment based on count
  // <5 = thin, 5-15 = developing, 15-50 = healthy, 50+ = strong
  let healthLabel = '🔴 Thin';
  let healthColor = C.red;
  let healthMessage = 'Limited domain authority. Backlinks are a major SEO ranking factor — building 5–10 quality links over the next 90 days would meaningfully move position.';
  if (total >= 50) {
    healthLabel = '🟢 Strong';
    healthColor = C.green;
    healthMessage = 'Solid link profile. Continue adding editorial links to improve domain authority.';
  } else if (total >= 15) {
    healthLabel = '🟡 Developing';
    healthColor = C.amber;
    healthMessage = 'Growing profile. Focus on editorial links from local news, blogs, or industry publications.';
  } else if (total >= 5) {
    healthLabel = '🟡 Building';
    healthColor = C.amber;
    healthMessage = 'Foundation in place. Need editorial links — guest posts, local press mentions, partnerships.';
  }

  const typeColor = (type) => {
    if (type === 'editorial') return C.green;
    if (type === 'community') return C.blue;
    return C.muted; // citation
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>

      {/* Hero — referring domain count + health */}
      <div style={{
        padding: '14px 18px',
        background: 'rgba(99,179,237,0.04)',
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'flex-start', flexWrap: 'wrap', gap: 16,
      }}>
        <div>
          <div style={{
            fontSize: 10, color: C.muted, textTransform: 'uppercase',
            letterSpacing: 0.8, fontWeight: 600, marginBottom: 4,
          }}>Referring domains</div>
          <div style={{
            fontSize: 28, fontWeight: 700, color: healthColor,
            fontFamily: monoStack, lineHeight: 1,
          }}>
            {total}
          </div>
          <div style={{
            fontSize: 11, color: healthColor, fontWeight: 600,
            marginTop: 6, letterSpacing: 0.3,
          }}>{healthLabel}</div>
        </div>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <div style={{
            fontSize: 11, color: C.text, lineHeight: 1.5,
          }}>{healthMessage}</div>
          {/* Type breakdown */}
          <div style={{
            display: 'flex', gap: 14, marginTop: 10,
            fontSize: 11, color: C.muted, fontFamily: monoStack,
          }}>
            <span>Editorial: <span style={{ color: editorialCount > 0 ? C.green : C.red, fontWeight: 600 }}>{editorialCount}</span></span>
            <span>Citations: <span style={{ color: C.text, fontWeight: 600 }}>{breakdown.citation || 0}</span></span>
            <span>Community: <span style={{ color: C.text, fontWeight: 600 }}>{breakdown.community || 0}</span></span>
          </div>
        </div>
      </div>

      {/* Linking pages list */}
      <div style={{
        background: C.panel, border: `1px solid ${C.border}`,
        borderRadius: 8, overflow: 'hidden',
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 90px 80px',
          gap: 8, padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
          fontSize: 10, color: C.faint, textTransform: 'uppercase',
          letterSpacing: 0.6, fontWeight: 600,
        }}>
          <div>Linking page</div>
          <div style={{ textAlign: 'left' }}>Type</div>
          <div style={{ textAlign: 'right' }}>Crawled</div>
        </div>
        {links.length === 0 ? (
          <div style={{ padding: '14px', fontSize: 12, color: C.muted, textAlign: 'center' }}>
            No backlinks recorded.
          </div>
        ) : links.map((l, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '1fr 90px 80px',
            gap: 8, padding: '8px 14px', fontSize: 12,
            borderTop: i > 0 ? `1px solid ${C.border}` : 'none',
            alignItems: 'center',
          }}>
            <div style={{
              color: C.text, overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', fontFamily: monoStack, fontSize: 11,
            }}>
              <a href={l.url} target="_blank" rel="noreferrer"
                style={{ color: C.blue, textDecoration: 'none' }}>
                {l.domain}
              </a>
            </div>
            <div>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                background: `${typeColor(l.type)}18`, color: typeColor(l.type),
                border: `1px solid ${typeColor(l.type)}55`, textTransform: 'capitalize',
              }}>{l.type}</span>
            </div>
            <div style={{
              textAlign: 'right', fontFamily: monoStack,
              fontSize: 10.5, color: C.muted,
            }}>{fmtDate(l.last_crawled)}</div>
          </div>
        ))}
      </div>

      {/* Action note */}
      <div style={{
        padding: '8px 12px',
        background: 'rgba(99,179,237,0.04)', border: `1px solid ${C.border}`,
        borderRadius: 6, fontSize: 10.5, color: C.muted, lineHeight: 1.5,
      }}>
        <strong style={{ color: C.text }}>Update cadence:</strong> backlinks change slowly.
        Re-export from GSC → Links → External monthly and upload to refresh.
      </div>
    </div>
  );
}

// ── SEO Panel ──────────────────────────────────────────────────────────────
function SeoPanel({ seo }) {
  const t = seo.current?.totals || {};
  const p = seo.previous?.totals || {};
  const queries = seo.top_queries || [];

  // Daily series for charting
  const daily = (seo.daily || []).map(d => ({
    ...d,
    label: d.date ? new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
  }));

  // Status calcs
  const ctrNum = parseFloat(String(t.ctr ?? '').replace('%', ''));
  const posNum = parseFloat(t.position);
  const status = {
    clicks: trendStatus(t.clicks, p.clicks, { minSample: 3 }),
    impressions: trendStatus(t.impressions, p.impressions, { minSample: 50, yellowMax: 30 }),
    ctr: !isNaN(ctrNum) ? absoluteStatus(ctrNum, { greenAt: 2, yellowAt: 0.5 }) : null,
    position: !isNaN(posNum) ? absoluteStatus(posNum, { greenAt: 10, yellowAt: 30, lowerBetter: true }) : null,
  };

  // Position delta — for display only (lower position = improvement, so flip sign)
  const posDelta = (!isNaN(posNum) && p.position && p.position !== 'N/A')
    ? -1 * Math.round(((posNum - Number(p.position)) / Number(p.position)) * 100)
    : null;

  // ── Competitive Insights (inferred from GSC) ──
  // Queries we're winning: page 1 (≤10) sorted by impressions desc
  const winning = queries
    .filter(q => Number(q.position) <= 10 && q.impressions >= 5)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 3);

  // Biggest opportunities: page 2+ with meaningful impressions — competitors are winning these
  const opportunities = queries
    .filter(q => Number(q.position) > 10 && q.impressions >= 10)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 3);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <MiniStat label="Clicks" value={fmtNum(t.clicks)} delta={deltaPct(t.clicks, p.clicks)} status={status.clicks} />
        <MiniStat label="Impressions" value={fmtNum(t.impressions)} delta={deltaPct(t.impressions, p.impressions)} status={status.impressions} />
        <MiniStat label="CTR" value={t.ctr || '—'} status={status.ctr} />
        <MiniStat label="Avg Position" value={t.position || '—'} delta={posDelta} status={status.position} />
      </div>

      {/* Daily trend chart */}
      {daily.length > 0 && (
        <div style={{
          background: C.panel, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: 12, marginBottom: 12,
        }}>
          <div style={{
            fontSize: 10, color: C.faint, textTransform: 'uppercase',
            letterSpacing: 0.8, fontWeight: 600, marginBottom: 8,
          }}>Daily Search Performance</div>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={daily} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,179,237,0.08)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.muted }}
                axisLine={{ stroke: C.border }} tickLine={false} />
              <YAxis yAxisId="left" allowDecimals={false}
                tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="right" orientation="right"
                tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{
                background: C.bg, border: `1px solid ${C.borderStrong}`,
                borderRadius: 6, fontSize: 12, color: C.text,
              }} cursor={{ stroke: 'rgba(56,189,248,0.2)' }} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="rect" />
              <Line yAxisId="left" type="monotone" dataKey="clicks" name="Clicks"
                stroke={C.blue} strokeWidth={2} dot={{ r: 3, fill: C.blue }} />
              <Line yAxisId="right" type="monotone" dataKey="impressions" name="Impressions"
                stroke={C.purple} strokeWidth={2} dot={{ r: 2, fill: C.purple }}
                strokeDasharray="0" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Competitive Insights — Winning vs Opportunities */}
      {(winning.length > 0 || opportunities.length > 0) && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 10, marginBottom: 12,
        }}>
          {/* Winning queries */}
          <div style={{
            background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: 12,
          }}>
            <div style={{
              fontSize: 10, color: C.green, textTransform: 'uppercase',
              letterSpacing: 0.8, fontWeight: 600, marginBottom: 8,
            }}>🟢 Where you're winning</div>
            {winning.length === 0 ? (
              <div style={{ fontSize: 12, color: C.muted }}>No page-1 rankings yet.</div>
            ) : winning.map((q, i) => (
              <div key={i} style={{
                paddingTop: i === 0 ? 0 : 6, paddingBottom: 6,
                borderTop: i > 0 ? `1px solid ${C.border}` : 'none',
              }}>
                <div style={{ fontSize: 12.5, color: C.text, marginBottom: 2 }}>{q.query}</div>
                <div style={{
                  fontSize: 10.5, color: C.muted, fontFamily: monoStack,
                  display: 'flex', gap: 12,
                }}>
                  <span>Pos <span style={{ color: C.green, fontWeight: 600 }}>{q.position}</span></span>
                  <span>{fmtNum(q.impressions)} impr</span>
                  <span>{q.clicks} clicks</span>
                </div>
              </div>
            ))}
          </div>

          {/* Biggest opportunities (where competitors are winning) */}
          <div style={{
            background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: 12,
          }}>
            <div style={{
              fontSize: 10, color: C.amber, textTransform: 'uppercase',
              letterSpacing: 0.8, fontWeight: 600, marginBottom: 8,
            }}>🟡 Biggest opportunities</div>
            <div style={{ fontSize: 10, color: C.faint, marginBottom: 8, lineHeight: 1.4 }}>
              High-demand queries where competitors rank above you
            </div>
            {opportunities.length === 0 ? (
              <div style={{ fontSize: 12, color: C.muted }}>None — all top queries are page 1.</div>
            ) : opportunities.map((q, i) => (
              <div key={i} style={{
                paddingTop: i === 0 ? 0 : 6, paddingBottom: 6,
                borderTop: i > 0 ? `1px solid ${C.border}` : 'none',
              }}>
                <div style={{ fontSize: 12.5, color: C.text, marginBottom: 2 }}>{q.query}</div>
                <div style={{
                  fontSize: 10.5, color: C.muted, fontFamily: monoStack,
                  display: 'flex', gap: 12,
                }}>
                  <span>Pos <span style={{ color: C.amber, fontWeight: 600 }}>{q.position}</span></span>
                  <span>{fmtNum(q.impressions)} impr</span>
                  <span>{q.clicks} clicks</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Pages */}
      {seo.top_pages && seo.top_pages.length > 0 && (
        <div style={{
          background: C.panel, border: `1px solid ${C.border}`,
          borderRadius: 8, marginBottom: 12, overflow: 'hidden',
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 60px 70px 60px 60px',
            gap: 8, padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
            fontSize: 10, color: C.faint, textTransform: 'uppercase',
            letterSpacing: 0.6, fontWeight: 600,
          }}>
            <div>Top pages</div>
            <div style={{ textAlign: 'right' }}>Clicks</div>
            <div style={{ textAlign: 'right' }}>Impr</div>
            <div style={{ textAlign: 'right' }}>CTR</div>
            <div style={{ textAlign: 'right' }}>Pos</div>
          </div>
          {seo.top_pages.map((p, i) => {
            // CTR optimization opportunity flag: high impressions + low CTR + decent position
            const ctrNum = parseFloat(String(p.ctr).replace('%', ''));
            const opportunity = p.impressions >= 50 && ctrNum < 1 && Number(p.position) <= 30;
            return (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '1fr 60px 70px 60px 60px',
                gap: 8, padding: '7px 14px', fontSize: 12.5,
                borderBottom: i < seo.top_pages.length - 1 ? `1px solid ${C.border}` : 'none',
                alignItems: 'center',
              }}>
                <div style={{
                  color: C.text, overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap', fontFamily: monoStack, fontSize: 11.5,
                }}>
                  {p.path}
                  {opportunity && (
                    <span title="High impressions, low CTR — title/meta optimization opportunity"
                      style={{ marginLeft: 6, color: C.amber, fontSize: 11 }}>⚡</span>
                  )}
                </div>
                <div style={{
                  textAlign: 'right', fontFamily: monoStack,
                  color: p.clicks > 0 ? C.green : C.muted, fontWeight: 600,
                }}>{p.clicks}</div>
                <div style={{
                  textAlign: 'right', fontFamily: monoStack, color: C.muted,
                }}>{p.impressions}</div>
                <div style={{
                  textAlign: 'right', fontFamily: monoStack,
                  color: opportunity ? C.amber : C.muted, fontWeight: opportunity ? 600 : 400,
                }}>{p.ctr}</div>
                <div style={{
                  textAlign: 'right', fontFamily: monoStack,
                  color: Number(p.position) <= 10 ? C.green : Number(p.position) <= 30 ? C.amber : C.muted,
                  fontWeight: 600,
                }}>{p.position}</div>
              </div>
            );
          })}
          <div style={{
            padding: '6px 14px', fontSize: 10, color: C.faint,
            background: 'rgba(99,179,237,0.03)', borderTop: `1px solid ${C.border}`,
          }}>
            <span style={{ color: C.amber }}>⚡</span> = CTR optimization opportunity (high impressions, low CTR, decent position)
          </div>
        </div>
      )}

      {queries.length > 0 && (
        <details style={{
          background: C.panel, border: `1px solid ${C.border}`,
          borderRadius: 8, overflow: 'hidden',
        }}>
          <summary style={{
            padding: '10px 14px', cursor: 'pointer', userSelect: 'none',
            fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}>
            All top queries ({queries.length})
          </summary>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 60px 70px 60px 60px',
            gap: 8, padding: '8px 14px', borderTop: `1px solid ${C.border}`,
            fontSize: 10, color: C.faint, textTransform: 'uppercase',
            letterSpacing: 0.6, fontWeight: 600,
          }}>
            <div>Query</div>
            <div style={{ textAlign: 'right' }}>Clicks</div>
            <div style={{ textAlign: 'right' }}>Impr</div>
            <div style={{ textAlign: 'right' }}>CTR</div>
            <div style={{ textAlign: 'right' }}>Pos</div>
          </div>
          {queries.map((q, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '1fr 60px 70px 60px 60px',
              gap: 8, padding: '7px 14px', fontSize: 12.5,
              borderTop: `1px solid ${C.border}`,
              alignItems: 'center',
            }}>
              <div style={{
                color: C.text, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>{q.query}</div>
              <div style={{
                textAlign: 'right', fontFamily: monoStack,
                color: q.clicks > 0 ? C.green : C.muted, fontWeight: 600,
              }}>{q.clicks}</div>
              <div style={{
                textAlign: 'right', fontFamily: monoStack, color: C.muted,
              }}>{q.impressions}</div>
              <div style={{
                textAlign: 'right', fontFamily: monoStack, color: C.muted,
              }}>{q.ctr}</div>
              <div style={{
                textAlign: 'right', fontFamily: monoStack,
                color: Number(q.position) <= 10 ? C.green : Number(q.position) <= 30 ? C.amber : C.muted,
                fontWeight: 600,
              }}>{q.position}</div>
            </div>
          ))}
        </details>
      )}

      {/* Competitor data note */}
      <div style={{
        marginTop: 10, padding: '8px 12px',
        background: 'rgba(99,179,237,0.04)', border: `1px solid ${C.border}`,
        borderRadius: 6, fontSize: 10.5, color: C.muted, lineHeight: 1.5,
      }}>
        <strong style={{ color: C.text }}>Competitor names</strong> require SerpAPI/ValueSERP
        (~$25/mo) or weekly Google Ads Auction Insights export. Above is inferred from your
        own GSC visibility — high-impression queries where you're page 2+ are where
        competitors are winning the click.
      </div>
    </div>
  );
}
