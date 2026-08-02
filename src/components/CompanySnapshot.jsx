// CompanySnapshot.jsx — comprehensive FSC business snapshot
// Pulls from florence-crm-api:
//   /stats, /leads/analytics, /ads/metrics, /seo/metrics, /prospects
// Each section is independent — one source failing won't crash the whole tile.
//
// Required Netlify env: VITE_CRM_API_URL, VITE_CRM_API_TOKEN

import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  ComposedChart, Line, Legend,
} from 'recharts';
import FinancialsPanel from './FinancialsPanel';

const API_BASE = import.meta.env.VITE_CRM_API_URL || '/api';
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
  // Cache-bust: append timestamp so browser never serves stale data across time-window switches
  const sep = path.includes('?') ? '&' : '?';
  const url = `${API_BASE}${path}${sep}_t=${Date.now()}`;
  const res = await fetch(url, {
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

// Bottom-of-section interpretation block. tone: 'positive' | 'neutral' | 'attention' | 'critical'
function InsightSummary({ tone = 'neutral', headline, action, actions = [], onComplete, onDismiss }) {
  const accents = {
    positive:  { bar: C.green,  bg: 'rgba(34,197,94,0.05)',  label: 'Healthy' },
    neutral:   { bar: C.blue,   bg: 'rgba(56,189,248,0.04)', label: 'Snapshot' },
    attention: { bar: C.amber,  bg: 'rgba(245,158,11,0.05)', label: 'Watch' },
    critical:  { bar: C.red,    bg: 'rgba(239,68,68,0.05)',  label: 'Action needed' },
  };
  const a = accents[tone] || accents.neutral;
  // Merge legacy single-action prop into actions array
  const allActions = [...actions];
  if (action && !allActions.find(a => a.text === action)) {
    allActions.push({ text: action, id: null, section: 'legacy' });
  }
  return (
    <div style={{
      marginTop: 12,
      background: a.bg,
      borderLeft: `3px solid ${a.bar}`,
      borderTop: `1px solid ${C.border}`,
      borderRight: `1px solid ${C.border}`,
      borderBottom: `1px solid ${C.border}`,
      borderRadius: '0 8px 8px 0',
      padding: '12px 16px',
    }}>
      <div style={{
        fontSize: 9.5, color: a.bar, textTransform: 'uppercase',
        letterSpacing: 0.8, fontWeight: 700, marginBottom: 6,
      }}>{a.label}</div>
      <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.55 }}>
        {headline}
      </div>
      {allActions.length > 0 && (
        <div style={{
          marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}`,
        }}>
          {allActions.map((act, i) => (
            <div key={act.id || i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: i < allActions.length - 1 ? 6 : 0,
            }}>
              {onComplete && act.id ? (
                <input type="checkbox" style={{ marginTop: 3, cursor: 'pointer', accentColor: a.bar }}
                  onChange={() => onComplete(act.id)} title="Mark completed" />
              ) : (
                <span style={{ color: a.bar, fontWeight: 700, fontSize: 12, marginTop: 1 }}>→</span>
              )}
              <span style={{ fontSize: 12, color: C.text, lineHeight: 1.5, flex: 1 }}>{act.text}</span>
              {onDismiss && act.id && (
                <button onClick={() => onDismiss(act.id)} title="Dismiss"
                  style={{
                    background: 'none', border: 'none', color: C.muted, cursor: 'pointer',
                    fontSize: 10, padding: '2px 4px', flexShrink: 0, opacity: 0.5,
                  }}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}
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
  const [seoFixes, setSeoFixes] = useState(null);
  const [seoFixHistory, setSeoFixHistory] = useState(null);
  const [seoSnapStatus, setSeoSnapStatus] = useState(null);
  const [operators, setOperators] = useState(null);
  const [competitors, setCompetitors] = useState(null);
  const [backlinks, setBacklinks] = useState(null);
  const [searchTerms, setSearchTerms] = useState(null);
  const [financials, setFinancials] = useState(null);

  const [actionItems, setActionItems] = useState([]);

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
      // /seo/metrics already returns a correctly-windowed `previous` block.
      // There was a second call here for a double-length window that the panel
      // differenced to derive the prior period; that works for clicks and
      // impressions but not for position or CTR, which are not additive.
      ['seo', `/seo/metrics?days=${days}`, setSeo],
      ['seoFixes', '/seo/fixes', setSeoFixes],
      ['seoFixHistory', '/seo/fixes/history?limit=1500', setSeoFixHistory],
      ['seoSnapStatus', '/seo/fixes/snapshot-status', setSeoSnapStatus],
      ['operators', '/prospects', (d) => { const ops = (d.prospects || []).filter(p => p.operator_status === 'pilot_active' || p.operator_status === 'active'); setOperators({ prospects: ops }); }, setOperators],
      ['competitors', '/competitors/auction-insights', setCompetitors],
      ['backlinks', '/seo/backlinks', setBacklinks],
      ['searchTerms', `/ads/search-terms?days=${days}`, setSearchTerms],
      ['financials', '/financials', setFinancials],
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

  // ─── Action Items (corrective action tracking) ────────────────────────────
  useEffect(() => { fetchActions(); }, []);

  // Action mutation failures surface in errors.actions — a click that fails
  // must not look identical to a click that worked.
  async function fetchActions() {
    try {
      const data = await fetchJson('/actions?status=open');
      setActionItems(data.actions || []);
      setErrors(prev => { const rest = { ...prev }; delete rest.actions; return rest; });
    } catch (e) {
      setErrors(prev => ({ ...prev, actions: `load failed — ${e.message}` }));
    }
  }

  async function completeAction(id) {
    try {
      await fetchJson(`/actions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
      setActionItems(prev => prev.filter(a => a.id !== id));
      setErrors(prev => { const rest = { ...prev }; delete rest.actions; return rest; });
    } catch (e) {
      setErrors(prev => ({ ...prev, actions: `complete failed — ${e.message}` }));
    }
  }

  async function dismissAction(id) {
    try {
      await fetchJson(`/actions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'dismissed' }) });
      setActionItems(prev => prev.filter(a => a.id !== id));
      setErrors(prev => { const rest = { ...prev }; delete rest.actions; return rest; });
    } catch (e) {
      setErrors(prev => ({ ...prev, actions: `dismiss failed — ${e.message}` }));
    }
  }

  async function syncAction(section, text) {
    try {
      const res = await fetchJson('/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section, action_text: text }) });
      if (!res.deduplicated && res.action_id) {
        setActionItems(prev => [...prev, { id: res.action_id, section, action_text: text, status: 'open' }]);
      }
    } catch (e) {
      setErrors(prev => ({ ...prev, actions: `sync failed — ${e.message}` }));
    }
  }

  function actionsFor(section) {
    return actionItems.filter(a => a.section === section).map(a => ({ id: a.id, text: a.action_text }));
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
      {errors.actions && <div style={{ marginTop: 10 }}><ErrorBanner section="Action items" error={errors.actions} /></div>}

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

      {/* ── Financials (Mercury) ──────────────────────────────────────── */}
      <Section
        title="Financials"
        right={financials?.snapshot_date ? `Snapshot ${fmtDate(financials.snapshot_date)}` : null}
      >
        {errors.financials ? (
          errors.financials.includes('404') || errors.financials.includes('Not found') ? (
            <PendingPanel message="No financial snapshots recorded yet." />
          ) : (
            <ErrorBanner section="Financials" error={errors.financials} />
          )
        ) : financials ? (
          <FinancialsPanel data={financials} />
        ) : null}
      </Section>

      {/* ── Google Ads ─────────────────────────────────────────────────── */}
      <Section
        title="Google Ads — FSC 1"
        right={ads?.current_range ? `${fmtDate(ads.current_range.start)} → ${fmtDate(ads.current_range.end)}` : null}
      >
        {errors.ads ? (
          <ErrorBanner section="Google Ads" error={errors.ads} />
        ) : ads ? (
          <AdsPanel ads={ads} actions={actionsFor("ads")} onComplete={completeAction} onDismiss={dismissAction} onSync={syncAction} />
        ) : null}
      </Section>

      {/* ── Search Terms ──────────────────────────────────────────────── */}
      <Section
        title="Search Terms"
        right={searchTerms?.date_range ? `${fmtDate(searchTerms.date_range.start)} → ${fmtDate(searchTerms.date_range.end)}` : null}
      >
        {errors.searchTerms ? (
          errors.searchTerms.includes('404') || errors.searchTerms.includes('Not found') ? (
            <PendingPanel message="Search terms — coming soon." />
          ) : (
            <ErrorBanner section="Search Terms" error={errors.searchTerms} />
          )
        ) : searchTerms ? (
          <SearchTermsPanel data={searchTerms} actions={actionsFor("search_terms")} onComplete={completeAction} onDismiss={dismissAction} />
        ) : null}
      </Section>

            {/* ── Competitors (Google Ads Auction Insights) ──────────────────── */}
      <Section
        title="Competitive Landscape"
        right={competitors?.period_label || null}
      >
        {errors.competitors ? (
          errors.competitors.includes('404') || errors.competitors.includes('Not found') ? (
            <PendingPanel message="Competitive landscape — coming soon." />
          ) : (
            <ErrorBanner section="Competitors" error={errors.competitors} />
          )
        ) : competitors ? (
          <CompetitorsPanel data={competitors} actions={actionsFor("competitors")} onComplete={completeAction} onDismiss={dismissAction} />
        ) : null}
      </Section>

      {/* ── SEO / GSC ──────────────────────────────────────────────────── */}
      <Section
        title="SEO — Search Console"
        right={(seo?.date_range || seo?.current_range) ? `${fmtDate((seo.date_range || seo.current_range).start)} → ${fmtDate((seo.date_range || seo.current_range).end)}` : null}
      >
        {errors.seo ? (
          errors.seo.includes('404') || errors.seo.includes('Not found') ? (
            <PendingPanel message="SEO data unavailable — check API connection." />
          ) : (
            <ErrorBanner section="SEO" error={errors.seo} />
          )
        ) : seo ? (
          <SeoPanel seo={seo} days={days} actions={actionsFor("seo")} onComplete={completeAction} onDismiss={dismissAction} onSync={syncAction} />
        ) : null}
        {/* Fix tracker has its own data path (D1 snapshots, not live GSC) so it
            renders — or reports its own failure — even when /seo/metrics is down */}
        <SeoFixTracker
          fixes={seoFixes} history={seoFixHistory} snapStatus={seoSnapStatus}
          errors={{ fixes: errors.seoFixes, history: errors.seoFixHistory, status: errors.seoSnapStatus }}
        />
      </Section>

      {/* ── Backlinks ──────────────────────────────────────────────────── */}
      <Section
        title="Backlinks (off-page SEO)"
        right={backlinks?.uploaded_at ? `Last updated ${fmtDate(backlinks.uploaded_at)}` : null}
      >
        {errors.backlinks ? (
          errors.backlinks.includes('404') || errors.backlinks.includes('Not found') ? (
            <PendingPanel message="Backlinks — coming soon." />
          ) : (
            <ErrorBanner section="Backlinks" error={errors.backlinks} />
          )
        ) : backlinks ? (
          <BacklinksPanel data={backlinks} actions={actionsFor("backlinks")} onComplete={completeAction} onDismiss={dismissAction} />
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
        const overdue = daysIn != null && daysIn > trialLength;
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
                  <span>Day {Math.min(daysIn, trialLength)} of {trialLength}</span>
                  <span style={overdue ? { color: C.amber } : undefined}>
                    {overdue ? `Trial ended · ${daysIn - trialLength}d overdue` : `${daysRemaining}d remaining`}
                  </span>
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

  // Normalize stats arrays for display.
  // Prefer the windowed analytics, but an empty array is truthy — so when the
  // window has zero leads, fall back to the all-time /stats breakdown instead of
  // showing "No data" next to a non-zero total-leads count.
  const pick = (windowed, allTime) => (windowed && windowed.length ? windowed : (allTime || []));

  const bySource = pick(leadsAnalytics?.by_source, stats.leads_by_source).map(r => ({
    label: r.source || 'unknown', value: r.c,
  })).sort((a, b) => b.value - a.value);

  const byZone = pick(leadsAnalytics?.by_zone, stats.leads_by_zone).map(r => ({
    label: r.zone ? `Zone ${r.zone}` : 'Unzoned', value: r.c,
  })).sort((a, b) => b.value - a.value);

  const byOutcome = pick(leadsAnalytics?.by_outcome, stats.leads_by_outcome).map(r => ({
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
// ── Search Terms Panel ────────────────────────────────────────────────────
const NEG_CANDIDATES = [
  '1 800 got junk', 'got junk', 'junk removal', 'junk haul',
  'trash haul away', 'haul away', 'dump florence', 'dump near',
  'bagster', 'environmental disposal', '10 yard dumpster dimension',
  'dumper trash',
];

function SearchTermsPanel({ data, actions = [], onComplete, onDismiss }) {
  const terms = data.search_terms || [];
  const totals = data.search_term_totals || {};
  const top10 = terms.slice(0, 10);
  const negHits = terms.filter(t =>
    NEG_CANDIDATES.some(n => t.search_term.includes(n)) && t.clicks === 0
  );
  const maxImpr = Math.max(...top10.map(t => t.impressions), 1);

  // Insight generation
  const topConverter = terms.find(t => t.conversions > 0);
  const broadTerms = terms.filter(t => t.status !== 'ADDED');
  const broadClicks = broadTerms.reduce((s, t) => s + t.clicks, 0);
  const totalClicks = totals.total_clicks || 0;
  const broadPct = totalClicks > 0 ? Math.round((broadClicks / totalClicks) * 100) : 0;

  let tone = 'neutral', headline;
  if (topConverter) {
    tone = 'positive';
    headline = (<>
      <strong>{totals.unique_terms}</strong> terms triggered ads.
      Top converter: "<strong>{topConverter.search_term}</strong>" ({topConverter.ctr} CTR, {topConverter.conversions} conv).
      {negHits.length > 0 && <> {negHits.length} terms flagged as potential negatives.</>}
      {broadPct > 60 && <> {broadPct}% of clicks from broad match — review for quality.</>}
    </>);
  } else if (totalClicks >= 5) {
    tone = 'attention';
    headline = (<>
      <strong>{totalClicks}</strong> clicks across <strong>{totals.unique_terms}</strong> terms but <strong>zero conversions</strong>.
      {negHits.length > 0 && <> {negHits.length} irrelevant terms wasting impressions.</>}
    </>);
  } else {
    headline = (<>
      <strong>{totals.unique_terms}</strong> terms, <strong>{totalClicks}</strong> clicks, ${(totals.total_spend || 0).toFixed(0)} spend.
      {negHits.length > 0 && <> {negHits.length} terms flagged.</>}
    </>);
  }

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <MiniStat label="Unique Terms" value={totals.unique_terms || 0} />
        <MiniStat label="Total Clicks" value={totals.total_clicks || 0} />
        <MiniStat label="Total Impr" value={fmtNum(totals.total_impressions || 0)} />
        <MiniStat label="Total Spend" value={fmtMoneyDecimal(totals.total_spend || 0)} />
      </div>

      {/* Horizontal bar chart — top 10 */}
      <div style={{
        background: C.panel, border: `1px solid ${C.border}`,
        borderRadius: 8, padding: 12, marginBottom: 12,
      }}>
        <div style={{
          fontSize: 10, color: C.faint, textTransform: 'uppercase',
          letterSpacing: 0.8, fontWeight: 600, marginBottom: 10,
        }}>Top 10 Search Terms by Impressions</div>
        {top10.map((t, i) => {
          const isNeg = NEG_CANDIDATES.some(n => t.search_term.includes(n));
          const barWidth = Math.max(2, (t.impressions / maxImpr) * 100);
          const clickWidth = t.clicks > 0 ? Math.max(2, (t.clicks / maxImpr) * 100) : 0;
          const pillLabel = t.status === 'ADDED' ? 'ADDED' : isNeg ? 'FLAG' : '';
          const pillColor = t.status === 'ADDED' ? C.blue : isNeg ? C.red : C.muted;
          return (
            <div key={i} style={{ marginBottom: 6, opacity: isNeg ? 0.5 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <span style={{ fontSize: 11, color: C.text, fontFamily: monoStack, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>
                  {t.search_term}
                </span>
                <span style={{ fontSize: 10, color: C.muted, fontFamily: monoStack, display: 'flex', gap: 8, flexShrink: 0 }}>
                  {pillLabel && <span style={{ fontSize: 9, fontWeight: 600, color: pillColor }}>{pillLabel}</span>}
                  <span>{t.clicks}cl</span>
                  <span>{t.impressions}imp</span>
                  <span>{t.ctr}</span>
                </span>
              </div>
              <div style={{ height: 6, background: 'rgba(99,179,237,0.08)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                <div style={{ position: 'absolute', height: '100%', width: `${barWidth}%`, background: 'rgba(99,179,237,0.2)', borderRadius: 3 }} />
                {clickWidth > 0 && <div style={{ position: 'absolute', height: '100%', width: `${clickWidth}%`, background: C.blue, borderRadius: 3 }} />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Collapsible full table */}
      <details style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
        <summary style={{ padding: '10px 14px', cursor: 'pointer', userSelect: 'none', fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Full search terms table ({terms.length})
        </summary>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderTop: `1px solid ${C.border}` }}>
              {['Term','Status','Clicks','Impr','CTR','CPC','Spend'].map(h =>
                <th key={h} style={{ padding:'7px 10px', textAlign: h==='Term'?'left':'right', color:C.faint, fontWeight:600, fontSize:10, textTransform:'uppercase', letterSpacing:0.5 }}>{h}</th>
              )}
            </tr></thead>
            <tbody>{terms.map((t, i) => {
              const isNeg = NEG_CANDIDATES.some(n => t.search_term.includes(n));
              return (<tr key={i} style={{ borderTop:`1px solid ${C.border}`, opacity: isNeg?0.5:1 }}>
                <td style={{ padding:'6px 10px', color:C.text, fontFamily:monoStack, fontSize:11 }}>{t.search_term}</td>
                <td style={{ padding:'6px 10px', textAlign:'right', fontSize:9, fontWeight:600, color: t.status==='ADDED'?C.blue:isNeg?C.red:C.muted }}>{t.status==='ADDED'?'ADDED':isNeg?'FLAG':'BROAD'}</td>
                <td style={{ padding:'6px 10px', textAlign:'right', fontFamily:monoStack, color:C.muted }}>{t.clicks}</td>
                <td style={{ padding:'6px 10px', textAlign:'right', fontFamily:monoStack, color:C.muted }}>{t.impressions}</td>
                <td style={{ padding:'6px 10px', textAlign:'right', fontFamily:monoStack, color:C.muted }}>{t.ctr}</td>
                <td style={{ padding:'6px 10px', textAlign:'right', fontFamily:monoStack, color:C.muted }}>{t.avg_cpc}</td>
                <td style={{ padding:'6px 10px', textAlign:'right', fontFamily:monoStack, color:C.muted }}>${t.spend.toFixed(2)}</td>
              </tr>);
            })}</tbody>
          </table>
        </div>
      </details>

      {/* Insight + action items */}
      <InsightSummary tone={tone} headline={headline} actions={actions} onComplete={onComplete} onDismiss={onDismiss} />
    </div>
  );
}

function AdsPanel({ ads, actions = [], onComplete, onDismiss, onSync }) {
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

      {/* Spend vs Clicks summary — efficiency + trend read */}
      {(() => {
        const spend = Number(t.spend) || 0;
        const clicks = Number(t.clicks) || 0;
        const prevSpend = Number(p.spend) || 0;
        const prevClicks = Number(p.clicks) || 0;
        const conv = Number(t.conversions) || 0;
        const cpc = clicks > 0 ? spend / clicks : 0;
        const prevCpc = prevClicks > 0 ? prevSpend / prevClicks : 0;
        const costPerConv = conv > 0 ? spend / conv : null;

        // Need at least some spend data to show anything useful
        if (spend === 0 && prevSpend === 0) return null;

        let tone, headline, action;

        // Evaluate efficiency: CPC trend + conversion cost
        const cpcImproved = prevCpc > 0 && cpc < prevCpc * 0.9;
        const cpcWorsened = prevCpc > 0 && cpc > prevCpc * 1.15;
        const clicksUp = prevClicks > 0 && clicks > prevClicks * 1.1;
        const clicksDown = prevClicks > 0 && clicks < prevClicks * 0.85;
        const hasConversions = conv >= 1;

        if (hasConversions && cpc <= 4 && !cpcWorsened) {
          tone = 'positive';
          headline = (
            <>
              Spend is converting. <strong>{conv} conversion{conv > 1 ? 's' : ''}</strong> at{' '}
              <strong>${costPerConv.toFixed(0)}</strong>/conversion, CPC at{' '}
              <strong>${cpc.toFixed(2)}</strong>.
              {clicksUp && <> Click volume trending up vs. prior period.</>}
            </>
          );
        } else if (spend > 0 && clicks > 0 && !hasConversions && cpc <= 5) {
          tone = 'attention';
          headline = (
            <>
              Getting clicks (<strong>{clicks}</strong>) at a reasonable CPC (
              <strong>${cpc.toFixed(2)}</strong>) but{' '}
              <strong>zero conversions</strong> this period.
              {cpcImproved && <> CPC is down vs. prior period — efficiency improving.</>}
            </>
          );
          action = 'Traffic quality or landing page is the bottleneck. Review search terms for irrelevant queries and check that the CTA + phone number load correctly on mobile.';
        } else if (cpcWorsened || cpc > 5) {
          tone = 'attention';
          headline = (
            <>
              CPC at <strong>${cpc.toFixed(2)}</strong>
              {prevCpc > 0 && <> (was ${prevCpc.toFixed(2)} prior period)</>}
              .{' '}
              {clicksDown
                ? <>Click volume is also down — competition may be tightening.</>
                : <>Click volume holding steady but cost per click is climbing.</>}
            </>
          );
          action = 'Review auction insights for new competitors. Consider tightening geo targeting or adding negative keywords to reduce wasted spend.';
        } else if (clicks === 0 && spend > 0) {
          tone = 'critical';
          headline = (
            <>
              Spent <strong>${spend.toFixed(2)}</strong> with <strong>zero clicks</strong>.
              Impressions are serving but nobody is clicking through.
            </>
          );
          action = 'Ad copy or targeting mismatch. Review ad headlines/descriptions against the search terms triggering impressions.';
        } else {
          // Neutral fallback
          tone = 'neutral';
          headline = (
            <>
              <strong>${spend.toFixed(2)}</strong> spent, <strong>{clicks}</strong> clicks
              {cpc > 0 && <> at <strong>${cpc.toFixed(2)}</strong>/click</>}
              {hasConversions && <>, <strong>{conv}</strong> conversion{conv > 1 ? 's' : ''}</>}.
              {prevSpend > 0 && clicksUp && <> Volume trending up from prior period.</>}
              {prevSpend > 0 && clicksDown && <> Volume down from prior period.</>}
            </>
          );
        }

        return <InsightSummary tone={tone} headline={headline} action={action} actions={actions} onComplete={onComplete} onDismiss={onDismiss} />;
      })()}
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
function CompetitorsPanel({ data, actions = [], onComplete, onDismiss }) {
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

      {/* Summary */}
      {(() => {
        const myShare = num(me?.impression_share);
        const competitorShares = competitors
          .map(c => num(c.impression_share))
          .filter(v => v > 0);
        const topCompShare = competitorShares.length ? Math.max(...competitorShares) : 0;
        const multiple = topCompShare > 0 ? (myShare / topCompShare).toFixed(1) : null;
        const topThreat = topThreats[0];
        const topThreatPct = topThreat ? num(topThreat.position_above_rate) : 0;

        let tone, headline, action;

        if (myShare >= 30) {
          tone = 'positive';
          headline = (
            <>
              Dominant auction share at <strong>{myShare.toFixed(1)}%</strong>
              {multiple && <> — {multiple}× your closest competitor</>}.
              {topThreat && topThreatPct >= 40 && (
                <> But <strong>{topThreat.domain}</strong> outranks you in <strong>{topThreatPct.toFixed(0)}%</strong> of head-to-head matchups, meaning you appear lower on the page when you both compete.</>
              )}
            </>
          );
          if (topThreat && topThreatPct >= 40) {
            action = 'Raise bid caps on your highest-converting keywords (Florence + Darlington direct-rental terms) to close the rank gap. The $6 cap is keeping spend disciplined but ceding top spots to bidders willing to pay more.';
          }
        } else if (myShare >= 15) {
          tone = 'neutral';
          headline = (
            <>
              Competitive presence at <strong>{myShare.toFixed(1)}%</strong> impression share.
              {topThreat && <> Biggest ranking threat: <strong>{topThreat.domain}</strong> ({topThreatPct.toFixed(0)}% outrank rate).</>}
            </>
          );
          action = 'Hold strategy steady. Track impression share weekly — if it dips below 15%, increase budget or expand keyword targeting.';
        } else {
          tone = 'attention';
          headline = (
            <>
              Trailing in auction share at <strong>{myShare.toFixed(1)}%</strong>. Competitors are winning more of the auctions you're targeting.
            </>
          );
          action = 'Increase daily budget or broaden keyword targeting to capture more auction opportunities. Review search terms for coverage gaps.';
        }

        return <InsightSummary tone={tone} headline={headline} action={action} actions={actions} onComplete={onComplete} onDismiss={onDismiss} />;
      })()}
    </div>
  );
}

// ── Backlinks Panel ────────────────────────────────────────────────────────
function BacklinksPanel({ data, actions = [], onComplete, onDismiss }) {
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

      {/* Summary */}
      {(() => {
        const total = data?.total_referring_domains || 0;
        const editorial = data?.editorial_count ?? 0;
        const breakdown = data?.type_breakdown || {};

        let tone, headline, action;

        if (total < 5) {
          tone = 'critical';
          const typeList = [];
          if (breakdown.citation) typeList.push(`${breakdown.citation} citation${breakdown.citation > 1 ? 's' : ''}`);
          if (breakdown.community) typeList.push(`${breakdown.community} community`);
          if (breakdown.editorial) typeList.push(`${breakdown.editorial} editorial`);
          headline = (
            <>
              Thin link profile. <strong>{total} referring domain{total !== 1 && 's'}</strong>
              {typeList.length > 0 && <> ({typeList.join(', ')})</>}.
              {editorial === 0 && <> Zero editorial links — that's the gap that holds back domain authority.</>}
            </>
          );
          action = 'Pitch a local press story to Florence Morning News or SCNow — "small business connecting Pee Dee homeowners with local dumpster operators" is genuinely newsworthy at zero spend. Also look for guest-post opportunities on small-business or contractor blogs. One editorial link is worth roughly five citations for ranking.';
        } else if (total < 15 || editorial === 0) {
          tone = 'attention';
          headline = (
            <>
              Building profile. <strong>{total} referring domains</strong>, {editorial} editorial.
              {editorial === 0 && <> Domain authority comes primarily from editorial links — directory citations help local SEO but don't move organic ranking much.</>}
            </>
          );
          action = 'Target one new editorial link per month — local press, industry blogs, or partner cross-links. When William signs CSA, swap links if his business has a site.';
        } else if (total < 50) {
          tone = 'neutral';
          headline = (
            <>
              Developing profile. <strong>{total} referring domains</strong>, {editorial} editorial. Authority is growing.
            </>
          );
          action = 'Continue building editorial links. Two per month sustains the trend.';
        } else {
          tone = 'positive';
          headline = (
            <>
              Solid link profile. <strong>{total} referring domains</strong>, {editorial} editorial. Strong foundation for organic ranking.
            </>
          );
          action = null;
        }

        return <InsightSummary tone={tone} headline={headline} action={action} actions={actions} onComplete={onComplete} onDismiss={onDismiss} />;
      })()}

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

// ── SEO Fix Tracker ────────────────────────────────────────────────────────
// Reads live D1 state: /seo/fixes (the tracked list), /seo/fixes/history
// (daily cron snapshots), /seo/fixes/snapshot-status (cron health).
// Replaced a hardcoded JSX array that looked keywords up in GSC's click-sorted
// top-100 — any keyword that went a week without a click silently fell out of
// that list and showed "Awaiting data" even while ranking on page 2.
// Every degraded state here renders explicitly; nothing disappears quietly.
//
// Each snapshot row carries two figures. `position` is a 7-day mean, stable
// enough to headline but a moving average — consecutive days share 6/7 of
// their input, so charting it alone produced a line that looked frozen no
// matter what the rankings did. `position_1d` is the true single-day position
// and is what the sparkline plots, with the mean drawn faintly behind it.
// Rows written before position_1d shipped have it NULL and fall back to the
// smoothed line on its own.
function SeoFixTracker({ fixes, history, snapStatus, errors = {} }) {
  const loadError = errors.fixes || errors.history;
  if (loadError) {
    return (
      <div style={{ marginBottom: 12 }}>
        <ErrorBanner section="SEO Fix Tracker" error={loadError} />
      </div>
    );
  }
  if (!fixes) return null; // initial load

  const allFixes = fixes.fixes || [];
  const snaps = history?.snapshots || [];
  const byFix = {};
  snaps.forEach(s => { (byFix[s.fix_id] = byFix[s.fix_id] || []).push(s); });
  Object.values(byFix).forEach(list => list.sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date))));

  const monitoring = allFixes.filter(f => f.status === 'monitoring');
  const graduated = allFixes.filter(f => f.status === 'graduated');

  // ── Cron health strip — a broken snapshot pipeline must be the first thing on screen
  const fmtRunTime = (d) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  let health;
  const lastRun = snapStatus?.last_run;
  if (errors.status) {
    health = { color: C.red, text: `Cron health unknown — snapshot-status failed: ${errors.status}` };
  } else if (!lastRun) {
    health = { color: C.red, text: 'Snapshot cron has NEVER run — no position data is being recorded' };
  } else {
    const ranAt = new Date(String(lastRun.ran_at).replace(' ', 'T') + 'Z'); // D1 datetime('now') is UTC
    const ageH = (Date.now() - ranAt.getTime()) / 3600000;
    const when = fmtRunTime(ranAt);
    if (lastRun.status === 'error') {
      health = { color: C.red, text: `Last snapshot FAILED (${when}): ${lastRun.error_message || 'unknown error'}` };
    } else if (ageH > 26) {
      health = { color: C.red, text: `Snapshot cron stalled — last ran ${Math.round(ageH)}h ago (${when})` };
    } else if (lastRun.status === 'partial') {
      health = { color: C.amber, text: `Last snapshot partial (${when}) — ${lastRun.error_message || 'some keywords skipped'}` };
    } else {
      health = { color: C.green, text: `Cron healthy — ${lastRun.fixes_matched}/${lastRun.fixes_total} keywords matched, ran ${when}` };
    }
  }

  const daysSince = (iso) => {
    if (!iso) return null;
    const ms = Date.now() - new Date(String(iso).slice(0, 10) + 'T00:00:00').getTime();
    return Math.max(0, Math.floor(ms / 86400000));
  };
  const fmtAge = (d) => d == null ? '—' : d === 0 ? 'today' : `${d}d`;

  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.border}`,
      borderRadius: 8, overflow: 'hidden', marginBottom: 12, fontFamily: fontStack,
    }}>
      <div style={{
        fontSize: 10, color: C.blue, textTransform: 'uppercase',
        letterSpacing: 0.8, fontWeight: 600, padding: '10px 14px',
        borderBottom: `1px solid ${C.border}`,
      }}>🎯 SEO Fix Tracker — Active Pushes ({monitoring.length})</div>
      <div style={{
        padding: '8px 14px', fontSize: 10, fontFamily: monoStack,
        color: health.color, borderBottom: `1px solid ${C.border}`,
        background: health.color === C.green ? 'transparent'
          : health.color === C.amber ? 'rgba(245,158,11,0.06)' : 'rgba(239,68,68,0.08)',
      }}>{health.color === C.green ? '●' : '⚠'} {health.text}</div>

      {monitoring.length === 0 && (
        <div style={{ padding: '10px 14px', fontSize: 11, color: C.muted }}>
          No fixes in monitoring. Add one via POST /seo/fixes.
        </div>
      )}

      {monitoring.map((fix, i) => {
        const h = byFix[fix.id] || [];
        const latest = h.length ? h[h.length - 1] : null;
        const latestWithPos = [...h].reverse().find(s => s.position != null) || null;
        const currentPos = latest && latest.position != null ? Number(latest.position) : null;
        const startPos = fix.baseline_pos != null ? Number(fix.baseline_pos)
          : (h.find(s => s.position != null) ? Number(h.find(s => s.position != null).position) : null);
        const delta = (currentPos != null && startPos != null) ? (startPos - currentPos) : null; // positive = improved
        const age = daysSince(fix.started_at || fix.created_at);
        // snapshot_date is the date the GSC data covers, not the date the cron
        // ran. GSC finalizes 2-3 days late, so a perfectly healthy keyword is
        // always a few days back and the old >2 threshold would flag all of
        // them. Past 5 days means runs were genuinely missed.
        const snapAge = latest ? daysSince(latest.snapshot_date) : null;
        const stale = snapAge != null && snapAge > 5;

        // Explicit degraded states — each one says what is wrong and where to look
        let stateChip = null;
        let statusColor = C.muted;
        if (h.length === 0) {
          stateChip = { color: C.amber, label: '⚠ No snapshots yet' };
        } else if (currentPos == null) {
          stateChip = {
            color: C.muted,
            label: latestWithPos
              ? `○ No GSC data in window (last seen ${Number(latestWithPos.position).toFixed(1)} on ${fmtDate(String(latestWithPos.snapshot_date).slice(0, 10))})`
              : '○ No GSC data yet — query has never had impressions',
          };
        } else {
          statusColor = delta == null ? C.muted : delta > 0.5 ? C.green : delta < -0.5 ? C.red : C.muted;
        }

        // ── Sparkline (lower position = better = higher on the chart)
        // Solid line is the true single-day position; the faint line behind it
        // is the 7-day mean. Both are indexed against the same run of
        // snapshots so they share an x-axis.
        const recent = h.slice(-30);
        const seriesOf = (key) => recent
          .map((s, idx) => ({ idx, v: s[key] == null ? null : Number(s[key]) }))
          .filter(pt => pt.v != null && !isNaN(pt.v));
        const dailyPts = seriesOf('position_1d');
        const smoothPts = seriesOf('position');
        // Daily is the point of this chart, but it only exists for snapshots
        // written after the 1d series shipped — fall back to the smoothed line
        // alone for keywords whose history predates it.
        const hasDaily = dailyPts.length >= 2;
        const primary = hasDaily ? dailyPts : smoothPts;
        const secondary = hasDaily ? smoothPts : [];

        const CHART_W = 140, CHART_H = 34, PAD = 3;
        let spark = null;
        if (primary.length >= 2) {
          const vals = primary.concat(secondary).map(pt => pt.v);
          let lo = Math.min(...vals), hi = Math.max(...vals);
          // Scale to the data, not to position 1. Anchoring the axis at P1
          // spent most of the height on the empty gap above where the keyword
          // actually ranks, flattening real movement into a couple of pixels.
          // A floor on the span stops sub-position noise from being magnified
          // into a dramatic-looking swing. Deliberately below 1: the common
          // case here is a keyword grinding through fractions of a position,
          // and a floor of 2 would flatten a real 0.4 move back into the same
          // few pixels this is meant to fix. At 0.75 a 0.4 drift reads clearly
          // while a 0.02 wobble still renders flat.
          const MIN_SPAN = 0.75;
          if (hi - lo < MIN_SPAN) {
            const mid = (hi + lo) / 2;
            lo = mid - MIN_SPAN / 2;
            hi = mid + MIN_SPAN / 2;
          }
          const padV = (hi - lo) * 0.12;
          lo = Math.max(1, lo - padV);
          hi = hi + padV;
          const range = Math.max(hi - lo, 0.5);
          const toY = (pos) => PAD + ((pos - lo) / range) * (CHART_H - PAD * 2);
          const span = Math.max(recent.length - 1, 1);
          const toX = (idx) => PAD + (idx / span) * (CHART_W - PAD * 2);
          // Break the line at missing days instead of interpolating across a
          // gap — an absent snapshot is not a straight-line trend through it.
          const toSegments = (pts) => {
            const segs = [];
            let cur = [];
            pts.forEach((pt, i) => {
              if (i > 0 && pt.idx - pts[i - 1].idx > 1) { if (cur.length) segs.push(cur); cur = []; }
              cur.push(pt);
            });
            if (cur.length) segs.push(cur);
            return segs;
          };
          const pathOf = (seg) => seg.map(pt => `${toX(pt.idx).toFixed(1)},${toY(pt.v).toFixed(1)}`).join(' ');
          const lineColor = statusColor === C.muted ? C.blue : statusColor;
          const last = primary[primary.length - 1];
          // Draw the P1 line only when it is genuinely on the axis. When the
          // keyword ranks below 10 the line sits off the top — mark it at the
          // edge rather than stretching the axis down to reach it, which is
          // what used to eat the chart's resolution.
          const showP1 = 10 >= lo && 10 <= hi;
          const p1Above = 10 < lo;
          spark = (
            <svg width={CHART_W} height={CHART_H} style={{ display: 'block', marginBottom: 4, overflow: 'visible' }}>
              {showP1 && (
                <>
                  <line x1={PAD} y1={toY(10)} x2={CHART_W - PAD} y2={toY(10)}
                    stroke="rgba(34,197,94,0.35)" strokeWidth={1} strokeDasharray="2,2" />
                  <text x={CHART_W - PAD + 2} y={toY(10) + 2.5} fontSize={7}
                    fill="rgba(34,197,94,0.45)" fontFamily={monoStack}>P1</text>
                </>
              )}
              {p1Above && (
                <text x={PAD} y={PAD + 5} fontSize={7}
                  fill="rgba(34,197,94,0.40)" fontFamily={monoStack}>↑P1</text>
              )}
              {toSegments(secondary).filter(s => s.length >= 2).map((seg, si) => (
                <polyline key={`s${si}`} points={pathOf(seg)} fill="none"
                  stroke={C.muted} strokeWidth={1} opacity={0.4} />
              ))}
              {toSegments(primary).map((seg, si) => seg.length >= 2 ? (
                <polyline key={`p${si}`} points={pathOf(seg)} fill="none"
                  stroke={lineColor} strokeWidth={1.5} opacity={0.9} />
              ) : (
                <circle key={`p${si}`} cx={toX(seg[0].idx)} cy={toY(seg[0].v)} r={1.5}
                  fill={lineColor} opacity={0.9} />
              ))}
              <circle cx={toX(last.idx)} cy={toY(last.v)} r={3} fill={lineColor} />
            </svg>
          );
        }

        return (
          <div key={fix.id} style={{
            padding: '10px 14px',
            borderBottom: i < monitoring.length - 1 ? `1px solid ${C.border}` : 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{
                fontSize: 12, color: C.text, fontWeight: 600,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
              }}>"{fix.query}"</span>
              {stale && (
                <span style={{ fontSize: 9, color: C.amber, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', flexShrink: 0 }}>
                  ⚠ stale — data only through {fmtDate(String(latest.snapshot_date).slice(0, 10))}
                </span>
              )}
              {stateChip ? (
                <span style={{ fontSize: 9, color: stateChip.color, fontWeight: 600, letterSpacing: 0.3, flexShrink: 0 }}>
                  {stateChip.label}
                </span>
              ) : (
                <span style={{ fontSize: 10, color: statusColor, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', flexShrink: 0 }}>
                  {delta == null ? `pos ${currentPos.toFixed(1)}` : delta > 0.5 ? `▲ +${delta.toFixed(1)}` : delta < -0.5 ? `▼ ${delta.toFixed(1)}` : '→ No change'}
                </span>
              )}
            </div>

            {spark}

            <div style={{
              fontSize: 10, color: C.muted, fontFamily: monoStack,
              display: 'flex', gap: 10, flexWrap: 'wrap',
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '45%' }}>{fix.page}</span>
              <span>Start: <strong style={{ color: C.text }}>{startPos != null ? startPos.toFixed(1) : '—'}</strong> ({fmtAge(age)} ago)</span>
              <span title="7-day mean ending at the latest GSC data date">Now (7d): <strong style={{ color: stateChip ? C.muted : statusColor }}>{currentPos != null ? currentPos.toFixed(1) : '—'}</strong></span>
              {latest && latest.position_1d != null && (
                <span title="True position on the latest GSC data date">Day: <strong style={{ color: C.text }}>{Number(latest.position_1d).toFixed(1)}</strong></span>
              )}
              {latest && latest.position != null && <span>{latest.impressions}imp · {latest.clicks}clk</span>}
            </div>
          </div>
        );
      })}

      {graduated.length > 0 && (
        <details>
          <summary style={{
            padding: '10px 14px', cursor: 'pointer', userSelect: 'none',
            fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: 0.5,
            textTransform: 'uppercase', borderTop: `1px solid ${C.border}`,
          }}>🎓 Graduated ({graduated.length})</summary>
          {graduated.map((fix) => {
            const h = byFix[fix.id] || [];
            const lastPos = [...h].reverse().find(s => s.position != null);
            return (
              <div key={fix.id} style={{
                display: 'flex', gap: 10, padding: '6px 14px', fontSize: 11,
                borderTop: `1px solid ${C.border}`, color: C.muted, fontFamily: monoStack,
              }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text }}>"{fix.query}"</span>
                <span>{fix.baseline_pos != null ? Number(fix.baseline_pos).toFixed(1) : '—'} → <strong style={{ color: C.green }}>{lastPos ? Number(lastPos.position).toFixed(1) : '—'}</strong></span>
              </div>
            );
          })}
        </details>
      )}
    </div>
  );
}

// ── SEO Panel ──────────────────────────────────────────────────────────────
function SeoPanel({ seo, days, actions = [], onComplete, onDismiss, onSync }) {
  // The API returns flat { totals: {clicks, impressions, ctr, avg_position}, daily, top_queries, top_pages }.
  // Normalize: read totals directly, map avg_position → position for display code.
  const normalizeTotals = (raw) => {
    if (!raw) return {};
    return { ...raw, position: raw.position || raw.avg_position || '' };
  };
  // Current period totals — API returns seo.totals (flat, no current/previous wrapper).
  const t = normalizeTotals(seo.totals || {});
  // Prior period, straight from the API's own `previous` block — a real query
  // over the `days` days immediately before the current window.
  //
  // This used to be derived by subtracting the current window from a separate
  // double-length one. Clicks and impressions survive that (they sum), but
  // position and CTR are averages and were passed through unsubtracted, so the
  // comparison was current-7d against a 14d average *containing those same 7
  // days*. Every position delta came out damped toward zero — the Avg Position
  // arrow could never show a real move.
  const p = normalizeTotals(seo.previous?.totals || {});
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

  // ── Page categorization for Top Pages ──
  // Money pages = pages with buying intent (dumpster rental, services, pricing, homepage)
  // Resource pages = informational (landfill guides, blog, permits)
  const classifyPage = (path) => {
    const p = (path || '').toLowerCase();
    if (p === '/' || p === '' || p === '/index.html') return 'money';
    if (p.includes('dumpster-rental') || p.includes('dumpster_rental')) return 'money';
    if (p.includes('services') || p.includes('pricing') || p.includes('contact')) return 'money';
    if (p.includes('construction-dumpster') || p.includes('residential-dumpster')) return 'money';
    return 'resource';
  };

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


      {/* ── Money Page Movement — position delta on buying-intent pages ── */}
      {seo.top_pages && seo.top_pages.length > 0 && (() => {
        const allPages = seo.top_pages.map(p => ({ ...p, path: p.path || p.page || p.page_url || '', type: classifyPage(p.path || p.page || p.page_url || '') }));
        const moneyPages = allPages.filter(p => p.type === 'money').sort((a, b) => b.impressions - a.impressions);
        const resourcePages = allPages.filter(p => p.type === 'resource').sort((a, b) => b.impressions - a.impressions);

        // Prior-period position per page, from the API's `previous` block —
        // the same `days`-long window offset back by `days`, so a page's delta
        // is a like-for-like comparison instead of current-vs-a-window-that-
        // includes-current.
        const prevPages = seo.previous?.top_pages || [];
        const prevMap = {};
        prevPages.forEach(p => {
          const path = p.path || p.page || p.page_url || '';
          prevMap[path] = Number(p.position);
        });

        return (
          <>
            {/* Money Page Movement */}
            <div style={{
              background: C.panel, border: `1px solid ${C.border}`,
              borderRadius: 8, overflow: 'hidden', marginBottom: 12,
            }}>
              <div style={{
                fontSize: 10, color: C.green, textTransform: 'uppercase',
                letterSpacing: 0.8, fontWeight: 600, padding: '10px 14px',
                borderBottom: `1px solid ${C.border}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span>💰 Money Page Movement</span>
                {prevPages.length > 0 && <span style={{ color: C.faint, fontWeight: 400, textTransform: 'none', fontSize: 9 }}>vs prior {days}d</span>}
              </div>
              {moneyPages.length === 0 ? (
                <div style={{ padding: '12px 14px', fontSize: 12, color: C.muted }}>No rental/service pages in GSC data yet.</div>
              ) : moneyPages.map((p, i) => {
                const pos = Number(p.position);
                const prevPos = prevMap[p.path || p.page_url || ''];
                const hasDelta = prevPos != null && !isNaN(prevPos);
                const delta = hasDelta ? prevPos - pos : null; // positive = improving
                const posColor = pos <= 10 ? C.green : pos <= 20 ? '#22d3ee' : pos <= 30 ? C.amber : C.red;
                const deltaColor = delta > 0.5 ? C.green : delta < -0.5 ? C.red : C.muted;
                const deltaLabel = delta > 0.5 ? `▲${delta.toFixed(1)}` : delta < -0.5 ? `▼${Math.abs(delta).toFixed(1)}` : '—';
                return (
                  <div key={i} style={{
                    padding: '10px 14px',
                    borderBottom: i < moneyPages.length - 1 ? `1px solid ${C.border}` : 'none',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    {/* Position badge */}
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 32, height: 24, borderRadius: 4, fontSize: 12, fontWeight: 700,
                      fontFamily: monoStack, background: `${posColor}18`, color: posColor,
                      border: `1px solid ${posColor}40`, flexShrink: 0,
                    }}>{pos.toFixed(0)}</span>
                    {/* Delta arrow */}
                    {hasDelta && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, fontFamily: monoStack,
                        color: deltaColor, width: 36, textAlign: 'center', flexShrink: 0,
                      }}>{deltaLabel}</span>
                    )}
                    {/* Page path */}
                    <span style={{
                      fontSize: 11.5, color: C.text, fontFamily: monoStack,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                    }}>{p.path}</span>
                    {/* Stats */}
                    <span style={{ fontSize: 10, color: C.muted, fontFamily: monoStack, flexShrink: 0, display: 'flex', gap: 8 }}>
                      <span style={{ color: p.clicks > 0 ? C.green : C.muted, fontWeight: 600 }}>{p.clicks}cl</span>
                      <span>{p.impressions}imp</span>
                      <span>{p.ctr}</span>
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Resource Pages — collapsed */}
            {resourcePages.length > 0 && (
              <details style={{
                background: C.panel, border: `1px solid ${C.border}`,
                borderRadius: 8, overflow: 'hidden', marginBottom: 12,
              }}>
                <summary style={{
                  padding: '10px 14px', cursor: 'pointer', userSelect: 'none',
                  fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: 0.5,
                  textTransform: 'uppercase',
                }}>📄 Resource pages ({resourcePages.length})</summary>
                {resourcePages.map((p, i) => {
                  const pos = Number(p.position);
                  return (
                    <div key={i} style={{
                      display: 'grid', gridTemplateColumns: '1fr 50px 60px 50px',
                      gap: 6, padding: '6px 14px', fontSize: 11, borderTop: `1px solid ${C.border}`,
                      color: C.muted, fontFamily: monoStack,
                    }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.path}</div>
                      <div style={{ textAlign: 'right', color: p.clicks > 0 ? C.green : C.muted }}>{p.clicks}</div>
                      <div style={{ textAlign: 'right' }}>{p.impressions}</div>
                      <div style={{ textAlign: 'right', color: pos <= 10 ? C.green : C.muted }}>{p.position}</div>
                    </div>
                  );
                })}
              </details>
            )}
          </>
        );
      })()}

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

      {/* Summary */}
      {(() => {
        const cClicks = Number(t.clicks) || 0;
        const pClicks = Number(p.clicks) || 0;
        const cPos = parseFloat(t.position);
        const pPos = parseFloat(p.position);
        const clickDelta = pClicks > 0 ? Math.round(((cClicks - pClicks) / pClicks) * 100) : null;
        const posImprovement = !isNaN(cPos) && !isNaN(pPos) ? (pPos - cPos).toFixed(1) : null;

        // Top CTR opportunity from pages
        const ctrOpp = (seo.top_pages || []).find(p => {
          const ctrNum = parseFloat(String(p.ctr).replace('%', ''));
          return p.impressions >= 50 && ctrNum < 1 && Number(p.position) <= 30;
        });
        // Biggest ranking opportunity — page 2+ queries with meaningful demand
        const bigOpp = queries
          .filter(q => Number(q.position) > 10 && q.impressions >= 10)
          .sort((a, b) => b.impressions - a.impressions)[0];

        let tone, headline, action;
        const trendingUp = clickDelta != null && clickDelta > 0 && posImprovement != null && Number(posImprovement) > 0;
        const trendingDown = clickDelta != null && clickDelta < -25 && posImprovement != null && Number(posImprovement) < 0;

        if (trendingUp) {
          tone = 'positive';
          headline = (
            <>
              Strong upward trend.
              {clickDelta > 50 && <> Clicks <strong>{clickDelta > 0 ? '+' : ''}{clickDelta}%</strong> vs prior period.</>}
              {clickDelta <= 50 && clickDelta > 0 && <> Clicks up <strong>{clickDelta}%</strong>.</>}
              {Number(posImprovement) > 2 && (
                <> Average position improved <strong>{posImprovement} spots</strong> ({pPos.toFixed(1)} → {cPos.toFixed(1)}).</>
              )}
            </>
          );
        } else if (trendingDown) {
          tone = 'attention';
          headline = (
            <>
              Visibility softened. Clicks <strong>{clickDelta}%</strong> vs prior period and position drifted from {pPos.toFixed(1)} to {cPos.toFixed(1)}.
            </>
          );
        } else {
          tone = 'neutral';
          headline = (
            <>
              {cClicks} click{cClicks !== 1 && 's'} on {fmtNum(t.impressions)} impressions, average position {t.position}.
              {clickDelta != null && <> Clicks {clickDelta >= 0 ? '+' : ''}{clickDelta}% vs prior period.</>}
            </>
          );
        }

        // Build action from biggest visible opportunity
        const actions = [];
        if (bigOpp) {
          actions.push(
            <span key="opp">
              Push <strong>"{bigOpp.query}"</strong> to page 1 — currently position {bigOpp.position} with {fmtNum(bigOpp.impressions)} impressions of demand.
            </span>
          );
        }
        if (ctrOpp) {
          actions.push(
            <span key="ctr">
              Optimize title/meta on <strong>{ctrOpp.path}</strong> ({fmtNum(ctrOpp.impressions)} impressions, {ctrOpp.ctr} CTR — better headline → more clicks at zero ranking cost).
            </span>
          );
        }
        action = actions.length === 0 ? null : (
          <span>
            {actions.map((a, i) => (
              <span key={i}>{i > 0 && <> </>}{a}</span>
            ))}
          </span>
        );

        return <InsightSummary tone={tone} headline={headline} action={action} actions={actions} onComplete={onComplete} onDismiss={onDismiss} />;
      })()}

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
