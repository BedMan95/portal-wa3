# WhatsApp Bot (Local)

A robust, locally-hosted WhatsApp Bot built with Node.js and Baileys. Features a unified API gateway, web dashboard, message scheduling, and Gemini AI integration.

## 🚀 Features

- **Unified API Gateway**: RESTful endpoints for sending messages, media, and validating numbers.
- **Web Dashboard**: Manage bot status, send messages, and configure settings via a clean UI.
- **Message Scheduling**: Schedule messages (once, daily, weekly, monthly, or custom cron) with randomized minute delays for daily schedules.
- **Media Support**: Send images, videos, audio, and documents (local files or via URL).
- **Gemini AI Integration**: Chat with Google's Gemini AI directly via WhatsApp (`/gemini`).
- **Group Management**: Fetch and interact with WhatsApp groups.
- **Rate Limiting & Auth**: Built-in API rate limiting, API key authentication, and automatic session expiration redirects.
- **SQLite Database**: Secure, local storage for users, templates, and schedules with bcrypt password hashing.
- **Security Manager**: Manage dashboard users, passwords, and view API keys directly from the UI.

## 📋 Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [PM2](https://pm2.keymetrics.io/) (optional, for production process management)

## 🛠️ Installation

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in the root directory:
   ```env
   PORT=3000
   SESSION_SECRET=your_super_secret_session_key
   EXTERNAL_API_KEY=your_secure_api_key
   GEMINI_API_KEY=your_google_gemini_api_key
   SESSION_SECURE=false
   DB_PATH=./database.sqlite
   ```

3. Run the database setup script (only needed once):
   ```bash
   node setup-db.js
   ```

## 🚦 Running the Bot

### Development Mode
```bash
node bot.js
```

### Production Mode (using PM2)
```bash
npm install -g pm2
pm2 start bot.js --name portalwa-bot --watch --ignore-watch="node_modules uploads auth_info_baileys *.json *.log *.sqlite"
pm2 save
```

## 💻 Usage

1. Open the dashboard at `http://localhost:3000` (or your configured port).
2. Login using credentials Default: `admin` / `password123`
3. Scan the QR code displayed on the dashboard with your WhatsApp app to connect.

### Gemini AI
Send a message to the connected WhatsApp number:
```text
/gemini What is the capital of Indonesia?
```

## 🔌 API Documentation

Full API documentation and examples are available in the dashboard at `/docs.html`.

### Core Endpoints (v1)

- `POST /api/v1/messages` - Send text or media messages.
- `GET /api/v1/status` - Check bot connection status.
- `POST /api/v1/validate` - Validate if a number is registered on WhatsApp.

*Authentication: Pass your `EXTERNAL_API_KEY` in the `x-api-key` header.*

## ⚠️ Troubleshooting

**Port Conflict (EADDRINUSE)**
If the port is already in use, change the `PORT` in `.env` or kill the existing process:
- Windows: `netstat -ano | findstr :3000` then `taskkill /PID <pid> /F`
- Linux/Mac: `lsof -i :3000` then `kill -9 <pid>`

**Bot Disconnected / Cannot Scan QR**
Delete the `auth_info_baileys` folder and restart the bot to generate a new QR code.

## 📄 License

ISC License
