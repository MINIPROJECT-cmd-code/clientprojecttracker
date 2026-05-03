# Render Deploy

1. Push this folder to a GitHub repository.
2. In Render, choose **New > Blueprint** and connect the repository.
3. Render will read `render.yaml`.
4. Deploy the `client-project-tracker` web service.
5. Open the Render URL after deploy finishes.

Notes:
- The app runs with `npm start`.
- Render provides `PORT` automatically.
- This version stores data in `db.json`. That is okay for a free demo, but a real hosted app should move data to Firebase, Supabase, or PostgreSQL later.
