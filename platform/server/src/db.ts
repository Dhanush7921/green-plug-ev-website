import postgres from 'postgres';
import { config } from './config';

// Tagged-template queries are always parameterised by the driver (no string concatenation of user input).
// numeric/bigint columns arrive as strings; queries cast to ::float8 / ::int where JS numbers are needed.
export const sql = postgres(config.databaseUrl, {
  max: Number(process.env.DB_POOL_SIZE || 10),
  transform: postgres.camel,
  onnotice: () => {},
});

export type Sql = typeof sql;
export type Tx = postgres.TransactionSql<{}>;
export type Q = postgres.ISql<{}> & { json: Sql["json"] };
