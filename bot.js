// =================================================================
//                      IMPOR MODUL & INISIALISASI
// =================================================================
const pino = require('pino'); // Logger canggih
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { exec } = require('child_process');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
require('dotenv').config();

// Database setup
const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const db = new Database(dbPath);

// googleapis/leaveReminder removed (calendar feature deprecated)
const multer = require('multer');

// Handlers
const helpHandler = require('./handlers/helpHandler');
const geminiHandler = require('./handlers/geminiHandler');

// =================================================================
//                 FUNGSI UTAMA UNTUK MENJALANKAN BOT
// =================================================================
async function startBot() {
    // -----------------------------------------------------------------
    //          MEMUAT BAILEYS (ESM) SECARA DINAMIS (v7 COMPATIBLE)
    // -----------------------------------------------------------------
    const {
        default: makeWASocket,
        useMultiFileAuthState,
        DisconnectReason,
        fetchLatestBaileysVersion, // <-- Impor fungsi untuk mengambil versi terbaru
    } = await import('@whiskeysockets/baileys');
    const { Boom } = await import('@hapi/boom');

    // --- Konfigurasi Logger (Pino) seperti di example.js ---
    const logger = pino({
        level: 'info',
        transport: {
            targets: [
                { target: 'pino-pretty', options: { colorize: true }, level: 'info' },
                { target: 'pino/file', options: { destination: './bot-logs.log' }, level: 'info' }
            ]
        }
    });

    // Inisialisasi Aplikasi Express & Server
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server);

    // Ensure uploads directory exists and configure multer
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const upload = multer({ dest: uploadsDir });

    const PORT = Number(process.env.PORT || 3000);

    // Variabel Global untuk Status Bot
    let sock;
    let qrCode = null;
    let connectionStatus = 'Menunggu koneksi...';

    // =================================================================
    //                         FUNGSI BANTUAN
    // =================================================================
    // Fungsi log sekarang menggunakan Pino
    const log = (message, type = 'info') => {
        const timestamp = `[${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}]`;
        logger[type](`${timestamp} ${message}`); // Menggunakan logger.info(), logger.error(), etc.
        // Remove \n before emitting
        const cleanMessage = String(message).replace(/\\n/g, '').replace(/\n/g, '').trim();
        io.emit('log', `${timestamp} ${cleanMessage}`);
    };

    // ... (Sisa kode middleware, API, dll tetap sama, tidak perlu diubah) ...
    // [SNIP: Kode dari middleware Express hingga sebelum fungsi connectToWhatsApp tetap sama]

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.set('trust proxy', 1);
    app.use(session({
        secret: process.env.SESSION_SECRET || 'secret-key-default',
        resave: false,
        saveUninitialized: true,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.SESSION_SECURE === 'true'
        }
    }));
    const checkPageAuth = (req, res, next) => { if (req.session.userId) { next(); } else { res.redirect('/login.html'); } };
    
    // Unified API Gateway Middleware
    app.use('/api/v1', (req, res, next) => {
        const apiKey = req.headers['x-api-key'];
        if (apiKey && apiKey === process.env.EXTERNAL_API_KEY) {
            req.isExternal = true;
            return next();
        }
        if (req.session.userId) {
            req.isExternal = false;
            return next();
        }
        res.status(401).json({ success: false, message: 'Unauthorized' });
    });

    // Serve static files
    app.use(express.static(path.join(__dirname, 'public')));

    // SPA Fallback
    app.get(/(.*)/, (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path === '/login' || req.path === '/logout') {
            return next();
        }
        if (!req.session.userId && req.path !== '/login.html') {
            return res.redirect('/login.html');
        }
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
    const apiRateLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // limit each IP to 100 requests per windowMs
        message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' } }
    });

    const unifiedAuth = (req, res, next) => {
        // Check JWT/Session for internal
        if (req.session && req.session.userId) {
            req.apiScope = 'internal';
            return next();
        }
        // Check API Key for external
        const apiKey = req.headers['x-api-key'];
        if (apiKey && apiKey === process.env.EXTERNAL_API_KEY) {
            req.apiScope = 'external';
            return next();
        }
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or missing authentication credentials.' } });
    };

    const checkApiAuth = (req, res, next) => { if (req.session.userId) { next(); } else { res.status(401).json({ error: 'Sesi tidak valid atau telah berakhir. Silakan login kembali.' }); } };
    const checkApiKey = (req, res, next) => { const apiKey = req.headers['x-api-key']; if (apiKey && apiKey === process.env.EXTERNAL_API_KEY) { next(); } else { res.status(403).json({ error: 'Forbidden: API Key tidak valid atau tidak ada.' }); } };
    
    app.use('/api/v1/', apiRateLimiter, unifiedAuth);

    // Allow public access to docs.html and login.html, protect others
    app.get('/', checkPageAuth);
    app.get('/index.html', checkPageAuth);
    app.get('/validator.html', checkPageAuth);
    app.get('/settings.html', checkPageAuth);
    app.get('/send.html', checkPageAuth);
    app.get('/scheduler.html', checkPageAuth);
    
    app.use(express.static(path.join(__dirname, 'public')));
    app.use('/api/internal', checkApiAuth);

    // =================================================================
    //                 KONEKSI WHATSAPP (BAILEYS V7 - STABLE VERSION)
    // =================================================================
    async function connectToWhatsApp() {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        
        // --- MENGAMBIL VERSI WA TERBARU SECARA DINAMIS ---
        const { version, isLatest } = await fetchLatestBaileysVersion();
        log(`Menggunakan WA v${version.join('.')}, Versi Terbaru: ${isLatest}`);

        sock = makeWASocket({
            version, // <-- Gunakan versi terbaru yang didapat
            logger,  // <-- Gunakan Pino logger yang sudah dikonfigurasi
            printQRInTerminal: true,
            auth: state,
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                qrCode = qr;
                connectionStatus = 'Menunggu Scan QR';
                io.emit('status', { status: connectionStatus, qr: qrCode });
                log('QR Code diterima, silakan scan.');
            }
            
            if (connection === 'close') {
                const error = lastDisconnect?.error;
                const statusCode = error instanceof Boom ? error.output.statusCode : 500;
                
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                connectionStatus = `Koneksi ditutup. Alasan: ${statusCode}, ${error?.message}. Menghubungkan kembali: ${shouldReconnect}`;
                log(connectionStatus, 'error');
                io.emit('status', { status: connectionStatus, qr: null });

                if (shouldReconnect) {
                    setTimeout(connectToWhatsApp, 5000);
                } else {
                    log('Tidak dapat terhubung: Logout Terdeteksi. Hapus folder auth dan restart.', 'error');
                    if (fs.existsSync('auth_info_baileys')) {
                        fs.rmSync('auth_info_baileys', { recursive: true, force: true });
                    }
                }
            } else if (connection === 'open') {
                qrCode = null;
                connectionStatus = `Terhubung sebagai ${sock.user.name || sock.user.id}`;
                log(connectionStatus);
                io.emit('status', { status: connectionStatus, qr: qrCode });
                // Removed scheduled jobs and leave reminder setup
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const from = msg.key.remoteJid;
            log(`Pesan diterima dari ${from}: "${messageText}"`);
            if (messageText.startsWith('/help')) await helpHandler(sock, from);
            else if (messageText.startsWith('/gemini')) await geminiHandler(sock, from, messageText.substring(7).trim());
        });
    }
    
    // [SNIP: Sisa kode fungsi (Socket.IO, Login, API, Scheduler, dll) tetap sama]
    // ... KODE ANDA YANG LAIN DARI SINI ...
    // ... TETAP SAMA DAN TIDAK PERLU DIUBAH ...
    // =================================================================
    //                 KOMUNIKASI REAL-TIME (SOCKET.IO)
    // =================================================================
    io.on('connection', (socket) => {
        log('Dashboard terhubung via Socket.IO.');
        socket.emit('status', { status: connectionStatus, qr: qrCode });
        socket.emit('log', 'Selamat datang di log server.');
        socket.on('validate-numbers', async (data) => {
            if (!sock || !sock.user) return socket.emit('validation-error', { message: 'Bot tidak terhubung.' });
            const { numbers } = data;
            let checkedCount = 0;
            for (const number of numbers) {
                try {
                    let formattedNumber = number.trim().startsWith('0') ? '62' + number.trim().substring(1) : number.trim();
                    const [result] = await sock.onWhatsApp(`${formattedNumber}@s.whatsapp.net`);
                    socket.emit('validation-update', { number, status: result?.exists ? 'Aktif' : 'Tidak Terdaftar' });
                } catch (e) {
                    socket.emit('validation-update', { number, status: 'Error' });
                } finally {
                    checkedCount++;
                    socket.emit('validation-progress', { checked: checkedCount, total: numbers.length });
                    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 3000) + 2000));
                }
            }
            socket.emit('validation-complete');
        });
    });

    // =================================================================
    //                 SISTEM LOGIN & OTENTIKASI
    // =================================================================
    app.post('/login', (req, res) => {
        const { username, password } = req.body;
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        
        if (user && bcrypt.compareSync(password, user.password)) {
            req.session.userId = user.username;
            log(`Pengguna ${username} berhasil login.`);
            res.status(200).json({ message: 'Login berhasil' });
        } else {
            log(`Percobaan login gagal untuk pengguna: ${username}.`, 'error');
            res.status(401).json({ message: 'Username atau password salah' });
        }
    });
    app.get('/logout', (req, res) => {
        const username = req.session.userId;
        req.session.destroy(() => {
            log(`Pengguna ${username} telah logout.`);
            res.redirect('/login.html');
        });
    });

    // =================================================================
    //                 UNIFIED API (V1)
    // =================================================================
    
    // 1. Send Message (Text or Media)
    app.post('/api/v1/messages', upload.single('file'), async (req, res) => {
        try {
            if (!sock || !sock.user) return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Bot is not connected.' } });

            const { targetType, target, message, mediaUrl, mediaType, caption } = req.body;
            const file = req.file;

            if (!targetType || !target) {
                return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'targetType and target are required.' } });
            }
            if (!message && !mediaUrl && !file) {
                return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'message, mediaUrl, or file is required.' } });
            }

            let targetJid;
            if (targetType === 'personal') {
                let number = target.trim();
                if (number.startsWith('0')) number = '62' + number.substring(1);
                targetJid = `${number}@s.whatsapp.net`;
                const [result] = await sock.onWhatsApp(targetJid);
                if (!result || !result.exists) {
                    return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Number ${target} is not registered on WhatsApp.` } });
                }
            } else if (targetType === 'group') {
                const groups = await sock.groupFetchAllParticipating();
                const group = Object.values(groups).find(g => g.subject.toLowerCase() === target.toLowerCase() || g.id === target);
                if (!group) {
                    return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Group ${target} not found.` } });
                }
                targetJid = group.id;
            } else {
                return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'targetType must be personal or group.' } });
            }

            let payload;
            if (file) {
                const buffer = fs.readFileSync(file.path);
                const mime = file.mimetype || '';
                if (mime.startsWith('image')) payload = { image: buffer, caption: caption || message || '' };
                else if (mime.startsWith('video')) payload = { video: buffer, caption: caption || message || '' };
                else if (mime.startsWith('audio')) payload = { audio: buffer, ptt: false };
                else payload = { document: buffer, fileName: file.originalname, mimetype: mime };
                try { fs.unlinkSync(file.path); } catch (e) { /* ignore */ }
            } else if (mediaUrl) {
                let buffer;
                let inferredMime = '';
                try {
                    const https = require('https');
                    const http = require('http');
                    const url = require('url');
                    
                    buffer = await new Promise((resolve, reject) => {
                        const parsedUrl = url.parse(mediaUrl);
                        const client = parsedUrl.protocol === 'https:' ? https : http;
                        const options = {
                            rejectUnauthorized: false,
                            headers: { 'User-Agent': 'Mozilla/5.0' }
                        };
                        
                        const req = client.get(mediaUrl, options, (res) => {
                            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                                // Handle redirect
                                const redirectUrl = new URL(res.headers.location, mediaUrl).href;
                                const redirectParsed = url.parse(redirectUrl);
                                const redirectClient = redirectParsed.protocol === 'https:' ? https : http;
                                const redirectReq = redirectClient.get(redirectUrl, options, (redirectRes) => {
                                    if (redirectRes.statusCode !== 200) {
                                        reject(new Error(`HTTP ${redirectRes.statusCode}`));
                                        return;
                                    }
                                    inferredMime = redirectRes.headers['content-type'] || '';
                                    const chunks = [];
                                    redirectRes.on('data', chunk => chunks.push(chunk));
                                    redirectRes.on('end', () => resolve(Buffer.concat(chunks)));
                                });
                                redirectReq.on('error', reject);
                                redirectReq.setTimeout(60000, () => { redirectReq.destroy(); reject(new Error('Timeout')); });
                                return;
                            }
                            
                            if (res.statusCode !== 200) {
                                reject(new Error(`HTTP ${res.statusCode}`));
                                return;
                            }
                            inferredMime = res.headers['content-type'] || '';
                            const chunks = [];
                            res.on('data', chunk => chunks.push(chunk));
                            res.on('end', () => resolve(Buffer.concat(chunks)));
                        });
                        req.on('error', reject);
                        req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout')); });
                    });
                } catch (e) {
                    console.error('Fetch error:', e);
                    const detail = e.cause ? e.cause.message : e.message;
                    return res.status(400).json({ error: { code: 'DOWNLOAD_FAILED', message: `Failed to download mediaUrl: ${detail}` } });
                }
                const inferType = (u) => {
                    const lower = u.toLowerCase();
                    if (mediaType) return mediaType;
                    if (lower.match(/\.(jpg|jpeg|png|webp|gif)$/) || inferredMime.startsWith('image')) return 'image';
                    if (lower.match(/\.(mp4|mov|mkv|webm)$/) || inferredMime.startsWith('video')) return 'video';
                    if (lower.match(/\.(mp3|wav|m4a|aac)$/) || inferredMime.startsWith('audio')) return 'audio';
                    return 'document';
                };
                const t = inferType(mediaUrl);
                if (t === 'image') payload = { image: buffer, caption: caption || message || '' };
                else if (t === 'video') payload = { video: buffer, caption: caption || message || '' };
                else if (t === 'audio') payload = { audio: buffer };
                else payload = { document: buffer, fileName: path.basename(mediaUrl), mimetype: inferredMime || 'application/octet-stream' };
            } else {
                payload = { text: message };
            }

            await sock.sendMessage(targetJid, payload);
            log(`[API v1] Message sent to ${target} (${targetJid}) by ${req.apiScope}`);
            res.json({ success: true, message: `Message sent to ${target}.` });
        } catch (e) {
            log(`[API v1] Failed to send message: ${e.message}`, 'error');
            res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
        }
    });

    // 2. Check Status
    app.get('/api/v1/status', (req, res) => {
        res.json({ 
            success: true, 
            data: { 
                status: connectionStatus, 
                connected: !!(sock && sock.user),
                user: sock?.user?.id || null
            } 
        });
    });

    // 3. Validate Number
    app.post('/api/v1/validate', async (req, res) => {
        try {
            if (!sock || !sock.user) return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Bot is not connected.' } });
            const { number } = req.body;
            if (!number) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'number is required.' } });
            
            let formatted = number.trim();
            if (formatted.startsWith('0')) formatted = '62' + formatted.substring(1);
            const targetJid = `${formatted}@s.whatsapp.net`;
            
            const [result] = await sock.onWhatsApp(targetJid);
            res.json({ 
                success: true, 
                data: { 
                    number: number, 
                    formatted: formatted,
                    exists: !!(result && result.exists) 
                } 
            });
        } catch (e) {
            res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
        }
    });

    // =================================================================
    //                 API INTERNAL (DASHBOARD) - LEGACY
    // =================================================================
    app.get('/api/internal/users', (req, res) => {
        try {
            const users = db.prepare('SELECT id, username FROM users').all();
            res.json(users);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/internal/users', (req, res) => {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });
        try {
            const hash = bcrypt.hashSync(password, 10);
            db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);
            res.json({ message: 'User berhasil ditambahkan' });
        } catch (e) {
            if (e.message.includes('UNIQUE constraint failed')) {
                res.status(400).json({ error: 'Username sudah ada' });
            } else {
                res.status(500).json({ error: e.message });
            }
        }
    });

    app.put('/api/internal/users/password', (req, res) => {
        const { oldPassword, newPassword } = req.body;
        const username = req.session.user;
        if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Password lama dan baru wajib diisi' });
        
        try {
            const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
            if (!user || !bcrypt.compareSync(oldPassword, user.password)) {
                return res.status(401).json({ error: 'Password lama salah' });
            }
            const hash = bcrypt.hashSync(newPassword, 10);
            db.prepare('UPDATE users SET password = ? WHERE username = ?').run(hash, username);
            res.json({ message: 'Password berhasil diubah' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/internal/users/:id', (req, res) => {
        try {
            const count = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
            if (count <= 1) return res.status(400).json({ error: 'Tidak dapat menghapus user terakhir' });
            
            db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
            res.json({ message: 'User berhasil dihapus' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/internal/api-key', (req, res) => {
        try {
            // For MVP, we just read from process.env
            res.json({ apiKey: process.env.EXTERNAL_API_KEY || '' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/internal/api-key/generate', (req, res) => {
        try {
            const crypto = require('crypto');
            const newKey = crypto.randomBytes(32).toString('hex');
            
            const fs = require('fs');
            const path = require('path');
            const envPath = path.join(__dirname, '.env');
            
            let envContent = '';
            if (fs.existsSync(envPath)) {
                envContent = fs.readFileSync(envPath, 'utf8');
            }
            
            if (envContent.includes('EXTERNAL_API_KEY=')) {
                envContent = envContent.replace(/EXTERNAL_API_KEY=.*/g, `EXTERNAL_API_KEY=${newKey}`);
            } else {
                envContent += `\nEXTERNAL_API_KEY=${newKey}\n`;
            }
            
            fs.writeFileSync(envPath, envContent.trim() + '\n');
            process.env.EXTERNAL_API_KEY = newKey;
            
            res.json({ apiKey: newKey, message: 'API Key berhasil diperbarui' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/internal/logout-wa', async (req, res) => {
        log('Menerima permintaan logout & hapus sesi WA.');
        try {
            await sock.logout();
        } catch (e) {
            log(`Error saat logout: ${e.message}`, 'error');
        } finally {
            if (fs.existsSync('auth_info_baileys')) {
                fs.rmSync('auth_info_baileys', { recursive: true, force: true });
            }
            res.json({ message: 'Proses logout dan hapus sesi dimulai.' });
            exec('pm2 restart portalwa-bot', (err) => { if (err) log(`Gagal restart PM2: ${err}`, 'error'); });
        }
    });
    app.get('/api/internal/get-groups', async (req, res) => {
        if (!sock || !sock.user) return res.status(503).json({ error: 'Bot tidak terhubung.' });
        try {
            const groups = await sock.groupFetchAllParticipating();
            const groupList = Object.values(groups).map(g => ({ id: g.id, subject: g.subject })).sort((a, b) => a.subject.localeCompare(b.subject));
            res.json(groupList);
        } catch (e) { res.status(500).json({ error: 'Gagal mengambil grup.' }); }
    });
    app.get('/api/internal/get-templates', (req, res) => {
        const templates = db.prepare('SELECT name, message FROM templates').all();
        res.json(templates);
    });
    app.post('/api/internal/save-template', (req, res) => {
        const { name, message } = req.body;
        if (!name || !message) return res.status(400).json({ error: 'Nama dan isi template harus diisi.' });
        
        try {
            db.prepare('INSERT OR REPLACE INTO templates (name, message) VALUES (?, ?)').run(name, message);
            io.emit('templates_updated');
            res.json({ success: true, message: 'Template berhasil disimpan.' });
        } catch (e) {
            res.status(500).json({ error: 'Gagal menyimpan template.' });
        }
    });

    // =================================================================
    //                 SISTEM PENJADWALAN (SCHEDULER)
    // =================================================================
    const cron = require('node-cron');
    const cronParser = require('cron-parser');
    const activeCronJobs = new Map();

    async function sendBroadcastWithDelay(destinations, message, source = "Scheduler", mediaUrl = null) {
        log(`[${source}] Memulai broadcast ke ${destinations.length} target.`);
        
        let payload = { text: message };
        if (mediaUrl) {
            try {
                const https = require('https');
                const http = require('http');
                const url = require('url');
                
                const buffer = await new Promise((resolve, reject) => {
                    const parsedUrl = url.parse(mediaUrl);
                    const client = parsedUrl.protocol === 'https:' ? https : http;
                    const options = { rejectUnauthorized: false, headers: { 'User-Agent': 'Mozilla/5.0' } };
                    
                    const req = client.get(mediaUrl, options, (res) => {
                        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                            const redirectUrl = new URL(res.headers.location, mediaUrl).href;
                            const redirectParsed = url.parse(redirectUrl);
                            const redirectClient = redirectParsed.protocol === 'https:' ? https : http;
                            const redirectReq = redirectClient.get(redirectUrl, options, (redirectRes) => {
                                if (redirectRes.statusCode !== 200) return reject(new Error(`HTTP ${redirectRes.statusCode}`));
                                const chunks = [];
                                redirectRes.on('data', chunk => chunks.push(chunk));
                                redirectRes.on('end', () => resolve(Buffer.concat(chunks)));
                            });
                            redirectReq.on('error', reject);
                            return;
                        }
                        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
                        const chunks = [];
                        res.on('data', chunk => chunks.push(chunk));
                        res.on('end', () => resolve(Buffer.concat(chunks)));
                    });
                    req.on('error', reject);
                });
                
                const lower = mediaUrl.toLowerCase();
                if (lower.match(/\.(mp4|mov|mkv|webm)$/)) payload = { video: buffer, caption: message || '' };
                else if (lower.match(/\.(mp3|wav|m4a|aac)$/)) payload = { audio: buffer };
                else if (lower.match(/\.(pdf|doc|docx|xls|xlsx|zip|rar)$/)) payload = { document: buffer, fileName: require('path').basename(mediaUrl), mimetype: 'application/octet-stream' };
                else payload = { image: buffer, caption: message || '' }; // Default to image
            } catch (e) {
                log(`[${source}] Gagal mengunduh mediaUrl: ${e.message}`, 'error');
                // Fallback to text if media fails
            }
        }

        for (const dest of destinations) {
            try {
                let targetJid = dest;
                if (!targetJid.includes('@')) {
                    if (targetJid.startsWith('0')) {
                        targetJid = '62' + dest.substring(1);
                    }
                    targetJid = `${targetJid}@s.whatsapp.net`;
                }
                await sock.sendMessage(targetJid, payload);
                log(`[${source}] Pesan terkirim ke ${targetJid}`);
            } catch (e) {
                log(`[${source}] Gagal mengirim ke ${dest}: ${e.message}`, 'error');
            }
            const delay = Math.floor(Math.random() * 5000) + 5000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        log(`[${source}] Broadcast selesai.`);
    }

    function createCronJob(job) {
        if (activeCronJobs.has(job.id)) {
            activeCronJobs.get(job.id).stop();
        }
        
        let cronExpression = '';
        const { scheduleType, scheduleData } = job;
        
        if (scheduleType === 'daily') {
            let [hour, minute] = scheduleData.time.split(':');
            let min = parseInt(minute, 10);
            let hr = parseInt(hour, 10);
            min += Math.floor(Math.random() * 3) + 1;
            if (min >= 60) {
                min -= 60;
                hr = (hr + 1) % 24;
            }
            cronExpression = `${min} ${hr} * * *`;
        } else if (scheduleType === 'weekly') {
            const [hour, minute] = scheduleData.time.split(':');
            cronExpression = `${minute} ${hour} * * ${scheduleData.dayOfWeek}`;
        } else if (scheduleType === 'monthly') {
            const [hour, minute] = scheduleData.time.split(':');
            cronExpression = `${minute} ${hour} ${scheduleData.dayOfMonth} * *`;
        } else if (scheduleType === 'custom') {
            cronExpression = scheduleData.cron;
        }

        if (cronExpression && cron.validate(cronExpression)) {
            const task = cron.schedule(cronExpression, () => {
                const allTargets = [...(job.targets || []), ...(job.groups || [])];
                sendBroadcastWithDelay(allTargets, job.message, `Cron Job #${job.id}`, job.mediaUrl);
            });
            activeCronJobs.set(job.id, task);
            log(`Cron job #${job.id} dibuat dengan ekspresi: ${cronExpression}`);
        } else {
            log(`Gagal membuat cron job #${job.id}: Ekspresi tidak valid (${cronExpression})`, 'error');
        }
    }

    // Load existing schedules on startup
    const existingSchedules = db.prepare('SELECT * FROM schedules').all().map(s => ({
        ...s,
        targets: JSON.parse(s.targets),
        groups: JSON.parse(s.groups),
        scheduleData: JSON.parse(s.scheduleData)
    }));
    
    existingSchedules.forEach(job => {
        if (job.scheduleType !== 'once' && job.scheduleType !== 'now') {
            createCronJob(job);
        }
    });

    app.get('/api/internal/get-scheduled-jobs', (req, res) => {
        const schedules = db.prepare('SELECT * FROM schedules').all().map(s => ({
            ...s,
            targets: JSON.parse(s.targets),
            groups: JSON.parse(s.groups),
            scheduleData: JSON.parse(s.scheduleData)
        }));
        
        const enriched = schedules.map(job => {
            let nextRun = null;
            if (job.scheduleType === 'once') {
                nextRun = new Date(`${job.scheduleData.date}T${job.scheduleData.time}`).toISOString();
            } else {
                let cronExpression = '';
                if (job.scheduleType === 'daily') cronExpression = `${job.scheduleData.time.split(':')[1]} ${job.scheduleData.time.split(':')[0]} * * *`;
                else if (job.scheduleType === 'weekly') cronExpression = `${job.scheduleData.time.split(':')[1]} ${job.scheduleData.time.split(':')[0]} * * ${job.scheduleData.dayOfWeek}`;
                else if (job.scheduleType === 'monthly') cronExpression = `${job.scheduleData.time.split(':')[1]} ${job.scheduleData.time.split(':')[0]} ${job.scheduleData.dayOfMonth} * *`;
                else if (job.scheduleType === 'custom') cronExpression = job.scheduleData.cron;
                
                if (cronExpression) {
                    try {
                        const interval = cronParser.CronExpressionParser.parse(cronExpression);
                        nextRun = interval.next().toISOString();
                    } catch (e) { /* ignore */ }
                }
            }
            return { ...job, nextRun };
        });
        res.json(enriched);
    });

    app.post('/api/internal/schedule-message', (req, res) => {
        const { targets, groups, message, mediaUrl, templateName, scheduleType, scheduleData } = req.body;
        const allTargets = [...(targets || []), ...(groups || [])];
        if (allTargets.length === 0 || (!message && !mediaUrl)) return res.status(400).json({ error: "Target dan pesan/media harus diisi." });
        
        const jobId = uuidv4();
        const job = { id: jobId, ...req.body, createdAt: new Date().toISOString() };
        
        if (scheduleType === 'now') {
            sendBroadcastWithDelay(allTargets, message, "Scheduler (Now)", mediaUrl);
            return res.json({ success: true, message: 'Pesan sedang dikirim sekarang.' });
        } 
        
        db.prepare(`
            INSERT INTO schedules (id, targets, groups, message, mediaUrl, templateName, scheduleType, scheduleData, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            job.id,
            JSON.stringify(job.targets || []),
            JSON.stringify(job.groups || []),
            job.message || null,
            job.mediaUrl || null,
            job.templateName || null,
            job.scheduleType,
            JSON.stringify(job.scheduleData || {}),
            job.createdAt
        );
        
        if (scheduleType === 'once') {
            const scheduleDateTime = new Date(`${scheduleData.date}T${scheduleData.time}`);
            if (scheduleDateTime > new Date()) {
                const delay = scheduleDateTime.getTime() - new Date().getTime();
                setTimeout(() => {
                    sendBroadcastWithDelay(allTargets, message, `Scheduler Job #${jobId}`, mediaUrl);
                    db.prepare('DELETE FROM schedules WHERE id = ?').run(jobId);
                    io.emit('schedule_updated');
                }, delay);
                log(`Tugas sekali kirim #${jobId} dijadwalkan untuk ${scheduleDateTime}`);
            } else {
                db.prepare('DELETE FROM schedules WHERE id = ?').run(jobId);
                return res.status(400).json({ error: "Waktu jadwal sudah lewat." });
            }
        } else {
            createCronJob(job);
        }
        
        io.emit('schedule_updated');
        res.json({ success: true, message: `Pesan berhasil dijadwalkan dengan ID: ${jobId}` });
    });

    app.delete('/api/internal/schedule-message/:id', (req, res) => {
        const jobId = req.params.id;
        
        const result = db.prepare('DELETE FROM schedules WHERE id = ?').run(jobId);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Jadwal tidak ditemukan.' });
        }
        
        if (activeCronJobs.has(jobId)) {
            activeCronJobs.get(jobId).stop();
            activeCronJobs.delete(jobId);
        }
        
        io.emit('schedule_updated');
        res.json({ success: true, message: `Jadwal ${jobId} berhasil dihapus.` });
    });

    app.put('/api/internal/schedule-message/:id', (req, res) => {
        const jobId = req.params.id;
        const { targets, groups, message, mediaUrl, templateName, scheduleType, scheduleData } = req.body;
        
        const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(jobId);
        if (!existing) return res.status(404).json({ error: 'Jadwal tidak ditemukan.' });

        db.prepare(`
            UPDATE schedules 
            SET targets = ?, groups = ?, message = ?, mediaUrl = ?, templateName = ?, scheduleType = ?, scheduleData = ?
            WHERE id = ?
        `).run(
            JSON.stringify(targets || []),
            JSON.stringify(groups || []),
            message || null,
            mediaUrl || null,
            templateName || null,
            scheduleType,
            JSON.stringify(scheduleData || {}),
            jobId
        );

        const updatedJob = { id: jobId, ...req.body, createdAt: existing.createdAt };
        
        if (activeCronJobs.has(jobId)) {
            activeCronJobs.get(jobId).stop();
            activeCronJobs.delete(jobId);
        }

        if (scheduleType !== 'once' && scheduleType !== 'now') {
            createCronJob(updatedJob);
        }

        io.emit('schedule_updated');
        res.json({ success: true, message: `Jadwal ${jobId} berhasil diperbarui.` });
    });

    // =================================================================
    //                         JALANKAN SERVER
    // =================================================================
    server.listen(PORT, '::', () => {
        log(`Server berjalan di http://localhost:${PORT}`);
        connectToWhatsApp().catch(err => log(`Gagal memulai koneksi WhatsApp: ${err}`, 'error'));
    });
    process.on('SIGINT', async () => {
        log('Menutup koneksi...');
        if (sock) await sock.end(new Error('Shutdown manual'));
        process.exit(0);
    });

}

// Panggil fungsi utama untuk menjalankan bot
startBot().catch(err => {
    console.error("Gagal menjalankan bot:", err);
});
