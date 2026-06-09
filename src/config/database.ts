import { Sequelize } from 'sequelize';
import { env } from './env';

export const sequelize = new Sequelize({
  dialect: 'postgres',
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  username: env.DB_USER,
  password: env.DB_PASSWORD,
  logging: env.NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
});

export async function connectDatabase(): Promise<void> {
  try {
    await sequelize.authenticate();
    console.log('[Database] Connection established successfully.');
    await sequelize.sync({ alter: env.NODE_ENV === 'development' });
    console.log('[Database] Models synchronized.');
  } catch (error) {
    console.error('[Database] Unable to connect:', error);
    throw error;
  }
}
