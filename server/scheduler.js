import { getServerConfig } from './config/env.js';
import { ingestPolicySources } from './lib/ingestionRunner.js';

const config = getServerConfig();
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const result = await ingestPolicySources();
    console.log(`[${new Date().toISOString()}] policy ingestion completed`, JSON.stringify(result.summary));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] policy ingestion failed`, error);
  } finally {
    running = false;
  }
}

console.log(`LifePass policy scheduler started. interval=${config.schedulerIntervalMs}ms`);
await tick();
setInterval(tick, config.schedulerIntervalMs);
