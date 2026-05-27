# OpsCore

### Internal Operations Management System

> A real-time, role-aware platform for centralizing workflows, accountability, and reporting across chapter-based organizations — built as a single-file SPA with Firebase and vanilla JS.

---

## Overview

OpsCore replaces the fragmented spreadsheets, group chats, and paper sign-in sheets that most chapter-based organizations depend on. It gives officers real-time visibility into attendance, finances, tasks, recruitment, and compliance from a single, role-aware interface.

Built without any frontend framework — no React, no Vue, no Bootstrap — to demonstrate that clean architecture and a usable product don't require a heavy stack.

---

## Live Demo

> **Email:** `demo@opscore.app` · **Password:** `demo1234`

Loads a full set of realistic sample data. No Firebase account needed.

---

## Features

| Module | Description |
|---|---|
| **Executive Dashboard** | Live KPIs, org health scorecard, attendance ring chart, and alert engine |
| **Attendance Tracking** | Per-event mark sheets with running averages and at-risk flagging |
| **Task & Goal Management** | Kanban + list view with priorities, due dates, and assignees |
| **Finance Module** | Dues, fines, expenses, budget allocation, and payment plans across five sub-views |
| **Recruitment CRM** | Full pipeline from First Contact → Offer Accepted with prospect scoring |
| **Compliance Review** | Case management with hearing dates, resolution tracking, and audit trail |
| **Analytics** | Cross-module charts: attendance trends, task completion, and GPA distribution |
| **Health Scorecard** | Weighted composite score across 5 operational dimensions |
| **Calendar** | Monthly grid view with multi-type event pips and upcoming event countdown |
| **Meeting Notes** | Structured officer report system with print/export |
| **Event Safety** | Shift scheduling with assignment tracking and confirmation status |
| **Academics** | GPA tracking per member with trend comparison and risk flags |
| **Global Search** | `⌘K` search across members, tasks, events, notes, cases, files, and more |
| **Committees** | Builder with chair assignment and member roster |
| **Philanthropy** | Service hour logging and fundraising goal tracking |
| **Alumni Relations** | Contact CRM with engagement tracking and event management |
| **Leadership Development** | Program milestone tracking and new member progress system |
| **Transition Hub** | Officer handoff documentation and deadline management |
| **File Management** | Folder-organized document repository with SOP/playbook support |
| **Authentication** | Firebase Auth with role-based session management and 4-hour inactivity timeout |
| **Role-Based Access** | Page-level access control across 10+ officer roles |
| **Settings** | Per-user preferences, org configuration, and notification toggles |

---

## Tech Stack

| Layer | Details |
|---|---|
| **Frontend** | Vanilla HTML5, CSS3, JavaScript (ES2022+) |
| **Design System** | Custom CSS with variables and DM Sans typeface — no Bootstrap, no Tailwind |
| **Icons** | Tabler Icons webfont (3,800+ icons) |
| **Auth** | Firebase Authentication (email/password) |
| **Database** | Cloud Firestore with real-time `onSnapshot` listeners |
| **Security** | Firebase Security Rules enforce server-side access control |
| **Offline Support** | `localStorage` cache with automatic sync on reconnect |
| **Hosting** | Vercel (zero-config static deploy) |
| **Build** | None — no bundler, no compiler, no framework overhead |

---

## Architecture

### Data Flow

```
Firebase Auth → onAuthStateChanged → Firestore onSnapshot → D{} (in-memory store) → render*()
                                                          ↓
                                                localStorage (offline cache)
```

### Role-Based Access Control

On login, the RBAC engine reads the user's `role` from Firestore, resolves their allowed page set from a `ROLE_ACCESS` map, and hides or blocks any unauthorized routes. Write operations are disabled for read-only roles.

Client-side RBAC handles UI gating; all data access is enforced by Firebase Security Rules at the backend — the two work together.

### Real-Time Sync

All collections use `onSnapshot` listeners. A change on one device instantly re-renders on every connected session. A debounced write queue prevents race conditions during rapid saves.

### Offline-First

Every save writes to `localStorage` first. When Firebase is unavailable, the app operates from cache. On reconnect, a full Firestore sync triggers automatically.

---

## Key Technical Challenges

**Complex dashboard aggregation without a state manager.** `renderDash()` computes 15+ live metrics — attendance averages, task rates, overdue counts, health score weights, upcoming events, at-risk members — in a single pass over the in-memory `D` store, keeping rendering fast without a dedicated state management library.

**Multi-view Finance module under one route.** Five distinct sub-views (Dues, National Dues, Fines, Budget, Payment Plans) each have independent CRUD flows while sharing one Firestore data model and one URL path.

**Responsive layout without a CSS framework.** The entire layout uses CSS Grid and Flexbox with breakpoints at 768px and 400px. A tightly scoped design system with CSS custom properties keeps styles consistent without any external library.

**Global search across 10+ collections.** `⌘K` triggers a multi-collection search returning grouped, keyboard-navigable results with highlighted matches — no search backend, no index, just filtered in-memory queries.

---

## Project Structure

```
ops_platform_portfolio.html   — Complete single-file SPA (~5,000+ lines)
README.md                     — This file
```

This is intentionally a single-file application. In a production team environment, this would be split into separate JS modules per feature domain. The single-file structure was a deliberate constraint to demonstrate that complex systems can be architected cleanly without a build toolchain.

---

## Setup & Deployment

### Running Locally

```bash
# No build step required
open ops_platform_portfolio.html

# Or serve with any static file server:
npx serve .
```

### Connecting Your Own Firebase Project

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Email/Password** authentication
3. Create a **Firestore** database in production mode
4. Replace the `firebaseConfig` in the `<script type="module">` block:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000"
};
```

5. Create a document at `organizations/demo_org` in Firestore to initialize the data store
6. Create user accounts in Firebase Auth and assign each a `role` field at `Firestore → users/{uid}`
7. Configure Firebase Security Rules to match your role structure — see the [Firestore Security Rules docs](https://firebase.google.com/docs/firestore/security/get-started)

### Deploying to Vercel

```bash
# 1. Go to vercel.com → "Add New Project"
# 2. Import your repository or drop the project folder
# Live in under 60 seconds — no config needed
```

---

## Purpose

This project came from a real operational problem: organizations trying to manage 30–60 people across 12+ disconnected tools — Google Sheets for tracking, GroupMe for communication, paper for sign-ins.

OpsCore consolidates accountability, communication, finance, and talent management into one role-aware platform any officer can use without training. Development used AI-assisted workflows for rapid prototyping and iteration, with all architecture, design decisions, and implementation owned and reviewed by the author.

---

## Author

Built as a portfolio capstone project demonstrating systems architecture, UX design, and real-time application development.

**Core skills demonstrated:**
Systems design · Firebase integration · Role-based access control · Real-time data sync · Single-page application architecture · Financial systems design · CRM development · Responsive UI without frameworks
