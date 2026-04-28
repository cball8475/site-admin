// FinancialsPanel.jsx — FSC Financial snapshot tile
// Pulls from /financials on florence-crm-api (v2.15.0+)
// Data source: Mercury MCP → D1 financials table

import { useState, useEffect } from 'react';

const C = {
  panel: '#0e1a26', card: '#142031',
  border: 'rgba(99,179,237,0.12)', borderStrong: 'rgba(99,179,237,0.22)',
  muted: 'rgba(200,223,240,0.4)', faint: 'rgba(200,223,240,0.25)', text: '#c8dff0',
  green: '#22c55e', amber: '#f59e0b', blue: '#38bdf8', red: '#ef4444',
};

const mono = "'IBM Plex Mono', monospace";
const sans = "'IBM Plex Sans', system-ui, sans-serif";

const fmt = (n) => '$' + Number(n || 0).toFixed(2);

export default function FinancialsPanel({ data }) {
  if (!data) return null;

  const {
    revenue = 0, total_invested = 0, google_ads_spend = 0,
    twilio_spend = 0, other_spend = 0, total_spend = 0,
    cash_on_hand = 0, cashback_earned = 0, snapshot_date, notes,
  } = data;

  // Runway calc: daily spend rate from total spend over days since first transaction (Apr 1)
  const daysSinceStart = Math.max(1, Math.round(
    (new Date() - new Date('2026-04-01')) / 86400000
  ));
  const dailyBurn = total_spend / daysSinceStart;
  const runwayDays = dailyBurn > 0 ? Math.floor(cash_on_hand / dailyBurn) : 999;

  const statStyle = {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
    padding: '10px 12px', flex: '1 1 130px', minWidth: 120,
  };
  const lblStyle = {
    fontSize: 10, color: C.muted, textTransform: 'uppercase',
    letterSpacing: 0.7, fontWeight: 600, fontFamily: sans,
  };
  const valStyle = {
    fontSize: 20, fontFamily: mono, fontWeight: 600, marginTop: 3, color: C.text,
  };
  const subStyle = { fontSize: 11, color: C.faint, fontFamily: mono, marginTop: 2 };

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={statStyle}>
          <div style={lblStyle}>Revenue</div>
          <div style={{ ...valStyle, color: revenue > 0 ? C.green : C.faint }}>{fmt(revenue)}</div>
          <div style={subStyle}>{revenue > 0 ? 'Active' : 'Pre-CSA'}</div>
        </div>
        <div style={statStyle}>
          <div style={lblStyle}>Total Spend</div>
          <div style={valStyle}>{fmt(total_spend)}</div>
          <div style={subStyle}>Ads + infra</div>
        </div>
        <div style={statStyle}>
          <div style={lblStyle}>Cash on Hand</div>
          <div style={{ ...valStyle, color: cash_on_hand < 30 ? C.red : cash_on_hand < 80 ? C.amber : C.text }}>
            {fmt(cash_on_hand)}
          </div>
          <div style={subStyle}>~{runwayDays}d runway</div>
        </div>
        <div style={statStyle}>
          <div style={lblStyle}>Invested</div>
          <div style={valStyle}>{fmt(total_invested)}</div>
          <div style={subStyle}>Personal capital</div>
        </div>
      </div>

      {/* Spend breakdown */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: 14, marginBottom: 10,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 10, fontFamily: sans }}>
          SPEND BREAKDOWN
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <tbody>
            {[
              ['Google Ads', google_ads_spend, (google_ads_spend / (total_spend || 1) * 100).toFixed(0) + '%'],
              ['Twilio', twilio_spend, (twilio_spend / (total_spend || 1) * 100).toFixed(0) + '%'],
              ...(other_spend > 0 ? [['Other', other_spend, (other_spend / (total_spend || 1) * 100).toFixed(0) + '%']] : []),
            ].map(([label, amount, pct]) => (
              <tr key={label}>
                <td style={{ padding: '5px 0', color: C.text, fontFamily: sans }}>{label}</td>
                <td style={{ padding: '5px 0', textAlign: 'right', fontFamily: mono, color: C.text }}>
                  {fmt(amount)}
                </td>
                <td style={{ padding: '5px 0', textAlign: 'right', fontFamily: mono, color: C.faint, width: 50 }}>
                  {pct}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={{ padding: '6px 0 0', color: C.text, fontWeight: 600, fontFamily: sans }}>Total</td>
              <td style={{ padding: '6px 0 0', textAlign: 'right', fontFamily: mono, fontWeight: 600, color: C.text }}>
                {fmt(total_spend)}
              </td>
              <td></td>
            </tr>
          </tbody>
        </table>
        {cashback_earned > 0 && (
          <div style={{ fontSize: 11, color: C.faint, fontFamily: mono, marginTop: 8 }}>
            Mercury cashback: {fmt(cashback_earned)}
          </div>
        )}
      </div>

      {/* P&L summary bar */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: '10px 14px', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', fontSize: 12, fontFamily: mono,
      }}>
        <span style={{ color: C.muted }}>Net P&L</span>
        <span style={{ color: (revenue - total_spend) >= 0 ? C.green : C.red, fontWeight: 600, fontSize: 16 }}>
          {(revenue - total_spend) >= 0 ? '+' : ''}{fmt(revenue - total_spend)}
        </span>
      </div>

      {notes && (
        <div style={{ fontSize: 11, color: C.faint, marginTop: 8, fontStyle: 'italic', lineHeight: 1.4 }}>
          {notes}
        </div>
      )}
    </div>
  );
}
