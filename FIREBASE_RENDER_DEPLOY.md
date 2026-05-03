# Firebase Hosting + Render Backend

## 1. Deploy backend on Render

1. Push this project to GitHub.
2. In Render, create a new Blueprint or Web Service from the repo.
3. Use:
   - Build command: `npm install`
   - Start command: `npm start`
4. Copy the Render URL, for example:
   `https://client-project-tracker.onrender.com`

## 2. Connect frontend to Render

Open `config.js` and set:

```js
window.APP_CONFIG = {
  API_BASE_URL: "https://your-render-url.onrender.com"
};
```

## 3. Deploy frontend on Firebase Hosting

Install/login once:

```bash
npm install -g firebase-tools
firebase login
```

Then from this folder:

```bash
firebase init hosting
firebase deploy
```

When Firebase asks for the public directory, use:

```text
.
```

Do not overwrite `index.html`.

## Important

This setup is:

- Firebase Hosting: frontend
- Render: backend API
- `db.json`: demo storage on Render

For a real production app, replace `db.json` with Firebase Firestore, Supabase, or PostgreSQL.
