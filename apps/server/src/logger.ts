/* eslint-disable no-console -- this module is the one sanctioned console boundary */

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Structured line logging. Single-line JSON because the deployment target ships stdout to a log
 * aggregator, and a multi-line pretty printer turns one event into several unrelated records.
 */
export function createLogger(minLevel: Level) {
  const emit = (level: Level, message: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    const line = JSON.stringify({ level, message, ts: new Date().toISOString(), ...fields });
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  };

  return {
    debug(message: string, fields?: Record<string, unknown>) {
      emit("debug", message, fields);
    },
    info(message: string, fields?: Record<string, unknown>) {
      emit("info", message, fields);
    },
    warn(message: string, fields?: Record<string, unknown>) {
      emit("warn", message, fields);
    },
    error(message: string, fields?: Record<string, unknown>) {
      emit("error", message, fields);
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
