(function() {
    // Inject Styles
    const style = document.createElement('style');
    style.innerHTML = `
        :root {
            --user-bar-height: 35px;
        }
        
        /* The Top User Bar */
        .global-user-bar {
            width: 100%;
            height: var(--user-bar-height);
            background: #0f172a;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            justify-content: flex-end;
            padding: 0 20px;
            font-family: 'Inter', sans-serif;
            font-size: 12px;
            color: #94a3b8;
            z-index: 10001;
            position: relative;
        }

        .user-pill {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            padding: 4px 12px;
            border-radius: 20px;
            transition: all 0.2s;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .user-pill:hover {
            background: rgba(56, 189, 248, 0.1);
            border-color: rgba(56, 189, 248, 0.3);
            color: #38bdf8;
        }

        .user-pill .avatar-sm {
            width: 18px;
            height: 18px;
            background: #2563eb;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 9px;
            font-weight: 800;
        }

        /* Adjust body and containers to accommodate the bar */
        body {
            margin-top: 0 !important;
        }
        
        /* If page has fixed/sticky header, we need to adjust it */
        .main-header, .header {
            top: 0 !important; /* Keep it at top of its flow */
        }

        /* Profile Modal */
        .profile-modal-overlay {
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.7);
            backdrop-filter: blur(10px);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 10002;
        }
        .profile-modal {
            background: #1e293b;
            width: 100%;
            max-width: 400px;
            border-radius: 16px;
            border: 1px solid rgba(255,255,255,0.1);
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0,0,0,0.6);
            animation: modalFade 0.2s ease-out;
        }
        @keyframes modalFade {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
        }
        .profile-modal-header {
            background: linear-gradient(135deg, #1e293b, #0f172a);
            padding: 30px;
            text-align: center;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .profile-modal-header h2 { margin: 10px 0 0; font-size: 18px; font-weight: 700; color: #f8fafc; }
        .profile-modal-header p { margin: 4px 0 0; font-size: 13px; color: #38bdf8; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }

        .profile-modal-body { padding: 25px; }
        .info-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
        .info-icon { font-size: 16px; width: 24px; text-align: center; }
        .info-content .label { font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 700; }
        .info-content .value { font-size: 13px; color: #e2e8f0; }

        .profile-modal-footer {
            padding: 15px 25px;
            background: rgba(15, 23, 42, 0.5);
            border-top: 1px solid rgba(255,255,255,0.05);
            display: flex; justify-content: space-between; align-items: center;
        }
        .logout-link {
            color: #ef4444;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
        }
        .logout-link:hover { text-decoration: underline; }
        .close-link { color: #94a3b8; font-size: 13px; cursor: pointer; }
    `;
    document.head.appendChild(style);

    // HTML Structure
    const modalHTML = `
        <div id="profileModalOverlay" class="profile-modal-overlay">
            <div class="profile-modal">
                <div class="profile-modal-header">
                    <div id="profileAvatar" style="margin: 0 auto; width: 64px; height: 64px; background: #2563eb; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 800;"></div>
                    <h2 id="profileName">Loading...</h2>
                    <p id="profileDesignation">---</p>
                </div>
                <div class="profile-modal-body">
                    <div class="info-row">
                        <div class="info-icon">📧</div>
                        <div class="info-content"><div class="label">Email</div><div id="profileEmail" class="value">---</div></div>
                    </div>
                    <div class="info-row">
                        <div class="info-icon">📱</div>
                        <div class="info-content"><div class="label">Mobile</div><div id="profileMobile" class="value">---</div></div>
                    </div>
                    <div class="info-row">
                        <div class="info-icon">🏢</div>
                        <div class="info-content"><div class="label">Department</div><div id="profileDept" class="value">---</div></div>
                    </div>
                </div>
                <div class="profile-modal-footer">
                    <span class="close-link" onclick="document.getElementById('profileModalOverlay').style.display='none'">Close</span>
                    <a class="logout-link" id="logoutBtn">Logout System</a>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('afterbegin', `<div id="globalUserBar" class="global-user-bar"></div>`);
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    let currentUser = null;

    // Fetch User Info
    async function initProfile() {
        try {
            const res = await fetch('/api/agent-login/me');
            const data = await res.json();

            if (data.success && data.user) {
                currentUser = data.user;
                const user = data.user;
                const firstName = user.first_name || 'User';
                const lastName = user.last_name || '';
                const fullName = `${firstName} ${lastName}`;
                const initials = (firstName[0] || '') + (lastName[0] || '');

                // Populate Bar
                const bar = document.getElementById('globalUserBar');
                bar.innerHTML = `
                    <div class="user-pill" onclick="document.getElementById('profileModalOverlay').style.display='flex'">
                        <div class="avatar-sm">${initials.toUpperCase()}</div>
                        <span>Logged in as <strong>${firstName}</strong></span>
                    </div>
                `;

                // Populate Modal
                document.getElementById('profileName').innerText = fullName;
                document.getElementById('profileAvatar').innerText = initials.toUpperCase();
                document.getElementById('profileDesignation').innerText = user.designation_name || 'Employee';
                document.getElementById('profileEmail').innerText = user.email_primary || 'Not set';
                document.getElementById('profileMobile').innerText = user.mobile_primary || 'Not set';
                document.getElementById('profileDept').innerText = user.department_name || 'General';

                // Logout logic
                document.getElementById('logoutBtn').onclick = async () => {
                    await fetch('/api/agent-login/logout', { method: 'POST' });
                    window.location.href = 'agent_login.html';
                };
            }
        } catch (err) {
            console.error('Profile init failed', err);
        }
    }

    // Close on overlay click
    window.addEventListener('click', (e) => {
        const overlay = document.getElementById('profileModalOverlay');
        if (e.target === overlay) overlay.style.display = 'none';
    });

    initProfile();

    // Global navigation functions
    window.returnToPortal = function() {
        if (currentUser && currentUser.id_admin) {
            window.location.href = '/templates/admin.html';
        } else {
            window.location.href = '/templates/agent.html';
        }
    };
})();