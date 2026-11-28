CREATE TABLE `illustrations` (
	`id` text PRIMARY KEY,
	`turn_id` text NOT NULL UNIQUE,
	`playthrough_id` text NOT NULL,
	`para` integer NOT NULL,
	`format_preference` text NOT NULL,
	`format` text,
	`status` text NOT NULL,
	`stage` text,
	`caption` text,
	`prompt` text,
	`negative_prompt` text,
	`shot_capability` text,
	`refs` text,
	`reference_files` text,
	`seed` integer,
	`service_id` text,
	`model` text,
	`file` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`active_attempt_id` text,
	`attempt_data` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_illustrations_turn_id_turns_id_fk` FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_illustrations_playthrough_id_playthroughs_id_fk` FOREIGN KEY (`playthrough_id`) REFERENCES `playthroughs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `image_calls` (
	`id` text PRIMARY KEY,
	`service_id` text NOT NULL,
	`protocol` text NOT NULL,
	`model` text,
	`work_id` text,
	`ref_kind` text NOT NULL,
	`ref_id` text,
	`quality` text NOT NULL,
	`reference_count` integer NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`duration_ms` integer,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_image_calls_work_id_works_id_fk` FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `portrait_sets` (
	`id` text PRIMARY KEY,
	`work_id` text NOT NULL,
	`scope` text NOT NULL,
	`playthrough_id` text,
	`entity_id` text,
	`appearance_fact_id` text,
	`appearance_hash` text NOT NULL,
	`appearance` text NOT NULL,
	`style` text NOT NULL,
	`state` text NOT NULL,
	`draft_rev` integer DEFAULT 0 NOT NULL,
	`slots` text NOT NULL,
	`task` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_portrait_sets_work_id_works_id_fk` FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_portrait_sets_playthrough_id_playthroughs_id_fk` FOREIGN KEY (`playthrough_id`) REFERENCES `playthroughs`(`id`) ON DELETE CASCADE,
	CONSTRAINT "portrait_sets_state" CHECK("state" in ('draft', 'active', 'retired')),
	CONSTRAINT "portrait_sets_scope" CHECK(("scope" = 'work' and "playthrough_id" is null and "entity_id" is not null and "appearance_fact_id" is null)
        or ("scope" = 'pending' and "playthrough_id" is null and "appearance_fact_id" is null and "state" in ('draft', 'active'))
        or ("scope" = 'playthrough' and "playthrough_id" is not null and "entity_id" is not null and "state" in ('draft', 'active')))
);
--> statement-breakpoint
ALTER TABLE `app_settings` ADD `illustration` text DEFAULT '{"autoEnabled":false,"confirmed":null,"defaults":{"aspectPreference":"auto","resolutionTier":"1k"}}' NOT NULL;--> statement-breakpoint
ALTER TABLE `entities` ADD `source_para` integer;--> statement-breakpoint
ALTER TABLE `playthroughs` ADD `illustration` text DEFAULT '{"enabled":false,"style":{"kind":"preset","preset":"painterly"},"aspectPreference":"auto","resolutionTier":"1k","protagonistInFrame":false,"protagonistAppearance":null,"authorPortraitSetIds":{},"protagonistPortraitSetId":null}' NOT NULL;--> statement-breakpoint
ALTER TABLE `turns` ADD `illustrate_para` integer;--> statement-breakpoint
ALTER TABLE `works` ADD `illustration_style` text;--> statement-breakpoint
CREATE INDEX `illustrations_queue_idx` ON `illustrations` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `illustrations_playthrough_idx` ON `illustrations` (`playthrough_id`);--> statement-breakpoint
CREATE INDEX `image_calls_created_idx` ON `image_calls` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `portrait_sets_active_work` ON `portrait_sets` (`work_id`,`entity_id`,`appearance_hash`) WHERE "portrait_sets"."scope" = 'work' and "portrait_sets"."state" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `portrait_sets_playthrough_identity` ON `portrait_sets` (`playthrough_id`,`entity_id`,ifnull("appearance_fact_id", '')) WHERE "portrait_sets"."scope" = 'playthrough';--> statement-breakpoint
CREATE INDEX `portrait_sets_work_idx` ON `portrait_sets` (`work_id`,`scope`);