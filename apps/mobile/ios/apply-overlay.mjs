// Turns a checkout of Plaud's starter app into the Groundwork walk recorder:
// copies overlay/*.swift in, makes a handful of small edits to the starter's own files, and
// writes the build settings. Used by .github/workflows/ios.yml; runs anywhere Node does.
//
//   node apps/mobile/ios/apply-overlay.mjs <path to plaud-sdk-public checkout>
//
// Settings come from the environment (all optional except the token for a usable build):
//   PLAUD_USER_ACCESS_TOKEN  token the SDK binds the device with (valid 24 h; the app renews it)
//   GROUNDWORK_API_URL       origin the phone sends chunks to, e.g. https://x.trycloudflare.com
//   GROUNDWORK_API_TOKEN     WALK_API_TOKEN from the server's .env
//   GROUNDWORK_CUT_SECONDS   seconds between cuts (default 90)
//   IOS_BUNDLE_ID            bundle id (default com.groundwork.walkrecorder)
//   IOS_VERSION              marketing version (default 0.1.0)
//   BUILD_NUMBER             build number; TestFlight refuses one it has seen (default 1)
//
// Every edit names the exact text it expects and stops if it is missing, so a change in the
// starter app fails the build here instead of producing an app that silently lacks a patch.
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The starter app commit the edits below were written against; the workflow checks out the same one. */
const PLAUD_SDK_COMMIT = readFileSync(path.join(here, 'plaud-sdk.commit'), 'utf8').trim();
const checkout = process.argv[2];
if (!checkout) {
  console.error('Usage: node apply-overlay.mjs <path to plaud-sdk-public checkout>');
  process.exit(1);
}
const ios = path.resolve(checkout, 'ios');
const app = path.join(ios, 'PlaudTemplateApp');

function stop(message) {
  console.error(message);
  process.exit(1);
}

function edit(file, edits) {
  const target = path.join(ios, file);
  let text = readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  for (const { find, replace, why } of edits) {
    const count = text.split(find).length - 1;
    if (count !== 1) {
      stop(
        `${file}: expected exactly one match for the "${why}" edit, found ${count}.\n` +
          `The starter app has changed since ${PLAUD_SDK_COMMIT.slice(0, 7)}; update apply-overlay.mjs.`,
      );
    }
    text = text.replace(find, () => replace);
  }
  writeFileSync(target, text);
  console.log(`edited  ${file} (${edits.map((e) => e.why).join('; ')})`);
}

/** One line of plain text from the environment, checked against what the value may contain. */
function setting(name, fallback, allowed, hint) {
  const value = (process.env[name] || fallback).trim();
  if (!allowed.test(value)) stop(`${name} must be ${hint}.`);
  return value;
}

// Checked before anything is written, so a bad value leaves the checkout untouched.
const bundleId = setting('IOS_BUNDLE_ID', 'com.groundwork.walkrecorder', /^[A-Za-z0-9.-]+$/, 'letters, digits, dots and hyphens');
const version = setting('IOS_VERSION', '0.1.0', /^\d+(\.\d+){0,2}$/, 'a version like 0.1.0');
const buildNumber = setting('BUILD_NUMBER', '1', /^\d+$/, 'a whole number');
const cutSeconds = setting('GROUNDWORK_CUT_SECONDS', '90', /^\d+$/, 'a whole number of seconds');
if (Number(cutSeconds) < 15) stop('GROUNDWORK_CUT_SECONDS must be 15 or more.');
const userToken = setting('PLAUD_USER_ACCESS_TOKEN', '', /^[A-Za-z0-9._-]*$/, 'a JWT');
const apiUrl = setting('GROUNDWORK_API_URL', '', /^(https?:\/\/[A-Za-z0-9.:\-_/]+)?$/, 'an http(s) address');
const apiToken = setting('GROUNDWORK_API_TOKEN', '', /^[A-Za-z0-9._~+=-]*$/, 'letters, digits and . _ ~ + = -');

