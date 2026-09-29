# iOS walk recorder

The phone app that records a site walk in chunks. It is Plaud's starter app with a **Walk** tab
added. Pairing, binding, syncing and settings are the starter's own and work as Plaud documents
them.

The repo is developed on Windows, so the app is only ever built by GitHub Actions
([.github/workflows/ios.yml](../../../.github/workflows/ios.yml)). Nothing here has been run on
a phone yet; see [What is not proven](#what-is-not-proven).

## How it is put together

Plaud's app is not copied into this repo. The workflow checks out
[plaud-sdk-public](https://github.com/Plaud-AI/plaud-sdk-public) at the commit in
`plaud-sdk.commit`, and `apply-overlay.mjs` turns it into our app:

| File | What it is |
|---|---|
| `overlay/WalkCutManager.swift` | Cuts the recording every 90 s and sends each synced file to the API |
| `overlay/WalkViewController.swift` | The Walk tab |
| `overlay/WalkBackend.swift` | The API calls, and the settings the Walk tab edits |
| `apply-overlay.mjs` | Copies the files in and makes six small edits to the starter app |
| `fastlane/Fastfile` | Signs and uploads to TestFlight |
| `mint-user-token.mjs` | Gets the Plaud token the build starts with |

The edits to the starter app: a fourth tab, production Plaud servers instead of test, an app
icon, our bundle id, no WiFi-transfer entitlements, and one change to syncing so the recording
in progress is never downloaded and deleted. Each edit stops the build if the text it expects
is missing, so moving `plaud-sdk.commit` forward fails loudly rather than quietly dropping one.

## What a walk does

1. **Start walk** creates a walk on the API and starts the device recording.
2. Every 90 seconds the app stops the recording and starts the next one as soon as the device
   confirms the stop.
3. The starter app syncs the device after every stop. When a closed recording lands on the
   phone, the Walk tab uploads it.
4. The API transcribes it and updates the site model. The Walk tab shows both.
5. **Stop walk** stops the recording, waits for the last files, and marks the walk finished.
   Stopping from the device's button does the same.

If the device does not confirm a cut, the app leaves it recording and tries again at the next
interval, so the audio ends up in one longer chunk instead of being lost.

## Setting up the build

One-time, in this order.

**1. Repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `APPLE_TEAM_ID` | Same as in LumenearsWidgets |
| `ASC_ISSUER_ID` | Same as in LumenearsWidgets |
| `ASC_KEY_ID` | Same as in LumenearsWidgets |
| `ASC_PRIVATE_KEY` | Same as in LumenearsWidgets: the whole `.p8` |
| `PLAUD_CLIENT_ID` | From `.env` |
| `PLAUD_SECRET_KEY` | From `.env` |
| `WALK_API_TOKEN` | From `.env`. Optional: it can be typed into the app instead |

GitHub does not show a stored secret again, so the four Apple values cannot be copied across
from the other repo; they have to be entered from their source.

Optional variables: `IOS_BUNDLE_ID` (default `com.groundwork.walkrecorder`), `PLAUD_USER_ID`
(default `groundwork-architect-01`), `GROUNDWORK_API_URL`.

**2. Run the workflow once** (Actions → iOS → Run workflow). It registers the bundle id, then
stops and says there is no app record.

**3. Create the app record.** App Store Connect → Apps → + → New App, choosing the bundle id
from the dropdown. This is the one step Apple does not allow through the API.

**4. Run the workflow again.** The build appears in TestFlight a few minutes after it finishes.

### The distribution certificate

Without `DIST_P12_BASE64` and `DIST_P12_PASSWORD`, every run creates a new distribution
certificate that no later run can use. Apple caps these per team, and the cap is shared with
LumenearsWidgets, so a few builds here can stop releases there. Setting up one reusable
certificate is described in LumenearsWidgets `docs/deploy.md`, under *Reusing one distribution
certificate*. The same two secrets work in both repos.

## Testing a walk

1. On the computer: set `WALK_API_TOKEN` in `.env`, then `npm run dev` and `npm run tunnel`.
2. Install the build from TestFlight. **Bind the device within 24 hours of the build**, because
   the Plaud token built into it expires after that.
3. In the **Walk** tab, enter the tunnel address and the token. The address changes every time
   the tunnel restarts.
4. Sync the device from Home first, so old recordings are not waiting in the queue.
5. Tap **Start walk**, keep the app open and on screen, and talk.

After the first day, **Refresh Plaud token** in the Walk tab gets a new token from the API.
The tab does this by itself when the token has less than four hours left.

### What to write down

The point of the first tests is to find out how well cutting works. For each walk:

- The **gap** shown on each recording: how long nothing was recording at a cut.
- **Sent … after closing**: how long the Bluetooth sync took. If it is longer than the cut
  interval, chunks queue up and the walk falls behind.
- Whether recordings reach **sent** during the walk or only after **Stop walk**.
- **Slowest transcript** in the server section.
- Anything said across a cut that is missing or garbled in the transcript.

## What is not proven

- **The Swift has never been compiled.** The first workflow run is its first compile.
- **Syncing while recording.** Plaud does not document whether the device will transfer a
  closed recording while it is recording the next. If it will not, every chunk waits until the
  walk ends: nothing is lost, and nothing is gained over one long recording.
- **The gap at each cut.** Expected to be around a second, not measured.
- **Background behaviour.** The cut timer runs while the app is open. The Walk tab keeps the
  screen awake; with the phone locked or the app in the background, cuts will stop.
- **TestFlight accepting Plaud's frameworks.** The starter app is not known to have been
  uploaded to App Store Connect by anyone outside Plaud.

WiFi fast transfer does not work in this build, although its button is still there. A walk syncs
over Bluetooth.
