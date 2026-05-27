# OpsCore

**Internal Operations Management System**

A role-aware web application for managing the day-to-day operations of a chapter-based organization — built with vanilla HTML, CSS, and JavaScript using Firebase for authentication and real-time data sync.

---

## Overview

OpsCore started as a solution to a real problem: organizations trying to manage 40+ members across a dozen disconnected tools — spreadsheets for attendance, group chats for task tracking, paper sign-in sheets at events.

The goal was to build one place where officers could track attendance, assign tasks, manage finances, run recruitment, and see how the chapter was performing — without needing training to use it.

Built without any frontend framework to keep things simple and direct. No React, no Vue, no build tools.

---

## Live Demo

> **Email:** `demo@opscore.app` · **Password:** `demo1234`

Loads a full set of sample data. No Firebase account required.

---

## Features

| Module | Description |
|---|---|
| **Dashboard** | Live KPIs, org health score, attendance chart, and active alerts |
| **Attendance** | Per-event mark sheets with running rates and at-risk member flags |
| **Tasks & Goals** | Kanban board with priorities, due dates, and member assignment |
| **Finance** | Dues, fines, expenses, budget tracking, and payment plans across five views |
| **Recruitment CRM** | Pipeline from first contact to accepted offer with prospect scoring |
| **Compliance Review** | Case management with hearing dates, resolution notes, and status tracking |
| **Analytics** | Attendance trends, task completion rates, and GPA distribution charts |
| **Health Scorecard** | Weighted score across five operational areas |
| **Calendar** | Monthly grid with event categories and upcoming event countdown |
| **Meeting Notes** | Structured officer report builder with print support |
| **Event Safety** | Shift scheduling with assignment and confirmation tracking |
| **Academics** | GPA records with trend tracking and warning flags |
| **Global Search** | Full-app search across members, tasks, events, notes, and more |
| **Committees** | Committee builder with chair assignment and member roster |
| **Philanthropy** | Service hour logging and fundraising goal tracking |
| **Alumni Relations** | Contact log with engagement history and event management |
| **Leadership Development** | Program milestone and new member progress tracking |
| **Transition Hub** | Officer handoff documentation and deadline tracking |
| **File Management** | Folder-organized document repository |
| **Authentication** | Firebase Auth with role-based sessions and inactivity timeout |
| **Role-Based Access** | Page-level access control across 10+ officer roles |
| **Settings** | User preferences, org configuration, and notification toggles |

---

## Tech Stack

| Layer | Details |
|---|---|
| **Frontend** | HTML5, CSS3, JavaScript (ES2022+) |
| **Styling** | Custom CSS with variables — no Bootstrap, no Tailwind |
| **Icons** | Tabler Icons |
| **Auth** | Firebase Authentication (email/password) |
| **Database** | Cloud Firestore with real-time listeners |
| **Offline** | localStorage cache — app stays usable when disconnected |
| **Hosting** | Vercel (static deploy, no config needed) |
| **Build** | None |

---

## How It Works

### Data Flow

```
Firebase Auth → onAuthStateChanged → Firestore onSnapshot → D{} (in-memory store) → render*()
                                                          ↓
                                                localStorage (offline cache)
```

When a user logs in, the app loads their data from Firestore into a single in-memory `D` object. All page renders pull from `D` directly, so switching between views is instant. Changes write back to Firestore and update `localStorage` as a fallback for offline use.

### Role-Based Access

Each user has a `role` field in Firestore. On login, the app maps that role to a set of allowed pages and hides anything outside that set. Read-only roles can view data but can't submit changes. The UI enforces this, and Firebase Security Rules enforce it at the data level independently.

### Real-Time Sync

Firestore `onSnapshot` listeners keep every open session in sync. A debounced write queue prevents conflicts when saves happen quickly back-to-back.

---

## A Few Technical Notes

**Dashboard aggregation.** `renderDash()` computes 15+ metrics in a single pass over the data store — attendance averages, task completion rates, at-risk members, event countdowns, health score weights — without any state management library. It's just organized vanilla JS.

**Finance module.** Five distinct sub-views (Dues, National Dues, Fines, Budget, Payment Plans) share one Firestore data model under a single route, each with their own CRUD flows and filtered views.

**Global search.** Searches across 10+ data types simultaneously, groups results by category, highlights matches, and is keyboard-navigable. Runs entirely in-memory against the `D` store — no search backend.

**Responsive layout.** The full layout uses CSS Grid and Flexbox with breakpoints at 1100px, 768px, and 400px. CSS custom properties handle the design system without an external library.

---

## Project Structure

```
opscore/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── firebase-config.js   ← Demo mode toggle + Firebase setup
│   ├── utils.js             ← Shared helpers (date formatting, toasts, modals, etc.)
│   ├── auth.js              ← Login, RBAC, session management, app init
│   ├── dashboard.js         ← Dashboard page renderer
│   ├── calendar.js          ← Calendar page renderer
│   ├── tasks.js             ← Tasks, goals, and meeting notes
│   ├── members.js           ← Members, committees, analytics, sober schedule
│   └── app.js               ← Firebase sync, CRUD handlers, all remaining pages
└── assets/
    ├── images/
    └── screenshots/
```

---

## Setup

### Running Locally

```bash
# No build step required — just open with Live Server
# (VS Code Live Server extension works fine)
```

### Connecting Firebase

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Email/Password** authentication
3. Create a **Firestore** database
4. In `js/firebase-config.js`, set `_IS_DEMO = false` and fill in your config:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000000000"
};
```

5. Initialize a document at `organizations/demo_org` in Firestore
6. Create user accounts in Firebase Auth and add a `role` field at `users/{uid}` in Firestore
7. Set up Firebase Security Rules to match your role structure — see the [Firestore Security Rules docs](https://firebase.google.com/docs/firestore/security/get-started)

### Deploying to Vercel

```bash
# Push to GitHub, then connect the repo at vercel.com
# No configuration needed — it deploys as a static site
```

---

## Why I Built This

I've been involved in organizations that manage a lot of moving parts — event attendance, dues collection, recruitment pipelines, officer accountability — and watched them try to hold it all together with a mix of spreadsheets, group chats, and memory.

I wanted to build something that actually solved that problem: a single place where any officer could log in, see what needs attention, and take action without having to dig through five different tools first. The role-based access was important because not everyone should see compliance records or full financial data — that's a real operational concern, not just a technical exercise.

This project reflects the kind of systems thinking I want to keep developing: understanding the operational problem first, then designing the data model and interface around how the organization actually works.

---

## Author

Built as a portfolio project for an MIS/Business Technology program.

**Skills demonstrated:** Web application development · Firebase integration · Role-based access control · Real-time data sync · Financial systems · CRM design · Responsive UI · Vanilla JavaScript architecture
