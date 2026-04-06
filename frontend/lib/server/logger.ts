import pino from "pino";

const MODE = process.env.NODE_ENV || "development";

export const logger = pino({
  level: process.env.LOG_LEVEL || (MODE === "production" ? "info" : "debug"),
  transport:
    MODE === "development"
      ? { target: "pino/file", options: { destination: 1 } }
      : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/** Create a child logger scoped to an API route. */
export function routeLogger(route: string) {
  return logger.child({ route });
}
