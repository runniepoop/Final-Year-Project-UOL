# Final-Year-Project-UOL
Care: A Simulation
# Care: A Simulation

A real-time, two-player mobile app that trains **caregiver communication**. On two phones, a **caretaker** who sees a task clearly guides a **patient** whose screen simulates a sensory or motor impairment, across four minigames: **vision loss**, **hearing loss**, **motor difficulty**, and **speech difficulty**.

Built with **React Native (Expo)** on the client and a lightweight **Node.js + Express + Socket.IO** relay server. The two phones pair into a room and the server relays messages between them; all game logic lives in the app.

> CM3070 Final Year Project · CM3055 Interaction Design template, "An Online Empathy Simulation for Caregivers".

---

## Repository layout

```
.
├── care-server/     # Node.js + Socket.IO relay server
│   └── server.js
└── care-app/        # React Native (Expo) client (one codebase, both roles)
    ├── App.js
    └── assets/items/ # object images used in the vision minigame
```

---

## Requirements

- **Node.js 18 or newer** (includes npm) — https://nodejs.org
- The **Expo Go** app on two phones (App Store / Google Play)
- A laptop and both phones on the **same Wi-Fi network**

---

## 1. Set up and run the server (`care-server`)

Open a terminal in the `care-server` folder:

```bash
cd care-server
npm install       # first time only, installs dependencies
npm start         # starts the relay server
```

You should see:

```
Care relay server listening on port 3001
```

Leave this terminal running.

---

## 2. Find your laptop's local IP address

The phones reach the server by its address on your Wi-Fi (not `localhost`).

- **Windows:** run `ipconfig` and read the **IPv4 Address** (e.g. `192.168.1.42`)
- **macOS:** run `ipconfig getifaddr en0`
- **Linux:** run `hostname -I` and take the first address

Note this address. It usually changes when the laptop restarts or rejoins Wi-Fi, so re-check it each session.

---

## 3. Set up and run the app (`care-app`)

In `care-app/App.js`, near the top, set `SERVER_URL` to your laptop's IP from step 2:

```js
const SERVER_URL = "http://192.168.1.42:3001";   // <-- your laptop's IP, port 3001
```

Then, in a **second** terminal in the `care-app` folder:

```bash
cd care-app
npm install       # first time only
npx expo start -c # start Expo (the -c clears the cache)
```

A QR code appears in the terminal.

---

## 4. Play on two phones

1. On each phone, open **Expo Go** and scan the QR code (both phones on the same Wi-Fi as the laptop).
2. On one phone choose **Caretaker**, on the other choose **Patient**.
3. Both pick the **same scenario** to meet in the same room, then follow the on-screen rules.

The status pill in the top bar shows **connected** once both phones are paired.

---

## Troubleshooting

- **"Project is incompatible with this version of Expo Go"** — the project's Expo SDK and the installed Expo Go must match. Align them with `npx expo install expo@^SDK_VERSION --fix` in `care-app`, then `npx expo start -c`.
- **Phones say "can't reach server" / status stays offline** — `SERVER_URL` does not match the laptop's current IP, the server terminal is not running, or the devices are on different networks. Re-check the IP (step 2), confirm `npm start` is running, and make sure everything is on the same Wi-Fi.
- **Vision images do not appear** — confirm the six object PNGs are in `care-app/assets/items/` with the exact filenames referenced in `App.js`.
- **Nothing updates on the other phone** — both roles must be filled in the *same* scenario; the server must have been (re)started after any change to `server.js`.

---

## How it works (brief)

- `care-server/server.js` pairs two devices into a named room (the scenario id), allows one caretaker and one patient per room, and relays every `action` message to the partner. It holds no game logic.
- `care-app/App.js` renders the caretaker or patient interface from the chosen role, applies the impairment on the patient's side, and drives each minigame over the shared message channel.

## Licence and assets

The object images in `care-app/assets/items/` were sourced from CleanPNG (https://www.cleanpng.com/) and used for this non-commercial, educational project. This repository is submitted as part of a university final-year project.