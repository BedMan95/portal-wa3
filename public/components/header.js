function getHeaderHTML(activePath) {
    const links = [
        { path: '/', label: 'Utama' },
        { path: '/validator.html', label: 'Validator' },
        { path: '/send.html', label: 'Kirim' },
        { path: '/scheduler.html', label: 'Jadwal' },
        { path: '/docs.html', label: 'Docs' },
        { path: '/settings.html', label: 'Pengaturan' }
    ];

    const navLinks = links.map(link => {
        const isActive = activePath === link.path ? 'active' : '';
        return `<a href="${link.path}" class="nav-link ${isActive}">${link.label}</a>`;
    }).join('\n                ');

    return `
    <header class="bg-white/80 backdrop-blur-lg border-b border-slate-200/80 sticky top-0 z-10">
        <nav class="container mx-auto px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div class="flex items-center space-x-3">
                 <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-600 to-emerald-500 flex items-center justify-center shadow-md shadow-teal-600/20">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                </div>
                <div>
                    <h1 class="text-lg font-bold text-slate-800 leading-none">Portal WA</h1>
                    <p class="text-[10px] text-teal-600 font-semibold uppercase tracking-wider mt-1">Nusa Edition</p>
                </div>
            </div>
            <div class="flex items-center flex-wrap justify-center gap-1.5">
                ${navLinks}
                <a href="/logout" class="px-4 py-2 text-sm rounded-lg font-semibold bg-red-50 text-red-600 hover:bg-red-100 transition-all ml-2">Logout</a>
            </div>
        </nav>
    </header>
    `;
}
