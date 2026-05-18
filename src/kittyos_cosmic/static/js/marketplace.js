// Marketplace Management JavaScript

let currentPage = 1;
let currentSearch = '';
let accountStatus = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initAuth();
    loadInstalledModules();
    loadMarketplaceModules();
    initModals();
});

// Tab Management
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            
            // Update active states
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(`${tabName}-tab`).classList.add('active');
            
            // Load data if needed
            if (tabName === 'installed') {
                loadInstalledModules();
            } else if (tabName === 'browse') {
                loadMarketplaceModules();
            }
        });
    });
}

// Authentication Management
async function initAuth() {
    await checkAuthStatus();
    
    document.getElementById('login-btn').addEventListener('click', () => {
        openModal('login-modal');
    });
    
    document.getElementById('logout-btn').addEventListener('click', () => {
        logout();
    });
    
    document.getElementById('login-submit').addEventListener('click', handleLogin);
    document.getElementById('register-submit').addEventListener('click', handleRegister);
    document.getElementById('show-register').addEventListener('click', () => {
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('register-form').style.display = 'block';
    });
    document.getElementById('show-login').addEventListener('click', () => {
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('login-form').style.display = 'block';
    });
}

async function checkAuthStatus() {
    try {
        const response = await fetch('/api/market/status');
        const data = await response.json();
        
        if (data.success) {
            accountStatus = data;
            updateAuthUI(data);
        }
    } catch (error) {
        console.error('Error checking auth status:', error);
    }
}

function updateAuthUI(data) {
    const accountInfo = document.getElementById('account-info');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    
    if (data.logged_in && data.account) {
        accountInfo.textContent = `Logged in as ${data.account.username || data.account.email}`;
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'block';
    } else {
        accountInfo.textContent = 'Not logged in';
        loginBtn.style.display = 'block';
        logoutBtn.style.display = 'none';
    }
}

async function handleLogin() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const messageEl = document.getElementById('auth-message');
    
    if (!email || !password) {
        showMessage(messageEl, 'Please enter email and password', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/market/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showMessage(messageEl, 'Login successful!', 'success');
            setTimeout(() => {
                closeModal('login-modal');
                checkAuthStatus();
                loadMarketplaceModules(); // Refresh to show install buttons
            }, 1000);
        } else {
            showMessage(messageEl, data.error || 'Login failed', 'error');
        }
    } catch (error) {
        showMessage(messageEl, 'Error connecting to server', 'error');
        console.error('Login error:', error);
    }
}

async function handleRegister() {
    const email = document.getElementById('register-email').value;
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    const passwordConfirm = document.getElementById('register-password-confirm').value;
    const messageEl = document.getElementById('auth-message');
    
    if (!email || !username || !password || !passwordConfirm) {
        showMessage(messageEl, 'Please fill all fields', 'error');
        return;
    }
    
    if (password !== passwordConfirm) {
        showMessage(messageEl, 'Passwords do not match', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/market/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, username, password, password_confirm: passwordConfirm })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showMessage(messageEl, 'Registration successful! Please login.', 'success');
            setTimeout(() => {
                document.getElementById('register-form').style.display = 'none';
                document.getElementById('login-form').style.display = 'block';
            }, 1500);
        } else {
            showMessage(messageEl, data.error || 'Registration failed', 'error');
        }
    } catch (error) {
        showMessage(messageEl, 'Error connecting to server', 'error');
        console.error('Register error:', error);
    }
}

async function logout() {
    // Clear local state (server-side logout would require additional endpoint)
    accountStatus = null;
    updateAuthUI({ logged_in: false, account: null });
    loadMarketplaceModules(); // Refresh to hide install buttons
}

// Installed Modules
async function loadInstalledModules() {
    const listEl = document.getElementById('installed-list');
    listEl.innerHTML = '<div class="loading">Loading installed modules...</div>';
    
    try {
        const response = await fetch('/api/market/installed');
        const data = await response.json();
        
        if (data.success) {
            if (data.modules && data.modules.length > 0) {
                listEl.innerHTML = data.modules.map(module => createModuleCard(module, true)).join('');
                attachModuleActions(listEl, true);
            } else {
                listEl.innerHTML = '<div class="empty-state"><ion-icon name="cube-outline"></ion-icon><p>No modules installed</p></div>';
            }
        } else {
            listEl.innerHTML = `<div class="empty-state"><p>Error: ${data.error}</p></div>`;
        }
    } catch (error) {
        listEl.innerHTML = `<div class="empty-state"><p>Error loading modules: ${error.message}</p></div>`;
        console.error('Error loading installed modules:', error);
    }
}

