CREATE UNIQUE INDEX `entity_names_unique` ON `entity_names` (`version_id`, `entity_id`, `name`, ifnull(`holder_id`, ''), ifnull(`origin_turn_id`, ''));
--> statement-breakpoint
CREATE UNIQUE INDEX `facts_keyed_unique` ON `facts` (`version_id`, `kind`, ifnull(`subject_id`, ''), ifnull(`object_id`, ''), `key`, ifnull(`origin_turn_id`, '')) WHERE `key` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_unique` ON `knowledge` (`version_id`, `fact_id`, `holder_id`, ifnull(`origin_turn_id`, ''));
--> statement-breakpoint
CREATE UNIQUE INDEX `entities_one_protagonist` ON `entities` (`version_id`) WHERE `is_protagonist` = 1;
--> statement-breakpoint
CREATE VIRTUAL TABLE `prose_fts` USING fts5(`turn_id` UNINDEXED, `para` UNINDEXED, `body`, tokenize = 'trigram');
--> statement-breakpoint
CREATE TRIGGER `turns_delete_fts` AFTER DELETE ON `turns` BEGIN DELETE FROM `prose_fts` WHERE `turn_id` = old.`id`; END;
