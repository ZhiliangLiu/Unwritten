import { z } from 'zod';
import { TimestampSchema, UuidSchema } from './common.ts';

export const ENTITY_KINDS = ['character', 'place', 'item', 'group', 'other'] as const;
export const EntityKindSchema = z.enum(ENTITY_KINDS);

export const KNOWLEDGE_LEVELS = ['heard', 'suspects', 'confirmed', 'misled'] as const;
export const KnowledgeLevelSchema = z.enum(KNOWLEDGE_LEVELS);

export const StorySourceSchema = z.object({
  turnId: UuidSchema,
  depth: z.number().int().nonnegative(),
  para: z.number().int().positive(),
});

export const JournalLineSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  level: KnowledgeLevelSchema,
  source: StorySourceSchema.nullable(),
});

export const JournalPortraitSchema = z.object({ setId: UuidSchema, updatedAt: TimestampSchema });

export const JournalSubjectSchema = z.object({
  entityId: z.string().min(1),
  kind: EntityKindSchema,
  name: z.string(),
  portrait: JournalPortraitSchema.nullable().default(null),
  lines: z.array(JournalLineSchema),
});

export const JournalViewSchema = z.object({
  routeId: UuidSchema,
  headTurnId: UuidSchema,
  subjects: z.array(JournalSubjectSchema),
  events: z.array(JournalLineSchema),
});

export type EntityKind = z.infer<typeof EntityKindSchema>;
export type KnowledgeLevel = z.infer<typeof KnowledgeLevelSchema>;
export type StorySource = z.infer<typeof StorySourceSchema>;
export type JournalLine = z.infer<typeof JournalLineSchema>;
export type JournalPortrait = z.infer<typeof JournalPortraitSchema>;
export type JournalSubject = z.infer<typeof JournalSubjectSchema>;
export type JournalView = z.infer<typeof JournalViewSchema>;
