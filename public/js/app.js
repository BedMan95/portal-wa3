const routes = {
    '/': { title: 'Control Panel', file: '/pages/home.html' },
    '/send': { title: 'Kirim Media', file: '/pages/send.html' },
    '/scheduler': { title: 'Penjadwalan', file: '/pages/scheduler.html' },
    '/validator': { title: 'Validator', file: '/pages/validator.html' },
    '/docs': { title: 'API Docs', file: '/pages/docs.html' },
    '/settings': { title: 'Pengaturan', file: '/pages/settings.html' }
};

async function loadPage() {
    const path = window.location.hash.slice(1) || '/';
    const route = routes[path];

    if (!route) {
        document.getElementById('app-content').innerHTML = '<div class="p-8 text-center text-slate-500">Halaman tidak ditemukan.</div>';
        return;
    }

    document.title = `${route.title} - Portal WA`;
    
    // Update header active state
    document.getElementById('header-container').innerHTML = getHeaderHTML(path);

    // Fetch and load template
    try {
        const response = await fetch(route.file);
        if (!response.ok) throw new Error('Gagal memuat halaman');
        const html = await response.text();
        document.getElementById('app-content').innerHTML = html;
        initPageScripts(path);
    } catch (error) {
        document.getElementById('app-content').innerHTML = `<div class="p-8 text-center text-rose-500">${error.message}</div>`;
    }
}

function initPageScripts(path) {
    // Re-initialize scripts based on current path
    if (path === '/') {
        initHome();
    } else if (path === '/send') {
        initSend();
    } else if (path === '/scheduler') {
        initScheduler();
    } else if (path === '/validator') {
        initValidator();
    } else if (path === '/settings') {
        initSettings();
    }
}

window.addEventListener('hashchange', loadPage);
window.addEventListener('DOMContentLoaded', loadPage);

// --- Page Specific Scripts ---

function initHome() {
    // Initialize socket if not exists
    if(!window.socket) {
        window.socket = io();
    }

    // Remove existing listeners to prevent duplicates when navigating back
    window.socket.off('status');
    window.socket.off('log');

    // Request current status when returning to home page
    if (window.socket && window.socket.connected) {
        window.socket.emit('request_status');
    }

    window.socket.on('status', (data) => {
        const statusEl = document.getElementById('status');
        const statusBox = document.getElementById('status-box');
        const statusPulse = document.getElementById('status-pulse');
        const statusDot = document.getElementById('status-dot');
        const qrContainer = document.getElementById('qr-container');
        
        if(!statusEl) return;
        statusEl.textContent = data.status;
        
        if (data.status.includes('Terhubung')) {
            statusBox.className = 'p-4 rounded-xl bg-teal-50 text-teal-800 border border-teal-100/80 text-center';
            statusPulse.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75';
            statusDot.className = 'relative inline-flex rounded-full h-3 w-3 bg-teal-500';
        } else if (data.status.includes('Menunggu') || data.status.includes('Scan')) {
            statusBox.className = 'p-4 rounded-xl bg-amber-50 text-amber-800 border border-amber-100/80 text-center';
            statusPulse.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75';
            statusDot.className = 'relative inline-flex rounded-full h-3 w-3 bg-amber-500';
        } else {
            statusBox.className = 'p-4 rounded-xl bg-rose-50 text-rose-800 border border-rose-100/80 text-center';
            statusPulse.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75';
            statusDot.className = 'relative inline-flex rounded-full h-3 w-3 bg-rose-500';
        }

        if (data.qr) {
            qrContainer.style.display = 'flex';
            qrContainer.innerHTML = `
                <p class="text-xs text-slate-500 mb-3 font-semibold uppercase tracking-wider text-center">Scan QR Code dengan WhatsApp Anda</p>
                <div class="p-3 bg-white rounded-2xl border border-slate-200/60 shadow-sm">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(data.qr)}" alt="QR Code" class="rounded-lg shadow-sm">
                </div>
            `;
        } else {
            qrContainer.style.display = 'none';
            qrContainer.innerHTML = '';
        }
    });

    window.socket.on('log', (message) => {
        const logContainer = document.getElementById('server-log');
        if(!logContainer) return;
        const isScrolledToBottom = logContainer.scrollHeight - logContainer.clientHeight <= logContainer.scrollTop + 30;
        
        let formattedMsg = String(message);
        // Remove literal \n strings and actual newlines
        formattedMsg = formattedMsg.replace(/\\n/g, '').replace(/\n/g, '').trim();
        
        // Remove trailing \n if it exists at the end of the string
        if (formattedMsg.endsWith('\\n')) {
            formattedMsg = formattedMsg.slice(0, -2);
        }
        
        // Remove any remaining literal \n that might be escaped differently
        formattedMsg = formattedMsg.split('\\n').join('');
        
        // Remove literal \n that might be part of the string representation
        formattedMsg = formattedMsg.replace(/\\n/g, '');
        
        if (formattedMsg.includes('Error') || formattedMsg.includes('error') || formattedMsg.includes('Gagal')) {
            formattedMsg = `<span class="text-rose-400">${formattedMsg}</span>`;
        } else if (formattedMsg.includes('Terhubung') || formattedMsg.includes('berhasil')) {
            formattedMsg = `<span class="text-teal-400">${formattedMsg}</span>`;
        } else if (formattedMsg.includes('Menerima') || formattedMsg.includes('dijadwalkan')) {
            formattedMsg = `<span class="text-cyan-400">${formattedMsg}</span>`;
        }

        logContainer.innerHTML += formattedMsg + '<br>';
        
        if (isScrolledToBottom) {
            logContainer.scrollTop = logContainer.scrollHeight;
        }
    });

    const logoutBtn = document.getElementById('logout-wa-btn');
    if(logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            if (confirm('Anda yakin ingin logout dari WhatsApp dan menghapus sesi? Ini akan me-restart server.')) {
                try {
                    const response = await fetch('/api/internal/logout-wa', { method: 'POST', credentials: 'include' });
                    const result = await response.json();
                    alert(result.message);
                } catch (error) { alert('Gagal melakukan logout: ' + error.message); }
            }
        });
    }
}

