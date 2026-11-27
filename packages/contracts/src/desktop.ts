import { z } from 'zod';
import { AppearanceSchema } from './schemas/appearance.ts';
import { UuidSchema } from './schemas/common.ts';

export const DESKTOP_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export const START_FAILURE_REASONS = ['data_locked', 'port_in_use', 'data_dir', 'startup'] as const;
export const DESKTOP_PLATFORMS = ['darwin', 'win32', 'linux', 'other'] as const;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const StartMessageSchema = z.strictObject({
  type: z.literal('start'),
  dataDir: z.string().min(1),
  token: z.string().regex(TOKEN_PATTERN),
  port: z.number().int().min(0).max(65_535),
  clientDir: z.string().min(1),
  clientOrigin: z.string().min(1).nullable(),
  logLevel: z.enum(DESKTOP_LOG_LEVELS),
  dev: z.boolean(),
});

export const StopMessageSchema = z.strictObject({ type: z.literal('stop') });

export const DesktopEventEntrySchema = z.discriminatedUnion('event', [
  z.strictObject({
    kind: z.literal('event'),
    event: z.literal('desktop.started'),
    level: z.literal('info'),
    data: z.strictObject({
      packaged: z.boolean(),
      dev: z.boolean(),
      platform: z.enum(DESKTOP_PLATFORMS),
    }),
  }),
  z.strictObject({
    kind: z.literal('event'),
    event: z.literal('desktop.shell_env'),
    level: z.enum(['info', 'warn']),
    data: z.strictObject({
      ok: z.boolean(),
      timedOut: z.boolean(),
      vars: z.number().int().nonnegative(),
    }),
  }),
  z.strictObject({
    kind: z.literal('event'),
    event: z.literal('desktop.core_exited'),
    level: z.literal('warn'),
    data: z.strictObject({
      code: z.number().int().nullable(),
      phase: z.enum(['starting', 'running']),
    }),
  }),
  z.strictObject({
    kind: z.literal('event'),
    event: z.literal('desktop.core_ready_timeout'),
    level: z.literal('error'),
    data: z.strictObject({}),
  }),
  z.strictObject({
    kind: z.literal('event'),
    event: z.literal('desktop.core_restarted'),
    level: z.literal('info'),
    data: z.strictObject({ reason: z.enum(['retry', 'restart']) }),
  }),
  z.strictObject({
    kind: z.literal('event'),
    event: z.literal('desktop.renderer_gone'),
    level: z.literal('warn'),
    data: z.strictObject({ reason: z.string().regex(/^[a-z-]{1,40}$/) }),
  }),
  z.strictObject({
    kind: z.literal('event'),
    event: z.literal('desktop.navigation_blocked'),
    level: z.literal('info'),
    data: z.strictObject({
      kind: z.enum(['navigate', 'window_open']),
      external: z.boolean(),
    }),
  }),
  z.strictObject({
    kind: z.literal('event'),
    event: z.literal('desktop.dropped'),
    level: z.literal('warn'),
    data: z.strictObject({ count: z.number().int().min(1) }),
  }),
]);

export const DESKTOP_SAMPLE_METRICS = ['desktop.core_ready', 'desktop.window_ready'] as const;

export const DesktopSampleEntrySchema = z.strictObject({
  kind: z.literal('sample'),
  metric: z.enum(DESKTOP_SAMPLE_METRICS),
  durationMs: z.number().finite().nonnegative(),
  outcome: z.enum(['ok', 'error', 'interrupted']),
  attempt: z.number().int().positive().optional(),
});

export const DesktopLogEntrySchema = z.union([DesktopEventEntrySchema, DesktopSampleEntrySchema]);

export const LogMessageSchema = z.strictObject({ type: z.literal('log'), entry: DesktopLogEntrySchema });

export const DesktopToCoreSchema = z.discriminatedUnion('type', [
  StartMessageSchema,
  StopMessageSchema,
  LogMessageSchema,
]);

export const ReadyMessageSchema = z.strictObject({
  type: z.literal('ready'),
  port: z.number().int().min(1).max(65_535),
  appearance: AppearanceSchema,
});

export const AppearanceChangedMessageSchema = z.strictObject({
  type: z.literal('appearance-changed'),
  appearance: AppearanceSchema,
});

export const StartFailedMessageSchema = z.strictObject({
  type: z.literal('start-failed'),
  reason: z.enum(START_FAILURE_REASONS),
  diagnosticId: UuidSchema,
});

export const CoreToDesktopSchema = z.discriminatedUnion('type', [
  ReadyMessageSchema,
  AppearanceChangedMessageSchema,
  StartFailedMessageSchema,
]);

export type StartMessage = z.infer<typeof StartMessageSchema>;
export type StopMessage = z.infer<typeof StopMessageSchema>;
export type DesktopEventEntry = z.infer<typeof DesktopEventEntrySchema>;
export type DesktopSampleEntry = z.infer<typeof DesktopSampleEntrySchema>;
export type DesktopLogEntry = z.infer<typeof DesktopLogEntrySchema>;
export type LogMessage = z.infer<typeof LogMessageSchema>;
export type DesktopToCore = z.infer<typeof DesktopToCoreSchema>;
export type ReadyMessage = z.infer<typeof ReadyMessageSchema>;
export type AppearanceChangedMessage = z.infer<typeof AppearanceChangedMessageSchema>;
export type StartFailedMessage = z.infer<typeof StartFailedMessageSchema>;
export type CoreToDesktop = z.infer<typeof CoreToDesktopSchema>;
export type StartFailureReason = (typeof START_FAILURE_REASONS)[number];
export type DesktopLogLevel = (typeof DESKTOP_LOG_LEVELS)[number];
