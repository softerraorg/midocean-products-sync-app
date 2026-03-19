require('dotenv').config();
const cron = require('node-cron');
const { SYNC_SCHEDULE, SYNC_TIMEZONE } = require('./config');
const { main } = require('./syncFromSupplierAPI');
const logger = require('./logger');

/**
 * Formats duration in seconds to a human-readable string (hours, minutes, seconds)
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration string (e.g., "3h 30m 15s" or "45m 30s" or "30s")
 */
function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}

let isRunning = false;

async function runSync() {
  // Prevent overlapping runs
  if (isRunning) {
    logger.warn('Previous sync is still running, skipping this run');
    return;
  }

  isRunning = true;
  const startTime = new Date();
  logger.info('Starting scheduled sync', { timestamp: startTime.toISOString() });

  try {
    await main();
    // main() already logs detailed completion stats, no need to log again here
  } catch (err) {
    const endTime = new Date();
    const durationSeconds = (endTime - startTime) / 1000;
    const duration = formatDuration(durationSeconds);
    
    logger.error('Sync failed', {
      duration: duration,
      error: err.message,
      stack: err.stack
    });
  } finally {
    isRunning = false;
  }
}

// Validate cron expression
if (!cron.validate(SYNC_SCHEDULE)) {
  logger.error('Invalid cron expression', {
    schedule: SYNC_SCHEDULE,
    examples: [
      '"0 */6 * * *"  (every 6 hours)',
      '"0 0 * * *"   (daily at midnight)',
      '"0 */12 * * *" (every 12 hours)',
      '"*/30 * * * *" (every 30 minutes)'
    ]
  });
  process.exit(1);
}

logger.info('Starting scheduler', {
  schedule: SYNC_SCHEDULE,
  timezone: SYNC_TIMEZONE,
  message: 'Press Ctrl+C to stop the scheduler'
});

// Run immediately on start (optional - can be removed if you only want scheduled runs)
// Uncomment the line below if you want to run sync immediately when scheduler starts
// runSync();

// Schedule the sync
const task = cron.schedule(SYNC_SCHEDULE, runSync, {
  scheduled: true,
  timezone: SYNC_TIMEZONE
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, initiating graceful shutdown');
  task.stop();
  
  if (isRunning) {
    logger.info('Waiting for current sync to complete...');
    // Give it some time, but don't wait indefinitely
    setTimeout(() => {
      logger.warn('Sync taking too long, forcing exit');
      process.exit(0);
    }, 30000); // 30 second timeout
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, initiating graceful shutdown');
  task.stop();
  
  if (isRunning) {
    logger.info('Waiting for current sync to complete...');
    setTimeout(() => {
      logger.warn('Sync taking too long, forcing exit');
      process.exit(0);
    }, 30000);
  } else {
    process.exit(0);
  }
});

