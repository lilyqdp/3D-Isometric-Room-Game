🚀 Build & Run Instructions
📦 Prerequisites

Node.js (v18 or higher recommended)

npm (comes with Node.js)

You can verify installation with:

node -v
npm -v

🛠 Install Dependencies

From the project root directory (isometric-room/), run:

npm install

This will install all required packages, including Three.js and Vite.

If you get an invalid permission error with npm install, try

rm -rf node_modules package-lock.json

Then 'run npm install' again.

▶️ Run the Development Server

Start the local development server with:

npm run dev

You should see output similar to:

VITE vX.X.X ready in XXX ms

➜  Local:   http://localhost:5173/

Open the displayed Local URL in your browser to run the project.
