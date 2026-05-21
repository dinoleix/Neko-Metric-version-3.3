# 🐱 Neko Metrics v1.33

> **Comprehensive business metrics dashboard with AI-powered CSV mapping and data uploader.**

[![React](https://img.shields.io/badge/React-19.0.0-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.2-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Firebase](https://img.shields.io/badge/Firebase-11.1.0-FFCA28?logo=firebase)](https://firebase.google.com/)
[![Vite](https://img.shields.io/badge/Vite-latest-646CFF?logo=vite)](https://vitejs.dev/)
[![Gemini AI](https://img.shields.io/badge/Gemini_AI-1.34.0-4285F4?logo=google)](https://ai.google.dev/)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Installation & Local Development](#installation--local-development)
- [Firebase Setup](#firebase-setup)
- [Deployment](#deployment)
- [User Roles & Permissions](#user-roles--permissions)
- [Components Reference](#components-reference)
- [Data Models](#data-models)
- [AI Integration](#ai-integration)
- [Security Rules](#security-rules)
- [Contributing](#contributing)
- [Changelog](#changelog)

---

## Overview

**Neko Metrics** is a full-stack, multi-tenant business operations and analytics platform built for organizations that manage crew members, outlets/branches, sales, expenses, and financial reporting. It combines a modern React/TypeScript SPA with Firebase (Auth + Firestore + Storage) as the backend, and integrates Google Gemini AI for intelligent CSV column mapping during data ingestion.

The application supports three user roles — **Admin**, **Viewer**, and **Crew** — each with fine-grained access through Firestore security rules, enabling safe multi-user collaboration without exposing sensitive data.

---

## Features

### 🔐 Authentication & Role-Based Access Control
- Email/password authentication via **Firebase Auth**
- Three roles: `admin`, `viewer`, `crew`
- Admin can manage users, assign outlets, configure permissions
- Crew members see only their assigned outlet's data
- Viewers have read-only access scoped to their owner

### 📊 Dashboard & Analytics
- **Executive Dashboard** — top-level KPIs, revenue snapshots, trend charts
- **PnL Hub** — Profit & Loss summaries per outlet and time period
- **PnL Analytics** — deep-dive charts and comparisons using Recharts
- **PnL Performance Trends** — time-series trend visualizations
- **Online Profit Center** — e-commerce and online channel revenue tracking
- **Reports** — exportable reports with filtering by date range, outlet, and category

### 💰 Sales & Revenue Management
- **Sales Hub** — primary sales data entry and view
- **Raw Sales Hub** — upload and inspect raw, unprocessed sales records
- **Item Sales Hub** — per-item breakdown of sales quantities and revenue

### 💸 Expense & Cash Flow Tracking
- **Expense Hub** — record and categorize business expenses per outlet/crew
- **Cash Flow Tracker** — monitor inflows, outflows, and net cash position

### 🏦 Bank & Financial Management
- **Bank Management** — manage linked bank accounts per outlet
- **Bank Reconciliation** — reconcile bank statements with internal records
- **Projection Engine / Projection Service** — financial projections and forecasting

### 🗂️ Data Upload & AI Mapping
- **Uploader** — drag-and-drop CSV/file uploader with column preview
- **Gemini AI Integration** — automatically maps uploaded CSV columns to internal schema using Google Gemini
- Supports file types: `sales`, `item`, `expense`, `purchase`, `platform_item`, `online_order`, `customer_mapping`, `bank_statement`

### 👥 Team & Crew Management
- **Team** — view and manage team members
- **Crew Terminal** — crew-facing terminal for recording sales, expenses, and waste
- **Waste Management (v1 & v2)** — log and track waste entries with admin Waste Hub for oversight
- **Holiday Registry** — track employee holidays and time-off

### 🏪 Outlet & Vendor Management
- **User Management** — admin panel to create/edit user profiles and assign outlets
- **Vendor Management** — manage supplier and vendor records
- **Product Catalog** — centralized product and SKU catalogue
- **Category Settings** — configure expense/sales categories
- **Partnership Model** — manage partnership structures and revenue sharing

### 🌤️ Weather Widget
- Integrated **OpenWeatherMap** widget for outlet location weather
- Weather data enriches operational context (e.g., correlating weather with sales)

### 📋 Integrity Audit
- **Integrity Audit** — cross-validates uploaded data against recorded figures to detect discrepancies

### 🏠 Rentals
- **Rentals** — track property/equipment rental income and contracts

### 📦 Data Catalog
- **Data Catalog** — browse and inspect all uploaded datasets within the platform

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend Framework | React | 19.0.0 |
| Language | TypeScript | ~5.8.2 |
| Build Tool | Vite | latest |
| UI Animations | Motion (Framer Motion) | ^12.0.0 |
| Icons | Lucide React | ^0.474.0 |
| Charts | Recharts | ^2.15.0 |
| Backend / Auth | Firebase (Auth + Firestore + Storage) | ^11.1.0 |
| AI / LLM | Google Gemini AI (`@google/genai`) | ^1.34.0 |
| Weather API | OpenWeatherMap REST API | — |
| Hosting | Vercel | — |
| Linter | TypeScript (`tsc --noEmit`) | — |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Vercel (CDN/Hosting)                  │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │            React SPA (Vite + TypeScript)          │    │
│  │                                                   │    │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │    │
│  │  │  Auth    │  │ Dashboard│  │  Data Upload  │  │    │
│  │  │  (Login) │  │ + PnL    │  │  + AI Mapper  │  │    │
│  │  └────┬─────┘  └────┬─────┘  └──────┬────────┘  │    │
│  └───────┼─────────────┼───────────────┼─────────────┘   │
└──────────┼─────────────┼───────────────┼───────────────────┘
           │             │               │
    ┌──────▼──────┐  ┌───▼────────┐  ┌──▼──────────────┐
    │  Firebase   │  │ Firestore  │  │  Gemini AI API  │
    │    Auth     │  │ (Database) │  │  (CSV Mapping)  │
    └─────────────┘  └────────────┘  └─────────────────┘
                          │
                   ┌──────▼──────┐
                   │  Firebase   │
                   │   Storage   │
                   └─────────────┘
```

**Data Flow:**
1. User authenticates via Firebase Auth → receives role + outlet assignment from Firestore `/users/{uid}`
2. React router renders role-appropriate components
3. CSV uploads go to Firebase Storage; Gemini AI maps columns → parsed data written to Firestore
4. All reads/writes are gated by Firestore Security Rules (role checks, owner linkage)
5. Static assets and the SPA are served from Vercel's global CDN

---

## Project Structure

```
Neko-Metric-version-3.3/
├── components/                  # All React UI components
│   ├── BankManagement.tsx       # Bank account management
│   ├── BankReconciliation.tsx   # Bank statement reconciliation
│   ├── CashFlowTracker.tsx      # Cash flow monitoring
│   ├── CategorySettings.tsx     # Expense/sales category config
│   ├── CrewTerminal.tsx         # Crew-facing POS / terminal
│   ├── Dashboard.tsx            # Main executive dashboard
│   ├── DataCatalog.tsx          # Uploaded dataset browser
│   ├── ExecDashboard.tsx        # Executive-level KPI overview
│   ├── ExpenseHub.tsx           # Expense recording & viewing
│   ├── HolidayRegistry.tsx      # Employee holiday tracking
│   ├── IntegrityAudit.tsx       # Data integrity cross-check
│   ├── ItemSalesHub.tsx         # Per-SKU sales breakdown
│   ├── Login.tsx                # Authentication screen
│   ├── OnlineProfitCenter.tsx   # Online channel revenue
│   ├── PartnershipModel.tsx     # Partnership revenue sharing
│   ├── PnlAnalytics.tsx         # PnL deep-dive analytics
│   ├── PnlHub.tsx               # Profit & Loss hub
│   ├── PnlPerformanceTrends.tsx # PnL trend visualizations
│   ├── ProductCatalog.tsx       # Product/SKU catalogue
│   ├── ProjectionEngine.tsx     # Financial projection tool
│   ├── RawSalesHub.tsx          # Raw sales data viewer
│   ├── Rentals.tsx              # Rental income tracking
│   ├── Reports.tsx              # Report generation
│   ├── SalesHub.tsx             # Sales data hub
│   ├── Team.tsx                 # Team member management
│   ├── Uploader.tsx             # CSV/file upload with AI mapping
│   ├── UserManagement.tsx       # Admin user management
│   ├── VendorManagement.tsx     # Vendor/supplier management
│   ├── WasteHub.tsx             # Admin waste overview hub
│   ├── WasteManagement.tsx      # Waste entry logging (v1)
│   ├── WasteManagementV2.tsx    # Enhanced waste management (v2)
│   └── WeatherWidget.tsx        # OpenWeatherMap widget
│
├── App.tsx                      # Root component, auth state, routing
├── firebase.ts                  # Firebase app initialization
├── geminiService.ts             # Google Gemini AI service (CSV column mapping)
├── projectionService.ts         # Financial projection calculation service
├── weatherService.ts            # OpenWeatherMap API service
├── types.ts                     # All TypeScript interfaces & type definitions
├── index.tsx                    # React DOM entry point
├── index.html                   # HTML shell
│
├── firebase.json                # Firebase Hosting config
├── firebase-blueprint.json      # Firebase project blueprint
├── firestore.rules              # Firestore security rules
├── firestore.indexes.json       # Firestore composite indexes
├── .firebaserc                  # Firebase project alias
│
├── metadata.json                # App metadata (name, description, permissions)
├── vercel.json                  # Vercel deployment config (SPA rewrites)
├── vite.config.ts               # Vite build configuration
├── tsconfig.json                # TypeScript compiler config
├── package.json                 # NPM dependencies and scripts
├── .env.example                 # Environment variable template
└── .gitignore                   # Git ignore rules
```

---

## Prerequisites

- **Node.js** v18+ (v20 LTS recommended)
- **npm** v9+ or **yarn**
- A **Firebase** project (Firestore, Auth, Storage enabled)
- A **Google Gemini API key** (from [Google AI Studio](https://aistudio.google.com/))
- *(Optional)* An **OpenWeatherMap API key** for the weather widget

---

## Environment Setup

Copy `.env.example` to `.env.local` and fill in your credentials:

```bash
cp .env.example .env.local
```

```env
# OpenWeatherMap API Key for weather integration
VITE_OPENWEATHER_API_KEY=your_openweathermap_api_key

# Google Gemini AI API Key
VITE_GEMINI_API_KEY=your_gemini_api_key

# Firebase Configuration (get from Firebase Console > Project Settings)
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

> ⚠️ **Never commit `.env.local`** — it is listed in `.gitignore`. Only commit `.env.example` with placeholder values.

---

## Installation & Local Development

```bash
# 1. Clone the repository
git clone https://github.com/dinoleix/Neko-Metric-version-3.3.git
cd Neko-Metric-version-3.3

# 2. Install dependencies
npm install

# 3. Set up environment variables (see above)
cp .env.example .env.local
# Edit .env.local with your keys

# 4. Start the development server
npm run dev
```

The app will be available at `http://localhost:5173` by default.

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Production build (TypeScript check + Vite bundle) |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run TypeScript type checker (`tsc --noEmit`) |

---

## Firebase Setup

### 1. Create a Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project
3. Enable **Authentication** (Email/Password provider)
4. Enable **Cloud Firestore** (start in production mode)
5. Enable **Firebase Storage**

### 2. Deploy Firestore Security Rules
```bash
npm install -g firebase-tools
firebase login
firebase use --add   # select your project
firebase deploy --only firestore:rules
```

### 3. Deploy Firestore Indexes
```bash
firebase deploy --only firestore:indexes
```

### 4. Create the First Admin User
After deploying, create a user through Firebase Auth Console, then manually set their Firestore document at `/users/{uid}`:
```json
{
  "uid": "their-uid",
  "email": "admin@example.com",
  "role": "admin",
  "createdAt": 1700000000000
}
```

---

## Deployment

### Vercel (Recommended)

The project includes a `vercel.json` that handles SPA client-side routing rewrites automatically.

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# Production deploy
vercel --prod
```

Set all `VITE_*` environment variables in your Vercel project dashboard under **Settings → Environment Variables**.

### Firebase Hosting (Alternative)

```bash
npm run build
firebase deploy --only hosting
```

---

## User Roles & Permissions

| Permission | Admin | Viewer | Crew |
|-----------|-------|--------|------|
| View dashboard & analytics | ✅ | ✅ | ❌ |
| Upload CSV data | ✅ | ❌ | ❌ |
| Record sales / expenses (Crew Terminal) | ✅ | ❌ | ✅ |
| Manage users | ✅ | ❌ | ❌ |
| Bank reconciliation | ✅ | ✅ | ❌ |
| View PnL / reports | ✅ | ✅ | ❌ |
| Waste management | ✅ | ❌ | ✅ |
| Category / vendor settings | ✅ | ❌ | ❌ |
| Data catalog | ✅ | ✅ | ❌ |

Viewers are linked to an admin owner via `ownerId` in their user profile, restricting their reads to only that admin's documents.

---

## Components Reference

### Core Components

| Component | Description |
|-----------|-------------|
| `App.tsx` | Root: Firebase auth listener, role-based view routing, global state |
| `Login.tsx` | Firebase email/password sign-in form |
| `Dashboard.tsx` | Main dashboard with outlet selector and KPI cards |
| `ExecDashboard.tsx` | Executive summary dashboard |

### Financial & Sales

| Component | Description |
|-----------|-------------|
| `SalesHub.tsx` | View and manage sales records |
| `RawSalesHub.tsx` | Browse raw uploaded sales data |
| `ItemSalesHub.tsx` | Per-SKU sales breakdown |
| `ExpenseHub.tsx` | Expense entry, categorization, and viewing |
| `CashFlowTracker.tsx` | Cash flow in/out tracking |
| `BankManagement.tsx` | Bank account CRUD |
| `BankReconciliation.tsx` | Reconcile bank statements with records |
| `OnlineProfitCenter.tsx` | Online channel revenue tracking |
| `PnlHub.tsx` | P&L summary by outlet and period |
| `PnlAnalytics.tsx` | P&L charts and comparisons |
| `PnlPerformanceTrends.tsx` | P&L time-series trends |
| `ProjectionEngine.tsx` | Revenue/cost projections and forecasting |
| `Reports.tsx` | Filterable report generation |

### Operations

| Component | Description |
|-----------|-------------|
| `CrewTerminal.tsx` | Crew POS terminal: record sales, expenses, waste |
| `WasteManagement.tsx` | Waste logging for crew (v1) |
| `WasteManagementV2.tsx` | Enhanced waste logging with categories (v2) |
| `WasteHub.tsx` | Admin overview of all waste entries |
| `HolidayRegistry.tsx` | Employee holiday and leave tracking |
| `Rentals.tsx` | Rental income and contract management |
| `Team.tsx` | Team member directory and management |

### Data & Configuration

| Component | Description |
|-----------|-------------|
| `Uploader.tsx` | Drag-and-drop CSV uploader with Gemini AI column mapping |
| `DataCatalog.tsx` | Browse all uploaded datasets |
| `IntegrityAudit.tsx` | Cross-validate data for discrepancies |
| `ProductCatalog.tsx` | Product/SKU catalogue management |
| `VendorManagement.tsx` | Supplier and vendor records |
| `CategorySettings.tsx` | Configure expense and sales categories |
| `PartnershipModel.tsx` | Partnership revenue sharing config |
| `UserManagement.tsx` | Admin: create, edit, assign users |
| `WeatherWidget.tsx` | Live weather display (OpenWeatherMap) |

---

## Data Models

### UserProfile
```typescript
interface UserProfile {
  uid: string;
  email: string;
  role: 'admin' | 'viewer' | 'crew';
  createdAt: number;
  assignedOutlet?: string;
  ownerId?: string;
}
```

### BillItem
```typescript
interface BillItem {
  productId: string;
  productName: string;
  quantity: number;
  pricePerUnit: number;
  amount: number;
}
```

### FileType
```typescript
type FileType =
  | 'sales' | 'item' | 'expense' | 'purchase'
  | 'platform_item' | 'online_order'
  | 'customer_mapping' | 'bank_statement';
```

### EntryStatus
```typescript
type EntryStatus = 'paid' | 'pending' | 'cancelled';
```

> The full type definitions with all interfaces are in `types.ts` (812 lines, 20.8 KB).

---

## AI Integration

Neko Metrics uses **Google Gemini AI** (`@google/genai`) to power the CSV column mapping feature in the Uploader component.

### How It Works

1. User uploads a CSV file and selects the file type (e.g., `sales`, `expense`)
2. The `Uploader` component extracts the CSV headers and sends them to `geminiService.ts`
3. `getGeminiAI()` initializes the Gemini client using `VITE_GEMINI_API_KEY`
4. A structured prompt asks Gemini to map the CSV columns to the expected internal schema
5. Gemini returns a JSON mapping object; the app uses this to transform and import the data

### Configuration
```typescript
// geminiService.ts
import { GoogleGenAI } from "@google/genai";
// API key resolved from VITE_GEMINI_API_KEY env variable
```

If `VITE_GEMINI_API_KEY` is not set, the service throws a descriptive error.

---

## Security Rules

Firestore security rules (`firestore.rules`) enforce:

- **`isAuthenticated()`** — user must be signed in for any read/write
- **`isAdmin()`** — user's `/users/{uid}.role == 'admin'`
- **`isDocOwner()`** — `request.auth.uid == resource.data.userId`
- **`isLinkedToOwner()`** — viewer/crew reads documents where their `ownerId` matches
- **`canRead()`** — `isDocOwner() || isLinkedToOwner()`

These rules are applied across all Firestore collections to ensure data isolation between tenants/outlets.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature-name`
3. Commit using the convention: `feat: description` / `fix: description`
4. Push and open a Pull Request against `main`

### Commit Message Convention

| Prefix | Usage |
|--------|-------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `refactor:` | Code refactoring |
| `docs:` | Documentation update |
| `chore:` | Dependency updates, config |

---

## Changelog

> ⚠️ **README Preservation Notice:** This README is maintained manually and should **not** be auto-overwritten by CI/CD pipelines or automated commits. To protect it, add this guard to your GitHub Actions workflow:

```yaml
# .github/workflows/deploy.yml
- name: Protect README from auto-overwrite
  run: |
    if git diff --name-only HEAD~1 | grep -q "^README.md$"; then
      echo "WARNING: README.md was modified. Please verify this was intentional."
    fi
```

| Version | Date | Notes |
|---------|------|-------|
| 1.33 | 2026-05-21 | Full README rewrite — detailed docs, all components, AI integration, security, contributing guide |
| — | — | Previous README was the default Google AI Studio template |

---

<div align="center">

Built with ❤️ by **dinoleix** · Powered by React, Firebase & Gemini AI

</div>
