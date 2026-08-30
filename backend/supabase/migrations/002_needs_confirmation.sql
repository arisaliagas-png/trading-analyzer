-- 002: needs_confirmation flag
-- TRUE when the scanner emitted a PENDING/WAIT setup due to weak/conflicting
-- signals (regime, CVD opposition, lesson veto, flow). The trade tracker must
-- NOT auto-activate these when price merely enters the OTE zone — they need a
-- fresh scanner run that upgrades them to ACTIVE. Prevents bearish-CVD LONGs
-- from being auto-fired then stopped out.
ALTER TABLE trades ADD COLUMN IF NOT EXISTS needs_confirmation BOOLEAN DEFAULT FALSE;
