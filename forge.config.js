const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    icon: './assets/icons/icon',    
    extraResource: [
      './assets/icon.png'
    ],
  },  
  rebuildConfig: {},
  makers: [
  {
    name: '@electron-forge/maker-squirrel',
    config: {
      name: 'TaskManager',
      setupExe: 'TaskManagerSetup.exe',
      setupIcon: './assets/icons/icon.ico',
    },
  },
  {
    name: '@electron-forge/maker-zip',
    platforms: ['darwin'],
  },
  {
    name: '@electron-forge/maker-deb',
    config: {},
  },
  {
    name: '@electron-forge/maker-rpm',
    config: {},
  },
],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: './webpack.main.config.js',
        assets: ['./assets'],   // include the assets folder for the tray icon
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              html:    './src/main-window/index.html',
              js:      './src/main-window/renderer.js',
              name:    'main_window',
              preload: { js: './src/main-window/preload.js' },
            },
            {
              html:    './src/add-window/add.html',
              js:      './src/add-window/add.js',
              name:    'add_window',
              preload: { js: './src/add-window/preload.js' },
            },
            // NEW in v3: edit window entry point
            {
              html:    './src/edit-window/edit.html',
              js:      './src/edit-window/edit.js',
              name:    'edit_window',
              preload: { js: './src/edit-window/preload.js' },
            },
          ],
        },
      },
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
};
