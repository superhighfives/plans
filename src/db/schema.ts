import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core'

/**
 * D1 schema — the app's own state and caches. GitHub is the source of truth for
 * plan content; nothing here is authoritative. Timestamps are unix-epoch ms.
 */

const now = sql`(unixepoch() * 1000)`

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  githubUserId: integer('github_user_id').notNull().unique(),
  login: text('login').notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
})

export const installations = sqliteTable('installations', {
  id: text('id').primaryKey(),
  githubInstallationId: integer('github_installation_id').notNull().unique(),
  accountLogin: text('account_login').notNull(),
  /** 'User' | 'Organization' */
  accountType: text('account_type').notNull(),
  accountAvatarUrl: text('account_avatar_url'),
  /** AES-GCM-encrypted installation access token (cache). */
  tokenCiphertext: text('token_ciphertext'),
  /** Expiry of the cached token (unix ms). */
  tokenExpiresAt: integer('token_expires_at'),
  /** Set when the App is suspended/uninstalled for this account. */
  suspendedAt: integer('suspended_at'),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
})

/** A user can access many installations (their own + orgs they belong to). */
export const userInstallations = sqliteTable(
  'user_installations',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    installationId: text('installation_id')
      .notNull()
      .references(() => installations.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.installationId] })],
)

export const repos = sqliteTable(
  'repos',
  {
    id: text('id').primaryKey(),
    installationId: text('installation_id')
      .notNull()
      .references(() => installations.id, { onDelete: 'cascade' }),
    githubRepoId: integer('github_repo_id').notNull(),
    /** owner/name */
    fullName: text('full_name').notNull(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    defaultBranch: text('default_branch').notNull(),
    isPrivate: integer('is_private', { mode: 'boolean' })
      .notNull()
      .default(false),
    /** Whether a top-level plans/ directory was found on the last scan. */
    hasPlans: integer('has_plans', { mode: 'boolean' })
      .notNull()
      .default(false),
    /** Head commit sha the cache was built from. */
    lastScannedSha: text('last_scanned_sha'),
    lastScannedAt: integer('last_scanned_at'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [
    unique('repos_installation_github_id').on(t.installationId, t.githubRepoId),
    index('repos_full_name_idx').on(t.fullName),
  ],
)

/** Cached, parsed plans. Rebuilt from GitHub against `bodySha`; never authoritative. */
export const planCache = sqliteTable(
  'plan_cache',
  {
    id: text('id').primaryKey(),
    repoId: text('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    /** Full path in the repo, e.g. plans/ready/foo.md */
    path: text('path').notNull(),
    /** backlog | ready | in-progress | done */
    state: text('state').notNull(),
    title: text('title').notNull(),
    /** Frontmatter `status` (free text). */
    status: text('status'),
    /** Frontmatter `created` (raw string). */
    createdFm: text('created_fm'),
    /** Frontmatter `updated` (raw string). */
    updatedFm: text('updated_fm'),
    /** Git blob sha of the file. */
    bodySha: text('body_sha').notNull(),
    /** Cached markdown body (optional; may be null until the plan is opened). */
    body: text('body'),
    cachedAt: integer('cached_at').notNull().default(now),
  },
  (t) => [
    unique('plan_cache_repo_path').on(t.repoId, t.path),
    index('plan_cache_repo_state_idx').on(t.repoId, t.state),
  ],
)

/** Every mutation records the user who triggered the bot-authored commit (Phase 2+). */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    repoId: text('repo_id').references(() => repos.id, {
      onDelete: 'set null',
    }),
    /** e.g. 'plan.update' | 'plan.move' | 'plan.create' */
    action: text('action').notNull(),
    /** JSON array of affected paths. */
    paths: text('paths'),
    commitSha: text('commit_sha'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('audit_log_repo_idx').on(t.repoId)],
)

export type User = typeof users.$inferSelect
export type Installation = typeof installations.$inferSelect
export type Repo = typeof repos.$inferSelect
export type PlanCacheRow = typeof planCache.$inferSelect
