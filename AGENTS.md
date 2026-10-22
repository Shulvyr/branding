# Branding instructions

This repository contains Shulvyr's visual assets. Follow the user's request and preserve unrelated work.

- Read README before editing. The server source belongs in [Shulvyr/Shulvyr](https://github.com/Shulvyr/Shulvyr).
- Keep the approved square shell, small face and cutaway corners.
- Edit the native 16px grid and its exact 2x representation at 32px. Enlarge by integer scale factors.
- Maintain the color/light, color/dark, black and white versions. The dark color version uses a light outline and dark eyes. Monochrome face and rim cutouts are transparent.
- Generate exports with `tools/branding/build.mjs`. Run its `--check` command, verify PNG dimensions and alpha, then inspect the variants on their intended backgrounds.
- Keep public text in English. Use plain hyphens. Do not use semicolons or long dash characters in prose.
- Keep naming research, conversation history, local timestamps and agent handoff notes out of this repository.
- Check staged files and secrets before publishing. Commit, push and account changes require user authorization.
- Report the actual checks and results. Do not claim unverified completion.
