# Sandbox image for Flue's verify-before-done step (slice 5). Pinned to the
# @cloudflare/sandbox package version in package.json — bump both together.
# The default variant ships Node, npm, and git, which is everything a
# repo's install + test + build scripts need.
FROM docker.io/cloudflare/sandbox:0.12.4

EXPOSE 8080
