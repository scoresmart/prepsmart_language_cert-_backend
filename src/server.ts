import app from './app';
import { connectDatabase } from './config/database';
import { ensureSpeakingAudioBucket } from './utils/ensureSpeakingAudioBucket';
import { env } from './config/env';

const PORT = env.PORT || 5000;

async function bootstrap() {
  try {
    await connectDatabase();
    await ensureSpeakingAudioBucket();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[Server] PrepSmart Language Cert API running on port ${PORT}`);
      console.log(`[Server] Environment: ${env.NODE_ENV}`);
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

bootstrap();
