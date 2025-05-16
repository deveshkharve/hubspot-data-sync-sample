const winston = require("winston");
const path = require("path");
const fs = require("fs");
const util = require("util");

// Ensure logs directory exists
const logDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Define log levels and colors
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const colors = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "blue",
};

winston.addColors(colors);

// Reusable formatter (console + files)
const customFormatter = winston.format.printf((info) => {
  const message =
    typeof info.message === "object"
      ? util.inspect(info.message, { depth: null, maxArrayLength: null })
      : info.message;

  let args = "";
  if (info[Symbol.for("splat")]) {
    args = info[Symbol.for("splat")]
      .map((arg) =>
        typeof arg === "object"
          ? util.inspect(arg, { depth: null, maxArrayLength: null })
          : arg
      )
      .join(" ");
  }

  return `${info.timestamp} ${info.level}: ${message} ${args}`.trim();
});

// Final logger instance
const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  levels,
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.splat(),
    customFormatter
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.splat(),
        customFormatter
      ),
    }),
    new winston.transports.File({
      filename: path.join(logDir, "run_logs.log"),
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 5,
      tailable: true,
      zippedArchive: true,
    }),
    new winston.transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
    }),
  ],
});

module.exports = logger;
