import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'

// The Durable Object / Workflow classes must be named exports of the Worker
// entry so the runtime can bind them. Re-exported here (this file is the
// Worker `main`) rather than from a route module.
export { Sandbox } from '@cloudflare/sandbox'
export { VerifyPlanMoveWorkflow } from './workflows/verify-plan-move'

export default { fetch: createStartHandler(defaultStreamHandler) }
