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

## Available scripts

| Command | Description |
| --- | --- |
| `pnpm start` | Run the app in development mode. |
| `pnpm package` | Package the app for the current platform. |
| `pnpm make` | Create installers or archives for the current platform. |
| `pnpm lint` | Run the configured lint command. |