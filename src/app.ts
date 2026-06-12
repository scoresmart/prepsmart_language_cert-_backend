import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';

import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import questionRoutes from './routes/questionRoutes';
import testRoutes from './routes/testRoutes';
import profileRoutes from './routes/profileRoutes';
import studentAccessRoutes from './routes/studentAccessRoutes';
import tutorRoutes from './routes/tutorRoutes';
import slotRoutes from './routes/slotRoutes';
import ticketRoutes from './routes/ticketRoutes';
import materialRoutes from './routes/materialRoutes';
import announcementRoutes from './routes/announcementRoutes';
import communityRoutes from './routes/communityRoutes';
import assessmentRoutes from './routes/assessmentRoutes';
import templateRoutes from './routes/templateRoutes';
import practiceRoutes from './routes/practiceRoutes';

const app = express();

// Security middleware
app.use(helmet());
const corsOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
app.use(cors({ origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins, credentials: true }));

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'prepsmart-language-cert-api', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/questions', questionRoutes);
app.use('/api/v1/tests', testRoutes);
app.use('/api/v1/profiles', profileRoutes);
app.use('/api/v1/access', studentAccessRoutes);
app.use('/api/v1/tutors', tutorRoutes);
app.use('/api/v1/slots', slotRoutes);
app.use('/api/v1/tickets', ticketRoutes);
app.use('/api/v1/materials', materialRoutes);
app.use('/api/v1/announcements', announcementRoutes);
app.use('/api/v1/communities', communityRoutes);
app.use('/api/v1/assessments', assessmentRoutes);
app.use('/api/v1/templates', templateRoutes);
app.use('/api/v1/practice', practiceRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
