import { sql } from 'drizzle-orm';
import type { Database } from './db.ts';
import { splitParagraphs } from '../text/turn-text.ts';

export function indexTurnProse(db: Pick<Database, 'run'>, turnId: string, prose: string): number {
  const paragraphs = splitParagraphs(prose);
  paragraphs.forEach((body, index) => {
    db.run(sql`insert into prose_fts (turn_id, para, body) values (${turnId}, ${index + 1}, ${body})`);
  });
  return paragraphs.length;
}
