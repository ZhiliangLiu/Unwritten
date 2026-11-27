CREATE TABLE `state_defs` (
	`version_id` text NOT NULL,
	`id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`display` text NOT NULL,
	`config` text NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`reveal` text,
	`origin_turn_id` text,
	`rev` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `state_defs_pk` PRIMARY KEY(`version_id`, `id`),
	CONSTRAINT `fk_state_defs_version_id_work_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `work_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_state_defs_origin_turn_id_turns_id_fk` FOREIGN KEY (`origin_turn_id`) REFERENCES `turns`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `state_values` (
	`version_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`state_def_id` text NOT NULL,
	`value` text,
	`visible` integer NOT NULL,
	`closed` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `state_values_pk` PRIMARY KEY(`version_id`, `turn_id`, `state_def_id`),
	CONSTRAINT `fk_state_values_version_id_work_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `work_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_state_values_turn_id_turns_id_fk` FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_state_values_version_id_state_def_id_state_defs_version_id_id_fk` FOREIGN KEY (`version_id`,`state_def_id`) REFERENCES `state_defs`(`version_id`,`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `state_defs_origin_idx` ON `state_defs` (`version_id`,`origin_turn_id`);