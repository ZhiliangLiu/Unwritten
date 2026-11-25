CREATE TABLE `jobs` (
	`id` text PRIMARY KEY,
	`work_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`input` text NOT NULL,
	`result` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_jobs_work_id_works_id_fk` FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `llm_calls` (
	`id` text PRIMARY KEY,
	`purpose` text NOT NULL,
	`work_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`ref_kind` text,
	`ref_id` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cost` real,
	`cost_from_provider` integer,
	`duration_ms` integer,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_llm_calls_work_id_works_id_fk` FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `playthroughs` (
	`id` text PRIMARY KEY,
	`version_id` text NOT NULL,
	`kind` text NOT NULL,
	`protagonist` text,
	`cast` text,
	`root_turn_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_playthroughs_version_id_work_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `work_versions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `routes` (
	`id` text PRIMARY KEY,
	`playthrough_id` text NOT NULL,
	`head_turn_id` text NOT NULL,
	`name` text,
	`draft_input` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_routes_playthrough_id_playthroughs_id_fk` FOREIGN KEY (`playthrough_id`) REFERENCES `playthroughs`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_routes_head_turn_id_turns_id_fk` FOREIGN KEY (`head_turn_id`) REFERENCES `turns`(`id`)
);
--> statement-breakpoint
CREATE TABLE `turn_requests` (
	`id` text PRIMARY KEY,
	`playthrough_id` text NOT NULL,
	`route_id` text,
	`kind` text NOT NULL,
	`expected_head_turn_id` text,
	`parent_turn_id` text,
	`action` text,
	`preference` text,
	`clarification` text,
	`status` text NOT NULL,
	`error` text,
	`result_turn_id` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`log` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_turn_requests_playthrough_id_playthroughs_id_fk` FOREIGN KEY (`playthrough_id`) REFERENCES `playthroughs`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_turn_requests_route_id_routes_id_fk` FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY,
	`playthrough_id` text NOT NULL,
	`parent_id` text,
	`depth` integer NOT NULL,
	`action` text,
	`prose` text NOT NULL,
	`options` text NOT NULL,
	`scene` text NOT NULL,
	`ending` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_turns_playthrough_id_playthroughs_id_fk` FOREIGN KEY (`playthrough_id`) REFERENCES `playthroughs`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_turns_parent_id_turns_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `turns`(`id`)
);
--> statement-breakpoint
CREATE TABLE `work_versions` (
	`id` text PRIMARY KEY,
	`work_id` text NOT NULL,
	`kind` text NOT NULL,
	`copied_from` text,
	`content_rev` integer DEFAULT 0 NOT NULL,
	`source_rev` integer,
	`meta` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_work_versions_work_id_works_id_fk` FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `works` (
	`id` text PRIMARY KEY,
	`title` text,
	`blurb` text,
	`draft_id` text NOT NULL,
	`published_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_work_idx` ON `jobs` (`work_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `llm_calls_created_idx` ON `llm_calls` (`created_at`);--> statement-breakpoint
CREATE INDEX `playthroughs_version_idx` ON `playthroughs` (`version_id`);--> statement-breakpoint
CREATE INDEX `routes_playthrough_idx` ON `routes` (`playthrough_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `turn_requests_one_active_per_route` ON `turn_requests` (`route_id`) WHERE status in ('running', 'needs_clarification') and route_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `turn_requests_one_active_opening` ON `turn_requests` (`playthrough_id`) WHERE kind = 'opening' and status in ('running', 'needs_clarification');--> statement-breakpoint
CREATE INDEX `turn_requests_route_idx` ON `turn_requests` (`route_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `turn_requests_result_idx` ON `turn_requests` (`result_turn_id`);--> statement-breakpoint
CREATE INDEX `turns_playthrough_idx` ON `turns` (`playthrough_id`);--> statement-breakpoint
CREATE INDEX `turns_parent_idx` ON `turns` (`parent_id`);--> statement-breakpoint
CREATE INDEX `work_versions_work_idx` ON `work_versions` (`work_id`);