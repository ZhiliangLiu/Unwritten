CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY,
	`appearance` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "app_settings_single_row" CHECK("id" = 1)
);
--> statement-breakpoint
CREATE TABLE `entities` (
	`version_id` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`profile` text NOT NULL,
	`is_protagonist` integer DEFAULT 0 NOT NULL,
	`cast_slot` text,
	`origin_turn_id` text,
	`rev` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `entities_pk` PRIMARY KEY(`version_id`, `id`),
	CONSTRAINT `fk_entities_version_id_work_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `work_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_entities_origin_turn_id_turns_id_fk` FOREIGN KEY (`origin_turn_id`) REFERENCES `turns`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `entity_names` (
	`version_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`name` text NOT NULL,
	`holder_id` text,
	`origin_turn_id` text,
	`source_para` integer,
	CONSTRAINT `fk_entity_names_version_id_work_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `work_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_entity_names_origin_turn_id_turns_id_fk` FOREIGN KEY (`origin_turn_id`) REFERENCES `turns`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `facts` (
	`version_id` text NOT NULL,
	`id` text NOT NULL,
	`origin_turn_id` text,
	`source_para` integer,
	`kind` text NOT NULL,
	`subject_id` text,
	`object_id` text,
	`key` text,
	`statement` text NOT NULL,
	`data` text,
	`rev` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `facts_pk` PRIMARY KEY(`version_id`, `id`),
	CONSTRAINT `fk_facts_version_id_work_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `work_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_facts_origin_turn_id_turns_id_fk` FOREIGN KEY (`origin_turn_id`) REFERENCES `turns`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `knowledge` (
	`version_id` text NOT NULL,
	`fact_id` text NOT NULL,
	`holder_id` text NOT NULL,
	`level` text NOT NULL,
	`perceived_statement` text,
	`via_id` text,
	`origin_turn_id` text,
	`source_para` integer,
	CONSTRAINT `fk_knowledge_version_id_work_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `work_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_knowledge_origin_turn_id_turns_id_fk` FOREIGN KEY (`origin_turn_id`) REFERENCES `turns`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `turn_summaries` (
	`turn_id` text PRIMARY KEY,
	`summary` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_turn_summaries_turn_id_turns_id_fk` FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `entities_origin_idx` ON `entities` (`version_id`,`origin_turn_id`);--> statement-breakpoint
CREATE INDEX `entity_names_entity_idx` ON `entity_names` (`version_id`,`entity_id`);--> statement-breakpoint
CREATE INDEX `facts_origin_idx` ON `facts` (`version_id`,`origin_turn_id`);--> statement-breakpoint
CREATE INDEX `knowledge_fact_idx` ON `knowledge` (`version_id`,`fact_id`);