document.getElementById('refresh-installed').addEventListener('click', loadInstalledModules);

// Marketplace Modules
async function loadMarketplaceModules(page = 1, search = '') {
    const listEl = document.getElementById('browse-list');
    listEl.innerHTML = '<div class="loading">Loading marketplace modules...</div>';
    
    try {
        const params = new URLSearchParams({ page, limit: 20 });
        if (search) {
            params.append('search', search);
        }
        
        const response = await fetch(`/api/market/list?${params}`);
        const data = await response.json();
        
        if (data.success) {
            if (data.modules && data.modules.length > 0) {
                listEl.innerHTML = data.modules.map(module => createModuleCard(module, false)).join('');
                attachModuleActions(listEl, false);
                
                // Update pagination
                if (data.total > data.limit) {
                    updatePagination(data.page, data.total, data.limit);
                } else {
                    document.getElementById('pagination').style.display = 'none';
                }
            } else {
                listEl.innerHTML = '<div class="empty-state"><ion-icon name="search-outline"></ion-icon><p>No modules found</p></div>';
                document.getElementById('pagination').style.display = 'none';
            }
        } else {
            listEl.innerHTML = `<div class="empty-state"><p>Error: ${data.error}</p></div>`;
        }
    } catch (error) {
        listEl.innerHTML = `<div class="empty-state"><p>Error loading modules: ${error.message}</p></div>`;
        console.error('Error loading marketplace modules:', error);
    }
}

function updatePagination(page, total, limit) {
    const paginationEl = document.getElementById('pagination');
    const pageInfoEl = document.getElementById('page-info');
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    
    const totalPages = Math.ceil(total / limit);
    pageInfoEl.textContent = `Page ${page} of ${totalPages}`;
    
    prevBtn.disabled = page <= 1;
    nextBtn.disabled = page >= totalPages;
    
    prevBtn.onclick = () => {
        currentPage = page - 1;
        loadMarketplaceModules(currentPage, currentSearch);
    };
    
    nextBtn.onclick = () => {
        currentPage = page + 1;
        loadMarketplaceModules(currentPage, currentSearch);
    };
    
    paginationEl.style.display = 'flex';
}

document.getElementById('search-btn').addEventListener('click', () => {
    currentSearch = document.getElementById('search-input').value;
    currentPage = 1;
    loadMarketplaceModules(currentPage, currentSearch);
});

document.getElementById('search-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        currentSearch = e.target.value;
        currentPage = 1;
        loadMarketplaceModules(currentPage, currentSearch);
    }
});

// Module Card Creation
function createModuleCard(module, isInstalled) {
    const price = module.price || 0;
    const currency = module.currency || 'USD';
    const isFree = price === 0;
    
    let badge = '';
    if (isInstalled) {
        badge = '<span class="module-badge installed">Installed</span>';
    } else if (isFree) {
        badge = '<span class="module-badge free">Free</span>';
    } else {
        badge = `<span class="module-badge paid">${price} ${currency}</span>`;
    }
    
    return `
        <div class="module-card" data-module-id="${module.id || module.marketplace_id || ''}">
            <div class="module-card-header">
                <h3>${escapeHtml(module.name || 'Unknown')}</h3>
                ${badge}
            </div>
            <div class="module-description">
                ${escapeHtml(module.description || 'No description available')}
            </div>
            <div class="module-meta">
                <span><ion-icon name="code-outline"></ion-icon> ${module.version || 'N/A'}</span>
                <span><ion-icon name="person-outline"></ion-icon> ${escapeHtml(module.author || 'Unknown')}</span>
            </div>
            <div class="module-actions">
                ${isInstalled 
                    ? `<button class="btn btn-danger uninstall-btn" data-module-id="${module.id || module.marketplace_id || ''}">
                        <ion-icon name="trash-outline"></ion-icon> Uninstall
                       </button>`
                    : `<button class="btn btn-primary install-btn" data-module-id="${module.id || module.marketplace_id || ''}">
                        <ion-icon name="download-outline"></ion-icon> Install
                       </button>`
                }
                <button class="btn btn-secondary info-btn" data-module-id="${module.id || module.marketplace_id || ''}">
                    <ion-icon name="information-circle-outline"></ion-icon> Info
                </button>
            </div>
        </div>
    `;
}

