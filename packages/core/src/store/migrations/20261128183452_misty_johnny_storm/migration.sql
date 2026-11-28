CREATE TABLE `image_service_capabilities` (
	`service_id` text PRIMARY KEY,
	`capabilities` text NOT NULL,
	`probed_at` integer NOT NULL
);
