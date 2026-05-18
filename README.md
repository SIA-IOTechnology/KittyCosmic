# KittyCosmic Intuitive Interface

Modern, web-based GUI for the [KittySploit](https://github.com/kittysploit/kittysploit) framework. KittyCosmic provides a desktop-style browser UI with real-time collaboration, an integrated terminal, workflow editing, and tooling for proxy, VNC, IRC, and marketplace workflows.

**Version:** 1.1.0

## Features

- **KittyOS desktop UI** — Browser-based desktop environment (`/os`) with windows, icons, and themed assets under `src/kittyos_cosmic/`
- **Integrated web terminal** — Runs KittySploit commands through the framework command registry
- **Real-time updates** — Live activity feed, module output streaming, and team chat via Socket.IO
- **Workflow editor** — Visual graph editor for building and running automation workflows
- **Session and workspace management** — Hosts, vulnerabilities, credentials, and workspace data from the KittySploit database
- **IRC bridge** — Connect to IRC networks from the web UI (`src/kittyos_cosmic/irc_bridge.py`)
- **KittyProxy integration** — Manage proxy instances from the interface (`src/kittyos_cosmic/proxy_manager.py`)
- **VNC client** — Remote desktop sessions over WebSocket (`src/kittyos_cosmic/vnc_proxy.py`)
- **Marketplace** — Browse, install, and manage extension modules (`/marketplace`)
- **KittyCollab** — Separate collaboration server on port `5006`
- **XML-RPC API** — Framework API exposed on `http://127.0.0.1:55553/` when the server starts

## Requirements

- **KittySploit** >= 1.0.0 (see `extension.toml` compatibility section)
- **Python 3** with the following packages (install via pip as needed):

  ```bash
  pip install flask flask-socketio flask-cors requests
  ```

  Flask-SocketIO is strongly recommended; without it, live WebSocket features are disabled and the server falls back to plain HTTP.

## Installation

From the KittySploit framework command line, install the extension from the marketplace:

```bash
market install kittycosmic
```

Install Python dependencies if they are not already present (see [Requirements](#requirements)):

```bash
pip install flask flask-socketio flask-cors requests
```

The extension manifest is defined in [`extension.toml`](extension.toml). The entry point is [`src/kittycosmic.py`](src/kittycosmic.py).

For local development, clone this repository and use it from your KittySploit extensions directory, or run [`src/kittycosmic.py`](src/kittycosmic.py) directly inside a KittySploit installation tree.

## Running

### Via KittySploit

Launch the extension through your KittySploit extension manager or the auto-generated `launch_kittycosmic.py` script at the extension root (created on install; ignored by git).

### Standalone (development)

From the repository root, with KittySploit `core/` and `lib/` available on the Python path (typically by running inside a KittySploit installation tree):

```bash
python src/kittycosmic.py
```

On startup, the server prints the URLs to open in your browser. Default main UI:

```
http://127.0.0.1:6223/
```

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `KITTYCOSMIC_HOST` | `127.0.0.1` | Bind address for the web server |
| `KITTYCOSMIC_PORT` | `6223` | HTTP port for the main UI |
| `KITTYCOSMIC_DEBUG` | off | Set to `1`, `true`, or `yes` for verbose Flask logs |

Example:

```bash
KITTYCOSMIC_PORT=8080 python src/kittycosmic.py
```

Stop the server with `Ctrl+C`.

## Project layout

```
KittyCosmic/
├── extension.toml          # Extension manifest
├── LICENSE
├── README.md
└── src/
    ├── kittycosmic.py      # Main Flask application and API routes
    └── kittyos_cosmic/
        ├── templates/      # HTML (os_desktop, marketplace, …)
        ├── static/         # CSS, JS, images
        ├── chat_server.py
        ├── irc_bridge.py
        ├── proxy_manager.py
        └── vnc_proxy.py
```

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 IOTechnology

## Disclaimer

KittyCosmic is a security research and penetration testing tool. Use it only on systems and networks you own or have explicit written authorization to test. The authors are not responsible for misuse.
