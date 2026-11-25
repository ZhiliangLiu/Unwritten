import { z } from "zod";

export const UuidSchema = z.uuid();
export const TimestampSchema = z.number().int().nonnegative();
export const ContentRevSchema = z.number().int().nonnegative();
export const LanguageTagSchema = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
