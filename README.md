# Local Ledger Desktop: Simple Portfolio Tracking

## Description

Local Ledger Desktop is the desktop build of [Local Ledger](https://github.com/JJanGit/Local-Ledger).

A *simple, 100% local* portfolio tracker.
Same frontend (vanilla JS, jQuery, Bootstrap, Chart.js), wrapped in [Tauri](https://tauri.app/).

Your data is saved automatically and loaded on the next start.
The JSON file lives in the app data directory:

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%\io.github.jjangit.local-ledger-desktop\data\` |
| Linux | WIP |
| macOS | WIP |

## Installation

### Users

Download the build for your platform from the [Releases](https://github.com/JJanGit/Local-Ledger_Desktop/releases) page.

| Platform | Bundles |
| --- | --- |
| Windows | `.exe`, `.msi` |
| Linux | WIP (`.rpm`, `.deb`, `.AppImage`) |
| macOS | WIP (`.dmg`) |

### Devs - Building from source

**Prerequisites:**

- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Node.js](https://nodejs.org/) 22 or newer
- Platform-specific system dependencies, see the [Tauri prerequisites](https://tauri.app/start/prerequisites/)

**Steps:**

1. **Clone the repository:**

   ```bash
   git clone https://github.com/JJanGit/Local-Ledger_Desktop.git
   cd Local-Ledger_Desktop
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Run in development mode:**

   ```bash
   npm run tauri dev
   ```

4. **Build a release bundle:**

   ```bash
   npm run tauri build
   ```

   The bundles are written to `src-tauri/target/release/bundle/`.

## Usage

1. **Start your tracking journey from the ground up:**
   Create your first portfolio with the "Get Started" button.
2. **Or import existing data:**
   Click "Import" to load a JSON file, e.g. one exported from the web version.
