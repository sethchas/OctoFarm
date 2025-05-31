// server/handlers/logger.js

const path = require("path");
const fs = require("fs");
const winston = require("winston");
const { AppConstants } = require("../constants/app.constants");
const { logRouteToFileMap } = require("../constants/logger.constants");

// Ensure that the logs/ directory exists under the project root:
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const dtFormat = new Intl.DateTimeFormat("en-GB", {
  timeStyle: "medium",
  dateStyle: "short",
  timeZone: "UTC",
});

// Colour codes for console output
const COLOURS = {
  RED: "\u001b[31m",
  YELLOW: "\u001b[33m",
  ORANGE: "\u001b[33m",
  BLUE: "\u001b[34m",
  PURPLE: "\u001b[35m",
  WHITE: "\u001b[37m",
  CYAN: "\u001b[36m",
};

// Map Winston log levels to colours
const COLOUR_MAP = {
  info: COLOURS.BLUE,
  warn: COLOURS.ORANGE,
  debug: COLOURS.ORANGE,
  error: COLOURS.RED,
  http: COLOURS.PURPLE,
  silly: COLOURS.CYAN,
};

// Custom numeric levels (0 = highest priority)
const LEVELS = {
  error: 0,
  warn: 1,
  http: 2,
  info: 3,
  verbose: 4,
  debug: 5,
  silly: 6,
};

// Helper to format the timestamp
function dateFormat() {
  return dtFormat.format(new Date());
}

class LoggerService {
  /**
   * @param {string} route           Name/key of this logger (must match a key in logRouteToFileMap)
   * @param {boolean} [enableFileLogs=true]   Whether to write to files in addition to console
   * @param {string}  [logFilterLevel]        Minimum level to log (e.g. "info", "debug"); 
   *                                           if not provided, reads from process.env.LOG_LEVEL
   */
  constructor(route, enableFileLogs = true, logFilterLevel = undefined) {
    if (!logFilterLevel) {
      logFilterLevel = process.env[AppConstants.LOG_LEVEL];
    }

    this.route = route;

    // Console formatter: coloured, aligned, with timestamp, level, route, message, metadata
    const alignColorsAndTime = winston.format.combine(
      winston.format.printf((info) => {
        const level = info.level.toUpperCase();
        const date = dateFormat();
        let metaData = "";
        if (info.meta !== undefined) {
          if (typeof info.meta === "string" || typeof info.meta === "number") {
            metaData = String(info.meta);
          } else {
            metaData = JSON.stringify(info.meta);
          }
        }

        // Build console‐style line
        let message = `${COLOUR_MAP[info.level]}${date} ${COLOURS.WHITE}| ${
          COLOUR_MAP[info.level]
        }${level} ${COLOURS.WHITE}| ${COLOUR_MAP[info.level]}${route} ${COLOURS.WHITE}\n  ${
          COLOUR_MAP[info.level]
        }${level} MESSAGE: ${COLOURS.WHITE}${info.message}`;
        if (metaData) {
          message += ` | ${COLOURS.WHITE}${metaData}`;
        }
        return message;
      })
    );

    // File formatter: no ANSI colours, just date | LEVEL | route \n LEVEL MESSAGE: ...
    const prettyPrintMyLogs = winston.format.combine(
      winston.format.printf((info) => {
        const level = info.level.toUpperCase();
        const date = dateFormat();
        let metaData = "";
        if (info.meta !== undefined) {
          if (typeof info.meta === "string" || typeof info.meta === "number") {
            metaData = String(info.meta);
          } else {
            metaData = JSON.stringify(info.meta);
          }
        }
        let message = `${date} | ${level} | ${route}\n  ${level} MESSAGE: ${info.message}`;
        if (metaData) {
          message += ` : ${metaData}`;
        }
        return message;
      })
    );

    // Build the Winston logger
    this.logger = winston.createLogger({
      levels: LEVELS,
      transports: [
        // 1) Console transport
        new winston.transports.Console({
          level: logFilterLevel,
          format: alignColorsAndTime,
        }),

        // 2) File transport (only if requested)
        ...(enableFileLogs
          ? [
              new winston.transports.File({
                level: logFilterLevel,
                format: prettyPrintMyLogs,
                // Write into "logs/<mappedFileName>.log" under project root
                filename: path.join("logs", `${logRouteToFileMap[this.route]}.log`),
                maxsize: 5_242_880, // 5 MB
                maxFiles: 3,
              }),
            ]
          : []),
      ],
    });
  }

  info(message, meta) {
    this.logger.log("info", message, { meta });
  }

  warning(message, meta) {
    this.logger.log("warn", message, { meta });
  }

  http(message, meta) {
    this.logger.log("http", message, { meta });
  }

  debug(message, meta) {
    this.logger.log("debug", message, { meta });
  }

  error(message, meta) {
    this.logger.log("error", message, { meta });
  }

  silly(message, meta) {
    this.logger.log("silly", message, { meta });
  }
}

module.exports = LoggerService;
