# Nyxdesk for Android

Documents, spreadsheets, presentations and PDFs on your phone. Opens `.docx` `.xlsx` `.pptx` `.pdf` `.csv` `.md` `.txt`,
works fully offline, and never sends anything anywhere (the app has **no internet permission**).

It is a small Kotlin app wrapped around the Nyxdesk web app in `web/`. GitHub builds the APK for you — you never
need Android Studio.

## Get the APK (about 5 minutes)

1. **Create a repository** on github.com (New repository → any name → *Create*). Private is fine.
2. **Upload everything in this folder.** On the new repo's page choose **Add file → Upload files**, then drag in
   *everything inside the unzipped folder* (`app`, `web`, `.github`, `build.gradle.kts`, …) and press **Commit changes**.
   * The `.github` folder is hidden on Mac (press **Cmd + Shift + .** in Finder to show hidden files) and on some
     Linux file managers. If you can't see it, skip it and do the step below instead.
   * There are fewer than 100 files, so a single upload works.
3. **If `.github` didn't upload:** on the repo page choose **Add file → Create new file**, type the name
   `.github/workflows/android.yml` (typing the slashes creates the folders), paste the contents of
   `github-workflow-android.yml.txt`, and commit.
4. Open the **Actions** tab. A run called **Build Android app** starts by itself (the first one takes ~5–8 minutes).
   If it didn't start, open it from the left list and press **Run workflow**.
5. When it shows a green tick, open the repo's **Releases** (right-hand side of the front page) →
   **Nyxdesk (latest build)** → download **Nyxdesk.apk**.
   (You can also download it from the finished run under *Artifacts*.)
6. Open the APK on your phone. Android will ask you to allow installing from that source (your browser or files app) —
   allow it. If Play Protect warns that the app is unrecognised, that's because it is signed with a debug key, not
   a Play Store key; choose *Install anyway*.

Every time you change a file in the repo, GitHub rebuilds the APK and replaces the one in Releases.

## What it adds over the website

* **Open with Nyxdesk** — tap a `.docx`, `.xlsx`, `.pptx`, `.pdf`, `.csv` or `.md` in any file manager, mail or chat app.
* **Share → Nyxdesk** from other apps.
* **Open a file** uses Android's own file picker.
* **Save** uses Android's "Save to…" picker, so you choose the folder (Downloads, Drive, …).
* **Print / Save as PDF** through Android's print system.
* Status bar and navigation bar follow the app's light/dark theme.
* Everything is bundled — it runs with no signal and can't make network requests.

* **Back button** closes menus, dialogs and presentations before leaving the tool.
* **Make searchable (PDF)** reads scanned pages on the phone (Google ML Kit, models bundled, no network) — Latin and Hindi.
* **Password-protect PDFs** (AES-256), **sign with your finger**, move/resize/delete marks, Find with highlights.
* Presenting goes full screen and keeps the screen awake; swipe to change slides.

Requires Android 8.0 (API 26) or newer.

## If the build fails

Open the failed run in the **Actions** tab, click the red step, and copy the last 30 lines or so of the log —
that's all that's needed to fix it. (This project was written without being able to compile it on the machine that
produced it, so a first-build hiccup is possible.)

## Layout

```
web/                    the Nyxdesk web app (this is what the phone runs)
app/                    the Android shell (Kotlin): MainActivity.kt, manifest, icon
.github/workflows/      the recipe GitHub uses to build the APK
build.gradle.kts, settings.gradle.kts, gradle.properties
```

Licences for the bundled libraries are in `web/NOTICE.md`.
