const fs = require('fs');
const path = require('path');
const { LOG_FILE, LOG_LEVEL } = require('./config');

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

class Logger {
  constructor(logLevel = 'INFO', logFile = null) {
    this.logLevel = LOG_LEVELS[logLevel.toUpperCase()] || LOG_LEVELS.INFO;
    this.logFile = logFile;
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    let logMessage = `[${timestamp}] [${level}] ${message}`;
    
    if (data) {
      if (typeof data === 'object') {
        logMessage += `\n${JSON.stringify(data, null, 2)}`;
      } else {
        logMessage += ` ${data}`;
      }
    }
    
    return logMessage;
  }

  writeLog(level, message, data = null) {
    const logMessage = this.formatMessage(level, message, data);
    
    // Console output
    if (level === 'ERROR') {
      console.error(logMessage);
    } else if (level === 'WARN') {
      console.warn(logMessage);
    } else {
      console.log(logMessage);
    }
    
    // File output (if configured)
    if (this.logFile) {
      try {
        fs.appendFileSync(this.logFile, logMessage + '\n', 'utf8');
      } catch (err) {
        console.error(`Failed to write to log file: ${err.message}`);
      }
    }
  }

  error(message, data = null) {
    if (this.logLevel >= LOG_LEVELS.ERROR) {
      this.writeLog('ERROR', message, data);
    }
  }

  warn(message, data = null) {
    if (this.logLevel >= LOG_LEVELS.WARN) {
      this.writeLog('WARN', message, data);
    }
  }

  info(message, data = null) {
    if (this.logLevel >= LOG_LEVELS.INFO) {
      this.writeLog('INFO', message, data);
    }
  }

  debug(message, data = null) {
    if (this.logLevel >= LOG_LEVELS.DEBUG) {
      this.writeLog('DEBUG', message, data);
    }
  }
}

// Create singleton instance
const logger = new Logger(LOG_LEVEL, LOG_FILE);

module.exports = logger;

