const winston = require("winston");
const path = require("path");

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log colors
const colors = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "blue",
};

// Add colors to winston
winston.addColors(colors);

// Create format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Create format for file output (without colors)
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Determine log level based on environment
const level = process.env.NODE_ENV === "production" ? "info" : "debug";

// Create the logger
const logger = winston.createLogger({
  level,
  levels,
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf((info) => {
      // Handle multiple parameters that were passed to the logger
      const message =
        info.message instanceof Object
          ? JSON.stringify(info.message)
          : info.message;

      // Format additional arguments if they exist
      let args = "";
      if (info[Symbol.for("splat")]) {
        args = info[Symbol.for("splat")]
          .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : arg))
          .join(" ");
      }

      return `${info.timestamp} ${info.level}: ${message} ${args}`.trim();
    })
  ),
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.splat()
      ),
    }),
    // File transport for all logs
    new winston.transports.File({
      filename: path.join("logs", "combined.log"),
      format: winston.format.splat(),
    }),
    // File transport for error logs
    new winston.transports.File({
      filename: path.join("logs", "error.log"),
      level: "error",
      format: winston.format.splat(),
    }),
  ],
});

module.exports = logger;
