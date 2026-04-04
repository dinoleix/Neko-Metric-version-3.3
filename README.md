# 🐾 Neko Metrics
### Precision Intelligence for the Modern Outlet

Neko Metrics is a sophisticated, full-stack business intelligence suite that transforms raw operational data into actionable executive insights. Built with a "Neko" (Cat) aesthetic — symbolizing agility, precision, and sharp vision — this platform gives outlet owners a 360° view of financial health, inventory integrity, and team performance.

---

## 💎 The Executive Experience

Neko Metrics moves far beyond simple spreadsheets. It is an **Audit-First** ecosystem that reconciles *what should happen* against *what actually happens* in your business — surfacing leakage, waste, and opportunity in real time.

---

## 🚀 Core Feature Pillars

### 🔍 The Waste Radar (v2)

The crown jewel of Neko Metrics — a multi-pillar **Material Reconciliation Engine**.

- **Theoretical Burn Calculation:** The system leverages granular daily sales data (`dailyTrend[31]`) to compute exactly how much of each ingredient should have been consumed for any given period — down to the week.
- - **Actual Consumption Tracking:** Purchase and expense uploads feed into monthly snapshots, giving a real-time view of what was actually spent.
  - - **Leakage Signal:** The delta between theoretical and actual consumption is your net profit drain — visualized instantly so you can act before the month ends.
    - - **Real-Time Monitoring:** Check the Waste Radar every Monday. If leakage is 15% after Week 1, you know you have a problem immediately — not at month's end.
      - - **The Granularity Advantage:** Sales are tracked daily across 31 slots, meaning theoretical consumption can be scoped to any specific week. This unlocks early-warning detection that monthly-only systems simply cannot provide.
       
        - ### 📊 Executive Command Center
       
        - A high-density dashboard providing:
        - - Real-time P&L snapshots across all outlets
          - - Gross revenue trends with period-over-period comparison
            - - Margin analysis with contribution breakdowns
              - - Multi-outlet consolidation in a single view
               
                - ### 📱 The Crew Terminal
               
                - A specialized, mobile-first interface for on-ground staff:
                - - Instant purchase and expense logging from any device
                  - - Ensures data integrity starts at the source
                    - - Designed for speed — minimal taps to critical actions
                     
                      - ### 💰 Financial Integrity Suite
                     
                      - - **PnL Analytics Engine** — comprehensive profit & loss with trend modeling
                        - - **Bank Management** — balance tracking and reconciliation
                          - - **Integrity Audit Module** — anomaly detection in sales records to flag suspicious entries before they distort your reporting
                           
                            - ### 👥 Team & Resource Hub
                           
                            - - **Payroll Management** — track staff costs integrated with P&L
                              - - **Store Rental Tracking** — fixed-cost visibility baked into margin calculations
                                - - **Holiday Registry** — factor closures into projections and averages automatically
                                 
                                  - ---

                                  ## 🧠 AI & Predictive Intelligence

                                  We don't just look at the past — we predict the future. Powered by **Google Gemini 1.5 Flash**, Neko Metrics brings AI-native intelligence to outlet operations:

                                  | Feature | Description |
                                  |---|---|
                                  | 🔮 **Predictive Revenue** | Analyzes historical trends, upcoming holidays, and local weather to project future revenue with confidence scores |
                                  | 📝 **Automated Insights** | AI-generated narratives explain *why* margins are shifting — e.g., "Weather: Rain" or "Holiday: Holi" as variance drivers |
                                  | 🗂️ **Smart SKU Normalization** | Intelligently maps fragmented menu items from Zomato, Swiggy, and POS systems into a unified Master SKU for accurate auditing |
                                  | 📈 **Trend Extrapolation** | Projects week-over-week and month-over-month trajectories so you can course-correct proactively |

                                  ---

                                  ## 🛠 Tech Stack

                                  | Layer | Technology | Purpose |
                                  |---|---|---|
                                  | Frontend | React 19 + Vite | Lightning-fast reactive UI |
                                  | Language | TypeScript | Type-safe, maintainable codebase |
                                  | Styling | Tailwind CSS | High-density, utility-first design system |
                                  | Animations | Motion (Framer) | Fluid transitions & tactile feedback |
                                  | Backend | Firebase Firestore | Serverless, real-time data backbone |
                                  | Auth | Firebase Auth | Secure, multi-outlet access control |
                                  | Storage | Firebase Storage | Expense & document uploads |
                                  | AI Engine | Google Gemini 1.5 Flash | Revenue projections & automated insights |
                                  | Weather | OpenWeatherMap API | Contextual data for AI projections |
                                  | Charts | Recharts | Complex financial trend visualization |
                                  | Icons | Lucide React | Clean, consistent visual language |

                                  ---

                                  ## 🎨 Design Philosophy

                                  Neko Metrics follows a **"Hardware Specialist"** aesthetic built for power users:

                                  - 🌑 **Dark Mode Sophistication** — Deep slate and indigo palette that reduces eye strain during long auditing sessions
                                  - - 📐 **High Information Density** — Complex data presented without clutter; every pixel earns its place
                                    - - ✨ **Tactile Feedback** — Subtle shadows and "slam-in" animations denote importance and confirm actions
                                      - - 🐾 **Neko Identity** — The cat motif runs through the UX: precise, agile, always watching
                                       
                                        - ---

                                        ## ⚠️ Understanding the Measurement Model

                                        ### What the System Can Do

                                        Because sales are tracked with a `dailyTrend` array (31 daily slots), the system knows exactly which sales happened in Week 1 vs. Week 2. This means Theoretical Consumption can be calculated for any specific week — enabling true intra-month waste tracking.

                                        ### Current Limitation

                                        Expense snapshots currently store a single monthly total. If Week 1 expenses are ₹10,000 and Week 2 adds another ₹10,000, the system updates to ₹20,000 but cannot distinguish which ₹10,000 belonged to which week. You gain real-time month-to-date visibility, but not week-level historical comparison.

                                        ### The Roadmap: `dailyTrend` for Expenses

                                        The planned enhancement is to add a `dailyTrend` array to Expense Snapshots — mirroring the sales structure. This would allow the Waste Radar to filter by any date range while retaining the clean monthly file architecture, enabling questions like: *"Why was Week 2 of March so wasteful compared to Week 1?"*

                                        ---

                                        ## 🏁 Getting Started

                                        ### Prerequisites

                                        - Node.js 18+
                                        - - Firebase Project (Firestore, Auth & Storage enabled)
                                          - - Google AI Studio API Key (for Projections)
                                            - - OpenWeatherMap API Key (for Weather Integration)
                                             
                                              - ### Installation
                                             
                                              - ```bash
                                                # 1. Clone the repository
                                                git clone https://github.com/dinoleix/Neko-Metric-version-3.3.git
                                                cd Neko-Metric-version-3.3

                                                # 2. Install dependencies
                                                npm install

                                                # 3. Configure environment variables
                                                cp .env.example .env
                                                ```

                                                ### Environment Configuration

                                                ```env
                                                VITE_FIREBASE_API_KEY=your_firebase_api_key
                                                VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
                                                VITE_FIREBASE_PROJECT_ID=your_project_id
                                                VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
                                                VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
                                                VITE_FIREBASE_APP_ID=your_app_id
                                                VITE_OPENWEATHER_API_KEY=your_openweather_key
                                                VITE_GEMINI_API_KEY=your_gemini_key
                                                ```

                                                ### Launch

                                                ```bash
                                                npm run dev
                                                ```

                                                ---

                                                ## 📁 Project Structure

                                                ```
                                                neko-metrics/
                                                ├── components/          # Reusable UI components
                                                ├── App.tsx              # Root application & routing
                                                ├── firebase.ts          # Firebase configuration
                                                ├── geminiService.ts     # AI projection engine
                                                ├── projectionService.ts # Revenue forecasting logic
                                                ├── weatherService.ts    # OpenWeatherMap integration
                                                ├── types.ts             # TypeScript type definitions
                                                └── metadata.json        # App metadata
                                                ```

                                                ---

                                                *Built with precision. Powered by AI. Designed for operators who demand more.*

                                                **🐾 Neko Metrics — Always watching. Always accurate.**