// 1. Our own source files, and the release lane.
const destination = path.join(app, 'Groundwork');
mkdirSync(destination, { recursive: true });
for (const name of readdirSync(path.join(here, 'overlay'))) {
  cpSync(path.join(here, 'overlay', name), path.join(destination, name));
  console.log(`copied  PlaudTemplateApp/Groundwork/${name}`);
}
cpSync(path.join(here, 'fastlane'), path.join(ios, 'fastlane'), { recursive: true });
cpSync(path.join(here, 'Gemfile'), path.join(ios, 'Gemfile'));
console.log('copied  fastlane/ and Gemfile');

// 2. The starter ships an empty icon set, and App Store Connect refuses an app without an icon.
const iconSet = path.join(app, 'Resources', 'Assets.xcassets', 'AppIcon.appiconset');
cpSync(path.join(here, 'assets', 'AppIcon-1024.png'), path.join(iconSet, 'AppIcon-1024.png'));
writeFileSync(
  path.join(iconSet, 'Contents.json'),
  JSON.stringify(
    {
      images: [{ filename: 'AppIcon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
      info: { author: 'xcode', version: 1 },
    },
    null,
    2,
  ),
);
console.log('wrote   app icon');

// 3. A Walk tab beside Home, Files and Settings.
edit('PlaudTemplateApp/UI/Main/MainTabBarController.swift', [
  {
    why: 'walk tab controller',
    find: `        childNavs = [homeNav, filesNav, settingsNav]\n`,
    replace:
      `        let walkNav = UINavigationController(rootViewController: WalkViewController())\n` +
      `        childNavs = [homeNav, walkNav, filesNav, settingsNav]\n`,
  },
  {
    why: 'walk tab button',
    find: `                FloatingTabItem(title: "Files", icon: UIImage(named: "tab_files")),\n`,
    replace:
      `                FloatingTabItem(title: "Walk", icon: UIImage(systemName: "figure.walk")),\n` +
      `                FloatingTabItem(title: "Files", icon: UIImage(named: "tab_files")),\n`,
  },
  {
    why: 'tab bar width for four tabs',
    find: `floatingBar.widthAnchor.constraint(equalToConstant: 272)`,
    replace: `floatingBar.widthAnchor.constraint(equalToConstant: 320)`,
  },
]);

// 4. During a walk the device is recording while the previous chunk syncs. The starter downloads
//    and then deletes every file the device lists, so keep the recording in progress out of it.
edit('PlaudTemplateApp/Managers/SyncManager.swift', [
  {
    why: 'skip the recording in progress',
    find: `    func handleFileList(_ bleFiles: [BleFile]) {\n`,
    replace:
      `    func handleFileList(_ bleFiles: [BleFile]) {\n` +
      `        let recordingNow = RecordingManager.shared.stateSubject.value.currentSessionId\n` +
      `        let bleFiles = bleFiles.filter { $0.sessionId != recordingNow }\n`,
  },
]);

// 5. The starter talks to Plaud's test servers; our credentials belong to production.
edit('PlaudTemplateApp/Storage/RecordingStore.swift', [
  {
    why: 'production Plaud servers',
    find: `        serverDomainOverride ?? Self.testServerDomain\n`,
    replace: `        serverDomainOverride ?? Self.prodServerDomain\n`,
  },
]);

// 6. Project settings.
edit('project.yml', [
  // Signing is set by the release lane at build time; nobody's team id lives in the project.
  { why: 'no committed team', find: `    DEVELOPMENT_TEAM: W8JQQJQR29\n`, replace: `    DEVELOPMENT_TEAM: ""\n` },
  {
    why: 'bundle id, icon and iPhone only',
    find: `        PRODUCT_BUNDLE_IDENTIFIER: com.plaud.PlaudTemplateApp1\n`,
    replace:
      `        PRODUCT_BUNDLE_IDENTIFIER: ${bundleId}\n` +
      `        ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon\n` +
      // The starter is portrait-only, and App Store Connect refuses an app that runs on
      // iPad unless it supports all four orientations.
      `        TARGETED_DEVICE_FAMILY: "1"\n`,
  },
  {
    // Both entitlements are for WiFi fast transfer, which a walk does not use: chunks sync
    // over Bluetooth. Claiming them would need the capabilities enabled on the App ID first.
    why: 'no WiFi transfer entitlements',
    find:
      `    entitlements:\n` +
      `      path: PlaudTemplateApp/PlaudTemplateApp.entitlements\n` +
      `      properties:\n` +
      `        com.apple.developer.networking.HotspotConfiguration: true\n` +
      `        com.apple.developer.networking.wifi-info: true\n`,
    replace: ``,
  },
  { why: 'version', find: `        CFBundleShortVersionString: "1.0.57"\n`, replace: `        CFBundleShortVersionString: "${version}"\n` },
  { why: 'build number', find: `        CFBundleVersion: "57"\n`, replace: `        CFBundleVersion: "${buildNumber}"\n` },
  {
    why: 'walk settings in Info.plist',
    find: `        PlaudApiKey: $(PLAUD_API_KEY)\n`,
    replace:
      `        PlaudApiKey: $(PLAUD_API_KEY)\n` +
      `        CFBundleDisplayName: Groundwork Walk\n` +
      `        UIRequiresFullScreen: true\n` +
      // The Walk tab takes site photos with the camera, and falls back to the photo library
      // where there is no camera. Adding to the library and the microphone are only here because
      // Plaud's library contains that code: Apple invalidates a build that references those APIs
      // without a purpose string, whether or not they are called.
      `        NSCameraUsageDescription: Groundwork Walk uses the camera to take site photos during a walk. They are added to the walk and its proposal.\n` +
      `        NSPhotoLibraryUsageDescription: Groundwork Walk can add a site photo from your library to a walk.\n` +
      `        NSPhotoLibraryAddUsageDescription: Not used by this app. Plaud's device library includes photo features that Groundwork Walk never opens.\n` +
      `        NSMicrophoneUsageDescription: Not used by this app. Audio is recorded by the Plaud device, not by the phone.\n` +
      `        GroundworkApiURL: $(GROUNDWORK_API_URL)\n` +
      `        GroundworkApiToken: $(GROUNDWORK_API_TOKEN)\n` +
      `        GroundworkCutSeconds: $(GROUNDWORK_CUT_SECONDS)\n` +
      // plain http is only for a server on the same network; a tunnel is https
      `        NSAppTransportSecurity:\n` +
      `          NSAllowsLocalNetworking: true\n`,
  },
]);
// xcodebuild needs a shared scheme to archive, and the generated project has none.
const projectFile = path.join(ios, 'project.yml');
writeFileSync(
  projectFile,
  readFileSync(projectFile, 'utf8').trimEnd() +
    `\n\nschemes:\n  PlaudTemplateApp:\n    build:\n      targets:\n        PlaudTemplateApp: all\n    archive:\n      config: Release\n`,
);
console.log('edited  project.yml (shared scheme)');

// 7. Build settings. xcconfig has no quoting: a value runs to the end of the line and "//"
//    starts a comment, so values are single-line and the slashes in a URL are broken up.
writeFileSync(
  path.join(ios, 'PartnerConfig.local.xcconfig'),
  [
    '// Written by apply-overlay.mjs. Holds credentials: never commit.',
    `USER_ACCESS_TOKEN = ${userToken}`,
    // The app sends audio to the Groundwork API, which holds the Plaud keys. The starter's own
    // in-app transcription stays switched off so no API key ships inside the app.
    'PLAUD_CLIENT_ID = ',
    'PLAUD_API_KEY = ',
    `GROUNDWORK_API_URL = ${apiUrl.replace(/\/\//g, '/$()/')}`,
    `GROUNDWORK_API_TOKEN = ${apiToken}`,
    `GROUNDWORK_CUT_SECONDS = ${cutSeconds}`,
    '',
  ].join('\n'),
);
console.log('wrote   PartnerConfig.local.xcconfig');
if (!userToken) console.warn('warning: PLAUD_USER_ACCESS_TOKEN is empty; the app will build but cannot bind a device.');
