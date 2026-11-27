CREATE TABLE `llm_call_logs` (
	`call_id` text PRIMARY KEY,
	`work_id` text,
	`system` text NOT NULL,
	`prompt` text NOT NULL,
	`response` text,
	`http` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_llm_call_logs_call_id_llm_calls_id_fk` FOREIGN KEY (`call_id`) REFERENCES `llm_calls`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_llm_call_logs_work_id_works_id_fk` FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `llm_call_logs_created_idx` ON `llm_call_logs` (`created_at`);