-- Create withdrawals table
CREATE TABLE IF NOT EXISTS withdrawals (
  id SERIAL PRIMARY KEY,
  withdrawal_id VARCHAR(78) NOT NULL UNIQUE,
  l2_token VARCHAR(42),
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  amount VARCHAR(78) NOT NULL,
  l2_withdrawal_nonce VARCHAR(78) NOT NULL,
  l2_block_number BIGINT NOT NULL,
  l1_transaction_hash VARCHAR(66),
  l1_finalize_hash VARCHAR(66),
  status VARCHAR(20) NOT NULL, -- 'pending', 'ready', 'finalized', 'challenged'
  initiated_at TIMESTAMP NOT NULL,
  finalized_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_from ON withdrawals(from_address);
CREATE INDEX IF NOT EXISTS idx_withdrawals_to ON withdrawals(to_address);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_id ON withdrawals(withdrawal_id);

-- Create withdrawals view with calculated fields
CREATE OR REPLACE VIEW withdrawals_with_status AS
SELECT 
  w.*,
  CASE 
    WHEN w.status = 'finalized' THEN 'claimed'
    WHEN w.status = 'pending' AND 
         EXTRACT(EPOCH FROM (NOW() - w.initiated_at)) >= 604800 THEN 'ready'
    ELSE 'pending'
  END as display_status,
  GREATEST(0, 604800 - EXTRACT(EPOCH FROM (NOW() - w.initiated_at)))::BIGINT as seconds_remaining
FROM withdrawals w;