function clearLogs() {
    const logContainer = document.getElementById('server-log');
    if(logContainer) {
        logContainer.innerHTML = '<span class="text-slate-500">// Terminal cleared by user. Waiting for logs...</span><br>';
    }
}

function initSend() {
    // Fetch groups
    fetch('/api/internal/get-groups')
        .then(res => res.json())
        .then(data => {
            const select = document.getElementById('groupSelect');
            if(select && Array.isArray(data)) {
                data.forEach(g => {
                    const opt = document.createElement('option');
                    opt.value = g.id;
                    opt.textContent = g.subject;
                    select.appendChild(opt);
                });
            }
        });

    const form = document.getElementById('mediaForm');
    if(form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('button[type="submit"]');
            if(submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = 'Mengirim...';
            }

            const personalTargets = document.getElementById('personalTargets').value;
            const groupId = document.getElementById('groupSelect').value;
            const caption = document.getElementById('caption').value;
            const fileInput = document.getElementById('fileInput');
            const urlInput = document.getElementById('urlInput').value;
            const textMessage = document.getElementById('textMessage').value;

            try {
                let response;
                
                if (textMessage && !fileInput.files[0] && !urlInput) {
                    // Send Text
                    response = await fetch('/api/internal/send-text', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ personalTargets, groupId, message: textMessage })
                    });
                } else if (urlInput) {
                    // Send Media URL
                    response = await fetch('/api/internal/send-media-url', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: urlInput, personalTargets, groupId, caption })
                    });
                } else if (fileInput.files[0]) {
                    // Send Media File
                    const formData = new FormData();
                    formData.append('file', fileInput.files[0]);
                    if (personalTargets) formData.append('personalTargets', personalTargets);
                    if (groupId) formData.append('groupId', groupId);
                    if (caption) formData.append('caption', caption);

                    response = await fetch('/api/internal/send-media', {
                        method: 'POST',
                        body: formData
                    });
                } else {
                    throw new Error('Pilih salah satu metode pengiriman (File, URL, atau Teks)');
                }

                const result = await response.json();
                if (response.ok) {
                    alert('Berhasil: ' + result.message);
                    form.reset();
                } else {
                    throw new Error(result.message || 'Gagal mengirim');
                }
            } catch (error) {
                alert('Error: ' + error.message);
            } finally {
                if(submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Kirim Sekarang';
                }
            }
        });
    }
}

