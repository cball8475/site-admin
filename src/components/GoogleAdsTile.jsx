// GoogleAdsTile.jsx — Google Ads performance tile for FSC dashboard
// Pulls from /ads/metrics endpoint on florence-crm-api (v2.10.0+)
// Requires: recharts (npm i recharts), VITE_API_BASE + VITE_API_TOKEN env vars
// Drop into: site-admin/src/components/GoogleAdsTile.jsx

import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';

const API_BASE = import.meta.env.PROD ? '/api' : (import.meta.env.VITE_CRM_API_URL || import.meta.env.VITE_API_BASE || '');
const API_TOKEN = import.meta.env.PROD ? '' : (import.meta.env.VITE_CRM_API_TOKEN || import.meta.env.VITE_API_TOKEN || '');

// FSC target cities for Zone 1 + Zone 4 (current ad geo)
const TARGET_CITIES = [
  'florence','effingham','timmonsville','darlington','hartsville',
  'lamar','lake city','pamplico','johnsonville','scranton','coward',
  'quinby','society hill','dovesville',
];

function isTargetCity(city) {
  if (!city) return false;
  return TARGET_CITIES.some(tc => city.toLowerCase().includes(tc));
}

function delta(current, previous) {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous * 100).toFixed(0);
}

function DeltaBadge({ value }) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  const isUp = n > 0;
  const color = isUp ? '#22c55e' : n < 0 ? '#ef4444' : '#6b7280';
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color,
      marginLeft: 6,
    }}>
      {isUp ? '↑' : n < 0 ? '↓' : '—'}{Math.abs(n)}%
    </span>
  );
}

function StatCard({ label, value, prev, prefix }) {
  const d = delta(
    typeof value === 'string' ? parseFloat(value.replace(/[$%,]/g, '')) : value,
    prev
  );
  return (
    <div style={{
      flex: '1 1 140px', padding: '12px 14px',
      background: '#0e1623', border: '1px solid rgba(99,179,237,0.10)',
      borderRadius: 8, minWidth: 0,
    }}>
      <div style={{
        fontSize: 10, color: 'rgba(226,232,240,0.55)', textTransform: 'uppercase',
        letterSpacing: 0.8, fontWeight: 600, marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontSize: 20, fontWeight: 700, color: '#e2e8f0',
        fontFamily: "'IBM Plex Mono', monospace",
      }}>
        {prefix}{value}
        <DeltaBadge value={d} />
      </div>
    </div>
  );
}

function GeoRow({ city, clicks, impressions, spend, inZone }) {
  return (
    <tr style={{ borderBottom: '1px solid rgba(99,179,237,0.08)' }}>
      <td style={{
        padding: '6px 10px', fontSize: 12.5, color: inZone ? '#e2e8f0' : '#f59e0b',
        fontWeight: inZone ? 400 : 600,
      }}>
        {city}
        {!inZone && <span style={{ fontSize: 10, marginLeft: 6, color: '#f59e0b' }}>OUT</span>}
      </td>
      <td style={{ padding: '6px 10px', fontSize: 12.5, color: '#e2e8f0', textAlign: 'right' }}>{clicks}</td>
      <td style={{ padding: '6px 10px', fontSize: 12.5, color: 'rgba(226,232,240,0.55)', textAlign: 'right' }}>{impressions}</td>
      <td style={{ padding: '6px 10px', fontSize: 12.5, color: 'rgba(226,232,240,0.55)', textAlign: 'right' }}>${spend.toFixed(2)}</td>
    </tr>
  );
}

