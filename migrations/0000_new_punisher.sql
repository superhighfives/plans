CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`repo_id` text,
	`action` text NOT NULL,
	`paths` text,
	`commit_sha` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_repo_idx` ON `audit_log` (`repo_id`);--> statement-breakpoint
CREATE TABLE `installations` (
	`id` text PRIMARY KEY NOT NULL,
	`github_installation_id` integer NOT NULL,
	`account_login` text NOT NULL,
	`account_type` text NOT NULL,
	`account_avatar_url` text,
	`token_ciphertext` text,
	`token_expires_at` integer,
	`suspended_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `installations_github_installation_id_unique` ON `installations` (`github_installation_id`);--> statement-breakpoint
CREATE TABLE `plan_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`path` text NOT NULL,
	`state` text NOT NULL,
	`title` text NOT NULL,
	`status` text,
	`created_fm` text,
	`updated_fm` text,
	`body_sha` text NOT NULL,
	`body` text,
	`cached_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_cache_repo_state_idx` ON `plan_cache` (`repo_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `plan_cache_repo_path` ON `plan_cache` (`repo_id`,`path`);--> statement-breakpoint
CREATE TABLE `repos` (
	`id` text PRIMARY KEY NOT NULL,
	`installation_id` text NOT NULL,
	`github_repo_id` integer NOT NULL,
	`full_name` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`default_branch` text NOT NULL,
	`is_private` integer DEFAULT false NOT NULL,
	`has_plans` integer DEFAULT false NOT NULL,
	`last_scanned_sha` text,
	`last_scanned_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`installation_id`) REFERENCES `installations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `repos_full_name_idx` ON `repos` (`full_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `repos_installation_github_id` ON `repos` (`installation_id`,`github_repo_id`);--> statement-breakpoint
CREATE TABLE `user_installations` (
	`user_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `installation_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`installation_id`) REFERENCES `installations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`github_user_id` integer NOT NULL,
	`login` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_github_user_id_unique` ON `users` (`github_user_id`);