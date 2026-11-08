# Task Manager v3

Desktop task manager built with Electron Forge.

## Prerequisites

- Node.js (LTS recommended)
- pnpm

Enable pnpm with Corepack if it is not already installed:

```bash
corepack enable
```

## Run the app

1. Clone the repository and open a terminal in the project folder.
2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Start the application in development mode:

   ```bash
   pnpm start
   ```

Electron Forge will build the application and open the Task Manager window.

## Build a distributable

Create a packaged application for the current platform:

```bash
pnpm package
```

Create platform-specific installers or archives:

```bash
pnpm make
```

Build artifacts are written to the `out` directory.

## Publish a Windows release

1. Update the `version` in `package.json`.
2. Push a matching version tag, such as `v3.0.1`:

   ```bash
   git tag v3.0.1
   git push origin v3.0.1
   ```

The `Publish Windows Release` workflow builds the Squirrel.Windows installer and publishes `RELEASES`, the full `.nupkg`, and the setup `.exe` to a GitHub Release. The tag must match the package version. The updater is configured for this repository, which must be public for `update.electronjs.org` to serve updates; draft and prerelease releases are not update targets.

## Available scripts

| Command | Description |
| --- | --- |
| `pnpm start` | Run the app in development mode. |
| `pnpm package` | Package the app for the current platform. |
| `pnpm make` | Create installers or archives for the current platform. |
| `pnpm lint` | Run the configured lint command. |