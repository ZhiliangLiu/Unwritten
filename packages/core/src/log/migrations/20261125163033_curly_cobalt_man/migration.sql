CREATE TABLE `diagnostic_events` (
	`id` text PRIMARY KEY,
	`created_at` integer NOT NULL,
	`run_id` text NOT NULL,
	`level` text NOT NULL,
	`module` text NOT NULL,
	`event` text NOT NULL,
	`work_id` text,
	`request_id` text,
	`job_id` text,
	`call_id` text,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `performance_samples` (
	`id` text PRIMARY KEY,
	`created_at` integer NOT NULL,
	`run_id` text NOT NULL,
	`app_version` text NOT NULL,
	`source` text NOT NULL,
	`metric` text NOT NULL,
	`duration_ms` real NOT NULL,
	`outcome` text NOT NULL,
	`work_id` text,
	`request_id` text,
	`job_id` text,
	`call_id` text,
	`attempt` integer,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `diagnostic_events_created_idx` ON `diagnostic_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `diagnostic_events_run_idx` ON `diagnostic_events` (`run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `diagnostic_events_request_idx` ON `diagnostic_events` (`request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `diagnostic_events_job_idx` ON `diagnostic_events` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `diagnostic_events_call_idx` ON `diagnostic_events` (`call_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `performance_samples_created_idx` ON `performance_samples` (`created_at`);--> statement-breakpoint
CREATE INDEX `performance_samples_version_idx` ON `performance_samples` (`app_version`,`created_at`);--> statement-breakpoint
CREATE INDEX `performance_samples_metric_idx` ON `performance_samples` (`metric`,`app_version`,`created_at`);--> statement-breakpoint
CREATE INDEX `performance_samples_request_idx` ON `performance_samples` (`request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `performance_samples_job_idx` ON `performance_samples` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `performance_samples_call_idx` ON `performance_samples` (`call_id`,`created_at`);