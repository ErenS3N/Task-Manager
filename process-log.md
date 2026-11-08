# Process Log

- **Part 1 - Task Detail Window**

- **Step 1 - Task metadata:** Added task metadata for Notes, creation time, and last-updated time, with validation when task data is loaded. The metadata is available to the task and Detail views.

- **Step 2 - Detail window:** Added and registered a dedicated Task Detail window, renderer, and preload. The main process supplies task details; a manual check confirmed the Detail window opens separately and leaves the main window usable.

- **Step 3 - Notes editing:** Added Notes editing in Detail with Save/Cancel, a 500-character limit, updated timestamps, and task update broadcasts. Removed Notes from Edit and Add so those windows cannot change Notes; task creation initializes Notes as empty, and normal task edits preserve existing Notes. A stale Edit renderer lookup for the removed Notes field was found and removed after it caused the Edit load callback to throw.

- **Window size persistence:** Made Add, Edit, and Detail resizable and persisted each window's dimensions under a separate settings key. Their defaults remain 500x500 for Add/Edit and 520x600 for Detail.

- **Step 4 - Security requirements:** Checked the Detail BrowserWindow options, HTML CSP, and dedicated preload. The required sandbox, context isolation, disabled Node integration, CSP, and three Detail IPC APIs were already present, so no additional code change was needed.

- **Build issue and recovery:** `pnpm package` initially failed with `ENOTEMPTY` while the dev app was using `.webpack/renderer`. Stopped the dev process and reran the package build successfully. The package build also passed after the Edit renderer fix and Detail size persistence change.

- **Detail window styling:** Added a dedicated stylesheet matching the app's dark palette and controls, plus the reference's task ID row and bottom Close button. The package build passed with the stylesheet bundled.

- **Detail route recovery:** A failed `pnpm start` cleanup left `.webpack/renderer/detail_window` missing, which caused `Cannot GET /detail_window/index.html`. Stopped the stale Electron process tree from this workspace and restarted Forge; startup succeeded and regenerated the Detail renderer route.

- **Window dimension persistence:** Centralized Add, Edit, and Detail saves on resize and close, and added a Main-window snapshot before its close-to-tray handler. Existing settings already contained saved dimensions; the additional event coverage ensures the latest bounds are recorded. Diagnostics found no errors; packaging was not run while the app was open.

**Part 2 - Auto Update**

- **Updater research:** Added `update-electron-app` as the updater dependency. Confirmed its GitHub update service requires a public repository and GitHub Releases; Windows releases must include the Squirrel `RELEASES` manifest and full `.nupkg`. The configured course remote is not publicly accessible, so the app will need a public release repository for live update checks.

- **Main-process update flow:** Added packaged Windows launch checks through `update-electron-app`, disabled its built-in dialog, and bridged update-available/downloaded state plus a guarded restart-and-install request through the main-window preload. Update state is retained and sent after renderer load. The feed initially targeted the course repository; see the public-repository setup below.

- **Renderer update notices:** Added a live status banner for an available update, a ready-to-install notice, and a Restart and Install button shown only after download completion. The button requests the guarded main-process install action. Renderer diagnostics found no errors, and `pnpm package` passed.

- **GitHub Releases publishing:** Added a Windows GitHub Actions workflow triggered by matching `vX.Y.Z` tags. It builds and publishes the Squirrel `RELEASES`, full `.nupkg`, and setup `.exe` assets; documented the version-tag workflow and public-repository requirement. `pnpm make` generated all three expected assets. The updater check is Windows-only to match the published artifacts. Used GitHub Actions' `gh` CLI instead of adding the Forge GitHub publisher because pnpm's supply-chain policy rejected its transitive `@octokit/endpoint@9.0.6` dependency.

- **Packaged Add/Edit title-field styling:** Confirmed the packaged HTML optimizer removes the redundant `type="text"` attribute from the title input. The shared CSS selectors required that attribute, so they stopped matching only in packaged builds; runtime inspection showed native appearance and system colors despite the stylesheet loading. Changed the shared input selectors to work whether or not the default type attribute is retained. The earlier dark-scheme/appearance-only change was insufficient. `pnpm make` passed, and DevTools computed styles in a local package build confirmed both Add and Edit now use the intended dark background, light text, 8px radius, and `appearance: none` while the type attribute is absent.

- **Public update repository:** Changed the updater source to the public `ErenS3N/Task-Manager` repository, matching the `release` remote. `pnpm make` passed with the new target. The initial lack of SemVer tags was resolved by publishing `v3.0.0` and `v3.0.1`.

- **Release test correction:** Confirmed the installed app is `3.0.1`, while the public `v3.0.1` tag points to a commit before the title-field selector fix. Therefore, the update delivered by that release could not contain the fix. Bumped the package version to `3.0.2`; `pnpm make` passed, and the embedded version and Squirrel asset names were verified. The fixed `v3.0.2` release is now published.

- **Updater release propagation:** Confirmed the public `v3.0.2` release is stable and has the required Squirrel assets. At 21:12 UTC, `update.electronjs.org` still offered `v3.0.1` to a `3.0.0` client and returned `204` for `3.0.1`; this matches the service's default 15-minute release-cache TTL. `update-electron-app` checks every 10 minutes. After a few minutes, `v3.0.2` installed successfully and fixed the packaged title-field styling.