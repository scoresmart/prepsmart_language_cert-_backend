/**
 * Load test: 100 concurrent-ish requests to backend (localhost:5000)
 * Tests: /health, /api/v1/auth/* public endpoints, and a few protected routes (expect 401s)
 */

const BASE = 'http://localhost:5000';

// Mix of public and protected endpoints to simulate real traffic
const ENDPOINTS = [
  { method: 'GET', path: '/health', label: 'Health check' },
  { method: 'POST', path: '/api/v1/auth/login', label: 'Auth login (no body)', body: {} },
  { method: 'GET', path: '/api/v1/questions/writing', label: 'Questions - writing (no auth)' },
  { method: 'GET', path: '/api/v1/questions/listening', label: 'Questions - listening (no auth)' },
  { method: 'GET', path: '/api/v1/questions/reading', label: 'Questions - reading (no auth)' },
  { method: 'GET', path: '/api/v1/questions/speaking', label: 'Questions - speaking (no auth)' },
  { method: 'GET', path: '/api/v1/profiles', label: 'Profiles (no auth)' },
  { method: 'GET', path: '/api/v1/practice', label: 'Practice (no auth)' },
  { method: 'GET', path: '/api/v1/tests', label: 'Tests (no auth)' },
  { method: 'GET', path: '/api/v1/users', label: 'Users (no auth)' },
];

const TOTAL_REQUESTS = 100;
const CONCURRENCY = 10; // send 10 at a time

const stats = {
  total: 0,
  success: 0,
  clientError: 0, // 4xx
  serverError: 0, // 5xx
  networkError: 0,
  byEndpoint: {},
  durations: [],
};

async function sendRequest(endpoint, requestNum) {
  const url = BASE + endpoint.path;
  const opts = {
    method: endpoint.method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (endpoint.body !== undefined) {
    opts.body = JSON.stringify(endpoint.body);
  }

  const start = Date.now();
  let status = 0;
  let category = '';

  try {
    const res = await fetch(url, opts);
    status = res.status;
    const duration = Date.now() - start;

    if (status >= 500) category = 'serverError';
    else if (status >= 400) category = 'clientError';
    else category = 'success';

    stats[category]++;
    stats.durations.push(duration);
    stats.total++;

    const key = `${endpoint.method} ${endpoint.path}`;
    if (!stats.byEndpoint[key]) {
      stats.byEndpoint[key] = { success: 0, clientError: 0, serverError: 0, count: 0, totalMs: 0 };
    }
    stats.byEndpoint[key][category]++;
    stats.byEndpoint[key].count++;
    stats.byEndpoint[key].totalMs += duration;

    return { requestNum, status, duration, endpoint: endpoint.path, category };
  } catch (err) {
    const duration = Date.now() - start;
    stats.networkError++;
    stats.total++;
    return { requestNum, status: 0, duration, endpoint: endpoint.path, category: 'networkError', error: err.message };
  }
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function runLoadTest() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  PrepSmart Backend Load Test — ${TOTAL_REQUESTS} requests`);
  console.log(`  Target: ${BASE}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`${'='.repeat(60)}\n`);

  // Build request list: distribute across endpoints
  const requests = [];
  for (let i = 0; i < TOTAL_REQUESTS; i++) {
    const endpoint = ENDPOINTS[i % ENDPOINTS.length];
    requests.push({ endpoint, num: i + 1 });
  }

  const batches = chunk(requests, CONCURRENCY);
  let batchNum = 0;

  for (const batch of batches) {
    batchNum++;
    process.stdout.write(`  Batch ${String(batchNum).padStart(2, '0')}/${batches.length} (reqs ${(batchNum - 1) * CONCURRENCY + 1}–${Math.min(batchNum * CONCURRENCY, TOTAL_REQUESTS)})... `);
    const results = await Promise.all(batch.map(({ endpoint, num }) => sendRequest(endpoint, num)));
    const statuses = results.map(r => r.status || 'ERR').join(' ');
    console.log(`statuses: [${statuses}]`);
  }

  // Summary
  const avg = stats.durations.length
    ? Math.round(stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length)
    : 0;
  const min = stats.durations.length ? Math.min(...stats.durations) : 0;
  const max = stats.durations.length ? Math.max(...stats.durations) : 0;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  RESULTS SUMMARY`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Total requests : ${stats.total}`);
  console.log(`  2xx Success    : ${stats.success}  ✓`);
  console.log(`  4xx Client err : ${stats.clientError}  (auth/validation — expected)`);
  console.log(`  5xx Server err : ${stats.serverError}  ${stats.serverError > 0 ? '⚠ INVESTIGATE' : '✓'}`);
  console.log(`  Network errors : ${stats.networkError}  ${stats.networkError > 0 ? '⚠ SERVER DOWN?' : '✓'}`);
  console.log(`  Avg latency    : ${avg}ms`);
  console.log(`  Min latency    : ${min}ms`);
  console.log(`  Max latency    : ${max}ms`);

  console.log(`\n  Per-endpoint breakdown:`);
  for (const [key, data] of Object.entries(stats.byEndpoint)) {
    const avgMs = Math.round(data.totalMs / data.count);
    const statusStr = [
      data.success > 0 ? `${data.success}✓` : '',
      data.clientError > 0 ? `${data.clientError}×4xx` : '',
      data.serverError > 0 ? `${data.serverError}×5xx ⚠` : '',
    ].filter(Boolean).join(' ');
    console.log(`    ${key.padEnd(40)} ${String(data.count).padStart(3)} reqs | avg ${String(avgMs).padStart(4)}ms | ${statusStr}`);
  }

  console.log(`\n${'='.repeat(60)}`);
  if (stats.networkError > 0) {
    console.log(`  ⚠  ${stats.networkError} requests failed to connect. Is the server running on port 5000?`);
  } else if (stats.serverError > 0) {
    console.log(`  ⚠  ${stats.serverError} server-side errors (5xx). Check server logs.`);
  } else {
    console.log(`  ✓  Server handled all ${stats.total} requests without errors or crashes.`);
  }
  console.log(`${'='.repeat(60)}\n`);
}

runLoadTest().catch(err => {
  console.error('Load test failed:', err);
  process.exit(1);
});