function attachModuleActions(containerEl, isInstalled) {
    // Install buttons
    containerEl.querySelectorAll('.install-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const moduleId = btn.dataset.moduleId;
            await installModule(moduleId);
        });
    });
    
    // Uninstall buttons
    containerEl.querySelectorAll('.uninstall-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const moduleId = btn.dataset.moduleId;
            if (confirm(`Are you sure you want to uninstall ${moduleId}?`)) {
                await uninstallModule(moduleId);
            }
        });
    });
    
    // Info buttons
    containerEl.querySelectorAll('.info-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const moduleId = btn.dataset.moduleId;
            await showModuleInfo(moduleId);
        });
    });
}

// Module Actions
async function installModule(moduleId) {
    try {
        const response = await fetch(`/api/market/install/${moduleId}`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Module installed successfully!');
            loadInstalledModules();
            loadMarketplaceModules(currentPage, currentSearch);
        } else {
            if (data.requires_login) {
                alert('Please login first to install modules');
                openModal('login-modal');
            } else {
                alert(`Installation failed: ${data.error}`);
            }
        }
    } catch (error) {
        alert(`Error installing module: ${error.message}`);
        console.error('Install error:', error);
    }
}

async function uninstallModule(moduleId) {
    try {
        const response = await fetch(`/api/market/uninstall/${moduleId}`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Module uninstalled successfully!');
            loadInstalledModules();
            loadMarketplaceModules(currentPage, currentSearch);
        } else {
            alert(`Uninstallation failed: ${data.error}`);
        }
    } catch (error) {
        alert(`Error uninstalling module: ${error.message}`);
        console.error('Uninstall error:', error);
    }
}

async function showModuleInfo(moduleId) {
    const modal = document.getElementById('module-modal');
    const contentEl = document.getElementById('module-info-content');
    const titleEl = document.getElementById('module-modal-title');
    
    contentEl.innerHTML = '<div class="loading">Loading module information...</div>';
    openModal('module-modal');
    
    try {
        const response = await fetch(`/api/market/info/${moduleId}`);
        const data = await response.json();
        
        if (data.success && data.module) {
            const module = data.module;
            titleEl.textContent = module.name || 'Module Information';
            
            contentEl.innerHTML = `
                <div class="module-info">
                    <div class="module-info-section">
                        <h3>Description</h3>
                        <p>${escapeHtml(module.description || 'No description available')}</p>
                    </div>
                    <div class="module-info-section">
                        <h3>Details</h3>
                        <p><strong>Version:</strong> ${escapeHtml(module.version || 'N/A')}</p>
                        <p><strong>Author:</strong> ${escapeHtml(module.author || 'Unknown')}</p>
                        <p><strong>Type:</strong> ${escapeHtml(module.extension_type || module.type || 'N/A')}</p>
                        <p><strong>Price:</strong> ${module.price === 0 ? 'Free' : `${module.price} ${module.currency || 'USD'}`}</p>
                    </div>
                    ${module.license ? `
                    <div class="module-info-section">
                        <h3>License</h3>
                        <p>${escapeHtml(module.license)}</p>
                    </div>
                    ` : ''}
                    ${module.compatibility ? `
                    <div class="module-info-section">
                        <h3>Compatibility</h3>
                        <p>KittySploit: ${module.compatibility.kittysploit_min || 'N/A'} - ${module.compatibility.kittysploit_max || 'N/A'}</p>
                    </div>
                    ` : ''}
                </div>
            `;
        } else {
            contentEl.innerHTML = `<div class="empty-state"><p>Error: ${data.error || 'Module not found'}</p></div>`;
        }
    } catch (error) {
        contentEl.innerHTML = `<div class="empty-state"><p>Error loading module information: ${error.message}</p></div>`;
        console.error('Error loading module info:', error);
    }
}

// Modal Management
function initModals() {
    // Close modals when clicking outside
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal.id);
            }
        });
    });
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        // Clear forms
        if (modalId === 'login-modal') {
            document.getElementById('login-form').style.display = 'block';
            document.getElementById('register-form').style.display = 'none';
            document.getElementById('login-email').value = '';
            document.getElementById('login-password').value = '';
            document.getElementById('register-email').value = '';
            document.getElementById('register-username').value = '';
            document.getElementById('register-password').value = '';
            document.getElementById('register-password-confirm').value = '';
            document.getElementById('auth-message').textContent = '';
        }
    }
}

function showMessage(element, message, type) {
    element.textContent = message;
    element.className = `message ${type}`;
    element.style.display = 'block';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
