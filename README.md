🚀 Build & Run Instructions
Prerequisites

Node.js (v18 or higher recommended)

npm (comes with Node.js)

You can check your versions with:

node -v
npm -v
1️⃣ Install Dependencies

From the project root folder (isometric-room/):

npm install

This installs all required packages (Three.js, Vite, etc.).

2️⃣ Run the Development Server
npm run dev

You should see output similar to:

VITE vX.X.X ready in XXX ms
➜  Local:   http://localhost:5173/

Open the displayed local URL in your browser.

3️⃣ Build for Production

To generate an optimized production build:

npm run build

The compiled files will be output to:

dist/
4️⃣ Preview the Production Build (Optional)
npm run preview

This runs a local server to preview the built version.