function initScheduler() {
    // Fetch groups
    fetch('/api/internal/get-groups')
        .then(res => res.json())
        .then(data => {
            const select = document.getElementById('groupSelect');
            if(select && Array.isArray(data)) {
                data.forEach(g => {
                    const opt = document.createElement('option');
                    opt.value = g.id;
                    opt.textContent = g.subject;
                    select.appendChild(opt);
                });
            }
        });
    
    const form = document.getElementById('scheduleForm');
    if(form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const statusContainer = document.getElementById('status-container');
            const submitBtn = document.getElementById('submitBtn');
            const editJobId = document.getElementById('editJobId').value;
            
            submitBtn.disabled = true;
            submitBtn.innerHTML = 'Menyimpan...';
            statusContainer.className = 'hidden p-3 rounded-xl border text-sm';

            const targets = document.getElementById('targets').value.split(',').map(t => t.trim()).filter(t => t);
            const groupId = document.getElementById('groupSelect').value;
            const groups = groupId ? [groupId] : [];
            
            const payload = {
                targets,
                groups,
                message: document.getElementById('message').value,
                mediaUrl: document.getElementById('mediaUrl').value,
                scheduleType: document.getElementById('scheduleType').value,
                scheduleData: {
                    date: document.getElementById('date').value,
                    time: document.getElementById('time').value,
                    dayOfWeek: document.getElementById('dayOfWeek').value,
                    dayOfMonth: document.getElementById('dayOfMonth').value,
                    cron: document.getElementById('cron').value
                }
            };

            try {
                const url = editJobId ? `/api/internal/schedule-message/${editJobId}` : '/api/internal/schedule-message';
                const method = editJobId ? 'PUT' : 'POST';
                
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();
                
                statusContainer.classList.remove('hidden');
                if (response.ok) {
                    statusContainer.classList.add('bg-teal-50', 'text-teal-700', 'border-teal-200');
                    statusContainer.innerHTML = `<strong>Berhasil!</strong> ${result.message}`;
                    cancelEdit();
                    loadSchedules();
                } else {
                    throw new Error(result.message || 'Gagal menyimpan jadwal');
                }
            } catch (error) {
                statusContainer.classList.remove('hidden');
                statusContainer.classList.add('bg-rose-50', 'text-rose-700', 'border-rose-200');
                statusContainer.innerHTML = `<strong>Error:</strong> ${error.message}`;
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = editJobId ? 'Update Jadwal' : 'Simpan Jadwal';
            }
        });
    }
    
    // Load schedules initially
    loadSchedules();
    
    // Listen for updates
    if (window.socket) {
        window.socket.on('schedule_updated', loadSchedules);
    }
}

function cancelEdit() {
    const form = document.getElementById('scheduleForm');
    if(form) form.reset();
    document.getElementById('editJobId').value = '';
    document.getElementById('submitBtn').innerHTML = 'Simpan Jadwal';
    document.getElementById('cancelEditBtn').classList.add('hidden');
    toggleScheduleFields();
}

function editSchedule(jobStr) {
    const job = JSON.parse(decodeURIComponent(jobStr));
    
    document.getElementById('editJobId').value = job.id;
    document.getElementById('targets').value = (job.targets || []).join(', ');
    document.getElementById('groupSelect').value = (job.groups && job.groups.length > 0) ? job.groups[0] : '';
    document.getElementById('message').value = job.message || '';
    document.getElementById('mediaUrl').value = job.mediaUrl || '';
    document.getElementById('scheduleType').value = job.scheduleType;
    
    if (job.scheduleData) {
        if (job.scheduleData.date) document.getElementById('date').value = job.scheduleData.date;
        if (job.scheduleData.time) document.getElementById('time').value = job.scheduleData.time;
        if (job.scheduleData.dayOfWeek) document.getElementById('dayOfWeek').value = job.scheduleData.dayOfWeek;
        if (job.scheduleData.dayOfMonth) document.getElementById('dayOfMonth').value = job.scheduleData.dayOfMonth;
        if (job.scheduleData.cron) document.getElementById('cron').value = job.scheduleData.cron;
    }
    
    toggleScheduleFields();
    
    document.getElementById('submitBtn').innerHTML = 'Update Jadwal';
    document.getElementById('cancelEditBtn').classList.remove('hidden');
    
    // Scroll to form
    document.getElementById('scheduleForm').scrollIntoView({ behavior: 'smooth' });
}

