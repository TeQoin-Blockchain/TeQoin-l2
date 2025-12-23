ALTER TABLE withdrawals 
ADD COLUMN IF NOT EXISTS cancelled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS error_message TEXT,
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- 2. Create deposits table (if not exists)
CREATE TABLE IF NOT EXISTS deposits (
    id BIGSERIAL PRIMARY KEY,
    deposit_nonce BIGINT NOT NULL UNIQUE,
    l1_token VARCHAR(42) NOT NULL,
    from_address VARCHAR(42) NOT NULL,
    to_address VARCHAR(42) NOT NULL,
    amount VARCHAR(78) NOT NULL,
    l1_transaction_hash VARCHAR(66) NOT NULL,
    l1_block_number BIGINT NOT NULL,
    status VARCHAR(20) DEFAULT 'detected',
    l2_processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
CREATE INDEX IF NOT EXISTS idx_deposits_from ON deposits(from_address);
CREATE INDEX IF NOT EXISTS idx_deposits_l1_tx ON deposits(l1_transaction_hash);

-- 3. Create transactions table (enhanced)
CREATE TABLE IF NOT EXISTS transactions (
    id BIGSERIAL PRIMARY KEY,
    hash VARCHAR(66) NOT NULL UNIQUE,
    block_number BIGINT NOT NULL,
    from_address VARCHAR(42) NOT NULL,
    to_address VARCHAR(42),
    value VARCHAR(78) NOT NULL,
    gas_used BIGINT,
    gas_price VARCHAR(78),
    nonce BIGINT NOT NULL,
    input TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    is_gasless BOOLEAN DEFAULT FALSE,
    relayer_address VARCHAR(42),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transactions_hash ON transactions(hash);
CREATE INDEX IF NOT EXISTS idx_transactions_block ON transactions(block_number);
CREATE INDEX IF NOT EXISTS idx_transactions_from ON transactions(from_address);
CREATE INDEX IF NOT EXISTS idx_transactions_to ON transactions(to_address);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_gasless ON transactions(is_gasless);

-- 4. Update withdrawals_with_status view
DROP VIEW IF EXISTS withdrawals_with_status;

CREATE OR REPLACE VIEW withdrawals_with_status AS
SELECT 
    w.*,
    b.status as batch_status,
    b.submitted_at as batch_submitted_at,
    CASE 
        WHEN w.finalized_at IS NOT NULL THEN 'finalized'
        WHEN w.cancelled = TRUE THEN 'cancelled'
        WHEN w.status = 'finalized' THEN 'finalized'
        WHEN w.l1_transaction_hash IS NOT NULL AND b.status = 'finalized' THEN 'ready'
        WHEN w.l1_transaction_hash IS NOT NULL THEN 'initiated'
        ELSE 'pending'
    END as display_status,
    CASE 
        WHEN w.l1_transaction_hash IS NOT NULL 
            AND b.status = 'submitted' 
            AND b.submitted_at IS NOT NULL
        THEN GREATEST(0, EXTRACT(EPOCH FROM (
            b.submitted_at + INTERVAL '7 days' - NOW()
        )))
        ELSE 0
    END as seconds_remaining
FROM withdrawals w
LEFT JOIN batches b ON w.l2_block_number >= b.l2_block_number 
    AND b.status IN ('submitted', 'finalized')
ORDER BY w.initiated_at DESC;

-- 5. Create relayer_stats table for gasless tracking
CREATE TABLE IF NOT EXISTS relayer_stats (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    transactions_relayed INTEGER DEFAULT 0,
    gas_spent VARCHAR(78) DEFAULT '0',
    users_served INTEGER DEFAULT 0,
    success_rate DECIMAL(5,2) DEFAULT 100.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date)
);

CREATE INDEX IF NOT EXISTS idx_relayer_stats_date ON relayer_stats(date);

-- 6. Create system_metrics table
CREATE TABLE IF NOT EXISTS system_metrics (
    id BIGSERIAL PRIMARY KEY,
    metric_name VARCHAR(100) NOT NULL,
    metric_value VARCHAR(255) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_system_metrics_name ON system_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_system_metrics_timestamp ON system_metrics(timestamp);

-- 7. Add triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_deposits_updated_at ON deposits;
CREATE TRIGGER update_deposits_updated_at 
    BEFORE UPDATE ON deposits 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_withdrawals_updated_at ON withdrawals;
CREATE TRIGGER update_withdrawals_updated_at 
    BEFORE UPDATE ON withdrawals 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- 8. Useful queries for monitoring

-- Get pending withdrawals
CREATE OR REPLACE VIEW pending_withdrawals_summary AS
SELECT 
    COUNT(*) as total_pending,
    SUM(CAST(amount AS NUMERIC)) as total_amount_pending,
    MIN(initiated_at) as oldest_pending
FROM withdrawals 
WHERE status = 'pending' AND cancelled = FALSE;

-- Get recent activity
CREATE OR REPLACE VIEW recent_activity AS
SELECT 
    'deposit' as activity_type,
    from_address as user_address,
    amount,
    created_at as timestamp
FROM deposits 
WHERE created_at > NOW() - INTERVAL '1 day'
UNION ALL
SELECT 
    'withdrawal' as activity_type,
    from_address as user_address,
    amount,
    initiated_at as timestamp
FROM withdrawals 
WHERE initiated_at > NOW() - INTERVAL '1 day'
ORDER BY timestamp DESC
LIMIT 100;

-- Get batch statistics
CREATE OR REPLACE VIEW batch_statistics AS
SELECT 
    status,
    COUNT(*) as count,
    AVG(CAST(l2_block_number AS NUMERIC)) as avg_block_number,
    MAX(submitted_at) as last_submitted
FROM batches
GROUP BY status;

COMMENT ON VIEW withdrawals_with_status IS 'Enhanced withdrawal view with status calculation';
COMMENT ON VIEW pending_withdrawals_summary IS 'Summary of pending withdrawals';
COMMENT ON VIEW recent_activity IS 'Recent deposits and withdrawals';
COMMENT ON VIEW batch_statistics IS 'Batch submission statistics';

-- Grant permissions (adjust as needed)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sequencer;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO sequencer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sequencer;