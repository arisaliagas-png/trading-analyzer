import React, { useState } from 'react';

export default function PositionCalculator({ entryPrice, slPrice, direction = 'LONG', isGreek = true }) {
  const [accountBalance, setAccountBalance] = useState(10000);
  const [riskPct, setRiskPct] = useState(1);

  const entry = parseFloat(entryPrice) || 0;
  const sl = parseFloat(slPrice) || 0;

  let slDistPct = 0;
  if (entry > 0 && sl > 0) {
    slDistPct = Math.abs((entry - sl) / entry) * 100;
  }

  const maxRiskAmount = (accountBalance * riskPct) / 100;

  let positionSizeUSD = 0;
  let units = 0;
  if (slDistPct > 0) {
    positionSizeUSD = maxRiskAmount / (slDistPct / 100);
    units = entry > 0 ? positionSizeUSD / entry : 0;
  }

  return (
    <div style={{
      background: 'rgba(15, 23, 42, 0.8)',
      border: '1px solid #334155',
      borderRadius: '12px',
      padding: '16px',
      marginTop: '16px',
      color: '#f8fafc'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
          🧮 {isGreek ? 'Υπολογιστής Μεγέθους Θέσης (Position Size & Risk)' : 'Position Size & Risk Calculator'}
        </h4>
        <span style={{ fontSize: '0.75rem', background: '#1e293b', padding: '2px 8px', borderRadius: '4px', color: '#94a3b8' }}>
          Risk Management
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '12px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px' }}>
            {isGreek ? 'Κεφάλαιο Λογαριασμού ($)' : 'Account Balance ($)'}
          </label>
          <input
            type="number"
            value={accountBalance}
            onChange={(e) => setAccountBalance(Math.max(0, parseFloat(e.target.value) || 0))}
            style={{
              width: '100%',
              background: '#0f172a',
              border: '1px solid #475569',
              borderRadius: '6px',
              color: '#fff',
              padding: '6px 10px',
              fontSize: '0.85rem'
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px' }}>
            {isGreek ? 'Επιθυμητό Ρίσκο (%)' : 'Risk Amount (%)'}
          </label>
          <input
            type="number"
            step="0.1"
            value={riskPct}
            onChange={(e) => setRiskPct(Math.max(0.1, parseFloat(e.target.value) || 0))}
            style={{
              width: '100%',
              background: '#0f172a',
              border: '1px solid #475569',
              borderRadius: '6px',
              color: '#fff',
              padding: '6px 10px',
              fontSize: '0.85rem'
            }}
          />
        </div>
      </div>

      {entry > 0 && sl > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', background: '#020617', padding: '10px', borderRadius: '8px' }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{isGreek ? 'Μέγιστο Ρίσκο ($)' : 'Max Loss ($)'}</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 'bold', color: '#ef4444' }}>
              ${maxRiskAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{isGreek ? 'Μέγεθος Θέσης ($)' : 'Position Size ($)'}</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 'bold', color: '#38bdf8' }}>
              ${positionSizeUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{isGreek ? 'Ποσότητα (Units)' : 'Units'}</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 'bold', color: '#f59e0b' }}>
              {units < 1 ? units.toFixed(4) : units.toFixed(2)}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{isGreek ? 'Απόσταση SL (%)' : 'SL Distance (%)'}</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 'bold', color: '#94a3b8' }}>
              {slDistPct.toFixed(2)}%
            </div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic', textAlign: 'center', padding: '8px' }}>
          {isGreek ? 'Εισάγετε τιμές Entry & Stop Loss για υπολογισμό.' : 'Enter Entry & Stop Loss to compute size.'}
        </div>
      )}
    </div>
  );
}
