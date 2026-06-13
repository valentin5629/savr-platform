export type LogLevel = 'info' | 'warn' | 'error';

export type ServiceName =
  | 'platform'
  | 'adapter_mts1'
  | 'adapter_everest'
  | 'cron'
  | 'pdf';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  service: ServiceName;
  event: string;
  actor_id: string | null;
  actor_role: string | null;
  org_id: string | null;
  trace_id: string | null;
  payload: Record<string, unknown>;
}

export interface LogContext {
  service?: ServiceName;
  actor_id?: string | null;
  actor_role?: string | null;
  org_id?: string | null;
  trace_id?: string | null;
}
