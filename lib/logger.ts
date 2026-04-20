type LogFields = Record<string, unknown>;

function writeLine(level: "info" | "warn" | "error", msg: string, fields: LogFields): void {
  const line = { level, ts: new Date().toISOString(), msg, ...fields };
  const payload = `${JSON.stringify(line)}\n`;
  if (level === "error") {
    process.stderr.write(payload);
  } else {
    process.stdout.write(payload);
  }
}

export function createLogger(baseFields: LogFields = {}) {
  return {
    child(extra: LogFields) {
      return createLogger({ ...baseFields, ...extra });
    },
    info(msg: string, fields?: LogFields) {
      writeLine("info", msg, { ...baseFields, ...fields });
    },
    warn(msg: string, fields?: LogFields) {
      writeLine("warn", msg, { ...baseFields, ...fields });
    },
    error(msg: string, fields?: LogFields) {
      writeLine("error", msg, { ...baseFields, ...fields });
    },
  };
}

export const log = createLogger();
