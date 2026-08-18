import http from 'http';
import app from './app';
import { connectDatabase } from './config/database';
import { ensureSpeakingAudioBucket } from './utils/ensureSpeakingAudioBucket';
import { env } from './config/env';
import { attachRealtime, shutdownRealtime, REALTIME_PATH } from './realtime';

const PORT = env.PORT || 5000;

// Express is wrapped in an explicit http.Server so the live speaking examiner
// can take over `upgrade` requests on the same port. Railway exposes exactly
// one port per service, so the REST API and the exam WebSocket must share it.
const server = http.createServer(app);

// An exam turn can run long, and a candidate thinking in silence must not look
// like a dead connection. Node's 5s default header timeout would drop them.
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;

async function bootstrap() {
  try {
    await connectDatabase();
    await ensureSpeakingAudioBucket();

    // Mounted before listen so no upgrade can arrive unhandled. Returns false
    // (without throwing) when OPENAI_API_KEY is missing — the REST API still
    // serves, the live examiner is simply unavailable.
    const realtimeReady = await attachRealtime(server);

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[Server] PrepSmart Language Cert API running on port ${PORT}`);
      console.log(`[Server] Environment: ${env.NODE_ENV}`);
      console.log(
        `[Server] Live speaking examiner: ${
          realtimeReady ? `ready on ${REALTIME_PATH}` : 'disabled (set OPENAI_API_KEY)'
        }`,
      );
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

// Railway sends SIGTERM on every redeploy. Close live exams first so each
// candidate gets an end-of-session frame instead of a socket that just dies,
// and so the upstream OpenAI sessions stop being billed.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] ${signal} received — shutting down`);

  await shutdownRealtime(`server_${signal.toLowerCase()}`);
  server.close(() => process.exit(0));

  // Do not let a stuck socket hold the container open past the grace period.
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

bootstrap();
