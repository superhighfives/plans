CREATE TABLE `verify_move_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
