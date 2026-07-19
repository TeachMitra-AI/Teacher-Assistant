# Teacher Just-In-Time Coaching Tool 👨‍🏫

> **शिक्षक सहायक** - An AI-powered coaching assistant providing just-in-time support for Indian government school teachers

## 🎯 Problem Statement

Teachers in rural India face critical gaps in professional development:
- **Lag Time**: Resource persons visit only once a month for 10-30 minutes
- **Generic Feedback**: Non-actionable advice instead of specific solutions
- **No Just-In-Time Support**: Teachers struggle alone during immediate classroom challenges

This tool provides **immediate, personalized, context-aware coaching** to teachers on-demand.

## ✨ Features

### Core Functionality
- 🤖 **AI-Powered Coaching**: Uses Google Gemini API for intelligent, context-aware responses
- 🎤 **Voice Input**: Speak your questions in any supported language
- 🌐 **Multilingual Support**: 9 Indian languages (English, Hindi, Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Odia)
- 📴 **Offline-First**: Queue queries when offline, auto-sync when connection restored
- 💾 **Smart Caching**: Instant responses for previously asked questions
- 📊 **Analytics**: Track usage patterns and response times

### Specialized Coaching Areas
1. **Classroom Management** - Handle disruptions, manage multi-grade classrooms
2. **Concept Explanation** - Break down complex topics with local context
3. **Student Engagement** - Strategies to keep students interested
4. **Assessment** - Quick, effective evaluation techniques
5. **FLN Support** - Foundational Literacy & Numeracy guidance
6. **Resource-Constrained Teaching** - Creative solutions with limited materials

## 🚀 Quick Start

### Prerequisites
- Modern web browser (Chrome, Edge, Firefox, Safari)
- Internet connection (for AI responses)
- Google Gemini API key (free tier available)

### Setup Instructions

1. **Get a Gemini API Key** (Free)
   - Visit: https://makersuite.google.com/app/apikey
   - Sign in with Google account
   - Click "Create API Key"
   - Copy your API key

2. **Configure & run the backend** (keeps your API key secret)

   The frontend never holds the API key. A small Node.js backend proxies
   requests to Gemini. You need Node.js 18 or newer.

   ```bash
   cd server
   npm install
   cp .env.example .env      # on Windows PowerShell: Copy-Item .env.example .env
   ```

   Open `server/.env` and set your key:
   ```env
   GEMINI_API_KEY=your-actual-api-key-here
   CORS_ORIGINS=http://localhost:5173,http://localhost:8000
   ```

   Set up the database (SQLite via Prisma) and seed demo accounts:
   ```bash
   npx prisma migrate dev     # creates prisma/dev.db and applies the schema
   npm run seed               # adds demo schools + accounts (see below)
   ```

   Start the backend:
   ```bash
   npm start
   ```
   It listens on `http://localhost:3000` by default.

3. **Run the React client** (`client/`)

   The modern web app is a Vite + React + TypeScript PWA.
   ```bash
   cd ../client
   npm install
   cp .env.example .env       # on Windows PowerShell: Copy-Item .env.example .env
   npm run dev
   ```
   Open the browser to the URL Vite prints (default `http://localhost:5173`).
   `VITE_API_BASE` in `client/.env` points the app at the backend API.

   Build for production with `npm run build` (outputs to `client/dist/`).

### Demo accounts (from `npm run seed`)

All demo accounts use PIN **123456**. Sign in with a school code + name + PIN.

| School code | Name          | Role            |
| ----------- | ------------- | --------------- |
| RAMPUR01    | Demo Teacher  | Teacher         |
| RAMPUR01    | Rampur Admin  | School Admin    |
| RAMPUR01    | Rampur RP     | Resource Person |
| RAMPUR01    | Super Admin   | Super Admin     |

New teachers can self-register with a valid school code from the **Register** tab.

> **Legacy note:** The original vanilla HTML/JS prototype now lives in
> `archive/` (`index.html`, `app.js`, `styles.css`, etc.). It is superseded by
> the React client in `client/` and no longer works against the API because
> `/api/coach` now requires authentication. It is kept only for reference.

> **Security note:** The API key lives only in `server/.env`, which is
> git-ignored. Never put the key in any frontend file. If a key
> was ever committed to git, rotate it immediately in the Google console.

## 📖 How to Use

### Basic Usage

1. **Select Context** (Optional but recommended)
   - Choose your grade/class
   - Select subject
   - Pick classroom type
   - Identify issue type

2. **Ask Your Question**
   - Type your question in the text area, OR
   - Click the 🎤 microphone button to speak

3. **Get Instant Coaching**
   - Click "Get Coaching" button
   - Receive personalized, actionable advice in seconds

4. **Provide Feedback**
   - Mark responses as helpful or not helpful
   - Helps improve future recommendations

### Example Queries

**Classroom Management:**
> "My Class 4 students finished group work at different times. Advanced students are disrupting while others are still working. What should I do?"

**Concept Explanation:**
> "Students don't understand borrowing in subtraction when there's a zero in the tens place. How do I explain this?"

**Multi-Grade Teaching:**
> "I teach Class 3 and Class 5 together in one room. How can I manage both during a math lesson?"

**Resource Constraints:**
> "I need to teach fractions but have no teaching materials. What can I use from the classroom?"

## 🎨 Features in Detail

### Voice Input
- Click the microphone button
- Speak clearly in your preferred language
- The app will transcribe and process your question
- Works in all 9 supported languages

