/**
 * Structured logging for every Cujo service (decision 37).
 *
 * One JSON object per line on stdout: an event name from a closed vocabulary,
 * plus allowlisted scalar fields. There is no sink, no collector and no
 * tracing backend — Docker captures stdout and Coolify shows it, and the
 * per-run detail is already durable in the projection the UI renders.
 */

export { EVENT_NAMES, type EventName } from "./events";
export { errorFields, type ErrorKind } from "./error";
export {
  CAP,
  FIELD_CLASS,
  FIELD_NAMES,
  RESERVED_NAMES,
  type FieldClass,
  type FieldName,
  type FieldValue,
  type Fields,
  isFieldName,
} from "./fields";
export { RANK, parseLevel, type Level } from "./level";
export {
  createLogger,
  logFailureCount,
  type Logger,
  type LoggerOptions,
  type Sink,
} from "./logger";
export { REDACTED, TRUNCATED, scrub } from "./redact";
