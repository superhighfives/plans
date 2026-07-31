import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { WorkflowEntrypoint } from 'cloudflare:workers'
import { getSandbox } from '@cloudflare/sandbox'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '~/db/schema'
import { installations } from '~/db/schema'
import type { AppEnv } from '~/env'
import { getInstallationToken } from '~/lib/github/app'
import type { VerifyPlanMoveResult, VerifyStepResult } from '~/lib/plans/types'

/**
 * What `VerifyPlanMoveWorkflow` needs to clone and verify a repo. Deliberately
 * NOT the installation token itself — Workflow params are checkpointed
 * (persisted) for the run's lifetime, so this mints a fresh token from the DB
 * inside the workflow instead, the same "don't persist the raw token"
 * discipline `FlueAgent`'s draft state already follows (slice 3 review fix).
 */
export interface VerifyPlanMovePayload {
  /** `installations.id` (DB primary key) — used to look up + mint a token. */
  installationId: string
  owner: string
  repoName: string
  /** Branch to verify — the repo's default branch (the state a "done" move is about). */
  defaultBranch: string
}

/** The only package.json scripts this checks — deliberately narrow: "does it
 * actually build and pass its own tests," not a general CI replacement. */
const VERIFY_SCRIPTS = ['test', 'build']

const WORKSPACE = '/workspace/repo'
const LOG_TAIL_CHARS = 4000

function tail(text: string): string {
  return text.length > LOG_TAIL_CHARS ? text.slice(-LOG_TAIL_CHARS) : text
}

/**
 * Clones a repo's default branch into an ephemeral Sandbox container,
 * installs its dependencies, and runs whichever of `VERIFY_SCRIPTS` its
 * package.json defines — the slice-5 "container escalation," gated behind a
 * Workflow because clone+install+test/build can take minutes, well past a
 * single Worker request's lifetime. Each step is checkpointed, so a dropped
 * connection or platform hiccup resumes rather than restarting from scratch.
 *
 * Used to gate a plan's move to `done`: the author sees this pass (or the
 * failure) before committing, but nothing here touches the plan or the
 * commit path — this only reports pass/fail.
 */
export class VerifyPlanMoveWorkflow extends WorkflowEntrypoint<
  AppEnv,
  VerifyPlanMovePayload
> {
  async run(
    event: WorkflowEvent<VerifyPlanMovePayload>,
    step: WorkflowStep,
  ): Promise<VerifyPlanMoveResult> {
    const { installationId, owner, repoName, defaultBranch } = event.payload
    // Every operation below re-fetches the sandbox by id — the same id always
    // resolves to the same container, and a fresh handle avoids relying on a
    // reference surviving across checkpoints/retries.
    const sandboxId = event.instanceId

    const cloned = await step.do(
      'clone repository',
      { timeout: '2 minutes' },
      async () => {
        const db = drizzle(this.env.DB, { schema })
        const installation = await db.query.installations.findFirst({
          where: eq(installations.id, installationId),
        })
        if (!installation) throw new Error('Installation not found')
        const token = await getInstallationToken(db, this.env, installation)

        const sandbox = getSandbox(this.env.Sandbox, sandboxId)
        const result = await sandbox.gitCheckout(
          `https://x-access-token:${token}@github.com/${owner}/${repoName}.git`,
          {
            branch: defaultBranch,
            targetDir: WORKSPACE,
            depth: 1,
            cloneTimeoutMs: 60_000,
          },
        )
        // Never return anything derived from the token-bearing repoUrl.
        return { success: result.success }
      },
    )

    if (!cloned.success) {
      await this.destroySandbox(step, sandboxId)
      return {
        ok: false,
        ranScripts: [],
        steps: [
          {
            name: 'clone',
            command: null,
            exitCode: 1,
            success: false,
            logTail: "Couldn't clone the repository.",
          },
        ],
      }
    }

    // The sandbox is live from this point on — everything below must destroy
    // it before returning or throwing, or a stuck/thrown step (e.g. malformed
    // package.json) strands the container until its idle timeout.
    try {
      const install = await step.do(
        'install dependencies',
        { timeout: '3 minutes' },
        async () => {
          const sandbox = getSandbox(this.env.Sandbox, sandboxId)
          const hasLockfile = await sandbox.exec('test -f package-lock.json', {
            cwd: WORKSPACE,
          })
          const command = hasLockfile.success ? 'npm ci' : 'npm install'
          const result = await sandbox.exec(command, {
            cwd: WORKSPACE,
            timeout: 180_000,
          })
          return {
            name: 'install',
            command,
            exitCode: result.exitCode,
            success: result.success,
            logTail: tail(result.stdout + result.stderr),
          } satisfies VerifyStepResult
        },
      )

      if (!install.success) {
        return { ok: false, ranScripts: [], steps: [install] }
      }

      const availableScripts = await step.do(
        'read package.json scripts',
        async () => {
          const sandbox = getSandbox(this.env.Sandbox, sandboxId)
          const file = await sandbox.readFile(`${WORKSPACE}/package.json`)
          const parsed = JSON.parse(file.content) as {
            scripts?: Record<string, string>
          }
          return Object.keys(parsed.scripts ?? {})
        },
      )

      const ranScripts = VERIFY_SCRIPTS.filter((name) =>
        availableScripts.includes(name),
      )
      const steps: VerifyStepResult[] = [install]
      let ok = ranScripts.length > 0

      for (const name of ranScripts) {
        const result = await step.do(
          `run npm run ${name}`,
          { timeout: '3 minutes' },
          async () => {
            const sandbox = getSandbox(this.env.Sandbox, sandboxId)
            const command = `npm run ${name}`
            const execResult = await sandbox.exec(command, {
              cwd: WORKSPACE,
              timeout: 180_000,
            })
            return {
              name,
              command,
              exitCode: execResult.exitCode,
              success: execResult.success,
              logTail: tail(execResult.stdout + execResult.stderr),
            } satisfies VerifyStepResult
          },
        )
        steps.push(result)
        if (!result.success) {
          ok = false
          break
        }
      }

      return { ok, ranScripts, steps }
    } finally {
      await this.destroySandbox(step, sandboxId)
    }
  }

  /** Free the container immediately rather than waiting out its idle timeout — a checkpointed step, so a retry after this point doesn't skip it. */
  private async destroySandbox(
    step: WorkflowStep,
    sandboxId: string,
  ): Promise<void> {
    await step.do('destroy sandbox', async () => {
      const sandbox = getSandbox(this.env.Sandbox, sandboxId)
      await sandbox.destroy()
    })
  }
}
