import { Pool } from 'pg';
/**
 * Initialize database connection pool
 */
export declare function initDatabase(databaseUrl: string): Promise<void>;
/**
 * Get database pool
 */
export declare function getPool(): Pool;
/**
 * Execute query
 */
export declare function query(text: string, params?: any[]): Promise<any>;
/**
 * Close database connection
 */
export declare function closeDatabase(): Promise<void>;
declare const _default: {
    initDatabase: typeof initDatabase;
    getPool: typeof getPool;
    query: typeof query;
    closeDatabase: typeof closeDatabase;
};
export default _default;
//# sourceMappingURL=connection.d.ts.map