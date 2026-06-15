# Quickscope King

A browser-based 1v1 quickscope arena prototype.

## Core idea

- Players join a live queue.
- The current winner stays as champion.
- The next queued player becomes the challenger.
- Each match is first to 3 hits.
- After a match, the winner keeps the court and the loser goes to the back of the queue.

This is built with original placeholder visuals and mechanics inspired by old-school arena sniper duels, without using any copyrighted game assets, names, maps, sounds, or branding.

## Controls

- `WASD` / arrow keys: move
- Mouse: aim
- Hold right mouse: scope in
- Left mouse: shoot
- Quickscope hit window: 120ms to 850ms after scoping

## Run locally

On Windows, double-click:

```text
START_GAME.cmd
```

Or run manually:

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

Open multiple browser tabs or devices on the same network to test the queue and 1v1 system.

Practice mode runs locally in the browser and remains available even if the multiplayer server disconnects.

Online matches can use optional Crown Credit wagers. Crown Credits are fictional,
have no cash value, and reset whenever the server restarts.

## Project structure

```text
quickscope-king/
  server.js              # Node/Express/Socket.IO server and matchmaking
  package.json
  public/
    index.html           # Browser UI
    styles.css           # Game shell styling
    client.js            # Canvas rendering and input
```

## Next upgrade ideas

- Add accounts and permanent leaderboard.
- Add multiple arenas and map voting.
- Add private lobbies.
- Add killcam replay from buffered snapshots.
- Add ranked mode with streak badges.
- Add cosmetics: reticles, gloves, rifle skins, banners.
- Add mobile controls.
- Add anti-cheat validation and server-side replay review.