export default function GoogleAdsTile() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(7);

  useEffect(() => {
    fetchData();
  }, [days]);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const headers = API_TOKEN ? { 'Authorization': `Bearer ${API_TOKEN}` } : {};
      const res = await fetch(`${API_BASE}/ads/metrics?days=${days}`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const fontStack = "'IBM Plex Sans', system-ui, sans-serif";
  const monoStack = "'IBM Plex Mono', monospace";

  const panelStyle = {
    background: '#131e2e',
    border: '1px solid rgba(99,179,237,0.12)',
    borderRadius: 10,
    padding: 20,
    fontFamily: fontStack,
  };

  if (loading) {
    return (
      <div style={panelStyle}>
        <div style={{ color: 'rgba(226,232,240,0.55)', textAlign: 'center', padding: 40 }}>
          Loading ads data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={panelStyle}>
        <h3 style={{ margin: '0 0 8px', color: '#e2e8f0', fontSize: 15, fontWeight: 600 }}>
          Google Ads — FSC 1
        </h3>
        <div style={{
          padding: '12px 16px', background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6,
          color: '#ef4444', fontSize: 13,
        }}>
          {error}
        </div>
        <button onClick={fetchData} style={{
          marginTop: 10, padding: '6px 14px', background: 'rgba(56,189,248,0.15)',
          color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)',
          borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
        }}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { current, previous, daily, geo, out_of_zone } = data;
  const t = current.totals;
  const p = previous.totals;

  // Chart data: format date labels
  const chartData = (daily || []).map(d => ({
    ...d,
    label: d.date ? new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
  }));

  const outOfZoneClicks = (out_of_zone || []).reduce((s, g) => s + g.clicks, 0);

  return (
    <div style={panelStyle}>
      {/* Header + period selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: 15, fontWeight: 600 }}>
            Google Ads — FSC 1
          </h3>
          <div style={{ fontSize: 11, color: 'rgba(226,232,240,0.4)', fontFamily: monoStack, marginTop: 2 }}>
            {data.current_range?.start} → {data.current_range?.end}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setDays(d)} style={{
              padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
              background: days === d ? 'rgba(56,189,248,0.2)' : 'transparent',
              color: days === d ? '#38bdf8' : 'rgba(226,232,240,0.45)',
              border: `1px solid ${days === d ? 'rgba(56,189,248,0.4)' : 'rgba(99,179,237,0.1)'}`,
              cursor: 'pointer',
            }}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="Spend" value={t.spend.toFixed(2)} prev={p.spend} prefix="$" />
        <StatCard label="Clicks" value={t.clicks} prev={p.clicks} />
        <StatCard label="CTR" value={t.ctr} />
        <StatCard label="CPC" value={t.cpc} />
        <StatCard label="Conversions" value={t.conversions} prev={p.conversions} />
      </div>

      {/* Out-of-zone warning */}
      {outOfZoneClicks > 0 && (
        <div style={{
          padding: '8px 12px', marginBottom: 14, borderRadius: 6,
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
          fontSize: 12, color: '#f59e0b', fontWeight: 500,
        }}>
          ⚠ {outOfZoneClicks} click{outOfZoneClicks > 1 ? 's' : ''} from out-of-zone cities — review geo targeting
        </div>
      )}

      {/* Daily clicks chart */}
      {chartData.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 10, color: 'rgba(226,232,240,0.45)', textTransform: 'uppercase',
            letterSpacing: 0.8, fontWeight: 600, marginBottom: 8,
          }}>Daily Clicks</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,179,237,0.08)" />
              <XAxis
                dataKey="label" tick={{ fontSize: 10, fill: 'rgba(226,232,240,0.4)' }}
                axisLine={{ stroke: 'rgba(99,179,237,0.1)' }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 10, fill: 'rgba(226,232,240,0.4)' }}
                axisLine={false} tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: '#0e1623', border: '1px solid rgba(99,179,237,0.2)',
                  borderRadius: 6, fontSize: 12, color: '#e2e8f0',
                }}
                cursor={{ fill: 'rgba(56,189,248,0.06)' }}
              />
              <Bar dataKey="clicks" radius={[3, 3, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.clicks > 0 ? '#38bdf8' : 'rgba(56,189,248,0.2)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Geo table */}
      {geo && geo.length > 0 && (
        <div>
          <div style={{
            fontSize: 10, color: 'rgba(226,232,240,0.45)', textTransform: 'uppercase',
            letterSpacing: 0.8, fontWeight: 600, marginBottom: 8,
          }}>Clicks by City</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(99,179,237,0.15)' }}>
                  <th style={{ padding: '6px 10px', textAlign: 'left', color: 'rgba(226,232,240,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>City</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', color: 'rgba(226,232,240,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Clicks</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', color: 'rgba(226,232,240,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Impr</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', color: 'rgba(226,232,240,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Spend</th>
                </tr>
              </thead>
              <tbody>
                {geo.map((g, i) => (
                  <GeoRow key={i} {...g} inZone={isTargetCity(g.city)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{
        marginTop: 14, paddingTop: 10, borderTop: '1px solid rgba(99,179,237,0.08)',
        fontSize: 10, color: 'rgba(226,232,240,0.3)', fontFamily: monoStack,
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>via Windsor.ai · 1hr cache</span>
        <span>{data.fetched_at ? new Date(data.fetched_at).toLocaleTimeString() : ''}</span>
      </div>
    </div>
  );
}
