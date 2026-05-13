# 3D Isometric Room Game

**Group 10**
Lily Del Pilar · Zixin Zheng · Colin Francis · Nikhil Jadav

🎮 **Live Demo:** https://3-d-isometric-room-game.vercel.app/
📁 **Source Code:** https://github.com/lilyqdp/3D-Isometric-Room-Game
🎬 **Final Demo Video:** https://vimeo.com/1191606077

---

## Project Overview

3D Isometric Room is an interactive browser-based game built entirely in Three.js. The player cleans a messy dorm-style bedroom by sorting trash and laundry into the correct bins — but their cat is constantly getting in the way. The cat navigates the room autonomously, jumps onto furniture, and creates pressure on the player throughout the game.

The project evolved from a visual room prototype into a complete game loop with a start menu, two game modes, win/loss states, player tools, UI support screens, and a custom room editor.

---

## How to Play

**Casual Mode:** A fixed set of laundry and trash items are pre-spawned across the room. Sort them all before the mess meter maxes out — or before the cat knocks the cup off the desk. Get the mess meter to zero to win.

**Endless Mode:** Trash and laundry spawn continuously. There is no win condition — survive as long as you can and sort as many items as possible before the mess gets out of hand.

**Player Tools:**
- **Place Catnip** — lures the cat away from the desk temporarily
- **Open Window** — sends the cat to the window sill for a period of time, giving you a safe window to clean

---

## CG Pillars

### 1. AI & Pathfinding
The cat uses a custom Recast/Detour NavMesh pathfinding system that supports multiple walkable surfaces. Jump links between surfaces are automatically computed based on geometry — factoring in height differences and distances. The cat plans routes across this surface graph, reacts to dynamic obstacles like laundry and trash, and recovers from blocked paths in real time.

### 2. Animation
The cat has a full set of animation clips — locomotion, jump up, jump down, sitting, swiping, and catnip-eating behaviors. Custom logic selects, sequences, blends, and times animations based on every situation the cat can be in. Transitions are timed so landing frames align cleanly with surface contact and behavioral state changes.

---

## Room & Environment

Every object in the room — bed, wardrobe, bookcase, desk, rug, curtains, plants, lamp, posters — was built entirely from code using Three.js `BoxGeometry`, `CylinderGeometry`, and `SphereGeometry`. No external 3D model files were used for the environment. All furniture is constructed from combinations of geometry primitives carefully positioned and colored together.

---

## Build & Run Instructions

### Prerequisites
- Node.js (v18 or higher recommended)
- npm (comes with Node.js)

Verify your installation:
```bash
node -v
npm -v
```

### Install Dependencies

From the project root directory (`isometric-room/`), run:
```bash
npm install
```

> If you get a permission error, try:
> ```bash
> rm -rf node_modules
> npm install
> ```

### Run the Development Server

```bash
npm run dev
```

Open the local Vite URL shown in the terminal, usually: http://localhost:5173/

---

## Room Editor

The project includes a built-in room editor accessible from the main menu. It allows furniture to be moved, rotated, and repositioned within the room. It was used primarily during development for layout tuning.

---

## AI Tool Usage

AI tools (specifically ChatGPT Codex and ChatGPT) were used for a significant portion of code generation throughout the project, with small targeted changes at a time. We found that AI works reliably for isolated logic and small edits, but struggled with large refactors — often breaking unrelated parts of the codebase in the process. We also found that AI is particularly good at generating debugging tools quickly, which was extremely valuable during development. Usage was limited by Codex rate limits, which became more restrictive as the project grew larger.