async function loadSchedules() {
    const list = document.getElementById('schedulesList');
    if(!list) return;
    
    try {
        const res = await fetch('/api/internal/get-scheduled-jobs');
        const jobs = await res.json();
        
        if (jobs.length === 0) {
            list.innerHTML = `
                <div class="text-center py-12 text-slate-400">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-3 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>Belum ada jadwal aktif</p>
                </div>
            `;
            return;
        }
        
        list.innerHTML = jobs.map(job => {
            const typeLabels = {
                once: 'Sekali', daily: 'Harian', weekly: 'Mingguan', monthly: 'Bulanan', custom: 'Cron'
            };
            
            let timeStr = '';
            if (job.scheduleType === 'once') timeStr = `${job.scheduleData.date} ${job.scheduleData.time}`;
            else if (job.scheduleType === 'daily') timeStr = `Setiap hari, ${job.scheduleData.time}`;
            else if (job.scheduleType === 'weekly') timeStr = `Hari ke-${job.scheduleData.dayOfWeek}, ${job.scheduleData.time}`;
            else if (job.scheduleType === 'monthly') timeStr = `Tgl ${job.scheduleData.dayOfMonth}, ${job.scheduleData.time}`;
            else if (job.scheduleType === 'custom') timeStr = job.scheduleData.cron;
            
            let targetStr = '';
            if (job.targets && job.targets.length > 0) targetStr += `Personal: ${job.targets.join(', ')}`;
            if (job.groups && job.groups.length > 0) targetStr += (targetStr ? ' | ' : '') + `Grup: ${job.groups.join(', ')}`;
            if (!targetStr) targetStr = 'Tidak ada target';

            const nextRunStr = job.nextRun ? new Date(job.nextRun).toLocaleString('id-ID') : '-';
            const jobDataStr = encodeURIComponent(JSON.stringify(job));
            
            return `
                <div class="p-4 rounded-xl border border-slate-100 hover:border-teal-100 hover:shadow-md transition-all bg-slate-50/50 group">
                    <div class="flex justify-between items-start mb-2">
                        <div class="flex items-center space-x-2">
                            <span class="px-2 py-1 bg-teal-100 text-teal-700 text-[10px] font-bold uppercase tracking-wider rounded-md">
                                ${typeLabels[job.scheduleType] || job.scheduleType}
                            </span>
                            <span class="text-xs font-mono text-slate-400">ID: ${job.id.substring(0,8)}</span>
                        </div>
                        <div class="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onclick="editSchedule('${jobDataStr}')" class="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors" title="Edit">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                            </button>
                            <button onclick="deleteSchedule('${job.id}')" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Hapus">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        </div>
                    </div>
                    <p class="text-sm text-slate-700 font-medium mb-1 truncate">${job.message || '(Media Only)'}</p>
                    <div class="grid grid-cols-2 gap-2 text-xs text-slate-500 mt-3">
                        <div class="col-span-2">
                            <span class="block text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">Target</span>
                            <span class="truncate block" title="${targetStr}">${targetStr}</span>
                        </div>
                        <div>
                            <span class="block text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">Waktu</span>
                            ${timeStr}
                        </div>
                        <div>
                            <span class="block text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">Next Run</span>
                            ${nextRunStr}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        list.innerHTML = `<div class="p-4 text-rose-500 text-sm text-center">Gagal memuat jadwal: ${e.message}</div>`;
    }
}

async function deleteSchedule(id) {
    if(!confirm('Hapus jadwal ini?')) return;
    try {
        const res = await fetch(`/api/internal/schedule-message/${id}`, { method: 'DELETE' });
        if(res.ok) loadSchedules();
        else alert('Gagal menghapus jadwal');
    } catch(e) {
        alert('Error: ' + e.message);
    }
}

function toggleScheduleFields() {
    const type = document.getElementById('scheduleType').value;
    document.getElementById('dateField').classList.toggle('hidden', type !== 'once');
    document.getElementById('timeField').classList.toggle('hidden', type === 'custom');
    document.getElementById('dayOfWeekField').classList.toggle('hidden', type !== 'weekly');
    document.getElementById('dayOfMonthField').classList.toggle('hidden', type !== 'monthly');
    document.getElementById('cronField').classList.toggle('hidden', type !== 'custom');
}

function initSettings() {
    const changePasswordForm = document.getElementById('changePasswordForm');
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const oldPassword = document.getElementById('oldPassword').value;
            const newPassword = document.getElementById('newPassword').value;
            const status = document.getElementById('passwordStatus');
            
            try {
                const res = await fetch('/api/internal/users/password', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ oldPassword, newPassword })
                });
                const data = await res.json();
                
                status.classList.remove('hidden', 'text-rose-600', 'text-teal-600');
                if (res.ok) {
                    status.classList.add('text-teal-600');
                    status.textContent = data.message;
                    changePasswordForm.reset();
                } else {
                    status.classList.add('text-rose-600');
                    status.textContent = data.error;
                }
            } catch (err) {
                status.classList.remove('hidden');
                status.classList.add('text-rose-600');
                status.textContent = 'Terjadi kesalahan jaringan';
            }
        });
    }

    const addUserForm = document.getElementById('addUserForm');
    if (addUserForm) {
        addUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('newUsername').value;
            const password = document.getElementById('newUserPassword').value;
            
            try {
                const res = await fetch('/api/internal/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                
                if (res.ok) {
                    addUserForm.reset();
                    loadUsers();
                } else {
                    alert(data.error);
                }
            } catch (err) {
                alert('Terjadi kesalahan jaringan');
            }
        });
    }

    const toggleApiKeyBtn = document.getElementById('toggleApiKeyBtn');
    const apiKeyDisplay = document.getElementById('apiKeyDisplay');
    const generateApiKeyBtn = document.getElementById('generateApiKeyBtn');
    
    if (toggleApiKeyBtn && apiKeyDisplay) {
        toggleApiKeyBtn.addEventListener('click', () => {
            if (apiKeyDisplay.type === 'password') {
                apiKeyDisplay.type = 'text';
                document.getElementById('eyeIcon').innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />';
            } else {
                apiKeyDisplay.type = 'password';
                document.getElementById('eyeIcon').innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />';
            }
        });
    }

    if (generateApiKeyBtn && apiKeyDisplay) {
        generateApiKeyBtn.addEventListener('click', async () => {
            if (!confirm('Yakin ingin generate API Key baru? Key lama tidak akan bisa digunakan lagi.')) return;
            
            try {
                const res = await fetch('/api/internal/api-key/generate', { method: 'POST' });
                const data = await res.json();
                if (res.ok) {
                    apiKeyDisplay.value = data.apiKey;
                    alert('API Key berhasil diperbarui!');
                } else {
                    alert(data.error || 'Gagal generate API Key');
                }
            } catch (err) {
                alert('Terjadi kesalahan jaringan');
            }
        });
    }

    loadUsers();
    loadApiKey();
}

async function loadApiKey() {
    const display = document.getElementById('apiKeyDisplay');
    if (!display) return;
    try {
        const res = await fetch('/api/internal/api-key');
        const data = await res.json();
        display.value = data.apiKey || 'Tidak ada API Key di .env';
    } catch (e) {
        display.value = 'Gagal memuat API Key';
    }
}

async function loadUsers() {
    const list = document.getElementById('usersList');
    if (!list) return;
    
    try {
        const res = await fetch('/api/internal/users');
        const users = await res.json();
        
        list.innerHTML = users.map(u => `
            <div class="flex justify-between items-center p-2 hover:bg-slate-100 rounded-lg group">
                <span class="text-sm text-slate-700 font-medium">${u.username}</span>
                <button onclick="deleteUser(${u.id})" class="text-slate-400 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity" title="Hapus User">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<div class="text-xs text-rose-500">Gagal memuat user</div>';
    }
}

window.deleteUser = async function(id) {
    if (!confirm('Hapus user ini?')) return;
    try {
        const res = await fetch(`/api/internal/users/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadUsers();
        } else {
            const data = await res.json();
            alert(data.error);
        }
    } catch (e) {
        alert('Terjadi kesalahan jaringan');
    }
};

function initValidator() {
    const form = document.getElementById('validatorForm');
    if(form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const numberList = document.getElementById('number-list').value;
            const numbers = numberList.split('\\n').map(n => n.trim()).filter(n => n);
            
            if (numbers.length === 0) {
                alert('Masukkan setidaknya satu nomor untuk divalidasi.');
                return;
            }

            const startBtn = document.getElementById('start-check-btn');
            const progressContainer = document.getElementById('progress-container');
            const progressBar = document.getElementById('progress-bar');
            const progressPercent = document.getElementById('progress-percent');
            const progressText = document.getElementById('progress-text');
            const resultsContainer = document.getElementById('results-container');
            const resultsCount = document.getElementById('results-count');
            const actionButtons = document.getElementById('action-buttons');

            // Reset UI
            startBtn.disabled = true;
            startBtn.innerHTML = 'Memvalidasi...';
            progressContainer.classList.remove('hidden');
            resultsContainer.innerHTML = '';
            actionButtons.classList.add('hidden');
            
            let validCount = 0;
            let invalidCount = 0;
            const validNumbers = [];

            for (let i = 0; i < numbers.length; i++) {
                const number = numbers[i];
                
                // Update Progress
                const percent = Math.round(((i) / numbers.length) * 100);
                progressBar.style.width = `${percent}%`;
                progressPercent.textContent = `${percent}%`;
                progressText.textContent = `Memeriksa ${number}...`;

                try {
                    const response = await fetch('/api/internal/validate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ number })
                    });
                    
                    const result = await response.json();
                    
                    const resultEl = document.createElement('div');
                    resultEl.className = 'flex items-center justify-between p-2.5 rounded-lg bg-white border border-slate-100 shadow-sm';
                    
                    if (result.exists) {
                        validCount++;
                        validNumbers.push(result.jid.split('@')[0]);
                        resultEl.innerHTML = `
                            <div class="flex items-center space-x-3">
                                <span class="flex-shrink-0 w-6 h-6 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                </span>
                                <span class="font-semibold text-slate-700">${number}</span>
                            </div>
                            <span class="text-[10px] font-bold px-2 py-1 rounded-md bg-teal-50 text-teal-700 uppercase tracking-wider border border-teal-100">Valid</span>
                        `;
                    } else {
                        invalidCount++;
                        resultEl.innerHTML = `
                            <div class="flex items-center space-x-3">
                                <span class="flex-shrink-0 w-6 h-6 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </span>
                                <span class="font-semibold text-slate-700">${number}</span>
                            </div>
                            <span class="text-[10px] font-bold px-2 py-1 rounded-md bg-rose-50 text-rose-700 uppercase tracking-wider border border-rose-100">Tidak Valid</span>
                        `;
                    }
                    
                    resultsContainer.appendChild(resultEl);
                    resultsContainer.scrollTop = resultsContainer.scrollHeight;
                    
                } catch (error) {
                    invalidCount++;
                    const resultEl = document.createElement('div');
                    resultEl.className = 'flex items-center justify-between p-2.5 rounded-lg bg-white border border-slate-100 shadow-sm';
                    resultEl.innerHTML = `
                        <div class="flex items-center space-x-3">
                            <span class="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            </span>
                            <span class="font-semibold text-slate-700">${number}</span>
                        </div>
                        <span class="text-[10px] font-bold px-2 py-1 rounded-md bg-amber-50 text-amber-700 uppercase tracking-wider border border-amber-100">Error</span>
                    `;
                    resultsContainer.appendChild(resultEl);
                }
                
                // Small delay to prevent overwhelming the server/UI
                await new Promise(r => setTimeout(r, 300));
            }

            // Finish
            progressBar.style.width = '100%';
            progressPercent.textContent = '100%';
            progressText.textContent = 'Selesai!';
            
            resultsCount.innerHTML = `<span class="text-teal-600 font-bold">${validCount} Valid</span> / <span class="text-rose-500 font-bold">${invalidCount} Invalid</span>`;
            
            if (validNumbers.length > 0) {
                actionButtons.classList.remove('hidden');
                
                document.getElementById('copy-btn').onclick = () => {
                    navigator.clipboard.writeText(validNumbers.join('\\n'));
                    alert('Nomor valid disalin ke clipboard!');
                };
                
                document.getElementById('download-btn').onclick = () => {
                    const blob = new Blob([validNumbers.join('\\n')], { type: 'text/plain' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'nomor_valid.txt';
                    a.click();
                    window.URL.revokeObjectURL(url);
                };
            }

            startBtn.disabled = false;
            startBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z" clip-rule="evenodd" />
                </svg>
                <span>Mulai Validasi Massal</span>
            `;
        });
    }
}