### Offline Mode
- Queries submitted while offline are automatically queued
- When connection is restored, queries are processed automatically
- You'll receive a notification when offline queries are answered

### Smart Caching
- Previously asked questions (with same context) are cached
- Instant responses from cache (no API call needed)
- Cache expires after 7 days
- Reduces API usage and costs

### Language Support
The tool supports 9 Indian languages:
- English (en)
- हिंदी / Hindi (hi)
- বাংলা / Bengali (bn)
- తెలుగు / Telugu (te)
- मराठी / Marathi (mr)
- தமிழ் / Tamil (ta)
- ગુજરાતી / Gujarati (gu)
- ಕನ್ನಡ / Kannada (kn)
- ଓଡ଼ିଆ / Odia (or)

## 🏗️ Technical Architecture

### File Structure
```
teacher-coaching-tool/
├── index.html           # Main HTML structure
├── styles.css          # Comprehensive styling with animations
├── config.js           # Configuration and settings
├── prompt-templates.js # AI prompt templates for different scenarios
├── ai-service.js       # Gemini API integration
├── cache-manager.js    # Offline-first caching with IndexedDB
├── app.js             # Main application logic
└── README.md          # This file
```

### Technology Stack
- **Frontend**: Vanilla HTML, CSS, JavaScript (no frameworks)
- **AI Model**: Google Gemini 1.5 Flash
- **Storage**: IndexedDB for caching, LocalStorage for settings
- **Voice**: Web Speech API
- **Styling**: Modern CSS with glassmorphism, animations

### Key Components

1. **AI Service** (`ai-service.js`)
   - Gemini API integration
   - Error handling and retries
   - Response formatting
   - Analytics tracking

2. **Cache Manager** (`cache-manager.js`)
   - IndexedDB for persistent storage
   - Offline queue management
   - Background sync
   - Cache expiration

3. **Prompt Templates** (`prompt-templates.js`)
   - Context-aware prompt generation
   - Specialized templates for different teaching scenarios
   - Keyword-based template selection

4. **Main App** (`app.js`)
   - UI event handling
   - Voice recognition
   - Response display
   - User feedback

## 📊 Success Metrics

The tool tracks:
- **Query-to-Resolution Time**: How fast teachers get answers
- **Interaction Frequency**: How often teachers use the tool
- **Implementation Success**: Feedback on whether strategies worked
- **Offline Usage**: Percentage of queries submitted offline
- **Voice vs Text**: Usage patterns to optimize UX

View analytics in browser console: `aiService.getAnalyticsSummary()`

## 🔒 Privacy & Data

- All data stored locally in browser (IndexedDB, LocalStorage)
- No data sent to external servers except Gemini API
- API calls include only the query and context (no personal info)
- Clear cache anytime: `cacheManager.clearCache()`

## 🛠️ Troubleshooting

### "API Key Not Configured" Error
- Open `config.js`
- Replace `YOUR_GEMINI_API_KEY_HERE` with your actual API key
- Refresh the page

### Voice Input Not Working
- Ensure microphone permissions are granted
- Use Chrome or Edge browser (best support)
- Check microphone is not being used by another app

### Offline Queries Not Processing
- Check internet connection
- Open browser console to see sync status
- Manually trigger: `cacheManager.processOfflineQueue()`

### Slow Responses
- Check internet connection speed
- Gemini API free tier has rate limits
- Consider upgrading to paid tier for faster responses

## 🚀 Deployment

### For Hackathon Demo
1. Open `index.html` directly in browser
2. Share screen during presentation
3. Demonstrate with pre-prepared scenarios

### For Production Use
1. **Host on GitHub Pages** (Free)
   ```bash
   # Push to GitHub repository
   git init
   git add .
   git commit -m "Initial commit"
   git push origin main
   
   # Enable GitHub Pages in repository settings
   ```

2. **Host on Netlify** (Free)
   - Drag and drop folder to Netlify
   - Or connect GitHub repository

3. **Host on Vercel** (Free)
   - Import GitHub repository
   - Auto-deploy on every commit

### Environment Variables (for production)
- Store API key in environment variable
- Update `config.js` to read from environment:
```javascript
GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'fallback-key'
```

## 🎓 Educational Context

### Aligned with Indian Education Policies
- **NIPUN Bharat**: Foundational Literacy & Numeracy support
- **NEP 2020**: Continuous professional development for teachers
- **Teaching at the Right Level (TaRL)**: Differentiation strategies

### Target Users
- Primary & Secondary Government School Teachers
- Cluster Resource Persons (CRPs)
- Academic Resource Persons (ARPs)
- Block Resource Persons (BRPs)

## 🤝 Contributing

This is a hackathon project. Potential improvements:
- [ ] Add more languages
- [ ] Integrate video micro-learning modules
- [ ] Create mobile app (React Native / Flutter)
- [ ] Add peer teacher community features
- [ ] Implement admin dashboard for CRPs
- [ ] Add SMS/WhatsApp integration for feature phones

## 📄 License

This project is created for educational purposes as part of a hackathon.

## 🙏 Acknowledgments

- Problem statement inspired by real challenges faced by teachers in rural India
- Built with Google Gemini AI
- Designed for ShikshaLokam hackathon

## 📞 Support

For issues or questions:
1. Check the Troubleshooting section above
2. Review browser console for error messages
3. Ensure API key is correctly configured

---

**Made with ❤️ for Indian Teachers**

*"Empowering teachers with just-in-time support to transform classrooms"*
