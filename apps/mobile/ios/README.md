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
5. **Stop walk** asks first, then stops the recording, waits for the last files, and marks the
   walk finished. Stopping from the device's button does the same.

If the device does not confirm a cut, the app leaves it recording and tries again at the next
interval, so the audio ends up in one longer chunk instead of being lost.

### The Walk tab

The tab looks like Home, Files and Settings: the same title, margins and white cards. Top to
bottom:

| Part | What it shows |
|---|---|
| Recorder card | A dot and a few words (Ready, Recording, Recorder out of range, Finishing, Walk finished), the walk time, and one line saying what is happening. Problems are in red. |
| Before you start | Recorder, Server and Plaud sign-in, each with its state in words. Shown when no walk is running. **Start walk** refuses with the first one that is missing. |
| What Groundwork heard | The areas found so far, how many points are left to confirm, the end of the transcript, and **Open on the web**. |
| Recordings | One line per recording: Recording now, Waiting for the recorder, Sending, Sent or Not sent. **Send again** appears when a recording was not sent and its audio is on the phone. |
| Details | Closed until tapped. The server address and token, seconds per recording, the Plaud sign-in, the timings and the log. The fields are locked during a walk. |

The main button stays at the bottom of the screen, above the tab bar: **Start walk**, **Stop
walk**, and while the last files are on their way **Finish without waiting**.

**Open on the web** opens `<server address>/walks/<walk id>` in Safari. That page belongs to
the web app, so the server address has to be the tunnel address or the web address (port 3000).
With the bare API port (4000) as the server address the walk still records, but the link finds
no page.

### When things go wrong during a walk

- **The recorder goes out of range.** After about three seconds out of reach the tab says so.
  The recorder keeps recording by itself and nothing is lost; the walk carries on when it
  reconnects, and a cut that came due in between is made then. The recorder counts as
  connected when the starter says `.connected`, or has a connected device, or the SDK says it
  is connected: the starter's connection state alone lags behind after a reconnect.
- **The phone locks or the app goes to the background.** Cuts are timed on the phone and stop.
  On return, an overdue cut is made at once and the tab says how long the app was away. That
  stretch is one longer recording.
- **The recorder never hands over the last files.** **Finish without waiting** ends the walk.
  Recordings still on the recorder are marked not sent; the audio stays on the recorder, and
  is sent from the Walk tab if the recorder is synced from Home while that walk is still on
  the screen.
- **Stop does not reach the recorder.** The stop is sent twice, six seconds apart, and sent
  again when the recorder reconnects. Until then the tab says the recorder has not stopped.
- **A recording cannot be sent.** It is tried four times, then marked not sent with the
  reason. The walk then ends as "Walk finished, 1 recording not sent", and **Send again**
  sends it, also after the walk has finished. Starting a new walk clears the old one from the
  screen, so the tab asks first when recordings are still unsent.
- **The server cannot be told the walk is over.** The walk still finishes on the phone.
  **Send again** tells the server.

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
3. In the **Walk** tab, open **Details** and enter the tunnel address as the server address,
   and the token. The address changes every time the tunnel restarts. An address typed
   without `https://` is taken to be https.
4. Sync the device from Home first, so old recordings are not waiting in the queue.
5. Check that **Before you start** shows all three in place, tap **Start walk**, keep the app
   open and on screen, and talk.

After the first day, **Renew** beside Plaud sign-in gets a new token from the API. The tab
does this by itself when the token has less than four hours left.

### What to write down

The point of the first tests is to find out how well cutting works. The numbers are under
**Details**, in **Timings**, one line per recording. For each walk:

- **Gap before it**: how long nothing was recording at a cut.
- **Reached the server … after it closed**: how long the Bluetooth sync and the upload took.
  If it is longer than the cut interval, chunks queue up and the walk falls behind.
- Whether recordings reach **Sent** during the walk or only after **Stop walk**.
- **Slowest transcript**, the last line of Timings.
- Anything said across a cut that is missing or garbled in the transcript.
- Anything the tab said about the recorder being out of range or the app being away, with
  the time from the **Log**.

## What is not proven

- **The Swift has never been compiled.** The first workflow run is its first compile.
- **Syncing while recording.** Plaud does not document whether the device will transfer a
  closed recording while it is recording the next. If it will not, every chunk waits until the
  walk ends: nothing is lost, and nothing is gained over one long recording.
- **The gap at each cut.** Expected to be around a second, not measured.
- **Background behaviour.** The cut timer runs while the app is open. The Walk tab keeps the
  screen awake; with the phone locked or the app in the background, cuts will stop, and the
  overdue cut is made when the app comes back. How the recorder and the sync behave across
  that stretch has not been tried.
- **Reconnecting mid-walk.** What the Plaud library does to a sync or a recording when the
  recorder drops out and comes back is not documented. The Walk tab restarts a sync that has
  gone quiet after a reconnect and sends a stop or start that was never answered again; none
  of it has been tried on a recorder.
- **TestFlight accepting Plaud's frameworks.** The starter app is not known to have been
  uploaded to App Store Connect by anyone outside Plaud.

WiFi fast transfer does not work in this build, although its button is still there. A walk syncs
over Bluetooth.
