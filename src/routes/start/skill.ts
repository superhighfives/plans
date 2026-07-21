import { createFileRoute } from '@tanstack/react-router'
// The app serves its own skill: bundle SKILL.md as a raw string at build time
// (same ?raw trick as states.skill.test.ts) so there's no runtime file read.
import skill from '../../../skills/plans/SKILL.md?raw'

export const Route = createFileRoute('/start/skill')({
  server: {
    handlers: {
      GET: async () => {
        return new Response(skill, {
          headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
          },
        })
      },
    },
  },
})
