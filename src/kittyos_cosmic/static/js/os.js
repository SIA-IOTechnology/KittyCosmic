class WindowManager {
    constructor() {
        this.desktop = document.getElementById('window-area');
        this.taskbarItems = document.getElementById('task-items');
        this.windows = [];
        this.zIndex = 100;
        this.activeWindowId = null;
    }

    notifyChanged() {
        // Persist window layout across page refreshes (handled by OS)
        try {
            if (window.os && typeof window.os.schedulePersistDesktopSession === 'function') {
                window.os.schedulePersistDesktopSession();
            }
        } catch (e) {
            // ignore persistence errors
        }
    }

    createWindow(options) {
        const id = 'win-' + Math.random().toString(36).substr(2, 9);
        const win = document.createElement('div');
        win.className = 'os-window';
        win.id = id;
        win.style.width = options.width || '600px';
        win.style.height = options.height || '400px';
        win.style.top = options.top || '100px';
        win.style.left = options.left || '100px';
        win.style.zIndex = ++this.zIndex;

        // Build header with optional custom buttons before window controls
        const headerCustomButtons = options.headerButtons || '';
        const titleIconHtml = options.titleIconSrc
            ? `<img src="${options.titleIconSrc}" alt="" class="window-title-icon"${options.titleIconId ? ` id="${options.titleIconId}"` : ''}>`
            : `<ion-icon name="${options.icon || 'browsers-outline'}"></ion-icon>`;

        win.innerHTML = `
            <div class="window-header">
                <div class="window-title">
                    ${titleIconHtml}
                    ${options.title || 'Application'}
                </div>
                <div class="window-controls">
                    ${headerCustomButtons}
                    <button class="win-btn win-minimize" onclick="os.wm.minimizeWindow('${id}')"></button>
                    <button class="win-btn win-maximize" onclick="os.wm.maximizeWindow('${id}')"></button>
                    <button class="win-btn win-close" onclick="os.wm.closeWindow('${id}')"></button>
                </div>
            </div>
            <div class="window-content" id="${id}-content">
                ${options.content || ''}
            </div>
            <div class="resizer resizer-br"></div>
        `;

        this.desktop.appendChild(win);

        const winObj = {
            id,
            element: win,
            title: options.title || 'App',
            icon: options.icon || 'browsers-outline',
            titleIconSrc: options.titleIconSrc || null,
            titleIconId: options.titleIconId || null,
            appId: options.appId || null,
            isMinimized: false,
            isMaximized: false,
            restoreRect: null,
            onFocus: options.onFocus,
            onClose: options.onClose
        };

        this.windows.push(winObj);
        this.addTaskbarItem(winObj);
        this.setupDrag(win);
        this.setupResize(win);
        this.focusWindow(id);

        // Execute onload callback if provided (e.g. for terminal init)
        if (options.onLoad) {
            setTimeout(() => options.onLoad(id), 0);
        }

        this.notifyChanged();
        return id;
    }

    closeWindow(id) {
        const winObj = this.windows.find(w => w.id === id);
        if (!winObj) return;

        if (winObj.onClose) winObj.onClose();

        winObj.element.remove();
        this.windows = this.windows.filter(w => w.id !== id);
        this.removeTaskbarItem(id);
        this.notifyChanged();
    }

    minimizeWindow(id) {
        const winObj = this.windows.find(w => w.id === id);
        if (!winObj) return;

        winObj.element.style.display = 'none';
        winObj.isMinimized = true;
        this.updateTaskbarItem(id);
        this.notifyChanged();
    }

    restoreWindow(id) {
        const winObj = this.windows.find(w => w.id === id);
        if (!winObj) return;

        winObj.element.style.display = 'flex';
        winObj.isMinimized = false;
        this.focusWindow(id);
        this.updateTaskbarItem(id);
        this.notifyChanged();
    }

    toggleMinimize(id) {
        const winObj = this.windows.find(w => w.id === id);
        if (!winObj) return;

        if (winObj.isMinimized) {
            this.restoreWindow(id);
        } else {
            if (this.activeWindowId === id) {
                this.minimizeWindow(id);
            } else {
                this.focusWindow(id);
            }
        }
    }

    maximizeWindow(id) {
        const winObj = this.windows.find(w => w.id === id);
        if (!winObj) return;

        if (winObj.isMaximized) {
            // Restore
            winObj.element.style.position = ''; // Reset to default (absolute)
            winObj.element.style.top = winObj.restoreRect.top;
            winObj.element.style.left = winObj.restoreRect.left;
            winObj.element.style.right = '';
            winObj.element.style.bottom = '';
            winObj.element.style.width = winObj.restoreRect.width;
            winObj.element.style.height = winObj.restoreRect.height;
            winObj.element.style.margin = '';
            winObj.isMaximized = false;
        } else {
            // Maximize - get actual viewport dimensions
            const taskbar = document.getElementById('taskbar');
            const taskbarHeight = taskbar ? taskbar.offsetHeight : 50; // Default to 50px if not found
            
            // Save current position and size for restore
            winObj.restoreRect = {
                top: winObj.element.style.top || winObj.element.offsetTop + 'px',
                left: winObj.element.style.left || winObj.element.offsetLeft + 'px',
                width: winObj.element.style.width || winObj.element.offsetWidth + 'px',
                height: winObj.element.style.height || winObj.element.offsetHeight + 'px'
            };
            
            // Set to full screen minus taskbar
            // Use fixed positioning to ensure it takes the full viewport
            winObj.element.style.position = 'fixed';
            winObj.element.style.top = '0';
            winObj.element.style.left = '0';
            winObj.element.style.right = '0';
            winObj.element.style.bottom = `${taskbarHeight}px`;
            winObj.element.style.width = '100%';
            winObj.element.style.height = `calc(100vh - ${taskbarHeight}px)`;
            winObj.element.style.margin = '0';
            winObj.isMaximized = true;
        }
        
        // Force recalculation of content height after maximize/restore
        // This ensures scrollbars appear correctly
        setTimeout(() => {
            const content = winObj.element.querySelector('.window-content');
            if (content) {
                // Force a reflow to ensure proper height calculation
                void content.offsetHeight;
                // Ensure overflow is set correctly
                content.style.overflowY = 'auto';
            }
            
            // Trigger resize event for terminal if it exists
            if (winObj.element.querySelector('.xterm')) {
                const event = new Event('resize');
                window.dispatchEvent(event);
            }
        }, 10);
        this.notifyChanged();
    }

    focusWindow(id) {
        const winObj = this.windows.find(w => w.id === id);
        if (!winObj) return;

        this.activeWindowId = id;
        winObj.element.style.zIndex = ++this.zIndex;

        // Update taskbar active state
        this.windows.forEach(w => {
            const item = document.getElementById(`task-${w.id}`);
            if (item) item.classList.remove('active');
        });
        const taskItem = document.getElementById(`task-${id}`);
        if (taskItem) taskItem.classList.add('active');

        if (winObj.onFocus) winObj.onFocus();
        this.notifyChanged();
    }

    addTaskbarItem(winObj) {
        const item = document.createElement('div');
        item.className = 'task-item active';
        item.id = `task-${winObj.id}`;
        // Create structure with icon and text separately for proper truncation
        let icon;
        if (winObj.titleIconSrc) {
            icon = document.createElement('img');
            icon.src = winObj.titleIconSrc;
            icon.alt = '';
            icon.className = 'task-item-title-icon';
            if (winObj.title === 'Tor Network') icon.classList.add('task-item-tor-icon');
        } else {
            icon = document.createElement('ion-icon');
            icon.setAttribute('name', winObj.icon);
        }
        const text = document.createElement('span');
        text.textContent = winObj.title;
        item.appendChild(icon);
        item.appendChild(text);
        item.onclick = () => this.toggleMinimize(winObj.id);
        
        // Add context menu (right-click) for closing window
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showTaskbarContextMenu(e, winObj.id);
        });
        
        this.taskbarItems.appendChild(item);
    }

    showTaskbarContextMenu(event, windowId) {
        // Remove any existing context menu
        const existingMenu = document.getElementById('taskbar-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        // Create context menu
        const menu = document.createElement('div');
        menu.id = 'taskbar-context-menu';
        menu.className = 'taskbar-context-menu';

        menu.innerHTML = `
            <div class="context-menu-item" data-action="close">
                <ion-icon name="close-outline"></ion-icon>
                <span>Close</span>
            </div>
        `;

        document.body.appendChild(menu);

        // Calculate position to keep menu in viewport
        const menuRect = menu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        let left = event.clientX;
        let top = event.clientY;

        // Adjust horizontal position if menu would overflow
        if (left + menuRect.width > viewportWidth) {
            left = viewportWidth - menuRect.width - 10;
        }
        if (left < 10) {
            left = 10;
        }

        // Adjust vertical position if menu would overflow (show above cursor)
        if (top + menuRect.height > viewportHeight) {
            top = event.clientY - menuRect.height;
        }
        if (top < 10) {
            top = 10;
        }

        menu.style.position = 'fixed';
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.style.zIndex = '10000';

        // Handle menu item clicks
        menu.querySelectorAll('.context-menu-item').forEach(menuItem => {
            menuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = menuItem.dataset.action;
                if (action === 'close') {
                    this.closeWindow(windowId);
                }
                menu.remove();
                document.removeEventListener('click', closeMenu);
                document.removeEventListener('contextmenu', closeMenu);
            });
        });

        // Close menu when clicking outside
        const closeMenu = (e) => {
            if (!menu.contains(e.target) && !e.target.closest('.task-item')) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
                document.removeEventListener('contextmenu', closeMenu);
            }
        };

        // Close menu after a short delay to allow the click event to register
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
            document.addEventListener('contextmenu', closeMenu);
        }, 100);
    }

    removeTaskbarItem(id) {
        const item = document.getElementById(`task-${id}`);
        if (item) item.remove();
    }

    updateTaskbarItem(id) {
        const winObj = this.windows.find(w => w.id === id);
        const item = document.getElementById(`task-${id}`);
        if (item) {
            if (winObj.isMinimized) item.classList.remove('active');
            else if (this.activeWindowId === id) item.classList.add('active');
        }
    }

    setupDrag(element) {
        const header = element.querySelector('.window-header');
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;
        let dragStartTimeout = null;
        let hasMoved = false;

        // Handle double-click to maximize/restore
        header.ondblclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Don't maximize if clicking on window controls
            if (e.target.closest('.window-controls')) return;
            // Don't maximize if clicking on header action buttons
            if (e.target.closest('.header-action-btn')) return;
            
            // Cancel any pending drag
            if (dragStartTimeout) {
                clearTimeout(dragStartTimeout);
                dragStartTimeout = null;
            }
            isDragging = false;
            
            this.focusWindow(element.id);
            this.maximizeWindow(element.id);
        };

        header.onmousedown = (e) => {
            e.preventDefault();
            this.focusWindow(element.id);
            if (e.target.closest('.window-controls')) return;
            if (e.target.closest('.header-action-btn')) return;

            hasMoved = false;
            startX = e.clientX;
            startY = e.clientY;
            initialLeft = element.offsetLeft;
            initialTop = element.offsetTop;

            // Small delay before starting drag to allow double-click detection
            dragStartTimeout = setTimeout(() => {
                if (!hasMoved) {
                    isDragging = true;
                }
            }, 150); // 150ms delay - shorter than double-click timeout (usually 300ms)

            const handleMouseMove = (e) => {
                const dx = Math.abs(e.clientX - startX);
                const dy = Math.abs(e.clientY - startY);
                
                // If mouse moved, mark as moved and start dragging
                if (dx > 3 || dy > 3) {
                    hasMoved = true;
                    if (dragStartTimeout) {
                        clearTimeout(dragStartTimeout);
                        dragStartTimeout = null;
                    }
                    isDragging = true;
                }
                
                if (isDragging) {
                    const moveX = e.clientX - startX;
                    const moveY = e.clientY - startY;
                    element.style.left = `${initialLeft + moveX}px`;
                    element.style.top = `${initialTop + moveY}px`;
                }
            };

            const handleMouseUp = () => {
                if (dragStartTimeout) {
                    clearTimeout(dragStartTimeout);
                    dragStartTimeout = null;
                }
                isDragging = false;
                hasMoved = false;
                document.onmousemove = null;
                document.onmouseup = null;
                this.notifyChanged();
            };

            document.onmousemove = handleMouseMove;
            document.onmouseup = handleMouseUp;
        };
    }

    setupResize(element) {
        const resizer = element.querySelector('.resizer-br');
        if (!resizer) return;

        resizer.onmousedown = (e) => {
            e.preventDefault();
            this.focusWindow(element.id);

            const startX = e.clientX;
            const startY = e.clientY;
            const startW = parseInt(document.defaultView.getComputedStyle(element).width, 10);
            const startH = parseInt(document.defaultView.getComputedStyle(element).height, 10);

            document.onmousemove = (e) => {
                element.style.width = (startW + e.clientX - startX) + 'px';
                element.style.height = (startH + e.clientY - startY) + 'px';
            };

            document.onmouseup = () => {
                document.onmousemove = null;
                document.onmouseup = null;
                this.notifyChanged();
            };
        };
    }
}

class OS {
    constructor() {
        this.wm = new WindowManager();
        this.socket = null;
        this.terminals = []; // Track terminal instances
        this.startOpen = false; // Track start menu state
        this._desktopPersistTimer = null;
        this._restoringDesktopSession = false;
        
        // Initialize sound and Tor states from localStorage
        this.soundEnabled = localStorage.getItem('soundEnabled') !== 'false'; // Default: enabled
        // Tor state will be loaded from server on socket connect, but use localStorage as fallback
        this.torConnected = localStorage.getItem('torConnected') === 'true'; // Default: disconnected
        this.torWindowId = null; // Track Tor configuration window ID
        
        // Initialize custom targets from localStorage
        this.customTargets = JSON.parse(localStorage.getItem('kittyos_custom_targets') || '[]');
        
        // Menu categories structure
        this.menuCategories = {
            'communication': {
                name: 'Communication',
                icon: 'chatbubbles-outline',
                items: [
                    { id: 'terminal', name: 'Terminal', icon: 'terminal-outline' },
                    { id: 'irc', name: 'IRC KittySploit', icon: 'chatbubbles-outline' },
                    { id: 'chat_server', name: 'Chat Server', icon: 'chatbox-ellipses-outline' }
                ]
            },
            'network': {
                name: 'Network & Security',
                icon: 'shield-checkmark-outline',
                items: [
                    { id: 'kittyproxy', name: 'KittyProxy', icon: 'shield-checkmark-outline' },
                    { id: 'browser_server', name: 'Browser Server', icon: 'globe-outline' },
                    { id: 'network', name: 'Hosts & Vuln', icon: 'bug-outline' },
                    { id: 'ports', name: 'Port Monitor', icon: 'server-outline' },
                    { id: 'scanner', name: 'Scanner', icon: 'scan-outline' },
                    { id: 'agent_launcher', name: 'Agent Launcher', icon: 'hardware-chip-outline' },
                    { id: 'listeners', name: 'Listener Manager', icon: 'radio-outline' },
                    { id: 'backdoor_generator', name: 'Backdoor Generator', icon: 'key-outline' },
                    { id: 'web_delivery', name: 'Web Delivery', icon: 'cloud-download-outline' },
                    { id: 'vnc', name: 'VNC Client', icon: 'desktop-outline' }
                ]
            },
            'development': {
                name: 'Development',
                icon: 'code-outline',
                items: [
                    { id: 'module_launcher', name: 'Module Launcher', icon: 'rocket-outline' },
                    { id: 'ide', name: 'Module IDE', icon: 'code-outline' },
                    { id: 'interpreter', name: 'Interpreter', icon: 'code-slash-outline' },
                    { id: 'workflows', name: 'Workflows', icon: 'git-branch-outline' },
                    { id: 'collab', name: 'KittyCollab', icon: 'code-slash-outline' },
                    { id: 'marketplace', name: 'Marketplace', icon: 'storefront-outline' }
                ]
            },
            'management': {
                name: 'Management',
                icon: 'briefcase-outline',
                items: [
                    { id: 'network_map', name: 'Network Map', icon: 'map-outline' },
                    { id: 'sessions', name: 'Sessions', icon: 'people-outline' },
                    { id: 'jobs', name: 'Jobs', icon: 'briefcase-outline' },
                    { id: 'file_explorer', name: 'File Explorer', icon: 'folder-open-outline' },
                    { id: 'docker_environments', name: 'Docker Environments', icon: 'cube-outline' },
                    { id: 'notes', name: 'Notes', icon: 'document-text-outline' }
                ]
            },
            'documentation': {
                name: 'Documentation',
                icon: 'book-outline',
                items: [
                    { id: 'docs', name: 'Documentation', icon: 'book-outline' }
                ]
            },
            'plugins': {
                name: 'Plugins',
                icon: 'extension-puzzle-outline',
                items: [] // Will be populated dynamically
            },
            'system': {
                name: 'System',
                icon: 'settings-outline',
                items: [
                    { id: 'settings', name: 'Settings', icon: 'settings-outline' },
                    { id: 'about', name: 'About', icon: 'information-circle-outline' }
                ]
            }
        };
        
        this.initSocket();
        this.initClock();
        this.initSystemMonitor();
        this.initSessionsCounter();
        this.initFrameworkVersion();
        this.initSearch();
        this.loadWorkspaces();
        this.loadGuardians();
        this.initFullscreen();
        this.initTrayIcons();
        this.initWifiIcon();

        // Close start menu on click outside
        document.addEventListener('click', (e) => {
            if (this.startOpen && !e.target.closest('#start-menu') && !e.target.closest('#start-btn')) {
                this.toggleStartMenu();
            }

            // Close search results when clicking outside
            if (!e.target.closest('.search-container')) {
                const results = document.getElementById('search-results');
                if (results) results.classList.remove('show');
            }

            // Close submenus when clicking outside
            if (!e.target.closest('.start-item-submenu') && !e.target.closest('.start-submenu') && !e.target.closest('.start-category-item')) {
                document.querySelectorAll('.start-submenu').forEach(submenu => {
                    submenu.classList.remove('show');
                });
            }
        });

        // Initialize plugins submenu
        this.initPluginsSubmenu();
        
        // Build categorized menu
        this.buildCategorizedMenu();

        // Load desktop apps preferences
        this.loadDesktopAppsPreferences();

        // Restore window layout (open windows / positions / sizes) after refresh
        this.restoreDesktopSession();
    }
    
    async loadDesktopAppsPreferences() {
        try {
            const res = await fetch('/api/desktop-apps/preferences');
            const data = await res.json();
            
            if (data.success && data.apps) {
                // Hide/show desktop icons based on preferences
                Object.entries(data.apps).forEach(([appId, appInfo]) => {
                    const icon = document.querySelector(`.desktop-icon[data-app-id="${appId}"]`);
                    if (icon) {
                        if (appInfo.visible === false) {
                            icon.style.display = 'none';
                        } else {
                            icon.style.display = 'flex';
                        }
                    }
                });
            }
        } catch (err) {
            console.warn('Could not load desktop apps preferences:', err);
            // If loading fails, show all icons by default
            document.querySelectorAll('.desktop-icon').forEach(icon => {
                icon.style.display = 'flex';
            });
        }
    }
    
    buildCategorizedMenu() {
        const startItems = document.querySelector('.start-items');
        if (!startItems) {
            console.warn('Start items container not found, retrying...');
            setTimeout(() => this.buildCategorizedMenu(), 100);
            return;
        }
        
        // Clear existing items
        startItems.innerHTML = '';
        
        // Build menu from categories - only show category headers
        Object.entries(this.menuCategories).forEach(([categoryId, category]) => {
            // Create category item (clickable/hoverable)
            const categoryItem = document.createElement('div');
            categoryItem.className = 'start-item start-category-item';
            categoryItem.setAttribute('data-category', categoryId);
            categoryItem.innerHTML = `
                <ion-icon name="${category.icon}"></ion-icon>
                <span>${category.name}</span>
                <ion-icon name="chevron-forward-outline" style="margin-left: auto; font-size: 14px;"></ion-icon>
            `;
            
            // Create submenu for this category
            const categorySubmenu = document.createElement('div');
            categorySubmenu.className = 'start-submenu start-category-submenu';
            categorySubmenu.id = `submenu-${categoryId}`;
            categorySubmenu.innerHTML = `
                <div class="submenu-header">
                    <ion-icon name="${category.icon}"></ion-icon>
                    ${category.name}
                </div>
                <div class="submenu-items" id="submenu-items-${categoryId}">
                    ${category.items.length > 0 ? category.items.map(item => {
                        if (item.submenu) {
                            // Special submenu item (like Plugins)
                            return `
                                <div class="submenu-item start-item-submenu" data-submenu="${item.id}">
                                    <div class="submenu-item-name">
                                        <ion-icon name="${item.icon}"></ion-icon>
                                        ${item.name}
                                        <ion-icon name="chevron-forward-outline" style="margin-left: auto; font-size: 12px;"></ion-icon>
                                    </div>
                                </div>
                            `;
                        } else {
                            // Regular app item
                            return `
                                <div class="submenu-item" onclick="os.openApp('${item.id}')">
                                    <div class="submenu-item-name">
                                        <ion-icon name="${item.icon}"></ion-icon>
                                        ${item.name}
                                    </div>
                                </div>
                            `;
                        }
                    }).join('') : (categoryId === 'plugins' ? '<div class="submenu-empty">Loading plugins...</div>' : '<div class="submenu-empty">No items</div>')}
                </div>
            `;
            
            // Append category item and submenu to menu
            startItems.appendChild(categoryItem);
            startItems.appendChild(categorySubmenu);
        });
        
        // Initialize category submenus
        this.initCategorySubmenus();
        
        // Re-initialize plugins submenu after rebuilding menu
        setTimeout(() => {
            this.initPluginsSubmenu();
        }, 100);
    }
    
    initCategorySubmenus() {
        // Function to close ALL submenus (category submenus)
        // Force immediate closure with display:none to prevent any visual persistence
        const closeAllSubmenus = (exceptCategoryId = null) => {
            // Close all category submenus - force with both class removal and display:none
            document.querySelectorAll('.start-category-submenu').forEach(submenu => {
                if (exceptCategoryId && submenu.id === `submenu-${exceptCategoryId}`) {
                    return; // Don't close the one we're opening
                }
                submenu.classList.remove('show');
                // Force hide with display to prevent any visual persistence
                submenu.style.display = 'none';
            });
        };
        
        document.querySelectorAll('.start-category-item').forEach(categoryItem => {
            const categoryId = categoryItem.getAttribute('data-category');
            const submenu = document.getElementById(`submenu-${categoryId}`);
            if (!submenu) return;
            
            // Function to position submenu
            const positionSubmenu = () => {
                const rect = categoryItem.getBoundingClientRect();
                const startMenu = document.getElementById('start-menu');
                if (!startMenu) return;
                
                const startMenuRect = startMenu.getBoundingClientRect();
                
                // Position submenu to the right of the category item
                const left = rect.right - startMenuRect.left + 5;
                
                // Align top of submenu with top of category item
                const itemTop = rect.top - startMenuRect.top;
                let top = itemTop;
                
                // Force a reflow to get submenu height
                submenu.style.visibility = 'hidden';
                submenu.style.display = 'flex';
                const submenuHeight = submenu.offsetHeight;
                submenu.style.visibility = '';
                
                // Adjust if submenu would go below viewport
                const viewportHeight = window.innerHeight;
                const maxTop = viewportHeight - submenuHeight - startMenuRect.top - 10;
                if (top > maxTop) {
                    top = Math.max(0, maxTop);
                }
                
                submenu.style.position = 'absolute';
                submenu.style.left = `${left}px`;
                submenu.style.top = `${top}px`;
                submenu.style.right = 'auto';
                submenu.style.bottom = 'auto';
                
                // Force a reflow
                void submenu.offsetHeight;
                
                // Final adjustment check
                setTimeout(() => {
                    const submenuRect = submenu.getBoundingClientRect();
                    const viewportWidth = window.innerWidth;
                    const viewportHeight = window.innerHeight;
                    const startMenuRect = startMenu.getBoundingClientRect();
                    
                    // Check if submenu goes off the right edge - position to the left instead
                    if (submenuRect.right > viewportWidth - 10) {
                        submenu.style.left = `${rect.left - startMenuRect.left - 285}px`;
                    }
                    
                    // Ensure submenu doesn't go above the start menu
                    if (submenuRect.top < startMenuRect.top) {
                        submenu.style.top = '0px';
                    }
                    
                    // Ensure submenu doesn't go below the viewport
                    if (submenuRect.bottom > viewportHeight - 10) {
                        const maxTop = viewportHeight - submenuHeight - startMenuRect.top - 10;
                        submenu.style.top = `${Math.max(0, maxTop)}px`;
                    }
                }, 0);
            };
            
            // Show/hide submenu on hover
            categoryItem.addEventListener('mouseenter', () => {
                // CRITICAL: Close ALL other submenus FIRST, before doing anything else
                // Use requestAnimationFrame to ensure DOM updates happen immediately
                requestAnimationFrame(() => {
                    closeAllSubmenus(categoryId);
                    
                    // Small delay to ensure closure is processed
                    requestAnimationFrame(() => {
                        // Now position and show the correct submenu
                        positionSubmenu();
                        submenu.style.display = 'flex'; // Ensure it's visible
                        submenu.classList.add('show');
                    });
                });
            });
            
            categoryItem.addEventListener('mouseleave', (e) => {
                const relatedTarget = e.relatedTarget;
                
                // PRIORITY: If mouse is moving to another category item, close this submenu IMMEDIATELY
                if (relatedTarget) {
                    const targetCategoryItem = relatedTarget.closest('.start-category-item');
                    if (targetCategoryItem && targetCategoryItem !== categoryItem) {
                        // Moving to another category - close this submenu immediately and force hide
                        submenu.classList.remove('show');
                        submenu.style.display = 'none';
                        return;
                    }
                }
                
                // Check if mouse is moving to this specific submenu
                if (relatedTarget && submenu.contains(relatedTarget)) {
                    return; // Keep submenu open if moving to it
                }
                
                // If mouse is moving to another submenu (not this one), close this one
                if (relatedTarget) {
                    const targetSubmenu = relatedTarget.closest('.start-submenu');
                    if (targetSubmenu && targetSubmenu !== submenu) {
                        submenu.classList.remove('show');
                        submenu.style.display = 'none';
                        return;
                    }
                }
                
                // Small delay for smooth transition only if mouse is leaving the area completely
                setTimeout(() => {
                    if (!submenu.matches(':hover') && !categoryItem.matches(':hover')) {
                        submenu.classList.remove('show');
                        submenu.style.display = 'none';
                    }
                }, 100);
            });
            
            submenu.addEventListener('mouseenter', () => {
                // Ensure this submenu stays open
                submenu.style.display = 'flex';
                submenu.classList.add('show');
            });
            
            submenu.addEventListener('mouseleave', (e) => {
                const relatedTarget = e.relatedTarget;
                
                // PRIORITY: If mouse is moving to another category item, close this submenu IMMEDIATELY
                if (relatedTarget) {
                    const targetCategoryItem = relatedTarget.closest('.start-category-item');
                    if (targetCategoryItem) {
                        // Moving to another category - close this submenu immediately and force hide
                        submenu.classList.remove('show');
                        submenu.style.display = 'none';
                        return;
                    }
                }
                
                // Check if mouse is moving back to the category item
                if (relatedTarget && categoryItem.contains(relatedTarget)) {
                    return;
                }
                
                // Check if mouse is moving to another submenu
                if (relatedTarget && relatedTarget.closest('.start-submenu') && !submenu.contains(relatedTarget)) {
                    // Moving to another submenu, close this one
                    submenu.classList.remove('show');
                    submenu.style.display = 'none';
                    return;
                }
                
                submenu.classList.remove('show');
                submenu.style.display = 'none';
            });
        });
    }

    initPluginsSubmenu() {
        // Find plugins category submenu
        const pluginsSubmenu = document.getElementById('submenu-plugins');
        if (!pluginsSubmenu) {
            console.warn('Plugins category submenu not found');
            return;
        }

        const pluginsList = pluginsSubmenu.querySelector('#submenu-items-plugins');
        if (!pluginsList) {
            console.warn('Plugins list container not found');
            return;
        }

        // Load plugins when category submenu is shown
        const pluginsCategoryItem = document.querySelector('.start-category-item[data-category="plugins"]');
        if (pluginsCategoryItem) {
            // Add event listener to load plugins when category is hovered
            pluginsCategoryItem.addEventListener('mouseenter', () => {
                this.loadPluginsList(pluginsList);
            });
        }

        // Also load plugins when submenu is shown
        pluginsSubmenu.addEventListener('mouseenter', () => {
            this.loadPluginsList(pluginsList);
        });
    }

    async loadPluginsList(pluginsListContainer = null) {
        // The start menu can be rebuilt/removed; callers may pass a stale node.
        // If the provided container is detached, re-resolve from the live DOM.
        let resolvedContainer = pluginsListContainer;
        if (resolvedContainer && (!resolvedContainer.isConnected || !resolvedContainer.parentNode)) {
            resolvedContainer = null;
        }

        const pluginsList = resolvedContainer || document.getElementById('plugins-list') || document.querySelector('#submenu-items-plugins');
        if (!pluginsList) {
            console.warn('Plugins list container not found');
            return;
        }

        try {
            const res = await fetch('/api/plugins/list');
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }
            const data = await res.json();
            const plugins = data.plugins || [];

            if (plugins.length === 0) {
                pluginsList.innerHTML = '<div class="submenu-empty">No plugins loaded</div>';
                return;
            }

            pluginsList.innerHTML = plugins.map(plugin => {
                const safeNameAttr = encodeURIComponent(plugin.name || '');
                const pluginName = plugin.name || '';
                return `
                    <div class="submenu-item plugin-item" data-plugin-name="${safeNameAttr}" style="cursor: pointer; user-select: none;" data-plugin-name-raw="${pluginName}">
                        <div class="submenu-item-name">
                            <ion-icon name="extension-puzzle-outline" style="font-size: 16px; color: var(--accent-color); pointer-events: none;"></ion-icon>
                            <span style="pointer-events: none;">${plugin.name}</span>
                        </div>
                        ${plugin.description ? `<div class="submenu-item-desc" style="pointer-events: none;">${plugin.description}</div>` : ''}
                        <div class="submenu-item-meta" style="pointer-events: none;">
                            ${plugin.version ? `<span>v${plugin.version}</span>` : ''}
                            ${plugin.author ? `<span>by ${plugin.author}</span>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            // Use event delegation; bind once per container to avoid duplicates.
            const self = this;
            if (!pluginsList.dataset.pluginClickBound) {
                pluginsList.addEventListener('click', function(e) {
                    // Try multiple ways to find the plugin item
                    let pluginItem = e.target.closest('.plugin-item');
                    
                    if (!pluginItem) {
                        console.log('Plugin item not found, target:', e.target, 'closest:', e.target.closest('.plugin-item'));
                        return;
                    }

                    e.preventDefault();
                    e.stopPropagation();

                    // Try both encoded and raw name
                    const encodedName = pluginItem.dataset.pluginName || '';
                    const rawName = pluginItem.dataset.pluginNameRaw || '';
                    let pluginName = '';
                    
                    if (encodedName) {
                        try {
                            pluginName = decodeURIComponent(encodedName);
                        } catch (err) {
                            pluginName = encodedName;
                        }
                    } else if (rawName) {
                        pluginName = rawName;
                    }
                    
                    if (!pluginName) {
                        console.warn('Plugin name is empty, encodedName:', encodedName, 'rawName:', rawName);
                        return;
                    }

                    console.log('Loading plugin:', pluginName);
                    
                    // Close start menu first
                    if (self.startOpen) {
                        self.toggleStartMenu();
                    }
                    
                    // Spawn terminal with plugin load command after a small delay
                    setTimeout(() => {
                        self.spawnTerminal(`plugin run ${pluginName} --help`);
                    }, 100);
                });
                pluginsList.dataset.pluginClickBound = '1';
            }
        } catch (err) {
            console.error('Error loading plugins:', err);
            pluginsList.innerHTML = `<div class="submenu-empty">Error loading plugins: ${err.message}</div>`;
        }
    }

    initSocket() {
        try {
            this.socket = io();
            this.socket.on('connect', () => {
                console.log('Connected to backend');
                // Update WiFi icon to connected state
                this.updateWifiIcon(true);
                // Re-join terminal sessions to ensure output delivery after reconnect
                this.terminals.forEach(term => {
                    if (term.sessionId) {
                        this.socket.emit('join_terminal_session', { session_id: term.sessionId });
                    }
                });
            });

            this.socket.on('disconnect', () => {
                console.log('Disconnected from backend');
                // Update WiFi icon to disconnected state
                this.updateWifiIcon(false);
            });

            // Listen for sound state changes from backend (from terminal command or icon click)
            this.socket.on('sound_state_changed', (data) => {
                const enabled = data.enabled !== false; // Default to true if not specified
                this.soundEnabled = enabled;
                this.updateSoundIcon();
                // Update localStorage to persist state
                localStorage.setItem('soundEnabled', this.soundEnabled);
            });

            // Listen for Tor state changes from backend
            this.socket.on('tor_connected', (data) => {
                if (data.success && data.status) {
                    this.torConnected = data.status.enabled || true;
                    this.updateTorIcon();
                    localStorage.setItem('torConnected', this.torConnected);
                    // Restore connect button
                    const connectBtn = document.getElementById('tor-connect-btn');
                    if (connectBtn) {
                        connectBtn.disabled = false;
                        connectBtn.style.opacity = '1';
                        connectBtn.style.cursor = 'pointer';
                        connectBtn.style.background = '#da3633';
                        connectBtn.innerHTML = 'Disconnect';
                    }
                    // Refresh Tor window if open
                    if (this.torWindowId) {
                        this.closeTorWindow();
                        setTimeout(() => this.openTorWindow(), 100);
                    }
                }
            });

            this.socket.on('tor_disconnected', (data) => {
                if (data.success && data.status) {
                    this.torConnected = data.status.enabled || false;
                    this.updateTorIcon();
                    localStorage.setItem('torConnected', this.torConnected);
                    // Restore connect button
                    const connectBtn = document.getElementById('tor-connect-btn');
                    if (connectBtn) {
                        connectBtn.disabled = false;
                        connectBtn.style.opacity = '1';
                        connectBtn.style.cursor = 'pointer';
                        connectBtn.style.background = '#238636';
                        connectBtn.innerHTML = 'Connect';
                    }
                    // Refresh Tor window if open
                    if (this.torWindowId) {
                        this.closeTorWindow();
                        setTimeout(() => this.openTorWindow(), 100);
                    }
                }
            });

            this.socket.on('tor_error', (data) => {
                console.error('Tor error:', data.error);
                // Restore connect button on error
                const connectBtn = document.getElementById('tor-connect-btn');
                if (connectBtn) {
                    connectBtn.disabled = false;
                    connectBtn.style.opacity = '1';
                    connectBtn.style.cursor = 'pointer';
                    const isConnected = this.torConnected;
                    connectBtn.style.background = isConnected ? '#da3633' : '#238636';
                    connectBtn.innerHTML = isConnected ? 'Disconnect' : 'Connect';
                }
                if (this.showNotification) {
                    this.showNotification('Tor Error: ' + data.error, 'error');
                }
            });

            this.socket.on('tor_status_response', (data) => {
                if (data.status) {
                    this.torConnected = data.status.enabled || false;
                    this.updateTorIcon();
                    localStorage.setItem('torConnected', this.torConnected);
                }
            });

            // Request initial Tor status on connect
            this.socket.emit('tor_status');

            // Note: Terminal output is now handled per-terminal, not globally
            // Each terminal registers its own listener in spawnTerminal()

        } catch (e) {
            console.error('Socket not available');
            this.updateWifiIcon(false);
        }
    }

    initClock() {
        const updateClock = () => {
            const now = new Date();
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const clock = document.getElementById('clock');
            if (clock) {
                clock.textContent = `${hours}:${minutes}`;
            }
        };
        updateClock();
        setInterval(updateClock, 1000);
    }

    initSessionsCounter() {
        const updateSessionsCount = async () => {
            try {
                const res = await fetch('/api/sessions');
                if (res.ok) {
                    const data = await res.json();
                    const sessions = data.sessions || [];
                    const activeSessions = sessions.filter(s => s.active !== false);
                    const sessionsCountElement = document.getElementById('sessions-count');
                    if (sessionsCountElement) {
                        sessionsCountElement.textContent = activeSessions.length;
                    }
                }
            } catch (err) {
                console.error('Error updating sessions count:', err);
            }
        };
        
        // Update immediately
        updateSessionsCount();
        // Update every 5 seconds
        setInterval(updateSessionsCount, 5000);
    }

    initSystemMonitor() {
        // Update system stats every 2 seconds
        const updateStats = async () => {
            // Prefer realtime via Socket.IO when connected
            if (this.socket && this.socket.connected) {
                this.socket.emit('get_system_stats');
                return;
            }
            
            // Fallback to HTTP polling when Socket.IO isn't available
            try {
                const res = await fetch('/api/system/stats');
                const data = await res.json();

                const ipEl = document.getElementById('system-ip');
                const cpuEl = document.getElementById('system-cpu');
                const ramEl = document.getElementById('system-ram');
                const diskEl = document.getElementById('system-disk');

                if (data.error) {
                    if (ipEl) ipEl.textContent = 'Error';
                } else {
                    if (ipEl) ipEl.textContent = data.ip || 'N/A';
                    if (cpuEl) cpuEl.textContent = `${data.cpu}%`;
                    if (ramEl) ramEl.textContent = `${data.ram}%`;
                    if (diskEl) diskEl.textContent = `${data.disk}%`;
                }
            } catch (e) {
                const ipEl = document.getElementById('system-ip');
                if (ipEl) ipEl.textContent = 'Error';
            }
        };

        if (this.socket) {
            this.socket.on('system_stats', (data) => {
                const ipEl = document.getElementById('system-ip');
                const cpuEl = document.getElementById('system-cpu');
                const ramEl = document.getElementById('system-ram');
                const diskEl = document.getElementById('system-disk');

                if (data.error) {
                    if (ipEl) ipEl.textContent = 'Error';
                } else {
                    if (ipEl) ipEl.textContent = data.ip || 'N/A';
                    if (cpuEl) cpuEl.textContent = `${data.cpu}%`;
                    if (ramEl) ramEl.textContent = `${data.ram}%`;
                    if (diskEl) diskEl.textContent = `${data.disk}%`;
                }
            });

            // Initial update
            updateStats();

            // Update every 2 seconds
            setInterval(updateStats, 2000);
        }
        
        // Also update guardians widget periodically
        setInterval(() => {
            this.loadGuardians();
        }, 5000); // Update every 5 seconds
    }

    copyIPAddress() {
        const ipEl = document.getElementById('system-ip');
        if (!ipEl) return;
        
        const ipAddress = ipEl.textContent.trim();
        if (!ipAddress || ipAddress === 'Loading...' || ipAddress === 'Error' || ipAddress === 'N/A') {
            this.showNotification('No IP address available', 'error');
            return;
        }

        // Copy to clipboard
        navigator.clipboard.writeText(ipAddress).then(() => {
            this.showNotification(`IP address copied: ${ipAddress}`, 'success');
            
            // Visual feedback on button
            const copyBtn = document.getElementById('ip-copy-btn');
            if (copyBtn) {
                const icon = copyBtn.querySelector('ion-icon');
                if (icon) {
                    icon.setAttribute('name', 'checkmark-outline');
                    setTimeout(() => {
                        icon.setAttribute('name', 'copy-outline');
                    }, 2000);
                }
            }
        }).catch(err => {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = ipAddress;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                this.showNotification(`IP address copied: ${ipAddress}`, 'success');
                
                // Visual feedback on button
                const copyBtn = document.getElementById('ip-copy-btn');
                if (copyBtn) {
                    const icon = copyBtn.querySelector('ion-icon');
                    if (icon) {
                        icon.setAttribute('name', 'checkmark-outline');
                        setTimeout(() => {
                            icon.setAttribute('name', 'copy-outline');
                        }, 2000);
                    }
                }
            } catch (err2) {
                this.showNotification('Error copying to clipboard', 'error');
            }
            document.body.removeChild(textArea);
        });
    }

    async initFrameworkVersion() {
        try {
            const res = await fetch('/api/system/info');
            const data = await res.json();
            
            const versionEl = document.getElementById('framework-version');
            if (versionEl) {
                const version = data.kittysploit_version || '2.0';
                versionEl.textContent = `v${version}`;
            }
        } catch (err) {
            console.error('Error loading framework version:', err);
            const versionEl = document.getElementById('framework-version');
            if (versionEl) {
                versionEl.textContent = 'v2.0';
            }
        }
    }

    updateSoundIcon() {
        const soundIcon = document.getElementById('sound-icon');
        const soundToggle = document.getElementById('sound-toggle');
        
        if (!soundIcon || !soundToggle) return;
        
        // Update icon based on current state
        if (this.soundEnabled) {
            soundIcon.setAttribute('name', 'volume-high');
            soundToggle.setAttribute('title', 'Sound: Enabled');
            soundToggle.style.color = '';
        } else {
            soundIcon.setAttribute('name', 'volume-mute');
            soundToggle.setAttribute('title', 'Sound: Disabled');
            soundToggle.style.color = '#666';
        }
    }

    initTrayIcons() {
        // Initialize sound icon state using the update method
        this.updateSoundIcon();
        
        // Initialize Tor icon state using the update method
        this.updateTorIcon();
    }

    initWifiIcon() {
        // Initial state - check connection immediately
        this.checkBackendConnection();
        
        // Check connection every 5 seconds
        setInterval(() => {
            this.checkBackendConnection();
        }, 5000);
    }

    async checkBackendConnection() {
        try {
            // Try to fetch a lightweight endpoint to verify backend connectivity
            // Use Promise.race for timeout compatibility
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Timeout')), 3000);
            });
            
            const fetchPromise = fetch('/api/health', { 
                method: 'GET'
            });
            
            const res = await Promise.race([fetchPromise, timeoutPromise]);
            
            if (!res || !res.ok) {
                this.updateWifiIcon(false);
                return;
            }

            const data = await res.json().catch(() => null);
            this.updateWifiIcon(Boolean(data && data.ok));
        } catch (err) {
            // Network error or timeout - backend is not reachable
            this.updateWifiIcon(false);
        }
    }

    updateWifiIcon(connected) {
        // Find the WiFi icon in the tray
        const wifiIconContainer = document.getElementById('wifi-toggle') || document.querySelector('.tray-icon[title="Wi-Fi"]');
        if (!wifiIconContainer) return;

        const wifiIcon = wifiIconContainer.querySelector('ion-icon');
        if (!wifiIcon) return;

        if (connected) {
            // Connected state - use filled icon
            wifiIcon.setAttribute('name', 'wifi');
            wifiIconContainer.setAttribute('title', 'Wi-Fi: Connected (backend OK)');
            wifiIconContainer.style.color = '';
            wifiIconContainer.style.opacity = '1';
        } else {
            // Disconnected state - use outline icon and gray color
            wifiIcon.setAttribute('name', 'wifi-outline');
            wifiIconContainer.setAttribute('title', 'Wi-Fi: Disconnected (backend down)');
            wifiIconContainer.style.color = '#666';
            wifiIconContainer.style.opacity = '0.5';
        }
    }

    showDesktop() {
        // Minimize all windows
        const windows = document.querySelectorAll('.window');
        windows.forEach(win => {
            win.style.display = 'none';
        });
    }

    toggleSound() {
        const soundIcon = document.getElementById('sound-icon');
        const soundToggle = document.getElementById('sound-toggle');
        
        if (!soundIcon || !soundToggle) return;
        
        // Toggle sound state
        this.soundEnabled = !this.soundEnabled;
        
        // Update icon
        this.updateSoundIcon();
        
        // Store in localStorage
        localStorage.setItem('soundEnabled', this.soundEnabled);
        
        // Emit event to backend to update framework.sound_enabled
        if (this.socket) {
            this.socket.emit('sound_toggle', { enabled: this.soundEnabled });
        }
    }

    toggleTor() {
        // Just open the Tor configuration window - don't toggle state
        // State changes only happen via the Connect/Disconnect button in the window
        this.openTorWindow();
    }

    resetStorage() {
        if (confirm('Are you sure you want to reset all local storage data?\n\nThis will clear:\n- All saved settings\n- Desktop session state\n- Sound preferences\n- Tor preferences\n\nThen reload the page.')) {
            try {
                // Clear all localStorage items
                localStorage.clear();
                
                // Show notification if available
                if (this.showNotification) {
                    this.showNotification('Local storage cleared. Reloading...', 'info');
                }
                
                // Reload page after a short delay
                setTimeout(() => {
                    window.location.reload();
                }, 500);
            } catch (e) {
                if (this.showNotification) {
                    this.showNotification('Error clearing local storage: ' + e.message, 'error');
                } else {
                    alert('Error clearing local storage: ' + e.message);
                }
            }
        }
    }

    toggleFullscreen() {
        const fullscreenIcon = document.getElementById('fullscreen-icon');
        const fullscreenToggle = document.getElementById('fullscreen-toggle');
        
        if (!fullscreenIcon || !fullscreenToggle) return;
        
        // Check if currently in fullscreen
        const isFullscreen = !!(document.fullscreenElement || 
                               document.webkitFullscreenElement || 
                               document.mozFullScreenElement || 
                               document.msFullscreenElement);
        
        if (isFullscreen) {
            // Exit fullscreen
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
            
            // Update icon
            fullscreenIcon.setAttribute('name', 'expand-outline');
            fullscreenToggle.setAttribute('title', 'Enter Fullscreen');
        } else {
            // Enter fullscreen
            const element = document.documentElement;
            if (element.requestFullscreen) {
                element.requestFullscreen();
            } else if (element.webkitRequestFullscreen) {
                element.webkitRequestFullscreen();
            } else if (element.mozRequestFullScreen) {
                element.mozRequestFullScreen();
            } else if (element.msRequestFullscreen) {
                element.msRequestFullscreen();
            }
            
            // Update icon
            fullscreenIcon.setAttribute('name', 'contract-outline');
            fullscreenToggle.setAttribute('title', 'Exit Fullscreen');
        }
    }

    initFullscreen() {
        // Listen for fullscreen changes to update icon
        const fullscreenIcon = document.getElementById('fullscreen-icon');
        const fullscreenToggle = document.getElementById('fullscreen-toggle');
        
        if (!fullscreenIcon || !fullscreenToggle) return;
        
        // Handle fullscreen change events
        const updateFullscreenIcon = () => {
            const isFullscreen = !!(document.fullscreenElement || 
                                   document.webkitFullscreenElement || 
                                   document.mozFullScreenElement || 
                                   document.msFullscreenElement);
            
            if (isFullscreen) {
                fullscreenIcon.setAttribute('name', 'contract-outline');
                fullscreenToggle.setAttribute('title', 'Exit Fullscreen');
            } else {
                fullscreenIcon.setAttribute('name', 'expand-outline');
                fullscreenToggle.setAttribute('title', 'Enter Fullscreen');
            }
        };
        
        // Listen to all fullscreen change events
        document.addEventListener('fullscreenchange', updateFullscreenIcon);
        document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
        document.addEventListener('mozfullscreenchange', updateFullscreenIcon);
        document.addEventListener('MSFullscreenChange', updateFullscreenIcon);
        
        // Initial icon state
        updateFullscreenIcon();
    }

    async openTorWindow() {
        // Check if window already exists
        const existingWindow = this.wm.windows.find(w => w.title === 'Tor Network');
        if (existingWindow) {
            this.wm.focusWindow(existingWindow.id);
            return;
        }
        
        // Fetch current Tor status from server
        let torStatus = { enabled: this.torConnected };
        try {
            const res = await fetch('/api/tor/status');
            const data = await res.json();
            if (data.success && data.status) {
                torStatus = data.status;
                this.torConnected = torStatus.enabled || false;
            }
        } catch (err) {
            console.error('Error fetching Tor status:', err);
        }
        
        const statusColor = torStatus.enabled ? '#58a6ff' : '#666';
        const statusText = torStatus.enabled ? 'Connected' : 'Disconnected';
        const proxyUrl = torStatus.proxy_url || 'socks5://127.0.0.1:9050';
        const socksHost = torStatus.socks_host || '127.0.0.1';
        const socksPort = torStatus.socks_port || 9050;
        const controlPort = torStatus.control_port || 9051;
        
        const content = `
            <div style="padding: 20px;">
                <div style="margin-bottom: 20px;">
                    <h3 style="margin: 0 0 10px 0; color: var(--text-color);">Tor Network Configuration</h3>
                    <p style="color: #8b949e; font-size: 13px; margin: 0;">Manage your Tor network connection</p>
                </div>
                
                <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 6px; padding: 15px; margin-bottom: 20px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                        <div>
                            <div style="font-size: 14px; color: var(--text-color); margin-bottom: 5px;">Connection Status</div>
                            <div style="font-size: 12px; color: #8b949e;">Current Tor network status</div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="width: 10px; height: 10px; border-radius: 50%; background: ${statusColor};"></div>
                            <span style="color: ${statusColor}; font-weight: 500;">${statusText}</span>
                        </div>
                    </div>
                    ${torStatus.enabled ? `
                        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-color);">
                            <div style="font-size: 12px; color: #8b949e; margin-bottom: 5px;">Proxy URL</div>
                            <div style="font-size: 13px; color: var(--text-color); font-family: monospace;">${proxyUrl}</div>
                        </div>
                    ` : ''}
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: block; font-size: 13px; color: var(--text-color); margin-bottom: 8px;">Tor SOCKS Proxy</label>
                    <input type="text" id="tor-socks" value="${socksHost}:${socksPort}" style="width: 100%; padding: 8px 12px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-color); font-size: 13px; outline: none; box-sizing: border-box;">
                    <div style="font-size: 11px; color: #8b949e; margin-top: 5px;">Default: 127.0.0.1:9050 (daemon) or 127.0.0.1:9150 (Tor Browser)</div>
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: block; font-size: 13px; color: var(--text-color); margin-bottom: 8px;">Tor Control Port</label>
                    <input type="text" id="tor-control" value="127.0.0.1:${controlPort}" style="width: 100%; padding: 8px 12px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-color); font-size: 13px; outline: none; box-sizing: border-box;">
                    <div style="font-size: 11px; color: #8b949e; margin-top: 5px;">Default: 127.0.0.1:9051</div>
                </div>
                
                <div style="display: flex; gap: 10px;">
                    <button id="tor-connect-btn" onclick="os.connectTor()" style="flex: 1; padding: 10px; background: ${torStatus.enabled ? '#da3633' : '#238636'}; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px;">
                        ${torStatus.enabled ? 'Disconnect' : 'Connect'}
                    </button>
                    <button id="tor-check-btn" onclick="os.checkTorAvailability()" style="flex: 1; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-color); cursor: pointer; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 6px;">
                        Check Availability
                    </button>
                </div>
            </div>
        `;
        
        const windowId = this.wm.createWindow({
            title: 'Tor Network',
            icon: 'desktop-outline',
            titleIconSrc: '/static/img/tor-icon.svg',
            titleIconId: 'tor-window-title-icon',
            width: '700px',
            height: '600px',
            content: content
        });
        
        // Store window ID for later reference
        this.torWindowId = windowId;
        this.updateTorIcon();
    }
    
    async checkTorAvailability() {
        const checkBtn = document.getElementById('tor-check-btn');
        if (!checkBtn) return;
        
        // Save original button state
        const originalHTML = checkBtn.innerHTML;
        const originalDisabled = checkBtn.disabled;
        
        // Show loading state
        checkBtn.disabled = true;
        checkBtn.style.opacity = '0.6';
        checkBtn.style.cursor = 'not-allowed';
        checkBtn.innerHTML = '<div style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite;"></div> <span>Checking...</span>';
        
        const socksProxy = document.getElementById('tor-socks')?.value || '127.0.0.1:9050';
        const [host, port] = socksProxy.includes(':') ? socksProxy.split(':') : [socksProxy, '9050'];
        
        try {
            const res = await fetch('/api/tor/check', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    host: host,
                    port: parseInt(port)
                })
            });
            const data = await res.json();
            
            if (data.success) {
                if (data.available) {
                    if (this.showNotification) {
                        this.showNotification(`Tor is available on ${host}:${port}`, 'success');
                    } else {
                        alert(`Tor is available on ${host}:${port}`);
                    }
                } else {
                    if (this.showNotification) {
                        this.showNotification(`Tor is not available on ${host}:${port}. Make sure Tor is running.`, 'warning');
                    } else {
                        alert(`Tor is not available on ${host}:${port}. Make sure Tor is running.`);
                    }
                }
            } else {
                if (this.showNotification) {
                    this.showNotification('Error checking Tor: ' + (data.error || 'Unknown error'), 'error');
                } else {
                    alert('Error checking Tor: ' + (data.error || 'Unknown error'));
                }
            }
        } catch (err) {
            console.error('Error checking Tor availability:', err);
            if (this.showNotification) {
                this.showNotification('Error checking Tor availability: ' + err.message, 'error');
            } else {
                alert('Error checking Tor availability: ' + err.message);
            }
        } finally {
            // Restore button state
            checkBtn.disabled = originalDisabled;
            checkBtn.style.opacity = '1';
            checkBtn.style.cursor = 'pointer';
            checkBtn.innerHTML = originalHTML;
        }
    }

    closeTorWindow() {
        if (this.torWindowId) {
            this.wm.closeWindow(this.torWindowId);
            this.torWindowId = null;
        } else {
            // Fallback: find window by title
            const torWindow = this.wm.windows.find(w => w.title === 'Tor Network');
            if (torWindow) {
                this.wm.closeWindow(torWindow.id);
            }
        }
    }

    connectTor() {
        const connectBtn = document.getElementById('tor-connect-btn');
        const socksProxy = document.getElementById('tor-socks')?.value || '127.0.0.1:9050';
        const controlPort = document.getElementById('tor-control')?.value || '127.0.0.1:9051';
        
        if (!connectBtn) return;
        
        // Save original button state
        const originalHTML = connectBtn.innerHTML;
        const originalDisabled = connectBtn.disabled;
        
        // Show loading state
        connectBtn.disabled = true;
        connectBtn.style.opacity = '0.6';
        connectBtn.style.cursor = 'not-allowed';
        connectBtn.innerHTML = '<div style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite;"></div> <span>' + (this.torConnected ? 'Disconnecting...' : 'Connecting...') + '</span>';
        
        const restoreButton = () => {
            connectBtn.disabled = originalDisabled;
            connectBtn.style.opacity = '1';
            connectBtn.style.cursor = 'pointer';
            // Update button text and color based on new state
            const isConnected = this.torConnected;
            connectBtn.style.background = isConnected ? '#da3633' : '#238636';
            connectBtn.innerHTML = isConnected ? 'Disconnect' : 'Connect';
        };
        
        if (this.torConnected) {
            // Disconnect
            if (this.socket) {
                this.socket.emit('tor_disconnect');
                // Restore button after a delay (SocketIO will handle state via events)
                setTimeout(() => {
                    restoreButton();
                }, 2000);
            } else {
                // Fallback to REST API if socket not available
                fetch('/api/tor/disable', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'}
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        this.torConnected = false;
                        this.updateTorIcon();
                        localStorage.setItem('torConnected', this.torConnected);
                        restoreButton();
                        this.closeTorWindow();
                        setTimeout(() => this.openTorWindow(), 100);
                    } else {
                        restoreButton();
                        if (this.showNotification) {
                            this.showNotification('Error disabling Tor: ' + (data.error || 'Unknown error'), 'error');
                        }
                    }
                })
                .catch(err => {
                    console.error('Error disabling Tor:', err);
                    restoreButton();
                    if (this.showNotification) {
                        this.showNotification('Error disabling Tor: ' + err.message, 'error');
                    }
                });
            }
        } else {
            // Connect
            if (this.socket) {
                this.socket.emit('tor_connect', { 
                    socks_proxy: socksProxy,
                    control_port: controlPort
                });
                // Restore button after a delay (SocketIO will handle state via events)
                setTimeout(() => {
                    restoreButton();
                }, 2000);
            } else {
                // Fallback to REST API if socket not available
                const [host, port] = socksProxy.includes(':') ? socksProxy.split(':') : [socksProxy, '9050'];
                fetch('/api/tor/enable', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        host: host,
                        socks_port: parseInt(port),
                        control_port: parseInt(controlPort.split(':').pop() || '9051'),
                        check_availability: true
                    })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        this.torConnected = true;
                        this.updateTorIcon();
                        localStorage.setItem('torConnected', this.torConnected);
                        restoreButton();
                        this.closeTorWindow();
                        setTimeout(() => this.openTorWindow(), 100);
                    } else {
                        restoreButton();
                        if (this.showNotification) {
                            this.showNotification('Error enabling Tor: ' + (data.error || 'Unknown error'), 'error');
                        }
                    }
                })
                .catch(err => {
                    console.error('Error enabling Tor:', err);
                    restoreButton();
                    if (this.showNotification) {
                        this.showNotification('Error enabling Tor: ' + err.message, 'error');
                    }
                });
            }
        }
    }

    updateTorIcon() {
        // Update tray icon (and Tor config window title icon) based on connection state
        const torIcon = document.getElementById('tor-icon');
        const torToggle = document.getElementById('tor-toggle');
        const winTorIcon = document.getElementById('tor-window-title-icon');
        const connectedFilter = 'brightness(0) saturate(100%) invert(67%) sepia(100%) saturate(2000%) hue-rotate(190deg) brightness(1.1) contrast(1.2)';
        const disconnectedFilter = 'brightness(0) invert(1)';

        if (torIcon && torToggle) {
            if (this.torConnected) {
                torIcon.style.filter = connectedFilter;
                torToggle.setAttribute('title', 'Tor Network: Connected');
            } else {
                torIcon.style.filter = disconnectedFilter;
                torToggle.setAttribute('title', 'Tor Network: Disconnected');
            }
        }
        if (winTorIcon) {
            winTorIcon.style.filter = this.torConnected ? connectedFilter : disconnectedFilter;
        }
        document.querySelectorAll('img.task-item-tor-icon').forEach((el) => {
            el.style.filter = this.torConnected ? connectedFilter : disconnectedFilter;
        });
    }

    toggleStartMenu() {
        const menu = document.getElementById('start-menu');
        const btn = document.getElementById('start-btn');
        
        if (!menu) {
            console.error('Start menu element not found');
            return;
        }
        
        this.startOpen = !this.startOpen;

        if (this.startOpen) {
            menu.classList.add('open');
            if (btn) btn.classList.add('active');
        } else {
            menu.classList.remove('open');
            if (btn) btn.classList.remove('active');
        }
    }

    openApp(appName) {
        // Close start menu if open
        if (this.startOpen) this.toggleStartMenu();

        const beforeCount = this.wm.windows.length;
        switch (appName) {
            case 'terminal':
                this.spawnTerminal();
                break;
            case 'irc':
                this.spawnIRC();
                break;
            case 'chat_server':
                this.spawnChatServer();
                break;
            case 'docs':
                this.spawnDocs();
                break;
            case 'file_explorer':
                this.spawnFileExplorer();
                break;
            case 'settings':
                console.log('Opening Settings...');
                this.spawnSettings();
                break;
            case 'about':
                this.spawnAbout();
                break;
            case 'collab':
                this.spawnCollab();
                break;
            case 'kittyproxy':
                this.spawnKittyProxy();
                break;
            case 'network':
                this.spawnNetworkScanner();
                break;
            case 'ports':
                this.spawnPortMonitor();
                break;
            case 'workflows':
                this.spawnWorkflowManager();
                break;
            case 'ide':
                this.spawnIDE();
                break;
            case 'module_launcher':
                this.spawnModuleLauncher();
                break;
            case 'output_explorer':
                this.spawnOutputExplorer();
                break;
            case 'backdoor_generator':
                this.spawnBackdoorGenerator();
                break;
            case 'web_delivery':
                this.spawnWebDelivery();
                break;
            case 'interpreter':
                this.spawnInterpreter();
                break;
            case 'network_map':
                this.spawnNetworkMap();
                break;
            case 'sessions':
                this.spawnSessionManager();
                break;
            case 'browser_server':
                this.spawnBrowserServer();
                break;
            case 'jobs':
                this.spawnJobsManager();
                break;
            case 'listeners':
                this.spawnListenerManager();
                break;
            case 'vnc':
                this.spawnVNCClient();
                break;
            case 'docker_environments':
                this.spawnDockerEnvironments();
                break;
            case 'marketplace':
                this.spawnMarketplace();
                break;
            case 'scanner':
                this.spawnScanner();
                break;
            case 'notes':
                this.spawnNotes();
                break;
            case 'agent_launcher':
                this.spawnAgentLauncher();
                break;
        }

        // Return the newly created window id if any (useful for session restore)
        if (this.wm.windows.length > beforeCount) {
            return this.wm.windows[this.wm.windows.length - 1].id;
        }
        return null;
    }

    inferAppIdFromWindowTitle(title) {
        const t = String(title || '').toLowerCase();
        if (!t) return null;
        if (t.includes('terminal')) return 'terminal';
        if (t.includes('workflow')) return 'workflows';
        if (t.includes('web delivery')) return 'web_delivery';
        if (t.includes('kittyproxy')) return 'kittyproxy';
        if (t.includes('browser server')) return 'browser_server';
        if (t.includes('session')) return 'sessions';
        if (t.includes('job')) return 'jobs';
        if (t.includes('documentation') || t === 'docs') return 'docs';
        if (t.includes('file explorer')) return 'file_explorer';
        if (t.includes('network map')) return 'network_map';
        if (t.includes('port')) return 'ports';
        if (t.includes('host') || t.includes('vuln')) return 'network';
        if (t.includes('listener')) return 'listeners';
        if (t.includes('module ide')) return 'ide';
        if (t.includes('module launcher')) return 'module_launcher';
        if (t.includes('backdoor')) return 'backdoor_generator';
        if (t.includes('interpreter')) return 'interpreter';
        if (t.includes('kittycollab') || t.includes('collab')) return 'collab';
        if (t.includes('settings')) return 'settings';
        if (t.includes('about')) return 'about';
        if (t.includes('kittychat') || t.includes('irc')) return 'irc';
        if (t.includes('chat server') || t.includes('chat_server')) return 'chat_server';
        if (t.includes('vnc')) return 'vnc';
        if (t.includes('docker') || t.includes('environment')) return 'docker_environments';
        if (t.includes('marketplace') || t.includes('market')) return 'marketplace';
        if (t.includes('scanner')) return 'scanner';
        if (t === 'notes') return 'notes';
        if (t.includes('agent launcher')) return 'agent_launcher';
        return null;
    }

    buildWindowState(winObj) {
        const el = winObj?.element;
        if (!el) return null;

        const rect = {
            top: el.style.top || `${el.offsetTop}px`,
            left: el.style.left || `${el.offsetLeft}px`,
            width: el.style.width || `${el.offsetWidth}px`,
            height: el.style.height || `${el.offsetHeight}px`
        };

        const z = parseInt(el.style.zIndex || '0', 10) || 0;
        const appId = winObj.appId || this.inferAppIdFromWindowTitle(winObj.title);

        return {
            appId,
            title: winObj.title,
            icon: winObj.icon,
            zIndex: z,
            rect,
            isMinimized: !!winObj.isMinimized,
            isMaximized: !!winObj.isMaximized,
            restoreRect: winObj.restoreRect || null
        };
    }

    schedulePersistDesktopSession() {
        if (this._restoringDesktopSession) return;
        if (this._desktopPersistTimer) clearTimeout(this._desktopPersistTimer);
        this._desktopPersistTimer = setTimeout(() => this.persistDesktopSession(), 250);
    }

    persistDesktopSession() {
        if (this._restoringDesktopSession) return;
        try {
            const states = this.wm.windows
                .map(w => this.buildWindowState(w))
                .filter(Boolean)
                // Only persist windows we can re-open (known appId)
                .filter(w => !!w.appId);

            // Restore order: back -> front
            states.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

            const session = {
                v: 1,
                savedAt: Date.now(),
                windows: states
            };

            localStorage.setItem('kittyos.desktopSession.v1', JSON.stringify(session));
        } catch (e) {
            // localStorage quota / private mode -> ignore
        }
    }

    applyWindowState(windowId, state) {
        const winObj = this.wm.windows.find(w => w.id === windowId);
        if (!winObj) return;
        const el = winObj.element;
        if (!el) return;

        // Apply geometry first
        if (state && state.rect) {
            el.style.top = state.rect.top;
            el.style.left = state.rect.left;
            el.style.width = state.rect.width;
            el.style.height = state.rect.height;
        }

        // Restore maximize state without toggling (so we don't lose restoreRect)
        if (state?.isMaximized) {
            const taskbar = document.getElementById('taskbar');
            const taskbarHeight = taskbar ? taskbar.offsetHeight : 50;

            winObj.restoreRect = state.restoreRect || winObj.restoreRect || {
                top: state.rect?.top || el.style.top,
                left: state.rect?.left || el.style.left,
                width: state.rect?.width || el.style.width,
                height: state.rect?.height || el.style.height
            };

            el.style.position = 'fixed';
            el.style.top = '0';
            el.style.left = '0';
            el.style.right = '0';
            el.style.bottom = `${taskbarHeight}px`;
            el.style.width = '100%';
            el.style.height = `calc(100vh - ${taskbarHeight}px)`;
            el.style.margin = '0';
            winObj.isMaximized = true;
        } else {
            if (el.style.position === 'fixed') {
                el.style.position = '';
                el.style.right = '';
                el.style.bottom = '';
                el.style.margin = '';
            }
            winObj.isMaximized = false;
            if (state?.restoreRect) {
                winObj.restoreRect = state.restoreRect;
            }
        }

        if (state?.isMinimized) {
            this.wm.minimizeWindow(windowId);
        } else {
            el.style.display = 'flex';
            winObj.isMinimized = false;
        }
    }

    restoreDesktopSession() {
        try {
            const raw = localStorage.getItem('kittyos.desktopSession.v1');
            if (!raw) return;

            const session = JSON.parse(raw);
            if (!session || !Array.isArray(session.windows) || session.windows.length === 0) return;

            this._restoringDesktopSession = true;

            // Restore windows in saved z-order (back -> front)
            const winStates = session.windows.slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
            const createdIds = [];

            for (const ws of winStates) {
                if (!ws.appId) continue;
                const createdId = this.openApp(ws.appId);
                if (!createdId) continue;
                this.applyWindowState(createdId, ws);
                createdIds.push(createdId);
            }

            // Focus top-most restored window
            if (createdIds.length > 0) {
                this.wm.focusWindow(createdIds[createdIds.length - 1]);
            }
        } catch (e) {
            // ignore restore failures
        } finally {
            this._restoringDesktopSession = false;
            // Persist immediately so we store the new runtime ids/order
            this.schedulePersistDesktopSession();
        }
    }

    initSearch() {
        const searchInput = document.getElementById('app-search');
        const searchResults = document.getElementById('search-results');

        if (!searchInput || !searchResults) return;

        // App database for search
        const apps = {
            'terminal': { name: 'Terminal', icon: 'terminal-outline', desc: 'Command line interface' },
            'irc': { name: 'KittyChat', icon: 'chatbubbles-outline', desc: 'IRC Chat Client' },
            'interpreter': { name: 'Interpreter', icon: 'code-slash-outline', desc: 'KittyPy Interactive Interpreter' },
            'kittyproxy': { name: 'KittyProxy', icon: 'shield-checkmark-outline', desc: 'Intercept HTTP traffic' },
            'collab': { name: 'KittyCollab', icon: 'code-slash-outline', desc: 'Collaborative Editor' },
            'file_explorer': { name: 'Files', icon: 'folder-open-outline', desc: 'File Explorer' },
            'network': { name: 'Hosts & Vuln', icon: 'bug-outline', desc: 'Host & Vulnerability Scanner' },
            'ports': { name: 'Ports', icon: 'server-outline', desc: 'Port Monitor' },
            'docs': { name: 'Docs', icon: 'book-outline', desc: 'Documentation' },
            'settings': { name: 'Settings', icon: 'settings-outline', desc: 'System Settings' },
            'about': { name: 'About', icon: 'information-circle-outline', desc: 'About KittySploit & KittyOS' },
            'workflows': { name: 'Workflows', icon: 'git-branch-outline', desc: 'Workflow Manager' },
            'ide': { name: 'Module IDE', icon: 'code-outline', desc: 'Module Editor & Creator' },
            'module_launcher': { name: 'Module Launcher', icon: 'rocket-outline', desc: 'Launch modules with options' },
            'output_explorer': { name: 'Output Explorer', icon: 'folder-outline', desc: 'Browse output files and folders' },
            'backdoor_generator': { name: 'Backdoor Generator', icon: 'key-outline', desc: 'Generate backdoors using modules' },
            'web_delivery': { name: 'Web Delivery', icon: 'cloud-download-outline', desc: 'Serve files via HTTP for download' },
            'network_map': { name: 'Network Map', icon: 'map-outline', desc: 'Network Topology Visualization' },
            'sessions': { name: 'Sessions', icon: 'people-outline', desc: 'Session Manager' },
            'browser_server': { name: 'Browser Server', icon: 'globe-outline', desc: 'Browser Exploitation Server' },
            'jobs': { name: 'Jobs', icon: 'briefcase-outline', desc: 'Background Jobs Manager' },
            'notes': { name: 'Notes', icon: 'document-text-outline', desc: 'Scratchpad (browser local storage)' },
            'agent_launcher': { name: 'Agent Launcher', icon: 'hardware-chip-outline', desc: 'Run the agent command against a target' }
        };

        // Function to perform search and display results
        const performSearch = (query) => {
            const queryTrimmed = query.trim();
            
            // If query is empty, show all apps (limited to 8)
            if (!queryTrimmed) {
                const allApps = Object.entries(apps).slice(0, 8);
                displayResults(allApps, '');
                return;
            }

            const queryLower = queryTrimmed.toLowerCase();

            // Filter apps - search in name, description, and id
            // Prioritize matches that start with the query
            const matches = Object.entries(apps)
                .map(([id, app]) => {
                    const nameLower = app.name.toLowerCase();
                    const descLower = app.desc.toLowerCase();
                    const idLower = id.toLowerCase();
                    
                    // Calculate score: exact match = 3, starts with = 2, contains = 1
                    let score = 0;
                    if (nameLower === queryLower || descLower === queryLower || idLower === queryLower) {
                        score = 10; // Exact match
                    } else if (nameLower.startsWith(queryLower) || idLower.startsWith(queryLower)) {
                        score = 5; // Starts with
                    } else if (nameLower.includes(queryLower) || descLower.includes(queryLower) || idLower.includes(queryLower)) {
                        score = 1; // Contains
                    }
                    
                    return { id, app, score };
                })
                .filter(item => item.score > 0)
                .sort((a, b) => b.score - a.score) // Sort by score (best matches first)
                .map(item => [item.id, item.app]);

            // Clear previous results
            searchResults.innerHTML = '';

            if (matches.length === 0) {
                searchResults.innerHTML = '<div class="search-no-results">No apps found</div>';
                searchResults.classList.add('show');
                return;
            }

            // Limit to 8 results for better UX
            const limitedMatches = matches.slice(0, 8);
            displayResults(limitedMatches, queryTrimmed);
        };

        // Function to display search results
        const displayResults = (matches, query) => {
            searchResults.innerHTML = matches.map(([id, app]) => {
                // Highlight matching text
                const nameHighlight = query ? this.highlightMatch(app.name, query) : app.name;
                const descHighlight = query ? this.highlightMatch(app.desc, query) : app.desc;
                
                return `
                    <div class="search-result-item" data-app="${id}">
                        <ion-icon name="${app.icon}" style="font-size: 20px; color: var(--accent-color);"></ion-icon>
                        <div class="search-result-label" style="flex: 1;">
                            <div style="font-weight: 600; color: var(--text-color);">${nameHighlight}</div>
                            <div style="font-size: 11px; color: #8b949e; margin-top: 2px;">${descHighlight}</div>
                        </div>
                    </div>
                `;
            }).join('');

            // Add click handlers using event delegation
            searchResults.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const appId = item.dataset.app;
                    this.openApp(appId);
                    searchInput.value = '';
                    searchResults.classList.remove('show');
                    searchResults.innerHTML = '';
                });
            });

            searchResults.classList.add('show');
        };

        // Debounce function with very short delay for immediate feedback
        let searchTimeout = null;
        
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value;

            // Clear previous timeout
            if (searchTimeout) {
                clearTimeout(searchTimeout);
            }

            // Perform search immediately (no delay for better UX)
            performSearch(query);
        });

        // Show all apps when focusing on empty search
        searchInput.addEventListener('focus', () => {
            if (!searchInput.value.trim()) {
                performSearch('');
            } else {
                // Re-trigger search to update results
                performSearch(searchInput.value);
            }
        });

        // Handle keyboard navigation
        searchInput.addEventListener('keydown', (e) => {
            const results = searchResults.querySelectorAll('.search-result-item');
            const currentIndex = Array.from(results).findIndex(item => item.classList.contains('selected'));
            
            if (e.key === 'Enter') {
                e.preventDefault();
                const selected = searchResults.querySelector('.search-result-item.selected');
                if (selected) {
                    selected.click();
                } else if (results.length > 0) {
                    results[0].click();
                }
            } else if (e.key === 'Escape') {
                searchInput.value = '';
                searchResults.classList.remove('show');
                searchResults.innerHTML = '';
                searchInput.blur();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                const nextIndex = currentIndex < results.length - 1 ? currentIndex + 1 : 0;
                results.forEach(item => item.classList.remove('selected'));
                if (results[nextIndex]) {
                    results[nextIndex].classList.add('selected');
                    results[nextIndex].scrollIntoView({ block: 'nearest' });
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prevIndex = currentIndex > 0 ? currentIndex - 1 : results.length - 1;
                results.forEach(item => item.classList.remove('selected'));
                if (results[prevIndex]) {
                    results[prevIndex].classList.add('selected');
                    results[prevIndex].scrollIntoView({ block: 'nearest' });
                }
            }
        });

        // Close results when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                searchResults.classList.remove('show');
            }
        });
    }

    highlightMatch(text, query) {
        if (!query) return text;
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<mark style="background: rgba(88, 166, 255, 0.3); color: var(--accent-color); padding: 0 2px; border-radius: 2px;">$1</mark>');
    }

    async loadWorkspaces() {
        const select = document.getElementById('workspace-select');
        if (!select) return;

        try {
            const res = await fetch('/api/workspaces');
            const data = await res.json();
            const workspaces = data.workspaces || [];
            const current = data.current || 'default';

            // Clear existing options
            select.innerHTML = '';

            if (workspaces.length === 0) {
                select.innerHTML = '<option value="">No workspaces available</option>';
                return;
            }

            // Add workspaces to select
            workspaces.forEach(ws => {
                const option = document.createElement('option');
                option.value = ws.name;
                option.textContent = ws.name + (ws.is_current ? ' (current)' : '');
                if (ws.is_current) {
                    option.selected = true;
                }
                select.appendChild(option);
            });

            // Add change event listener if not already added
            if (!select.hasAttribute('data-listener-added')) {
                select.setAttribute('data-listener-added', 'true');
                select.addEventListener('change', async (e) => {
                    const selectedWorkspace = e.target.value;
                    if (selectedWorkspace) {
                        // Always call switchWorkspace - the server will handle if it's already the current workspace
                        await this.switchWorkspace(selectedWorkspace);
                    }
                });
            }
        } catch (err) {
            console.error('Error loading workspaces:', err);
            select.innerHTML = '<option value="">Error loading workspaces</option>';
        }
    }

    async loadGuardians() {
        const container = document.getElementById('guardians-list');
        if (!container) return;

        try {
            const res = await fetch('/api/guardian/status');
            const data = await res.json();
            
            // Get real counts
            const blacklistCount = data.blacklist ? Object.keys(data.blacklist).length : 0;
            const alertsCount = data.alerts ? data.alerts.length : 0;
            const isEnabled = data.enabled || false;
            
            // Update widget border if enabled
            const widget = document.getElementById('guardians-widget');
            if (widget) {
                if (isEnabled) {
                    widget.style.border = '1px solid #3fb950';
                } else {
                    widget.style.border = '';
                }
            }
            
            const guardians = [
                { name: 'Blacklist', count: blacklistCount, status: isEnabled ? 'active' : 'idle' },
                { name: 'Alert', count: alertsCount, status: isEnabled ? 'active' : 'idle' }
            ];

            if (guardians.length === 0) {
                container.innerHTML = '<div style="color: #666; font-size: 12px; text-align: center; padding: 10px;">No guardians</div>';
                return;
            }

            container.innerHTML = guardians.map(g => {
                // Choose appropriate icon for each guardian type
                let iconName = '';
                if (g.name === 'Blacklist') {
                    iconName = 'ban-outline';
                } else if (g.name === 'Alert') {
                    iconName = 'warning-outline';
                }
                
                return `
                <div class="widget-stat">
                    <span class="stat-label" style="display: flex; align-items: center; gap: 6px;">
                        <ion-icon name="${iconName}" style="font-size: 14px; color: ${g.status === 'active' ? '#3fb950' : '#8b949e'};"></ion-icon>
                        <span>${g.name}</span>
                    </span>
                    <span class="stat-value">${g.count}</span>
                </div>
            `;
            }).join('');
        } catch (err) {
            console.error('Error loading guardians:', err);
            container.innerHTML = '<div style="color: #666; font-size: 12px; text-align: center; padding: 10px;">Error loading guardians</div>';
        }
    }

    createWorkspace() {
        const winId = this.wm.createWindow({
            title: 'Create New Workspace',
            icon: 'add-circle-outline',
            width: '450px',
            height: '250px',
            content: `
                <div style="padding: 20px; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif; height: 100%; display: flex; flex-direction: column;">
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; font-size: 13px; color: #8b949e; margin-bottom: 8px;">Workspace Name *</label>
                        <input type="text" id="workspace-name-input" placeholder="Enter workspace name..." 
                               style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; box-sizing: border-box;">
                    </div>
                    <div style="margin-bottom: 20px; flex: 1;">
                        <label style="display: block; font-size: 13px; color: #8b949e; margin-bottom: 8px;">Description (optional)</label>
                        <textarea id="workspace-desc-input" placeholder="Enter workspace description..." 
                                  style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; resize: none; min-height: 60px; box-sizing: border-box; font-family: inherit;"></textarea>
                    </div>
                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button id="cancel-ws-btn" style="padding: 8px 16px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; cursor: pointer; font-size: 13px; transition: all 0.2s;">
                            Cancel
                        </button>
                        <button id="create-ws-btn" style="padding: 8px 16px; background: #238636; border: 1px solid #238636; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; transition: all 0.2s; font-weight: 500;">
                            Create
                        </button>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const self = this;
                const nameInput = document.querySelector(`#${wId} #workspace-name-input`);
                const descInput = document.querySelector(`#${wId} #workspace-desc-input`);
                const createBtn = document.querySelector(`#${wId} #create-ws-btn`);
                const cancelBtn = document.querySelector(`#${wId} #cancel-ws-btn`);

                // Focus on name input
                if (nameInput) {
                    nameInput.focus();
                    // Handle Enter key
                    nameInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            if (createBtn) createBtn.click();
                        }
                    });
                }

                // Create button handler
                const handleCreate = async () => {
                    const name = nameInput.value.trim();
                    const description = descInput.value.trim();

                    if (!name) {
                        alert('Workspace name is required');
                        return;
                    }

                    try {
                        const res = await fetch('/api/workspaces/create', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: name, description: description })
                        });

                        const data = await res.json();
                        if (res.ok && data.success) {
                            // Close window
                            self.wm.closeWindow(wId);
                            // Reload workspaces list
                            await self.loadWorkspaces();
                            // Switch to the new workspace
                            await self.switchWorkspace(name);
                        } else {
                            alert(`Error creating workspace: ${data.error || 'Unknown error'}`);
                        }
                    } catch (err) {
                        console.error('Error creating workspace:', err);
                        alert('Error creating workspace');
                    }
                };

                if (createBtn) {
                    createBtn.addEventListener('click', handleCreate);
                    createBtn.onmouseover = () => createBtn.style.background = '#2ea043';
                    createBtn.onmouseout = () => createBtn.style.background = '#238636';
                }

                if (cancelBtn) {
                    cancelBtn.addEventListener('click', () => {
                        self.wm.closeWindow(wId);
                    });
                    cancelBtn.onmouseover = () => cancelBtn.style.background = 'rgba(255,255,255,0.1)';
                    cancelBtn.onmouseout = () => cancelBtn.style.background = 'rgba(255,255,255,0.05)';
                }
            }
        });
    }

    async switchWorkspace(workspaceName) {
        if (!workspaceName) return;

        try {
            const res = await fetch('/api/workspaces/switch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: workspaceName })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                // Reload workspaces to update the current indicator
                await this.loadWorkspaces();
                // Show notification
                this.showNotification(`Workspace switched to "${workspaceName}"`, 'success');
                console.log(`Switched to workspace: ${workspaceName}`);
            } else {
                this.showNotification(`Error: ${data.error || 'Unknown error'}`, 'error');
            }
        } catch (err) {
            console.error('Error switching workspace:', err);
            this.showNotification('Error switching workspace', 'error');
        }
    }

    showNotification(message, type = 'info', duration = 3000) {
        const container = document.getElementById('notifications-container');
        if (!container) {
            // Create container if it doesn't exist
            const newContainer = document.createElement('div');
            newContainer.id = 'notifications-container';
            document.getElementById('desktop').appendChild(newContainer);
            return this.showNotification(message, type, duration);
        }

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        
        // Icon based on type
        let icon = 'information-circle-outline';
        if (type === 'success') icon = 'checkmark-circle-outline';
        else if (type === 'error') icon = 'close-circle-outline';
        else if (type === 'warning') icon = 'warning-outline';

        notification.innerHTML = `
            <div class="notification-content">
                <ion-icon name="${icon}" class="notification-icon"></ion-icon>
                <span class="notification-message">${message}</span>
            </div>
        `;

        container.appendChild(notification);

        // Trigger animation
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        // Auto remove after duration
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300); // Wait for animation to complete
        }, duration);
    }

    manageGuardians() {
        const winId = this.wm.createWindow({
            title: 'Guardian Management',
            icon: 'shield-checkmark-outline',
            width: '1000px',
            height: '700px',
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif;">
                    <!-- Header -->
                    <div style="padding: 20px; border-bottom: 1px solid #30363d; background: #161b22;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <span style="font-size: 24px; color: #58a6ff;">◈</span>
                                <h2 style="margin: 0; font-size: 20px; color: #c9d1d9;">Security Guardian</h2>
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;">
                                    <input type="checkbox" id="guardian-enabled" style="cursor: pointer;">
                                    <span>Enabled</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;">
                                    <input type="checkbox" id="guardian-verbose" style="cursor: pointer;">
                                    <span>Verbose</span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <!-- Main Content -->
                    <div style="flex: 1; display: flex; overflow: hidden;">
                        <!-- Left Panel: Tabs -->
                        <div style="width: 200px; border-right: 1px solid #30363d; background: #161b22; padding: 10px 0;">
                            <div class="guardian-tab active" data-tab="status" style="padding: 12px 20px; cursor: pointer; border-left: 3px solid #58a6ff; background: rgba(88, 166, 255, 0.1);">
                                <ion-icon name="stats-chart-outline"></ion-icon> Status
                            </div>
                            <div class="guardian-tab" data-tab="blacklist" style="padding: 12px 20px; cursor: pointer; border-left: 3px solid transparent;">
                                <ion-icon name="ban-outline"></ion-icon> Blacklist
                            </div>
                            <div class="guardian-tab" data-tab="whitelist" style="padding: 12px 20px; cursor: pointer; border-left: 3px solid transparent;">
                                <ion-icon name="checkmark-circle-outline"></ion-icon> Whitelist
                            </div>
                            <div class="guardian-tab" data-tab="alerts" style="padding: 12px 20px; cursor: pointer; border-left: 3px solid transparent;">
                                <ion-icon name="warning-outline"></ion-icon> Alerts
                            </div>
                        </div>

                        <!-- Right Panel: Content -->
                        <div style="flex: 1; overflow-y: auto; padding: 20px;">
                            <!-- Status Tab -->
                            <div id="tab-status" class="guardian-tab-content" style="display: block;">
                                <h3 style="margin-top: 0; color: #58a6ff;">Status & Statistics</h3>
                                <div id="guardian-stats" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px;">
                                    <!-- Stats will be loaded here -->
                                </div>
                                <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px;">
                                    <h4 style="margin-top: 0; color: #c9d1d9;">Recent Activity</h4>
                                    <div id="guardian-activity" style="font-size: 12px; color: #8b949e;">
                                        Loading...
                                    </div>
                                </div>
                            </div>

                            <!-- Blacklist Tab -->
                            <div id="tab-blacklist" class="guardian-tab-content" style="display: none;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                                    <h3 style="margin: 0; color: #58a6ff;">Blacklist</h3>
                                    <button id="add-blacklist-btn" style="padding: 8px 16px; background: #f85149; border: 1px solid #f85149; border-radius: 4px; color: white; cursor: pointer; font-size: 13px;">
                                        <ion-icon name="add-outline"></ion-icon> Add IP
                                    </button>
                                </div>
                                <div id="blacklist-list" style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px;">
                                    <div style="text-align: center; color: #8b949e; padding: 20px;">Loading...</div>
                                </div>
                            </div>

                            <!-- Whitelist Tab -->
                            <div id="tab-whitelist" class="guardian-tab-content" style="display: none;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                                    <h3 style="margin: 0; color: #58a6ff;">Whitelist</h3>
                                    <button id="add-whitelist-btn" style="padding: 8px 16px; background: #238636; border: 1px solid #238636; border-radius: 4px; color: white; cursor: pointer; font-size: 13px;">
                                        <ion-icon name="add-outline"></ion-icon> Add IP
                                    </button>
                                </div>
                                <div id="whitelist-list" style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px;">
                                    <div style="text-align: center; color: #8b949e; padding: 20px;">Loading...</div>
                                </div>
                            </div>

                            <!-- Alerts Tab -->
                            <div id="tab-alerts" class="guardian-tab-content" style="display: none;">
                                <h3 style="margin-top: 0; color: #58a6ff;">Recent Alerts</h3>
                                <div id="alerts-list" style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px;">
                                    <div style="text-align: center; color: #8b949e; padding: 20px;">Loading...</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

            `,
            onLoad: (wId) => {
                const enabledCheckbox = document.querySelector(`#${wId} #guardian-enabled`);
                const verboseCheckbox = document.querySelector(`#${wId} #guardian-verbose`);
                const tabs = document.querySelectorAll(`#${wId} .guardian-tab`);
                const tabContents = document.querySelectorAll(`#${wId} .guardian-tab-content`);
                const addBlacklistBtn = document.querySelector(`#${wId} #add-blacklist-btn`);
                const addWhitelistBtn = document.querySelector(`#${wId} #add-whitelist-btn`);

                // Tab switching
                tabs.forEach(tab => {
                    tab.addEventListener('click', () => {
                        const tabName = tab.dataset.tab;
                        tabs.forEach(t => {
                            t.classList.remove('active');
                            t.style.borderLeftColor = 'transparent';
                            t.style.background = 'transparent';
                        });
                        tab.classList.add('active');
                        tab.style.borderLeftColor = '#58a6ff';
                        tab.style.background = 'rgba(88, 166, 255, 0.1)';

                        tabContents.forEach(content => {
                            content.style.display = 'none';
                        });
                        document.querySelector(`#${wId} #tab-${tabName}`).style.display = 'block';
                    });
                });

                // Load and refresh data
                const loadGuardianData = async () => {
                    try {
                        const res = await fetch('/api/guardian/status');
                        const data = await res.json();
                        
                        // Update checkboxes
                        enabledCheckbox.checked = data.enabled || false;
                        verboseCheckbox.checked = data.verbose || false;

                        // Update stats
                        const statsDiv = document.querySelector(`#${wId} #guardian-stats`);
                        if (statsDiv) {
                            const stats = data.stats || {};
                            statsDiv.innerHTML = `
                                <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px;">
                                    <div style="font-size: 11px; color: #8b949e; margin-bottom: 5px;">Threats Detected</div>
                                    <div style="font-size: 24px; font-weight: 600; color: #f85149;">${stats.threats_detected || 0}</div>
                                </div>
                                <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px;">
                                    <div style="font-size: 11px; color: #8b949e; margin-bottom: 5px;">Alerts Generated</div>
                                    <div style="font-size: 24px; font-weight: 600; color: #58a6ff;">${stats.alerts_generated || 0}</div>
                                </div>
                                <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px;">
                                    <div style="font-size: 11px; color: #8b949e; margin-bottom: 5px;">Honeypots Detected</div>
                                    <div style="font-size: 24px; font-weight: 600; color: #f59e0b;">${stats.honeypots_detected || 0}</div>
                                </div>
                            `;
                        }

                        // Update Recent Activity
                        const activityDiv = document.querySelector(`#${wId} #guardian-activity`);
                        if (activityDiv) {
                            const operationHistory = data.operation_history || [];
                            if (operationHistory.length === 0) {
                                activityDiv.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 10px;">No recent activity</div>';
                            } else {
                                // Reverse to show most recent first
                                const recentActivities = operationHistory.slice().reverse().slice(0, 10);
                                activityDiv.innerHTML = recentActivities.map(op => {
                                    // Handle both dict-like objects and regular objects
                                    // operation_history entries have: target, timestamp, response_time, module_name, risk, severity, etc.
                                    const timestamp = op?.timestamp || op?.normalized?.timestamp || '';
                                    const target = op?.target || op?.normalized?.target || 'Unknown';
                                    const moduleName = op?.module_name || op?.module || 'Module execution';
                                    const operation = op?.operation || moduleName || 'Unknown operation';
                                    const risk = op?.risk || 0;
                                    const severity = op?.severity || '';
                                    const responseTime = op?.response_time || op?.normalized?.response_time || null;
                                    
                                    const riskColor = risk >= 70 ? '#f85149' : risk >= 40 ? '#f59e0b' : '#58a6ff';
                                    const severityColor = severity === 'CRITICAL' ? '#f85149' : severity === 'WARNING' ? '#f59e0b' : '#58a6ff';
                                    
                                    // Format timestamp
                                    let formattedTime = '';
                                    if (timestamp) {
                                        try {
                                            const date = new Date(timestamp);
                                            if (!isNaN(date.getTime())) {
                                                const day = String(date.getDate()).padStart(2, '0');
                                                const month = String(date.getMonth() + 1).padStart(2, '0');
                                                const year = String(date.getFullYear()).slice(-2);
                                                const hours = String(date.getHours()).padStart(2, '0');
                                                const minutes = String(date.getMinutes()).padStart(2, '0');
                                                formattedTime = `${day}/${month}/${year} ${hours}:${minutes}`;
                                            } else {
                                                formattedTime = String(timestamp).substring(0, 16);
                                            }
                                        } catch (e) {
                                            formattedTime = String(timestamp).substring(0, 16);
                                        }
                                    }
                                    
                                    const responseTimeStr = responseTime ? ` (${Math.round(responseTime)}ms)` : '';
                                    
                                    return `
                                        <div style="padding: 10px; margin-bottom: 8px; background: rgba(255,255,255,0.02); border-left: 3px solid ${riskColor}; border-radius: 4px;">
                                            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 4px;">
                                                <div style="flex: 1;">
                                                    <div style="font-weight: 600; color: #c9d1d9; font-size: 13px;">${operation}${responseTimeStr}</div>
                                                    <div style="font-size: 11px; color: #8b949e; margin-top: 2px;">Target: ${target}</div>
                                                    ${severity ? `<div style="font-size: 10px; color: ${severityColor}; margin-top: 2px; font-weight: 600;">${severity}</div>` : ''}
                                                </div>
                                                <div style="text-align: right;">
                                                    <div style="font-size: 10px; color: ${riskColor}; font-weight: 600;">Risk: ${Math.round(risk)}%</div>
                                                    <div style="font-size: 10px; color: #6e7681; margin-top: 2px;">${formattedTime}</div>
                                                </div>
                                            </div>
                                        </div>
                                    `;
                                }).join('');
                            }
                        }

                        // Helper function to format date in European format (dd/mm/yy)
                        const formatEuropeanDate = (timestamp) => {
                            if (!timestamp) return '';
                            try {
                                const date = new Date(timestamp);
                                if (isNaN(date.getTime())) return timestamp; // Return original if invalid
                                const day = String(date.getDate()).padStart(2, '0');
                                const month = String(date.getMonth() + 1).padStart(2, '0');
                                const year = String(date.getFullYear()).slice(-2);
                                return `${day}/${month}/${year}`;
                            } catch (e) {
                                return timestamp; // Return original if parsing fails
                            }
                        };

                        // Helper function to format date with time in European format (dd/mm/yy HH:mm)
                        const formatEuropeanDateTime = (timestamp) => {
                            if (!timestamp) return '';
                            try {
                                const date = new Date(timestamp);
                                if (isNaN(date.getTime())) return timestamp; // Return original if invalid
                                const day = String(date.getDate()).padStart(2, '0');
                                const month = String(date.getMonth() + 1).padStart(2, '0');
                                const year = String(date.getFullYear()).slice(-2);
                                const hours = String(date.getHours()).padStart(2, '0');
                                const minutes = String(date.getMinutes()).padStart(2, '0');
                                return `${day}/${month}/${year} ${hours}:${minutes}`;
                            } catch (e) {
                                return timestamp; // Return original if parsing fails
                            }
                        };

                        // Update blacklist
                        const blacklistDiv = document.querySelector(`#${wId} #blacklist-list`);
                        if (blacklistDiv) {
                            const blacklist = data.blacklist || {};
                            if (Object.keys(blacklist).length === 0) {
                                blacklistDiv.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 20px;">No blacklisted IPs</div>';
                            } else {
                                blacklistDiv.innerHTML = Object.entries(blacklist).map(([ip, info]) => `
                                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; margin-bottom: 8px; background: rgba(248, 81, 73, 0.1); border: 1px solid #f85149; border-radius: 4px;">
                                        <div>
                                            <div style="font-weight: 600; color: #f85149; margin-bottom: 4px;">${ip}</div>
                                            <div style="font-size: 11px; color: #8b949e;">${info.reason || 'No reason'}</div>
                                            <div style="font-size: 10px; color: #6e7681; margin-top: 4px;">${formatEuropeanDate(info.timestamp)}</div>
                                        </div>
                                        <button class="remove-blacklist-btn" data-ip="${ip}" style="padding: 6px 12px; background: transparent; border: 1px solid #f85149; border-radius: 4px; color: #f85149; cursor: pointer; font-size: 12px;">
                                            Remove
                                        </button>
                                    </div>
                                `).join('');
                                
                                // Add remove handlers
                                document.querySelectorAll(`#${wId} .remove-blacklist-btn`).forEach(btn => {
                                    btn.addEventListener('click', async () => {
                                        const ip = btn.dataset.ip;
                                        const res = await fetch('/api/guardian/blacklist/remove', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ ip: ip })
                                        });
                                        if (res.ok) {
                                            loadGuardianData();
                                            // Update the widget on desktop
                                            self.loadGuardians();
                                        }
                                    });
                                });
                            }
                        }

                        // Update whitelist
                        const whitelistDiv = document.querySelector(`#${wId} #whitelist-list`);
                        if (whitelistDiv) {
                            const whitelist = data.whitelist || [];
                            if (whitelist.length === 0) {
                                whitelistDiv.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 20px;">No whitelisted IPs</div>';
                            } else {
                                whitelistDiv.innerHTML = whitelist.map(ip => `
                                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; margin-bottom: 8px; background: rgba(35, 134, 54, 0.1); border: 1px solid #238636; border-radius: 4px;">
                                        <div style="font-weight: 600; color: #238636;">${ip}</div>
                                        <button class="remove-whitelist-btn" data-ip="${ip}" style="padding: 6px 12px; background: transparent; border: 1px solid #238636; border-radius: 4px; color: #238636; cursor: pointer; font-size: 12px;">
                                            Remove
                                        </button>
                                    </div>
                                `).join('');
                                
                                // Add remove handlers
                                document.querySelectorAll(`#${wId} .remove-whitelist-btn`).forEach(btn => {
                                    btn.addEventListener('click', async () => {
                                        const ip = btn.dataset.ip;
                                        const res = await fetch('/api/guardian/whitelist/remove', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ ip: ip })
                                        });
                                        if (res.ok) {
                                            loadGuardianData();
                                            // Update the widget on desktop
                                            self.loadGuardians();
                                        }
                                    });
                                });
                            }
                        }

                        // Update alerts
                        const alertsDiv = document.querySelector(`#${wId} #alerts-list`);
                        if (alertsDiv) {
                            const alerts = data.alerts || [];
                            if (alerts.length === 0) {
                                alertsDiv.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 20px;">No alerts</div>';
                            } else {
                                alertsDiv.innerHTML = alerts.reverse().map(alert => {
                                    const severityColor = alert.severity === 'CRITICAL' ? '#f85149' : 
                                                         alert.severity === 'WARNING' ? '#f59e0b' : '#58a6ff';
                                    return `
                                        <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.03); border-left: 3px solid ${severityColor}; border-radius: 4px;">
                                            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                                                <div>
                                                    <span style="font-weight: 600; color: ${severityColor}; margin-right: 8px;">${alert.severity}</span>
                                                    <span style="color: #c9d1d9;">${alert.target || 'Unknown'}</span>
                                                </div>
                                                <span style="font-size: 11px; color: #8b949e;">${formatEuropeanDateTime(alert.timestamp)}</span>
                                            </div>
                                            <div style="color: #c9d1d9; font-size: 13px; margin-bottom: 6px;">${alert.issue || ''}</div>
                                            ${alert.recommendations && alert.recommendations.length > 0 ? `
                                                <div style="font-size: 11px; color: #8b949e; margin-top: 6px;">
                                                    <strong>Recommendations:</strong> ${alert.recommendations.join(', ')}
                                                </div>
                                            ` : ''}
                                        </div>
                                    `;
                                }).join('');
                            }
                        }

                    } catch (err) {
                        console.error('Error loading guardian data:', err);
                    }
                };

                // Enable/Disable handlers
                enabledCheckbox.addEventListener('change', async () => {
                    const endpoint = enabledCheckbox.checked ? '/api/guardian/enable' : '/api/guardian/disable';
                    const body = enabledCheckbox.checked ? {
                        verbose: verboseCheckbox.checked
                    } : {};
                    
                    const res = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    if (res.ok) {
                        loadGuardianData();
                        // Update the widget on desktop
                        await self.loadGuardians();
                    }
                });

                verboseCheckbox.addEventListener('change', async () => {
                    if (enabledCheckbox.checked) {
                        await fetch('/api/guardian/enable', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                verbose: verboseCheckbox.checked
                            })
                        });
                    }
                });

                // Add IP handlers
                addBlacklistBtn.addEventListener('click', () => {
                    this.showAddIPDialog('blacklist', (ip, reason) => {
                        fetch('/api/guardian/blacklist/add', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ip: ip, reason: reason || 'Manual addition' })
                        }).then(res => {
                            if (res.ok) {
                                loadGuardianData();
                                // Update the widget on desktop
                                self.loadGuardians();
                            }
                        });
                    });
                });

                addWhitelistBtn.addEventListener('click', () => {
                    this.showAddIPDialog('whitelist', (ip) => {
                        fetch('/api/guardian/whitelist/add', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ip: ip })
                        }).then(res => {
                            if (res.ok) {
                                loadGuardianData();
                                // Update the widget on desktop
                                self.loadGuardians();
                            }
                        });
                    });
                });

                // Initial load
                loadGuardianData();
                // Refresh every 5 seconds
                setInterval(loadGuardianData, 5000);
            }
        });
    }

    showAddIPDialog(type, callback) {
        // type: 'blacklist' or 'whitelist'
        const isBlacklist = type === 'blacklist';
        const title = isBlacklist ? 'Add IP to Blacklist' : 'Add IP to Whitelist';
        
        const dialogId = this.wm.createWindow({
            title: title,
            icon: isBlacklist ? 'ban-outline' : 'checkmark-circle-outline',
            width: '450px',
            height: isBlacklist ? '280px' : '220px',
            top: '200px',
            left: '400px',
            content: `
                <div style="padding: 20px; display: flex; flex-direction: column; gap: 15px;">
                    <div>
                        <label style="display: block; margin-bottom: 8px; color: #c9d1d9; font-size: 13px; font-weight: 500;">
                            IP Address:
                        </label>
                        <input 
                            type="text" 
                            id="dialog-ip-input" 
                            placeholder="e.g., 192.168.1.1" 
                            style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px; outline: none;"
                            autofocus
                        />
                    </div>
                    ${isBlacklist ? `
                    <div>
                        <label style="display: block; margin-bottom: 8px; color: #c9d1d9; font-size: 13px; font-weight: 500;">
                            Reason (optional):
                        </label>
                        <input 
                            type="text" 
                            id="dialog-reason-input" 
                            placeholder="e.g., Manual addition" 
                            style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px; outline: none;"
                        />
                    </div>
                    ` : ''}
                    <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 10px;">
                        <button 
                            id="dialog-cancel-btn"
                            style="padding: 10px 20px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; cursor: pointer; font-size: 13px; font-weight: 500;"
                        >
                            Cancel
                        </button>
                        <button 
                            id="dialog-submit-btn"
                            style="padding: 10px 20px; background: ${isBlacklist ? '#f85149' : '#238636'}; border: 1px solid ${isBlacklist ? '#f85149' : '#238636'}; border-radius: 6px; color: white; cursor: pointer; font-size: 13px; font-weight: 500;"
                        >
                            Add IP
                        </button>
                    </div>
                </div>
            `,
            onLoad: (winId) => {
                const ipInput = document.querySelector(`#${winId} #dialog-ip-input`);
                const reasonInput = document.querySelector(`#${winId} #dialog-reason-input`);
                const cancelBtn = document.querySelector(`#${winId} #dialog-cancel-btn`);
                const submitBtn = document.querySelector(`#${winId} #dialog-submit-btn`);
                
                const closeDialog = () => {
                    this.wm.closeWindow(dialogId);
                };
                
                const submit = () => {
                    const ip = ipInput.value.trim();
                    if (!ip) {
                        ipInput.style.borderColor = '#f85149';
                        ipInput.focus();
                        return;
                    }
                    
                    // Basic IP validation
                    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
                    if (!ipRegex.test(ip)) {
                        ipInput.style.borderColor = '#f85149';
                        ipInput.focus();
                        return;
                    }
                    
                    const reason = isBlacklist ? (reasonInput ? reasonInput.value.trim() : 'Manual addition') : null;
                    closeDialog();
                    callback(ip, reason);
                };
                
                cancelBtn.addEventListener('click', closeDialog);
                submitBtn.addEventListener('click', submit);
                
                // Handle Enter key
                ipInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        submit();
                    }
                });
                
                if (reasonInput) {
                    reasonInput.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') {
                            submit();
                        }
                    });
                }
                
                // Focus on IP input
                setTimeout(() => ipInput.focus(), 100);
            }
        });
    }

    showConfirmDialog(message, title = 'Confirm', icon = 'warning-outline', confirmText = 'Confirm', cancelText = 'Cancel', confirmColor = '#f85149') {
        const self = this;
        return new Promise((resolve) => {
            const dialogId = self.wm.createWindow({
                title: title,
                icon: icon,
                width: '450px',
                height: '200px',
                top: '250px',
                left: '400px',
                content: `
                    <div style="padding: 20px; display: flex; flex-direction: column; gap: 15px; height: 100%;">
                        <div style="flex: 1; display: flex; align-items: center; color: #c9d1d9; font-size: 14px; line-height: 1.5;">
                            ${message}
                        </div>
                        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: auto;">
                            <button 
                                id="confirm-dialog-cancel-btn"
                                style="padding: 10px 20px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; cursor: pointer; font-size: 13px; font-weight: 500;"
                            >
                                ${cancelText}
                            </button>
                            <button 
                                id="confirm-dialog-submit-btn"
                                style="padding: 10px 20px; background: ${confirmColor}; border: 1px solid ${confirmColor}; border-radius: 6px; color: white; cursor: pointer; font-size: 13px; font-weight: 500;"
                            >
                                ${confirmText}
                            </button>
                        </div>
                    </div>
                `,
                onLoad: (winId) => {
                    const cancelBtn = document.querySelector(`#${winId} #confirm-dialog-cancel-btn`);
                    const submitBtn = document.querySelector(`#${winId} #confirm-dialog-submit-btn`);
                    
                    const closeDialog = (result) => {
                        self.wm.closeWindow(dialogId);
                        resolve(result);
                    };
                    
                    cancelBtn.addEventListener('click', () => closeDialog(false));
                    submitBtn.addEventListener('click', () => closeDialog(true));
                    
                    // Handle Escape key
                    const handleKeyPress = (e) => {
                        if (e.key === 'Escape') {
                            closeDialog(false);
                            document.removeEventListener('keydown', handleKeyPress);
                        }
                    };
                    document.addEventListener('keydown', handleKeyPress);
                    
                    // Focus on confirm button
                    setTimeout(() => submitBtn.focus(), 100);
                }
            });
        });
    }

    spawnTerminal(initialCommand = null) {
        const terminalId = 'term_' + Math.floor(Math.random() * 1000000);
        let termInstance = null;

        const winId = this.wm.createWindow({
            title: 'KittySploit Terminal',
            icon: 'terminal-outline',
            width: '800px',
            height: '500px',
            content: `<div id="${terminalId}_container" style="height: 100%; background: #0d1117; position: relative; overflow: hidden;"></div>`,
            onClose: () => {
                // Remove from active terminals list
                if (termInstance) {
                    this.terminals = this.terminals.filter(t => t !== termInstance);
                    
                    // Remove the socket listener for this terminal
                    if (termInstance._outputHandler && this.socket) {
                        this.socket.off('terminal_output', termInstance._outputHandler);
                    }

                    // Remove IRC socket listeners for this terminal (if any)
                    if (this.socket && termInstance._ircMessageHandler) {
                        this.socket.off('irc_message', termInstance._ircMessageHandler);
                    }
                    if (this.socket && termInstance._ircConnectedHandler) {
                        this.socket.off('irc_connected', termInstance._ircConnectedHandler);
                    }
                    if (this.socket && termInstance._ircErrorHandler) {
                        this.socket.off('irc_error', termInstance._ircErrorHandler);
                    }
                    
                    // Leave session
                    if (this.socket) {
                        this.socket.emit('leave_terminal_session', { session_id: terminalId });
                    }
                }
            },
            onLoad: (id) => {
                const container = document.querySelector(`#${id} #${terminalId}_container`);

                // Create xterm instance
                termInstance = new Terminal({
                    theme: {
                        background: '#0d1117',
                        foreground: '#c9d1d9',
                        cursor: '#58a6ff',
                        black: '#0d1117',
                        red: '#ff7b72',
                        green: '#3fb950',
                        yellow: '#d29922',
                        blue: '#58a6ff',
                        magenta: '#bc8cff',
                        cyan: '#76e3ea',
                        white: '#c9d1d9'
                    },
                    cursorBlink: true,
                    fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
                    fontSize: 14,
                    lineHeight: 1.2
                });

                const fitAddon = new FitAddon.FitAddon();
                termInstance.loadAddon(fitAddon);
                termInstance.open(container);
                fitAddon.fit();

                // Lightweight autocomplete UI overlay (DOM) - keeps xterm clean
                const escapeHtml = (s) => String(s ?? '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');

                const suggestBox = document.createElement('div');
                suggestBox.className = 'ks-terminal-suggest';
                suggestBox.style.cssText = [
                    'position:absolute',
                    'left:10px',
                    'right:10px',
                    'bottom:10px',
                    'z-index:50',
                    'display:none',
                    'max-height:180px',
                    'overflow:auto',
                    'background:rgba(13,17,23,0.92)',
                    'border:1px solid rgba(48,54,61,0.9)',
                    'border-radius:10px',
                    'backdrop-filter: blur(8px)',
                    '-webkit-backdrop-filter: blur(8px)',
                    'box-shadow: 0 12px 40px rgba(0,0,0,0.45)',
                    'padding:8px',
                    'font-family:"Cascadia Code","Fira Code","Consolas",monospace',
                    'font-size:12px',
                    'color:#c9d1d9'
                ].join(';');
                container.appendChild(suggestBox);
                // Click-to-complete
                suggestBox.addEventListener('mousedown', (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const row = ev.target && ev.target.closest ? ev.target.closest('div[data-idx]') : null;
                    if (!row) return;
                    const idx = parseInt(row.getAttribute('data-idx') || '-1', 10);
                    if (!Number.isFinite(idx) || idx < 0) return;
                    autocompleteIndex = idx;
                    if (autocompleteSuggestions && autocompleteSuggestions[idx]) {
                        applySuggestion(autocompleteSuggestions[idx]);
                    }
                });
                // Click outside closes
                container.addEventListener('mousedown', () => {
                    if (suggestBox.style.display === 'block') {
                        hideSuggestBox();
                    }
                });

                // Register this terminal
                termInstance.sessionId = terminalId;
                this.terminals.push(termInstance);

                // Join Isolated Session
                this.socket.emit('join_terminal_session', { session_id: terminalId });

                // Command buffer
                let currLine = '';
                let commandHistory = [];
                let historyIndex = -1;
                let availableCommands = []; // string[]
                let commandMeta = new Map(); // name -> { description, usage }
                let availableModules = []; // string[] (paths)
                let autocompleteIndex = -1; // selection index (overlay)
                let autocompleteSuggestions = []; // { insertText, label, type, description, usage }[]
                let autocompleteContext = null; // { tokenStart, tokenEnd, token, endsWithSpace, firstWord }
                let cursorPosition = 0;
                
                // Module context
                let currentModule = null;
                let moduleOptions = {};
                let moduleInfo = null;
                let recentModules = [];

                // Interactive apps (IRC / Interpreter) should be opened as apps,
                // not embedded inside the terminal input loop.

                try {
                    const raw = localStorage.getItem('kittyos_recent_modules');
                    const parsed = raw ? JSON.parse(raw) : [];
                    if (Array.isArray(parsed)) recentModules = parsed.filter(Boolean).slice(0, 25);
                } catch (_) { /* ignore */ }
                
                // Get current prompt based on module context
                const getPrompt = () => {
                    if (currentModule) {
                        // Extract short module name (last part of path)
                        const moduleName = currentModule.split('/').pop();
                        return `kitty(${moduleName}) > `;
                    }
                    return 'kitty> ';
                };

                const resetCurrentInput = () => {
                    currLine = '';
                    cursorPosition = 0;
                };

                const hideSuggestBox = () => {
                    suggestBox.style.display = 'none';
                    suggestBox.innerHTML = '';
                    autocompleteIndex = -1;
                    autocompleteSuggestions = [];
                    autocompleteContext = null;
                };

                const showPrompt = () => {
                    termInstance.write(getPrompt());
                    resetCurrentInput();
                    hideSuggestBox();
                };

                const renderCurrentInput = (force = false) => {
                    // Only render if we need to update cursor position or force update
                    // For simple character insertion, we write directly
                    if (!force && cursorPosition === currLine.length) {
                        return; // Cursor is at end, no need to re-render
                    }
                    
                    const prompt = getPrompt();
                    termInstance.write('\r\x1b[2K');
                    termInstance.write(prompt + currLine);
                    cursorPosition = Math.max(0, Math.min(cursorPosition, currLine.length));
                    const moveLeft = currLine.length - cursorPosition;
                    if (moveLeft > 0) {
                        termInstance.write(`\x1b[${moveLeft}D`);
                    }
                };

                showPrompt();

                // Load available commands for autocomplete
                const loadCommands = async () => {
                    try {
                        const response = await fetch('/api/commands/autocomplete');
                        const data = await response.json();
                        const cmds = Array.isArray(data.commands) ? data.commands : [];
                        availableCommands = cmds.map(c => c.name).filter(Boolean);
                        commandMeta = new Map(
                            cmds
                                .filter(c => c && c.name)
                                .map(c => [c.name, { description: c.description || '', usage: c.usage || '' }])
                        );
                        availableModules = Array.isArray(data.modules) ? data.modules : [];
                    } catch (err) {
                        console.error('Error loading commands:', err);
                        // Fallback commands
                        availableCommands = ['help', 'use', 'show', 'set', 'run', 'sessions', 'jobs', 'exit', 'modules', 'plugins', 'workspace', 'search', 'info', 'options', 'check', 'execute', 'shell', 'background', 'back', 'exploit'];
                        availableModules = [];
                        commandMeta = new Map();
                    }
                };
                loadCommands();

                const loadTerminalHistory = async () => {
                    try {
                        const res = await fetch('/api/terminal/history?limit=200');
                        if (res.ok) {
                            const data = await res.json();
                            const remoteHistory = (data.history || [])
                                .map(entry => entry.command)
                                .filter(cmd => typeof cmd === 'string' && cmd.trim().length > 0);
                            if (remoteHistory.length > 0) {
                                const pendingLocal = commandHistory.slice();
                                commandHistory = remoteHistory.concat(pendingLocal);
                                historyIndex = commandHistory.length;
                            }
                        }
                    } catch (err) {
                        console.error('Error loading terminal history:', err);
                    }
                };
                loadTerminalHistory();

                // Handle 'use' command to load a module
                const handleUseCommand = async (modulePath) => {
                    try {
                        const encodedPath = encodeURIComponent(modulePath);
                        const res = await fetch(`/api/modules/${encodedPath}/load`);
                        
                        if (res.ok) {
                            const data = await res.json();
                            currentModule = modulePath;

                            // Remember recently used modules for fast autocomplete
                            try {
                                recentModules = [modulePath, ...recentModules.filter(m => m !== modulePath)].slice(0, 25);
                                localStorage.setItem('kittyos_recent_modules', JSON.stringify(recentModules));
                            } catch (_) { /* ignore */ }
                            
                            // Store module info
                            moduleInfo = {
                                name: data.name || modulePath,
                                description: data.description || '',
                                author: data.author || 'Unknown',
                                options: data.options || []
                            };
                            
                            // Initialize moduleOptions with current values
                            moduleOptions = {};
                            if (moduleInfo.options) {
                                moduleInfo.options.forEach(opt => {
                                    if (opt.current_value !== null && opt.current_value !== undefined) {
                                        moduleOptions[opt.name] = opt.current_value;
                                    }
                                });
                            }
                            
                            // Display module information
                            termInstance.write(`\x1b[92m[+] Using module: ${moduleInfo.name}\x1b[0m\r\n`);
                            if (moduleInfo.description) {
                                termInstance.write(`\x1b[96mDescription: ${moduleInfo.description}\x1b[0m\r\n`);
                            }
                            if (moduleInfo.author && moduleInfo.author !== 'Unknown') {
                                termInstance.write(`\x1b[96mAuthor: ${moduleInfo.author}\x1b[0m\r\n`);
                            }
                            termInstance.write('\r\n');
                            
                            // Display module options
                            displayModuleOptions();
                            
                            termInstance.write('\r\n');
                            showPrompt();
                        } else {
                            const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
                            let errorMsg = errorData.error || 'Module not found';
                            
                            // Show more details if available
                            if (errorData.hint) {
                                errorMsg += `\r\n\x1b[90mHint: ${errorData.hint}\x1b[0m`;
                            }
                            if (errorData.discovered_sample && errorData.discovered_sample.length > 0) {
                                errorMsg += `\r\n\x1b[90mSample discovered paths: ${errorData.discovered_sample.slice(0, 3).join(', ')}\x1b[0m`;
                            }
                            if (errorData.available_modules_sample && errorData.available_modules_sample.length > 0) {
                                errorMsg += `\r\n\x1b[90mSimilar modules: ${errorData.available_modules_sample.slice(0, 3).join(', ')}\x1b[0m`;
                            }
                            
                            termInstance.write(`\x1b[91m[!] Error loading module: ${errorMsg}\x1b[0m\r\n`);
                            showPrompt();
                        }
                    } catch (err) {
                        console.error('Error loading module:', err);
                        termInstance.write(`\x1b[91m[!] Error loading module: ${err.message}\x1b[0m\r\n`);
                        showPrompt();
                    }
                };

                // Display module options
                const displayModuleOptions = () => {
                    if (!currentModule || !moduleInfo || !moduleInfo.options || moduleInfo.options.length === 0) {
                        termInstance.write('\x1b[93mModule options:\x1b[0m\r\n');
                        termInstance.write('\x1b[90mNo options available\x1b[0m\r\n');
                        return;
                    }
                    
                    termInstance.write('\x1b[93mModule options:\x1b[0m\r\n');
                    termInstance.write('\x1b[90m' + '='.repeat(120) + '\x1b[0m\r\n');
                    termInstance.write(`\x1b[96m${'Name'.padEnd(20)} | ${'Current Setting'.padEnd(20)} | ${'Required'.padEnd(10)} | Description\x1b[0m\r\n`);
                    termInstance.write('\x1b[90m' + '-'.repeat(120) + '\x1b[0m\r\n');
                    
                    const basicOptions = moduleInfo.options.filter(opt => !opt.advanced);
                    const advancedOptions = moduleInfo.options.filter(opt => opt.advanced);
                    
                    // Display basic options with current values from moduleOptions
                    basicOptions.forEach(opt => {
                        const name = (opt.name || '').padEnd(20);
                        // Use value from moduleOptions if set, otherwise use default from API
                        const currentValue = moduleOptions[opt.name] !== undefined 
                            ? String(moduleOptions[opt.name]) 
                            : (opt.current_value !== null && opt.current_value !== undefined ? String(opt.current_value) : '');
                        const value = currentValue.padEnd(20);
                        const required = (opt.required ? 'yes' : 'no').padEnd(10);
                        const desc = opt.description || '';
                        termInstance.write(`${name} | ${value} | ${required} | ${desc}\r\n`);
                    });
                    
                    if (advancedOptions.length > 0) {
                        termInstance.write(`\r\n\x1b[90m(${advancedOptions.length} advanced option(s) hidden - use 'show advanced' to view)\x1b[0m\r\n`);
                    }
                    
                    termInstance.write('\x1b[90m' + '='.repeat(120) + '\x1b[0m\r\n');
                };

                // Autocomplete function
                const rankMatches = (query, values, max = 30) => {
                    const q = (query || '').toLowerCase();
                    if (!q) return [];
                    const scored = [];
                    for (const v of values) {
                        const s = String(v || '');
                        const sl = s.toLowerCase();
                        let score = -1;
                        if (sl.startsWith(q)) score = 1000 - sl.length;
                        else {
                            const idx = sl.indexOf(q);
                            if (idx >= 0) score = 400 - idx - sl.length;
                        }
                        if (score >= 0) scored.push([score, s]);
                    }
                    scored.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
                    return scored.slice(0, max).map(x => x[1]);
                };

                const getAutocompleteContext = () => {
                    // Context is computed from text BEFORE cursor (so mid-line edits work reasonably)
                    const before = currLine.slice(0, cursorPosition);
                    const endsWithSpace = /\s$/.test(before);
                    const trimmedBefore = before.trim();
                    // Allow suggestions on empty line (e.g. Ctrl+Space)
                    if (!trimmedBefore && !endsWithSpace) {
                        return { tokenStart: cursorPosition, tokenEnd: cursorPosition, token: '', endsWithSpace: false, firstWord: '' };
                    }

                    const token = endsWithSpace ? '' : (trimmedBefore.split(/\s+/).pop() || '');
                    const tokenStart = endsWithSpace ? cursorPosition : (before.length - token.length);
                    const tokenEnd = tokenStart + token.length;

                    const fullParts = currLine.trim().split(/\s+/).filter(Boolean);
                    const firstWord = (fullParts[0] || '').toLowerCase();

                    return { tokenStart, tokenEnd, token, endsWithSpace, firstWord };
                };

                const getAutocompleteSuggestions = () => {
                    const ctx = getAutocompleteContext();
                    if (!ctx) return { ctx: null, items: [] };

                    const { token, endsWithSpace, firstWord } = ctx;
                    const moduleContextCommands = ['use', 'info', 'edit', 'check', 'run', 'exploit'];

                    // 0) Empty line: offer a compact "starter" command palette
                    if (!currLine.trim() && !token && !firstWord) {
                        const favorites = ['help', 'use', 'show', 'set', 'run', 'modules', 'search', 'sessions', 'jobs', 'history', 'plugins', 'exit'];
                        const names = favorites.filter(x => availableCommands.includes(x)).concat(
                            availableCommands.filter(x => !favorites.includes(x)).slice(0, 12)
                        ).slice(0, 12);
                        return {
                            ctx,
                            items: names.map(name => {
                                const meta = commandMeta.get(name) || { description: '', usage: '' };
                                return { type: 'command', label: name, insertText: name, description: meta.description || '', usage: meta.usage || '' };
                            })
                        };
                    }

                    // 1) Module option name completion: set <option> ...
                    if (currentModule && firstWord === 'set') {
                        const before = currLine.slice(0, cursorPosition);
                        const parts = before.trim().split(/\s+/).filter(Boolean);
                        const isEditingOptionName = (parts.length === 1 && (endsWithSpace || token.length > 0)) || (parts.length === 2 && !endsWithSpace);
                        if (isEditingOptionName) {
                            const names = (moduleInfo?.options || []).map(o => o?.name).filter(Boolean);
                            const matches = token ? rankMatches(token, names, 25) : names.slice(0, 25);
                            return {
                                ctx,
                                items: matches.map(name => ({
                                    type: 'option',
                                    label: name,
                                    insertText: name,
                                    description: (moduleInfo?.options || []).find(o => o?.name === name)?.description || '',
                                    usage: ''
                                }))
                            };
                        }
                    }

                    // 2) Module path completion: use/info/edit/check/run/exploit <module>
                    if (moduleContextCommands.includes(firstWord)) {
                        // Only suggest modules once a space exists after the command (or user is editing arg)
                        const before = currLine.slice(0, cursorPosition);
                        const hasSpaceAfterCmd = /\s/.test(before.trim().slice(firstWord.length, firstWord.length + 1)) || /\s/.test(before);
                        if (hasSpaceAfterCmd) {
                            let candidates = availableModules;
                            if (!token) {
                                // If no token, offer recent modules (practical default)
                                candidates = recentModules.length ? recentModules.slice(0, 15) : availableModules.slice(0, 15);
                            }
                            const matches = token ? rankMatches(token, candidates, 30) : candidates.slice(0, 15);
                            return {
                                ctx,
                                items: matches.map(p => ({
                                    type: 'module',
                                    label: p,
                                    insertText: p,
                                    description: '',
                                    usage: ''
                                }))
                            };
                        }
                    }

                    // 3) Subcommands for "show" inside module context
                    if (firstWord === 'show') {
                        const showItems = currentModule
                            ? ['options', 'advanced']
                            : ['modules', 'plugins', 'sessions', 'jobs', 'workspaces'];
                        const matches = token ? rankMatches(token, showItems, 10) : showItems;
                        return {
                            ctx,
                            items: matches.map(x => ({ type: 'arg', label: x, insertText: x, description: '', usage: '' }))
                        };
                    }

                    // 4) Command name completion (first token)
                    if (!token && !endsWithSpace) return { ctx, items: [] };
                    if (!token) return { ctx, items: [] };

                    const matches = rankMatches(token, availableCommands, 25);
                    return {
                        ctx,
                        items: matches.map(name => {
                            const meta = commandMeta.get(name) || { description: '', usage: '' };
                            return {
                                type: 'command',
                                label: name,
                                insertText: name,
                                description: meta.description || '',
                                usage: meta.usage || ''
                            };
                        })
                    };
                };

                const renderSuggestBox = () => {
                    if (!autocompleteSuggestions || autocompleteSuggestions.length === 0) {
                        hideSuggestBox();
                        return;
                    }
                    const selected = Math.max(0, Math.min(autocompleteIndex, autocompleteSuggestions.length - 1));
                    autocompleteIndex = selected;

                    const rows = autocompleteSuggestions.map((it, idx) => {
                        const active = idx === selected;
                        const left = `<span style="display:inline-block; min-width: 110px; color:${active ? '#0d1117' : '#c9d1d9'}; font-weight:${active ? '700' : '600'};">${escapeHtml(it.label)}</span>`;
                        const type = `<span style="display:inline-block; min-width: 72px; color:${active ? '#0d1117' : '#8b949e'};">${escapeHtml(it.type)}</span>`;
                        const extra = it.usage || it.description || '';
                        const right = `<span style="color:${active ? '#0d1117' : '#8b949e'};">${escapeHtml(extra)}</span>`;
                        return `<div data-idx="${idx}" style="padding:6px 8px; border-radius:8px; background:${active ? '#58a6ff' : 'transparent'}; cursor:default; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${type}${left}${right}</div>`;
                    }).join('');

                    const hint = `<div style="padding:6px 8px; margin-top:6px; border-top:1px solid rgba(48,54,61,0.8); color:#8b949e;">
                        Tab: complete • ↑↓: navigate • Esc: close • Ctrl+Space: suggestions
                    </div>`;

                    suggestBox.innerHTML = rows + hint;
                    suggestBox.style.display = 'block';

                    // Ensure selected row stays visible while navigating
                    try {
                        const selectedRow = suggestBox.querySelector(`div[data-idx="${autocompleteIndex}"]`);
                        if (selectedRow && selectedRow.scrollIntoView) {
                            selectedRow.scrollIntoView({ block: 'nearest' });
                        }
                    } catch (_) { /* ignore */ }
                };

                let suggestDebounce = null;
                const updateSuggestions = (forceOpen = false) => {
                    if (suggestDebounce) clearTimeout(suggestDebounce);
                    suggestDebounce = setTimeout(() => {
                        const { ctx, items } = getAutocompleteSuggestions();
                        autocompleteContext = ctx;
                        autocompleteSuggestions = items;
                        if (!items || items.length === 0) {
                            hideSuggestBox();
                            return;
                        }
                        if (autocompleteIndex < 0) autocompleteIndex = 0;
                        if (forceOpen) {
                            renderSuggestBox();
                        } else if (suggestBox.style.display === 'block') {
                            renderSuggestBox();
                        }
                    }, 50);
                };

                const applySuggestion = (item) => {
                    if (!item || !autocompleteContext) return;
                    const { tokenStart, tokenEnd, firstWord } = autocompleteContext;
                    const before = currLine.slice(0, tokenStart);
                    const after = currLine.slice(tokenEnd);
                    currLine = before + item.insertText + after;
                    cursorPosition = (before + item.insertText).length;

                    // Convenience: add trailing space for command / option name completions
                    if (item.type === 'command') {
                        if (cursorPosition === currLine.length) {
                            currLine += ' ';
                            cursorPosition++;
                        }
                    }
                    if (item.type === 'option' && firstWord === 'set') {
                        if (cursorPosition === currLine.length) {
                            currLine += ' ';
                            cursorPosition++;
                        }
                    }

                    renderCurrentInput(true);
                    hideSuggestBox();
                };

                const performAutocomplete = (direction = 1) => {
                    // direction: 1 (forward) or -1 (backward) for selection movement
                    const { ctx, items } = getAutocompleteSuggestions();
                    autocompleteContext = ctx;
                    autocompleteSuggestions = items;

                    if (!items || items.length === 0) {
                        termInstance.write('\x07'); // Bell character
                        hideSuggestBox();
                        return;
                    }

                    // If only 1 match, apply immediately (fast path)
                    if (items.length === 1) {
                        applySuggestion(items[0]);
                        return;
                    }

                    // Open overlay and move selection
                    if (autocompleteIndex < 0) autocompleteIndex = 0;
                    else autocompleteIndex = (autocompleteIndex + direction + items.length) % items.length;
                    renderSuggestBox();
                };

                const sendCommandToBackend = (commandText) => {
                    const trimmed = (commandText || '').trim();
                    if (!trimmed) return;

                    currLine = trimmed;
                    cursorPosition = currLine.length;
                    renderCurrentInput();
                    termInstance.write('\r\n');
                    hideSuggestBox();

                    if (this.socket) {
                        this.socket.emit('terminal_input', {
                            command: trimmed,
                            session_id: terminalId
                        });
                    }

                    commandHistory.push(trimmed);
                    historyIndex = commandHistory.length;
                    resetCurrentInput();
                    hideSuggestBox();
                    
                    // Note: Prompt will be written by backend after command execution
                };

                // Listen for output from backend - ONLY for this terminal's session
                if (this.socket) {
                    const outputHandler = (data) => {
                        // STRICT FILTER: Only process if session_id matches this terminal
                        // If no session_id in data, skip it (shouldn't happen with proper backend)
                        if (data.session_id !== terminalId) {
                            return; // This output is for a different terminal
                        }

                        let text = data.text || data.output || '';
                        if (typeof text === 'string') {
                            // Replace default prompt with current prompt if module is loaded
                            const defaultPrompt = 'kitty> ';
                            if (text.includes(defaultPrompt)) {
                                text = text.replace(new RegExp(defaultPrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), getPrompt());
                            }
                            
                            // Fix newlines for xterm
                            text = text.replace(/\n/g, '\r\n');
                            termInstance.write(text);
                            // Output means we should not keep UI overlays open
                            hideSuggestBox();
                        }
                    };

                    // Register listener for this specific terminal
                    this.socket.on('terminal_output', outputHandler);
                    
                    // Store the handler reference for cleanup
                    termInstance._outputHandler = outputHandler;
                }

                // Handle input
                termInstance.onData(e => {
                    // Keep suggestions fresh while typing (debounced)
                    const isTypingChar = (e >= ' ' && e <= '~');
                    if (isTypingChar || e === '\u007F') {
                        updateSuggestions(false);
                    }

                    switch (e) {
                        case '\r': {
                            // If suggestions are open, Enter should select instead of executing the command
                            if (suggestBox.style.display === 'block' && autocompleteSuggestions.length > 0 && autocompleteIndex >= 0) {
                                applySuggestion(autocompleteSuggestions[autocompleteIndex]);
                                break;
                            }

                            renderCurrentInput();
                            termInstance.write('\r\n');
                            const originalCommand = currLine;
                            const trimmedCommand = currLine.trim();

                            if (!trimmedCommand) {
                                showPrompt();
                                resetCurrentInput();
                                break;
                            }

                            const commandLower = trimmedCommand.toLowerCase();
                            commandHistory.push(trimmedCommand);
                            historyIndex = commandHistory.length;

                            if (commandLower === 'exit') {
                                this.wm.closeWindow(winId);
                                return;
                            }

                            let handled = false;

                            // Simple UX: open dedicated apps for interactive tools
                            if (!handled && (commandLower === 'irc' || commandLower.startsWith('irc '))) {
                                const m = trimmedCommand.match(/^irc\s+(?:-u|--username)\s+([^\s]+)\s*$/i);
                                try {
                                    if (m && m[1]) this.openIRCChat(m[1].trim());
                                    else this.openApp('irc');
                                } catch (_) { /* ignore */ }
                                os.showNotification('Opened KittyChat IRC', 'info');
                                showPrompt();
                                handled = true;
                            }

                            if (!handled && (commandLower === 'interpreter' || commandLower.startsWith('interpreter '))) {
                                try {
                                    this.openApp('interpreter');
                                } catch (_) { /* ignore */ }
                                os.showNotification('Opened KittyPy Interpreter', 'info');
                                showPrompt();
                                handled = true;
                            }

                            if (commandLower.startsWith('use ')) {
                                const modulePath = trimmedCommand.substring(4).trim();
                                if (modulePath) {
                                    handleUseCommand(modulePath);
                                } else {
                                    termInstance.write('\x1b[91m[!] Usage: use <module_path>\x1b[0m\r\n');
                                    showPrompt();
                                }
                                handled = true;
                            } else if (commandLower === 'back') {
                                currentModule = null;
                                moduleOptions = {};
                                termInstance.write('\x1b[92m[+] Module context cleared\x1b[0m\r\n');
                                showPrompt();
                                handled = true;
                            } else if (commandLower === 'show options' || commandLower === 'options') {
                                if (currentModule) {
                                    displayModuleOptions();
                                    termInstance.write('\r\n');
                                    showPrompt();
                                } else {
                                    termInstance.write('\x1b[91m[!] No module loaded. Use "use <module>" to load a module.\x1b[0m\r\n');
                                    showPrompt();
                                }
                                handled = true;
                            } else if (commandLower.startsWith('set ')) {
                                const setParts = trimmedCommand.substring(4).trim().split(/\s+/);
                                if (setParts.length >= 2 && currentModule) {
                                    const optName = setParts[0];
                                    const optValue = setParts.slice(1).join(' ');
                                    moduleOptions[optName] = optValue;
                                    termInstance.write(`\x1b[92m[+] ${optName} => ${optValue}\x1b[0m\r\n`);
                                    showPrompt();
                                    this.socket.emit('terminal_input', {
                                        command: originalCommand,
                                        session_id: terminalId
                                    });
                                } else if (!currentModule) {
                                    termInstance.write('\x1b[91m[!] No module loaded. Use "use <module>" to load a module.\x1b[0m\r\n');
                                    showPrompt();
                                } else {
                                    termInstance.write('\x1b[91m[!] Usage: set <option> <value>\x1b[0m\r\n');
                                    showPrompt();
                                }
                                handled = true;
                            }

                            if (!handled) {
                                this.socket.emit('terminal_input', {
                                    command: originalCommand,
                                    session_id: terminalId
                                });
                            }

                            resetCurrentInput();
                            hideSuggestBox();
                            break;
                        }
                        case '\t':
                            // Tab: if overlay open, apply selected; else open/cycle
                            if (suggestBox.style.display === 'block' && autocompleteSuggestions.length > 0 && autocompleteIndex >= 0) {
                                applySuggestion(autocompleteSuggestions[autocompleteIndex]);
                            } else {
                                performAutocomplete(1);
                            }
                            break;
                        case '\x1b[Z': // Shift+Tab (common xterm sequence)
                            if (suggestBox.style.display === 'block' && autocompleteSuggestions.length > 0) {
                                autocompleteIndex = (autocompleteIndex - 1 + autocompleteSuggestions.length) % autocompleteSuggestions.length;
                                renderSuggestBox();
                            } else {
                                performAutocomplete(-1);
                            }
                            break;
                        case '\x00': // Ctrl+Space (NUL) - open suggestions
                            updateSuggestions(true);
                            break;
                        case '\u007F': // Backspace
                            if (cursorPosition > 0) {
                                if (cursorPosition === currLine.length) {
                                    // Cursor at end - simple backspace
                                    currLine = currLine.slice(0, -1);
                                    cursorPosition--;
                                    termInstance.write('\b \b');
                                } else {
                                    // Cursor in middle - need to re-render
                                    currLine = currLine.slice(0, cursorPosition - 1) + currLine.slice(cursorPosition);
                                    cursorPosition--;
                                    renderCurrentInput(true);
                                }
                            }
                            break;
                        case '\u0003': // Ctrl+C
                            termInstance.write('^C\r\n');
                            showPrompt();
                            resetCurrentInput();
                            hideSuggestBox();
                            break;
                        case '\x1b[A': // Up Arrow
                            if (suggestBox.style.display === 'block' && autocompleteSuggestions.length > 0) {
                                autocompleteIndex = (autocompleteIndex - 1 + autocompleteSuggestions.length) % autocompleteSuggestions.length;
                                renderSuggestBox();
                            } else if (commandHistory.length > 0 && historyIndex > 0) {
                                historyIndex--;
                                currLine = commandHistory[historyIndex] || '';
                                cursorPosition = currLine.length;
                                renderCurrentInput(true);
                            }
                            break;
                        case '\x1b[B': // Down Arrow
                            if (suggestBox.style.display === 'block' && autocompleteSuggestions.length > 0) {
                                autocompleteIndex = (autocompleteIndex + 1) % autocompleteSuggestions.length;
                                renderSuggestBox();
                            } else if (historyIndex < commandHistory.length) {
                                historyIndex++;
                                if (historyIndex < commandHistory.length) {
                                    currLine = commandHistory[historyIndex] || '';
                                } else {
                                    currLine = '';
                                }
                                cursorPosition = currLine.length;
                                renderCurrentInput(true);
                            }
                            break;
                        case '\x1b[D': // Left Arrow
                            if (cursorPosition > 0) {
                                cursorPosition--;
                                termInstance.write('\x1b[D');
                            }
                            break;
                        case '\x1b[C': // Right Arrow
                            if (cursorPosition < currLine.length) {
                                cursorPosition++;
                                termInstance.write('\x1b[C');
                            }
                            break;
                        case '\x1b': // Escape (best effort close overlay)
                            hideSuggestBox();
                            break;
                        default:
                            if (e >= ' ' && e <= '~') {
                                if (cursorPosition === currLine.length) {
                                    // Cursor at end - simple append
                                    currLine += e;
                                    cursorPosition++;
                                    termInstance.write(e);
                                } else {
                                    // Cursor in middle - need to re-render
                                    currLine = currLine.slice(0, cursorPosition) + e + currLine.slice(cursorPosition);
                                    cursorPosition++;
                                    renderCurrentInput(true);
                                }
                            }
                    }
                });

                if (initialCommand) {
                    setTimeout(() => {
                        sendCommandToBackend(initialCommand);
                    }, 100);
                }

                new ResizeObserver(() => fitAddon.fit()).observe(container);
            }
        });
    }


    spawnIRC() {
        // Create nickname input window first
        this.wm.createWindow({
            title: 'KittyChat - Join',
            icon: 'chatbubbles-outline',
            width: '400px',
            height: '250px',
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #0d1117; color: #c9d1d9; padding: 30px; gap: 20px;">
                    <h3 style="margin: 0; color: #58a6ff; font-size: 18px;">Join IRC Chat</h3>
                    
                    <div style="flex: 1; display: flex; flex-direction: column; gap: 15px; justify-content: center;">
                        <div>
                            <label style="display: block; margin-bottom: 8px; font-size: 13px; color: #8b949e;">Nickname</label>
                            <input 
                                type="text" 
                                id="irc-nickname-input" 
                                placeholder="Enter your nickname"
                                style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px; outline: none;"
                                value="Guest${Math.floor(Math.random() * 1000)}"
                            />
                        </div>
                        
                        <div style="display: flex; gap: 10px;">
                            <button id="irc-join-btn" style="flex: 1; background: #238636; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px;">
                                Join Chat
                            </button>
                            <button id="irc-cancel-btn" style="background: #30363d; color: #c9d1d9; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer; font-size: 14px;">
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const input = document.querySelector(`#${wId} #irc-nickname-input`);
                const joinBtn = document.querySelector(`#${wId} #irc-join-btn`);
                const cancelBtn = document.querySelector(`#${wId} #irc-cancel-btn`);

                // Focus input
                input.focus();
                input.select();

                // Handle join
                const handleJoin = () => {
                    const username = input.value.trim();
                    if (!username) return;

                    // Close this window
                    this.wm.closeWindow(wId);

                    // Open IRC chat with username
                    this.openIRCChat(username);
                };

                joinBtn.addEventListener('click', handleJoin);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') handleJoin();
                });

                cancelBtn.addEventListener('click', () => {
                    this.wm.closeWindow(wId);
                });
            }
        });
    }

    openIRCChat(username) {
        const winId = this.wm.createWindow({
            title: `KittyChat IRC - Connecting...`,
            icon: 'chatbubbles-outline',
            width: '800px',
            height: '700px',
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #1a1a1a; font-family: monospace;">
                    <div id="irc-status" style="padding: 8px 12px; background: #2a2a2a; border-bottom: 1px solid #444; color: #ffbd2e; font-size: 12px; display: flex; justify-content: space-between; align-items: center;">
                        <span>Connecting to irc.libera.chat...</span>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div id="irc-users-count" style="color: #8b949e;">0 users</div>
                            <button id="irc-disconnect-btn" style="background: #da3633; border: none; color: white; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 500; display: flex; align-items: center; gap: 4px;">
                                <ion-icon name="log-out-outline" style="font-size: 14px;"></ion-icon>
                                Disconnect
                            </button>
                        </div>
                    </div>
                    <div style="display: flex; flex: 1; overflow: hidden;">
                        <div id="chat-messages" style="flex: 1; padding: 10px; overflow-y: auto; color: #ddd; font-size: 13px; border-right: 1px solid #444;">
                            <div style="color: #4cd137;">[System] Connecting to IRC server...</div>
                        </div>
                        <div id="irc-users-panel" style="width: 200px; background: #222; border-left: 1px solid #444; display: flex; flex-direction: column;">
                            <div style="padding: 10px; border-bottom: 1px solid #444; background: #2a2a2a;">
                                <div style="color: #c9d1d9; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Users (0)</div>
                            </div>
                            <div id="irc-users-list" style="flex: 1; overflow-y: auto; padding: 8px;">
                                <div style="color: #8b949e; font-size: 11px; text-align: center; padding: 10px;">Connecting...</div>
                            </div>
                        </div>
                    </div>
                    <div style="padding: 10px; border-top: 1px solid #444; display: flex; gap: 8px;">
                        <input type="text" id="chat-input" placeholder="Connecting..." disabled style="flex: 1; background: #2a2a2a; border: 1px solid #444; color: white; padding: 8px; border-radius: 4px; font-size: 13px;">
                        <button id="send-btn" disabled style="background: #666; border: none; color: #000; padding: 8px 16px; border-radius: 4px; cursor: not-allowed; font-weight: bold; font-size: 13px;">Send</button>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const self = this;
                const input = document.querySelector(`#${wId} #chat-input`);
                const sendBtn = document.querySelector(`#${wId} #send-btn`);
                const disconnectBtn = document.querySelector(`#${wId} #irc-disconnect-btn`);
                const messages = document.querySelector(`#${wId} #chat-messages`);
                const statusBar = document.querySelector(`#${wId} #irc-status`);
                const winTitle = document.querySelector(`#${wId} .window-title`);
                const usersCount = document.querySelector(`#${wId} #irc-users-count`);
                const usersList = document.querySelector(`#${wId} #irc-users-list`);
                const usersPanel = document.querySelector(`#${wId} #irc-users-panel`);

                let connected = false;
                let currentNick = username;
                let currentUsers = []; // Track IRC users

                function updateUsersList(usersArray) {
                    currentUsers = usersArray;
                    if (usersList) {
                        if (usersArray.length === 0) {
                            usersList.innerHTML = '<div style="color: #8b949e; font-size: 11px; text-align: center; padding: 10px;">No users detected yet</div>';
                        } else {
                            usersList.innerHTML = usersArray.map(user => `
                                <div class="irc-user-item" style="padding: 6px 8px; margin-bottom: 4px; border-radius: 4px; background: ${user === currentNick ? 'rgba(76, 209, 55, 0.1)' : 'transparent'}; color: ${user === currentNick ? '#4cd137' : '#c9d1d9'}; font-size: 12px; display: flex; align-items: center; gap: 6px;">
                                    <ion-icon name="person-circle-outline" style="font-size: 16px;"></ion-icon>
                                    <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${user}</span>
                                    ${user === currentNick ? '<span style="color: #4cd137; font-size: 10px;">(You)</span>' : ''}
                                </div>
                            `).join('');
                        }
                    }
                    if (usersCount) {
                        usersCount.textContent = `${usersArray.length} user${usersArray.length !== 1 ? 's' : ''}`;
                    }
                    // Update header in users panel
                    const header = usersPanel?.querySelector('div:first-child');
                    if (header) {
                        header.innerHTML = `<div style="color: #c9d1d9; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Users (${usersArray.length})</div>`;
                    }
                }

                // Initialize empty users list
                updateUsersList([]);

                // Disconnect button handler
                if (disconnectBtn) {
                    disconnectBtn.addEventListener('click', () => {
                        if (self.socket && connected) {
                            self.socket.emit('irc_disconnect', { nickname: currentNick });
                        }
                        // Close the window
                        self.wm.closeWindow(wId);
                    });
                }

                // Connect to IRC
                if (this.socket) {
                    this.socket.emit('irc_connect', { nickname: username });

                    // Handle connection success
                    this.socket.on('irc_connected', (data) => {
                        connected = true;
                        currentNick = data.nickname;

                        statusBar.style.color = '#4cd137';
                        statusBar.innerHTML = `<span>Connected to <strong>${data.server}</strong> | Channel: <strong>${data.channel}</strong> | You are: <strong>${currentNick}</strong></span>`;

                        if (winTitle) {
                            winTitle.innerHTML = `<ion-icon name="chatbubbles-outline"></ion-icon> KittyChat IRC - ${currentNick}`;
                        }

                        input.disabled = false;
                        input.placeholder = 'Type your message...';
                        sendBtn.disabled = false;
                        sendBtn.style.background = '#4cd137';
                        sendBtn.style.cursor = 'pointer';

                        appendMessage('[System]', 'Connected to #KittySploit on irc.libera.chat', '#4cd137');
                        appendMessage('[System]', 'You are now chatting with real IRC users!', '#4cd137');
                        
                        // Add current user to list
                        if (!currentUsers.includes(currentNick)) {
                            currentUsers.push(currentNick);
                            updateUsersList(currentUsers);
                        }

                        input.focus();
                    });

                    // Handle IRC messages from server
                    this.socket.on('irc_message', (data) => {
                        if (data.source === 'irc') {
                            const color = data.sender === '[System]' ? '#888' : '#bd93f9';
                            appendMessage(data.sender, data.message, color, data.timestamp);
                            
                            // Parse system messages to track users
                            if (data.sender === '[System]') {
                                const message = data.message || '';
                                // Handle JOIN messages: "*** nickname joined"
                                const joinMatch = message.match(/\*\*\* (.+?) joined/);
                                if (joinMatch) {
                                    const joinedUser = joinMatch[1];
                                    if (!currentUsers.includes(joinedUser)) {
                                        currentUsers.push(joinedUser);
                                        updateUsersList(currentUsers);
                                    }
                                }
                                // Handle PART/QUIT messages: "*** nickname left" or "*** nickname quit"
                                const partMatch = message.match(/\*\*\* (.+?) (left|quit)/);
                                if (partMatch) {
                                    const leftUser = partMatch[1];
                                    const index = currentUsers.indexOf(leftUser);
                                    if (index > -1) {
                                        currentUsers.splice(index, 1);
                                        updateUsersList(currentUsers);
                                    }
                                }
                            } else {
                                // Add message sender to users list if not already present
                                if (data.sender && data.sender !== '[System]' && !currentUsers.includes(data.sender)) {
                                    currentUsers.push(data.sender);
                                    updateUsersList(currentUsers);
                                }
                            }
                        }
                    });

                    // Handle errors
                    this.socket.on('irc_error', (data) => {
                        const statusContent = statusBar.querySelector('span:first-child');
                        if (statusContent) {
                            statusContent.textContent = `Error: ${data.error}`;
                        } else {
                            statusBar.innerHTML = `<span>Error: ${data.error}</span>`;
                        }
                        statusBar.style.color = '#ff5f56';
                        appendMessage('[Error]', data.error, '#ff5f56');
                    });
                }

                const sendMessage = () => {
                    if (!connected || !input.value.trim()) return;

                    const message = input.value.trim();

                    if (this.socket) {
                        this.socket.emit('irc_send_message', {
                            nickname: currentNick,
                            message: message
                        });

                        // Display own message
                        appendMessage(currentNick, message, '#4ecdc4');
                    }

                    input.value = '';
                };

                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        sendMessage();
                    }
                });

                sendBtn.addEventListener('click', sendMessage);

                function appendMessage(sender, message, color = '#ddd', timestamp = null) {
                    const msg = document.createElement('div');
                    msg.style.marginBottom = '4px';

                    // Format timestamp
                    let timeStr = '';
                    if (timestamp) {
                        const date = new Date(timestamp);
                        timeStr = `[${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}] `;
                    } else {
                        const now = new Date();
                        timeStr = `[${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}] `;
                    }

                    msg.innerHTML = `<span style="color: #888;">${timeStr}</span><span style="color: ${color}; font-weight: bold;">[${sender}]</span> <span style="color: #ddd;">${message}</span>`;
                    messages.appendChild(msg);
                    messages.scrollTop = messages.scrollHeight;
                }

                // Cleanup on window close
                const cleanupHandler = () => {
                    if (this.socket && connected) {
                        this.socket.emit('irc_disconnect', { nickname: currentNick });
                    }
                };

                // Store cleanup in window object
                const winElement = document.getElementById(wId);
                if (winElement) {
                    winElement._ircCleanup = cleanupHandler;
                }
            },
            onClose: function () {
                // Call cleanup if it exists
                const winElement = document.getElementById(winId);
                if (winElement && winElement._ircCleanup) {
                    winElement._ircCleanup();
                }
            }
        });
    }

    spawnChatServer() {
        // Main window with tabs: Create Server / Join Server
        const winId = this.wm.createWindow({
            title: 'Chat Server',
            icon: 'chatbox-ellipses-outline',
            width: '700px',
            height: '650px',
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
                    <!-- Tabs -->
                    <div style="display: flex; border-bottom: 1px solid #30363d; background: #161b22;">
                        <button id="chat-tab-create" class="chat-tab active" style="flex: 1; padding: 12px; background: transparent; border: none; color: #c9d1d9; cursor: pointer; border-bottom: 2px solid #58a6ff; font-weight: 500;">
                            Create Server
                        </button>
                        <button id="chat-tab-join" class="chat-tab" style="flex: 1; padding: 12px; background: transparent; border: none; color: #8b949e; cursor: pointer; border-bottom: 2px solid transparent; font-weight: 500;">
                            Join Server
                        </button>
                    </div>
                    
                    <!-- Create Server Panel -->
                    <div id="chat-panel-create" style="flex: 1; padding: 30px; overflow-y: auto; display: block;">
                        <h3 style="margin: 0 0 20px 0; color: #58a6ff; font-size: 18px;">Create a New Chat Server</h3>
                        
                        <div style="display: flex; flex-direction: column; gap: 15px;">
                            <div>
                                <label style="display: block; margin-bottom: 8px; font-size: 13px; color: #8b949e;">Server ID</label>
                                <input type="text" id="chat-create-server-id" placeholder="my-server" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px; outline: none; box-sizing: border-box;">
                                <div style="font-size: 11px; color: #8b949e; margin-top: 4px;">Unique identifier for your server</div>
                            </div>
                            
                            <div>
                                <label style="display: block; margin-bottom: 8px; font-size: 13px; color: #8b949e;">Server Name</label>
                                <input type="text" id="chat-create-server-name" placeholder="My Awesome Chat Server" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px; outline: none; box-sizing: border-box;">
                            </div>
                            
                            <div>
                                <label style="display: block; margin-bottom: 8px; font-size: 13px; color: #8b949e;">Password (Optional)</label>
                                <input type="password" id="chat-create-password" placeholder="Leave empty for public server" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px; outline: none; box-sizing: border-box;">
                            </div>
                            
                            <div>
                                <label style="display: block; margin-bottom: 8px; font-size: 13px; color: #8b949e;">Max Users</label>
                                <input type="number" id="chat-create-max-users" value="100" min="2" max="1000" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px; outline: none; box-sizing: border-box;">
                            </div>
                            
                            <button id="chat-create-btn" style="background: #238636; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px; margin-top: 10px;">
                                Create Server
                            </button>
                            
                            <div id="chat-create-status" style="font-size: 12px; margin-top: 10px; min-height: 20px;"></div>
                        </div>
                    </div>
                    
                    <!-- Join Server Panel -->
                    <div id="chat-panel-join" style="flex: 1; padding: 30px; overflow-y: auto; display: none;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                            <h3 style="margin: 0; color: #58a6ff; font-size: 18px;">Join a Chat Server</h3>
                            <button id="chat-refresh-servers" style="background: #30363d; color: #c9d1d9; border: 1px solid #30363d; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 12px;">
                                <ion-icon name="refresh-outline" style="font-size: 14px; vertical-align: middle;"></ion-icon> Refresh
                            </button>
                        </div>
                        
                        <!-- Server List -->
                        <div id="chat-servers-list" style="margin-bottom: 20px; max-height: 300px; overflow-y: auto; border: 1px solid #30363d; border-radius: 6px; background: #161b22;">
                            <div style="padding: 20px; text-align: center; color: #8b949e;">Loading servers...</div>
                        </div>
                        
                        <!-- Join Form -->
                        <div style="border-top: 1px solid #30363d; padding-top: 20px;">
                            <h4 style="margin: 0 0 15px 0; color: #c9d1d9; font-size: 14px;">Or join by Server ID:</h4>
                            <div style="display: flex; flex-direction: column; gap: 15px;">
                                <div>
                                    <label style="display: block; margin-bottom: 8px; font-size: 13px; color: #8b949e;">Server ID</label>
                                    <input type="text" id="chat-join-server-id" placeholder="my-server" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px; outline: none; box-sizing: border-box;">
                                </div>
                                
                                <div>
                                    <label style="display: block; margin-bottom: 8px; font-size: 13px; color: #8b949e;">Username</label>
                                    <input type="text" id="chat-join-username" placeholder="Your username" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px; outline: none; box-sizing: border-box;" value="User${Math.floor(Math.random() * 1000)}">
                                </div>
                                
                                <div>
                                    <label style="display: block; margin-bottom: 8px; font-size: 13px; color: #8b949e;">Password (if required)</label>
                                    <input type="password" id="chat-join-password" placeholder="Server password" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px; outline: none; box-sizing: border-box;">
                                </div>
                                
                                <button id="chat-join-btn" style="background: #238636; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px;">
                                    Join Server
                                </button>
                                
                                <div id="chat-join-status" style="font-size: 12px; margin-top: 10px; min-height: 20px;"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Kill Session Modal (in-app, no browser confirm) -->
                <div id="kill-session-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 10050; align-items: center; justify-content: center;">
                    <div style="background: #161b22; border: 1px solid #30363d; border-radius: 10px; width: 520px; max-width: 92vw; box-shadow: 0 18px 50px rgba(0,0,0,0.55); overflow: hidden;">
                        <div style="padding: 16px 18px; border-bottom: 1px solid #30363d; display: flex; align-items: center; justify-content: space-between;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <div style="width: 34px; height: 34px; border-radius: 8px; background: rgba(248, 81, 73, 0.12); border: 1px solid rgba(248, 81, 73, 0.45); display: flex; align-items: center; justify-content: center;">
                                    <ion-icon name="warning-outline" style="color: #f85149; font-size: 18px;"></ion-icon>
                                </div>
                                <div style="font-size: 14px; font-weight: 700; color: #c9d1d9;">Kill session</div>
                            </div>
                            <button id="kill-session-close-btn" style="background: none; border: none; color: #8b949e; cursor: pointer; font-size: 22px; padding: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;">&times;</button>
                        </div>
                        <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 10px;">
                            <div style="color: #8b949e; font-size: 13px; line-height: 1.35;">
                                This will terminate the session. Any active interaction may be lost.
                            </div>
                            <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 8px; padding: 10px 12px; font-family: 'Fira Code', monospace; font-size: 12px; color: #c9d1d9;">
                                Session: <span id="kill-session-id-text"></span>
                            </div>
                            <div id="kill-session-error" style="display: none; color: #f85149; font-size: 12px;"></div>
                        </div>
                        <div style="padding: 14px 18px; border-top: 1px solid #30363d; display: flex; justify-content: flex-end; gap: 10px; background: rgba(255,255,255,0.02);">
                            <button id="kill-session-cancel-btn" style="padding: 10px 14px; background: transparent; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; cursor: pointer; font-size: 13px; font-weight: 600;">Cancel</button>
                            <button id="kill-session-confirm-btn" style="padding: 10px 14px; background: #f85149; border: 1px solid #f85149; border-radius: 6px; color: white; cursor: pointer; font-size: 13px; font-weight: 700;">Kill</button>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const self = this;
                const createTab = document.querySelector(`#${wId} #chat-tab-create`);
                const joinTab = document.querySelector(`#${wId} #chat-tab-join`);
                const createPanel = document.querySelector(`#${wId} #chat-panel-create`);
                const joinPanel = document.querySelector(`#${wId} #chat-panel-join`);
                const createBtn = document.querySelector(`#${wId} #chat-create-btn`);
                const joinBtn = document.querySelector(`#${wId} #chat-join-btn`);
                const refreshBtn = document.querySelector(`#${wId} #chat-refresh-servers`);
                const serversList = document.querySelector(`#${wId} #chat-servers-list`);
                
                // Tab switching
                createTab.addEventListener('click', () => {
                    createTab.classList.add('active');
                    createTab.style.color = '#c9d1d9';
                    createTab.style.borderBottomColor = '#58a6ff';
                    joinTab.classList.remove('active');
                    joinTab.style.color = '#8b949e';
                    joinTab.style.borderBottomColor = 'transparent';
                    createPanel.style.display = 'block';
                    joinPanel.style.display = 'none';
                });
                
                joinTab.addEventListener('click', () => {
                    joinTab.classList.add('active');
                    joinTab.style.color = '#c9d1d9';
                    joinTab.style.borderBottomColor = '#58a6ff';
                    createTab.classList.remove('active');
                    createTab.style.color = '#8b949e';
                    createTab.style.borderBottomColor = 'transparent';
                    createPanel.style.display = 'none';
                    joinPanel.style.display = 'block';
                    loadServersList();
                });
                
                // Load servers list
                function loadServersList() {
                    if (self.socket) {
                        self.socket.emit('chat_list_servers');
                    }
                }
                
                // Render servers list
                function renderServersList(servers) {
                    if (servers.length === 0) {
                        serversList.innerHTML = '<div style="padding: 20px; text-align: center; color: #8b949e;">No servers available. Create one!</div>';
                        return;
                    }
                    
                    serversList.innerHTML = servers.map(server => `
                        <div class="chat-server-item" style="padding: 15px; border-bottom: 1px solid #30363d; cursor: pointer; transition: background 0.2s;" 
                             onclick="document.getElementById('chat-join-server-id').value='${server.id}';">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <div style="font-weight: 600; color: #c9d1d9; margin-bottom: 4px;">${server.name}</div>
                                    <div style="font-size: 11px; color: #8b949e;">ID: ${server.id} • ${server.users_count}/${server.max_users} users ${server.has_password ? '🔒' : ''}</div>
                                </div>
                                <ion-icon name="chevron-forward-outline" style="color: #8b949e;"></ion-icon>
                            </div>
                        </div>
                    `).join('');
                    
                    // Add hover effect
                    serversList.querySelectorAll('.chat-server-item').forEach(item => {
                        item.addEventListener('mouseenter', () => {
                            item.style.background = 'rgba(88, 166, 255, 0.1)';
                        });
                        item.addEventListener('mouseleave', () => {
                            item.style.background = 'transparent';
                        });
                    });
                }
                
                // Socket handlers
                if (self.socket) {
                    self.socket.on('chat_servers_list', (data) => {
                        renderServersList(data.servers || []);
                    });
                    
                    self.socket.on('chat_server_created', (data) => {
                        const statusEl = document.querySelector(`#${wId} #chat-create-status`);
                        const createBtn = document.querySelector(`#${wId} #chat-create-btn`);
                        
                        // Restore button
                        if (createBtn) {
                            createBtn.disabled = false;
                            createBtn.style.opacity = '1';
                            createBtn.style.cursor = 'pointer';
                            createBtn.textContent = 'Create Server';
                        }
                        
                        statusEl.style.color = '#4cd137';
                        statusEl.textContent = `Server "${data.server_name}" created successfully! Server ID: ${data.server_id}`;
                        loadServersList();
                    });
                    
                    self.socket.on('chat_error', (data) => {
                        const statusEl = document.querySelector(`#${wId} #chat-create-status, #${wId} #chat-join-status`);
                        const createBtn = document.querySelector(`#${wId} #chat-create-btn`);
                        const joinBtn = document.querySelector(`#${wId} #chat-join-btn`);
                        
                        // Restore buttons
                        if (createBtn && createBtn.disabled) {
                            createBtn.disabled = false;
                            createBtn.style.opacity = '1';
                            createBtn.style.cursor = 'pointer';
                            createBtn.textContent = 'Create Server';
                        }
                        if (joinBtn && joinBtn.disabled) {
                            joinBtn.disabled = false;
                            joinBtn.style.opacity = '1';
                            joinBtn.style.cursor = 'pointer';
                            joinBtn.textContent = 'Join Server';
                        }
                        
                        if (statusEl) {
                            statusEl.style.color = '#f85149';
                            statusEl.textContent = `Error: ${data.error}`;
                        }
                    });
                    
                    self.socket.on('chat_connected', (data) => {
                        // Close this window and open chat window
                        self.wm.closeWindow(wId);
                        self.openChatWindow(data.server_id, data.server_name, data.username, data.users, data.message_history);
                    });
                    
                    self.socket.on('chat_server_list_updated', () => {
                        if (joinPanel.style.display !== 'none') {
                            loadServersList();
                        }
                    });
                }
                
                // Create server
                createBtn.addEventListener('click', () => {
                    const serverId = document.querySelector(`#${wId} #chat-create-server-id`).value.trim();
                    const serverName = document.querySelector(`#${wId} #chat-create-server-name`).value.trim();
                    const password = document.querySelector(`#${wId} #chat-create-password`).value.trim();
                    const maxUsers = parseInt(document.querySelector(`#${wId} #chat-create-max-users`).value) || 100;
                    const statusEl = document.querySelector(`#${wId} #chat-create-status`);
                    
                    if (!serverId || !serverName) {
                        statusEl.style.color = '#f85149';
                        statusEl.textContent = 'Please fill in Server ID and Server Name';
                        return;
                    }
                    
                    // Check if socket is available
                    if (!self.socket) {
                        statusEl.style.color = '#f85149';
                        statusEl.textContent = 'Error: Socket connection not available. Please refresh the page.';
                        console.error('Socket not available for chat server creation');
                        return;
                    }
                    
                    // Check if socket is connected
                    if (!self.socket.connected) {
                        statusEl.style.color = '#f85149';
                        statusEl.textContent = 'Error: Socket not connected. Please wait and try again.';
                        console.error('Socket not connected for chat server creation');
                        return;
                    }
                    
                    // Show loading state
                    createBtn.disabled = true;
                    createBtn.style.opacity = '0.7';
                    createBtn.style.cursor = 'wait';
                    const originalBtnText = createBtn.textContent;
                    createBtn.textContent = 'Creating...';
                    statusEl.style.color = '#ffbd2e';
                    statusEl.textContent = 'Creating server...';
                    
                    console.log('Emitting chat_create_server:', { server_id: serverId, server_name: serverName, max_users: maxUsers });
                    
                    try {
                        self.socket.emit('chat_create_server', {
                            server_id: serverId,
                            server_name: serverName,
                            password: password || null,
                            max_users: maxUsers
                        });
                        
                        // Set a timeout to restore button if no response
                        setTimeout(() => {
                            if (createBtn.disabled) {
                                createBtn.disabled = false;
                                createBtn.style.opacity = '1';
                                createBtn.style.cursor = 'pointer';
                                createBtn.textContent = originalBtnText;
                                if (statusEl.textContent === 'Creating server...') {
                                    statusEl.style.color = '#f85149';
                                    statusEl.textContent = 'Timeout: No response from server. Please try again.';
                                }
                            }
                        }, 10000); // 10 second timeout
                    } catch (error) {
                        console.error('Error creating chat server:', error);
                        statusEl.style.color = '#f85149';
                        statusEl.textContent = `Error: ${error.message || 'Failed to create server'}`;
                        createBtn.disabled = false;
                        createBtn.style.opacity = '1';
                        createBtn.style.cursor = 'pointer';
                        createBtn.textContent = originalBtnText;
                    }
                });
                
                // Join server
                joinBtn.addEventListener('click', () => {
                    const serverId = document.querySelector(`#${wId} #chat-join-server-id`).value.trim();
                    const username = document.querySelector(`#${wId} #chat-join-username`).value.trim();
                    const password = document.querySelector(`#${wId} #chat-join-password`).value.trim();
                    
                    if (!serverId || !username) {
                        const statusEl = document.querySelector(`#${wId} #chat-join-status`);
                        statusEl.style.color = '#f85149';
                        statusEl.textContent = 'Please fill in Server ID and Username';
                        return;
                    }
                    
                    if (self.socket) {
                        self.socket.emit('chat_connect', {
                            server_id: serverId,
                            username: username,
                            password: password || null
                        });
                    }
                });
                
                // Refresh servers
                refreshBtn.addEventListener('click', () => {
                    loadServersList();
                });
                
                // Load servers on join tab
                loadServersList();
            }
        });
    }
    
    openChatWindow(serverId, serverName, username, users, messageHistory) {
        const winId = this.wm.createWindow({
            title: `Chat - ${serverName}`,
            icon: 'chatbox-ellipses-outline',
            width: '800px',
            height: '700px',
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #1a1a1a; font-family: monospace;">
                    <div id="chat-status" style="padding: 8px 12px; background: #2a2a2a; border-bottom: 1px solid #444; color: #4cd137; font-size: 12px; display: flex; justify-content: space-between; align-items: center;">
                        <span>Connected to <strong>${serverName}</strong> as <strong>${username}</strong></span>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div id="chat-users-count" style="color: #8b949e;">${users.length} user${users.length !== 1 ? 's' : ''}</div>
                            <button id="chat-disconnect-btn" style="background: #da3633; border: none; color: white; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 500; display: flex; align-items: center; gap: 4px;">
                                <ion-icon name="log-out-outline" style="font-size: 14px;"></ion-icon>
                                Disconnect
                            </button>
                        </div>
                    </div>
                    <div style="display: flex; flex: 1; overflow: hidden;">
                        <div id="chat-messages" style="flex: 1; padding: 10px; overflow-y: auto; color: #ddd; font-size: 13px; border-right: 1px solid #444;">
                            ${messageHistory.map(msg => {
                                const time = new Date(msg.timestamp);
                                const timeStr = `[${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}]`;
                                const color = msg.type === 'system' ? '#888' : (msg.sender === username ? '#4ecdc4' : '#bd93f9');
                                return `<div style="margin-bottom: 4px;"><span style="color: #888;">${timeStr}</span> <span style="color: ${color}; font-weight: bold;">[${msg.sender}]</span> <span style="color: #ddd;">${msg.message}</span></div>`;
                            }).join('')}
                        </div>
                        <div id="chat-users-panel" style="width: 200px; background: #222; border-left: 1px solid #444; display: flex; flex-direction: column;">
                            <div style="padding: 10px; border-bottom: 1px solid #444; background: #2a2a2a;">
                                <div style="color: #c9d1d9; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Users (${users.length})</div>
                            </div>
                            <div id="chat-users-list" style="flex: 1; overflow-y: auto; padding: 8px;">
                                ${users.map(user => `
                                    <div class="chat-user-item" style="padding: 6px 8px; margin-bottom: 4px; border-radius: 4px; background: ${user === username ? 'rgba(76, 209, 55, 0.1)' : 'transparent'}; color: ${user === username ? '#4cd137' : '#c9d1d9'}; font-size: 12px; display: flex; align-items: center; gap: 6px;">
                                        <ion-icon name="person-circle-outline" style="font-size: 16px;"></ion-icon>
                                        <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${user}</span>
                                        ${user === username ? '<span style="color: #4cd137; font-size: 10px;">(You)</span>' : ''}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                    <div style="padding: 10px; border-top: 1px solid #444; display: flex; gap: 8px;">
                        <input type="text" id="chat-input" placeholder="Type your message..." style="flex: 1; background: #2a2a2a; border: 1px solid #444; color: white; padding: 8px; border-radius: 4px; font-size: 13px;">
                        <button id="send-btn" style="background: #4cd137; border: none; color: #000; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 13px;">Send</button>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const self = this;
                const input = document.querySelector(`#${wId} #chat-input`);
                const sendBtn = document.querySelector(`#${wId} #send-btn`);
                const disconnectBtn = document.querySelector(`#${wId} #chat-disconnect-btn`);
                const messages = document.querySelector(`#${wId} #chat-messages`);
                const usersCount = document.querySelector(`#${wId} #chat-users-count`);
                const usersList = document.querySelector(`#${wId} #chat-users-list`);
                const usersPanel = document.querySelector(`#${wId} #chat-users-panel`);
                
                // Track current users list
                let currentUsers = [...users];
                
                // Initialize users list
                updateUsersList(currentUsers);
                
                function updateUsersList(usersArray) {
                    currentUsers = usersArray;
                    if (usersList) {
                        usersList.innerHTML = usersArray.map(user => `
                            <div class="chat-user-item" style="padding: 6px 8px; margin-bottom: 4px; border-radius: 4px; background: ${user === username ? 'rgba(76, 209, 55, 0.1)' : 'transparent'}; color: ${user === username ? '#4cd137' : '#c9d1d9'}; font-size: 12px; display: flex; align-items: center; gap: 6px;">
                                <ion-icon name="person-circle-outline" style="font-size: 16px;"></ion-icon>
                                <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${user}</span>
                                ${user === username ? '<span style="color: #4cd137; font-size: 10px;">(You)</span>' : ''}
                            </div>
                        `).join('');
                    }
                    if (usersCount) {
                        usersCount.textContent = `${usersArray.length} user${usersArray.length !== 1 ? 's' : ''}`;
                    }
                    // Update header in users panel
                    const header = usersPanel?.querySelector('div:first-child');
                    if (header) {
                        header.innerHTML = `<div style="color: #c9d1d9; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Users (${usersArray.length})</div>`;
                    }
                }
                
                function appendMessage(msg) {
                    const msgDiv = document.createElement('div');
                    msgDiv.style.marginBottom = '4px';
                    
                    const time = new Date(msg.timestamp);
                    const timeStr = `[${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}]`;
                    const color = msg.type === 'system' ? '#888' : (msg.sender === username ? '#4ecdc4' : '#bd93f9');
                    
                    msgDiv.innerHTML = `<span style="color: #888;">${timeStr}</span> <span style="color: ${color}; font-weight: bold;">[${msg.sender}]</span> <span style="color: #ddd;">${msg.message}</span>`;
                    messages.appendChild(msgDiv);
                    messages.scrollTop = messages.scrollHeight;
                }
                
                // Disconnect button handler
                if (disconnectBtn) {
                    disconnectBtn.addEventListener('click', () => {
                        if (self.socket) {
                            self.socket.emit('chat_disconnect');
                        }
                        // Close the window
                        self.wm.closeWindow(wId);
                    });
                }
                
                function sendMessage() {
                    const message = input.value.trim();
                    if (!message) return;
                    
                    if (self.socket) {
                        self.socket.emit('chat_send_message', { message: message });
                        input.value = '';
                    }
                }
                
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        sendMessage();
                    }
                });
                
                sendBtn.addEventListener('click', sendMessage);
                
                // Socket handlers
                if (self.socket) {
                    self.socket.on('chat_message', (msg) => {
                        appendMessage(msg);
                    });
                    
                    self.socket.on('chat_user_joined', (data) => {
                        if (data.server_id === serverId) {
                            appendMessage({
                                type: 'system',
                                sender: '[System]',
                                message: `${data.username} joined the chat`,
                                timestamp: new Date().toISOString()
                            });
                            // Add user to list if not already present
                            if (!currentUsers.includes(data.username)) {
                                currentUsers.push(data.username);
                                updateUsersList(currentUsers);
                            }
                        }
                    });
                    
                    self.socket.on('chat_user_left', (data) => {
                        if (data.server_id === serverId) {
                            appendMessage({
                                type: 'system',
                                sender: '[System]',
                                message: `${data.username} left the chat`,
                                timestamp: new Date().toISOString()
                            });
                            // Remove user from list
                            const index = currentUsers.indexOf(data.username);
                            if (index > -1) {
                                currentUsers.splice(index, 1);
                                updateUsersList(currentUsers);
                            }
                        }
                    });
                    
                    self.socket.on('chat_error', (data) => {
                        appendMessage({
                            type: 'system',
                            sender: '[Error]',
                            message: data.error,
                            timestamp: new Date().toISOString()
                        });
                    });
                }
                
                // Cleanup on close
                const cleanupHandler = () => {
                    if (self.socket) {
                        self.socket.emit('chat_disconnect');
                    }
                };
                
                const winElement = document.getElementById(wId);
                if (winElement) {
                    winElement._chatCleanup = cleanupHandler;
                }
                
                input.focus();
            },
            onClose: function() {
                const winElement = document.getElementById(winId);
                if (winElement && winElement._chatCleanup) {
                    winElement._chatCleanup();
                }
            }
        });
    }

    spawnBrowser() {
        this.wm.createWindow({
            title: 'Secure Web Proxy',
            icon: 'globe-outline',
            width: '800px',
            height: '600px',
            content: `
                <div style="display: flex; flex-direction: column; height: 100%;">
                    <div style="background: #333; padding: 8px; display: flex; gap: 8px; align-items: center;">
                        <button class="win-btn" style="width: 20px; height: 20px; border-radius: 4px; color: #fff; font-size: 14px;">←</button>
                        <button class="win-btn" style="width: 20px; height: 20px; border-radius: 4px; color: #fff; font-size: 14px;">↻</button>
                        <input type="text" value="https://kittysploit.local/dashboard" style="flex: 1; background: #222; border: none; color: #fff; padding: 4px 8px; border-radius: 4px;">
                    </div>
                    <iframe src="/reporting" style="flex: 1; border: none; background: #fff;"></iframe>
                </div>
            `
        });
    }

    spawnDocs() {
        console.log('spawnDocs called');
        const winId = this.wm.createWindow({
            title: 'Documentation - lib/',
            icon: 'book-outline',
            width: '1000px',
            height: '700px',
            headerButtons: `
                <button id="docs-refresh-btn" class="header-action-btn" title="Refresh">
                    <ion-icon name="refresh-outline"></ion-icon>
                </button>
            `,
            content: `
                <div style="display: flex; height: 100%; background: #0d1117; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
                    <!-- Sidebar: File Tree -->
                    <div class="docs-sidebar" style="width: 300px; border-right: 1px solid #30363d; display: flex; flex-direction: column; background: #161b22;">
                        <div style="padding: 12px; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 8px;">
                            <ion-icon name="folder-outline" style="font-size: 18px; color: #58a6ff;"></ion-icon>
                            <span style="font-weight: 500; color: #c9d1d9; font-size: 14px;">lib/</span>
                        </div>
                        <div style="flex: 1; overflow-y: auto; padding: 8px;">
                            <input class="docs-search-input" type="text" placeholder="Search..." style="width: 100%; padding: 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; margin-bottom: 8px; box-sizing: border-box;">
                            <div class="docs-file-tree" style="color: #c9d1d9; font-size: 12px;">
                                <div style="padding: 20px; text-align: center; color: #8b949e;">Loading...</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Main Content: File Viewer -->
                    <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
                        <div class="docs-file-header" style="padding: 12px; border-bottom: 1px solid #30363d; display: none;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <ion-icon name="document-text-outline" style="font-size: 18px; color: #58a6ff;"></ion-icon>
                                <span class="docs-file-name" style="font-weight: 500; color: #c9d1d9; font-size: 14px;"></span>
                                <span class="docs-file-path" style="font-size: 11px; color: #8b949e; margin-left: 8px;"></span>
                            </div>
                        </div>
                        <div class="docs-file-content" style="flex: 1; overflow: auto; padding: 20px; background: #0d1117;">
                            <div style="text-align: center; color: #8b949e; padding: 40px;">
                                <ion-icon name="document-outline" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></ion-icon>
                                <div>Select a file to display its content</div>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                console.log('spawnDocs onLoad called with wId:', wId);
                const sidebar = document.querySelector(`#${wId} .docs-sidebar`);
                const fileTree = document.querySelector(`#${wId} .docs-file-tree`);
                const fileContent = document.querySelector(`#${wId} .docs-file-content`);
                const fileHeader = document.querySelector(`#${wId} .docs-file-header`);
                const fileName = document.querySelector(`#${wId} .docs-file-name`);
                const filePathEl = document.querySelector(`#${wId} .docs-file-path`);
                const refreshBtn = document.querySelector(`#${wId} #docs-refresh-btn`);
                const searchInput = document.querySelector(`#${wId} .docs-search-input`);
                
                if (!sidebar || !fileTree || !fileContent || !fileHeader || !fileName || !filePathEl || !refreshBtn || !searchInput) {
                    console.error('spawnDocs: Missing required elements', {
                        sidebar: !!sidebar,
                        fileTree: !!fileTree,
                        fileContent: !!fileContent,
                        fileHeader: !!fileHeader,
                        fileName: !!fileName,
                        filePathEl: !!filePathEl,
                        refreshBtn: !!refreshBtn,
                        searchInput: !!searchInput,
                        wId: wId
                    });
                    return;
                }
                
                let allFiles = [];
                let selectedFilePath = null;
                let treeData = {};
                
                // Load file content
                const loadFile = async (filePath) => {
                    try {
                        fileContent.innerHTML = '<div style="padding: 20px; text-align: center; color: #8b949e;">Loading...</div>';
                        
                        const res = await fetch(`/api/docs/lib/file/${encodeURIComponent(filePath)}`);
                        const data = await res.json();
                        
                        if (data.error) {
                            fileContent.innerHTML = `<div style="padding: 20px; color: #f85149;">Error: ${data.error}</div>`;
                            return;
                        }
                        
                        selectedFilePath = filePath;
                        
                        // Show file header
                        fileHeader.style.display = 'block';
                        fileName.textContent = data.name;
                        filePathEl.textContent = `lib/${data.path}`;
                        
                        // Highlight active file in tree
                        document.querySelectorAll(`#${wId} .docs-file-tree .docs-tree-item`).forEach(item => {
                            if (item.dataset.path === filePath && item.dataset.type === 'file') {
                                item.style.background = '#1f6feb';
                                item.style.color = '#fff';
                            } else {
                                item.style.background = 'transparent';
                                item.style.color = '';
                            }
                        });
                        
                        // Display structured documentation instead of source code
                        const ext = data.extension || '';
                        let html = '';
                        
                        if (ext === '.py' && (data.functions || data.classes)) {
                            // Module docstring
                            if (data.module_docstring) {
                                html += `<div style="margin-bottom: 24px; padding: 16px; background: #161b22; border-radius: 6px; border-left: 3px solid #58a6ff;">`;
                                html += `<div style="font-size: 12px; color: #8b949e; margin-bottom: 8px; font-weight: 500;">MODULE DESCRIPTION</div>`;
                                html += `<div style="color: #c9d1d9; line-height: 1.6; white-space: pre-wrap;">${data.module_docstring.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
                                html += `</div>`;
                            }
                            
                            // Classes
                            if (data.classes && data.classes.length > 0) {
                                data.classes.forEach(cls => {
                                    html += `<div style="margin-bottom: 32px; padding: 20px; background: #161b22; border-radius: 8px; border: 1px solid #30363d;">`;
                                    html += `<div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">`;
                                    html += `<ion-icon name="cube-outline" style="font-size: 24px; color: #bc8cff;"></ion-icon>`;
                                    html += `<div>`;
                                    html += `<div style="font-size: 18px; font-weight: 600; color: #c9d1d9; font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;">class ${cls.name}</div>`;
                                    if (cls.docstring) {
                                        html += `<div style="font-size: 13px; color: #8b949e; margin-top: 4px;">${cls.docstring.split('\n')[0].replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
                                    }
                                    html += `</div>`;
                                    html += `</div>`;
                                    
                                    // Class methods
                                    if (cls.methods && cls.methods.length > 0) {
                                        html += `<div style="margin-left: 20px;">`;
                                        cls.methods.forEach(method => {
                                            html += `<div style="margin-bottom: 20px; padding: 16px; background: #0d1117; border-radius: 6px; border-left: 3px solid #bc8cff;">`;
                                            
                                            // Method signature
                                            html += `<div style="font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; font-size: 14px; color: #58a6ff; margin-bottom: 12px;">`;
                                            html += `<span style="color: #ff7b72;">def</span> <span style="color: #c9d1d9;">${method.name}</span><span style="color: #8b949e;">(${method.args.map(a => a.name + (a.type ? ': ' + a.type : '') + (a.default ? ' = ' + a.default : '')).join(', ')})</span>`;
                                            html += `</div>`;
                                            
                                            // Method description
                                            if (method.docstring) {
                                                html += `<div style="color: #c9d1d9; line-height: 1.6; margin-bottom: 12px; white-space: pre-wrap;">${method.docstring.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
                                            }
                                            
                                            // Inputs
                                            if (method.inputs && method.inputs.length > 0) {
                                                html += `<div style="margin-top: 12px;">`;
                                                html += `<div style="font-size: 11px; color: #8b949e; margin-bottom: 6px; font-weight: 500; text-transform: uppercase;">INPUTS</div>`;
                                                method.inputs.forEach(input => {
                                                    html += `<div style="padding: 8px; background: rgba(88, 166, 255, 0.1); border-radius: 4px; margin-bottom: 4px;">`;
                                                    html += `<span style="color: #58a6ff; font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; font-weight: 500;">${input.name}</span>`;
                                                    if (input.description) {
                                                        html += `<span style="color: #8b949e; margin-left: 8px;">${input.description.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
                                                    }
                                                    html += `</div>`;
                                                });
                                                html += `</div>`;
                                            }
                                            
                                            // Outputs
                                            if (method.outputs && method.outputs.length > 0) {
                                                html += `<div style="margin-top: 12px;">`;
                                                html += `<div style="font-size: 11px; color: #8b949e; margin-bottom: 6px; font-weight: 500; text-transform: uppercase;">OUTPUTS</div>`;
                                                method.outputs.forEach(output => {
                                                    html += `<div style="padding: 8px; background: rgba(63, 185, 80, 0.1); border-radius: 4px; margin-bottom: 4px;">`;
                                                    html += `<span style="color: #3fb950;">${output.description ? output.description.replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Return value'}</span>`;
                                                    html += `</div>`;
                                                });
                                                html += `</div>`;
                                            }
                                            
                                            html += `</div>`;
                                        });
                                        html += `</div>`;
                                    }
                                    
                                    html += `</div>`;
                                });
                            }
                            
                            // Functions
                            if (data.functions && data.functions.length > 0) {
                                html += `<div style="margin-bottom: 24px;">`;
                                html += `<div style="font-size: 16px; font-weight: 600; color: #c9d1d9; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">`;
                                html += `<ion-icon name="code-outline" style="font-size: 20px;"></ion-icon>`;
                                html += `<span>Functions</span>`;
                                html += `</div>`;
                                
                                data.functions.forEach(func => {
                                    html += `<div style="margin-bottom: 20px; padding: 16px; background: #161b22; border-radius: 6px; border-left: 3px solid #58a6ff;">`;
                                    
                                    // Function signature
                                    html += `<div style="font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; font-size: 14px; color: #58a6ff; margin-bottom: 12px;">`;
                                    html += `<span style="color: #ff7b72;">def</span> <span style="color: #c9d1d9;">${func.name}</span><span style="color: #8b949e;">(${func.args.map(a => a.name + (a.type ? ': ' + a.type : '') + (a.default ? ' = ' + a.default : '')).join(', ')})</span>`;
                                    html += `</div>`;
                                    
                                    // Function description
                                    if (func.docstring) {
                                        html += `<div style="color: #c9d1d9; line-height: 1.6; margin-bottom: 12px; white-space: pre-wrap;">${func.docstring.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
                                    }
                                    
                                    // Inputs
                                    if (func.inputs && func.inputs.length > 0) {
                                        html += `<div style="margin-top: 12px;">`;
                                        html += `<div style="font-size: 11px; color: #8b949e; margin-bottom: 6px; font-weight: 500; text-transform: uppercase;">INPUTS</div>`;
                                        func.inputs.forEach(input => {
                                            html += `<div style="padding: 8px; background: rgba(88, 166, 255, 0.1); border-radius: 4px; margin-bottom: 4px;">`;
                                            html += `<span style="color: #58a6ff; font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; font-weight: 500;">${input.name}</span>`;
                                            if (input.description) {
                                                html += `<span style="color: #8b949e; margin-left: 8px;">${input.description.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
                                            }
                                            html += `</div>`;
                                        });
                                        html += `</div>`;
                                    }
                                    
                                    // Outputs
                                    if (func.outputs && func.outputs.length > 0) {
                                        html += `<div style="margin-top: 12px;">`;
                                        html += `<div style="font-size: 11px; color: #8b949e; margin-bottom: 6px; font-weight: 500; text-transform: uppercase;">OUTPUTS</div>`;
                                        func.outputs.forEach(output => {
                                            html += `<div style="padding: 8px; background: rgba(63, 185, 80, 0.1); border-radius: 4px; margin-bottom: 4px;">`;
                                            html += `<span style="color: #3fb950;">${output.description ? output.description.replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Return value'}</span>`;
                                            html += `</div>`;
                                        });
                                        html += `</div>`;
                                    }
                                    
                                    html += `</div>`;
                                });
                                html += `</div>`;
                            }
                            
                            if (!data.module_docstring && (!data.functions || data.functions.length === 0) && (!data.classes || data.classes.length === 0)) {
                                html = '<div style="text-align: center; color: #8b949e; padding: 40px;">No functions or classes found in this file</div>';
                            }
                        } else {
                            // For non-Python files, show content
                            let content = data.content || '';
                            content = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            const lines = content.split('\n');
                            html = '<pre style="margin: 0; font-family: "Cascadia Code", "Fira Code", "Consolas", monospace; font-size: 13px; line-height: 1.6; color: #c9d1d9;"><code>';
                            lines.forEach((line, idx) => {
                                html += `<span style="color: #6e7681; margin-right: 16px; user-select: none; display: inline-block; width: 50px; text-align: right;">${String(idx + 1).padStart(4, ' ')}</span>${line || ' '}\n`;
                            });
                            html += '</code></pre>';
                        }
                        
                        fileContent.innerHTML = html;
                    } catch (err) {
                        console.error('Error loading file:', err);
                        fileContent.innerHTML = `<div style="padding: 20px; color: #f85149;">Error: ${err.message}</div>`;
                    }
                };
                
                // Load file tree (loads entire tree from root)
                const loadTree = async () => {
                    try {
                        fileTree.innerHTML = '<div style="padding: 20px; text-align: center; color: #8b949e;">Chargement...</div>';
                        
                        const res = await fetch('/api/docs/lib/list');
                        const data = await res.json();
                        
                        if (data.error) {
                            fileTree.innerHTML = `<div style="padding: 20px; color: #f85149;">Error: ${data.error}</div>`;
                            return;
                        }
                        
                        allFiles = [...(data.directories || []), ...(data.files || [])];
                        // Deep clone the tree to avoid reference issues
                        treeData = JSON.parse(JSON.stringify(data.tree || {}));
                        renderTree(treeData);
                    } catch (err) {
                        console.error('Error loading tree:', err);
                        fileTree.innerHTML = `<div style="padding: 20px; color: #f85149;">Error: ${err.message}</div>`;
                    }
                };
                
                // Render tree item (recursive)
                const renderTreeItem = (item, level = 0) => {
                    const fullPath = item.path;
                    const isExpanded = item.expanded === true;
                    const hasChildren = !item.is_file && item.children && Object.keys(item.children).length > 0;
                    const isSelected = selectedFilePath === fullPath;
                    const indent = level * 16;

                    if (item.is_file) {
                        // It's a file
                        return `
                            <div class="docs-file-item" data-file-path="${fullPath}" 
                                 style="padding: 6px 8px 6px ${indent + 8}px; 
                                        background: ${isSelected ? 'rgba(88, 166, 255, 0.1)' : 'transparent'}; 
                                        border-left: 2px solid ${isSelected ? '#58a6ff' : 'transparent'}; 
                                        cursor: pointer; 
                                        transition: all 0.2s; 
                                        font-size: 12px;
                                        display: flex;
                                        align-items: center;
                                        gap: 6px;
                                        color: ${isSelected ? '#58a6ff' : '#c9d1d9'};"
                                 onmouseover="this.style.background='rgba(88, 166, 255, 0.05)'"
                                 onmouseout="this.style.background='${isSelected ? 'rgba(88, 166, 255, 0.1)' : 'transparent'}'">
                                <ion-icon name="document-text-outline" style="font-size: 14px; flex-shrink: 0;"></ion-icon>
                                <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.name.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
                            </div>
                        `;
                    } else {
                        // It's a folder
                        const childrenHtml = hasChildren && isExpanded 
                            ? Object.values(item.children).map(child => renderTreeItem(child, level + 1)).join('')
                            : '';
                        
                        return `
                            <div>
                                <div class="docs-tree-folder" data-folder-path="${fullPath}"
                                     style="padding: 6px 8px 6px ${indent + 8}px; 
                                            cursor: pointer; 
                                            transition: all 0.2s; 
                                            font-size: 12px;
                                            display: flex;
                                            align-items: center;
                                            gap: 6px;
                                            color: #8b949e;
                                            user-select: none;"
                                     onmouseover="this.style.background='rgba(255,255,255,0.03)'"
                                     onmouseout="this.style.background='transparent'">
                                    <ion-icon name="${isExpanded ? 'chevron-down' : 'chevron-forward'}-outline" 
                                              style="font-size: 12px; flex-shrink: 0; width: 12px;"></ion-icon>
                                    <ion-icon name="folder-outline" style="font-size: 14px; flex-shrink: 0;"></ion-icon>
                                    <span style="flex: 1; font-weight: 500;">${item.name.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
                                </div>
                                ${childrenHtml}
                            </div>
                        `;
                    }
                };

                // Render file tree
                const renderTree = (tree) => {
                    if (!tree || Object.keys(tree).length === 0) {
                        fileTree.innerHTML = '<div style="padding: 20px; text-align: center; color: #8b949e;">No files found</div>';
                        return;
                    }

                    let html = '';
                    for (const item of Object.values(tree)) {
                        html += renderTreeItem(item, 0);
                    }
                    fileTree.innerHTML = html;

                    // Add click handlers for files
                    document.querySelectorAll(`#${wId} .docs-file-item`).forEach(item => {
                        item.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const filePath = item.dataset.filePath;
                            loadFile(filePath);
                        });
                    });

                    // Add click handlers for folders (expand/collapse)
                    document.querySelectorAll(`#${wId} .docs-tree-folder`).forEach(folder => {
                        folder.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const folderPath = folder.dataset.folderPath;
                            toggleFolder(folderPath);
                        });
                    });
                };

                const toggleFolder = (folderPath) => {
                    const findAndToggle = (tree, path) => {
                        const parts = path.split('/').filter(p => p); // Filter empty parts
                        let current = tree;
                        for (let i = 0; i < parts.length; i++) {
                            if (parts[i] in current) {
                                if (i === parts.length - 1) {
                                    // Found the folder
                                    if (current[parts[i]].expanded === undefined || current[parts[i]].expanded === false) {
                                        current[parts[i]].expanded = true;
                                    } else {
                                        current[parts[i]].expanded = false;
                                    }
                                    return true;
                                }
                                if (current[parts[i]].children) {
                                    current = current[parts[i]].children;
                                } else {
                                    return false;
                                }
                            } else {
                                return false;
                            }
                        }
                        return false;
                    };

                    findAndToggle(treeData, folderPath);
                    renderTree(treeData);
                };
                
                // Search functionality
                searchInput.addEventListener('input', (e) => {
                    const query = e.target.value.toLowerCase();
                    if (!query) {
                        renderTree(treeData);
                        return;
                    }
                    
                    // Filter tree based on search
                    const filterTree = (tree) => {
                        const filtered = {};
                        for (const [key, item] of Object.entries(tree)) {
                            if (item.is_file) {
                                // It's a file, check if it matches
                                const matches = item.name.toLowerCase().includes(query) ||
                                              item.path.toLowerCase().includes(query);
                                if (matches) {
                                    filtered[key] = item;
                                }
                            } else {
                                // It's a folder, filter children
                                const filteredChildren = item.children ? filterTree(item.children) : {};
                                const matches = item.name.toLowerCase().includes(query);
                                if (matches || Object.keys(filteredChildren).length > 0) {
                                    filtered[key] = {
                                        ...item,
                                        children: filteredChildren,
                                        expanded: true  // Auto-expand when searching
                                    };
                                }
                            }
                        }
                        return filtered;
                    };
                    
                    const filteredTree = filterTree(treeData);
                    renderTree(filteredTree);
                });
                
                // Refresh button
                refreshBtn.addEventListener('click', () => {
                    loadTree();
                });
                
                // Initial load
                loadTree();
            }
        });
    }

    spawnFileExplorer() {
        this.wm.createWindow({
            title: 'File Explorer',
            icon: 'folder-open-outline',
            width: '600px',
            height: '400px',
            content: `
                <div style="padding: 10px; color: white;">
                    <h3>/home/kitty/workspace</h3>
                    <ul style="list-style: none; padding: 0;">
                        <li style="padding: 5px; cursor: pointer;">📁 exploits/</li>
                        <li style="padding: 5px; cursor: pointer;">📁 payloads/</li>
                        <li style="padding: 5px; cursor: pointer;">📄 README.md</li>
                        <li style="padding: 5px; cursor: pointer;">📄 config.yaml</li>
                    </ul>
                </div>
            `
        });
    }

    spawnSettings() {
        console.log('spawnSettings called');
        const winId = this.wm.createWindow({
            title: 'Settings',
            icon: 'settings-outline',
            width: '1000px',
            height: '750px',
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #0d1117;">
                    <!-- Tabs -->
                    <div style="display: flex; border-bottom: 1px solid #30363d; background: #161b22;">
                        <button class="settings-tab active" data-tab="config" style="padding: 12px 20px; background: transparent; border: none; border-bottom: 2px solid #58a6ff; color: #c9d1d9; cursor: pointer; font-size: 13px; font-weight: 500;">
                            <ion-icon name="document-text-outline" style="font-size: 16px; vertical-align: middle; margin-right: 6px;"></ion-icon>
                            Configuration
                        </button>
                        <button class="settings-tab" data-tab="desktop-apps" style="padding: 12px 20px; background: transparent; border: none; border-bottom: 2px solid transparent; color: #8b949e; cursor: pointer; font-size: 13px; font-weight: 500;">
                            <ion-icon name="apps-outline" style="font-size: 16px; vertical-align: middle; margin-right: 6px;"></ion-icon>
                            Desktop Apps
                        </button>
                    </div>
                    
                    <!-- Config Tab Content -->
                    <div class="settings-tab-content" data-content="config" style="display: flex; flex-direction: column; height: 100%;">
                        <div style="padding: 12px; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-size: 14px; font-weight: 500; color: #c9d1d9;">Configuration File</div>
                                <div class="config-path" style="font-size: 11px; color: #8b949e; font-family: 'Consolas', monospace; margin-top: 4px;">Loading...</div>
                            </div>
                            <div style="display: flex; gap: 8px;">
                                <button class="config-reload-btn" style="padding: 6px 12px; background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; cursor: pointer; font-size: 12px;">
                                    <ion-icon name="refresh-outline" style="font-size: 14px; vertical-align: middle;"></ion-icon> Reload
                                </button>
                                <button class="config-save-btn" style="padding: 6px 12px; background: #238636; border: 1px solid #2ea043; border-radius: 6px; color: #fff; cursor: pointer; font-size: 12px; display: none;">
                                    <ion-icon name="save-outline" style="font-size: 14px; vertical-align: middle;"></ion-icon> Save
                                </button>
                            </div>
                        </div>
                        <!-- System Reset Section -->
                        <div style="padding: 12px; border-bottom: 1px solid #30363d; background: #161b22;">
                            <div style="font-size: 13px; font-weight: 500; color: #c9d1d9; margin-bottom: 8px;">System Reset</div>
                            <div style="font-size: 11px; color: #8b949e; margin-bottom: 12px;">Clear all local storage data and reload the application</div>
                            <button class="reset-storage-btn" style="padding: 8px 16px; background: #f85149; border: 1px solid #da3633; border-radius: 6px; color: #fff; cursor: pointer; font-size: 12px; font-weight: 500; display: flex; align-items: center; gap: 6px;">
                                <ion-icon name="trash-outline" style="font-size: 14px;"></ion-icon>
                                Reset & Reload
                            </button>
                        </div>
                        <div style="flex: 1; position: relative; overflow: hidden;">
                            <textarea class="config-editor" style="width: 100%; height: 100%; background: #0d1117; color: #c9d1d9; border: none; padding: 12px; font-family: 'Fira Code', 'Consolas', monospace; font-size: 13px; resize: none; outline: none;"></textarea>
                        </div>
                        <div class="config-status" style="padding: 8px 12px; border-top: 1px solid #30363d; font-size: 11px; color: #8b949e; display: none;"></div>
                    </div>
                    
                    <!-- Desktop Apps Tab Content -->
                    <div class="settings-tab-content" data-content="desktop-apps" style="display: none; flex-direction: column; height: 100%; padding: 20px; overflow-y: auto;">
                        <div style="margin-bottom: 20px;">
                            <div style="font-size: 16px; font-weight: 600; color: #c9d1d9; margin-bottom: 8px;">Desktop Applications</div>
                            <div style="font-size: 12px; color: #8b949e;">Choose which applications should be visible on the desktop</div>
                        </div>
                        <div class="desktop-apps-list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; margin-bottom: 20px;">
                            <!-- Apps will be loaded dynamically -->
                        </div>
                        <div style="padding-top: 20px; border-top: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center;">
                            <div class="desktop-apps-status" style="font-size: 12px; color: #8b949e;"></div>
                            <button class="desktop-apps-save-btn" style="padding: 8px 16px; background: #238636; border: 1px solid #2ea043; border-radius: 6px; color: #fff; cursor: pointer; font-size: 12px; font-weight: 500; display: flex; align-items: center; gap: 6px;">
                                <ion-icon name="save-outline" style="font-size: 14px;"></ion-icon>
                                Save Preferences
                            </button>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                console.log('Settings onLoad called with wId:', wId);
                
                // Tab switching
                const tabs = document.querySelectorAll(`#${wId} .settings-tab`);
                const tabContents = document.querySelectorAll(`#${wId} .settings-tab-content`);
                
                tabs.forEach(tab => {
                    tab.addEventListener('click', () => {
                        const targetTab = tab.getAttribute('data-tab');
                        
                        // Update tab styles
                        tabs.forEach(t => {
                            t.classList.remove('active');
                            t.style.borderBottomColor = 'transparent';
                            t.style.color = '#8b949e';
                        });
                        tab.classList.add('active');
                        tab.style.borderBottomColor = '#58a6ff';
                        tab.style.color = '#c9d1d9';
                        
                        // Show/hide tab contents
                        tabContents.forEach(content => {
                            if (content.getAttribute('data-content') === targetTab) {
                                content.style.display = 'flex';
                            } else {
                                content.style.display = 'none';
                            }
                        });
                    });
                });
                
                // Config tab elements
                const editor = document.querySelector(`#${wId} .config-editor`);
                const saveBtn = document.querySelector(`#${wId} .config-save-btn`);
                const reloadBtn = document.querySelector(`#${wId} .config-reload-btn`);
                const statusDiv = document.querySelector(`#${wId} .config-status`);
                const pathDiv = document.querySelector(`#${wId} .config-path`);
                const resetBtn = document.querySelector(`#${wId} .reset-storage-btn`);
                
                let codeMirrorEditor = null;
                let isModified = false;

                // Initialize CodeMirror
                const initEditor = () => {
                    if (codeMirrorEditor) {
                        codeMirrorEditor.toTextArea();
                    }
                    codeMirrorEditor = CodeMirror.fromTextArea(editor, {
                        mode: 'properties',
                        theme: 'monokai',
                        lineNumbers: true,
                        indentUnit: 2,
                        indentWithTabs: false,
                        lineWrapping: true,
                        autofocus: true,
                        styleActiveLine: true,
                        matchBrackets: true,
                        autoCloseBrackets: true,
                        extraKeys: {
                            "Ctrl-S": () => saveConfig(),
                            "Cmd-S": () => saveConfig()
                        }
                    });

                    codeMirrorEditor.on('change', () => {
                        isModified = true;
                        if (saveBtn) saveBtn.style.display = 'inline-block';
                        if (statusDiv) {
                            statusDiv.style.display = 'block';
                            statusDiv.style.color = '#f85149';
                            statusDiv.textContent = '● Modified - Press Ctrl+S or click Save to save changes';
                        }
                    });

                    codeMirrorEditor.setSize('100%', '100%');
                };

                // Load config file
                const loadConfig = async () => {
                    try {
                        const res = await fetch('/api/config/get');
                        const data = await res.json();
                        
                        if (data.success) {
                            if (codeMirrorEditor) {
                                codeMirrorEditor.setValue(data.content || '');
                                codeMirrorEditor.clearHistory();
                            } else {
                                editor.value = data.content || '';
                            }
                            if (pathDiv) pathDiv.textContent = data.path || 'config.toml';
                            isModified = false;
                            if (saveBtn) saveBtn.style.display = 'none';
                            if (statusDiv) statusDiv.style.display = 'none';
                        } else {
                            throw new Error(data.error || 'Failed to load config');
                        }
                    } catch (err) {
                        console.error('Error loading config:', err);
                        if (statusDiv) {
                            statusDiv.style.display = 'block';
                            statusDiv.style.color = '#f85149';
                            statusDiv.textContent = `Error loading config: ${err.message}`;
                        }
                        if (pathDiv) pathDiv.textContent = 'Error loading config file';
                    }
                };

                // Save config file
                const saveConfig = async () => {
                    if (!codeMirrorEditor) return;
                    
                    const content = codeMirrorEditor.getValue();
                    
                    try {
                        const res = await fetch('/api/config/save', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ content })
                        });
                        
                        const data = await res.json();
                        
                        if (data.success) {
                            isModified = false;
                            if (saveBtn) saveBtn.style.display = 'none';
                            if (statusDiv) {
                                statusDiv.style.display = 'block';
                                statusDiv.style.color = '#3fb950';
                                statusDiv.textContent = '✓ Configuration saved successfully';
                                setTimeout(() => {
                                    statusDiv.style.display = 'none';
                                }, 3000);
                            }
                            codeMirrorEditor.clearHistory();
                        } else {
                            throw new Error(data.error || 'Failed to save config');
                        }
                    } catch (err) {
                        console.error('Error saving config:', err);
                        if (statusDiv) {
                            statusDiv.style.display = 'block';
                            statusDiv.style.color = '#f85149';
                            statusDiv.textContent = `Error saving config: ${err.message}`;
                        }
                    }
                };

                // Event listeners for config tab
                if (saveBtn) {
                    saveBtn.addEventListener('click', saveConfig);
                }
                if (reloadBtn) {
                    reloadBtn.addEventListener('click', () => {
                        if (isModified && !confirm('You have unsaved changes. Reload anyway?')) {
                            return;
                        }
                        loadConfig();
                    });
                }
                
                if (resetBtn) {
                    resetBtn.addEventListener('click', () => {
                        if (confirm('Are you sure you want to reset all local storage data? This will clear all saved settings and session data, then reload the page.')) {
                            try {
                                localStorage.clear();
                                if (window.os && window.os.showNotification) {
                                    window.os.showNotification('Local storage cleared. Reloading...', 'info');
                                }
                                setTimeout(() => {
                                    window.location.reload();
                                }, 500);
                            } catch (e) {
                                if (window.os && window.os.showNotification) {
                                    window.os.showNotification('Error clearing local storage: ' + e.message, 'error');
                                } else {
                                    alert('Error clearing local storage: ' + e.message);
                                }
                            }
                        }
                    });
                }

                // Desktop Apps tab elements
                const appsList = document.querySelector(`#${wId} .desktop-apps-list`);
                const appsSaveBtn = document.querySelector(`#${wId} .desktop-apps-save-btn`);
                const appsStatus = document.querySelector(`#${wId} .desktop-apps-status`);
                
                let desktopApps = {};
                let appsModified = false;

                // Load desktop apps preferences
                const loadDesktopApps = async () => {
                    try {
                        const res = await fetch('/api/desktop-apps/preferences');
                        const data = await res.json();
                        
                        if (data.success && data.apps) {
                            desktopApps = data.apps;
                            renderDesktopApps();
                            appsModified = false;
                            updateAppsStatus();
                        } else {
                            throw new Error(data.error || 'Failed to load desktop apps preferences');
                        }
                    } catch (err) {
                        console.error('Error loading desktop apps:', err);
                        if (appsStatus) {
                            appsStatus.textContent = `Error: ${err.message}`;
                            appsStatus.style.color = '#f85149';
                        }
                    }
                };

                // Render desktop apps list
                const renderDesktopApps = () => {
                    if (!appsList) return;
                    
                    appsList.innerHTML = '';
                    
                    Object.entries(desktopApps).forEach(([appId, appInfo]) => {
                        const appItem = document.createElement('div');
                        appItem.style.cssText = 'padding: 12px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; display: flex; align-items: center; gap: 12px; cursor: pointer; transition: all 0.2s;';
                        appItem.onmouseover = () => appItem.style.background = '#21262d';
                        appItem.onmouseout = () => appItem.style.background = '#161b22';
                        
                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.checked = appInfo.visible !== false;
                        checkbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer;';
                        checkbox.addEventListener('change', (e) => {
                            desktopApps[appId].visible = e.target.checked;
                            appsModified = true;
                            updateAppsStatus();
                        });
                        
                        const icon = document.createElement('ion-icon');
                        icon.name = appInfo.icon || 'apps-outline';
                        icon.style.cssText = 'font-size: 24px; color: #58a6ff;';
                        
                        const label = document.createElement('div');
                        label.style.cssText = 'flex: 1; color: #c9d1d9; font-size: 13px; font-weight: 500;';
                        label.textContent = appInfo.name || appId;
                        
                        appItem.appendChild(checkbox);
                        appItem.appendChild(icon);
                        appItem.appendChild(label);
                        appsList.appendChild(appItem);
                    });
                };

                // Update apps status
                const updateAppsStatus = () => {
                    if (!appsStatus) return;
                    const visibleCount = Object.values(desktopApps).filter(app => app.visible !== false).length;
                    const totalCount = Object.keys(desktopApps).length;
                    appsStatus.textContent = `${visibleCount} of ${totalCount} applications visible`;
                    appsStatus.style.color = appsModified ? '#f85149' : '#8b949e';
                };

                // Save desktop apps preferences
                const saveDesktopApps = async () => {
                    try {
                        const res = await fetch('/api/desktop-apps/preferences', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ apps: desktopApps })
                        });
                        
                        const data = await res.json();
                        
                        if (data.success) {
                            appsModified = false;
                            updateAppsStatus();
                            if (appsStatus) {
                                appsStatus.textContent = '✓ Preferences saved successfully';
                                appsStatus.style.color = '#3fb950';
                                setTimeout(() => {
                                    updateAppsStatus();
                                }, 3000);
                            }
                            // Reload the page to apply changes
                            if (window.os && window.os.showNotification) {
                                window.os.showNotification('Desktop apps preferences saved. Reloading...', 'info');
                            }
                            setTimeout(() => {
                                window.location.reload();
                            }, 1000);
                        } else {
                            throw new Error(data.error || 'Failed to save preferences');
                        }
                    } catch (err) {
                        console.error('Error saving desktop apps:', err);
                        if (appsStatus) {
                            appsStatus.textContent = `Error: ${err.message}`;
                            appsStatus.style.color = '#f85149';
                        }
                    }
                };

                // Event listener for save button
                if (appsSaveBtn) {
                    appsSaveBtn.addEventListener('click', saveDesktopApps);
                }

                // Initialize
                initEditor();
                loadConfig();
                loadDesktopApps();
            }
        });
    }

    async spawnAbout() {
        // Fetch version information from the backend
        let kittysploitVersion = '2.0';
        let kittyOSVersion = '1.0.0';
        let contactInfo = 'contact@kittysploit.com';

        try {
            const res = await fetch('/api/system/info');
            if (res.ok) {
                const data = await res.json();
                kittysploitVersion = data.kittysploit_version || kittysploitVersion;
                kittyOSVersion = data.kittyos_version || kittyOSVersion;
                contactInfo = data.contact || contactInfo;
            }
        } catch (err) {
            console.warn('Could not fetch system info:', err);
        }

        // Calculate center position
        const windowWidth = 650;
        const windowHeight = 550;
        const left = (window.innerWidth - windowWidth) / 2;
        const top = (window.innerHeight - windowHeight) / 2;

        this.wm.createWindow({
            title: 'About',
            icon: 'information-circle-outline',
            width: `${windowWidth}px`,
            height: `${windowHeight}px`,
            top: `${Math.max(50, top)}px`,
            left: `${Math.max(50, left)}px`,
            content: `
                <div style="padding: 30px; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
                    <div style="margin-bottom: 30px;">
                        <img src="/static/logo.jpg" alt="Kittysploit Logo" style="max-width: 120px; max-height: 120px; width: auto; height: auto; object-fit: contain;">
                    </div>
                    
                    <h1 style="color: var(--accent-color); font-size: 28px; font-weight: 600; margin: 0 0 10px 0;">KittySploit Framework</h1>
                    <p style="color: #8b949e; font-size: 14px; margin: 0 0 30px 0;">Advanced Penetration Testing Framework</p>
                    
                    <div style="width: 100%; max-width: 400px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
                            <span style="color: #8b949e; font-size: 13px;">KittySploit Version</span>
                            <span style="color: var(--accent-color); font-weight: 600; font-size: 13px;">v${kittysploitVersion}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
                            <span style="color: #8b949e; font-size: 13px;">KittyOS Version</span>
                            <span style="color: var(--accent-color); font-weight: 600; font-size: 13px;">v${kittyOSVersion}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0;">
                            <span style="color: #8b949e; font-size: 13px;">Contact</span>
                            <a href="mailto:${contactInfo}" style="color: var(--accent-color); text-decoration: none; font-size: 13px; font-weight: 600;">${contactInfo}</a>
                        </div>
                    </div>
                    
                    <div style="margin-top: 20px;">
                        <p style="color: #6e7681; font-size: 12px; margin: 0;">© ${new Date().getFullYear()} KittySploit Team</p>
                        <p style="color: #6e7681; font-size: 11px; margin: 5px 0 0 0;">All rights reserved</p>
                    </div>
                </div>
            `
        });
    }

    spawnCollab() {
        // Open the real KittyCollab server (runs on port 5006)
        const collabUrl = 'http://127.0.0.1:5006';
        this.wm.createWindow({
            title: 'KittyCollab - Collaborative Editor',
            icon: 'code-slash-outline',
            width: '1000px',
            height: '700px',
            top: '30px',
            left: '100px',
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #1e1e1e;">
                    <div style="padding: 10px; background: #0d1117; border-bottom: 2px solid #58a6ff; display: flex; align-items: center; gap: 10px;">
                        <span style="color: #58a6ff; font-weight: bold; font-size: 14px;">📝 KittyCollab</span>
                        <span style="color: #8b949e; font-size: 12px;">Collaborative Editing</span>
                        <a href="${collabUrl}" target="_blank" style="margin-left: auto; color: #58a6ff; text-decoration: none; font-size: 12px;">Open in New Tab ↗</a>
                    </div>
                    <iframe src="${collabUrl}" style="flex: 1; border: none; background: #1e1e1e;"></iframe>
                </div>
            `
        });
    }

    openCollabInterface() {
        // This method is kept for backward compatibility but just calls spawnCollab
        this.spawnCollab();
    }

    spawnAppSite() {
        this.wm.createWindow({
            title: 'Kittysploit App',
            icon: 'apps-outline',
            width: '1200px',
            height: '800px',
            content: `
                <iframe src="https://app.kittysploit.com" style="width: 100%; height: 100%; border: none; background: #0d1117;"></iframe>
            `
        });
    }

    spawnProxy() {
        const wId = this.wm.createWindow({
            title: 'KittyProxy Control',
            icon: 'shield-checkmark-outline',
            width: '700px',
            height: '600px',
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif;">
                    <!-- Header -->
                    <div style="padding: 20px; border-bottom: 1px solid #30363d; background: #161b22;">
                        <h2 style="margin: 0; font-size: 18px; font-weight: 600; color: #c9d1d9; display: flex; align-items: center; gap: 10px;">
                            <ion-icon name="shield-checkmark-outline" style="color: #58a6ff; font-size: 20px;"></ion-icon>
                            KittyProxy Control
                        </h2>
                        <p style="margin: 5px 0 0 0; color: #8b949e; font-size: 12px;">HTTP/HTTPS traffic interception and analysis</p>
                    </div>
                    
                    <!-- Status Section -->
                    <div style="padding: 20px; border-bottom: 1px solid #30363d;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
                            <div id="status-indicator" style="width: 12px; height: 12px; border-radius: 50%; background: #8b949e;"></div>
                            <span id="status-text" style="color: #8b949e; font-size: 14px; font-weight: 500;">Not Running</span>
                        </div>
                    </div>
                    
                    <!-- Configuration Section -->
                    <div style="padding: 20px; border-bottom: 1px solid #30363d; flex: 1;">
                        <h3 style="margin: 0 0 15px 0; color: #c9d1d9; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; font-size: 11px;">Configuration</h3>
                        
                        <div style="display: flex; flex-direction: column; gap: 15px;">
                            <div>
                                <label style="display: block; color: #8b949e; font-size: 12px; margin-bottom: 6px; font-weight: 500;">Proxy Port</label>
                                <input type="number" id="proxy-port-input" value="8080" min="1" max="65535" 
                                    style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 13px; font-family: 'Fira Code', monospace; outline: none; box-sizing: border-box;"
                                    onfocus="this.style.borderColor='#58a6ff'; this.style.background='rgba(88,166,255,0.1)'"
                                    onblur="this.style.borderColor='#30363d'; this.style.background='rgba(255,255,255,0.05)'">
                            </div>
                            
                            <div>
                                <label style="display: block; color: #8b949e; font-size: 12px; margin-bottom: 6px; font-weight: 500;">API Port</label>
                                <input type="number" id="api-port-input" value="8000" min="1" max="65535" 
                                    style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 13px; font-family: 'Fira Code', monospace; outline: none; box-sizing: border-box;"
                                    onfocus="this.style.borderColor='#58a6ff'; this.style.background='rgba(88,166,255,0.1)'"
                                    onblur="this.style.borderColor='#30363d'; this.style.background='rgba(255,255,255,0.05)'">
                            </div>
                        </div>
                    </div>
                    
                    <!-- Actions -->
                    <div style="padding: 20px; display: flex; gap: 10px; border-top: 1px solid #30363d; background: #161b22;">
                        <button id="start-proxy-btn" style="flex: 1; padding: 12px; background: #238636; border: 1px solid #238636; border-radius: 6px; color: white; cursor: pointer; font-size: 13px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s;">
                            <ion-icon name="play-outline"></ion-icon>
                            Start Proxy
                        </button>
                        <button id="stop-proxy-btn" disabled style="flex: 1; padding: 12px; background: #6e7681; border: 1px solid #6e7681; border-radius: 6px; color: white; cursor: not-allowed; font-size: 13px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px; opacity: 0.5;">
                            <ion-icon name="stop-outline"></ion-icon>
                            Stop
                        </button>
                    </div>
                    
                    <!-- Open Interface Button -->
                    <div style="padding: 0 20px 20px 20px;">
                        <button id="open-interface-btn" disabled style="width: 100%; padding: 12px; background: #6e7681; border: 1px solid #6e7681; border-radius: 6px; color: white; cursor: not-allowed; font-size: 13px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px; opacity: 0.5;">
                            <ion-icon name="open-outline"></ion-icon>
                            Open Interface
                        </button>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const startBtn = document.querySelector(`#${wId} #start-proxy-btn`);
                const stopBtn = document.querySelector(`#${wId} #stop-proxy-btn`);
                const openInterfaceBtn = document.querySelector(`#${wId} #open-interface-btn`);
                const statusText = document.querySelector(`#${wId} #status-text`);
                const statusIndicator = document.querySelector(`#${wId} #status-indicator`);
                const proxyPortInput = document.querySelector(`#${wId} #proxy-port-input`);
                const apiPortInput = document.querySelector(`#${wId} #api-port-input`);

                let isRunning = false;
                let apiUrl = null;
                let startTimeout = null;

                const updateUI = (running, data = {}) => {
                    isRunning = running;
                    
                    // Clear timeout if proxy started successfully
                    if (running && startTimeout) {
                        clearTimeout(startTimeout);
                        startTimeout = null;
                    }

                    if (running) {
                        statusText.textContent = 'Running';
                        statusText.style.color = '#3fb950';
                        if (statusIndicator) {
                            statusIndicator.style.background = '#3fb950';
                        }
                        startBtn.disabled = true;
                        startBtn.style.background = '#6e7681';
                        startBtn.style.borderColor = '#6e7681';
                        startBtn.style.cursor = 'not-allowed';
                        startBtn.style.opacity = '0.5';
                        startBtn.innerHTML = '<ion-icon name="play-outline"></ion-icon> Start Proxy';
                        stopBtn.disabled = false;
                        stopBtn.style.background = '#da3633';
                        stopBtn.style.borderColor = '#da3633';
                        stopBtn.style.cursor = 'pointer';
                        stopBtn.style.opacity = '1';
                        stopBtn.innerHTML = '<ion-icon name="stop-outline"></ion-icon> Stop';
                        openInterfaceBtn.disabled = false;
                        openInterfaceBtn.style.background = '#1f6feb';
                        openInterfaceBtn.style.borderColor = '#1f6feb';
                        openInterfaceBtn.style.cursor = 'pointer';
                        openInterfaceBtn.style.opacity = '1';

                        // Disable port inputs when running
                        if (proxyPortInput) proxyPortInput.disabled = true;
                        if (apiPortInput) apiPortInput.disabled = true;

                        if (data.proxy_port && proxyPortInput) proxyPortInput.value = data.proxy_port;
                        if (data.api_port && apiPortInput) apiPortInput.value = data.api_port;
                        if (data.api_url) apiUrl = data.api_url;
                    } else {
                        statusText.textContent = 'Not Running';
                        statusText.style.color = '#8b949e';
                        if (statusIndicator) {
                            statusIndicator.style.background = '#8b949e';
                        }
                        startBtn.disabled = false;
                        startBtn.style.background = '#238636';
                        startBtn.style.borderColor = '#238636';
                        startBtn.style.cursor = 'pointer';
                        startBtn.style.opacity = '1';
                        startBtn.innerHTML = '<ion-icon name="play-outline"></ion-icon> Start Proxy';
                        stopBtn.disabled = true;
                        stopBtn.style.background = '#6e7681';
                        stopBtn.style.borderColor = '#6e7681';
                        stopBtn.style.cursor = 'not-allowed';
                        stopBtn.style.opacity = '0.5';
                        stopBtn.innerHTML = '<ion-icon name="stop-outline"></ion-icon> Stop';
                        openInterfaceBtn.disabled = true;
                        openInterfaceBtn.style.background = '#6e7681';
                        openInterfaceBtn.style.borderColor = '#6e7681';
                        openInterfaceBtn.style.cursor = 'not-allowed';
                        openInterfaceBtn.style.opacity = '0.5';

                        // Enable port inputs when stopped
                        if (proxyPortInput) proxyPortInput.disabled = false;
                        if (apiPortInput) apiPortInput.disabled = false;

                        apiUrl = null;
                    }
                };

                // Handle proxy status updates
                const handleProxyStatus = (data) => {
                    if (data.running || (data.success === true && data.api_url)) {
                        updateUI(true, data);
                    } else if (data.success === false && data.error) {
                        statusText.textContent = `Error: ${data.error}`;
                        statusText.style.color = '#f85149';
                        if (statusIndicator) {
                            statusIndicator.style.background = '#f85149';
                        }
                        updateUI(false);
                        if (this.showNotification) {
                            this.showNotification(`Proxy error: ${data.error}`, 'error', 5000);
                        }
                    } else {
                        updateUI(false);
                    }
                };

                // Get initial status
                if (this.socket) {
                    this.socket.emit('proxy_get_status');

                    // Listen for proxy status updates
                    this.socket.on('proxy_status', handleProxyStatus);
                }

                startBtn.addEventListener('click', () => {
                    if (this.socket && !isRunning) {
                        const proxyPort = parseInt(proxyPortInput?.value || 8080);
                        const apiPort = parseInt(apiPortInput?.value || 8000);
                        
                        if (isNaN(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
                            if (this.showNotification) {
                                this.showNotification('Invalid proxy port (1-65535)', 'error', 3000);
                            }
                            return;
                        }
                        if (isNaN(apiPort) || apiPort < 1 || apiPort > 65535) {
                            if (this.showNotification) {
                                this.showNotification('Invalid API port (1-65535)', 'error', 3000);
                            }
                            return;
                        }
                        
                        // Disable start button and show loading state
                        startBtn.disabled = true;
                        startBtn.style.background = '#6e7681';
                        startBtn.style.borderColor = '#6e7681';
                        startBtn.style.cursor = 'not-allowed';
                        startBtn.style.opacity = '0.5';
                        startBtn.innerHTML = '<ion-icon name="hourglass-outline"></ion-icon> Starting...';
                        
                        statusText.textContent = 'Starting...';
                        statusText.style.color = '#ffbd2e';
                        if (statusIndicator) {
                            statusIndicator.style.background = '#ffbd2e';
                        }
                        
                        // Set timeout to detect if proxy doesn't start
                        if (startTimeout) clearTimeout(startTimeout);
                        startTimeout = setTimeout(() => {
                            if (!isRunning) {
                                statusText.textContent = 'Timeout - Check logs';
                                statusText.style.color = '#f85149';
                                if (statusIndicator) {
                                    statusIndicator.style.background = '#f85149';
                                }
                                // Re-enable start button on timeout
                                startBtn.disabled = false;
                                startBtn.style.background = '#238636';
                                startBtn.style.borderColor = '#238636';
                                startBtn.style.cursor = 'pointer';
                                startBtn.style.opacity = '1';
                                startBtn.innerHTML = '<ion-icon name="play-outline"></ion-icon> Start Proxy';
                                if (this.showNotification) {
                                    this.showNotification('Proxy startup timeout. Check server logs.', 'error', 5000);
                                }
                            }
                        }, 15000); // 15 second timeout
                        
                        this.socket.emit('proxy_start', {
                            proxy_port: proxyPort,
                            api_port: apiPort
                        });
                    }
                });

                stopBtn.addEventListener('click', () => {
                    if (this.socket && isRunning) {
                        // Disable stop button and show loading state
                        stopBtn.disabled = true;
                        stopBtn.style.background = '#6e7681';
                        stopBtn.style.borderColor = '#6e7681';
                        stopBtn.style.cursor = 'not-allowed';
                        stopBtn.style.opacity = '0.5';
                        stopBtn.innerHTML = '<ion-icon name="hourglass-outline"></ion-icon> Stopping...';
                        
                        statusText.textContent = 'Stopping...';
                        statusText.style.color = '#ffbd2e';
                        if (statusIndicator) {
                            statusIndicator.style.background = '#ffbd2e';
                        }
                        
                        this.socket.emit('proxy_stop');
                    }
                });

                openInterfaceBtn.addEventListener('click', () => {
                    if (isRunning && apiUrl) {
                        this.openProxyInterface(apiUrl);
                    }
                });
            }
        });
    }

    spawnKittyProxy() {
        // Alias for spawnProxy
        this.spawnProxy();
    }

    openProxyInterface(apiUrl) {
        this.wm.createWindow({
            title: 'KittyProxy Interface',
            icon: 'shield-checkmark-outline',
            width: '1000px',
            height: '700px',
            top: '30px',
            left: '100px',
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #fff;">
                    <div style="padding: 10px; background: #0d1117; border-bottom: 2px solid #58a6ff; display: flex; align-items: center; gap: 10px;">
                        <span style="color: #58a6ff; font-weight: bold; font-size: 14px;">🛡️ KittyProxy</span>
                        <span style="color: #8b949e; font-size: 12px;">${apiUrl}</span>
                        <a href="${apiUrl}" target="_blank" style="margin-left: auto; color: #58a6ff; text-decoration: none; font-size: 12px;">Open in New Tab ↗</a>
                    </div>
                    <iframe src="${apiUrl}" style="flex: 1; border: none; background: white;"></iframe>
                </div>
            `
        });
    }

    spawnNetworkScanner() {
        this.wm.createWindow({
            title: 'Hosts & Vulnerabilities',
            icon: 'globe-outline',
            width: '900px',
            height: '600px',
            headerButtons: `
                <button id="refresh-hosts-btn" class="header-action-btn" title="Refresh">
                    <ion-icon name="refresh-outline"></ion-icon>
                </button>
            `,
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif;">
                    <div style="padding: 15px; border-bottom: 1px solid #30363d;">
                        <div style="display: flex; gap: 10px; align-items: center; justify-content: flex-end;">
                            <div style="font-size: 13px; color: #8b949e;">
                                <span id="hosts-count">0</span> Hosts | <span id="vulns-count">0</span> Vulnerabilities
                            </div>
                        </div>
                    </div>
                    
                    <div style="display: flex; flex: 1; overflow: hidden;">
                        <!-- Hosts List -->
                        <div style="flex: 1; border-right: 1px solid #30363d; display: flex; flex-direction: column;">
                            <div style="padding: 10px; background: #161b22; border-bottom: 1px solid #30363d; font-weight: 600; font-size: 13px;">
                                🖥️ Discovered Hosts
                            </div>
                            <div id="hosts-list" style="flex: 1; overflow-y: auto; padding: 10px;">
                                <div style="text-align: center; color: #8b949e; padding: 20px;">Loading...</div>
                            </div>
                        </div>
                        
                        <!-- Vulnerabilities List -->
                        <div style="flex: 1; display: flex; flex-direction: column;">
                            <div style="padding: 10px; background: #161b22; border-bottom: 1px solid #30363d; font-weight: 600; font-size: 13px;">
                                🔓 Vulnerabilities
                            </div>
                            <div id="vulns-list" style="flex: 1; overflow-y: auto; padding: 10px;">
                                <div style="text-align: center; color: #8b949e; padding: 20px;">Select a host to view vulnerabilities</div>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const refreshBtn = document.querySelector(`#${wId} #refresh-hosts-btn`);
                const hostsList = document.querySelector(`#${wId} #hosts-list`);
                const vulnsList = document.querySelector(`#${wId} #vulns-list`);
                const hostsCount = document.querySelector(`#${wId} #hosts-count`);
                const vulnsCount = document.querySelector(`#${wId} #vulns-count`);

                let allVulns = [];

                const loadHosts = () => {
                    if (this.socket) {
                        this.socket.emit('get_hosts');

                        this.socket.once('hosts_data', (data) => {
                            if (data.error) {
                                hostsList.innerHTML = `<div style="color: #f85149; padding: 20px; text-align: center;">Error: ${data.error}</div>`;
                                return;
                            }

                            const hosts = data.hosts || [];
                            allVulns = data.vulns || [];

                            hostsCount.textContent = hosts.length;
                            vulnsCount.textContent = allVulns.length;

                            if (hosts.length === 0) {
                                hostsList.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 20px;">No hosts discovered yet</div>';
                                return;
                            }

                            hostsList.innerHTML = hosts.map(host => {
                                const statusColor = host.status === 'up' ? '#3fb950' : '#8b949e';
                                const vulnsBadge = host.vulns_count > 0 ?
                                    `<span style="background: #da3633; color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 8px;">${host.vulns_count}</span>` : '';

                                return `
                                    <div class="host-item" data-host-id="${host.id}" style="padding: 12px; border: 1px solid #30363d; border-radius: 6px; margin-bottom: 8px; cursor: pointer; transition: all 0.2s;">
                                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                            <span style="color: ${statusColor};">●</span>
                                            <strong style="color: #58a6ff; font-size: 13px;">${host.address}</strong>
                                            ${vulnsBadge}
                                        </div>
                                        <div style="font-size: 11px; color: #8b949e; padding-left: 20px;">
                                            <div>${host.hostname}</div>
                                            <div>OS: ${host.os}</div>
                                        </div>
                                    </div>
                                `;
                            }).join('');

                            // Add click handlers
                            document.querySelectorAll(`#${wId} .host-item`).forEach(item => {
                                item.addEventListener('click', () => {
                                    // Remove previous selection
                                    document.querySelectorAll(`#${wId} .host-item`).forEach(i => {
                                        i.style.background = '';
                                        i.style.borderColor = '#30363d';
                                    });

                                    // Highlight selected
                                    item.style.background = 'rgba(88, 166, 255, 0.1)';
                                    item.style.borderColor = '#58a6ff';

                                    // Show vulnerabilities
                                    const hostId = parseInt(item.dataset.hostId);
                                    const hostVulns = allVulns.filter(v => v.host_id === hostId);

                                    if (hostVulns.length === 0) {
                                        vulnsList.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 20px;">No vulnerabilities found for this host</div>';
                                        return;
                                    }

                                    vulnsList.innerHTML = hostVulns.map(vuln => {
                                        const severityColors = {
                                            'critical': '#da3633',
                                            'high': '#f85149',
                                            'medium': '#fb8500',
                                            'low': '#f9e2af',
                                            'info': '#58a6ff'
                                        };
                                        const color = severityColors[vuln.severity?.toLowerCase()] || '#8b949e';

                                        return `
                                            <div style="padding: 12px; border: 1px solid #30363d; border-left: 3px solid ${color}; border-radius: 4px; margin-bottom: 8px; background: rgba(22, 27, 34, 0.5);">
                                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                                                    <span style="background: ${color}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; text-transform: uppercase; font-weight: bold;">
                                                        ${vuln.severity || 'unknown'}
                                                    </span>
                                                    <strong style="font-size: 13px;">${vuln.name}</strong>
                                                </div>
                                                ${vuln.port ? `<div style="font-size: 11px; color: #8b949e; margin-bottom: 4px;">Port: ${vuln.port} (${vuln.service || 'unknown'})</div>` : ''}
                                                ${vuln.description ? `<div style="font-size: 11px; color: #c9d1d9; line-height: 1.4;">${vuln.description}</div>` : ''}
                                            </div>
                                        `;
                                    }).join('');
                                });

                                item.addEventListener('mouseenter', () => {
                                    if (!item.style.borderColor || item.style.borderColor === 'rgb(48, 54, 61)') {
                                        item.style.background = 'rgba(48, 54, 61, 0.5)';
                                    }
                                });

                                item.addEventListener('mouseleave', () => {
                                    if (!item.style.borderColor || item.style.borderColor === 'rgb(48, 54, 61)') {
                                        item.style.background = '';
                                    }
                                });
                            });
                        });
                    }
                };

                refreshBtn.addEventListener('click', loadHosts);
                loadHosts(); // Initial load
            }
        });
    }

    spawnPortMonitor() {
        const winId = this.wm.createWindow({
            title: 'Port Monitor - Local Open Ports',
            icon: 'server-outline',
            width: '700px',
            height: '500px',
            headerButtons: `
                <button id="refresh-ports-btn" class="header-action-btn" title="Refresh">
                    <ion-icon name="refresh-outline"></ion-icon>
                </button>
            `,
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif;">
                    <div style="padding: 15px; border-bottom: 1px solid #30363d;">
                        <div style="display: flex; gap: 10px; align-items: center; justify-content: flex-end;">
                            <div style="font-size: 13px; color: #8b949e;">
                                <span id="ports-count">0</span> Listening Ports
                            </div>
                        </div>
                    </div>
                    
                    <div id="ports-list" style="flex: 1; overflow-y: auto; overflow-x: hidden; min-height: 0; position: relative;">
                        <div style="text-align: center; color: #8b949e; padding: 20px;">Loading...</div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const refreshBtn = document.querySelector(`#${wId} #refresh-ports-btn`);
                const portsList = document.querySelector(`#${wId} #ports-list`);
                const portsCount = document.querySelector(`#${wId} #ports-count`);

                const loadPorts = () => {
                    const renderPorts = (ports) => {
                        portsCount.textContent = ports.length;

                        if (ports.length === 0) {
                            portsList.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 20px;">No listening ports found</div>';
                            return;
                        }

                        portsList.innerHTML = `
                            <div style="height: 100%; overflow-y: auto; overflow-x: hidden;">
                                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                                    <thead style="position: sticky; top: 0; background: #0d1117; z-index: 1;">
                                        <tr style="background: #161b22; color: #58a6ff;">
                                            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #30363d;">Port</th>
                                            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #30363d;">Protocol</th>
                                            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #30363d;">Address</th>
                                            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #30363d;">Process</th>
                                            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #30363d;">PID</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${ports.map((port, idx) => `
                                            <tr style="background: ${idx % 2 === 0 ? 'rgba(22, 27, 34, 0.5)' : 'transparent'};">
                                                <td style="padding: 10px; border-bottom: 1px solid #30363d;">
                                                    <strong style="color: #3fb950;">${port.port}</strong>
                                                </td>
                                                <td style="padding: 10px; border-bottom: 1px solid #30363d;">${port.protocol}</td>
                                                <td style="padding: 10px; border-bottom: 1px solid #30363d; font-family: monospace; font-size: 12px;">
                                                    ${port.address}
                                                </td>
                                                <td style="padding: 10px; border-bottom: 1px solid #30363d;">
                                                    <code style="background: rgba(88, 166, 255, 0.1); padding: 2px 6px; border-radius: 3px; font-size: 11px;">
                                                        ${port.process}
                                                    </code>
                                                </td>
                                                <td style="padding: 10px; border-bottom: 1px solid #30363d; color: #8b949e;">
                                                    ${port.pid || '-'}
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        `;
                    };

                    // Prefer Socket.IO when available
                    if (this.socket && this.socket.connected) {
                        this.socket.emit('get_ports');

                        this.socket.once('ports_data', (data) => {
                            if (data.error) {
                                portsList.innerHTML = `<div style="color: #f85149; padding: 20px; text-align: center;">Error: ${data.error}</div>`;
                                return;
                            }

                            const ports = data.ports || [];
                            renderPorts(ports);
                        });
                        return;
                    }

                    // Fallback to HTTP polling
                    fetch('/api/ports')
                        .then(r => r.json())
                        .then((data) => {
                            if (data.error) {
                                portsList.innerHTML = `<div style="color: #f85149; padding: 20px; text-align: center;">Error: ${data.error}</div>`;
                                return;
                            }
                            renderPorts(data.ports || []);
                        })
                        .catch((e) => {
                            portsList.innerHTML = `<div style="color: #f85149; padding: 20px; text-align: center;">Error: ${e.message}</div>`;
                        });
                };

                refreshBtn.addEventListener('click', loadPorts);
                loadPorts(); // Initial load
            }
        });
    }

    spawnListenerManager() {
        const winId = this.wm.createWindow({
            title: 'Listener Manager',
            icon: 'radio-outline',
            width: '1200px',
            height: '800px',
            appId: 'listeners',
            headerButtons: `
                <button id="refresh-listeners-btn" class="header-action-btn" title="Refresh">
                    <ion-icon name="refresh-outline"></ion-icon>
                </button>
                <button id="create-listener-btn" class="header-action-btn" title="Create New Listener" style="background: #238636; border: 1px solid #238636; color: white; padding: 6px 12px; border-radius: 4px; margin-right: 8px; font-size: 12px; display: flex; align-items: center; gap: 6px;">
                    <ion-icon name="add-outline"></ion-icon>
                    New Listener
                </button>
            `,
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif;">
                    <!-- Header Stats -->
                    <div style="padding: 15px; border-bottom: 1px solid #30363d; background: #161b22;">
                        <div style="display: flex; gap: 20px; align-items: center; justify-content: space-between;">
                            <div style="display: flex; gap: 20px;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 13px; color: #8b949e;">Total:</span>
                                    <span id="listeners-total-count" style="font-size: 16px; font-weight: 600; color: #c9d1d9;">0</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 13px; color: #8b949e;">Running:</span>
                                    <span id="listeners-running-count" style="font-size: 16px; font-weight: 600; color: #3fb950;">0</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 13px; color: #8b949e;">Stopped:</span>
                                    <span id="listeners-stopped-count" style="font-size: 16px; font-weight: 600; color: #f85149;">0</span>
                                </div>
                            </div>
                            <div style="position: relative;">
                                <ion-icon name="search-outline" style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: #8b949e; font-size: 16px;"></ion-icon>
                                <input type="text" id="listener-search" placeholder="Search listeners..." style="width: 250px; padding: 6px 8px 6px 32px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">
                            </div>
                        </div>
                    </div>

                    <!-- Listeners Grid -->
                    <div id="listeners-grid" style="flex: 1; overflow-y: auto; padding: 20px; display: flex; align-items: center; justify-content: center;">
                        <div style="text-align: center; color: #8b949e; padding: 40px;">Loading listeners...</div>
                    </div>
                </div>

                <!-- Create Listener Modal -->
                <div id="create-listener-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 10000; justify-content: center; align-items: center;">
                    <style>
                        @keyframes spin {
                            from { transform: rotate(0deg); }
                            to { transform: rotate(360deg); }
                        }
                    </style>
                    <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; width: 500px; max-width: 90%; padding: 0; box-shadow: 0 8px 32px rgba(0,0,0,0.4);">
                        <div style="padding: 20px; border-bottom: 1px solid #30363d; display: flex; align-items: center; justify-content: space-between;">
                            <h3 style="margin: 0; font-size: 18px; color: #58a6ff;">Create New Listener</h3>
                            <button id="close-modal-btn" style="background: none; border: none; color: #8b949e; cursor: pointer; font-size: 20px; padding: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">&times;</button>
                        </div>
                        <div style="padding: 20px; display: flex; flex-direction: column; gap: 16px;">
                            <div>
                                <label style="display: block; margin-bottom: 8px; font-size: 13px; color: #8b949e; font-weight: 500;">Listener Module</label>
                                <select id="listener-type-select" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; cursor: pointer;">
                                    <option value="">Select a listener module...</option>
                                </select>
                                <div id="listener-description" style="font-size: 11px; color: #8b949e; margin-top: 6px; min-height: 16px;"></div>
                            </div>
                            <div id="listener-bind-host-container" style="display: none;">
                                <label style="display: block; margin-bottom: 8px; font-size: 13px; color: #8b949e; font-weight: 500;">Bind Host</label>
                                <input type="text" id="listener-host-input" value="0.0.0.0" placeholder="0.0.0.0" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; font-family: monospace;">
                                <div style="font-size: 11px; color: #8b949e; margin-top: 4px;">Use 0.0.0.0 to listen on all interfaces</div>
                            </div>
                            <div id="listener-bind-port-container" style="display: none;">
                                <label style="display: block; margin-bottom: 8px; font-size: 13px; color: #8b949e; font-weight: 500;">Bind Port</label>
                                <input type="number" id="listener-port-input" value="4444" min="1" max="65535" placeholder="4444" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none;">
                            </div>
                            <div id="listener-extra-options" style="display: none;">
                                <!-- Extra options can be added here dynamically based on listener type -->
                            </div>
                            <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 10px; padding-top: 16px; border-top: 1px solid #30363d;">
                                <button id="cancel-listener-btn" style="padding: 10px 20px; background: transparent; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; cursor: pointer; font-size: 13px; font-weight: 500;">Cancel</button>
                                <button id="create-listener-submit-btn" style="padding: 10px 20px; background: #238636; border: 1px solid #238636; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; font-weight: 500;">Create & Start</button>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const refreshBtn = document.querySelector(`#${wId} #refresh-listeners-btn`);
                const createBtn = document.querySelector(`#${wId} #create-listener-btn`);
                const listenersGrid = document.querySelector(`#${wId} #listeners-grid`);
                const searchInput = document.querySelector(`#${wId} #listener-search`);
                const totalCount = document.querySelector(`#${wId} #listeners-total-count`);
                const runningCount = document.querySelector(`#${wId} #listeners-running-count`);
                const stoppedCount = document.querySelector(`#${wId} #listeners-stopped-count`);
                
                // Modal elements
                const modal = document.querySelector(`#${wId} #create-listener-modal`);
                const closeModalBtn = document.querySelector(`#${wId} #close-modal-btn`);
                const cancelBtn = document.querySelector(`#${wId} #cancel-listener-btn`);
                const submitBtn = document.querySelector(`#${wId} #create-listener-submit-btn`);
                const typeSelect = document.querySelector(`#${wId} #listener-type-select`);
                const hostInput = document.querySelector(`#${wId} #listener-host-input`);
                const portInput = document.querySelector(`#${wId} #listener-port-input`);
                const listenerDescription = document.querySelector(`#${wId} #listener-description`);
                const extraOptionsContainer = document.querySelector(`#${wId} #listener-extra-options`);
                const bindHostContainer = document.querySelector(`#${wId} #listener-bind-host-container`);
                const bindPortContainer = document.querySelector(`#${wId} #listener-bind-port-container`);
                let listenerTypesCache = [];
                let currentListenerOptions = {};
                let currentListenerInfo = null;

                // Load listener-specific options
                const loadListenerOptions = async (modulePath) => {
                    if (!modulePath) {
                        // Hide everything
                        if (extraOptionsContainer) {
                            extraOptionsContainer.innerHTML = '';
                            extraOptionsContainer.style.display = 'none';
                        }
                        if (bindHostContainer) bindHostContainer.style.display = 'none';
                        if (bindPortContainer) bindPortContainer.style.display = 'none';
                        currentListenerOptions = {};
                        currentListenerInfo = null;
                        return;
                    }
                    
                    // Show loading state
                    if (extraOptionsContainer) {
                        extraOptionsContainer.innerHTML = '<div style="color: #8b949e; font-size: 12px; padding: 10px; text-align: center;">Loading options...</div>';
                        extraOptionsContainer.style.display = 'block';
                    }
                    
                    try {
                        // Use query parameter instead of path parameter to handle slashes in module path
                        const res = await fetch(`/api/listeners/info?module_path=${encodeURIComponent(modulePath)}`);
                        const data = await res.json();
                        
                        if (data.success) {
                            currentListenerInfo = data.info || {};
                            
                            // Check if listener needs bind host/port
                            // Listeners that need bind options:
                            // - Have handler type REVERSE (they listen for incoming connections)
                            // - Have lhost/lport or rhost/rport options
                            const handler = currentListenerInfo.handler || '';
                            const handlerStr = String(handler).toUpperCase();
                            const hasBindOptions = data.options && data.options.some(opt => ['lhost', 'lport', 'rhost', 'rport'].includes(opt.name));
                            const isReverseHandler = handlerStr === 'REVERSE' || handlerStr.includes('REVERSE');
                            
                            // Show bind options only for reverse listeners or if they have bind-specific options
                            const needsBindOptions = isReverseHandler || hasBindOptions;
                            
                            // Show/hide bind host and port based on listener type
                            if (bindHostContainer) {
                                bindHostContainer.style.display = needsBindOptions ? 'block' : 'none';
                            }
                            if (bindPortContainer) {
                                bindPortContainer.style.display = needsBindOptions ? 'block' : 'none';
                            }
                            
                            if (data.options && data.options.length > 0) {
                                currentListenerOptions = {};
                                if (extraOptionsContainer) {
                                    extraOptionsContainer.innerHTML = '';
                                    extraOptionsContainer.style.display = 'block';
                                    
                                    data.options.forEach(option => {
                                    const optionDiv = document.createElement('div');
                                    optionDiv.style.marginBottom = '16px';
                                    
                                    const label = document.createElement('label');
                                    label.style.display = 'block';
                                    label.style.marginBottom = '8px';
                                    label.style.fontSize = '13px';
                                    label.style.color = '#8b949e';
                                    label.style.fontWeight = '500';
                                    label.textContent = option.description || option.name;
                                    if (option.required) {
                                        label.innerHTML += ' <span style="color: #f85149;">*</span>';
                                    }
                                    optionDiv.appendChild(label);
                                    
                                    let input;
                                    if (option.type === 'OptInteger' || option.type === 'OptPort') {
                                        input = document.createElement('input');
                                        input.type = 'number';
                                        input.value = option.default || option.value || '';
                                        if (option.type === 'OptPort') {
                                            input.min = '1';
                                            input.max = '65535';
                                        }
                                    } else if (option.type === 'OptBool') {
                                        input = document.createElement('input');
                                        input.type = 'checkbox';
                                        input.checked = option.default || option.value || false;
                                    } else {
                                        input = document.createElement('input');
                                        input.type = 'text';
                                        input.value = option.default || option.value || '';
                                    }
                                    
                                    input.id = `listener-option-${option.name}`;
                                    input.dataset.optionName = option.name;
                                    input.style.width = '100%';
                                    input.style.padding = '10px';
                                    input.style.background = 'rgba(255,255,255,0.05)';
                                    input.style.border = '1px solid #30363d';
                                    input.style.borderRadius = '4px';
                                    input.style.color = '#c9d1d9';
                                    input.style.fontSize = '13px';
                                    input.style.outline = 'none';
                                    if (option.type === 'OptPort' || option.type === 'OptInteger') {
                                        input.style.fontFamily = 'monospace';
                                    }
                                    
                                    if (option.required) {
                                        input.required = true;
                                    }
                                    
                                    optionDiv.appendChild(input);
                                    extraOptionsContainer.appendChild(optionDiv);
                                    
                                    // Store option info
                                    currentListenerOptions[option.name] = {
                                        value: input.value,
                                        type: option.type,
                                        required: option.required
                                    };
                                    
                                    // Update on change
                                    input.addEventListener('input', () => {
                                        if (input.type === 'checkbox') {
                                            currentListenerOptions[option.name].value = input.checked;
                                        } else {
                                            currentListenerOptions[option.name].value = input.value;
                                        }
                                    });
                                    });
                                }
                            } else {
                                if (extraOptionsContainer) {
                                    extraOptionsContainer.innerHTML = '';
                                    extraOptionsContainer.style.display = 'none';
                                }
                                currentListenerOptions = {};
                            }
                        } else {
                            // On error, hide everything
                            if (extraOptionsContainer) {
                                extraOptionsContainer.innerHTML = '';
                                extraOptionsContainer.style.display = 'none';
                            }
                            if (bindHostContainer) bindHostContainer.style.display = 'none';
                            if (bindPortContainer) bindPortContainer.style.display = 'none';
                            currentListenerOptions = {};
                            currentListenerInfo = null;
                        }
                    } catch (e) {
                        console.error('Error loading listener options:', e);
                        if (extraOptionsContainer) {
                            extraOptionsContainer.innerHTML = `<div style="color: #f85149; font-size: 12px; padding: 10px; background: rgba(248, 81, 73, 0.1); border: 1px solid #f85149; border-radius: 4px;">Error loading options: ${e.message}</div>`;
                            extraOptionsContainer.style.display = 'block';
                        }
                        currentListenerOptions = {};
                    }
                };
                
                // Load available listener types from framework
                const loadListenerTypes = async () => {
                    try {
                        const res = await fetch('/api/listeners/types');
                        const data = await res.json();
                        listenerTypesCache = data.listeners || [];

                        if (!typeSelect) return;

                        // Clear existing options except the first placeholder
                        typeSelect.innerHTML = '<option value="">Select a listener module...</option>';

                        if (!listenerTypesCache.length) {
                            const option = document.createElement('option');
                            option.value = '';
                            option.textContent = 'No listeners available';
                            option.disabled = true;
                            typeSelect.appendChild(option);
                            return;
                        }

                        // Sort listeners by name and add simple options (no categories, no descriptions)
                        listenerTypesCache
                            .sort((a, b) => (a.display_name || a.path || '').localeCompare(b.display_name || b.path || ''))
                            .forEach(listener => {
                                const option = document.createElement('option');
                                option.value = listener.path;
                                // Use display_name if available, otherwise use path
                                option.textContent = listener.display_name || listener.path || 'Unknown';
                                option.dataset.description = listener.description || 'No description available';
                                typeSelect.appendChild(option);
                            });

                        // Add change event listener (only once)
                        if (!typeSelect.dataset.listenerAttached) {
                            typeSelect.dataset.listenerAttached = 'true';
                            typeSelect.addEventListener('change', async (e) => {
                                const selectedPath = e.target.value;
                                if (selectedPath) {
                                    const selectedOption = e.target.options[e.target.selectedIndex];
                                    listenerDescription.textContent = selectedOption.dataset.description || 'No description available';
                                    
                                    // Load listener-specific options
                                    await loadListenerOptions(selectedPath);
                                } else {
                                    listenerDescription.textContent = '';
                                    await loadListenerOptions('');
                                }
                            });
                        }
                    } catch (e) {
                        console.error('Error loading listener types:', e);
                        if (typeSelect) {
                            typeSelect.innerHTML = '<option value="">Error loading listeners</option>';
                        }
                    }
                };

                // Function to attach event listeners to listener action buttons
                const attachListenerButtonHandlers = () => {
                    // Use event delegation on the grid container (only attach once)
                    if (!listenersGrid.dataset.handlersAttached) {
                        listenersGrid.dataset.handlersAttached = 'true';
                        listenersGrid.addEventListener('click', (e) => {
                            const target = e.target.closest('.listener-stop-btn, .listener-start-btn, .listener-delete-btn');
                            if (!target) return;
                            
                            const listenerId = target.dataset.listenerId;
                            const winId = target.dataset.winId;
                            
                            if (target.classList.contains('listener-stop-btn')) {
                                if (window.os && window.os.toggleListener) {
                                    window.os.toggleListener(listenerId, 'stop', winId);
                                }
                            } else if (target.classList.contains('listener-start-btn')) {
                                if (window.os && window.os.toggleListener) {
                                    window.os.toggleListener(listenerId, 'start', winId);
                                }
                            } else if (target.classList.contains('listener-delete-btn')) {
                                const status = target.dataset.status || '';
                                if (window.os && window.os.deleteListener) {
                                    window.os.deleteListener(listenerId, winId, status);
                                }
                            }
                        });
                    }
                };
                
                const loadListeners = async () => {
                    try {
                        const res = await fetch('/api/listeners');
                        const data = await res.json();
                        const listeners = data.listeners || [];
                        
                        // Update counts
                        const running = listeners.filter(l => l.status === 'running').length;
                        const stopped = listeners.filter(l => l.status === 'stopped').length;
                        totalCount.textContent = listeners.length;
                        runningCount.textContent = running;
                        stoppedCount.textContent = stopped;

                        // Filter by search
                        const searchTerm = searchInput.value.toLowerCase();
                        const filtered = listeners.filter(l => {
                            if (!searchTerm) return true;
                            return l.type.toLowerCase().includes(searchTerm) ||
                                   l.port.toString().includes(searchTerm) ||
                                   l.host.toLowerCase().includes(searchTerm) ||
                                   l.id.toLowerCase().includes(searchTerm);
                        });

                        if (filtered.length === 0) {
                            // Change grid to flex for centering
                            listenersGrid.style.display = 'flex';
                            listenersGrid.style.alignItems = 'center';
                            listenersGrid.style.justifyContent = 'center';
                            listenersGrid.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 40px;">No listeners found. Create one to get started!</div>';
                            return;
                        }
                        
                        // Restore grid layout when there are listeners
                        listenersGrid.style.display = 'grid';
                        listenersGrid.style.gridTemplateColumns = 'repeat(auto-fill, 380px)';
                        listenersGrid.style.gap = '15px';
                        listenersGrid.style.justifyContent = 'start';
                        listenersGrid.style.alignContent = 'start';
                        listenersGrid.style.alignItems = 'start';
                        listenersGrid.style.gridAutoRows = 'max-content';

                        listenersGrid.innerHTML = filtered.map(listener => `
                            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px; display: flex; flex-direction: column; gap: 12px; transition: all 0.2s; width: 380px; max-width: 100%;">
                                <div style="display: flex; align-items: center; justify-content: space-between;">
                                    <div style="display: flex; align-items: center; gap: 10px;">
                                        <div style="width: 40px; height: 40px; background: ${listener.status === 'running' ? 'rgba(35, 134, 54, 0.2)' : 'rgba(248, 81, 73, 0.2)'}; border: 1px solid ${listener.status === 'running' ? '#238636' : '#f85149'}; border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                                            <ion-icon name="radio-outline" style="font-size: 20px; color: ${listener.status === 'running' ? '#3fb950' : '#f85149'};"></ion-icon>
                                        </div>
                                        <div>
                                            <div style="font-size: 14px; font-weight: 600; color: #c9d1d9;">${listener.type.toUpperCase()}</div>
                                            <div style="font-size: 12px; color: #8b949e;">${listener.host}:${listener.port}</div>
                                        </div>
                                    </div>
                                    <span style="padding: 4px 10px; background: ${listener.status === 'running' ? 'rgba(35, 134, 54, 0.2)' : 'rgba(248, 81, 73, 0.2)'}; border: 1px solid ${listener.status === 'running' ? '#238636' : '#f85149'}; border-radius: 4px; font-size: 11px; font-weight: 600; color: ${listener.status === 'running' ? '#3fb950' : '#f85149'};">
                                        ${listener.status === 'running' ? 'RUNNING' : 'STOPPED'}
                                    </span>
                                </div>
                                
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px;">
                                    <div>
                                        <div style="color: #8b949e; margin-bottom: 4px;">Type</div>
                                        <div style="color: #c9d1d9; font-weight: 500;">${listener.type.toUpperCase()}</div>
                                    </div>
                                    <div>
                                        <div style="color: #8b949e; margin-bottom: 4px;">Port</div>
                                        <div style="color: #c9d1d9; font-weight: 500; font-family: monospace;">${listener.port}</div>
                                    </div>
                                    <div>
                                        <div style="color: #8b949e; margin-bottom: 4px;">Host</div>
                                        <div style="color: #c9d1d9; font-weight: 500; font-family: monospace; font-size: 11px;">${listener.host}</div>
                                    </div>
                                    <div>
                                        <div style="color: #8b949e; margin-bottom: 4px;">ID</div>
                                        <div style="color: #8b949e; font-weight: 500; font-family: monospace; font-size: 10px;">${listener.id}</div>
                                    </div>
                                </div>

                                <div style="display: flex; gap: 8px; padding-top: 12px; border-top: 1px solid #30363d;">
                                    ${listener.status === 'running' 
                                        ? `<button class="listener-stop-btn" data-listener-id="${listener.id}" data-win-id="${wId}" style="flex: 1; padding: 8px; background: rgba(248, 81, 73, 0.1); border: 1px solid #f85149; border-radius: 4px; color: #f85149; cursor: pointer; font-size: 12px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px;">
                                            <ion-icon name="stop-outline"></ion-icon>
                                            Stop
                                        </button>`
                                        : `<button class="listener-start-btn" data-listener-id="${listener.id}" data-win-id="${wId}" style="flex: 1; padding: 8px; background: rgba(35, 134, 54, 0.1); border: 1px solid #238636; border-radius: 4px; color: #3fb950; cursor: pointer; font-size: 12px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px;">
                                            <ion-icon name="play-outline"></ion-icon>
                                            Start
                                        </button>`
                                    }
                                    ${listener.status === 'running'
                                        ? `<button title="Stop the listener before deleting" disabled style="padding: 8px 12px; background: rgba(248, 81, 73, 0.06); border: 1px solid rgba(248, 81, 73, 0.35); border-radius: 4px; color: rgba(248, 81, 73, 0.55); cursor: not-allowed; font-size: 12px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px; opacity: 0.8;">
                                            <ion-icon name="trash-outline"></ion-icon>
                                        </button>`
                                        : `<button class="listener-delete-btn" data-listener-id="${listener.id}" data-win-id="${wId}" data-status="${listener.status}" title="Delete listener" style="padding: 8px 12px; background: rgba(248, 81, 73, 0.1); border: 1px solid #f85149; border-radius: 4px; color: #f85149; cursor: pointer; font-size: 12px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px;">
                                            <ion-icon name="trash-outline"></ion-icon>
                                        </button>`
                                    }
                                </div>
                            </div>
                        `).join('');
                    } catch (e) {
                        listenersGrid.innerHTML = `<div style="text-align: center; color: #f85149; padding: 40px; grid-column: 1/-1;">Error loading listeners: ${e.message}</div>`;
                    }
                };

                // Modal handlers
                const openModal = () => {
                    modal.style.display = 'flex';
                    hostInput.value = '0.0.0.0';
                    portInput.value = '4444';
                    if (typeSelect) typeSelect.value = '';
                    if (listenerDescription) listenerDescription.textContent = '';
                    if (extraOptionsContainer) {
                        extraOptionsContainer.innerHTML = '';
                        extraOptionsContainer.style.display = 'none';
                    }
                    if (bindHostContainer) bindHostContainer.style.display = 'none';
                    if (bindPortContainer) bindPortContainer.style.display = 'none';
                    currentListenerOptions = {};
                    currentListenerInfo = null;
                };

                const closeModal = () => {
                    modal.style.display = 'none';
                };

                const createListener = async () => {
                    const module_path = typeSelect.value;
                    
                    if (!module_path) {
                        alert('Please select a listener module');
                        return;
                    }
                    
                    // Get host and port only if bind options are visible
                    const needsBindOptions = bindHostContainer && bindHostContainer.style.display !== 'none';
                    let host = '0.0.0.0';
                    let port = 4444;
                    
                    if (needsBindOptions) {
                        host = hostInput.value.trim();
                        port = parseInt(portInput.value);
                        
                        if (!host || !port || port < 1 || port > 65535) {
                            alert('Please enter valid host and port (1-65535)');
                            return;
                        }
                    }
                    
                    // Collect all options
                    const options = {};
                    Object.keys(currentListenerOptions).forEach(optionName => {
                        const optionInput = document.querySelector(`#${wId} #listener-option-${optionName}`);
                        if (optionInput) {
                            if (optionInput.type === 'checkbox') {
                                options[optionName] = optionInput.checked;
                            } else {
                                options[optionName] = optionInput.value;
                            }
                        }
                    });

                    // Show loading state
                    const originalBtnText = submitBtn.innerHTML;
                    submitBtn.disabled = true;
                    submitBtn.style.opacity = '0.6';
                    submitBtn.style.cursor = 'not-allowed';
                    submitBtn.innerHTML = '<div style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; margin-right: 6px;"></div> <span style="vertical-align: middle;">Creating...</span>';
                    
                    // Disable cancel button during creation
                    if (cancelBtn) {
                        cancelBtn.disabled = true;
                        cancelBtn.style.opacity = '0.6';
                        cancelBtn.style.cursor = 'not-allowed';
                    }

                    try {
                        const res = await fetch('/api/listeners/create', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ module_path, host, port, options })
                        });
                        const data = await res.json();
                        if (data.success) {
                            closeModal();
                            loadListeners();
                            os.showNotification('Listener created successfully!', 'success');
                        } else {
                            alert('Failed to create listener: ' + (data.error || 'Unknown error'));
                        }
                    } catch (e) {
                        alert('Error creating listener: ' + e.message);
                    } finally {
                        // Restore button state
                        submitBtn.disabled = false;
                        submitBtn.style.opacity = '1';
                        submitBtn.style.cursor = 'pointer';
                        submitBtn.innerHTML = originalBtnText;
                        
                        // Restore cancel button
                        if (cancelBtn) {
                            cancelBtn.disabled = false;
                            cancelBtn.style.opacity = '1';
                            cancelBtn.style.cursor = 'pointer';
                        }
                    }
                };

                // Event listeners
                refreshBtn.addEventListener('click', loadListeners);
                createBtn.addEventListener('click', () => {
                    openModal();
                    loadListenerTypes(); // Reload types when opening modal
                });
                closeModalBtn.addEventListener('click', closeModal);
                cancelBtn.addEventListener('click', closeModal);
                submitBtn.addEventListener('click', createListener);
                searchInput.addEventListener('input', loadListeners);

                // Close modal on outside click
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) closeModal();
                });

                // Attach event listeners for listener action buttons (using event delegation)
                attachListenerButtonHandlers();
                
                // Initial load
                loadListeners();
                loadListenerTypes(); // Load listener types on window open
                
                // Auto-refresh every 5 seconds
                const autoRefresh = setInterval(loadListeners, 5000);
                
                // Cleanup on window close
                const winElement = document.getElementById(wId);
                if (winElement) {
                    const observer = new MutationObserver(() => {
                        if (!document.body.contains(winElement)) {
                            clearInterval(autoRefresh);
                            observer.disconnect();
                        }
                    });
                    observer.observe(document.body, { childList: true, subtree: true });
                }
            }
        });
    }

    toggleListener(listenerId, action, winId) {
        fetch(`/api/listeners/${listenerId}/${action}`, { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    // Reload listeners in the window
                    const refreshBtn = document.querySelector(`#${winId} #refresh-listeners-btn`);
                    if (refreshBtn) refreshBtn.click();
                    os.showNotification(`Listener ${action === 'start' ? 'started' : 'stopped'} successfully!`, 'success');
                } else {
                    os.showNotification(`Failed to ${action} listener: ${data.error || 'Unknown error'}`, 'error');
                }
            })
            .catch(e => {
                os.showNotification(`Error: ${e.message}`, 'error');
            });
    }

    deleteListener(listenerId, winId, status = '') {
        if ((status || '').toLowerCase() === 'running') {
            os.showNotification('Stop the listener before deleting it.', 'warning');
            return;
        }
        if (!confirm('Are you sure you want to delete this listener?')) return;
        
        fetch(`/api/listeners/${listenerId}`, { method: 'DELETE' })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    const refreshBtn = document.querySelector(`#${winId} #refresh-listeners-btn`);
                    if (refreshBtn) refreshBtn.click();
                    os.showNotification('Listener deleted successfully!', 'success');
                } else {
                    os.showNotification(`Failed to delete listener: ${data.error || 'Unknown error'}`, 'error');
                }
            })
            .catch(e => {
                os.showNotification(`Error: ${e.message}`, 'error');
            });
    }

    spawnWorkflowManager() {
        const winId = this.wm.createWindow({
            title: 'Workflow Manager',
            icon: 'git-branch-outline',
            width: '1200px',
            height: '700px',
            headerButtons: `
                <button id="refresh-workflows-btn" class="header-action-btn" title="Refresh">
                    <ion-icon name="refresh-outline"></ion-icon>
                </button>
            `,
            content: `
                <div style="display: flex; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif;">
                    <!-- Left Sidebar: Workflows List -->
                    <div style="width: 300px; border-right: 1px solid #30363d; display: flex; flex-direction: column; background: #161b22;">
                            <div style="padding: 15px; border-bottom: 1px solid #30363d;">
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                                <h3 style="margin: 0; font-size: 16px; color: #58a6ff;">Workflows</h3>
                                <div style="display: flex; gap: 4px;">
                                    <button id="load-python-workflow-btn" style="background: #9c27b0; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; display: flex; align-items: center; gap: 4px;" title="Load Python Workflow">
                                        <ion-icon name="code-outline" style="font-size: 14px;"></ion-icon>
                                    </button>
                                    <button id="load-template-btn" style="background: #58a6ff; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; display: flex; align-items: center; gap: 4px;" title="Load Template">
                                        <ion-icon name="document-text-outline" style="font-size: 14px;"></ion-icon>
                                    </button>
                                    <button id="new-workflow-btn" style="background: #238636; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 4px;">
                                        <ion-icon name="add-outline" style="font-size: 16px;"></ion-icon>
                                        New
                                    </button>
                                </div>
                            </div>
                            <div style="position: relative;">
                                <ion-icon name="search-outline" style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: #8b949e; font-size: 16px;"></ion-icon>
                                <input type="text" id="workflow-search" placeholder="Search workflows..." style="width: 100%; padding: 6px 8px 6px 32px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">
                            </div>
                        </div>
                        <div id="workflows-list" style="flex: 1; overflow-y: auto; padding: 10px;">
                            <div style="text-align: center; color: #8b949e; padding: 20px;">Loading workflows...</div>
                        </div>
                    </div>

                    <!-- Right Panel: Visual Workflow Editor -->
                    <div style="flex: 1; display: flex; flex-direction: column; background: #0d1117;">
                        <div id="no-workflow-selected" style="flex: 1; display: flex; align-items: center; justify-content: center; color: #8b949e;">
                            <div style="text-align: center;">
                                <ion-icon name="git-branch-outline" style="font-size: 64px; color: #30363d; margin-bottom: 16px;"></ion-icon>
                                <div style="font-size: 16px; margin-bottom: 8px;">No workflow selected</div>
                                <div style="font-size: 13px;">Select a workflow from the list or create a new one</div>
                            </div>
                        </div>

                        <div id="workflow-editor-content" style="display: none; flex: 1; flex-direction: column; height: 100%;">
                            <!-- Toolbar -->
                            <div style="padding: 12px; border-bottom: 1px solid #30363d; background: #161b22; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                                <input type="text" id="workflow-name" placeholder="Workflow Name" style="flex: 1; min-width: 200px; padding: 8px 12px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none;">
                                <select id="workflow-trigger" style="padding: 8px 12px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">
                                    <option value="manual">Manual Trigger</option>
                                    <option value="new_session">On New Session</option>
                                    <option value="platform:windows">On Windows Session</option>
                                    <option value="platform:linux">On Linux Session</option>
                                </select>
                                <button id="export-python-btn" style="background: #9c27b0; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;" title="Export to Python">
                                    <ion-icon name="code-outline" style="margin-right: 4px;"></ion-icon>Export Python
                                </button>
                                <button id="validate-workflow-btn" style="background: #ffa726; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;" title="Validate Workflow">
                                    <ion-icon name="checkmark-circle-outline" style="margin-right: 4px;"></ion-icon>Validate
                                </button>
                                <button id="save-workflow-btn" style="background: #238636; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;">
                                    <ion-icon name="save-outline" style="margin-right: 4px;"></ion-icon>Save
                                </button>
                                <button id="execute-workflow-btn" style="background: #58a6ff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;">
                                    <ion-icon name="play-outline" style="margin-right: 4px;"></ion-icon>Execute
                                </button>
                                <button id="delete-workflow-btn" style="background: #da3633; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;">
                                    <ion-icon name="trash-outline" style="margin-right: 4px;"></ion-icon>Delete
                                </button>
                            </div>
                            
                            <!-- Execution Status Bar -->
                            <div id="workflow-execution-status" style="display: none; padding: 8px 12px; background: rgba(88, 166, 255, 0.1); border-bottom: 1px solid #30363d; color: #58a6ff; font-size: 12px;">
                                <div style="display: flex; align-items: center; justify-content: space-between;">
                                    <div>
                                        <ion-icon name="hourglass-outline" style="margin-right: 6px;"></ion-icon>
                                        <span id="execution-status-text">Executing workflow...</span>
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 12px;">
                                        <div id="execution-progress" style="font-size: 11px; color: #8b949e;">Step 0/0</div>
                                        <button id="cancel-execution-btn" style="background: #da3633; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;">Cancel</button>
                                    </div>
                                </div>
                                <div id="execution-progress-bar" style="margin-top: 8px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                                    <div id="execution-progress-fill" style="height: 100%; background: #58a6ff; width: 0%; transition: width 0.3s;"></div>
                                </div>
                            </div>

                            <!-- Main Editor Area -->
                            <div style="flex: 1; display: flex; overflow: hidden;">
                                <!-- Node Palette (Left) -->
                                <div style="width: 220px; border-right: 1px solid #30363d; background: #161b22; padding: 12px; overflow-y: auto; display: flex; flex-direction: column;">
                                    <div style="margin-bottom: 12px;">
                                        <h4 style="margin: 0 0 8px 0; font-size: 13px; color: #58a6ff;">Node Palette</h4>
                                        <input type="text" id="module-search-input" placeholder="Search modules..." style="width: 100%; padding: 6px 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px; outline: none;">
                                    </div>
                                    <div id="node-palette" style="flex: 1; overflow-y: auto;">
                                        <div style="margin-bottom: 8px;">
                                            <div style="font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Control Flow</div>
                                            <div class="palette-node" draggable="true" data-node-type="start" style="padding: 8px; margin-bottom: 6px; background: rgba(255, 123, 114, 0.1); border: 1px solid #ff7b72; border-radius: 4px; cursor: grab; user-select: none;">
                                                <div style="font-size: 11px; font-weight: 600; color: #ff7b72; margin-bottom: 2px;">Start</div>
                                                <div style="font-size: 10px; color: #8b949e;">Entry point</div>
                                            </div>
                                            <div class="palette-node" draggable="true" data-node-type="condition" style="padding: 8px; margin-bottom: 6px; background: rgba(63, 185, 80, 0.1); border: 1px solid #3fb950; border-radius: 4px; cursor: grab; user-select: none;">
                                                <div style="font-size: 11px; font-weight: 600; color: #3fb950; margin-bottom: 2px;">Condition</div>
                                                <div style="font-size: 10px; color: #8b949e;">Branch logic</div>
                                            </div>
                                            <div class="palette-node" draggable="true" data-node-type="delay" style="padding: 8px; margin-bottom: 6px; background: rgba(255, 167, 38, 0.1); border: 1px solid #ffa726; border-radius: 4px; cursor: grab; user-select: none;">
                                                <div style="font-size: 11px; font-weight: 600; color: #ffa726; margin-bottom: 2px;">Delay</div>
                                                <div style="font-size: 10px; color: #8b949e;">Wait time</div>
                                            </div>
                                            <div class="palette-node" draggable="true" data-node-type="loop" style="padding: 8px; margin-bottom: 6px; background: rgba(156, 39, 176, 0.1); border: 1px solid #9c27b0; border-radius: 4px; cursor: grab; user-select: none;">
                                                <div style="font-size: 11px; font-weight: 600; color: #9c27b0; margin-bottom: 2px;">Loop</div>
                                                <div style="font-size: 10px; color: #8b949e;">Repeat steps</div>
                                            </div>
                                        </div>
                                        <div style="margin-bottom: 8px;">
                                            <div style="font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Actions</div>
                                            <div class="palette-node" draggable="true" data-node-type="module" style="padding: 8px; margin-bottom: 6px; background: rgba(88, 166, 255, 0.1); border: 1px solid #58a6ff; border-radius: 4px; cursor: grab; user-select: none;">
                                                <div style="font-size: 11px; font-weight: 600; color: #58a6ff; margin-bottom: 2px;">Module</div>
                                                <div style="font-size: 10px; color: #8b949e;">Execute module</div>
                                            </div>
                                            <div class="palette-node" draggable="true" data-node-type="variable" style="padding: 8px; margin-bottom: 6px; background: rgba(236, 64, 122, 0.1); border: 1px solid #ec407a; border-radius: 4px; cursor: grab; user-select: none;">
                                                <div style="font-size: 11px; font-weight: 600; color: #ec407a; margin-bottom: 2px;">Variable</div>
                                                <div style="font-size: 10px; color: #8b949e;">Set variable</div>
                                            </div>
                                        </div>
                                        <div id="module-search-results" style="display: none;">
                                            <div style="font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Search Results</div>
                                            <div id="module-results-list"></div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Graph Canvas (Center) -->
                                <div style="flex: 1; position: relative; background: #0d1117;">
                                    <div id="workflow-canvas" style="width: 100%; height: 100%;"></div>
                                </div>

                                <!-- Properties Panel (Right) -->
                                <div id="properties-panel" style="width: 300px; border-left: 1px solid #30363d; background: #161b22; padding: 12px; overflow-y: auto; display: none;">
                                    <h4 style="margin: 0 0 12px 0; font-size: 13px; color: #58a6ff;">Node Properties</h4>
                                    <div id="node-properties-form">
                                        <!-- Properties will be dynamically generated -->
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const workflowsList = document.querySelector(`#${wId} #workflows-list`);
                const workflowEditor = document.querySelector(`#${wId} #workflow-editor-content`);
                const noWorkflowSelected = document.querySelector(`#${wId} #no-workflow-selected`);
                const newWorkflowBtn = document.querySelector(`#${wId} #new-workflow-btn`);
                const refreshBtn = document.querySelector(`#${wId} #refresh-workflows-btn`);
                const saveBtn = document.querySelector(`#${wId} #save-workflow-btn`);
                const executeBtn = document.querySelector(`#${wId} #execute-workflow-btn`);
                const deleteBtn = document.querySelector(`#${wId} #delete-workflow-btn`);
                const workflowSearch = document.querySelector(`#${wId} #workflow-search`);
                const canvas = document.querySelector(`#${wId} #workflow-canvas`);
                const propertiesPanel = document.querySelector(`#${wId} #properties-panel`);
                const nodePropertiesForm = document.querySelector(`#${wId} #node-properties-form`);

                let currentWorkflowId = null;
                let workflows = [];
                let network = null;
                let nodes = new vis.DataSet([]);
                let edges = new vis.DataSet([]);
                let selectedNodeId = null;
                let nodeCounter = 0;

                const loadWorkflows = async () => {
                    try {
                        const res = await fetch('/api/workflows');
                        const data = await res.json();
                        workflows = data.workflows || [];
                        renderWorkflowsList();
                    } catch (err) {
                        console.error('Error loading workflows:', err);
                        workflowsList.innerHTML = '<div style="color: #f85149; padding: 20px; text-align: center;">Error loading workflows</div>';
                    }
                };

                const renderWorkflowsList = () => {
                    const searchTerm = workflowSearch.value.toLowerCase();
                    const filtered = workflows.filter(wf => 
                        wf.name.toLowerCase().includes(searchTerm)
                    );

                    if (filtered.length === 0) {
                        workflowsList.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 20px;">No workflows found</div>';
                        return;
                    }

                    workflowsList.innerHTML = filtered.map(wf => `
                        <div class="workflow-item" data-workflow-id="${wf.id}" style="padding: 12px; margin-bottom: 8px; background: ${currentWorkflowId === wf.id ? 'rgba(88, 166, 255, 0.1)' : 'rgba(255,255,255,0.03)'}; border: 1px solid ${currentWorkflowId === wf.id ? '#58a6ff' : '#30363d'}; border-radius: 6px; cursor: pointer; transition: all 0.2s;">
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                                <div style="font-weight: 600; font-size: 13px; color: #c9d1d9;">${wf.name}</div>
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 11px; color: #8b949e; background: rgba(88, 166, 255, 0.1); padding: 2px 6px; border-radius: 3px;">${wf.executions || 0} runs</span>
                                    <span style="width: 8px; height: 8px; border-radius: 50%; background: ${wf.enabled ? '#3fb950' : '#8b949e'};"></span>
                                </div>
                            </div>
                            <div style="font-size: 11px; color: #8b949e; margin-bottom: 4px;">${wf.trigger || 'manual'}</div>
                            <div style="font-size: 11px; color: #8b949e;">${(wf.steps || []).length} steps</div>
                        </div>
                    `).join('');

                    // Add click handlers
                    document.querySelectorAll(`#${wId} .workflow-item`).forEach(item => {
                        item.addEventListener('click', () => {
                            const workflowId = item.dataset.workflowId;
                            selectWorkflow(workflowId);
                        });
                    });
                };

                const initNetwork = () => {
                    if (network) {
                        network.destroy();
                    }
                    
                    const data = { nodes: nodes, edges: edges };
                    const options = {
                        nodes: {
                            shape: 'box',
                            font: { color: '#c9d1d9', size: 14, face: 'Segoe UI' },
                            borderWidth: 2,
                            shadow: { enabled: true, size: 5, x: 2, y: 2 },
                            margin: 10,
                            widthConstraint: { maximum: 200 },
                            heightConstraint: { minimum: 40 }
                        },
                        edges: {
                            arrows: { to: { enabled: true, scaleFactor: 0.8, type: 'arrow' } },
                            color: { color: '#58a6ff', highlight: '#76e3ea', hover: '#76e3ea' },
                            width: 2,
                            smooth: { type: 'cubicBezier', roundness: 0.4 },
                            selectionWidth: 3
                        },
                        physics: {
                            enabled: true,
                            stabilization: { iterations: 200 },
                            barnesHut: {
                                gravitationalConstant: -2000,
                                centralGravity: 0.1,
                                springLength: 150,
                                springConstant: 0.04,
                                damping: 0.09
                            }
                        },
                        interaction: {
                            dragNodes: true,
                            dragView: true,
                            zoomView: true,
                            selectConnectedEdges: true,
                            hover: true,
                            tooltipDelay: 200
                        }
                    };

                    network = new vis.Network(canvas, data, options);

                    // Handle node selection
                    network.on('selectNode', (params) => {
                        if (params.nodes.length > 0) {
                            selectedNodeId = params.nodes[0];
                            showNodeProperties(selectedNodeId);
                        }
                    });

                    // Handle node deselection
                    network.on('deselectNode', () => {
                        selectedNodeId = null;
                        propertiesPanel.style.display = 'none';
                    });

                    // Handle edge deletion
                    network.on('selectEdge', (params) => {
                        if (params.edges.length > 0 && params.event.ctrlKey) {
                            if (confirm('Delete this connection?')) {
                                edges.remove(params.edges);
                            }
                        }
                    });

                    // Handle edge creation (drag from node to node)
                    network.on('oncontext', (params) => {
                        params.event.preventDefault();
                    });
                };

                const showNodeProperties = (nodeId) => {
                    const node = nodes.get(nodeId);
                    if (!node) return;

                    propertiesPanel.style.display = 'block';
                    
                    let formHTML = '';
                    
                    if (node.type === 'module') {
                        formHTML = `
                            <div style="margin-bottom: 12px;">
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px;">Module Path</label>
                                <input type="text" id="node-module-path" value="${node.module || ''}" placeholder="e.g., enumerate/host" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">
                            </div>
                            <div style="margin-bottom: 12px;">
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px;">Options (JSON)</label>
                                <textarea id="node-module-options" placeholder='{"option": "value"}' style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none; min-height: 80px; font-family: monospace;">${node.options ? JSON.stringify(node.options, null, 2) : ''}</textarea>
                            </div>
                            <div style="margin-bottom: 12px;">
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px;">Condition</label>
                                <input type="text" id="node-condition" value="${node.condition || ''}" placeholder="Optional condition" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">
                            </div>
                        `;
                    } else if (node.type === 'condition') {
                        formHTML = `
                            <div style="margin-bottom: 12px;">
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px;">Condition Expression</label>
                                <textarea id="node-condition-expr" placeholder="e.g., user != SYSTEM" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none; min-height: 60px; font-family: monospace;">${node.expression || ''}</textarea>
                            </div>
                            <div style="margin-bottom: 12px;">
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px;">True Label</label>
                                <input type="text" id="node-true-label" value="${node.trueLabel || 'True'}" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">
                            </div>
                            <div style="margin-bottom: 12px;">
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px;">False Label</label>
                                <input type="text" id="node-false-label" value="${node.falseLabel || 'False'}" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">
                            </div>
                        `;
                    } else if (node.type === 'start') {
                        formHTML = `
                            <div style="margin-bottom: 12px;">
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px;">Start Node</label>
                                <div style="padding: 8px; background: rgba(88, 166, 255, 0.1); border: 1px solid #58a6ff; border-radius: 4px; color: #58a6ff; font-size: 12px;">
                                    This is the entry point of the workflow
                                </div>
                            </div>
                        `;
                    } else if (node.type === 'delay') {
                        formHTML = `
                            <div style="margin-bottom: 12px;">
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px;">Delay (seconds)</label>
                                <input type="number" id="node-delay-seconds" value="${node.delay || 1}" min="0" step="0.1" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">
                            </div>
                        `;
                    } else if (node.type === 'loop') {
                        formHTML = `
                            <div style="margin-bottom: 12px;">
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px;">Iterations</label>
                                <input type="number" id="node-loop-iterations" value="${node.iterations || 1}" min="1" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">
                            </div>
                            <div style="margin-bottom: 12px;">
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px;">Loop Variable</label>
                                <input type="text" id="node-loop-variable" value="${node.loopVariable || 'i'}" placeholder="Variable name" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">
                            </div>
                        `;
                    } else if (node.type === 'variable') {
                        formHTML = `
                            <div style="margin-bottom: 12px;">
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px;">Variable Name</label>
                                <input type="text" id="node-variable-name" value="${node.variableName || ''}" placeholder="e.g., target_ip" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">
                            </div>
                            <div style="margin-bottom: 12px;">
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px;">Variable Value</label>
                                <textarea id="node-variable-value" placeholder="Value or expression" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none; min-height: 60px; font-family: monospace;">${node.variableValue || ''}</textarea>
                            </div>
                        `;
                    }

                    formHTML += `
                        <div style="margin-top: 16px;">
                            <button id="update-node-btn" style="width: 100%; background: #238636; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;">
                                Update Node
                            </button>
                            <button id="delete-node-btn" style="width: 100%; margin-top: 8px; background: #da3633; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;">
                                Delete Node
                            </button>
                        </div>
                    `;

                    nodePropertiesForm.innerHTML = formHTML;

                    // Add event listeners
                    const updateBtn = document.querySelector(`#${wId} #update-node-btn`);
                    const deleteBtn = document.querySelector(`#${wId} #delete-node-btn`);
                    
                    if (updateBtn) {
                        updateBtn.addEventListener('click', () => updateNode(nodeId));
                    }
                    if (deleteBtn) {
                        deleteBtn.addEventListener('click', () => deleteNode(nodeId, { confirmDelete: true }));
                    }
                };

                const updateNode = (nodeId) => {
                    const node = nodes.get(nodeId);
                    if (!node) return;

                    if (node.type === 'module') {
                        const modulePath = document.querySelector(`#${wId} #node-module-path`).value;
                        const optionsText = document.querySelector(`#${wId} #node-module-options`).value;
                        const condition = document.querySelector(`#${wId} #node-condition`).value;

                        let options = {};
                        if (optionsText.trim()) {
                            try {
                                options = JSON.parse(optionsText);
                            } catch (e) {
                                alert('Invalid JSON in options');
                                return;
                            }
                        }

                        nodes.update({
                            id: nodeId,
                            module: modulePath,
                            options: options,
                            condition: condition || null,
                            label: modulePath || 'Module'
                        });
                    } else if (node.type === 'condition') {
                        const expression = document.querySelector(`#${wId} #node-condition-expr`).value;
                        const trueLabel = document.querySelector(`#${wId} #node-true-label`).value;
                        const falseLabel = document.querySelector(`#${wId} #node-false-label`).value;

                        nodes.update({
                            id: nodeId,
                            expression: expression,
                            trueLabel: trueLabel,
                            falseLabel: falseLabel,
                            label: `Condition: ${expression || '...'}`
                        });
                    } else if (node.type === 'delay') {
                        const delay = parseFloat(document.querySelector(`#${wId} #node-delay-seconds`).value) || 1;
                        nodes.update({
                            id: nodeId,
                            delay: delay,
                            label: `Delay: ${delay}s`
                        });
                    } else if (node.type === 'loop') {
                        const iterations = parseInt(document.querySelector(`#${wId} #node-loop-iterations`).value) || 1;
                        const loopVariable = document.querySelector(`#${wId} #node-loop-variable`).value || 'i';
                        nodes.update({
                            id: nodeId,
                            iterations: iterations,
                            loopVariable: loopVariable,
                            label: `Loop: ${iterations} iterations`
                        });
                    } else if (node.type === 'variable') {
                        const variableName = document.querySelector(`#${wId} #node-variable-name`).value;
                        const variableValue = document.querySelector(`#${wId} #node-variable-value`).value;
                        nodes.update({
                            id: nodeId,
                            variableName: variableName,
                            variableValue: variableValue,
                            label: `Set: ${variableName || 'variable'}`
                        });
                    }
                };

                const deleteNode = (nodeId, opts = {}) => {
                    const { confirmDelete = true } = opts || {};
                    const node = nodes.get(nodeId);
                    if (!node) return;

                    // Keep workflows valid: don't allow deleting the entrypoint.
                    if (node.type === 'start') {
                        if (this && typeof this.showNotification === 'function') {
                            this.showNotification('Start node cannot be deleted', 'warning', 2500);
                        } else {
                            alert('Start node cannot be deleted');
                        }
                        return;
                    }

                    if (confirmDelete && !confirm('Delete this node?')) return;
                    
                    // Remove connected edges
                    const connectedEdges = edges.get().filter(e => 
                        e.from === nodeId || e.to === nodeId
                    );
                    edges.remove(connectedEdges.map(e => e.id));
                    
                    // Remove node
                    nodes.remove(nodeId);
                    propertiesPanel.style.display = 'none';
                    selectedNodeId = null;
                };

                // Keyboard shortcuts (Delete = delete selected node without prompt)
                // Bind to the canvas so we don't interfere when typing in inputs.
                if (canvas) {
                    canvas.setAttribute('tabindex', '0');
                    canvas.addEventListener('mousedown', () => {
                        try { canvas.focus(); } catch (e) {}
                    });

                    canvas.addEventListener('keydown', (e) => {
                        // Don't hijack keys while typing in fields
                        const active = document.activeElement;
                        const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
                        if (isTyping) return;

                        if (e.key === 'Delete' && selectedNodeId) {
                            e.preventDefault();
                            e.stopPropagation();
                            deleteNode(selectedNodeId, { confirmDelete: false });
                        }
                    });
                }

                const addNodeFromPalette = (type, position) => {
                    nodeCounter++;
                    const nodeId = `node_${nodeCounter}`;
                    
                    let node = {
                        id: nodeId,
                        type: type,
                        label: type.charAt(0).toUpperCase() + type.slice(1),
                        x: position.x,
                        y: position.y
                    };

                    if (type === 'module') {
                        node.module = '';
                        node.options = {};
                        node.color = { border: '#58a6ff', background: '#161b22' };
                    } else if (type === 'condition') {
                        node.expression = '';
                        node.trueLabel = 'True';
                        node.falseLabel = 'False';
                        node.color = { border: '#3fb950', background: '#161b22' };
                    } else if (type === 'start') {
                        node.color = { border: '#ff7b72', background: '#161b22' };
                    } else if (type === 'delay') {
                        node.delay = 1;
                        node.color = { border: '#ffa726', background: '#161b22' };
                    } else if (type === 'loop') {
                        node.iterations = 1;
                        node.loopVariable = 'i';
                        node.color = { border: '#9c27b0', background: '#161b22' };
                    } else if (type === 'variable') {
                        node.variableName = '';
                        node.variableValue = '';
                        node.color = { border: '#ec407a', background: '#161b22' };
                    }

                    nodes.add(node);
                    return nodeId;
                };

                const selectWorkflow = (workflowId) => {
                    currentWorkflowId = workflowId;
                    const workflow = workflows.find(wf => wf.id === workflowId);
                    if (!workflow) return;

                    noWorkflowSelected.style.display = 'none';
                    workflowEditor.style.display = 'flex';

                    // Populate editor
                    document.querySelector(`#${wId} #workflow-name`).value = workflow.name || '';
                    const triggerSelect = document.querySelector(`#${wId} #workflow-trigger`);
                    if (triggerSelect) {
                        triggerSelect.value = workflow.trigger || 'manual';
                    }

                    // Initialize network if not already done
                    if (!network) {
                        initNetwork();
                        // Setup drag and drop and edge creation after network is ready
                        setTimeout(() => {
                            setupDragAndDrop();
                            setupEdgeCreation();
                        }, 100);
                    }

                    // Load workflow graph
                    loadWorkflowGraph(workflow);

                    // Re-render list to highlight selected
                    renderWorkflowsList();
                };

                const loadWorkflowGraph = (workflow) => {
                    nodes.clear();
                    edges.clear();
                    nodeCounter = 0;

                    // Convert workflow steps to nodes and edges
                    if (workflow.nodes && workflow.nodes.length > 0) {
                        // Load from graph format
                        workflow.nodes.forEach(node => {
                            nodes.add(node);
                            nodeCounter = Math.max(nodeCounter, parseInt(node.id.split('_')[1]) || 0);
                        });
                        if (workflow.edges) {
                            edges.add(workflow.edges);
                        }
                    } else if (workflow.steps && workflow.steps.length > 0) {
                        // Convert from old step format
                        let prevNodeId = null;
                        workflow.steps.forEach((step, index) => {
                            const nodeId = `node_${index + 1}`;
                            nodeCounter = index + 1;
                            
                            const node = {
                                id: nodeId,
                                type: 'module',
                                label: step.module || `Step ${index + 1}`,
                                module: step.module || '',
                                options: step.options || {},
                                condition: step.condition || null,
                                x: 100 + (index % 3) * 200,
                                y: 100 + Math.floor(index / 3) * 150,
                                color: { border: '#58a6ff', background: '#161b22' }
                            };
                            nodes.add(node);

                            if (prevNodeId) {
                                edges.add({
                                    id: `edge_${prevNodeId}_${nodeId}`,
                                    from: prevNodeId,
                                    to: nodeId
                                });
                            }
                            prevNodeId = nodeId;
                        });
                    } else {
                        // Add start node for new workflow
                        const startNodeId = addNodeFromPalette('start', { x: 100, y: 100 });
                    }
                };

                // Setup drag and drop from palette
                const setupDragAndDrop = () => {
                    const paletteNodes = document.querySelectorAll(`#${wId} .palette-node`);
                    paletteNodes.forEach(paletteNode => {
                        paletteNode.addEventListener('dragstart', (e) => {
                            e.dataTransfer.setData('nodeType', paletteNode.dataset.nodeType);
                        });
                    });

                    canvas.addEventListener('dragover', (e) => {
                        e.preventDefault();
                    });

                    canvas.addEventListener('drop', (e) => {
                        e.preventDefault();
                        const nodeType = e.dataTransfer.getData('nodeType');
                        if (!nodeType || !network) return;

                        const rect = canvas.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const y = e.clientY - rect.top;
                        
                        // Convert screen coordinates to network coordinates
                        const scale = network.getScale();
                        const viewPos = network.getViewPosition();
                        const canvasCenter = { x: rect.width / 2, y: rect.height / 2 };
                        
                        // Calculate network coordinates
                        const networkX = (x - canvasCenter.x - viewPos.x) / scale;
                        const networkY = (y - canvasCenter.y - viewPos.y) / scale;

                        addNodeFromPalette(nodeType, { x: networkX, y: networkY });
                    });
                };

                const saveWorkflow = async () => {
                    if (!currentWorkflowId) return;

                    const workflow = workflows.find(wf => wf.id === currentWorkflowId);
                    if (!workflow) return;

                    workflow.name = document.querySelector(`#${wId} #workflow-name`).value;
                    const triggerSelect = document.querySelector(`#${wId} #workflow-trigger`);
                    if (triggerSelect) {
                        workflow.trigger = triggerSelect.value;
                    }
                    
                    // Save graph structure
                    workflow.nodes = nodes.get();
                    workflow.edges = edges.get();

                    // Also convert to steps format for backward compatibility
                    const nodeList = nodes.get();
                    const edgeList = edges.get();
                    const steps = [];
                    
                    // Find start node
                    const startNode = nodeList.find(n => n.type === 'start');
                    if (startNode) {
                        const visited = new Set();
                        const processNode = (nodeId) => {
                            if (visited.has(nodeId)) return;
                            visited.add(nodeId);
                            
                            const node = nodeList.find(n => n.id === nodeId);
                            if (!node || node.type === 'start') {
                                // Process outgoing edges
                                const outgoing = edgeList.filter(e => e.from === nodeId);
                                outgoing.forEach(edge => {
                                    processNode(edge.to);
                                });
                            } else if (node.type === 'module') {
                                steps.push({
                                    action: 'module',
                                    module: node.module || '',
                                    options: node.options || {},
                                    condition: node.condition || null
                                });
                                
                                // Process outgoing edges
                                const outgoing = edgeList.filter(e => e.from === nodeId);
                                outgoing.forEach(edge => {
                                    processNode(edge.to);
                                });
                            }
                        };
                        
                        if (startNode) {
                            processNode(startNode.id);
                        }
                    }
                    
                    workflow.steps = steps;

                    try {
                        const res = await fetch(`/api/workflows/${currentWorkflowId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(workflow)
                        });

                        if (res.ok) {
                            alert('Workflow saved successfully!');
                            loadWorkflows();
                        } else {
                            alert('Error saving workflow');
                        }
                    } catch (err) {
                        console.error('Error saving workflow:', err);
                        alert('Error saving workflow');
                    }
                };

                const executeWorkflow = async () => {
                    if (!currentWorkflowId) return;

                    if (!confirm('Execute this workflow?')) return;

                    try {
                        const res = await fetch(`/api/workflows/${currentWorkflowId}/execute`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({})
                        });

                        if (res.ok) {
                            alert('Workflow execution started!');
                        } else {
                            alert('Error executing workflow');
                        }
                    } catch (err) {
                        console.error('Error executing workflow:', err);
                        alert('Error executing workflow');
                    }
                };

                const deleteWorkflow = async () => {
                    if (!currentWorkflowId) return;

                    if (!confirm('Are you sure you want to delete this workflow?')) return;

                    try {
                        const res = await fetch(`/api/workflows/${currentWorkflowId}`, {
                            method: 'DELETE'
                        });

                        if (res.ok) {
                            currentWorkflowId = null;
                            noWorkflowSelected.style.display = 'flex';
                            workflowEditor.style.display = 'none';
                            loadWorkflows();
                        } else {
                            alert('Error deleting workflow');
                        }
                    } catch (err) {
                        console.error('Error deleting workflow:', err);
                        alert('Error deleting workflow');
                    }
                };

                const createNewWorkflow = async () => {
                    const name = prompt('Enter workflow name:');
                    if (!name) return;

                    try {
                        const res = await fetch('/api/workflows/create', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                name: name,
                                trigger: 'manual',
                                steps: []
                            })
                        });

                        if (res.ok) {
                            const data = await res.json();
                            await loadWorkflows();
                            selectWorkflow(data.workflow_id);
                        } else {
                            alert('Error creating workflow');
                        }
                    } catch (err) {
                        console.error('Error creating workflow:', err);
                        alert('Error creating workflow');
                    }
                };

                // Setup edge creation (connect nodes)
                let connectingFrom = null;
                let connectMode = false;
                
                const setupEdgeCreation = () => {
                    // Use Ctrl+click or dedicated connect mode
                    network.on('click', (params) => {
                        if (params.nodes.length > 0 && (params.event.ctrlKey || connectMode)) {
                            const nodeId = params.nodes[0];
                            if (connectingFrom) {
                                if (connectingFrom !== nodeId) {
                                    // Check if edge already exists
                                    const existing = edges.get().find(e => 
                                        e.from === connectingFrom && e.to === nodeId
                                    );
                                    if (!existing) {
                                        edges.add({
                                            id: `edge_${connectingFrom}_${nodeId}`,
                                            from: connectingFrom,
                                            to: nodeId
                                        });
                                    }
                                }
                                connectingFrom = null;
                                connectMode = false;
                                updateConnectButton();
                            } else {
                                connectingFrom = nodeId;
                                updateConnectButton();
                            }
                        } else if (connectingFrom && !params.nodes.length) {
                            connectingFrom = null;
                            connectMode = false;
                            updateConnectButton();
                        }
                    });

                    // Add connect button to toolbar
                    const connectBtn = document.createElement('button');
                    connectBtn.id = 'connect-nodes-btn';
                    connectBtn.innerHTML = '<ion-icon name="link-outline" style="margin-right: 4px;"></ion-icon>Connect';
                    connectBtn.style.cssText = 'background: #58a6ff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;';
                    connectBtn.addEventListener('click', () => {
                        if (selectedNodeId) {
                            if (connectingFrom === selectedNodeId) {
                                connectingFrom = null;
                                connectMode = false;
                            } else {
                                connectingFrom = selectedNodeId;
                                connectMode = true;
                            }
                            updateConnectButton();
                        } else {
                            alert('Please select a node first');
                        }
                    });
                    
                    const updateConnectButton = () => {
                        if (connectMode && connectingFrom) {
                            connectBtn.style.background = '#3fb950';
                            connectBtn.innerHTML = '<ion-icon name="checkmark-outline" style="margin-right: 4px;"></ion-icon>Click target node';
                        } else {
                            connectBtn.style.background = '#58a6ff';
                            connectBtn.innerHTML = '<ion-icon name="link-outline" style="margin-right: 4px;"></ion-icon>Connect';
                        }
                    };
                    
                    const toolbar = document.querySelector(`#${wId} #workflow-editor-content > div:first-child`);
                    if (toolbar) {
                        toolbar.insertBefore(connectBtn, saveBtn);
                    }
                };

                // Module search functionality
                const moduleSearchInput = document.querySelector(`#${wId} #module-search-input`);
                let moduleSearchTimeout = null;
                let availableModules = [];
                
                const loadAvailableModules = async () => {
                    try {
                        const res = await fetch('/api/modules/list');
                        if (res.ok) {
                            const data = await res.json();
                            availableModules = data.modules || [];
                        }
                    } catch (err) {
                        console.error('Error loading modules:', err);
                    }
                };
                
                const searchModules = (query) => {
                    const resultsList = document.querySelector(`#${wId} #module-results-list`);
                    const resultsContainer = document.querySelector(`#${wId} #module-search-results`);
                    
                    if (!query || query.length < 2) {
                        resultsContainer.style.display = 'none';
                        return;
                    }
                    
                    const filtered = availableModules.filter(m => 
                        m.name.toLowerCase().includes(query.toLowerCase()) ||
                        m.path.toLowerCase().includes(query.toLowerCase())
                    ).slice(0, 10);
                    
                    if (filtered.length === 0) {
                        resultsList.innerHTML = '<div style="padding: 8px; color: #8b949e; font-size: 11px;">No modules found</div>';
                        resultsContainer.style.display = 'block';
                        return;
                    }
                    
                    resultsList.innerHTML = filtered.map(m => `
                        <div class="module-result-item" data-module-path="${m.path}" style="padding: 8px; margin-bottom: 4px; background: rgba(88, 166, 255, 0.05); border: 1px solid #30363d; border-radius: 4px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(88, 166, 255, 0.1)'" onmouseout="this.style.background='rgba(88, 166, 255, 0.05)'">
                            <div style="font-size: 11px; font-weight: 600; color: #58a6ff; margin-bottom: 2px;">${m.name || m.path}</div>
                            <div style="font-size: 10px; color: #8b949e;">${m.path}</div>
                        </div>
                    `).join('');
                    
                    resultsContainer.style.display = 'block';
                    
                    // Add click handlers
                    document.querySelectorAll(`#${wId} .module-result-item`).forEach(item => {
                        item.addEventListener('click', () => {
                            const modulePath = item.dataset.modulePath;
                            addModuleNode(modulePath);
                            moduleSearchInput.value = '';
                            resultsContainer.style.display = 'none';
                        });
                    });
                };
                
                if (moduleSearchInput) {
                    moduleSearchInput.addEventListener('input', (e) => {
                        clearTimeout(moduleSearchTimeout);
                        moduleSearchTimeout = setTimeout(() => {
                            searchModules(e.target.value);
                        }, 300);
                    });
                }
                
                const addModuleNode = (modulePath) => {
                    if (!network) return;
                    
                    const canvasRect = canvas.getBoundingClientRect();
                    const centerX = canvasRect.width / 2;
                    const centerY = canvasRect.height / 2;
                    
                    const scale = network.getScale();
                    const viewPos = network.getViewPosition();
                    const networkX = (centerX - viewPos.x) / scale;
                    const networkY = (centerY - viewPos.y) / scale;
                    
                    nodeCounter++;
                    const nodeId = `node_${nodeCounter}`;
                    
                    const node = {
                        id: nodeId,
                        type: 'module',
                        label: modulePath.split('/').pop() || 'Module',
                        module: modulePath,
                        options: {},
                        x: networkX,
                        y: networkY,
                        color: { border: '#58a6ff', background: '#161b22' }
                    };
                    
                    nodes.add(node);
                };
                
                // Load templates functionality
                const loadTemplateBtn = document.querySelector(`#${wId} #load-template-btn`);
                const loadTemplates = async () => {
                    try {
                        const res = await fetch('/api/workflows/templates');
                        if (res.ok) {
                            const data = await res.json();
                            const templates = data.templates || [];
                            
                            if (templates.length === 0) {
                                alert('No templates available');
                                return;
                            }
                            
                            // Create a better selection dialog
                            const templateList = templates.map((t, i) => `${i + 1}. ${t.name}${t.description ? ' - ' + t.description : ''}`).join('\n');
                            const selectedIndex = prompt(`Available templates:\n\n${templateList}\n\nEnter template number to load:`, '1');
                            
                            if (selectedIndex) {
                                const index = parseInt(selectedIndex) - 1;
                                if (index >= 0 && index < templates.length) {
                                    const template = templates[index];
                                    
                                    // Create new workflow from template
                                    const name = prompt('Enter name for new workflow:', `${template.name} (Copy)`);
                                    if (name && name.trim()) {
                                        const res = await fetch('/api/workflows/create', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                name: name.trim(),
                                                description: template.description || '',
                                                trigger: template.trigger || 'manual',
                                                nodes: template.nodes || [],
                                                edges: template.edges || [],
                                                steps: template.steps || [],
                                                variables: template.variables || {}
                                            })
                                        });
                                        
                                        if (res.ok) {
                                            const data = await res.json();
                                            await loadWorkflows();
                                            selectWorkflow(data.workflow_id);
                                        } else {
                                            const errorData = await res.json().catch(() => ({}));
                                            alert(`Error creating workflow: ${errorData.error || 'Unknown error'}`);
                                        }
                                    }
                                } else {
                                    alert('Invalid template number');
                                }
                            }
                        } else {
                            alert('Error loading templates from server');
                        }
                    } catch (err) {
                        console.error('Error loading templates:', err);
                        alert(`Error loading templates: ${err.message}`);
                    }
                };
                
                if (loadTemplateBtn) {
                    loadTemplateBtn.addEventListener('click', loadTemplates);
                }
                
                // Load Python workflows functionality
                const loadPythonWorkflowBtn = document.querySelector(`#${wId} #load-python-workflow-btn`);
                const loadPythonWorkflows = async () => {
                    try {
                        const res = await fetch('/api/workflows/python/list');
                        if (res.ok) {
                            const data = await res.json();
                            const workflows = data.workflows || [];
                            
                            if (workflows.length === 0) {
                                alert('No Python workflows found in modules/workflow/');
                                return;
                            }
                            
                            // Create selection dialog
                            const workflowList = workflows.map((w, i) => `${i + 1}. ${w.name}${w.description ? ' - ' + w.description : ''}`).join('\n');
                            const selectedIndex = prompt(`Available Python workflows:\n\n${workflowList}\n\nEnter workflow number to load:`, '1');
                            
                            if (selectedIndex) {
                                const index = parseInt(selectedIndex) - 1;
                                if (index >= 0 && index < workflows.length) {
                                    const workflow = workflows[index];
                                    
                                    // Create new workflow from Python workflow
                                    const name = prompt('Enter name for new workflow:', `${workflow.name} (Visual)`);
                                    if (name && name.trim()) {
                                        const res = await fetch('/api/workflows/create', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                name: name.trim(),
                                                description: workflow.description || '',
                                                trigger: 'manual',
                                                nodes: workflow.nodes || [],
                                                edges: workflow.edges || [],
                                                steps: [],
                                                variables: {}
                                            })
                                        });
                                        
                                        if (res.ok) {
                                            const data = await res.json();
                                            await loadWorkflows();
                                            selectWorkflow(data.workflow_id);
                                        } else {
                                            const errorData = await res.json().catch(() => ({}));
                                            alert(`Error creating workflow: ${errorData.error || 'Unknown error'}`);
                                        }
                                    }
                                } else {
                                    alert('Invalid workflow number');
                                }
                            }
                        } else {
                            alert('Error loading Python workflows from server');
                        }
                    } catch (err) {
                        console.error('Error loading Python workflows:', err);
                        alert(`Error loading Python workflows: ${err.message}`);
                    }
                };
                
                if (loadPythonWorkflowBtn) {
                    loadPythonWorkflowBtn.addEventListener('click', loadPythonWorkflows);
                }
                
                // Export to Python functionality
                const exportPythonBtn = document.querySelector(`#${wId} #export-python-btn`);
                const exportToPython = async () => {
                    if (!currentWorkflowId) {
                        alert('Please select a workflow first');
                        return;
                    }
                    
                    const workflow = workflows.find(wf => wf.id === currentWorkflowId);
                    if (!workflow) {
                        alert('Workflow not found');
                        return;
                    }
                    
                    const filename = prompt('Enter Python filename (e.g., my_workflow.py):', `${workflow.name.toLowerCase().replace(/\s+/g, '_')}.py`);
                    if (!filename || !filename.endsWith('.py')) {
                        alert('Invalid filename. Must end with .py');
                        return;
                    }
                    
                    try {
                        const res = await fetch('/api/workflows/python/generate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                workflow: {
                                    name: workflow.name,
                                    description: workflow.description || '',
                                    author: 'KittySploit',
                                    nodes: workflow.nodes || [],
                                    edges: workflow.edges || [],
                                    variables: workflow.variables || {}
                                },
                                filename: filename
                            })
                        });
                        
                        if (res.ok) {
                            const data = await res.json();
                            alert(`Python workflow exported successfully!\n\nFile: ${data.file_path}\n\nYou can now use it in modules/workflow/`);
                        } else {
                            const errorData = await res.json().catch(() => ({}));
                            alert(`Error exporting workflow: ${errorData.error || 'Unknown error'}`);
                        }
                    } catch (err) {
                        console.error('Error exporting workflow:', err);
                        alert(`Error exporting workflow: ${err.message}`);
                    }
                };
                
                if (exportPythonBtn) {
                    exportPythonBtn.addEventListener('click', exportToPython);
                }
                
                // Validation functionality
                const validateBtn = document.querySelector(`#${wId} #validate-workflow-btn`);
                const validateWorkflow = () => {
                    const nodeList = nodes.get();
                    const edgeList = edges.get();
                    const errors = [];
                    const warnings = [];
                    
                    // Check for start node
                    const startNodes = nodeList.filter(n => n.type === 'start');
                    if (startNodes.length === 0) {
                        errors.push('No start node found');
                    } else if (startNodes.length > 1) {
                        warnings.push('Multiple start nodes found');
                    }
                    
                    // Check for orphaned nodes
                    const connectedNodeIds = new Set();
                    edgeList.forEach(e => {
                        connectedNodeIds.add(e.from);
                        connectedNodeIds.add(e.to);
                    });
                    
                    nodeList.forEach(node => {
                        if (node.type !== 'start' && !connectedNodeIds.has(node.id)) {
                            warnings.push(`Node "${node.label || node.id}" is not connected`);
                        }
                    });
                    
                    // Check module nodes have module paths
                    nodeList.forEach(node => {
                        if (node.type === 'module' && !node.module) {
                            errors.push(`Module node "${node.label || node.id}" has no module path`);
                        }
                    });
                    
                    // Check conditions have expressions
                    nodeList.forEach(node => {
                        if (node.type === 'condition' && !node.expression) {
                            errors.push(`Condition node "${node.label || node.id}" has no expression`);
                        }
                    });
                    
                    // Show results
                    if (errors.length === 0 && warnings.length === 0) {
                        alert('✓ Workflow is valid!');
                    } else {
                        let message = '';
                        if (errors.length > 0) {
                            message += 'Errors:\n' + errors.map(e => `  • ${e}`).join('\n') + '\n\n';
                        }
                        if (warnings.length > 0) {
                            message += 'Warnings:\n' + warnings.map(w => `  • ${w}`).join('\n');
                        }
                        alert(message);
                    }
                };
                
                if (validateBtn) {
                    validateBtn.addEventListener('click', validateWorkflow);
                }
                
                // Execution status tracking
                const executionStatusBar = document.querySelector(`#${wId} #workflow-execution-status`);
                const executionStatusText = document.querySelector(`#${wId} #execution-status-text`);
                const executionProgress = document.querySelector(`#${wId} #execution-progress`);
                const executionProgressFill = document.querySelector(`#${wId} #execution-progress-fill`);
                const cancelExecutionBtn = document.querySelector(`#${wId} #cancel-execution-btn`);
                
                if (os.socket) {
                    os.socket.on('workflow_progress', (data) => {
                        if (data.workflow_id && currentWorkflowId) {
                            const wfIdNum = parseInt(currentWorkflowId.replace('wf-', ''));
                            if (data.workflow_id === wfIdNum) {
                                if (executionStatusBar) executionStatusBar.style.display = 'block';
                                if (executionStatusText) executionStatusText.textContent = `Executing: ${data.step_name}`;
                                if (executionProgress) executionProgress.textContent = `Step ${data.step}/${data.total_steps}`;
                                if (executionProgressFill) {
                                    const progress = (data.step / data.total_steps) * 100;
                                    executionProgressFill.style.width = `${progress}%`;
                                }
                            }
                        }
                    });
                    
                    os.socket.on('workflow_completed', (data) => {
                        if (data.workflow_id && currentWorkflowId) {
                            const wfIdNum = parseInt(currentWorkflowId.replace('wf-', ''));
                            if (data.workflow_id === wfIdNum) {
                                if (executionStatusBar) executionStatusBar.style.display = 'none';
                                alert(`Workflow execution completed in ${data.duration}s`);
                                loadWorkflows();
                            }
                        }
                    });
                }
                
                // Event listeners
                newWorkflowBtn.addEventListener('click', createNewWorkflow);
                refreshBtn.addEventListener('click', loadWorkflows);
                saveBtn.addEventListener('click', saveWorkflow);
                executeBtn.addEventListener('click', executeWorkflow);
                deleteBtn.addEventListener('click', deleteWorkflow);
                workflowSearch.addEventListener('input', renderWorkflowsList);

                // Setup drag and drop will be done when workflow is selected
                
                // Load available modules
                loadAvailableModules();

                // Initial load
                loadWorkflows();
            }
        });
    }

    spawnIDE() {
        const winId = this.wm.createWindow({
            title: 'Module Launcher',
            icon: 'code-outline',
            width: '1400px',
            height: '800px',
            headerButtons: `
                <button id="save-module-btn" class="header-action-btn" title="Save" style="display: none;">
                    <ion-icon name="save-outline"></ion-icon>
                </button>
                <button id="new-module-btn" class="header-action-btn" title="New Module">
                    <ion-icon name="add-outline"></ion-icon>
                </button>
            `,
            content: `
                <div style="display: flex; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif;">
                    <!-- Left Sidebar: Module Explorer -->
                    <div style="width: 300px; border-right: 1px solid #30363d; display: flex; flex-direction: column; background: #161b22;">
                        <div style="padding: 15px; border-bottom: 1px solid #30363d;">
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                                <h3 style="margin: 0; font-size: 16px; color: #58a6ff;">Modules</h3>
                            </div>
                            <div style="position: relative;">
                                <ion-icon name="search-outline" style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: #8b949e; font-size: 16px;"></ion-icon>
                                <input type="text" id="module-search" placeholder="Search modules..." style="width: 100%; padding: 6px 8px 6px 32px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">
                            </div>
                            <div style="margin-top: 10px;">
                                <select id="module-type-filter" style="width: 100%; padding: 6px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">
                                    <option value="">All Types</option>
                                    <option value="exploits">Exploits</option>
                                    <option value="auxiliary">Auxiliary</option>
                                    <option value="scanners">Scanners</option>
                                    <option value="post">Post-Exploitation</option>
                                    <option value="payloads">Payloads</option>
                                    <option value="workflow">Workflows</option>
                                </select>
                            </div>
                        </div>
                        <div id="modules-tree" style="flex: 1; overflow-y: auto; padding: 10px;">
                            <div style="text-align: center; color: #8b949e; padding: 20px;">Loading modules...</div>
                        </div>
                    </div>

                    <!-- Right Panel: Code Editor -->
                    <div style="flex: 1; display: flex; flex-direction: column;">
                        <div id="no-module-selected" style="flex: 1; display: flex; align-items: center; justify-content: center; color: #8b949e;">
                            <div style="text-align: center;">
                                <ion-icon name="code-outline" style="font-size: 64px; color: #30363d; margin-bottom: 16px;"></ion-icon>
                                <div style="font-size: 16px; margin-bottom: 8px;">No module selected</div>
                                <div style="font-size: 13px;">Select a module from the list or create a new one</div>
                            </div>
                        </div>

                        <div id="module-editor" style="display: none; flex: 1; flex-direction: column; height: 100%;">
                            <!-- Editor Toolbar -->
                            <div style="padding: 10px; border-bottom: 1px solid #30363d; background: #161b22; display: flex; align-items: center; gap: 10px;">
                                <div style="flex: 1; font-size: 13px; color: #c9d1d9;">
                                    <span id="module-path-display" style="color: #58a6ff; font-weight: 600;"></span>
                                </div>
                                <div style="font-size: 11px; color: #8b949e;">
                                    <span id="module-lines-count">0 lines</span>
                                </div>
                            </div>
                            
                            <!-- Code Editor -->
                            <div id="code-editor-container" style="flex: 1; position: relative; min-height: 0;">
                                <textarea id="code-editor" style="width: 100%; height: 100%; font-family: 'Fira Code', 'Consolas', monospace; font-size: 14px; background: #0d1117; color: #c9d1d9; border: none; outline: none; padding: 15px; resize: none;"></textarea>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const modulesTree = document.querySelector(`#${wId} #modules-tree`);
                const moduleEditor = document.querySelector(`#${wId} #module-editor`);
                const noModuleSelected = document.querySelector(`#${wId} #no-module-selected`);
                const moduleSearch = document.querySelector(`#${wId} #module-search`);
                const moduleTypeFilter = document.querySelector(`#${wId} #module-type-filter`);
                const saveBtn = document.querySelector(`#${wId} #save-module-btn`);
                const newModuleBtn = document.querySelector(`#${wId} #new-module-btn`);
                const codeEditor = document.querySelector(`#${wId} #code-editor`);
                const modulePathDisplay = document.querySelector(`#${wId} #module-path-display`);
                const moduleLinesCount = document.querySelector(`#${wId} #module-lines-count`);

                let codeMirrorEditor = null;
                let currentModulePath = null;
                let modules = [];
                let isModified = false;

                // Initialize CodeMirror
                const initEditor = () => {
                    if (codeMirrorEditor) {
                        codeMirrorEditor.toTextArea();
                    }
                    codeMirrorEditor = CodeMirror.fromTextArea(codeEditor, {
                        mode: 'python',
                        theme: 'monokai',
                        lineNumbers: true,
                        indentUnit: 4,
                        indentWithTabs: false,
                        lineWrapping: true,
                        autofocus: true,
                        styleActiveLine: true,
                        matchBrackets: true,
                        autoCloseBrackets: true,
                        extraKeys: {
                            "Ctrl-S": () => saveCurrentModule(),
                            "Cmd-S": () => saveCurrentModule()
                        }
                    });

                    codeMirrorEditor.on('change', () => {
                        isModified = true;
                        updateLineCount();
                        if (saveBtn) saveBtn.style.display = 'block';
                    });

                    codeMirrorEditor.setSize('100%', '100%');
                };

                const updateLineCount = () => {
                    if (codeMirrorEditor) {
                        const lines = codeMirrorEditor.lineCount();
                        moduleLinesCount.textContent = `${lines} line${lines !== 1 ? 's' : ''}`;
                    }
                };

                let modulesTreeData = {};

                const loadModules = async () => {
                    try {
                        const res = await fetch('/api/modules/list');
                        const data = await res.json();
                        modules = data.modules || [];
                        modulesTreeData = data.tree || {};
                        renderModulesTree();
                    } catch (err) {
                        console.error('Error loading modules:', err);
                        modulesTree.innerHTML = '<div style="color: #f85149; padding: 20px; text-align: center;">Error loading modules</div>';
                    }
                };

                const renderTreeItem = (item, level = 0, parentPath = '') => {
                    const fullPath = item.path;
                    const isExpanded = item.expanded === true;
                    const hasChildren = !item.is_file && item.children && Object.keys(item.children).length > 0;
                    const isSelected = currentModulePath === fullPath;
                    const indent = level * 16;

                    if (item.is_file) {
                        // It's a file (module)
                        return `
                            <div class="module-item" data-module-path="${fullPath}" 
                                 style="padding: 6px 8px 6px ${indent + 8}px; 
                                        background: ${isSelected ? 'rgba(88, 166, 255, 0.1)' : 'transparent'}; 
                                        border-left: 2px solid ${isSelected ? '#58a6ff' : 'transparent'}; 
                                        cursor: pointer; 
                                        transition: all 0.2s; 
                                        font-size: 12px;
                                        display: flex;
                                        align-items: center;
                                        gap: 6px;
                                        color: ${isSelected ? '#58a6ff' : '#c9d1d9'};"
                                 onmouseover="this.style.background='rgba(88, 166, 255, 0.05)'"
                                 onmouseout="this.style.background='${isSelected ? 'rgba(88, 166, 255, 0.1)' : 'transparent'}'">
                                <ion-icon name="document-text-outline" style="font-size: 14px; flex-shrink: 0;"></ion-icon>
                                <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.name}</span>
                            </div>
                        `;
                    } else {
                        // It's a folder
                        const childrenHtml = hasChildren && isExpanded 
                            ? Object.values(item.children).map(child => renderTreeItem(child, level + 1, fullPath)).join('')
                            : '';
                        
                        return `
                            <div>
                                <div class="tree-folder" data-folder-path="${fullPath}"
                                     style="padding: 6px 8px 6px ${indent + 8}px; 
                                            cursor: pointer; 
                                            transition: all 0.2s; 
                                            font-size: 12px;
                                            display: flex;
                                            align-items: center;
                                            gap: 6px;
                                            color: #8b949e;
                                            user-select: none;"
                                     onmouseover="this.style.background='rgba(255,255,255,0.03)'"
                                     onmouseout="this.style.background='transparent'">
                                    <ion-icon name="${isExpanded ? 'chevron-down' : 'chevron-forward'}-outline" 
                                              style="font-size: 12px; flex-shrink: 0; width: 12px;"></ion-icon>
                                    <ion-icon name="folder-outline" style="font-size: 14px; flex-shrink: 0;"></ion-icon>
                                    <span style="flex: 1; font-weight: 500;">${item.name}</span>
                                </div>
                                ${childrenHtml}
                            </div>
                        `;
                    }
                };

                const renderModulesTree = () => {
                    const searchTerm = moduleSearch.value.toLowerCase();
                    const typeFilter = moduleTypeFilter.value;

                    // Filter tree based on search and type filter
                    let filteredTree = modulesTreeData;
                    
                    if (typeFilter) {
                        // Filter by type (first level)
                        if (typeFilter in filteredTree) {
                            filteredTree = { [typeFilter]: filteredTree[typeFilter] };
                        } else {
                            filteredTree = {};
                        }
                    }

                    // If search term, we need to filter and expand matching paths
                    if (searchTerm) {
                        const filterTree = (tree) => {
                            const filtered = {};
                            for (const [key, item] of Object.entries(tree)) {
                                if (item.is_file) {
                                    // It's a file, check if it matches
                                    const matches = item.name.toLowerCase().includes(searchTerm) ||
                                                  item.path.toLowerCase().includes(searchTerm);
                                    if (matches) {
                                        filtered[key] = item;
                                    }
                                } else {
                                    // It's a folder, filter children
                                    const filteredChildren = item.children ? filterTree(item.children) : {};
                                    const matches = item.name.toLowerCase().includes(searchTerm);
                                    if (matches || Object.keys(filteredChildren).length > 0) {
                                        filtered[key] = {
                                            ...item,
                                            children: filteredChildren,
                                            expanded: true  // Auto-expand when searching
                                        };
                                    }
                                }
                            }
                            return filtered;
                        };
                        filteredTree = filterTree(filteredTree);
                    }

                    if (Object.keys(filteredTree).length === 0) {
                        modulesTree.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 20px;">No modules found</div>';
                        return;
                    }

                    // Render tree
                    let html = '';
                    for (const item of Object.values(filteredTree)) {
                        html += renderTreeItem(item, 0);
                    }
                    modulesTree.innerHTML = html;

                    // Add click handlers for files
                    document.querySelectorAll(`#${wId} .module-item`).forEach(item => {
                        item.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const modulePath = item.dataset.modulePath;
                            selectModule(modulePath);
                        });
                    });

                    // Add click handlers for folders (expand/collapse)
                    document.querySelectorAll(`#${wId} .tree-folder`).forEach(folder => {
                        folder.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const folderPath = folder.dataset.folderPath;
                            toggleFolder(folderPath);
                        });
                    });
                };

                const toggleFolder = (folderPath) => {
                    const findAndToggle = (tree, path) => {
                        const parts = path.split('/');
                        let current = tree;
                        for (let i = 0; i < parts.length; i++) {
                            if (parts[i] in current) {
                                if (i === parts.length - 1) {
                                    // Found the folder
                                    if (current[parts[i]].expanded === undefined || current[parts[i]].expanded === false) {
                                        current[parts[i]].expanded = true;
                                    } else {
                                        current[parts[i]].expanded = false;
                                    }
                                    return true;
                                }
                                if (current[parts[i]].children) {
                                    current = current[parts[i]].children;
                                } else {
                                    return false;
                                }
                            } else {
                                return false;
                            }
                        }
                        return false;
                    };

                    findAndToggle(modulesTreeData, folderPath);
                    renderModulesTree();
                };

                const selectModule = async (modulePath) => {
                    if (isModified && currentModulePath) {
                        if (!confirm('You have unsaved changes. Do you want to discard them?')) {
                            return;
                        }
                    }

                    currentModulePath = modulePath;
                    isModified = false;
                    if (saveBtn) saveBtn.style.display = 'none';

                    noModuleSelected.style.display = 'none';
                    moduleEditor.style.display = 'flex';

                    modulePathDisplay.textContent = modulePath;

                    try {
                        const res = await fetch(`/api/modules/${encodeURIComponent(modulePath)}`);
                        if (res.ok) {
                            const data = await res.json();
                            if (codeMirrorEditor) {
                                codeMirrorEditor.setValue(data.content || '');
                                codeMirrorEditor.clearHistory();
                            } else {
                                codeEditor.value = data.content || '';
                                initEditor();
                            }
                            updateLineCount();
                        } else {
                            alert('Error loading module');
                        }
                    } catch (err) {
                        console.error('Error loading module:', err);
                        alert('Error loading module');
                    }

                    renderModulesTree();
                };

                const saveCurrentModule = async () => {
                    if (!currentModulePath || !codeMirrorEditor) return;

                    const content = codeMirrorEditor.getValue();

                    try {
                        const res = await fetch(`/api/modules/${encodeURIComponent(currentModulePath)}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ content: content })
                        });

                        if (res.ok) {
                            isModified = false;
                            if (saveBtn) saveBtn.style.display = 'none';
                            alert('Module saved successfully!');
                        } else {
                            alert('Error saving module');
                        }
                    } catch (err) {
                        console.error('Error saving module:', err);
                        alert('Error saving module');
                    }
                };

                const createNewModule = async () => {
                    const moduleType = prompt('Module type (exploits/auxiliary/scanners/post/payloads/workflow):');
                    if (!moduleType) return;

                    const moduleName = prompt('Module name (e.g., my_exploit):');
                    if (!moduleName) return;

                    const modulePath = `${moduleType}/${moduleName}`;

                    // Template de base pour un module
                    const template = `#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from core.framework.base_module import BaseModule

class Module(BaseModule):
    """Module description"""
    
    def __init__(self, framework=None):
        super().__init__(framework)
        self.name = "${moduleName}"
        self.description = "Module description"
        self.author = "Your Name"
        self.version = "1.0"
        self.type = "${moduleType}"
        
    def check(self):
        """Check if the target is vulnerable"""
        return True
    
    def run(self):
        """Execute the module"""
        self.print_info("Module executed successfully")
        return True
`;

                    try {
                        const res = await fetch('/api/modules/create', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                path: modulePath,
                                content: template
                            })
                        });

                        if (res.ok) {
                            await loadModules();
                            selectModule(modulePath);
                        } else {
                            alert('Error creating module');
                        }
                    } catch (err) {
                        console.error('Error creating module:', err);
                        alert('Error creating module');
                    }
                };

                // Event listeners
                moduleSearch.addEventListener('input', renderModulesTree);
                moduleTypeFilter.addEventListener('change', renderModulesTree);
                if (saveBtn) saveBtn.addEventListener('click', saveCurrentModule);
                if (newModuleBtn) newModuleBtn.addEventListener('click', createNewModule);

                // Initialize editor
                initEditor();

                // Initial load
                loadModules();
            }
        });
    }

    spawnModuleLauncher() {
        const winId = this.wm.createWindow({
            title: 'Module Launcher',
            icon: 'rocket-outline',
            width: '1400px',
            height: '800px',
            headerButtons: `
                <button id="refresh-modules-btn" class="header-action-btn" title="Refresh Modules">
                    <ion-icon name="refresh-outline"></ion-icon>
                </button>
            `,
            content: `
                <div style="display: flex; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif;">
                    <!-- Left Sidebar: Module Tree -->
                    <div style="width: 350px; border-right: 1px solid #30363d; display: flex; flex-direction: column; background: #161b22;">
                        <div style="padding: 15px; border-bottom: 1px solid #30363d;">
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                                <h3 style="margin: 0; font-size: 16px; color: #58a6ff;">Modules</h3>
                            </div>
                            <div style="position: relative; margin-bottom: 10px;">
                                <ion-icon name="search-outline" style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: #8b949e; font-size: 16px;"></ion-icon>
                                <input type="text" id="module-launcher-search" placeholder="Search modules..." style="width: 100%; padding: 6px 8px 6px 32px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">
                            </div>
                            <div>
                                <select id="module-launcher-type-filter" style="width: 100%; padding: 6px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">
                                    <option value="">All Types</option>
                                    <option value="exploits">Exploits</option>
                                    <option value="auxiliary">Auxiliary</option>
                                    <option value="post">Post-Exploitation</option>
                                    <option value="payloads">Payloads</option>
                                </select>
                            </div>
                        </div>
                        <div id="module-launcher-tree" style="flex: 1; overflow-y: auto; padding: 10px;">
                            <div style="text-align: center; color: #8b949e; padding: 20px;">Loading modules...</div>
                        </div>
                    </div>

                    <!-- Right Panel: Module Options & Launch -->
                    <div style="flex: 1; display: flex; flex-direction: column; background: #0d1117;">
                        <div id="no-module-selected-launcher" style="flex: 1; display: flex; align-items: center; justify-content: center; color: #8b949e;">
                            <div style="text-align: center;">
                                <ion-icon name="rocket-outline" style="font-size: 64px; color: #30363d; margin-bottom: 16px;"></ion-icon>
                                <div style="font-size: 16px; margin-bottom: 8px;">No module selected</div>
                                <div style="font-size: 13px;">Select a module from the list to configure and launch it</div>
                            </div>
                        </div>

                        <div id="module-launcher-content" style="display: none; flex: 1; flex-direction: column; height: 100%; overflow-y: auto;">
                            <!-- Module Info Header -->
                            <div style="padding: 20px; border-bottom: 1px solid #30363d; background: #161b22;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                                    <div>
                                        <h2 style="margin: 0; font-size: 18px; color: #58a6ff;" id="module-launcher-name">Module Name</h2>
                                        <div style="font-size: 12px; color: #8b949e; margin-top: 4px;" id="module-launcher-path">module/path</div>
                                    </div>
                                    <button id="launch-module-btn" style="background: #238636; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                                        <ion-icon name="rocket-outline"></ion-icon>
                                        Launch Module
                                    </button>
                                </div>
                                <div style="font-size: 13px; color: #c9d1d9; margin-top: 10px;" id="module-launcher-description">Module description will appear here</div>
                                <div style="font-size: 12px; color: #8b949e; margin-top: 8px;" id="module-launcher-author">Author: Unknown</div>
                            </div>

                            <!-- Module Options Form -->
                            <div style="padding: 20px;">
                                <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #58a6ff;">Module Options</h3>
                                <div id="module-launcher-options" style="display: flex; flex-direction: column; gap: 15px;">
                                    <!-- Options will be dynamically generated here -->
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const moduleTree = document.querySelector(`#${wId} #module-launcher-tree`);
                const moduleSearch = document.querySelector(`#${wId} #module-launcher-search`);
                const moduleTypeFilter = document.querySelector(`#${wId} #module-launcher-type-filter`);
                const noModuleSelected = document.querySelector(`#${wId} #no-module-selected-launcher`);
                const moduleContent = document.querySelector(`#${wId} #module-launcher-content`);
                const moduleName = document.querySelector(`#${wId} #module-launcher-name`);
                const modulePath = document.querySelector(`#${wId} #module-launcher-path`);
                const moduleDescription = document.querySelector(`#${wId} #module-launcher-description`);
                const moduleAuthor = document.querySelector(`#${wId} #module-launcher-author`);
                const moduleOptions = document.querySelector(`#${wId} #module-launcher-options`);
                const launchBtn = document.querySelector(`#${wId} #launch-module-btn`);
                const refreshBtn = document.querySelector(`#${wId} #refresh-modules-btn`);

                let modulesTreeData = {};
                let currentModule = null;
                let currentModuleInfo = null;
                let optionValues = {};

                // Load modules tree
                const loadModules = async () => {
                    try {
                        moduleTree.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 20px;">Loading modules...</div>';
                        const res = await fetch('/api/modules/list');
                        if (res.ok) {
                            const data = await res.json();
                            modulesTreeData = data.tree || {};
                            renderModulesTree();
                        } else {
                            moduleTree.innerHTML = '<div style="text-align: center; color: #ff7b72; padding: 20px;">Error loading modules</div>';
                        }
                    } catch (err) {
                        console.error('Error loading modules:', err);
                        moduleTree.innerHTML = '<div style="text-align: center; color: #ff7b72; padding: 20px;">Error loading modules</div>';
                    }
                };

                // Render tree item
                const renderTreeItem = (item, level = 0) => {
                    const fullPath = item.path;
                    const isExpanded = item.expanded === true;
                    const hasChildren = !item.is_file && item.children && Object.keys(item.children).length > 0;
                    const isSelected = currentModule?.path === fullPath;
                    const indent = level * 16;

                    if (item.is_file) {
                        // It's a file (module)
                        return `
                            <div class="module-launcher-item" data-module-path="${fullPath}" 
                                 style="padding: 6px 8px 6px ${indent + 8}px; 
                                        background: ${isSelected ? 'rgba(88, 166, 255, 0.1)' : 'transparent'}; 
                                        border-left: 2px solid ${isSelected ? '#58a6ff' : 'transparent'}; 
                                        cursor: pointer; 
                                        transition: all 0.2s; 
                                        font-size: 12px;
                                        display: flex;
                                        align-items: center;
                                        gap: 6px;
                                        color: ${isSelected ? '#58a6ff' : '#c9d1d9'};">
                                <ion-icon name="document-text-outline" style="font-size: 14px; flex-shrink: 0;"></ion-icon>
                                <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.name}</span>
                            </div>
                        `;
                    } else {
                        // It's a folder
                        const childrenHtml = hasChildren && isExpanded 
                            ? Object.values(item.children).map(child => renderTreeItem(child, level + 1)).join('')
                            : '';
                        
                        return `
                            <div>
                                <div class="tree-folder-launcher" data-folder-path="${fullPath}"
                                     style="padding: 6px 8px 6px ${indent + 8}px; 
                                            cursor: pointer; 
                                            transition: all 0.2s; 
                                            font-size: 12px;
                                            display: flex;
                                            align-items: center;
                                            gap: 6px;
                                            color: #8b949e;
                                            user-select: none;">
                                    <ion-icon name="${isExpanded ? 'chevron-down' : 'chevron-forward'}-outline" 
                                              style="font-size: 12px; flex-shrink: 0; width: 12px;"></ion-icon>
                                    <ion-icon name="folder-outline" style="font-size: 14px; flex-shrink: 0;"></ion-icon>
                                    <span style="flex: 1; font-weight: 500;">${item.name}</span>
                                </div>
                                ${childrenHtml}
                            </div>
                        `;
                    }
                };

                // Render modules tree
                const renderModulesTree = () => {
                    const searchTerm = (moduleSearch?.value || '').toLowerCase();
                    const typeFilter = moduleTypeFilter?.value || '';

                    // Filter tree based on search and type filter
                    let filteredTree = modulesTreeData;
                    
                    if (typeFilter) {
                        // Filter by type (first level)
                        if (typeFilter in filteredTree) {
                            filteredTree = { [typeFilter]: filteredTree[typeFilter] };
                        } else {
                            filteredTree = {};
                        }
                    }

                    // If search term, we need to filter and expand matching paths
                    if (searchTerm) {
                        const filterTree = (tree) => {
                            const filtered = {};
                            for (const [key, item] of Object.entries(tree)) {
                                if (item.is_file) {
                                    // It's a file, check if it matches
                                    const matches = item.name.toLowerCase().includes(searchTerm) ||
                                                  item.path.toLowerCase().includes(searchTerm);
                                    if (matches) {
                                        filtered[key] = item;
                                    }
                                } else {
                                    // It's a folder, filter children
                                    const filteredChildren = item.children ? filterTree(item.children) : {};
                                    const matches = item.name.toLowerCase().includes(searchTerm);
                                    if (matches || Object.keys(filteredChildren).length > 0) {
                                        filtered[key] = {
                                            ...item,
                                            children: filteredChildren,
                                            expanded: true  // Auto-expand when searching
                                        };
                                    }
                                }
                            }
                            return filtered;
                        };
                        filteredTree = filterTree(filteredTree);
                    }

                    if (Object.keys(filteredTree).length === 0) {
                        moduleTree.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 20px;">No modules found</div>';
                        return;
                    }

                    // Render tree
                    let html = '';
                    for (const item of Object.values(filteredTree)) {
                        html += renderTreeItem(item, 0);
                    }
                    moduleTree.innerHTML = html;

                    // Add click handlers for files
                    document.querySelectorAll(`#${wId} .module-launcher-item`).forEach(item => {
                        item.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const modulePath = item.dataset.modulePath;
                            selectModule(modulePath);
                        });
                        
                        item.addEventListener('mouseenter', () => {
                            if (currentModule?.path !== item.dataset.modulePath) {
                                item.style.background = 'rgba(88, 166, 255, 0.05)';
                            }
                        });
                        
                        item.addEventListener('mouseleave', () => {
                            if (currentModule?.path !== item.dataset.modulePath) {
                                item.style.background = 'transparent';
                            }
                        });
                    });

                    // Add click handlers for folders (toggle expand/collapse)
                    document.querySelectorAll(`#${wId} .tree-folder-launcher`).forEach(folder => {
                        folder.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const folderPath = folder.dataset.folderPath;
                            toggleFolder(folderPath);
                        });
                    });
                };

                // Toggle folder expand/collapse
                const toggleFolder = (folderPath) => {
                    const findAndToggle = (tree, path) => {
                        const parts = path.split('/');
                        let current = tree;
                        for (let i = 0; i < parts.length; i++) {
                            if (parts[i] in current) {
                                if (i === parts.length - 1) {
                                    // Found the folder
                                    if (current[parts[i]].expanded === undefined || current[parts[i]].expanded === false) {
                                        current[parts[i]].expanded = true;
                                    } else {
                                        current[parts[i]].expanded = false;
                                    }
                                    return true;
                                }
                                if (current[parts[i]].children) {
                                    current = current[parts[i]].children;
                                } else {
                                    return false;
                                }
                            } else {
                                return false;
                            }
                        }
                        return false;
                    };

                    findAndToggle(modulesTreeData, folderPath);
                    renderModulesTree();
                };

                // Select and load module
                const selectModule = async (modulePathStr) => {
                    try {
                        const encodedPath = encodeURIComponent(modulePathStr);
                        const res = await fetch(`/api/modules/${encodedPath}/load`);
                        
                        if (res.ok) {
                            const data = await res.json();
                            currentModule = { path: modulePathStr };
                            currentModuleInfo = data;
                            optionValues = {};

                            // Update UI
                            noModuleSelected.style.display = 'none';
                            moduleContent.style.display = 'flex';

                            moduleName.textContent = data.name || modulePathStr.split('/').pop();
                            modulePath.textContent = modulePathStr;
                            moduleDescription.textContent = data.description || 'No description available';
                            moduleAuthor.textContent = `Author: ${data.author || 'Unknown'}`;

                            // Render options
                            await renderOptions(data.options || []);

                            // Re-render tree to update selection
                            renderModulesTree();
                        } else {
                            const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
                            alert(`Error loading module: ${errorData.error || 'Module not found'}`);
                        }
                    } catch (err) {
                        console.error('Error loading module:', err);
                        alert(`Error loading module: ${err.message}`);
                    }
                };

                // Render module options
                const renderOptions = async (options) => {
                    optionValues = {};
                    let html = '';

                    if (options.length === 0) {
                        html = '<div style="color: #8b949e; font-size: 13px;">No options available for this module</div>';
                        moduleOptions.innerHTML = html;
                        return;
                    }

                    // Separate required and optional
                    const required = options.filter(o => o.required);
                    const optional = options.filter(o => !o.required);

                    // Render required options
                    if (required.length > 0) {
                        html += '<div style="margin-bottom: 20px;"><div style="font-size: 12px; color: #ff7b72; text-transform: uppercase; margin-bottom: 10px; font-weight: 600;">Required Options</div>';
                        for (const opt of required) {
                            html += await renderOptionField(opt);
                        }
                        html += '</div>';
                    }

                    // Render optional options
                    if (optional.length > 0) {
                        html += '<div><div style="font-size: 12px; color: #8b949e; text-transform: uppercase; margin-bottom: 10px; font-weight: 600;">Optional Options</div>';
                        for (const opt of optional) {
                            html += await renderOptionField(opt);
                        }
                        html += '</div>';
                    }

                    moduleOptions.innerHTML = html;

                    // Initialize option values with defaults and populate session dropdowns
                    for (const opt of options) {
                        if (opt.current_value !== null && opt.current_value !== undefined) {
                            optionValues[opt.name] = opt.current_value;
                        }
                        
                        const input = document.querySelector(`#${wId} #opt-${opt.name}`);
                        if (input) {
                            if (input.tagName === 'SELECT') {
                                // For selects, set the value
                                input.value = opt.current_value !== null && opt.current_value !== undefined ? String(opt.current_value) : '';
                            } else {
                                // For text inputs
                                input.value = opt.current_value !== null && opt.current_value !== undefined ? opt.current_value : '';
                            }
                        }
                        
                        // Populate session_id dropdowns
                        const isSessionId = opt.name.toLowerCase() === 'session_id' || 
                                           opt.name.toLowerCase() === 'sessionid' ||
                                           opt.name.toLowerCase() === 'sid';
                        if (isSessionId && input && input.tagName === 'SELECT') {
                            await populateSessionDropdown(input, opt.current_value);
                        }
                    }
                };

                // Populate session dropdown
                const populateSessionDropdown = async (selectElement, defaultValue = '') => {
                    try {
                        const res = await fetch('/api/sessions');
                        if (res.ok) {
                            const data = await res.json();
                            const sessions = data.sessions || [];
                            
                            let html = '<option value="">-- Select Session --</option>';
                            sessions.forEach(session => {
                                const sessionId = session.id || '';
                                const displayName = `${sessionId} - ${session.host || 'Unknown'} (${session.type || 'unknown'})`;
                                const selected = sessionId === defaultValue || String(sessionId) === String(defaultValue) ? 'selected' : '';
                                html += `<option value="${sessionId}" ${selected}>${displayName}</option>`;
                            });
                            
                            selectElement.innerHTML = html;
                        } else {
                            selectElement.innerHTML = '<option value="">Error loading sessions</option>';
                        }
                    } catch (err) {
                        console.error('Error loading sessions:', err);
                        selectElement.innerHTML = '<option value="">Error loading sessions</option>';
                    }
                };

                // Render single option field
                const renderOptionField = async (opt) => {
                    const fieldId = `opt-${opt.name}`;
                    const defaultValue = opt.current_value !== null && opt.current_value !== undefined ? String(opt.current_value) : '';
                    
                    // Check if it's a boolean option
                    const isBoolean = opt.type === 'bool' || 
                                     opt.type === 'boolean' ||
                                     (opt.description && (opt.description.toLowerCase().includes('bool') || opt.description.toLowerCase().includes('true/false'))) ||
                                     (defaultValue.toLowerCase() === 'true' || defaultValue.toLowerCase() === 'false');
                    
                    // Check if it's a session_id option
                    const isSessionId = opt.name.toLowerCase() === 'session_id' || 
                                       opt.name.toLowerCase() === 'sessionid' ||
                                       opt.name.toLowerCase() === 'sid';
                    
                    if (isBoolean) {
                        // Boolean dropdown
                        return `
                            <div style="margin-bottom: 15px;">
                                <label style="display: block; font-size: 13px; color: #c9d1d9; margin-bottom: 6px; font-weight: 500;">
                                    ${opt.name}
                                    ${opt.required ? '<span style="color: #ff7b72;">*</span>' : ''}
                                </label>
                                <select id="${fieldId}"
                                        style="width: 100%; padding: 8px 12px; background: rgba(255,255,255,0.05);
                                               border: 1px solid #30363d; border-radius: 4px;
                                               color: #c9d1d9; font-size: 13px; outline: none;
                                               ${opt.required ? 'border-left: 2px solid #ff7b72;' : ''}"
                                        data-option-name="${opt.name}">
                                    <option value="">-- Select --</option>
                                    <option value="True" ${defaultValue === 'True' || defaultValue === 'true' ? 'selected' : ''}>True</option>
                                    <option value="False" ${defaultValue === 'False' || defaultValue === 'false' ? 'selected' : ''}>False</option>
                                </select>
                                <div style="font-size: 11px; color: #8b949e; margin-top: 4px;">${opt.description || ''}</div>
                            </div>
                        `;
                    } else if (isSessionId) {
                        // Session ID dropdown - will be populated asynchronously
                        return `
                            <div style="margin-bottom: 15px;">
                                <label style="display: block; font-size: 13px; color: #c9d1d9; margin-bottom: 6px; font-weight: 500;">
                                    ${opt.name}
                                    ${opt.required ? '<span style="color: #ff7b72;">*</span>' : ''}
                                </label>
                                <select id="${fieldId}"
                                        style="width: 100%; padding: 8px 12px; background: rgba(255,255,255,0.05);
                                               border: 1px solid #30363d; border-radius: 4px;
                                               color: #c9d1d9; font-size: 13px; outline: none;
                                               ${opt.required ? 'border-left: 2px solid #ff7b72;' : ''}"
                                        data-option-name="${opt.name}">
                                    <option value="">Loading sessions...</option>
                                </select>
                                <div style="font-size: 11px; color: #8b949e; margin-top: 4px;">${opt.description || ''}</div>
                            </div>
                        `;
                    } else {
                        // Regular text input
                        return `
                            <div style="margin-bottom: 15px;">
                                <label style="display: block; font-size: 13px; color: #c9d1d9; margin-bottom: 6px; font-weight: 500;">
                                    ${opt.name}
                                    ${opt.required ? '<span style="color: #ff7b72;">*</span>' : ''}
                                </label>
                                <input type="text" id="${fieldId}"
                                       value="${defaultValue}"
                                       placeholder="${opt.description || ''}"
                                       style="width: 100%; padding: 8px 12px; background: rgba(255,255,255,0.05);
                                              border: 1px solid #30363d; border-radius: 4px;
                                              color: #c9d1d9; font-size: 13px; outline: none;
                                              ${opt.required ? 'border-left: 2px solid #ff7b72;' : ''}"
                                       data-option-name="${opt.name}">
                                <div style="font-size: 11px; color: #8b949e; margin-top: 4px;">${opt.description || ''}</div>
                            </div>
                        `;
                    }
                };

                // Launch module
                const launchModule = async () => {
                    if (!currentModule || !currentModuleInfo) {
                        alert('No module selected');
                        return;
                    }

                    // Collect option values
                    const options = {};
                    currentModuleInfo.options.forEach(opt => {
                        const input = document.querySelector(`#${wId} #opt-${opt.name}`);
                        if (input) {
                            let value = input.value.trim();
                            
                            // For boolean selects, convert to proper boolean string
                            const isBoolean = opt.type === 'bool' || 
                                             opt.type === 'boolean' ||
                                             (opt.description && (opt.description.toLowerCase().includes('bool') || opt.description.toLowerCase().includes('true/false')));
                            
                            if (isBoolean && input.tagName === 'SELECT') {
                                // Keep True/False as strings for the framework
                                value = value === 'True' ? 'True' : (value === 'False' ? 'False' : '');
                            }
                            
                            // Always include the option if it has a value or is required
                            if (value || opt.required) {
                                options[opt.name] = value || '';
                            }
                        }
                    });

                    // Validate required options
                    const missingRequired = currentModuleInfo.options.filter(opt => 
                        opt.required && (!options[opt.name] || options[opt.name] === '')
                    );

                    if (missingRequired.length > 0) {
                        alert(`Please fill in all required options:\n${missingRequired.map(o => o.name).join(', ')}`);
                        return;
                    }

                    // Launch via terminal command
                    try {
                        // Create a terminal and execute the module
                        this.spawnTerminal();
                        
                        // Wait a bit for terminal to initialize, then send commands
                        setTimeout(() => {
                            const terminal = this.terminals[this.terminals.length - 1];
                            if (terminal && this.socket) {
                                // Send use command
                                this.socket.emit('terminal_input', {
                                    command: `use ${currentModule.path}`,
                                    session_id: terminal.sessionId
                                });

                                // Send set commands for each option
                                setTimeout(() => {
                                    Object.entries(options).forEach(([name, value]) => {
                                        this.socket.emit('terminal_input', {
                                            command: `set ${name} ${value}`,
                                            session_id: terminal.sessionId
                                        });
                                    });

                                    // Send run command
                                    setTimeout(() => {
                                        this.socket.emit('terminal_input', {
                                            command: 'run',
                                            session_id: terminal.sessionId
                                        });
                                    }, 500);
                                }, 1000);
                            }
                        }, 500);

                        // Show success message
                        this.showNotification(`Module ${currentModuleInfo.name} launched in terminal`, 'success', 3000);
                    } catch (err) {
                        console.error('Error launching module:', err);
                        alert(`Error launching module: ${err.message}`);
                    }
                };

                // Event listeners
                if (moduleSearch) {
                    moduleSearch.addEventListener('input', () => renderModulesTree());
                }

                if (moduleTypeFilter) {
                    moduleTypeFilter.addEventListener('change', () => renderModulesTree());
                }

                if (refreshBtn) {
                    refreshBtn.addEventListener('click', () => loadModules());
                }

                if (launchBtn) {
                    launchBtn.addEventListener('click', () => launchModule());
                }

                // Initialize
                loadModules();
            }
        });
    }

    spawnOutputExplorer() {
        const winId = this.wm.createWindow({
            title: 'Output Explorer',
            icon: 'folder-outline',
            width: '1000px',
            height: '700px',
            top: '50px',
            left: '100px',
            content: `
                <div style="display: flex; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif;">
                    <!-- Left Panel: File List -->
                    <div style="width: 60%; border-right: 1px solid #30363d; display: flex; flex-direction: column; background: #161b22;">
                        <div style="padding: 15px; border-bottom: 1px solid #30363d;">
                            <h3 style="margin: 0; font-size: 16px; color: #58a6ff; display: flex; align-items: center; gap: 8px;">
                                <ion-icon name="folder-outline"></ion-icon>
                                output/
                            </h3>
                        </div>
                        <div id="output-file-list" style="flex: 1; overflow-y: auto; padding: 10px;">
                            <div style="text-align: center; color: #8b949e; padding: 20px;">Loading...</div>
                        </div>
                    </div>
                    
                    <!-- Right Panel: File Properties -->
                    <div style="flex: 1; display: flex; flex-direction: column; background: #0d1117;">
                        <div id="no-file-selected" style="flex: 1; display: flex; align-items: center; justify-content: center; color: #8b949e;">
                            <div style="text-align: center;">
                                <ion-icon name="document-outline" style="font-size: 64px; color: #30363d; margin-bottom: 16px;"></ion-icon>
                                <div style="font-size: 16px; margin-bottom: 8px;">No file selected</div>
                                <div style="font-size: 13px;">Click on a file or folder to view its properties</div>
                            </div>
                        </div>
                        
                        <div id="file-properties" style="display: none; flex: 1; overflow-y: auto; padding: 20px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                                <h3 style="margin: 0; font-size: 18px; color: #58a6ff;" id="file-properties-name">File Name</h3>
                                <button id="delete-file-btn" style="padding: 8px 16px; background: #f85149; border: 1px solid #f85149; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; display: flex; align-items: center; gap: 6px;">
                                    <ion-icon name="trash-outline"></ion-icon>
                                    Delete
                                </button>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 15px;">
                                <div>
                                    <div style="font-size: 12px; color: #8b949e; margin-bottom: 5px;">Path</div>
                                    <div style="font-size: 14px; color: #c9d1d9; word-break: break-all;" id="file-properties-path">-</div>
                                </div>
                                <div>
                                    <div style="font-size: 12px; color: #8b949e; margin-bottom: 5px;">Type</div>
                                    <div style="font-size: 14px; color: #c9d1d9;" id="file-properties-type">-</div>
                                </div>
                                <div>
                                    <div style="font-size: 12px; color: #8b949e; margin-bottom: 5px;">Size</div>
                                    <div style="font-size: 14px; color: #c9d1d9;" id="file-properties-size">-</div>
                                </div>
                                <div>
                                    <div style="font-size: 12px; color: #8b949e; margin-bottom: 5px;">Created</div>
                                    <div style="font-size: 14px; color: #c9d1d9;" id="file-properties-created">-</div>
                                </div>
                                <div>
                                    <div style="font-size: 12px; color: #8b949e; margin-bottom: 5px;">Modified</div>
                                    <div style="font-size: 14px; color: #c9d1d9;" id="file-properties-modified">-</div>
                                </div>
                                <div id="file-properties-item-count-container" style="display: none;">
                                    <div style="font-size: 12px; color: #8b949e; margin-bottom: 5px;">Items</div>
                                    <div style="font-size: 14px; color: #c9d1d9;" id="file-properties-item-count">-</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const fileList = document.querySelector(`#${wId} #output-file-list`);
                const noFileSelected = document.querySelector(`#${wId} #no-file-selected`);
                const fileProperties = document.querySelector(`#${wId} #file-properties`);
                
                const loadFiles = async () => {
                    try {
                        const res = await fetch('/api/output/list');
                        const data = await res.json();
                        
                        if (data.error) {
                            fileList.innerHTML = `<div style="color: #f85149; padding: 20px; text-align: center;">Error: ${data.error}</div>`;
                            return;
                        }
                        
                        let html = '';
                        
                        // Directories first
                        if (data.directories && data.directories.length > 0) {
                            data.directories.forEach(dir => {
                                html += `
                                    <div class="output-item" data-path="${dir.path}" data-type="directory" style="padding: 10px; border: 1px solid #30363d; border-radius: 6px; margin-bottom: 8px; cursor: pointer; transition: all 0.2s; background: rgba(255,255,255,0.02);">
                                        <div style="display: flex; align-items: center; gap: 10px;">
                                            <ion-icon name="folder-outline" style="font-size: 24px; color: #58a6ff;"></ion-icon>
                                            <div style="flex: 1;">
                                                <div style="font-weight: 500; color: #c9d1d9;">${dir.name}</div>
                                                <div style="font-size: 11px; color: #8b949e; margin-top: 2px;">Directory</div>
                                            </div>
                                        </div>
                                    </div>
                                `;
                            });
                        }
                        
                        // Files
                        if (data.files && data.files.length > 0) {
                            data.files.forEach(file => {
                                const size = this.formatFileSize(file.size);
                                html += `
                                    <div class="output-item" data-path="${file.path}" data-type="file" style="padding: 10px; border: 1px solid #30363d; border-radius: 6px; margin-bottom: 8px; cursor: pointer; transition: all 0.2s; background: rgba(255,255,255,0.02);">
                                        <div style="display: flex; align-items: center; gap: 10px;">
                                            <ion-icon name="document-outline" style="font-size: 24px; color: #8b949e;"></ion-icon>
                                            <div style="flex: 1;">
                                                <div style="font-weight: 500; color: #c9d1d9;">${file.name}</div>
                                                <div style="font-size: 11px; color: #8b949e; margin-top: 2px;">${size}</div>
                                            </div>
                                        </div>
                                    </div>
                                `;
                            });
                        }
                        
                        if (!html) {
                            html = '<div style="text-align: center; color: #8b949e; padding: 40px;">No files or directories found</div>';
                        }
                        
                        fileList.innerHTML = html;
                        
                        // Add click handlers
                        document.querySelectorAll(`#${wId} .output-item`).forEach(item => {
                            item.addEventListener('click', () => {
                                const path = item.getAttribute('data-path');
                                const type = item.getAttribute('data-type');
                                this.loadFileProperties(wId, path, type);
                                
                                // Update selected state
                                document.querySelectorAll(`#${wId} .output-item`).forEach(i => {
                                    i.style.background = 'rgba(255,255,255,0.02)';
                                    i.style.borderColor = '#30363d';
                                });
                                item.style.background = 'rgba(88, 166, 255, 0.1)';
                                item.style.borderColor = '#58a6ff';
                            });
                            
                            item.addEventListener('mouseenter', () => {
                                if (item.style.background !== 'rgba(88, 166, 255, 0.1)') {
                                    item.style.background = 'rgba(255,255,255,0.05)';
                                }
                            });
                            
                            item.addEventListener('mouseleave', () => {
                                if (item.style.background !== 'rgba(88, 166, 255, 0.1)') {
                                    item.style.background = 'rgba(255,255,255,0.02)';
                                }
                            });
                        });
                    } catch (err) {
                        fileList.innerHTML = `<div style="color: #f85149; padding: 20px; text-align: center;">Error loading files: ${err.message}</div>`;
                    }
                };
                
                this.loadFileProperties = async (windowId, filePath, type) => {
                    try {
                        const res = await fetch(`/api/output/file/${encodeURIComponent(filePath)}`);
                        const data = await res.json();
                        
                        if (data.error) {
                            return;
                        }
                        
                        const noFileSelectedEl = document.querySelector(`#${windowId} #no-file-selected`);
                        const filePropertiesEl = document.querySelector(`#${windowId} #file-properties`);
                        
                        noFileSelectedEl.style.display = 'none';
                        filePropertiesEl.style.display = 'block';
                        
                        document.querySelector(`#${windowId} #file-properties-name`).textContent = data.name;
                        document.querySelector(`#${windowId} #file-properties-path`).textContent = `output/${data.path}`;
                        document.querySelector(`#${windowId} #file-properties-type`).textContent = data.is_dir ? 'Directory' : (data.extension || 'File');
                        document.querySelector(`#${windowId} #file-properties-size`).textContent = data.size_human || this.formatFileSize(data.size);
                        document.querySelector(`#${windowId} #file-properties-created`).textContent = new Date(data.created).toLocaleString();
                        document.querySelector(`#${windowId} #file-properties-modified`).textContent = new Date(data.modified).toLocaleString();
                        
                        const itemCountContainer = document.querySelector(`#${windowId} #file-properties-item-count-container`);
                        if (data.is_dir && data.item_count !== undefined) {
                            itemCountContainer.style.display = 'block';
                            document.querySelector(`#${windowId} #file-properties-item-count`).textContent = `${data.item_count} item${data.item_count !== 1 ? 's' : ''}`;
                        } else {
                            itemCountContainer.style.display = 'none';
                        }
                        
                        // Store current file path for deletion
                        filePropertiesEl.setAttribute('data-current-path', filePath);
                        filePropertiesEl.setAttribute('data-is-dir', data.is_dir);
                    } catch (err) {
                        console.error('Error loading file properties:', err);
                    }
                };
                
                const deleteFile = async () => {
                    const filePropertiesEl = document.querySelector(`#${wId} #file-properties`);
                    const filePath = filePropertiesEl.getAttribute('data-current-path');
                    const isDir = filePropertiesEl.getAttribute('data-is-dir') === 'true';
                    
                    if (!filePath) {
                        return;
                    }
                    
                    const fileName = filePath.split('/').pop();
                    const confirmMessage = isDir 
                        ? `Are you sure you want to delete the directory "${fileName}" and all its contents?`
                        : `Are you sure you want to delete the file "${fileName}"?`;
                    
                    if (!confirm(confirmMessage)) {
                        return;
                    }
                    
                    try {
                        const res = await fetch(`/api/output/file/${encodeURIComponent(filePath)}`, {
                            method: 'DELETE'
                        });
                        
                        const data = await res.json();
                        
                        if (data.success) {
                            // Hide properties panel
                            filePropertiesEl.style.display = 'none';
                            document.querySelector(`#${wId} #no-file-selected`).style.display = 'flex';
                            
                            // Reload file list
                            loadFiles();
                            
                            // Show success notification
                            this.showNotification(`File "${fileName}" deleted successfully`, 'success', 3000);
                        } else {
                            alert(`Error deleting file: ${data.error || 'Unknown error'}`);
                        }
                    } catch (err) {
                        alert(`Error deleting file: ${err.message}`);
                    }
                };
                
                this.formatFileSize = (bytes) => {
                    if (bytes === 0) return '0 B';
                    const k = 1024;
                    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
                    const i = Math.floor(Math.log(bytes) / Math.log(k));
                    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
                };
                
                // Add delete button handler
                const deleteBtn = document.querySelector(`#${wId} #delete-file-btn`);
                if (deleteBtn) {
                    deleteBtn.addEventListener('click', deleteFile);
                }
                
                // Initial load
                loadFiles();
            }
        });
    }

    spawnNetworkMap() {
        const winId = this.wm.createWindow({
            title: 'Network Map',
            icon: 'map-outline',
            icon: 'git-branch-outline',
            width: '1200px',
            height: '700px',
            headerButtons: `
                <button id="add-target-network-map-btn" class="header-action-btn" title="Add Target">
                    <ion-icon name="add-outline"></ion-icon>
                </button>
                <button id="refresh-network-map-btn" class="header-action-btn" title="Refresh">
                    <ion-icon name="refresh-outline"></ion-icon>
                </button>
                <button id="layout-network-map-btn" class="header-action-btn" title="Auto Layout">
                    <ion-icon name="git-branch-outline"></ion-icon>
                </button>
            `,
            content: `
                <div style="height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif; overflow: hidden; display: flex; flex-direction: column;">
                    <!-- Header -->
                    <div style="padding: 15px 20px; background: rgba(22, 27, 34, 0.9); border-bottom: 1px solid rgba(88, 166, 255, 0.2); backdrop-filter: blur(10px);">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <div>
                                <h2 style="margin: 0; font-size: 20px; font-weight: 600; background: linear-gradient(135deg, #58a6ff 0%, #bc8cff 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">Network Topology</h2>
                                <p style="margin: 3px 0 0 0; color: #8b949e; font-size: 12px;">Visual representation of network connections and compromised systems</p>
                            </div>
                            <div style="display: flex; gap: 15px; align-items: center;">
                                <div style="text-align: center;">
                                    <div id="network-nodes-count" style="font-size: 24px; font-weight: 700; color: #58a6ff; line-height: 1;">0</div>
                                    <div style="font-size: 10px; color: #8b949e; text-transform: uppercase;">Nodes</div>
                                </div>
                                <div style="text-align: center;">
                                    <div id="network-edges-count" style="font-size: 24px; font-weight: 700; color: #3fb950; line-height: 1;">0</div>
                                    <div style="font-size: 10px; color: #8b949e; text-transform: uppercase;">Connections</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Network Graph Container -->
                    <div id="network-map-container" style="flex: 1; position: relative; background: #0d1117;">
                        <div id="network-map-canvas" style="width: 100%; height: 100%;"></div>
                        <!-- Node Info Sidebar (absolute positioned, doesn't affect layout) -->
                        <div id="node-info-sidebar" style="display: none; position: absolute; top: 0; right: 0; width: 320px; height: 100%; background: #161b22; border-left: 1px solid #30363d; padding: 20px; overflow-y: auto; color: #c9d1d9; z-index: 10; box-shadow: -4px 0 12px rgba(0, 0, 0, 0.3);">
                            <div style="margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #30363d;">
                                <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #58a6ff; display: flex; align-items: center; gap: 8px;">
                                    <ion-icon name="information-circle-outline" style="font-size: 22px;"></ion-icon>
                                    Node Info
                                </h3>
                            </div>
                            <div id="node-info-content"></div>
                        </div>
                    </div>
                    
                    <!-- Add Target Modal -->
                    <div id="add-target-modal" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.8); z-index: 10000; align-items: center; justify-content: center;">
                        <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 24px; min-width: 400px; max-width: 500px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);">
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
                                <h3 style="margin: 0; color: #c9d1d9; font-size: 18px; font-weight: 600;">Add Target</h3>
                                <button id="close-add-target-modal" style="background: none; border: none; color: #8b949e; cursor: pointer; font-size: 24px; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">&times;</button>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 16px;">
                                <div>
                                    <label style="display: block; color: #8b949e; font-size: 12px; margin-bottom: 6px;">IP Address *</label>
                                    <input type="text" id="target-ip-input" placeholder="192.168.1.100" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 14px; box-sizing: border-box;">
                                </div>
                                <div>
                                    <label style="display: block; color: #8b949e; font-size: 12px; margin-bottom: 6px;">Hostname (optional)</label>
                                    <input type="text" id="target-hostname-input" placeholder="workstation-01" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 14px; box-sizing: border-box;">
                                </div>
                                <div>
                                    <label style="display: block; color: #8b949e; font-size: 12px; margin-bottom: 6px;">Notes (optional)</label>
                                    <textarea id="target-notes-input" placeholder="Target description or notes..." rows="3" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 14px; box-sizing: border-box; resize: vertical; font-family: inherit;"></textarea>
                                </div>
                                <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 8px;">
                                    <button id="cancel-add-target" style="padding: 10px 20px; background: #21262d; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; cursor: pointer; font-size: 14px; font-weight: 500;">Cancel</button>
                                    <button id="save-add-target" style="padding: 10px 20px; background: #238636; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 14px; font-weight: 500;">Add Target</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Node Context Menu -->
                    <div id="node-context-menu" style="display: none; position: fixed; background: #161b22; border: 1px solid #30363d; border-radius: 6px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4); z-index: 10001; min-width: 200px; padding: 4px;">
                        <div class="context-menu-item" data-action="scan" style="padding: 10px 16px; color: #c9d1d9; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 10px; border-radius: 4px;">
                            <ion-icon name="search-outline" style="font-size: 18px;"></ion-icon>
                            <span>Scan Ports</span>
                        </div>
                        <div class="context-menu-item" data-action="exploit" style="padding: 10px 16px; color: #c9d1d9; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 10px; border-radius: 4px;">
                            <ion-icon name="flash-outline" style="font-size: 18px;"></ion-icon>
                            <span>Run Exploit</span>
                        </div>
                        <div class="context-menu-item" data-action="connect" style="padding: 10px 16px; color: #c9d1d9; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 10px; border-radius: 4px;">
                            <ion-icon name="link-outline" style="font-size: 18px;"></ion-icon>
                            <span>Connect</span>
                        </div>
                        <div style="height: 1px; background: #30363d; margin: 4px 0;"></div>
                        <div class="context-menu-item" data-action="delete" style="padding: 10px 16px; color: #f85149; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 10px; border-radius: 4px;">
                            <ion-icon name="trash-outline" style="font-size: 18px;"></ion-icon>
                            <span>Delete Target</span>
                        </div>
                    </div>
                    
                </div>
            `,
            onLoad: (id) => {
                const wId = id;
                this.initNetworkMap(wId);
                
                // Initialize custom targets storage
                if (!this.customTargets) {
                    this.customTargets = JSON.parse(localStorage.getItem('kittyos_custom_targets') || '[]');
                }
                
                // Add Target button
                const addTargetBtn = document.querySelector(`#${wId} #add-target-network-map-btn`);
                if (addTargetBtn) {
                    addTargetBtn.addEventListener('click', () => {
                        this.showAddTargetModal(wId);
                    });
                }
                
                // Refresh button
                const refreshBtn = document.querySelector(`#${wId} #refresh-network-map-btn`);
                if (refreshBtn) {
                    refreshBtn.addEventListener('click', () => {
                        this.loadNetworkMap(wId);
                    });
                }
                
                // Layout button
                const layoutBtn = document.querySelector(`#${wId} #layout-network-map-btn`);
                if (layoutBtn) {
                    layoutBtn.addEventListener('click', () => {
                        if (this.networkMapInstances && this.networkMapInstances[wId]) {
                            this.networkMapInstances[wId].fit();
                        }
                    });
                }
                
                // Setup context menu handlers
                this.setupNetworkMapContextMenu(wId);
                
                // Auto-refresh every 10 seconds
                setInterval(() => this.loadNetworkMap(wId), 10000);
            }
        });
    }

    initNetworkMap(windowId) {
        if (!this.networkMapInstances) {
            this.networkMapInstances = {};
        }
        if (!this.networkMapDataSets) {
            this.networkMapDataSets = {};
        }
        // Store previous state for comparison
        if (!this.networkMapPreviousState) {
            this.networkMapPreviousState = {};
        }
        
        const container = document.querySelector(`#${windowId} #network-map-canvas`);
        if (!container) {
            console.error('[Network Map] Container not found:', `#${windowId} #network-map-canvas`);
            return;
        }
        
        // Check if vis is available
        if (typeof vis === 'undefined') {
            console.error('[Network Map] vis-network library not loaded');
            return;
        }
        
        console.log('[Network Map] Initializing network for window:', windowId);
        console.log('[Network Map] Container size:', container.offsetWidth, 'x', container.offsetHeight);
        
        // Initialize vis-network
        const nodes = new vis.DataSet([]);
        const edges = new vis.DataSet([]);
        
        const data = { nodes: nodes, edges: edges };
        
        const options = {
            nodes: {
                shape: 'box',
                font: {
                    color: '#c9d1d9',
                    size: 14,
                    face: 'Segoe UI'
                },
                borderWidth: 2,
                shadow: true,
                chosen: {
                    node: function(values, id, selected, hovering) {
                        if (hovering) {
                            values.borderWidth = 4;
                            values.shadow = true;
                        }
                    }
                }
            },
            edges: {
                arrows: {
                    to: { enabled: true, scaleFactor: 1.2 }
                },
                font: {
                    color: '#8b949e',
                    size: 11,
                    align: 'middle',
                    face: 'Segoe UI'
                },
                color: {
                    color: '#58a6ff',
                    highlight: '#bc8cff'
                },
                smooth: {
                    type: 'curvedCW',
                    roundness: 0.2
                },
                width: 2
            },
            physics: {
                enabled: true,
                stabilization: {
                    enabled: true,
                    iterations: 200,
                    fit: true
                },
                barnesHut: {
                    gravitationalConstant: -2000,
                    centralGravity: 0.1,
                    springLength: 200,
                    springConstant: 0.04,
                    damping: 0.09
                }
            },
            interaction: {
                hover: true,
                tooltipDelay: 200,
                zoomView: true,
                dragView: true
            },
            layout: {
                improvedLayout: true
            }
        };
        
        try {
            // Ensure container has dimensions
            if (container.offsetWidth === 0 || container.offsetHeight === 0) {
                console.warn('[Network Map] Container has zero dimensions, waiting...');
                setTimeout(() => {
                    this.initNetworkMap(windowId);
                }, 200);
                return;
            }
            
            const network = new vis.Network(container, data, options);
            this.networkMapInstances[windowId] = network;
            this.networkMapDataSets[windowId] = { nodes, edges };
            
            console.log('[Network Map] Network instance created successfully');
            console.log('[Network Map] Container dimensions:', container.offsetWidth, 'x', container.offsetHeight);
            
            // Load initial data after a short delay to ensure container is rendered
            setTimeout(() => {
                this.loadNetworkMap(windowId);
            }, 100);
        } catch (err) {
            console.error('[Network Map] Error creating network instance:', err);
        }
    }

    loadNetworkMap(windowId) {
        // Fetch sessions, hosts, and targets data
        Promise.all([
            fetch('/api/sessions').then(r => r.json()).catch(() => ({ sessions: [] })),
            fetch('/api/hosts').then(r => r.json()).catch(() => ({ hosts: [] })),
            fetch('/api/targets').then(r => r.json()).catch(() => ({ targets: [] }))
        ]).then(([sessionsData, hostsData, targetsData]) => {
            const sessions = sessionsData.sessions || [];
            const hosts = hostsData.hosts || [];
            const targets = targetsData.targets || [];
            
            // Merge custom targets with API targets
            const customTargets = this.customTargets || [];
            const allTargets = [...targets, ...customTargets];
            
            this.buildNetworkGraph(windowId, sessions, hosts, allTargets);
        }).catch(err => {
            console.error('Error loading network map:', err);
            // Still try to build with empty data, but include custom targets
            const customTargets = this.customTargets || [];
            this.buildNetworkGraph(windowId, [], [], customTargets);
        });
    }

    buildNetworkGraph(windowId, sessions, hosts, targets = []) {
        if (!this.networkMapInstances || !this.networkMapInstances[windowId]) {
            console.error('[Network Map] Network instance not found for window:', windowId);
            return;
        }
        
        const network = this.networkMapInstances[windowId];
        const dataSets = this.networkMapDataSets ? this.networkMapDataSets[windowId] : null;
        if (!dataSets) {
            console.error('[Network Map] DataSets not found for window:', windowId);
            return;
        }
        
        console.log('[Network Map] Building graph for window:', windowId);
        
        const nodes = [];
        const edges = [];
        const nodeMap = new Map();
        let nodeId = 1;
        
        // Add C2 Server (our local server) - always add this node
        const c2Node = {
            id: 'c2',
            label: 'C2 Server\n127.0.0.1',
            color: {
                background: '#bc8cff',
                border: '#9d6fff',
                highlight: { background: '#bc8cff', border: '#ffffff' }
            },
            font: { color: '#ffffff', size: 14, face: 'Segoe UI', bold: true },
            shape: 'box',
            borderWidth: 3,
            x: 0,
            y: 0
        };
        nodes.push(c2Node);
        nodeMap.set('127.0.0.1', 'c2');
        console.log('[Network Map] Added C2 server node:', c2Node);
        
        // Process sessions to create nodes and connections
        sessions.forEach(session => {
            const host = session.host || 'Unknown';
            const ip = host.split(':')[0];
            const port = session.port || 0;
            const isActive = session.active !== false;
            const sessionId = session.id || '';
            const sessionType = session.type || 'unknown';
            
            // Determine node color and style based on status
            let nodeColor = {
                background: '#6e7681', // Grey for inactive/uncompromised
                border: '#8b949e',
                highlight: { background: '#8b949e', border: '#ffffff' }
            };
            
            let nodeShape = 'box';
            let nodeLabel = '';
            
            if (isActive) {
                if (sessionType === 'browser' || sessionType === 'shell' || sessionType === 'meterpreter') {
                    nodeColor = {
                        background: '#3fb950', // Green for active compromised/accessible
                        border: '#2ea043',
                        highlight: { background: '#3fb950', border: '#ffffff' }
                    };
                    nodeShape = 'box';
                }
            } else {
                // Inactive session - use different color and style
                nodeColor = {
                    background: '#6e7681', // Grey for inactive
                    border: '#484f58',
                    highlight: { background: '#8b949e', border: '#ffffff' }
                };
                nodeShape = 'box';
            }
            
            // Create or get node for this host
            let nodeId_key = nodeMap.get(ip);
            if (!nodeId_key) {
                nodeId_key = `node_${nodeId++}`;
                const hostname = hosts.find(h => h.address === ip)?.hostname || 
                               targets.find(t => t.address === ip)?.hostname ||
                               (ip === '127.0.0.1' ? 'C2 Server' : 
                                ip.startsWith('192.168.') ? 'WORKSTATION' :
                                ip.startsWith('10.10.') ? (ip.endsWith('.10') ? 'DC01' : ip.endsWith('.50') ? 'DB-SERVER' : ip.endsWith('.20') ? 'FILE-SRV' : 'HOST') : 'HOST');
                
                const statusLabel = isActive ? '✓ Active' : '✗ Inactive';
                nodeLabel = `${hostname}\n${ip}\n${statusLabel}`;
                
                nodes.push({
                    id: nodeId_key,
                    label: nodeLabel,
                    color: nodeColor,
                    font: { color: isActive ? '#c9d1d9' : '#8b949e', size: 13, face: 'Segoe UI' },
                    shape: nodeShape,
                    borderWidth: isActive ? 2 : 1,
                    opacity: isActive ? 1.0 : 0.6
                });
                nodeMap.set(ip, nodeId_key);
            } else {
                // Update existing node
                const existingNode = nodes.find(n => n.id === nodeId_key);
                if (existingNode) {
                    const hostname = hosts.find(h => h.address === ip)?.hostname || 
                                   targets.find(t => t.address === ip)?.hostname ||
                                   existingNode.label.split('\n')[0] || 'HOST';
                    const statusLabel = isActive ? '✓ Active' : '✗ Inactive';
                    existingNode.label = `${hostname}\n${ip}\n${statusLabel}`;
                    
                    if (isActive && (sessionType === 'browser' || sessionType === 'shell' || sessionType === 'meterpreter')) {
                        existingNode.color = {
                            background: '#3fb950',
                            border: '#2ea043',
                            highlight: { background: '#3fb950', border: '#ffffff' }
                        };
                        existingNode.font = { color: '#c9d1d9', size: 13, face: 'Segoe UI' };
                        existingNode.borderWidth = 2;
                        existingNode.opacity = 1.0;
                    } else if (!isActive) {
                        existingNode.color = {
                            background: '#6e7681',
                            border: '#484f58',
                            highlight: { background: '#8b949e', border: '#ffffff' }
                        };
                        existingNode.font = { color: '#8b949e', size: 13, face: 'Segoe UI' };
                        existingNode.borderWidth = 1;
                        existingNode.opacity = 0.6;
                    }
                }
            }
            
            // Create connection from C2 to this host (only for active sessions)
            if (ip !== '127.0.0.1' && isActive) {
                const protocol = sessionType === 'browser' ? 'HTTP' : 
                               sessionType === 'http' ? 'HTTPS' : 
                               sessionType === 'shell' ? 'SMB' : 'SSH';
                
                // Check if edge already exists
                const edgeExists = edges.some(e => 
                    (e.from === 'c2' && e.to === nodeId_key) || 
                    (e.from === nodeId_key && e.to === 'c2')
                );
                
                if (!edgeExists) {
                    const edgeColor = protocol === 'HTTP' || protocol === 'HTTPS' ? '#bc8cff' : '#3fb950';
                    const edgeStyle = protocol === 'SMB' || protocol === 'SSH' ? 'dash' : 'line';
                    
                    edges.push({
                        from: 'c2',
                        to: nodeId_key,
                        label: protocol,
                        color: {
                            color: edgeColor,
                            highlight: '#ffffff'
                        },
                        dashes: edgeStyle === 'dash',
                        width: 2,
                        font: { color: '#8b949e', size: 11, align: 'middle' }
                    });
                }
            }
        });
        
        // Add targets (hosts used by modules) that are not already in sessions
        targets.forEach(target => {
            const ip = target.address;
            if (ip === '127.0.0.1') return; // Skip C2 server
            
            // Check if this target is already represented by a session
            const hasSession = sessions.some(s => {
                const sessionHost = s.host || 'Unknown';
                return sessionHost.split(':')[0] === ip;
            });
            
            if (!hasSession) {
                // This is a target but not an active session
                let nodeId_key = nodeMap.get(ip);
                if (!nodeId_key) {
                    nodeId_key = `node_${nodeId++}`;
                    const hostname = target.hostname || 
                                   hosts.find(h => h.address === ip)?.hostname ||
                                   'Target';
                    
                    nodes.push({
                        id: nodeId_key,
                        label: `${hostname}\n${ip}\nTarget`,
                        color: {
                            background: '#ffa657', // Orange for targets
                            border: '#ff8c42',
                            highlight: { background: '#ffa657', border: '#ffffff' }
                        },
                        font: { color: '#ffffff', size: 13, face: 'Segoe UI' },
                        shape: 'box',
                        borderWidth: 2
                    });
                    nodeMap.set(ip, nodeId_key);
                    
                    // Create connection from C2 to target (dashed line to show it's a target, not active session)
                    edges.push({
                        from: 'c2',
                        to: nodeId_key,
                        label: 'Target',
                        color: {
                            color: '#ffa657',
                            highlight: '#ffffff'
                        },
                        dashes: true,
                        width: 1.5,
                        font: { color: '#8b949e', size: 10, align: 'middle' }
                    });
                }
            }
        });
        
        // Smart incremental update - compare with previous state
        const previousState = this.networkMapPreviousState[windowId];
        const isFirstLoad = !previousState;
        
        const currentNodesMap = new Map();
        const currentEdgesMap = new Map(); // Store edge objects with their keys
        
        // Build current state maps for comparison
        nodes.forEach(node => {
            // Store a simplified version for comparison (without position data that changes)
            const nodeForComparison = {
                id: node.id,
                label: node.label,
                color: node.color,
                font: node.font,
                shape: node.shape,
                borderWidth: node.borderWidth,
                opacity: node.opacity
            };
            currentNodesMap.set(node.id, { full: node, comparison: nodeForComparison });
        });
        
        edges.forEach(edge => {
            const edgeKey = `${edge.from}->${edge.to}`;
            currentEdgesMap.set(edgeKey, edge);
        });
        
        // Variables for tracking changes (declared outside if/else for scope)
        let nodesToAdd = [];
        let nodesToUpdate = [];
        let nodesToRemove = [];
        let edgesToAdd = [];
        let edgesToRemove = [];
        let hasChanges = false;
        
        // If first load, just add everything
        if (isFirstLoad) {
            console.log(`[Network Map] First load: adding ${nodes.length} nodes and ${edges.length} edges`);
            if (nodes.length > 0) {
                dataSets.nodes.add(nodes);
            }
            if (edges.length > 0) {
                dataSets.edges.add(edges);
            }
            
            // Store state for next comparison
            this.networkMapPreviousState[windowId] = {
                nodes: new Map(currentNodesMap),
                edges: new Set(currentEdgesMap.keys())
            };
            
            network.redraw();
            hasChanges = true; // First load is considered a change
        } else {
            // Compare and determine what changed
            // Check nodes
            const previousNodeIds = new Set(previousState.nodes.keys());
            const currentNodeIds = new Set(currentNodesMap.keys());
            
            // Nodes to add or update
            currentNodesMap.forEach((nodeData, id) => {
                if (!previousState.nodes.has(id)) {
                    nodesToAdd.push(nodeData.full);
                } else {
                    // Check if node data changed (compare simplified versions)
                    const prevNodeData = previousState.nodes.get(id);
                    const nodeChanged = JSON.stringify(prevNodeData.comparison) !== JSON.stringify(nodeData.comparison);
                    if (nodeChanged) {
                        nodesToUpdate.push(nodeData.full);
                    }
                }
            });
            
            // Nodes to remove
            previousNodeIds.forEach(id => {
                if (!currentNodesMap.has(id)) {
                    nodesToRemove.push(id);
                }
            });
            
            // Check edges
            const previousEdgeKeys = new Set(previousState.edges);
            const currentEdgeKeys = new Set(currentEdgesMap.keys());
            
            // Edges to add
            currentEdgesMap.forEach((edge, edgeKey) => {
                if (!previousState.edges.has(edgeKey)) {
                    edgesToAdd.push(edge);
                }
            });
            
            // Edges to remove - find by from/to in current dataset
            previousEdgeKeys.forEach(edgeKey => {
                if (!currentEdgesMap.has(edgeKey)) {
                    const [from, to] = edgeKey.split('->');
                    const existingEdges = dataSets.edges.get();
                    const edgeToRemove = existingEdges.find(e => e.from === from && e.to === to);
                    if (edgeToRemove && edgeToRemove.id) {
                        edgesToRemove.push(edgeToRemove.id);
                    }
                }
            });
            
            // Only update if there are changes
            hasChanges = nodesToAdd.length > 0 || nodesToUpdate.length > 0 || nodesToRemove.length > 0 ||
                              edgesToAdd.length > 0 || edgesToRemove.length > 0;
            
            if (hasChanges) {
                console.log(`[Network Map] Incremental update: +${nodesToAdd.length} nodes, ~${nodesToUpdate.length} nodes, -${nodesToRemove.length} nodes, +${edgesToAdd.length} edges, -${edgesToRemove.length} edges`);
                
                // Apply incremental updates in correct order
                if (nodesToRemove.length > 0) {
                    dataSets.nodes.remove(nodesToRemove);
                }
                if (edgesToRemove.length > 0) {
                    dataSets.edges.remove(edgesToRemove);
                }
                if (nodesToAdd.length > 0) {
                    dataSets.nodes.add(nodesToAdd);
                }
                if (nodesToUpdate.length > 0) {
                    dataSets.nodes.update(nodesToUpdate);
                }
                if (edgesToAdd.length > 0) {
                    dataSets.edges.add(edgesToAdd);
                }
                
                // Update previous state
                this.networkMapPreviousState[windowId] = {
                    nodes: new Map(currentNodesMap),
                    edges: new Set(currentEdgesMap.keys())
                };
                
                // Smooth animation for new nodes
                if (nodesToAdd.length > 0 || edgesToAdd.length > 0) {
                    // Slight delay to allow vis-network to animate new elements
                    setTimeout(() => {
                        network.redraw();
                    }, 50);
                } else {
                    network.redraw();
                }
            } else {
                console.log('[Network Map] No changes detected, skipping update');
            }
        }
        
        // Update stats
        const nodesCountEl = document.querySelector(`#${windowId} #network-nodes-count`);
        const edgesCountEl = document.querySelector(`#${windowId} #network-edges-count`);
        if (nodesCountEl) nodesCountEl.textContent = nodes.length;
        if (edgesCountEl) edgesCountEl.textContent = edges.length;
        
        // Only fit if there are new nodes or if it's the first load
        if (isFirstLoad) {
            setTimeout(() => {
                try {
                    if (nodes.length > 0) {
                        network.fit({ animation: true });
                    }
                } catch (err) {
                    console.error('[Network Map] Error fitting network:', err);
                }
            }, 300);
        } else if (hasChanges && nodesToAdd && nodesToAdd.length > 0) {
            // Only fit if new nodes were added (not just updates)
            setTimeout(() => {
                try {
                    network.fit({ animation: true });
                } catch (err) {
                    console.error('[Network Map] Error fitting network:', err);
                }
            }, 300);
        }
    }

    showAddTargetModal(windowId) {
        const modal = document.querySelector(`#${windowId} #add-target-modal`);
        if (!modal) return;
        
        // Reset form
        const ipInput = document.querySelector(`#${windowId} #target-ip-input`);
        const hostnameInput = document.querySelector(`#${windowId} #target-hostname-input`);
        const notesInput = document.querySelector(`#${windowId} #target-notes-input`);
        
        if (ipInput) ipInput.value = '';
        if (hostnameInput) hostnameInput.value = '';
        if (notesInput) notesInput.value = '';
        
        modal.style.display = 'flex';
        
        // Focus on IP input
        if (ipInput) {
            setTimeout(() => ipInput.focus(), 100);
        }
    }

    hideAddTargetModal(windowId) {
        const modal = document.querySelector(`#${windowId} #add-target-modal`);
        if (modal) {
            modal.style.display = 'none';
        }
    }

    saveCustomTarget(windowId, ip, hostname, notes) {
        if (!ip || !ip.trim()) {
            this.showNotification('IP address is required', 'error', 3000);
            return false;
        }
        
        // Validate IP format (basic)
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipRegex.test(ip.trim())) {
            this.showNotification('Invalid IP address format', 'error', 3000);
            return false;
        }
        
        if (!this.customTargets) {
            this.customTargets = [];
        }
        
        // Check if target already exists
        const existingIndex = this.customTargets.findIndex(t => t.address === ip.trim());
        const targetData = {
            address: ip.trim(),
            hostname: hostname ? hostname.trim() : '',
            notes: notes ? notes.trim() : '',
            addedAt: new Date().toISOString()
        };
        
        if (existingIndex >= 0) {
            // Update existing
            this.customTargets[existingIndex] = targetData;
            this.showNotification('Target updated', 'success', 2000);
        } else {
            // Add new
            this.customTargets.push(targetData);
            this.showNotification('Target added', 'success', 2000);
        }
        
        // Save to localStorage
        localStorage.setItem('kittyos_custom_targets', JSON.stringify(this.customTargets));
        
        // Reload network map
        this.loadNetworkMap(windowId);
        
        return true;
    }

    deleteCustomTarget(windowId, ip) {
        if (!this.customTargets) return false;
        
        const index = this.customTargets.findIndex(t => t.address === ip);
        if (index >= 0) {
            this.customTargets.splice(index, 1);
            localStorage.setItem('kittyos_custom_targets', JSON.stringify(this.customTargets));
            this.showNotification('Target deleted', 'success', 2000);
            this.loadNetworkMap(windowId);
            return true;
        }
        return false;
    }

    setupNetworkMapContextMenu(windowId) {
        const modal = document.querySelector(`#${windowId} #add-target-modal`);
        const contextMenu = document.querySelector(`#${windowId} #node-context-menu`);
        
        if (!modal || !contextMenu) return;
        
        // Close modal handlers
        const closeBtn = document.querySelector(`#${windowId} #close-add-target-modal`);
        const cancelBtn = document.querySelector(`#${windowId} #cancel-add-target`);
        const saveBtn = document.querySelector(`#${windowId} #save-add-target`);
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hideAddTargetModal(windowId));
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.hideAddTargetModal(windowId));
        }
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const ip = document.querySelector(`#${windowId} #target-ip-input`)?.value;
                const hostname = document.querySelector(`#${windowId} #target-hostname-input`)?.value;
                const notes = document.querySelector(`#${windowId} #target-notes-input`)?.value;
                
                if (this.saveCustomTarget(windowId, ip, hostname, notes)) {
                    this.hideAddTargetModal(windowId);
                }
            });
        }
        
        // Close modal on outside click
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hideAddTargetModal(windowId);
                }
            });
        }
        
        // Context menu handlers
        const network = this.networkMapInstances?.[windowId];
        if (!network) return;
        
        let selectedNodeId = null;
        let selectedNodeData = null;
        
        // Sidebar elements
        const sidebar = document.querySelector(`#${windowId} #node-info-sidebar`);
        const sidebarContent = document.querySelector(`#${windowId} #node-info-content`);
        let sidebarTimeout = null;
        let currentHoveredNode = null;
        
        // Hover to show sidebar
        network.on('hoverNode', (params) => {
            if (sidebarTimeout) {
                clearTimeout(sidebarTimeout);
            }
            
            const nodeId = params.node;
            if (!nodeId) return;
            
            currentHoveredNode = nodeId;
            
            // Small delay before showing sidebar
            sidebarTimeout = setTimeout(() => {
                // Check if still hovering the same node
                if (currentHoveredNode !== nodeId) return;
                
                if (!sidebar || !sidebarContent) {
                    console.warn('[Network Map] Sidebar elements not found');
                    return;
                }
                
                const nodes = this.networkMapDataSets[windowId]?.nodes;
                if (!nodes) {
                    console.warn('[Network Map] Nodes dataset not found');
                    return;
                }
                
                const nodeData = nodes.get(nodeId);
                if (!nodeData) {
                    console.warn('[Network Map] Node data not found for:', nodeId);
                    return;
                }
                
                // Extract IP from node label - try multiple methods
                let targetIp = null;
                if (nodeData.label) {
                    const lines = nodeData.label.split('\n');
                    // Try to find IP in any line (look for IP pattern)
                    for (const line of lines) {
                        const trimmed = line.trim();
                        // Check if line looks like an IP address
                        const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
                        if (ipPattern.test(trimmed)) {
                            targetIp = trimmed;
                            break;
                        }
                    }
                    // Fallback: if no IP found, use second line (common case)
                    if (!targetIp && lines.length > 1) {
                        targetIp = lines[1].trim();
                    }
                }
                
                // Also check node ID for C2 server
                if (nodeId === 'c2') {
                    targetIp = '127.0.0.1';
                }
                
                // Show sidebar for any node (even without IP, we can show basic info)
                if (targetIp || nodeId === 'c2') {
                    // Build sidebar content
                    this.buildNodeTooltip(windowId, nodeId, nodeData, targetIp || 'Unknown', sidebarContent);
                    
                    // Show sidebar
                    sidebar.style.display = 'block';
                } else {
                    // Show basic info even if no IP found
                    this.buildNodeTooltip(windowId, nodeId, nodeData, 'Unknown', sidebarContent);
                    sidebar.style.display = 'block';
                }
            }, 300); // 300ms delay before showing sidebar
        });
        
        // Hide sidebar when not hovering (with delay to allow moving to sidebar)
        network.on('blurNode', () => {
            currentHoveredNode = null;
            if (sidebarTimeout) {
                clearTimeout(sidebarTimeout);
                sidebarTimeout = null;
            }
            
            // Delay hiding to allow user to move mouse to sidebar
            setTimeout(() => {
                if (currentHoveredNode === null && sidebar) {
                    // Check if mouse is over sidebar
                    const sidebarRect = sidebar.getBoundingClientRect();
                    const mouseX = window.event?.clientX || 0;
                    const mouseY = window.event?.clientY || 0;
                    
                    if (!(mouseX >= sidebarRect.left && mouseX <= sidebarRect.right &&
                          mouseY >= sidebarRect.top && mouseY <= sidebarRect.bottom)) {
                        sidebar.style.display = 'none';
                    }
                }
            }, 200);
        });
        
        // Keep sidebar visible when hovering over it
        if (sidebar) {
            sidebar.addEventListener('mouseenter', () => {
                currentHoveredNode = 'sidebar'; // Keep sidebar open
            });
            sidebar.addEventListener('mouseleave', () => {
                currentHoveredNode = null;
                setTimeout(() => {
                    if (currentHoveredNode === null) {
                        sidebar.style.display = 'none';
                    }
                }, 300);
            });
        }
        
        // Right-click to show context menu using vis-network events
        network.on('oncontext', (params) => {
            params.event.preventDefault();
            selectedNodeId = params.nodes.length > 0 ? params.nodes[0] : null;
            
            if (selectedNodeId) {
                const nodes = this.networkMapDataSets[windowId]?.nodes;
                if (nodes) {
                    const nodeData = nodes.get(selectedNodeId);
                    selectedNodeData = nodeData;
                    
                    // Position context menu at mouse position
                    contextMenu.style.display = 'block';
                    contextMenu.style.left = params.event.clientX + 'px';
                    contextMenu.style.top = params.event.clientY + 'px';
                }
            } else {
                // Clicked on empty space, hide menu
                contextMenu.style.display = 'none';
            }
        });
        
        // Click outside to hide context menu
        document.addEventListener('click', (e) => {
            if (!contextMenu.contains(e.target)) {
                contextMenu.style.display = 'none';
            }
        });
        
        // Context menu actions
        const menuItems = contextMenu.querySelectorAll('.context-menu-item');
        menuItems.forEach(item => {
            item.addEventListener('click', () => {
                const action = item.getAttribute('data-action');
                contextMenu.style.display = 'none';
                
                if (selectedNodeId && selectedNodeData) {
                    this.handleNodeAction(windowId, selectedNodeId, selectedNodeData, action);
                }
            });
            
            // Hover effect
            item.addEventListener('mouseenter', () => {
                item.style.background = '#21262d';
            });
            item.addEventListener('mouseleave', () => {
                item.style.background = 'transparent';
            });
        });
    }

    handleNodeAction(windowId, nodeId, nodeData, action) {
        // Extract IP from node label or data
        let targetIp = null;
        if (nodeData && nodeData.label) {
            const lines = nodeData.label.split('\n');
            // IP is usually on the second line
            if (lines.length > 1) {
                targetIp = lines[1].trim();
            }
        }
        
        if (!targetIp || targetIp === '127.0.0.1') {
            this.showNotification('Cannot perform action on C2 server', 'warning', 2000);
            return;
        }
        
        switch (action) {
            case 'scan':
                this.scanNodeTarget(windowId, targetIp);
                break;
            case 'exploit':
                this.exploitNodeTarget(windowId, targetIp);
                break;
            case 'connect':
                this.connectToNode(windowId, targetIp);
                break;
            case 'delete':
                if (confirm(`Delete target ${targetIp}?`)) {
                    this.deleteCustomTarget(windowId, targetIp);
                }
                break;
        }
    }

    buildNodeTooltip(windowId, nodeId, nodeData, ip, sidebarContentEl) {
        const target = this.customTargets?.find(t => t.address === ip);
        const hostname = target?.hostname || nodeData?.label?.split('\n')[0] || (ip === '127.0.0.1' ? 'C2 Server' : 'Unknown');
        const notes = target?.notes || '';
        const status = nodeData?.label?.includes('Active') ? 'Active' : (ip === '127.0.0.1' ? 'C2 Server' : 'Inactive');
        const addedAt = target?.addedAt || null;
        
        // Build sidebar HTML
        let sidebarHTML = `
            <div style="display: flex; flex-direction: column; gap: 20px;">
                <div style="padding: 16px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
                        <ion-icon name="server-outline" style="font-size: 24px; color: #58a6ff;"></ion-icon>
                        <div style="font-size: 18px; font-weight: 600; color: #c9d1d9;">${hostname}</div>
                    </div>
                    
                    <div style="display: flex; flex-direction: column; gap: 12px; padding-top: 12px; border-top: 1px solid #30363d;">
                        <div>
                            <div style="font-size: 11px; color: #8b949e; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">IP Address</div>
                            <div style="font-size: 15px; color: #c9d1d9; font-family: monospace; font-weight: 500;">${ip}</div>
                        </div>
                        
                        <div>
                            <div style="font-size: 11px; color: #8b949e; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Status</div>
                            <div style="font-size: 15px; color: ${status === 'Active' ? '#3fb950' : (status === 'C2 Server' ? '#bc8cff' : '#8b949e')};">
                                <span style="display: inline-flex; align-items: center; gap: 6px;">
                                    <ion-icon name="${status === 'Active' ? 'checkmark-circle' : (status === 'C2 Server' ? 'server' : 'close-circle')}" style="font-size: 18px;"></ion-icon>
                                    ${status}
                                </span>
                            </div>
                        </div>
        `;
        
        if (notes) {
            sidebarHTML += `
                        <div>
                            <div style="font-size: 11px; color: #8b949e; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Notes</div>
                            <div style="font-size: 14px; color: #c9d1d9; line-height: 1.5; white-space: pre-wrap;">${notes}</div>
                        </div>
            `;
        }
        
        if (addedAt) {
            sidebarHTML += `
                        <div>
                            <div style="font-size: 11px; color: #8b949e; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Added</div>
                            <div style="font-size: 13px; color: #8b949e;">${new Date(addedAt).toLocaleString()}</div>
                        </div>
            `;
        }
        
        sidebarHTML += `
                    </div>
                </div>
                
                <div id="node-info-dynamic-content" style="display: flex; flex-direction: column; gap: 16px;">
                    <div style="text-align: center; color: #8b949e; font-size: 13px; padding: 20px;">
                        <ion-icon name="hourglass-outline" style="font-size: 24px; opacity: 0.5;"></ion-icon>
                        <div style="margin-top: 8px;">Loading additional info...</div>
                    </div>
                </div>
            </div>
        `;
        
        sidebarContentEl.innerHTML = sidebarHTML;
        
        // Load session/host data asynchronously and update sidebar
        Promise.all([
            fetch('/api/sessions').then(r => r.json()).catch(() => ({ sessions: [] })),
            fetch('/api/hosts').then(r => r.json()).catch(() => ({ hosts: [] }))
        ]).then(([sessionsData, hostsData]) => {
            const sessions = sessionsData.sessions || [];
            const session = sessions.find(s => {
                const host = s.host || 'Unknown';
                return host.split(':')[0] === ip;
            });
            
            const hosts = hostsData.hosts || [];
            const host = hosts.find(h => h.address === ip);
            
            // Update sidebar with additional info
            const dynamicContent = sidebarContentEl.querySelector('#node-info-dynamic-content');
            if (dynamicContent) {
                let additionalInfo = '';
                
                if (session) {
                    additionalInfo += `
                        <div style="padding: 16px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                                <ion-icon name="link-outline" style="font-size: 20px; color: #3fb950;"></ion-icon>
                                <div style="font-size: 14px; font-weight: 600; color: #c9d1d9; text-transform: uppercase; letter-spacing: 0.5px;">Active Session</div>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 1px solid #30363d;">
                                <div>
                                    <div style="font-size: 11px; color: #8b949e; margin-bottom: 4px;">Type</div>
                                    <div style="font-size: 14px; color: #c9d1d9;">
                                        <span style="color: #58a6ff; font-weight: 500;">${session.type || 'unknown'}</span>
                                    </div>
                                </div>
                                ${session.port ? `
                                <div>
                                    <div style="font-size: 11px; color: #8b949e; margin-bottom: 4px;">Port</div>
                                    <div style="font-size: 14px; color: #c9d1d9;">
                                        <span style="color: #58a6ff; font-weight: 500;">${session.port}</span>
                                    </div>
                                </div>
                                ` : ''}
                                ${session.id ? `
                                <div>
                                    <div style="font-size: 11px; color: #8b949e; margin-bottom: 4px;">Session ID</div>
                                    <div style="font-size: 12px; color: #8b949e; font-family: monospace;">${session.id}</div>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                    `;
                }
                
                if (host) {
                    additionalInfo += `
                        <div style="padding: 16px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                                <ion-icon name="desktop-outline" style="font-size: 20px; color: #58a6ff;"></ion-icon>
                                <div style="font-size: 14px; font-weight: 600; color: #c9d1d9; text-transform: uppercase; letter-spacing: 0.5px;">Host Details</div>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 1px solid #30363d;">
                                <div>
                                    <div style="font-size: 11px; color: #8b949e; margin-bottom: 4px;">Operating System</div>
                                    <div style="font-size: 14px; color: #c9d1d9;">
                                        <span style="color: #58a6ff; font-weight: 500;">${host.os || 'Unknown'}</span>
                                    </div>
                                </div>
                                ${host.vulnerabilities && host.vulnerabilities.length > 0 ? `
                                <div>
                                    <div style="font-size: 11px; color: #8b949e; margin-bottom: 4px;">Vulnerabilities</div>
                                    <div style="font-size: 14px; color: #f85149; font-weight: 500;">
                                        <ion-icon name="warning-outline" style="font-size: 16px; vertical-align: middle;"></ion-icon>
                                        ${host.vulnerabilities.length} found
                                    </div>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                    `;
                }
                
                if (!session && !host) {
                    additionalInfo = `
                        <div style="text-align: center; color: #8b949e; font-size: 13px; padding: 20px;">
                            <ion-icon name="information-circle-outline" style="font-size: 24px; opacity: 0.5;"></ion-icon>
                            <div style="margin-top: 8px;">No additional information available</div>
                        </div>
                    `;
                }
                
                dynamicContent.innerHTML = additionalInfo || '<div style="display: none;"></div>';
            }
        });
    }

    scanNodeTarget(windowId, ip) {
        this.showNotification(`Starting port scan on ${ip}...`, 'info', 2000);
        
        // Open terminal with scan command
        const terminalId = 'term_' + Math.floor(Math.random() * 1000000);
        const scanCommand = `scanners/port_scan target=${ip} ports=22,80,443,3389,8080,8443`;
        
        // Spawn terminal and send command after it's ready
        this.spawnTerminal(scanCommand);
    }

    exploitNodeTarget(windowId, ip) {
        this.showNotification(`Opening exploit modules for ${ip}...`, 'info', 2000);
        
        // Open modules window
        this.openApp('modules');
        
        // Store target IP for modules window to use
        if (!window.kittyosTargetPreset) {
            window.kittyosTargetPreset = {};
        }
        window.kittyosTargetPreset.target = ip;
        window.kittyosTargetPreset.timestamp = Date.now();
        
        // Show notification with instructions
        setTimeout(() => {
            this.showNotification(`Target ${ip} preset. Select an exploit module and use 'target=${ip}'`, 'info', 4000);
        }, 1000);
    }

    connectToNode(windowId, ip) {
        this.showNotification(`Opening VNC client for ${ip}...`, 'info', 2000);
        
        // Open VNC client
        const vncWinId = this.spawnVNCClient();
        
        // Pre-fill VNC connection details after window is created
        // Use interval to wait for DOM to be ready
        let attempts = 0;
        const maxAttempts = 20; // 2 seconds max wait
        const checkInterval = setInterval(() => {
            attempts++;
            const vncHostInput = document.querySelector(`#${vncWinId} #vnc-host`);
            const vncPortInput = document.querySelector(`#${vncWinId} #vnc-port`);
            
            if (vncHostInput && vncPortInput) {
                clearInterval(checkInterval);
                vncHostInput.value = ip;
                vncPortInput.value = '5900'; // Default VNC port
                this.showNotification(`VNC connection details pre-filled for ${ip}:5900`, 'success', 3000);
            } else if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                this.showNotification(`VNC client opened. Please enter connection details manually.`, 'warning', 3000);
            }
        }, 100);
    }

    spawnInterpreter() {
        const interpreterId = 'interp_' + Math.floor(Math.random() * 1000000);
        let termInstance = null;

        const winId = this.wm.createWindow({
            title: 'KittyPy Interpreter',
            icon: 'code-slash-outline',
            width: '900px',
            height: '600px',
            content: `<div id="${interpreterId}_container" style="height: 100%; background: #0d1117;"></div>`,
            onClose: () => {
                if (termInstance && termInstance.dispose) {
                    termInstance.dispose();
                }
            },
            onLoad: (id) => {
                const container = document.querySelector(`#${id} #${interpreterId}_container`);
                if (!container) return;

                // Initialize XTerm.js terminal
                const { Terminal } = window;
                if (!Terminal) {
                    container.innerHTML = '<div style="color: #f85149; padding: 20px;">XTerm.js not loaded</div>';
                    return;
                }

                termInstance = new Terminal({
                    cursorBlink: true,
                    theme: {
                        background: '#0d1117',
                        foreground: '#c9d1d9',
                        cursor: '#58a6ff',
                        black: '#0d1117',
                        red: '#ff7b72',
                        green: '#3fb950',
                        yellow: '#d29922',
                        blue: '#58a6ff',
                        magenta: '#bc8cff',
                        cyan: '#76e3ea',
                        white: '#c9d1d9'
                    },
                    fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
                    fontSize: 14,
                    lineHeight: 1.2
                });

                const fitAddon = new window.FitAddon.FitAddon();
                termInstance.loadAddon(fitAddon);
                termInstance.open(container);
                fitAddon.fit();

                // Welcome message
                termInstance.writeln('\x1b[36mKittyPy Interactive Interpreter\x1b[0m');
                termInstance.writeln('\x1b[90mType Python code to execute. Use exit() to quit.\x1b[0m');
                termInstance.writeln('\x1b[90mFramework objects available: framework, module_loader, db_manager, etc.\x1b[0m');
                termInstance.writeln('');

                let currentLine = '';
                let isMultiline = false;
                let multilineBuffer = '';
                const prompt = () => {
                    // Reset to beginning of line and clear it
                    termInstance.write('\r\x1b[K');
                    if (isMultiline) {
                        termInstance.write('\x1b[90m...\x1b[0m ');
                    } else {
                        termInstance.write('\x1b[36mkittypy>\x1b[0m ');
                    }
                };

                prompt();

                // Handle input
                termInstance.onData(e => {
                    switch (e) {
                        case '\r': // Enter
                            termInstance.write('\r\n');
                            
                            if (isMultiline) {
                                multilineBuffer += currentLine + '\n';
                                currentLine = '';
                                
                                // Check if we should continue multiline or execute
                                const trimmed = multilineBuffer.trim();
                                if (trimmed && !trimmed.endsWith(':') && !trimmed.endsWith('\\')) {
                                    // Execute multiline code
                                    executeCode(multilineBuffer);
                                    multilineBuffer = '';
                                    isMultiline = false;
                                } else {
                                    prompt();
                                }
                            } else {
                                const trimmed = currentLine.trim();
                                
                                if (!trimmed) {
                                    prompt();
                                    currentLine = '';
                                    break;
                                }
                                
                                // Check for exit
                                if (trimmed === 'exit()' || trimmed === 'exit') {
                                    termInstance.writeln('\x1b[90mExiting interpreter...\x1b[0m');
                                    this.wm.closeWindow(winId);
                                    return;
                                }
                                
                                // Check if this looks like multiline (ends with : or \)
                                if (trimmed.endsWith(':') || trimmed.endsWith('\\')) {
                                    isMultiline = true;
                                    multilineBuffer = currentLine + '\n';
                                    currentLine = '';
                                    prompt();
                                } else {
                                    // Execute single line
                                    executeCode(currentLine);
                                    currentLine = '';
                                    prompt();
                                }
                            }
                            break;
                            
                        case '\u007F': // Backspace
                            if (currentLine.length > 0) {
                                termInstance.write('\b \b');
                                currentLine = currentLine.substring(0, currentLine.length - 1);
                            }
                            break;
                            
                        case '\u0003': // Ctrl+C
                            termInstance.write('^C\r\n');
                            currentLine = '';
                            multilineBuffer = '';
                            isMultiline = false;
                            prompt();
                            break;
                            
                        default:
                            if ((e >= ' ' && e <= '~') || e === '\n' || e === '\t') {
                                if (!isMultiline) {
                                    currentLine += e;
                                    termInstance.write(e);
                                } else {
                                    // In multiline mode, just add to buffer
                                    currentLine += e;
                                    termInstance.write(e);
                                }
                            }
                            break;
                    }
                });

                // Execute Python code
                const executeCode = async (code) => {
                    try {
                        const response = await fetch('/api/interpreter/execute', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                code: code,
                                session_id: interpreterId
                            })
                        });

                        const data = await response.json();

                        if (data.error) {
                            termInstance.write(`\x1b[91mError: ${data.error}\x1b[0m\r\n`);
                            if (data.traceback) {
                                termInstance.write(`\x1b[90m${data.traceback}\x1b[0m\r\n`);
                            }
                        } else {
                            if (data.output) {
                                termInstance.write(data.output);
                            }
                            if (data.error) {
                                termInstance.write(`\x1b[91m${data.error}\x1b[0m\r\n`);
                            }
                        }
                        
                        // Always show prompt after execution (on new line)
                        termInstance.write('\r\n');
                        prompt();
                    } catch (err) {
                        termInstance.write(`\x1b[91mError executing code: ${err.message}\x1b[0m\r\n`);
                        prompt();
                    }
                };

                // Handle window resize
                const handleResize = () => {
                    fitAddon.fit();
                };
                window.addEventListener('resize', handleResize);
                
                // Store cleanup
                const winObj = this.wm.windows.find(w => w.id === winId);
                if (winObj) {
                    const originalOnClose = winObj.onClose;
                    winObj.onClose = () => {
                        window.removeEventListener('resize', handleResize);
                        if (originalOnClose) originalOnClose();
                    };
                }
            }
        });
    }

    spawnSessionManager() {
        const winId = this.wm.createWindow({
            title: 'Session Manager',
            icon: 'people-outline',
            width: '1400px',
            height: '800px',
            headerButtons: `
                <button id="refresh-sessions-btn" class="header-action-btn" title="Refresh">
                    <ion-icon name="refresh-outline"></ion-icon>
                </button>
            `,
            content: `
                <div style="display: flex; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif;">
                    <!-- Left Panel: Sessions List -->
                    <div style="width: 400px; border-right: 1px solid #30363d; display: flex; flex-direction: column; background: #161b22;">
                        <!-- Filters -->
                        <div style="padding: 15px; border-bottom: 1px solid #30363d;">
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                                <h3 style="margin: 0; font-size: 16px; color: #58a6ff;">Sessions</h3>
                                <span id="sessions-count" style="font-size: 12px; color: #8b949e;">0</span>
                            </div>
                            <div style="position: relative; margin-bottom: 10px;">
                                <ion-icon name="search-outline" style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: #8b949e; font-size: 16px;"></ion-icon>
                                <input type="text" id="session-search" placeholder="Search sessions..." style="width: 100%; padding: 6px 8px 6px 32px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">
                            </div>
                            <div style="display: flex; gap: 8px;">
                                <select id="session-type-filter">
                                    <option value="">All Types</option>
                                    <option value="shell">Shell</option>
                                    <option value="meterpreter">Meterpreter</option>
                                    <option value="browser">Browser</option>
                                    <option value="http">HTTP</option>
                                </select>
                                <select id="session-status-filter">
                                    <option value="">All Status</option>
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                </select>
                            </div>
                        </div>

                        <!-- Sessions List -->
                        <div id="sessions-list" style="flex: 1; overflow-y: auto; padding: 10px;">
                            <div style="text-align: center; color: #8b949e; padding: 20px;">Loading sessions...</div>
                        </div>
                    </div>

                    <!-- Right Panel: Session Details -->
                    <div style="flex: 1; display: flex; flex-direction: column;">
                        <div id="no-session-selected" style="flex: 1; display: flex; align-items: center; justify-content: center; color: #8b949e;">
                            <div style="text-align: center;">
                                <ion-icon name="people-outline" style="font-size: 64px; color: #30363d; margin-bottom: 16px;"></ion-icon>
                                <div style="font-size: 16px; margin-bottom: 8px;">No session selected</div>
                                <div style="font-size: 13px;">Select a session from the list to view details</div>
                            </div>
                        </div>

                        <div id="session-details" style="display: none; flex: 1; flex-direction: column; height: 100%;">
                            <!-- Session Header -->
                            <div style="padding: 20px; border-bottom: 1px solid #30363d; background: #161b22;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                                    <div>
                                        <h2 id="session-title" style="margin: 0; font-size: 20px; color: #58a6ff; display: flex; align-items: center; gap: 10px;">
                                            <span id="session-type-badge" style="padding: 4px 10px; background: rgba(88, 166, 255, 0.2); border: 1px solid #58a6ff; border-radius: 4px; font-size: 12px; font-weight: 600;"></span>
                                            <span id="session-id-display"></span>
                                        </h2>
                                        <div style="font-size: 13px; color: #8b949e; margin-top: 6px;">
                                            <span id="session-host-display"></span>
                                        </div>
                                    </div>
                                    <div style="display: flex; gap: 8px;">
                                        <button id="interact-session-btn" style="padding: 8px 16px; background: #238636; border: 1px solid #238636; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px;">
                                            <ion-icon name="terminal-outline"></ion-icon>
                                            Interact
                                        </button>
                                        <button id="kill-session-btn" style="padding: 8px 16px; background: #f85149; border: 1px solid #f85149; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px;">
                                            <ion-icon name="close-circle-outline"></ion-icon>
                                            Kill
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <!-- Session Info Tabs -->
                            <div style="padding: 15px 20px; border-bottom: 1px solid #30363d; background: #161b22; display: flex; gap: 10px;">
                                <button class="session-tab active" data-tab="info" style="padding: 8px 16px; background: rgba(88, 166, 255, 0.1); border: 1px solid #58a6ff; border-radius: 4px; color: #58a6ff; cursor: pointer; font-size: 13px; font-weight: 500;">
                                    Info
                                </button>
                                <button class="session-tab" data-tab="commands" style="padding: 8px 16px; background: transparent; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; cursor: pointer; font-size: 13px;">
                                    Commands
                                </button>
                                <button class="session-tab" data-tab="modules" style="padding: 8px 16px; background: transparent; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; cursor: pointer; font-size: 13px;">
                                    Post
                                </button>
                            </div>

                            <!-- Tab Content -->
                            <div id="tab-content-wrapper" style="flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden;">
                                <!-- Info Tab -->
                                <div id="tab-info" class="session-tab-content" style="display: block; overflow-y: auto; padding: 20px;">
                                    <div style="display: flex; flex-direction: column; gap: 20px;">
                                        <!-- Quick Stats Grid -->
                                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                                            <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px;">
                                                <div style="font-size: 11px; color: #8b949e; margin-bottom: 5px;">Session Type</div>
                                                <div style="font-size: 16px; font-weight: 600; color: #c9d1d9;" id="detail-type">-</div>
                                            </div>
                                            <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px;">
                                                <div style="font-size: 11px; color: #8b949e; margin-bottom: 5px;">Target</div>
                                                <div style="font-size: 16px; font-weight: 600; color: #c9d1d9;" id="detail-target">-</div>
                                            </div>
                                            <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px;">
                                                <div style="font-size: 11px; color: #8b949e; margin-bottom: 5px;">Status</div>
                                                <div style="font-size: 16px; font-weight: 600; color: #3fb950;" id="detail-status">Active</div>
                                            </div>
                                            <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px;">
                                                <div style="font-size: 11px; color: #8b949e; margin-bottom: 5px;">Commands</div>
                                                <div style="font-size: 16px; font-weight: 600; color: #c9d1d9;" id="detail-commands">0</div>
                                            </div>
                                        </div>
                                        
                                        <!-- Detailed Information -->
                                        <div id="session-info-content" style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 20px;">
                                            <div style="color: #8b949e; text-align: center; padding: 20px;">Loading session information...</div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Commands Tab -->
                                <div id="tab-commands" class="session-tab-content" style="display: none; flex: 1; display: flex; flex-direction: column; min-height: 0; padding: 20px;">
                                    <div id="command-terminal" style="flex: 1; min-height: 0; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; display: flex; flex-direction: column; overflow-y: auto;">
                                        <div id="command-output" style="flex: 1; padding: 14px; font-family: 'Fira Code', monospace; font-size: 12px; color: #c9d1d9; white-space: pre-wrap; word-wrap: break-word;">
                                            <div style="color: #8b949e;">Select a session, then type a command below...</div>
                                        </div>
                                        <div style="position: sticky; bottom: 0; border-top: 1px solid #30363d; padding: 10px 14px; display: flex; gap: 10px; align-items: center; background: rgba(13,17,23,0.98); backdrop-filter: blur(6px); flex-shrink: 0;">
                                            <span id="command-prompt" style="color: #58a6ff; font-family: 'Fira Code', monospace; font-size: 12px; white-space: nowrap;">$</span>
                                            <input type="text" id="command-input" placeholder="type a command and press Enter..." spellcheck="false" autocomplete="off" style="flex: 1; padding: 0; background: transparent; border: none; color: #c9d1d9; font-size: 12px; outline: none; font-family: 'Fira Code', monospace;">
                                        </div>
                                    </div>
                                </div>

                                <!-- Modules Tab -->
                                <div id="tab-modules" class="session-tab-content" style="display: none; flex: 1; display: flex; flex-direction: column; min-height: 0; padding: 20px;">
                                    <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px; flex: 1; display: flex; flex-direction: column; gap: 12px; min-height: 0;">
                                        <div style="display: flex; gap: 10px; align-items: center; flex-shrink: 0;">
                                            <input type="text" id="session-module-search" placeholder="Search post modules..." style="flex: 1; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none;">
                                            <button id="refresh-session-modules-btn" style="padding: 10px 14px; background: rgba(88, 166, 255, 0.1); border: 1px solid #58a6ff; border-radius: 4px; color: #58a6ff; cursor: pointer; font-size: 13px;">
                                                Refresh
                                            </button>
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; color: #c9d1d9;">
                                                <input type="checkbox" id="only-compatible-post-modules" style="cursor: pointer; width: 16px; height: 16px;">
                                                <span>Only compatible post modules</span>
                                            </label>
                                        </div>
                                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; flex: 1; min-height: 0;">
                                            <div style="display: flex; flex-direction: column; gap: 8px; min-height: 0;">
                                                <div style="font-size: 12px; color: #8b949e; flex-shrink: 0;">Available post modules for this session</div>
                                                <div id="session-modules-list" style="flex: 1; overflow-y: auto; overflow-x: hidden; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; padding: 10px; min-height: 0;">
                                                    <div style="color: #8b949e; text-align: center; padding: 20px;">Select a session to load post modules...</div>
                                                </div>
                                            </div>
                                            <div style="display: flex; flex-direction: column; gap: 8px; min-height: 0;">
                                                <div style="display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
                                                    <div style="font-size: 12px; color: #8b949e;">Module Options</div>
                                                    <button id="toggle-options-view-btn" style="padding: 4px 8px; background: rgba(88, 166, 255, 0.1); border: 1px solid #58a6ff; border-radius: 3px; color: #58a6ff; cursor: pointer; font-size: 11px;">
                                                        JSON View
                                                    </button>
                                                </div>
                                                <div id="session-module-options-form" style="flex: 1; overflow-y: auto; overflow-x: hidden; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; padding: 12px; display: flex; flex-direction: column; gap: 10px; min-height: 0;">
                                                    <div style="color: #8b949e; text-align: center; padding: 20px;">Select a module to see its options...</div>
                                                </div>
                                                <textarea id="session-module-options-json" placeholder='{"option":"value"}' style="display: none; flex: 1; width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none; font-family: 'Fira Code', monospace; resize: none; min-height: 0;"></textarea>
                                                <button id="run-session-module-btn" style="padding: 10px 16px; background: #238636; border: 1px solid #238636; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; font-weight: 600; flex-shrink: 0;">
                                                    Run Module
                                                </button>
                                                <div style="font-size: 12px; color: #8b949e; flex-shrink: 0;">Output</div>
                                                <div id="session-module-output" style="flex: 1; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; padding: 10px; font-family: 'Fira Code', monospace; font-size: 12px; color: #c9d1d9; overflow-y: auto; overflow-x: hidden; white-space: pre-wrap; min-height: 0;">
                                                    <div style="color: #8b949e;">Module output will appear here...</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Kill Session Modal -->
                    <div id="kill-session-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 10050; align-items: center; justify-content: center;">
                        <div style="background: #161b22; border: 1px solid #30363d; border-radius: 10px; width: 520px; max-width: 92vw; box-shadow: 0 18px 50px rgba(0,0,0,0.55); overflow: hidden;">
                            <div style="padding: 16px 18px; border-bottom: 1px solid #30363d; display: flex; align-items: center; justify-content: space-between;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <div style="width: 34px; height: 34px; border-radius: 8px; background: rgba(248, 81, 73, 0.12); border: 1px solid rgba(248, 81, 73, 0.45); display: flex; align-items: center; justify-content: center;">
                                        <ion-icon name="warning-outline" style="color: #f85149; font-size: 18px;"></ion-icon>
                                    </div>
                                    <div style="font-size: 14px; font-weight: 700; color: #c9d1d9;">Kill session</div>
                                </div>
                                <button id="kill-session-close-btn" style="background: none; border: none; color: #8b949e; cursor: pointer; font-size: 22px; padding: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;">&times;</button>
                            </div>
                            <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 10px;">
                                <div style="color: #8b949e; font-size: 13px; line-height: 1.35;">
                                    This will terminate the session. Any active interaction may be lost.
                                </div>
                                <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
                                    <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; font-size: 12px;">
                                        <div style="color: #8b949e;">Session ID:</div>
                                        <div style="color: #c9d1d9; font-family: 'Fira Code', monospace; word-break: break-all;" id="kill-session-id-text">-</div>
                                        
                                        <div style="color: #8b949e;">Type:</div>
                                        <div style="color: #c9d1d9;" id="kill-session-type-text">-</div>
                                        
                                        <div style="color: #8b949e;">Target:</div>
                                        <div style="color: #c9d1d9;" id="kill-session-target-text">-</div>
                                        
                                        <div style="color: #8b949e;">Status:</div>
                                        <div style="color: #3fb950;" id="kill-session-status-text">-</div>
                                    </div>
                                </div>
                                <div id="kill-session-error" style="display: none; color: #f85149; font-size: 12px;"></div>
                            </div>
                            <div style="padding: 14px 18px; border-top: 1px solid #30363d; display: flex; justify-content: flex-end; gap: 10px; background: rgba(255,255,255,0.02);">
                                <button id="kill-session-cancel-btn" style="padding: 10px 14px; background: transparent; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; cursor: pointer; font-size: 13px; font-weight: 600;">Cancel</button>
                                <button id="kill-session-confirm-btn" style="padding: 10px 14px; background: #f85149; border: 1px solid #f85149; border-radius: 6px; color: white; cursor: pointer; font-size: 13px; font-weight: 700;">Kill</button>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const sessionsList = document.querySelector(`#${wId} #sessions-list`);
                const noSessionSelected = document.querySelector(`#${wId} #no-session-selected`);
                const sessionDetails = document.querySelector(`#${wId} #session-details`);
                const sessionSearch = document.querySelector(`#${wId} #session-search`);
                const typeFilter = document.querySelector(`#${wId} #session-type-filter`);
                const statusFilter = document.querySelector(`#${wId} #session-status-filter`);
                const refreshBtn = document.querySelector(`#${wId} #refresh-sessions-btn`);
                const sessionsCount = document.querySelector(`#${wId} #sessions-count`);
                const interactBtn = document.querySelector(`#${wId} #interact-session-btn`);
                const killBtn = document.querySelector(`#${wId} #kill-session-btn`);
                
                // Debug: Log if kill button is found
                if (!killBtn) {
                    console.warn(`[SessionManager] Kill button not found with selector: #${wId} #kill-session-btn`);
                } else {
                    console.log(`[SessionManager] Kill button found and ready`);
                }
                const tabs = document.querySelectorAll(`#${wId} .session-tab`);
                const tabContents = document.querySelectorAll(`#${wId} .session-tab-content`);
                const commandInput = document.querySelector(`#${wId} #command-input`);
                const commandOutput = document.querySelector(`#${wId} #command-output`);
                const commandPrompt = document.querySelector(`#${wId} #command-prompt`);
                const commandTerminal = document.querySelector(`#${wId} #command-terminal`);

                const sessionModuleSearch = document.querySelector(`#${wId} #session-module-search`);
                const refreshSessionModulesBtn = document.querySelector(`#${wId} #refresh-session-modules-btn`);
                const sessionModulesList = document.querySelector(`#${wId} #session-modules-list`);
                const sessionModuleOptionsForm = document.querySelector(`#${wId} #session-module-options-form`);
                const sessionModuleOptionsJson = document.querySelector(`#${wId} #session-module-options-json`);
                const toggleOptionsViewBtn = document.querySelector(`#${wId} #toggle-options-view-btn`);
                const runSessionModuleBtn = document.querySelector(`#${wId} #run-session-module-btn`);
                const sessionModuleOutput = document.querySelector(`#${wId} #session-module-output`);

                let sessions = [];
                let currentSessionId = null;
                let currentSessionType = '';
                let allModulePaths = null;
                let selectedSessionModule = null;
                let currentModuleInfo = null;
                let optionsViewMode = 'form'; // 'form' or 'json'
                let commandHistory = [];
                let historyIndex = -1;

                const getShellPrompt = () => {
                    const t = (currentSessionType || '').toString().toLowerCase();
                    if (t === 'ftp') return 'ftp> ';
                    if (t === 'meterpreter') return 'meterpreter> ';
                    if (t === 'ssh') return 'ssh$ ';
                    if (t === 'browser') return 'js> ';
                    return '$ ';
                };

                const updatePrompt = () => {
                    if (!commandPrompt) return;
                    commandPrompt.textContent = getShellPrompt();
                };

                const appendTerminalLine = (html) => {
                    if (!commandOutput) return;
                    // If still showing placeholder message, clear it
                    if (commandOutput.dataset.placeholderShown !== 'false') {
                        commandOutput.innerHTML = '';
                        commandOutput.dataset.placeholderShown = 'false';
                    }
                    commandOutput.insertAdjacentHTML('beforeend', html);
                    const scroller = commandTerminal || commandOutput;
                    scroller.scrollTop = scroller.scrollHeight;
                };

                const getSessionTarget = (session) => {
                    if (!session) return 'Unknown';
                    if (session.type === 'browser' || session.is_browser) {
                        const url = session.browser_info && (session.browser_info.url || session.browser_info.current_url);
                        return url || session.host || 'Unknown';
                    }
                    return `${session.host || 'Unknown'}${session.port ? ':' + session.port : ''}`;
                };

                const isBrowserSession = (session) => {
                    return !!session && (session.type === 'browser' || session.is_browser === true);
                };

                const inferPlatform = (session) => {
                    if (!session) return '';
                    if (isBrowserSession(session)) return 'browser';
                    const d = session.data || {};
                    const p = (session.platform || d.platform || d.os || d.system || '').toString().toLowerCase();
                    if (p.includes('win')) return 'windows';
                    if (p.includes('linux')) return 'linux';
                    if (p.includes('darwin') || p.includes('mac')) return 'mac';
                    if (p.includes('android')) return 'android';
                    return p;
                };

                const allowedModulePrefixesForSession = (session, onlyCompatible = false) => {
                    if (!session) return [];
                    if (isBrowserSession(session)) return ['browser_auxiliary/', 'browser_exploits/'];
                    
                    // If only compatible is enabled, filter by session type
                    if (onlyCompatible) {
                        const sessionType = (session.type || session.session_type || '').toString().toLowerCase();
                        
                        // Map session types to post module prefixes
                        const typeToPrefix = {
                            'ftp': ['post/ftp/'],
                            'mysql': ['post/mysql/'],
                            'aws': ['post/aws/'],
                            'canbus': ['post/canbus/'],
                            'adb': ['post/adb/'],
                            'android': ['post/adb/'],
                            'php': ['post/php/'],
                            'http': ['post/php/'],
                            'https': ['post/php/'],
                        };
                        
                        if (typeToPrefix[sessionType]) {
                            return typeToPrefix[sessionType];
                        }
                        
                        // If no specific type match, return empty to show no modules
                        return [];
                    }
                    
                    // Default: filter by platform
                    const plat = inferPlatform(session);
                    if (plat.includes('linux')) return ['post/linux/'];
                    if (plat.includes('windows')) return ['post/windows/'];
                    if (plat.includes('mac') || plat.includes('darwin')) return ['post/osx/', 'post/mac/'];
                    return ['post/'];
                };

                const ensureModulePathsLoaded = async () => {
                    if (allModulePaths) return allModulePaths;
                    const res = await fetch('/api/modules/list');
                    const data = await res.json();
                    allModulePaths = (data.modules || []).map(m => m.path).filter(Boolean);
                    return allModulePaths;
                };

                const renderSessionModules = async () => {
                    selectedSessionModule = null;
                    currentModuleInfo = null;
                    if (sessionModuleOptionsForm) {
                        sessionModuleOptionsForm.innerHTML = '<div style="color: #8b949e; text-align: center; padding: 20px;">Select a module to see its options...</div>';
                    }
                    if (sessionModuleOptionsJson) {
                        sessionModuleOptionsJson.value = '';
                    }
                    if (!currentSessionId) {
                        sessionModulesList.innerHTML = '<div style="color: #8b949e; text-align: center; padding: 20px;">Select a session to load post modules...</div>';
                        return;
                    }

                    const session = sessions.find(s => String(s.id) === String(currentSessionId));
                    if (!session) return;

                    sessionModulesList.innerHTML = '<div style="color: #8b949e; text-align: center; padding: 20px;">Loading post modules...</div>';
                    const paths = await ensureModulePathsLoaded();
                    const onlyCompatibleCheckbox = document.querySelector(`#${wId} #only-compatible-post-modules`);
                    const onlyCompatible = onlyCompatibleCheckbox ? onlyCompatibleCheckbox.checked : false;
                    const prefixes = allowedModulePrefixesForSession(session, onlyCompatible);
                    const q = (sessionModuleSearch?.value || '').toLowerCase().trim();

                    let filtered = paths.filter(p => prefixes.some(pref => p.startsWith(pref)));
                    if (q) filtered = filtered.filter(p => p.toLowerCase().includes(q));

                    if (filtered.length === 0) {
                        const message = onlyCompatible 
                            ? `No compatible post modules found for session type: ${(session.type || session.session_type || 'unknown')}`
                            : `No post modules match (${prefixes.join(', ')})`;
                        sessionModulesList.innerHTML = `<div style="color: #8b949e; text-align: center; padding: 20px;">${message}</div>`;
                        return;
                    }

                    sessionModulesList.innerHTML = filtered.map(p => `
                        <div class="session-module-item" data-module="${encodeURIComponent(p)}" style="padding: 8px 10px; border: 1px solid #30363d; border-radius: 6px; margin-bottom: 8px; cursor: pointer; background: rgba(255,255,255,0.02);">
                            <div style="font-size: 12px; color: #c9d1d9; font-family: 'Fira Code', monospace;">${p}</div>
                        </div>
                    `).join('');

                    document.querySelectorAll(`#${wId} .session-module-item`).forEach(item => {
                        item.addEventListener('click', async () => {
                            document.querySelectorAll(`#${wId} .session-module-item`).forEach(i => {
                                i.style.borderColor = '#30363d';
                                i.style.background = 'rgba(255,255,255,0.02)';
                            });
                            item.style.borderColor = '#58a6ff';
                            item.style.background = 'rgba(88, 166, 255, 0.08)';
                            const encoded = item.getAttribute('data-module') || '';
                            try { selectedSessionModule = decodeURIComponent(encoded); } catch { selectedSessionModule = encoded; }
                            
                            // Load module info and display options form
                            await loadModuleOptions(selectedSessionModule);
                        });
                    });
                };

                const loadModuleOptions = async (modulePath) => {
                    if (!modulePath) {
                        sessionModuleOptionsForm.innerHTML = '<div style="color: #8b949e; text-align: center; padding: 20px;">Select a module to see its options...</div>';
                        return;
                    }

                    sessionModuleOptionsForm.innerHTML = '<div style="color: #8b949e; text-align: center; padding: 20px;">Loading module options...</div>';

                    try {
                        const encodedPath = encodeURIComponent(modulePath);
                        const res = await fetch(`/api/modules/${encodedPath}/load`);
                        
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                            sessionModuleOptionsForm.innerHTML = `<div style="color: #f85149; text-align: center; padding: 20px;">Error: ${err.error || 'Failed to load module'}</div>`;
                            return;
                        }

                        const data = await res.json();
                        currentModuleInfo = data;

                        if (!data.options || data.options.length === 0) {
                            sessionModuleOptionsForm.innerHTML = '<div style="color: #8b949e; text-align: center; padding: 20px;">No options available for this module</div>';
                            updateOptionsJson();
                            return;
                        }

                        // Filter out session_id for post modules (it's automatically set)
                        const isPostModule = modulePath.startsWith('post/');
                        const filteredOptions = isPostModule 
                            ? data.options.filter(opt => opt.name !== 'session_id' && opt.name !== 'SID' && opt.name !== 'sid')
                            : data.options;

                        if (filteredOptions.length === 0) {
                            sessionModuleOptionsForm.innerHTML = '<div style="color: #8b949e; text-align: center; padding: 20px;">No options to configure</div>';
                            updateOptionsJson();
                            return;
                        }

                        // Build form HTML
                        let formHTML = '';
                        if (data.description) {
                            formHTML += `<div style="padding: 8px; background: rgba(88, 166, 255, 0.1); border: 1px solid #58a6ff; border-radius: 4px; margin-bottom: 12px; font-size: 12px; color: #58a6ff;">${data.description}</div>`;
                        }

                        filteredOptions.forEach(opt => {
                            const optId = `session-opt-${opt.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
                            const isRequired = opt.required === true;
                            const optType = (opt.type || 'string').toLowerCase();
                            const currentVal = opt.current_value || '';
                            
                            formHTML += `<div style="display: flex; flex-direction: column; gap: 4px;">`;
                            formHTML += `<label style="font-size: 12px; color: #c9d1d9; display: flex; align-items: center; gap: 6px;">`;
                            formHTML += `<span>${opt.name}</span>`;
                            if (isRequired) {
                                formHTML += `<span style="color: #f85149; font-size: 11px;">*</span>`;
                            }
                            if (opt.advanced) {
                                formHTML += `<span style="color: #8b949e; font-size: 10px; margin-left: auto;">(advanced)</span>`;
                            }
                            formHTML += `</label>`;

                            if (optType === 'bool' || optType === 'boolean') {
                                const checked = currentVal === 'True' || currentVal === 'true' || currentVal === true || currentVal === '1';
                                formHTML += `<select id="${optId}" data-option="${opt.name}" style="padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">`;
                                formHTML += `<option value="True" ${checked ? 'selected' : ''}>True</option>`;
                                formHTML += `<option value="False" ${!checked ? 'selected' : ''}>False</option>`;
                                formHTML += `</select>`;
                            } else if (optType === 'int' || optType === 'integer' || optType === 'port') {
                                formHTML += `<input type="number" id="${optId}" data-option="${opt.name}" value="${currentVal}" placeholder="${opt.description || ''}" style="padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">`;
                            } else {
                                formHTML += `<input type="text" id="${optId}" data-option="${opt.name}" value="${currentVal}" placeholder="${opt.description || ''}" style="padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 12px; outline: none;">`;
                            }

                            if (opt.description) {
                                formHTML += `<div style="font-size: 11px; color: #8b949e; margin-top: 2px;">${opt.description}</div>`;
                            }
                            formHTML += `</div>`;
                        });

                        sessionModuleOptionsForm.innerHTML = formHTML;

                        // Add change listeners to update JSON automatically
                        document.querySelectorAll(`#${wId} [data-option]`).forEach(input => {
                            input.addEventListener('change', updateOptionsJson);
                            input.addEventListener('input', updateOptionsJson);
                        });

                        updateOptionsJson();
                    } catch (err) {
                        console.error('Error loading module options:', err);
                        sessionModuleOptionsForm.innerHTML = `<div style="color: #f85149; text-align: center; padding: 20px;">Error: ${err.message || 'Failed to load module'}</div>`;
                    }
                };

                const updateOptionsJson = () => {
                    if (!sessionModuleOptionsForm || !sessionModuleOptionsJson) return;
                    
                    const options = {};
                    document.querySelectorAll(`#${wId} [data-option]`).forEach(input => {
                        const optName = input.getAttribute('data-option');
                        let value = input.value;
                        
                        // Convert bool strings to actual booleans
                        if (input.tagName === 'SELECT' && (value === 'True' || value === 'False')) {
                            value = value === 'True';
                        } else if (input.type === 'number') {
                            const num = parseFloat(value);
                            if (!isNaN(num)) value = num;
                        }
                        
                        if (value !== '' && value !== null && value !== undefined) {
                            options[optName] = value;
                        }
                    });

                    sessionModuleOptionsJson.value = JSON.stringify(options, null, 2);
                };

                const toggleOptionsView = () => {
                    if (optionsViewMode === 'form') {
                        optionsViewMode = 'json';
                        sessionModuleOptionsForm.style.display = 'none';
                        sessionModuleOptionsJson.style.display = 'block';
                        toggleOptionsViewBtn.textContent = 'Form View';
                        updateOptionsJson();
                    } else {
                        optionsViewMode = 'form';
                        sessionModuleOptionsForm.style.display = 'flex';
                        sessionModuleOptionsJson.style.display = 'none';
                        toggleOptionsViewBtn.textContent = 'JSON View';
                    }
                };

                // Tab switching
                tabs.forEach(tab => {
                    tab.addEventListener('click', () => {
                        const tabName = tab.dataset.tab;
                        tabs.forEach(t => {
                            t.classList.remove('active');
                            t.style.background = 'transparent';
                            t.style.borderColor = '#30363d';
                            t.style.color = '#c9d1d9';
                        });
                        tab.classList.add('active');
                        tab.style.background = 'rgba(88, 166, 255, 0.1)';
                        tab.style.borderColor = '#58a6ff';
                        tab.style.color = '#58a6ff';

                        tabContents.forEach(content => {
                            content.style.display = 'none';
                        });
                        const activeTab = document.querySelector(`#${wId} #tab-${tabName}`);
                        if (activeTab) {
                            // Commands and Modules tabs need flex display for proper layout
                            if (tabName === 'commands' || tabName === 'modules' || tabName === 'post') {
                                activeTab.style.display = 'flex';
                            } else {
                                activeTab.style.display = 'block';
                            }
                        }
                    });
                });

                // Load sessions
                const loadSessions = async () => {
                    try {
                        const res = await fetch('/api/sessions');
                        const data = await res.json();
                        sessions = data.sessions || [];
                        renderSessionsList();
                    } catch (err) {
                        console.error('Error loading sessions:', err);
                        sessionsList.innerHTML = '<div style="color: #f85149; padding: 20px; text-align: center;">Error loading sessions</div>';
                    }
                };

                // Render sessions list
                const renderSessionsList = () => {
                    const searchTerm = sessionSearch.value.toLowerCase();
                    const typeFilterValue = typeFilter.value;
                    const statusFilterValue = statusFilter.value;

                    let filtered = sessions;

                    if (searchTerm) {
                        filtered = filtered.filter(s => {
                            const identifier = (s.id || s.session_id || s.sessionId || s.uuid || s.victim_id || s.client_id || '').toLowerCase();
                            const hostMatch = (s.host && s.host.toLowerCase().includes(searchTerm));
                            const typeMatch = (s.type && s.type.toLowerCase().includes(searchTerm));
                            return identifier.includes(searchTerm) || hostMatch || typeMatch;
                        });
                    }

                    if (typeFilterValue) {
                        filtered = filtered.filter(s => s.type === typeFilterValue);
                    }

                    if (statusFilterValue) {
                        if (statusFilterValue === 'active') {
                            filtered = filtered.filter(s => s.active !== false);
                        } else {
                            filtered = filtered.filter(s => s.active === false);
                        }
                    }

                    sessionsCount.textContent = `${filtered.length} session${filtered.length !== 1 ? 's' : ''}`;

                    if (filtered.length === 0) {
                        sessionsList.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 20px;">No sessions found</div>';
                        return;
                    }

                    const sessionItems = filtered.map(session => {
                        const sessionIdentifier = session.id || session.session_id || session.sessionId || session.uuid || session.victim_id || session.client_id;
                        if (!sessionIdentifier) {
                            console.warn('Skipping session without identifier', session);
                            return '';
                        }
                        const isSelected = currentSessionId === sessionIdentifier;
                        const typeColor = session.type === 'browser' ? '#f59e0b' : 
                                         session.type === 'meterpreter' ? '#8b5cf6' : '#58a6ff';
                        const shortId = sessionIdentifier.length > 12 ? sessionIdentifier.substring(0, 12) + '...' : sessionIdentifier;
                        
                        return `
                            <div class="session-item" data-session-id="${sessionIdentifier}" 
                                 style="padding: 12px; margin-bottom: 8px; 
                                        background: ${isSelected ? 'rgba(88, 166, 255, 0.1)' : 'rgba(255,255,255,0.03)'}; 
                                        border: 1px solid ${isSelected ? '#58a6ff' : '#30363d'}; 
                                        border-radius: 6px; 
                                        cursor: pointer; 
                                        transition: all 0.2s;"
                                 onmouseover="if(!this.classList.contains('selected')) this.style.background='rgba(88, 166, 255, 0.05)'"
                                 onmouseout="if(!this.classList.contains('selected')) this.style.background='${isSelected ? 'rgba(88, 166, 255, 0.1)' : 'rgba(255,255,255,0.03)'}'">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span style="width: 8px; height: 8px; border-radius: 50%; background: ${session.active !== false ? '#3fb950' : '#8b949e'};"></span>
                                        <span style="font-weight: ${isSelected ? '600' : '500'}; font-size: 13px; color: ${isSelected ? '#58a6ff' : '#c9d1d9'};">
                                            ${shortId}
                                        </span>
                                    </div>
                                    <span style="padding: 2px 8px; background: ${typeColor}20; border: 1px solid ${typeColor}; border-radius: 3px; font-size: 10px; color: ${typeColor}; font-weight: 600; text-transform: uppercase;">
                                        ${session.type}
                                    </span>
                                </div>
                                <div style="font-size: 11px; color: #8b949e; margin-left: 16px;">
                                    ${session.host || 'Unknown'}${session.port ? ':' + session.port : ''}
                                </div>
                                ${session.is_browser && session.user_agent ? `
                                    <div style="font-size: 10px; color: #6e7681; margin-left: 16px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                        ${session.user_agent}
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }).filter(Boolean);

                    sessionsList.innerHTML = sessionItems.length ? sessionItems.join('') : '<div style="text-align: center; color: #8b949e; padding: 20px;">No sessions found</div>';

                    // Add click handlers
                    document.querySelectorAll(`#${wId} .session-item`).forEach(item => {
                        item.addEventListener('click', () => {
                            // Try multiple ways to get session ID
                            const sessionId = item.dataset.sessionId || 
                                           item.getAttribute('data-session-id') ||
                                           item.getAttribute('data-sessionId');
                            
                            if (sessionId) {
                                selectSession(sessionId);
                            } else {
                                console.error('No session ID found on clicked item');
                                this.showNotification('Error: No session ID found', 'error');
                            }
                        });
                    });
                };

                // Select session
                const selectSession = async (sessionId) => {
                    // Validate session ID
                    if (!sessionId || 
                        sessionId === 'undefined' || 
                        sessionId === 'null' || 
                        sessionId === '' ||
                        typeof sessionId !== 'string') {
                        console.error('Invalid session ID:', sessionId);
                        this.showNotification('Invalid session ID', 'error');
                        return;
                    }

                    // Trim and validate UUID format (basic check)
                    sessionId = sessionId.trim();
                    if (sessionId.length < 10) {
                        console.error('Session ID too short:', sessionId);
                        this.showNotification('Invalid session ID format', 'error');
                        return;
                    }

                    currentSessionId = sessionId;

                    // Update UI
                    document.querySelectorAll(`#${wId} .session-item`).forEach(item => {
                        item.classList.remove('selected');
                        const itemSessionId = item.dataset.sessionId || item.getAttribute('data-session-id');
                        if (itemSessionId === sessionId) {
                            item.classList.add('selected');
                        }
                    });

                    noSessionSelected.style.display = 'none';
                    sessionDetails.style.display = 'flex';

                    try {
                        // Encode session ID to handle special characters
                        const encodedSessionId = encodeURIComponent(sessionId);
                        const res = await fetch(`/api/sessions/${encodedSessionId}`);
                        
                        if (res.ok) {
                            const session = await res.json();
                            if (session && session.id) {
                                displaySessionDetails(session);
                            } else {
                                throw new Error('Invalid session data received');
                            }
                        } else if (res.status === 404) {
                            this.showNotification('Session not found', 'error');
                            noSessionSelected.style.display = 'flex';
                            sessionDetails.style.display = 'none';
                            currentSessionId = null;
                        } else {
                            const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
                            console.error('Error loading session details:', res.status, errorData);
                            this.showNotification(`Error loading session: ${errorData.error || 'Unknown error'}`, 'error');
                        }
                    } catch (err) {
                        console.error('Error loading session:', err);
                        // Don't show alert for network errors, use notification instead
                        if (err.name === 'TypeError' && err.message.includes('fetch')) {
                            this.showNotification('Network error: Could not connect to server', 'error');
                        } else {
                            this.showNotification(`Error loading session: ${err.message}`, 'error');
                        }
                        // Reset UI on error
                        noSessionSelected.style.display = 'flex';
                        sessionDetails.style.display = 'none';
                        currentSessionId = null;
                    }

                    renderSessionsList();
                };

                // Display session details
                const displaySessionDetails = (session) => {
                    // Ensure only the active tab is visible
                    tabContents.forEach(content => {
                        content.style.display = 'none';
                    });
                    // Show info tab by default (it's the active tab)
                    const infoTab = document.querySelector(`#${wId} #tab-info`);
                    if (infoTab) {
                        infoTab.style.display = 'block';
                    }
                    
                    document.querySelector(`#${wId} #session-id-display`).textContent = session.id.length > 20 ? session.id.substring(0, 20) + '...' : session.id;
                    document.querySelector(`#${wId} #session-type-badge`).textContent = session.type.toUpperCase();
                    document.querySelector(`#${wId} #session-host-display`).textContent = `${session.host || 'Unknown'}${session.port ? ':' + session.port : ''}`;
                    
                    document.querySelector(`#${wId} #detail-type`).textContent = session.type || '-';
                    document.querySelector(`#${wId} #detail-target`).textContent = getSessionTarget(session);
                    document.querySelector(`#${wId} #detail-status`).textContent = session.active !== false ? 'Active' : 'Inactive';
                    document.querySelector(`#${wId} #detail-commands`).textContent = session.commands_executed || 0;

                    // Update pseudo-shell prompt + reset history pointer
                    currentSessionType = session.type || '';
                    historyIndex = -1;
                    updatePrompt();
                    if (commandOutput) {
                        commandOutput.dataset.placeholderShown = 'true';
                        commandOutput.innerHTML = `<div style="color: #8b949e;">Connected. Type commands below (Enter). Use ↑/↓ for history, Ctrl+L to clear.</div>`;
                    }

                    // Info tab - Detailed Information
                    const infoContent = document.querySelector(`#${wId} #session-info-content`);
                    const browserUrl = session.browser_info && (session.browser_info.url || session.browser_info.current_url);
                    const browserTitle = session.browser_info && (session.browser_info.title || session.browser_info.page_title);
                    
                    const sessionData = session.data || {};
                    const username = sessionData.username || session.username || sessionData.user || '-';
                    const password = sessionData.password ? '••••••••' : '-';
                    
                    infoContent.innerHTML = `
                        <h3 style="margin-top: 0; margin-bottom: 15px; color: #c9d1d9; font-size: 16px; font-weight: 600;">Session Details</h3>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px;">
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px;">Session ID</div>
                                <div style="font-size: 14px; color: #c9d1d9; font-family: 'Fira Code', monospace; word-break: break-all;">${session.id}</div>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px;">Type</div>
                                <div style="font-size: 14px; color: #c9d1d9;">${session.type || 'Unknown'}</div>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px;">Host</div>
                                <div style="font-size: 14px; color: #c9d1d9;">${session.host || 'Unknown'}</div>
                            </div>
                            ${session.port ? `
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px;">Port</div>
                                <div style="font-size: 14px; color: #c9d1d9;">${session.port}</div>
                            </div>
                            ` : ''}
                            ${username !== '-' ? `
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px;">Username</div>
                                <div style="font-size: 14px; color: #c9d1d9;">${username}</div>
                            </div>
                            ` : ''}
                            ${password !== '-' ? `
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px;">Password</div>
                                <div style="font-size: 14px; color: #8b949e;">${password}</div>
                            </div>
                            ` : ''}
                            ${session.platform ? `
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px;">Platform</div>
                                <div style="font-size: 14px; color: #c9d1d9;">${session.platform}</div>
                            </div>
                            ` : ''}
                            ${session.user_agent ? `
                            <div style="display: flex; flex-direction: column; gap: 8px; grid-column: 1 / -1;">
                                <div style="font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px;">User Agent</div>
                                <div style="font-size: 12px; color: #8b949e; font-family: 'Fira Code', monospace; word-break: break-all;">${session.user_agent}</div>
                            </div>
                            ` : ''}
                            ${browserUrl ? `
                            <div style="display: flex; flex-direction: column; gap: 8px; grid-column: 1 / -1;">
                                <div style="font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px;">URL</div>
                                <div style="font-size: 13px; color: #58a6ff; font-family: 'Fira Code', monospace; word-break: break-all;">${browserUrl}</div>
                            </div>
                            ` : ''}
                            ${browserTitle ? `
                            <div style="display: flex; flex-direction: column; gap: 8px; grid-column: 1 / -1;">
                                <div style="font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px;">Page Title</div>
                                <div style="font-size: 14px; color: #c9d1d9;">${browserTitle}</div>
                            </div>
                            ` : ''}
                            ${session.first_seen ? `
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px;">First Seen</div>
                                <div style="font-size: 13px; color: #c9d1d9;">${new Date(session.first_seen).toLocaleString()}</div>
                            </div>
                            ` : ''}
                            ${session.last_seen ? `
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px;">Last Seen</div>
                                <div style="font-size: 13px; color: #c9d1d9;">${new Date(session.last_seen).toLocaleString()}</div>
                            </div>
                            ` : ''}
                        </div>
                    `;

                    // Modules tab refresh for this session
                    renderSessionModules();
                };

                // Modules tab handlers
                if (sessionModuleSearch) {
                    sessionModuleSearch.addEventListener('input', () => renderSessionModules());
                }
                const onlyCompatibleCheckbox = document.querySelector(`#${wId} #only-compatible-post-modules`);
                if (onlyCompatibleCheckbox) {
                    onlyCompatibleCheckbox.addEventListener('change', () => renderSessionModules());
                }
                if (refreshSessionModulesBtn) {
                    refreshSessionModulesBtn.addEventListener('click', async () => {
                        allModulePaths = null;
                        await renderSessionModules();
                    });
                }
                if (toggleOptionsViewBtn) {
                    toggleOptionsViewBtn.addEventListener('click', toggleOptionsView);
                }
                if (runSessionModuleBtn) {
                    runSessionModuleBtn.addEventListener('click', async () => {
                        if (!currentSessionId) return;
                        if (!selectedSessionModule) {
                            this.showNotification('Select a module first', 'warning', 2000);
                            return;
                        }

                        // Validate module is allowed for the session type
                        const session = sessions.find(s => String(s.id) === String(currentSessionId));
                        const prefixes = allowedModulePrefixesForSession(session);
                        if (!prefixes.some(p => selectedSessionModule.startsWith(p))) {
                            this.showNotification('This module is not allowed for this session type', 'error', 2500);
                            return;
                        }

                        // Get options from current view mode
                        let options = {};
                        if (optionsViewMode === 'json') {
                            const raw = (sessionModuleOptionsJson?.value || '').trim();
                            if (raw) {
                                try {
                                    options = JSON.parse(raw);
                                } catch (e) {
                                    this.showNotification('Options JSON is invalid', 'error', 2500);
                                    return;
                                }
                            }
                        } else {
                            // Build from form inputs
                            document.querySelectorAll(`#${wId} [data-option]`).forEach(input => {
                                const optName = input.getAttribute('data-option');
                                let value = input.value;
                                
                                if (input.tagName === 'SELECT' && (value === 'True' || value === 'False')) {
                                    value = value === 'True';
                                } else if (input.type === 'number') {
                                    const num = parseFloat(value);
                                    if (!isNaN(num)) value = num;
                                }
                                
                                if (value !== '' && value !== null && value !== undefined) {
                                    options[optName] = value;
                                }
                            });
                        }

                        // Automatically add session_id for post modules
                        const isPostModule = selectedSessionModule.startsWith('post/');
                        if (isPostModule && currentSessionId) {
                            options.session_id = currentSessionId;
                        }

                        if (sessionModuleOutput) {
                            sessionModuleOutput.textContent = `Running ${selectedSessionModule}...\n`;
                        }

                        try {
                            const res = await fetch(`/api/session/${encodeURIComponent(currentSessionId)}/run_module`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ module_id: selectedSessionModule, options })
                            });
                            const data = await res.json().catch(() => ({}));
                            
                            if (res.ok && data.success) {
                                // Check if we have an execution_id for real-time streaming
                                if (data.execution_id && data.is_running) {
                                    // Poll for real-time output
                                    const executionId = data.execution_id;
                                    if (sessionModuleOutput) {
                                        sessionModuleOutput.textContent = data.output || 'Module execution started...\n';
                                    }
                                    
                                    // Poll for updates
                                    let pollInterval = setInterval(async () => {
                                        try {
                                            const pollRes = await fetch(`/api/module-output/${executionId}`);
                                            if (!pollRes.ok) {
                                                clearInterval(pollInterval);
                                                return;
                                            }
                                            const pollData = await pollRes.json();
                                            
                                            if (pollData.output && sessionModuleOutput) {
                                                // Remove [MODULE_COMPLETED] marker if present
                                                let cleanOutput = pollData.output.replace(/\n\[MODULE_COMPLETED\]/g, '');
                                                sessionModuleOutput.textContent = cleanOutput;
                                                // Auto-scroll to bottom
                                                sessionModuleOutput.scrollTop = sessionModuleOutput.scrollHeight;
                                                
                                                // Check if module is completed
                                                if (pollData.is_completed || 
                                                    pollData.output.includes('[MODULE_COMPLETED]')) {
                                                    clearInterval(pollInterval);
                                                    pollInterval = null;
                                                    // Clean up the execution_id from storage after a delay
                                                    setTimeout(() => {
                                                        fetch(`/api/module-output/${executionId}`, { method: 'DELETE' }).catch(() => {});
                                                    }, 5000);
                                                }
                                            }
                                        } catch (err) {
                                            console.error("Polling error:", err);
                                            if (pollInterval) {
                                                clearInterval(pollInterval);
                                                pollInterval = null;
                                            }
                                            if (sessionModuleOutput) {
                                                sessionModuleOutput.textContent += `\nError polling output: ${err.message}`;
                                            }
                                        }
                                    }, 300); // Poll every 300ms
                                    
                                    // Stop polling after 5 minutes max
                                    setTimeout(() => {
                                        if (pollInterval) {
                                            clearInterval(pollInterval);
                                            pollInterval = null;
                                        }
                                    }, 300000);
                                } else {
                                    // Fallback to old behavior if no execution_id
                                    if (sessionModuleOutput) sessionModuleOutput.textContent = data.output || 'Done.';
                                }
                            } else {
                                const err = data.error || `HTTP ${res.status}`;
                                if (sessionModuleOutput) sessionModuleOutput.textContent = `Error: ${err}`;
                            }
                        } catch (e) {
                            if (sessionModuleOutput) sessionModuleOutput.textContent = `Error: ${e.message}`;
                        }
                    });
                }

                // Interact with session
                if (interactBtn) {
                    interactBtn.addEventListener('click', () => {
                        if (currentSessionId) {
                            // Switch to commands tab and focus input
                            document.querySelector(`#${wId} .session-tab[data-tab="commands"]`).click();
                            if (commandInput) {
                                setTimeout(() => commandInput.focus(), 100);
                            }
                        }
                    });
                }

                // Kill session (open in-app modal instead of browser confirm)
                const killModal = document.querySelector(`#${wId} #kill-session-modal`);
                const killModalCloseBtn = document.querySelector(`#${wId} #kill-session-close-btn`);
                const killModalCancelBtn = document.querySelector(`#${wId} #kill-session-cancel-btn`);
                const killModalConfirmBtn = document.querySelector(`#${wId} #kill-session-confirm-btn`);
                const killModalSessionIdText = document.querySelector(`#${wId} #kill-session-id-text`);
                const killModalTypeText = document.querySelector(`#${wId} #kill-session-type-text`);
                const killModalTargetText = document.querySelector(`#${wId} #kill-session-target-text`);
                const killModalStatusText = document.querySelector(`#${wId} #kill-session-status-text`);
                const killModalError = document.querySelector(`#${wId} #kill-session-error`);
                
                // Debug: Log modal elements
                console.log(`[SessionManager] Kill modal elements:`, {
                    modal: !!killModal,
                    closeBtn: !!killModalCloseBtn,
                    cancelBtn: !!killModalCancelBtn,
                    confirmBtn: !!killModalConfirmBtn,
                    sessionIdText: !!killModalSessionIdText,
                    error: !!killModalError
                });

                const openKillSessionModal = async (sessionId) => {
                    if (!killModal) return;
                    if (killModalError) {
                        killModalError.style.display = 'none';
                        killModalError.textContent = '';
                    }
                    
                    killModal.dataset.sessionId = String(sessionId || '');
                    
                    // Find session in the sessions list
                    const session = sessions.find(s => {
                        const sessionIdentifier = s.id || s.session_id || s.sessionId || s.uuid || s.victim_id || s.client_id;
                        return sessionIdentifier === sessionId;
                    });
                    
                    // Update modal with session information
                    if (killModalSessionIdText) {
                        killModalSessionIdText.textContent = sessionId || 'Unknown';
                    }
                    
                    // Update type
                    const typeText = document.querySelector(`#${wId} #kill-session-type-text`);
                    if (typeText) {
                        if (session) {
                            const sessionType = (session.type || 'Unknown').toString().toUpperCase();
                            typeText.textContent = sessionType;
                            typeText.style.color = session.type === 'browser' ? '#f59e0b' : 
                                                   session.type === 'meterpreter' ? '#8b5cf6' : '#58a6ff';
                        } else {
                            typeText.textContent = '-';
                            typeText.style.color = '#c9d1d9';
                        }
                    }
                    
                    // Update target
                    const targetText = document.querySelector(`#${wId} #kill-session-target-text`);
                    if (targetText) {
                        if (session) {
                            targetText.textContent = getSessionTarget(session);
                        } else {
                            // Try to fetch session details if not in list
                            try {
                                const encodedSessionId = encodeURIComponent(sessionId);
                                const res = await fetch(`/api/sessions/${encodedSessionId}`);
                                if (res.ok) {
                                    const sessionData = await res.json();
                                    targetText.textContent = getSessionTarget(sessionData);
                                    
                                    // Update type if we got session data
                                    if (typeText && sessionData.type) {
                                        typeText.textContent = sessionData.type.toUpperCase();
                                        typeText.style.color = sessionData.type === 'browser' ? '#f59e0b' : 
                                                             sessionData.type === 'meterpreter' ? '#8b5cf6' : '#58a6ff';
                                    }
                                    
                                    // Update status
                                    const statusText = document.querySelector(`#${wId} #kill-session-status-text`);
                                    if (statusText) {
                                        statusText.textContent = sessionData.active !== false ? 'Active' : 'Inactive';
                                        statusText.style.color = sessionData.active !== false ? '#3fb950' : '#8b949e';
                                    }
                                } else {
                                    targetText.textContent = 'Unknown';
                                }
                            } catch (e) {
                                targetText.textContent = 'Unknown';
                            }
                        }
                    }
                    
                    // Update status
                    const statusText = document.querySelector(`#${wId} #kill-session-status-text`);
                    if (statusText) {
                        if (session) {
                            statusText.textContent = session.active !== false ? 'Active' : 'Inactive';
                            statusText.style.color = session.active !== false ? '#3fb950' : '#8b949e';
                        } else {
                            statusText.textContent = '-';
                            statusText.style.color = '#c9d1d9';
                        }
                    }
                    
                    killModal.style.display = 'flex';
                    if (killModalConfirmBtn) killModalConfirmBtn.focus();
                };

                const closeKillSessionModal = () => {
                    if (!killModal) return;
                    killModal.style.display = 'none';
                    delete killModal.dataset.sessionId;
                };

                if (killModal) {
                    killModal.addEventListener('click', (e) => {
                        if (e.target === killModal) closeKillSessionModal();
                    });
                }
                if (killModalCloseBtn) killModalCloseBtn.addEventListener('click', closeKillSessionModal);
                if (killModalCancelBtn) killModalCancelBtn.addEventListener('click', closeKillSessionModal);
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && killModal && killModal.style.display === 'flex') {
                        closeKillSessionModal();
                    }
                });

                if (killBtn) {
                    killBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        // Try to get session ID from currentSessionId first
                        let sessionIdToKill = currentSessionId;
                        
                        // If not available, try to get from selected session item
                        if (!sessionIdToKill) {
                            const selectedItem = document.querySelector(`#${wId} .session-item.selected`);
                            if (selectedItem) {
                                sessionIdToKill = selectedItem.dataset.sessionId || selectedItem.getAttribute('data-session-id');
                            }
                        }
                        
                        // If still not available, try to get from session details
                        if (!sessionIdToKill && sessionDetails.style.display !== 'none') {
                            const sessionIdElement = document.querySelector(`#${wId} #detail-id`);
                            if (sessionIdElement) {
                                sessionIdToKill = sessionIdElement.textContent.trim();
                            }
                        }
                        
                        if (!sessionIdToKill) {
                            console.warn('No session ID available for kill action');
                            this.showNotification('No session selected', 'error', 2000);
                            return;
                        }
                        
                        console.log('Opening kill modal for session:', sessionIdToKill);
                        openKillSessionModal(sessionIdToKill);
                    });
                } else {
                    console.warn('Kill button not found in DOM');
                }

                if (killModalConfirmBtn) {
                    killModalConfirmBtn.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        const sessionId = (killModal && killModal.dataset.sessionId) ? killModal.dataset.sessionId : '';
                        if (!sessionId) {
                            console.error('No session ID in kill modal');
                            if (killModalError) {
                                killModalError.style.display = 'block';
                                killModalError.textContent = 'No session ID specified';
                            }
                            return;
                        }

                        if (killModalError) {
                            killModalError.style.display = 'none';
                            killModalError.textContent = '';
                        }

                        // Disable button during request
                        killModalConfirmBtn.disabled = true;
                        killModalConfirmBtn.style.opacity = '0.6';
                        killModalConfirmBtn.style.cursor = 'not-allowed';
                        
                        try {
                            console.log('Sending kill request for session:', sessionId);
                            const encodedSessionId = encodeURIComponent(sessionId);
                            const res = await fetch(`/api/sessions/${encodedSessionId}/kill`, { 
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            if (res.ok) {
                                const data = await res.json().catch(() => ({}));
                                console.log('Session killed successfully:', data);
                                closeKillSessionModal();
                                await loadSessions();
                                noSessionSelected.style.display = 'flex';
                                sessionDetails.style.display = 'none';
                                currentSessionId = null;
                                this.showNotification('Session killed.', 'success', 2000);
                            } else {
                                const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                                const msg = errorData.error || `HTTP ${res.status}`;
                                console.error('Error killing session:', msg);
                                if (killModalError) {
                                    killModalError.style.display = 'block';
                                    killModalError.textContent = msg;
                                } else {
                                    this.showNotification(`Error: ${msg}`, 'error', 2500);
                                }
                            }
                        } catch (err) {
                            const msg = err && err.message ? err.message : 'Unknown error';
                            console.error('Exception killing session:', err);
                            if (killModalError) {
                                killModalError.style.display = 'block';
                                killModalError.textContent = msg;
                            } else {
                                this.showNotification(`Error: ${msg}`, 'error', 2500);
                            }
                        } finally {
                            // Re-enable button
                            killModalConfirmBtn.disabled = false;
                            killModalConfirmBtn.style.opacity = '1';
                            killModalConfirmBtn.style.cursor = 'pointer';
                        }
                    });
                } else {
                    console.warn('Kill modal confirm button not found in DOM');
                }

                // Execute command
                const executeCommand = async () => {
                    if (!currentSessionId || !commandInput.value.trim()) return;

                    // Validate session ID
                    if (!currentSessionId || typeof currentSessionId !== 'string' || currentSessionId.trim().length < 10) {
                        commandOutput.innerHTML += `<div style="color: #f85149; margin-bottom: 12px;">Error: Invalid session ID</div>`;
                        return;
                    }

                    const command = commandInput.value.trim();
                    const prompt = getShellPrompt();
                    appendTerminalLine(`<div style="color: #58a6ff; margin-bottom: 6px;">${prompt}${escapeHtml(command)}</div>`);

                    // History
                    if (commandHistory.length === 0 || commandHistory[commandHistory.length - 1] !== command) {
                        commandHistory.push(command);
                    }
                    historyIndex = -1;
                    commandInput.value = '';

                    try {
                        // Encode session ID to handle special characters
                        const encodedSessionId = encodeURIComponent(currentSessionId.trim());
                        const res = await fetch(`/api/session/${encodedSessionId}/exec`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ command: command })
                        });

                        if (res.ok) {
                            const data = await res.json();
                            const out = data.output || '';
                            appendTerminalLine(`<div style="color: #c9d1d9; margin-bottom: 12px; white-space: pre-wrap;">${escapeHtml(out)}</div>`);
                        } else {
                            const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
                            appendTerminalLine(`<div style="color: #f85149; margin-bottom: 12px;">Error: ${escapeHtml(errorData.error || `HTTP ${res.status}`)}</div>`);
                        }
                    } catch (err) {
                        console.error('Error executing command:', err);
                        const errorMsg = err.name === 'TypeError' && err.message.includes('fetch') 
                            ? 'Network error: Could not connect to server' 
                            : `Error: ${err.message}`;
                        appendTerminalLine(`<div style="color: #f85149; margin-bottom: 12px;">${escapeHtml(errorMsg)}</div>`);
                    }
                };

                if (commandInput) {
                    commandInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            executeCommand();
                            return;
                        }

                        // History navigation
                        if (e.key === 'ArrowUp') {
                            if (!commandHistory.length) return;
                            e.preventDefault();
                            if (historyIndex === -1) historyIndex = commandHistory.length - 1;
                            else historyIndex = Math.max(0, historyIndex - 1);
                            commandInput.value = commandHistory[historyIndex] || '';
                            // Move caret to end
                            setTimeout(() => commandInput.setSelectionRange(commandInput.value.length, commandInput.value.length), 0);
                            return;
                        }
                        if (e.key === 'ArrowDown') {
                            if (!commandHistory.length) return;
                            e.preventDefault();
                            if (historyIndex === -1) return;
                            historyIndex = historyIndex + 1;
                            if (historyIndex >= commandHistory.length) {
                                historyIndex = -1;
                                commandInput.value = '';
                            } else {
                                commandInput.value = commandHistory[historyIndex] || '';
                                setTimeout(() => commandInput.setSelectionRange(commandInput.value.length, commandInput.value.length), 0);
                            }
                            return;
                        }

                        // Ctrl+L clears terminal
                        if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
                            e.preventDefault();
                            if (commandOutput) {
                                commandOutput.dataset.placeholderShown = 'false';
                                commandOutput.innerHTML = '';
                            }
                            return;
                        }
                    });
                }

                // Small HTML escaping helper (avoid breaking terminal output)
                const escapeHtml = (str) => {
                    return String(str)
                        .replaceAll('&', '&amp;')
                        .replaceAll('<', '&lt;')
                        .replaceAll('>', '&gt;')
                        .replaceAll('"', '&quot;')
                        .replaceAll("'", '&#039;');
                };

                // Event listeners
                if (sessionSearch) sessionSearch.addEventListener('input', renderSessionsList);
                if (typeFilter) typeFilter.addEventListener('change', renderSessionsList);
                if (statusFilter) statusFilter.addEventListener('change', renderSessionsList);
                if (refreshBtn) refreshBtn.addEventListener('click', loadSessions);

                // Initial load
                loadSessions();
                // Auto-refresh every 5 seconds
                setInterval(loadSessions, 5000);
            }
        });
    }

    spawnBrowserServer() {
        const winId = this.wm.createWindow({
            title: 'Browser Server',
            icon: 'globe-outline',
            width: '700px',
            height: '600px',
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif;">
                    <!-- Status Section -->
                    <div style="padding: 20px; border-bottom: 1px solid #30363d; background: #161b22;">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                            <h2 style="margin: 0; font-size: 20px; color: #58a6ff; display: flex; align-items: center; gap: 10px;">
                                <ion-icon name="globe-outline"></ion-icon>
                                Browser Server
                            </h2>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span id="server-status-indicator" style="width: 10px; height: 10px; border-radius: 50%; background: #8b949e;"></span>
                                <span id="server-status-text" style="font-size: 13px; color: #8b949e;">Stopped</span>
                            </div>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 15px;">
                            <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 12px;">
                                <div style="font-size: 11px; color: #8b949e; margin-bottom: 5px;">Uptime</div>
                                <div style="font-size: 16px; font-weight: 600; color: #c9d1d9;" id="server-uptime">-</div>
                            </div>
                            <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 12px;">
                                <div style="font-size: 11px; color: #8b949e; margin-bottom: 5px;">Active Sessions</div>
                                <div style="font-size: 16px; font-weight: 600; color: #c9d1d9;" id="server-sessions">0</div>
                            </div>
                        </div>
                        <div style="display: flex; gap: 10px;">
                            <button id="start-server-btn" style="flex: 1; padding: 10px; background: #238636; border: 1px solid #238636; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px;">
                                <ion-icon name="play-outline"></ion-icon>
                                Start Server
                            </button>
                            <button id="stop-server-btn" style="flex: 1; padding: 10px; background: #f85149; border: 1px solid #f85149; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px; display: none;">
                                <ion-icon name="stop-outline"></ion-icon>
                                Stop Server
                            </button>
                        </div>
                    </div>

                    <!-- Configuration Section -->
                    <div style="padding: 20px; border-bottom: 1px solid #30363d; background: #161b22;">
                        <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #c9d1d9;">Configuration</h3>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                            <div>
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 6px;">Host</label>
                                <input type="text" id="server-host" value="0.0.0.0" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; box-sizing: border-box;">
                            </div>
                            <div>
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 6px;">Port</label>
                                <input type="number" id="server-port" value="8080" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; box-sizing: border-box;">
                            </div>
                        </div>
                        <div>
                            <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 6px;">JavaScript Obfuscation</label>
                            <select id="server-obfuscation" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; box-sizing: border-box; cursor: pointer;">
                                <option value="">Disabled</option>
                                <option value="simple">Simple (minify)</option>
                                <option value="medium">Medium (minify + encode strings)</option>
                                <option value="heavy">Heavy (all techniques)</option>
                            </select>
                        </div>
                    </div>

                    <!-- Links Section -->
                    <div style="flex: 1; overflow-y: auto; padding: 20px;">
                        <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #c9d1d9;">Quick Links</h3>
                        <div id="server-links" style="display: grid; gap: 10px;">
                            <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <div style="display: flex; align-items: center; gap: 10px;">
                                        <ion-icon name="code-outline" style="font-size: 20px; color: #58a6ff;"></ion-icon>
                                        <div>
                                            <div style="font-weight: 600; color: #c9d1d9; font-size: 14px;">Injection Script</div>
                                            <div style="font-size: 11px; color: #8b949e;">Main browser hook script</div>
                                        </div>
                                    </div>
                                    <button class="copy-link-btn" data-link="inject" style="padding: 6px 12px; background: rgba(88, 166, 255, 0.1); border: 1px solid #58a6ff; border-radius: 4px; color: #58a6ff; cursor: pointer; font-size: 12px;">
                                        Copy
                                    </button>
                                </div>
                                <div id="link-inject" style="font-family: 'Fira Code', monospace; font-size: 11px; color: #8b949e; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; word-break: break-all;">
                                    Server not running
                                </div>
                            </div>

                            <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <div style="display: flex; align-items: center; gap: 10px;">
                                        <ion-icon name="bug-outline" style="font-size: 20px; color: #f59e0b;"></ion-icon>
                                        <div>
                                            <div style="font-weight: 600; color: #c9d1d9; font-size: 14px;">XSS Injection</div>
                                            <div style="font-size: 11px; color: #8b949e;">XSS-optimized script</div>
                                        </div>
                                    </div>
                                    <button class="copy-link-btn" data-link="xss" style="padding: 6px 12px; background: rgba(88, 166, 255, 0.1); border: 1px solid #58a6ff; border-radius: 4px; color: #58a6ff; cursor: pointer; font-size: 12px;">
                                        Copy
                                    </button>
                                </div>
                                <div id="link-xss" style="font-family: 'Fira Code', monospace; font-size: 11px; color: #8b949e; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; word-break: break-all;">
                                    Server not running
                                </div>
                            </div>

                            <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <div style="display: flex; align-items: center; gap: 10px;">
                                        <ion-icon name="settings-outline" style="font-size: 20px; color: #8b5cf6;"></ion-icon>
                                        <div>
                                            <div style="font-weight: 600; color: #c9d1d9; font-size: 14px;">Admin Interface</div>
                                            <div style="font-size: 11px; color: #8b949e;">Management dashboard</div>
                                        </div>
                                    </div>
                                    <div style="display: flex; gap: 6px;">
                                        <button class="open-admin-btn" data-link="admin" style="padding: 6px 12px; background: rgba(139, 92, 246, 0.1); border: 1px solid #8b5cf6; border-radius: 4px; color: #8b5cf6; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 4px;">
                                            <ion-icon name="open-outline" style="font-size: 14px;"></ion-icon>
                                            Open
                                        </button>
                                        <button class="copy-link-btn" data-link="admin" style="padding: 6px 12px; background: rgba(88, 166, 255, 0.1); border: 1px solid #58a6ff; border-radius: 4px; color: #58a6ff; cursor: pointer; font-size: 12px;">
                                            Copy
                                        </button>
                                    </div>
                                </div>
                                <div id="link-admin" style="font-family: 'Fira Code', monospace; font-size: 11px; color: #8b949e; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; word-break: break-all;">
                                    Server not running
                                </div>
                            </div>

                            <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <div style="display: flex; align-items: center; gap: 10px;">
                                        <ion-icon name="flask-outline" style="font-size: 20px; color: #3fb950;"></ion-icon>
                                        <div>
                                            <div style="font-weight: 600; color: #c9d1d9; font-size: 14px;">Test Page</div>
                                            <div style="font-size: 11px; color: #8b949e;">Quick test interface</div>
                                        </div>
                                    </div>
                                    <div style="display: flex; gap: 6px;">
                                        <button class="open-test-btn" data-link="test" style="padding: 6px 12px; background: rgba(63, 185, 80, 0.1); border: 1px solid #3fb950; border-radius: 4px; color: #3fb950; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 4px;">
                                            <ion-icon name="open-outline" style="font-size: 14px;"></ion-icon>
                                            Open
                                        </button>
                                        <button class="copy-link-btn" data-link="test" style="padding: 6px 12px; background: rgba(88, 166, 255, 0.1); border: 1px solid #58a6ff; border-radius: 4px; color: #58a6ff; cursor: pointer; font-size: 12px;">
                                            Copy
                                        </button>
                                    </div>
                                </div>
                                <div id="link-test" style="font-family: 'Fira Code', monospace; font-size: 11px; color: #8b949e; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; word-break: break-all;">
                                    Server not running
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const self = this;
                const startBtn = document.querySelector(`#${wId} #start-server-btn`);
                const stopBtn = document.querySelector(`#${wId} #stop-server-btn`);
                const statusIndicator = document.querySelector(`#${wId} #server-status-indicator`);
                const statusText = document.querySelector(`#${wId} #server-status-text`);
                const uptimeEl = document.querySelector(`#${wId} #server-uptime`);
                const sessionsEl = document.querySelector(`#${wId} #server-sessions`);
                const hostInput = document.querySelector(`#${wId} #server-host`);
                const portInput = document.querySelector(`#${wId} #server-port`);
                const obfuscationSelect = document.querySelector(`#${wId} #server-obfuscation`);

                // Load server status
                const loadServerStatus = async () => {
                    try {
                        const res = await fetch('/api/browser_server/status');
                        const data = await res.json();

                        if (data.running) {
                            if (statusIndicator) statusIndicator.style.background = '#3fb950';
                            if (statusText) {
                                statusText.textContent = 'Running';
                                statusText.style.color = '#3fb950';
                            }
                            if (startBtn) startBtn.style.display = 'none';
                            if (stopBtn) stopBtn.style.display = 'flex';

                            if (uptimeEl) uptimeEl.textContent = data.uptime || '0:00:00';
                            if (sessionsEl) sessionsEl.textContent = data.total_sessions || 0;
                            
                            // Update obfuscation select to reflect current server state
                            if (obfuscationSelect) {
                                if (data.obfuscate_js && data.obfuscation_level) {
                                    obfuscationSelect.value = data.obfuscation_level;
                                } else {
                                    obfuscationSelect.value = '';
                                }
                            }
                            
                            // Update links
                            const host = data.host === '0.0.0.0' ? 'localhost' : data.host;
                            if (data.links) {
                                const linkInject = document.querySelector(`#${wId} #link-inject`);
                                const linkXss = document.querySelector(`#${wId} #link-xss`);
                                const linkAdmin = document.querySelector(`#${wId} #link-admin`);
                                const linkTest = document.querySelector(`#${wId} #link-test`);
                                
                                if (linkInject) linkInject.textContent = data.links.inject || 'N/A';
                                if (linkXss) linkXss.textContent = data.links.xss || 'N/A';
                                if (linkAdmin) linkAdmin.textContent = data.links.admin || 'N/A';
                                if (linkTest) linkTest.textContent = data.links.test || 'N/A';
                            }
                        } else {
                            if (statusIndicator) statusIndicator.style.background = '#8b949e';
                            if (statusText) {
                                statusText.textContent = 'Stopped';
                                statusText.style.color = '#8b949e';
                            }
                            if (startBtn) startBtn.style.display = 'flex';
                            if (stopBtn) stopBtn.style.display = 'none';
                            
                            if (uptimeEl) uptimeEl.textContent = '-';
                            if (sessionsEl) sessionsEl.textContent = '0';
                            
                            const linkInject = document.querySelector(`#${wId} #link-inject`);
                            const linkXss = document.querySelector(`#${wId} #link-xss`);
                            const linkAdmin = document.querySelector(`#${wId} #link-admin`);
                            const linkTest = document.querySelector(`#${wId} #link-test`);
                            
                            if (linkInject) linkInject.textContent = 'Server not running';
                            if (linkXss) linkXss.textContent = 'Server not running';
                            if (linkAdmin) linkAdmin.textContent = 'Server not running';
                            if (linkTest) linkTest.textContent = 'Server not running';
                        }
                    } catch (err) {
                        console.error('Error loading server status:', err);
                    }
                };

                // Start server
                if (startBtn) {
                    startBtn.addEventListener('click', async () => {
                        const host = hostInput.value.trim() || '0.0.0.0';
                        const port = parseInt(portInput.value) || 8080;
                        const obfuscationLevel = obfuscationSelect.value || null;
                        
                        try {
                            const res = await fetch('/api/browser_server/start', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ 
                                    host: host, 
                                    port: port,
                                    obfuscation_level: obfuscationLevel
                                })
                            });
                            
                            const data = await res.json();
                            if (res.ok && data.success) {
                                await loadServerStatus();
                            } else {
                                alert(`Error starting server: ${data.error || 'Unknown error'}`);
                            }
                        } catch (err) {
                            console.error('Error starting server:', err);
                            alert('Error starting server');
                        }
                    });
                }

                // Stop server
                if (stopBtn) {
                    stopBtn.addEventListener('click', async () => {
                        const confirmed = await os.showConfirmDialog(
                            'Are you sure you want to stop the browser server?',
                            'Stop Browser Server',
                            'warning-outline',
                            'Stop Server',
                            'Cancel',
                            '#f85149'
                        );
                        
                        if (!confirmed) {
                            return;
                        }
                        
                        try {
                            const res = await fetch('/api/browser_server/stop', {
                                method: 'POST'
                            });
                            
                            if (res.ok) {
                                await loadServerStatus();
                            } else {
                                alert('Error stopping server');
                            }
                        } catch (err) {
                            console.error('Error stopping server:', err);
                            alert('Error stopping server');
                        }
                    });
                }

                // Copy link buttons
                document.querySelectorAll(`#${wId} .copy-link-btn`).forEach(btn => {
                    btn.addEventListener('click', () => {
                        const linkType = btn.dataset.link;
                        const linkEl = document.querySelector(`#${wId} #link-${linkType}`);
                        const linkText = linkEl.textContent;
                        
                        if (linkText && linkText !== 'Server not running') {
                            navigator.clipboard.writeText(linkText).then(() => {
                                btn.textContent = 'Copied!';
                                setTimeout(() => {
                                    btn.textContent = 'Copy';
                                }, 2000);
                            });
                        }
                    });
                });

                // Open admin interface button
                document.querySelectorAll(`#${wId} .open-admin-btn`).forEach(btn => {
                    btn.addEventListener('click', () => {
                        const linkType = btn.dataset.link;
                        const linkEl = document.querySelector(`#${wId} #link-${linkType}`);
                        const linkText = linkEl.textContent;
                        
                        if (linkText && linkText !== 'Server not running') {
                            // Open admin interface in a kittyOS window
                            self.openBrowserServerAdmin(linkText);
                        }
                    });
                });

                // Open test page button
                document.querySelectorAll(`#${wId} .open-test-btn`).forEach(btn => {
                    btn.addEventListener('click', () => {
                        const linkType = btn.dataset.link;
                        const linkEl = document.querySelector(`#${wId} #link-${linkType}`);
                        const linkText = linkEl.textContent;
                        
                        if (linkText && linkText !== 'Server not running') {
                            // Open test page in a kittyOS window
                            self.openBrowserServerPage(linkText, 'Test Page', 'flask-outline');
                        }
                    });
                });

                // Initial load
                loadServerStatus();
                // Auto-refresh every 2 seconds
                setInterval(loadServerStatus, 2000);
            }
        });
    }

    spawnJobsManager() {
        const winId = this.wm.createWindow({
            title: 'Jobs Manager',
            icon: 'briefcase-outline',
            width: '1200px',
            height: '700px',
            headerButtons: `
                <button id="refresh-jobs-btn" class="header-action-btn" title="Refresh">
                    <ion-icon name="refresh-outline"></ion-icon>
                </button>
                <button id="clear-jobs-btn" class="header-action-btn" title="Clear Completed">
                    <ion-icon name="trash-outline"></ion-icon>
                </button>
            `,
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif;">
                    <!-- Header -->
                    <div style="padding: 20px; border-bottom: 1px solid #30363d; background: #161b22;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <div>
                                <h2 style="margin: 0; font-size: 20px; color: #58a6ff; display: flex; align-items: center; gap: 10px;">
                                    <ion-icon name="briefcase-outline"></ion-icon>
                                    Jobs Manager
                                </h2>
                                <div style="font-size: 13px; color: #8b949e; margin-top: 6px;">
                                    <span id="jobs-count">0</span> job(s) total
                                </div>
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                                <div style="background: rgba(88, 166, 255, 0.1); border: 1px solid #58a6ff; border-radius: 6px; padding: 12px; text-align: center;">
                                    <div style="font-size: 11px; color: #8b949e; margin-bottom: 4px;">Running</div>
                                    <div style="font-size: 20px; font-weight: 600; color: #58a6ff;" id="jobs-running">0</div>
                                </div>
                                <div style="background: rgba(59, 185, 80, 0.1); border: 1px solid #3fb950; border-radius: 6px; padding: 12px; text-align: center;">
                                    <div style="font-size: 11px; color: #8b949e; margin-bottom: 4px;">Completed</div>
                                    <div style="font-size: 20px; font-weight: 600; color: #3fb950;" id="jobs-completed">0</div>
                                </div>
                                <div style="background: rgba(248, 81, 73, 0.1); border: 1px solid #f85149; border-radius: 6px; padding: 12px; text-align: center;">
                                    <div style="font-size: 11px; color: #8b949e; margin-bottom: 4px;">Killed</div>
                                    <div style="font-size: 20px; font-weight: 600; color: #f85149;" id="jobs-killed">0</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Jobs List -->
                    <div style="flex: 1; overflow-y: auto; padding: 20px;">
                        <div id="jobs-list" style="display: grid; gap: 12px;">
                            <div style="text-align: center; color: #8b949e; padding: 40px;">Loading jobs...</div>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const jobsList = document.querySelector(`#${wId} #jobs-list`);
                const refreshBtn = document.querySelector(`#${wId} #refresh-jobs-btn`);
                const clearBtn = document.querySelector(`#${wId} #clear-jobs-btn`);
                const jobsCount = document.querySelector(`#${wId} #jobs-count`);
                const jobsRunning = document.querySelector(`#${wId} #jobs-running`);
                const jobsCompleted = document.querySelector(`#${wId} #jobs-completed`);
                const jobsKilled = document.querySelector(`#${wId} #jobs-killed`);

                // Load jobs
                const loadJobs = async () => {
                    try {
                        const res = await fetch('/api/jobs');
                        const data = await res.json();
                        const jobs = data.jobs || [];
                        renderJobsList(jobs);
                    } catch (err) {
                        console.error('Error loading jobs:', err);
                        jobsList.innerHTML = '<div style="color: #f85149; padding: 20px; text-align: center;">Error loading jobs</div>';
                    }
                };

                // Render jobs list
                const renderJobsList = (jobs) => {
                    jobsCount.textContent = jobs.length;
                    
                    const running = jobs.filter(j => j.status === 'running').length;
                    const completed = jobs.filter(j => j.status === 'completed').length;
                    const killed = jobs.filter(j => j.status === 'killed').length;
                    
                    jobsRunning.textContent = running;
                    jobsCompleted.textContent = completed;
                    jobsKilled.textContent = killed;

                    if (jobs.length === 0) {
                        jobsList.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 40px;"><ion-icon name="briefcase-outline" style="font-size: 48px; color: #30363d; margin-bottom: 16px;"></ion-icon><div>No jobs found</div></div>';
                        return;
                    }

                    jobsList.innerHTML = jobs.map(job => {
                        const statusColor = job.status === 'running' ? '#58a6ff' :
                                          job.status === 'completed' ? '#3fb950' :
                                          job.status === 'killed' ? '#f85149' : '#8b949e';
                        
                        const startTime = job.started_at ? new Date(job.started_at).toLocaleString() : 'Unknown';
                        const endTime = job.completed_at ? new Date(job.completed_at).toLocaleString() :
                                       job.killed_at ? new Date(job.killed_at).toLocaleString() : null;
                        
                        return `
                            <div style="background: rgba(255,255,255,0.03); border: 1px solid #30363d; border-radius: 6px; padding: 15px; transition: all 0.2s;"
                                 onmouseover="this.style.borderColor='#58a6ff'; this.style.background='rgba(88, 166, 255, 0.05)'"
                                 onmouseout="this.style.borderColor='#30363d'; this.style.background='rgba(255,255,255,0.03)'">
                                <div style="display: flex; align-items: start; justify-content: space-between; margin-bottom: 12px;">
                                    <div style="flex: 1;">
                                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                                            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${statusColor};"></span>
                                            <span style="font-weight: 600; font-size: 15px; color: #c9d1d9;">${job.name || 'Unnamed Job'}</span>
                                            <span style="padding: 2px 8px; background: ${statusColor}20; border: 1px solid ${statusColor}; border-radius: 3px; font-size: 10px; color: ${statusColor}; font-weight: 600; text-transform: uppercase;">
                                                ${job.status}
                                            </span>
                                        </div>
                                        ${job.description ? `<div style="font-size: 12px; color: #8b949e; margin-left: 18px; margin-bottom: 6px;">${job.description}</div>` : ''}
                                        ${job.target ? `<div style="font-size: 11px; color: #6e7681; margin-left: 18px; font-family: monospace;">Target: ${job.target}</div>` : ''}
                                    </div>
                                    <div style="display: flex; gap: 8px;">
                                        ${job.status === 'running' ? `
                                            <button class="kill-job-btn" data-job-id="${job.id}" style="padding: 6px 12px; background: #f85149; border: 1px solid #f85149; border-radius: 4px; color: white; cursor: pointer; font-size: 12px; font-weight: 500;">
                                                Kill
                                            </button>
                                        ` : ''}
                                        <button class="view-job-btn" data-job-id="${job.id}" style="padding: 6px 12px; background: rgba(88, 166, 255, 0.1); border: 1px solid #58a6ff; border-radius: 4px; color: #58a6ff; cursor: pointer; font-size: 12px; font-weight: 500;">
                                            View
                                        </button>
                                    </div>
                                </div>
                                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #30363d;">
                                    <div>
                                        <div style="font-size: 10px; color: #8b949e; margin-bottom: 4px;">Started</div>
                                        <div style="font-size: 11px; color: #c9d1d9;">${startTime}</div>
                                    </div>
                                    ${endTime ? `
                                        <div>
                                            <div style="font-size: 10px; color: #8b949e; margin-bottom: 4px;">Ended</div>
                                            <div style="font-size: 11px; color: #c9d1d9;">${endTime}</div>
                                        </div>
                                    ` : '<div></div>'}
                                    <div>
                                        <div style="font-size: 10px; color: #8b949e; margin-bottom: 4px;">Job ID</div>
                                        <div style="font-size: 11px; color: #c9d1d9; font-family: monospace;">#${job.id}</div>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');

                    // Add event listeners
                    document.querySelectorAll(`#${wId} .kill-job-btn`).forEach(btn => {
                        btn.addEventListener('click', async () => {
                            const jobId = parseInt(btn.dataset.jobId);
                            if (!confirm(`Are you sure you want to kill job #${jobId}?`)) {
                                return;
                            }
                            
                            try {
                                const res = await fetch(`/api/jobs/${jobId}/kill`, {
                                    method: 'POST'
                                });
                                
                                if (res.ok) {
                                    await loadJobs();
                                } else {
                                    alert('Error killing job');
                                }
                            } catch (err) {
                                console.error('Error killing job:', err);
                                alert('Error killing job');
                            }
                        });
                    });

                    document.querySelectorAll(`#${wId} .view-job-btn`).forEach(btn => {
                        btn.addEventListener('click', async () => {
                            const jobId = parseInt(btn.dataset.jobId);
                            viewJobDetails(jobId);
                        });
                    });
                };

                // View job details
                const viewJobDetails = async (jobId) => {
                    try {
                        const res = await fetch(`/api/jobs/${jobId}`);
                        if (res.ok) {
                            const job = await res.json();
                            
                            // Create details window
                            const detailsWinId = this.wm.createWindow({
                                title: `Job #${jobId} - ${job.name}`,
                                icon: 'information-circle-outline',
                                width: '800px',
                                height: '600px',
                                content: `
                                    <div style="padding: 20px; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif; height: 100%; display: flex; flex-direction: column;">
                                        <div style="margin-bottom: 20px;">
                                            <h3 style="margin: 0 0 15px 0; color: #58a6ff;">Job Information</h3>
                                            <div style="display: grid; gap: 12px;">
                                                <div><strong style="color: #8b949e;">Name:</strong> <span style="color: #c9d1d9;">${job.name}</span></div>
                                                ${job.description ? `<div><strong style="color: #8b949e;">Description:</strong> <span style="color: #c9d1d9;">${job.description}</span></div>` : ''}
                                                <div><strong style="color: #8b949e;">Status:</strong> <span style="color: ${job.status === 'running' ? '#58a6ff' : job.status === 'completed' ? '#3fb950' : '#f85149'};">${job.status.toUpperCase()}</span></div>
                                                ${job.target ? `<div><strong style="color: #8b949e;">Target:</strong> <span style="color: #c9d1d9; font-family: monospace;">${job.target}</span></div>` : ''}
                                                <div><strong style="color: #8b949e;">Started:</strong> <span style="color: #c9d1d9;">${job.started_at ? new Date(job.started_at).toLocaleString() : 'Unknown'}</span></div>
                                                ${job.completed_at ? `<div><strong style="color: #8b949e;">Completed:</strong> <span style="color: #c9d1d9;">${new Date(job.completed_at).toLocaleString()}</span></div>` : ''}
                                                ${job.killed_at ? `<div><strong style="color: #8b949e;">Killed:</strong> <span style="color: #c9d1d9;">${new Date(job.killed_at).toLocaleString()}</span></div>` : ''}
                                            </div>
                                        </div>
                                        
                                        ${job.output ? `
                                            <div style="flex: 1; margin-bottom: 15px;">
                                                <h4 style="margin: 0 0 10px 0; color: #c9d1d9;">Output</h4>
                                                <div style="background: #0d1117; border: 1px solid #30363d; border-radius: 4px; padding: 15px; font-family: 'Fira Code', monospace; font-size: 12px; color: #c9d1d9; overflow-y: auto; max-height: 200px; white-space: pre-wrap; word-wrap: break-word;">
                                                    ${job.output}
                                                </div>
                                            </div>
                                        ` : ''}
                                        
                                        ${job.error ? `
                                            <div style="flex: 1;">
                                                <h4 style="margin: 0 0 10px 0; color: #f85149;">Errors</h4>
                                                <div style="background: rgba(248, 81, 73, 0.1); border: 1px solid #f85149; border-radius: 4px; padding: 15px; font-family: 'Fira Code', monospace; font-size: 12px; color: #f85149; overflow-y: auto; max-height: 200px; white-space: pre-wrap; word-wrap: break-word;">
                                                    ${job.error}
                                                </div>
                                            </div>
                                        ` : ''}
                                    </div>
                                `
                            });
                        } else {
                            alert('Error loading job details');
                        }
                    } catch (err) {
                        console.error('Error loading job details:', err);
                        alert('Error loading job details');
                    }
                };

                // Clear completed jobs
                if (clearBtn) {
                    clearBtn.addEventListener('click', async () => {
                        if (!confirm('Clear all completed and killed jobs?')) {
                            return;
                        }
                        
                        try {
                            const res = await fetch('/api/jobs/clear', {
                                method: 'POST'
                            });
                            
                            if (res.ok) {
                                await loadJobs();
                            } else {
                                alert('Error clearing jobs');
                            }
                        } catch (err) {
                            console.error('Error clearing jobs:', err);
                            alert('Error clearing jobs');
                        }
                    });
                }

                // Refresh button
                if (refreshBtn) {
                    refreshBtn.addEventListener('click', loadJobs);
                }

                // Initial load
                loadJobs();
                // Auto-refresh every 3 seconds
                setInterval(loadJobs, 3000);
            }
        });
    }

    spawnBackdoorGenerator() {
        const winId = this.wm.createWindow({
            title: 'Backdoor Generator',
            icon: 'key-outline',
            width: '1200px',
            height: '800px',
            top: '50px',
            left: '100px',
            content: `
                <div style="display: flex; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif;">
                    <!-- Left Panel: Module Selection -->
                    <div style="width: 40%; border-right: 1px solid #30363d; display: flex; flex-direction: column; background: #161b22;">
                        <div style="padding: 15px; border-bottom: 1px solid #30363d;">
                            <h3 style="margin: 0; font-size: 16px; color: #58a6ff;">Select Module</h3>
                        </div>
                        <div style="padding: 15px; border-bottom: 1px solid #30363d;">
                            <select id="backdoor-module-type" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none;">
                                <option value="backdoors">Backdoors</option>
                                <option value="payloads">Payloads</option>
                            </select>
                        </div>
                        <div id="backdoor-module-list" style="flex: 1; overflow-y: auto; padding: 10px;">
                            <div style="text-align: center; color: #8b949e; padding: 20px;">Loading modules...</div>
                        </div>
                    </div>
                    
                    <!-- Right Panel: Configuration & Output -->
                    <div style="flex: 1; display: flex; flex-direction: column; background: #0d1117;">
                        <!-- Module Info -->
                        <div id="backdoor-module-info" style="display: none; padding: 20px; border-bottom: 1px solid #30363d; background: #161b22;">
                            <h3 style="margin: 0 0 15px 0; font-size: 18px; color: #58a6ff;" id="backdoor-module-name">Module Name</h3>
                            <div style="font-size: 13px; color: #8b949e; margin-bottom: 15px;" id="backdoor-module-description">Description will appear here</div>
                            <div style="font-size: 12px; color: #8b949e;" id="backdoor-module-path">Path: -</div>
                        </div>
                        
                        <!-- Options Form -->
                        <div id="backdoor-options-container" style="display: none; flex: 1; overflow-y: auto; padding: 20px;">
                            <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #58a6ff;">Module Options</h3>
                            <div id="backdoor-options-form" style="display: flex; flex-direction: column; gap: 15px;">
                                <!-- Options will be dynamically generated here -->
                            </div>
                            <div style="margin-top: 20px;">
                                <button id="backdoor-generate-btn" style="width: 100%; padding: 12px; background: #238636; border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px;">
                                    <ion-icon name="key-outline"></ion-icon>
                                    Generate Backdoor
                                </button>
                            </div>
                        </div>
                        
                        <!-- Output -->
                        <div id="backdoor-output-container" style="display: none; flex: 1; padding: 20px; border-top: 1px solid #30363d; background: #0d1117; flex-direction: column; overflow-y: auto;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                                <h3 style="margin: 0; font-size: 16px; color: #58a6ff;">Generation Output</h3>
                                <button id="backdoor-copy-result-btn" style="display: none; padding: 8px 16px; background: #238636; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; font-weight: 500; align-items: center; gap: 6px;">
                                    <ion-icon name="copy-outline"></ion-icon>
                                    Copy Result
                                </button>
                            </div>
                            <div style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
                                <pre id="backdoor-output" style="flex: 1; background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 15px; color: #c9d1d9; font-family: 'Fira Code', monospace; font-size: 12px; white-space: pre-wrap; word-wrap: break-word; overflow-x: auto; overflow-y: auto; margin: 0; max-height: 100%;"></pre>
                                <div id="backdoor-result-text-container" style="display: none; margin-top: 15px; flex-direction: column; gap: 10px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <div style="font-size: 13px; color: #58a6ff; font-weight: 500;">Generated Payload:</div>
                                        <button id="backdoor-copy-text-btn" style="padding: 6px 12px; background: #238636; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 6px;">
                                            <ion-icon name="copy-outline"></ion-icon>
                                            Copy
                                        </button>
                                    </div>
                                    <textarea id="backdoor-result-text" readonly style="width: 100%; min-height: 150px; max-height: 300px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 15px; color: #c9d1d9; font-family: 'Fira Code', monospace; font-size: 12px; resize: vertical; overflow-y: auto; overflow-x: auto; white-space: pre; word-wrap: normal; box-sizing: border-box;"></textarea>
                                </div>
                            </div>
                        </div>
                        
                        <!-- No Module Selected -->
                        <div id="backdoor-no-module" style="flex: 1; display: flex; align-items: center; justify-content: center; color: #8b949e;">
                            <div style="text-align: center;">
                                <ion-icon name="key-outline" style="font-size: 64px; color: #30363d; margin-bottom: 16px;"></ion-icon>
                                <div style="font-size: 16px; margin-bottom: 8px;">No module selected</div>
                                <div style="font-size: 13px;">Select a backdoor or payload module to configure and generate</div>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const moduleTypeSelect = document.querySelector(`#${wId} #backdoor-module-type`);
                const moduleList = document.querySelector(`#${wId} #backdoor-module-list`);
                const moduleInfo = document.querySelector(`#${wId} #backdoor-module-info`);
                const optionsContainer = document.querySelector(`#${wId} #backdoor-options-container`);
                const noModule = document.querySelector(`#${wId} #backdoor-no-module`);
                const generateBtn = document.querySelector(`#${wId} #backdoor-generate-btn`);
                const outputContainer = document.querySelector(`#${wId} #backdoor-output-container`);
                const output = document.querySelector(`#${wId} #backdoor-output`);
                
                let selectedModule = null;
                let moduleOptions = {};
                
                const loadModules = async () => {
                    try {
                        const res = await fetch('/api/backdoor/modules');
                        const data = await res.json();
                        
                        if (data.error) {
                            moduleList.innerHTML = `<div style="color: #f85149; padding: 20px; text-align: center;">Error: ${data.error}</div>`;
                            return;
                        }
                        
                        displayModules(data);
                    } catch (err) {
                        moduleList.innerHTML = `<div style="color: #f85149; padding: 20px; text-align: center;">Error loading modules: ${err.message}</div>`;
                    }
                };
                
                const displayModules = (data) => {
                    const type = moduleTypeSelect.value;
                    const modules = type === 'backdoors' ? data.backdoors : data.payloads;
                    
                    if (!modules || modules.length === 0) {
                        moduleList.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 40px;">No modules found</div>';
                        return;
                    }
                    
                    let html = '';
                    modules.forEach(module => {
                        const parts = module.path.split('/');
                        const displayName = parts.slice(1).join(' / ');
                        html += `
                            <div class="backdoor-module-item" data-path="${module.path}" style="padding: 12px; border: 1px solid #30363d; border-radius: 6px; margin-bottom: 8px; cursor: pointer; transition: all 0.2s; background: rgba(255,255,255,0.02);">
                                <div style="font-weight: 500; color: #c9d1d9; margin-bottom: 4px;">${displayName}</div>
                                <div style="font-size: 11px; color: #8b949e;">${module.path}</div>
                            </div>
                        `;
                    });
                    
                    moduleList.innerHTML = html;
                    
                    // Add click handlers
                    document.querySelectorAll(`#${wId} .backdoor-module-item`).forEach(item => {
                        item.addEventListener('click', () => {
                            const path = item.getAttribute('data-path');
                            selectModule(path);
                            
                            // Update selected state
                            document.querySelectorAll(`#${wId} .backdoor-module-item`).forEach(i => {
                                i.style.background = 'rgba(255,255,255,0.02)';
                                i.style.borderColor = '#30363d';
                            });
                            item.style.background = 'rgba(88, 166, 255, 0.1)';
                            item.style.borderColor = '#58a6ff';
                        });
                    });
                };
                
                const selectModule = async (modulePath) => {
                    try {
                        const res = await fetch(`/api/modules/${encodeURIComponent(modulePath)}/load`);
                        const data = await res.json();
                        
                        if (data.error) {
                            alert(`Error loading module: ${data.error}`);
                            return;
                        }
                        
                        selectedModule = modulePath;
                        moduleOptions = {};
                        
                        // Display module info
                        document.querySelector(`#${wId} #backdoor-module-name`).textContent = data.name || modulePath.split('/').pop();
                        document.querySelector(`#${wId} #backdoor-module-description`).textContent = data.description || 'No description available';
                        document.querySelector(`#${wId} #backdoor-module-path`).textContent = `Path: ${modulePath}`;
                        
                        // Display options
                        const optionsForm = document.querySelector(`#${wId} #backdoor-options-form`);
                        optionsForm.innerHTML = '';
                        
                        if (data.options && Object.keys(data.options).length > 0) {
                            for (const [optName, optData] of Object.entries(data.options)) {
                                const optHtml = `
                                    <div>
                                        <label style="display: block; font-size: 13px; color: #c9d1d9; margin-bottom: 5px;">
                                            ${optData.name || optName}
                                            ${optData.required ? '<span style="color: #f85149;">*</span>' : ''}
                                        </label>
                                        <input 
                                            type="text" 
                                            id="backdoor-opt-${optName}" 
                                            data-option="${optName}"
                                            value="${optData.default || ''}" 
                                            placeholder="${optData.description || ''}"
                                            style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; box-sizing: border-box;"
                                        />
                                        ${optData.description ? `<div style="font-size: 11px; color: #8b949e; margin-top: 4px;">${optData.description}</div>` : ''}
                                    </div>
                                `;
                                optionsForm.innerHTML += optHtml;
                            }
                        } else {
                            optionsForm.innerHTML = '<div style="color: #8b949e; padding: 20px; text-align: center;">No options available for this module</div>';
                        }
                        
                        // Show panels
                        noModule.style.display = 'none';
                        moduleInfo.style.display = 'block';
                        optionsContainer.style.display = 'block';
                        outputContainer.style.display = 'none';
                    } catch (err) {
                        alert(`Error loading module: ${err.message}`);
                    }
                };
                
                const generateBackdoor = async () => {
                    if (!selectedModule) {
                        alert('Please select a module first');
                        return;
                    }
                    
                    // Collect options
                    const options = {};
                    document.querySelectorAll(`#${wId} [data-option]`).forEach(input => {
                        const optName = input.getAttribute('data-option');
                        options[optName] = input.value;
                    });
                    
                    // Show output container
                    outputContainer.style.display = 'flex';
                    output.textContent = 'Generating backdoor...\n';
                    
                    // Hide result text container initially
                    const resultTextContainer = document.querySelector(`#${wId} #backdoor-result-text-container`);
                    if (resultTextContainer) {
                        resultTextContainer.style.display = 'none';
                    }
                    const copyResultBtn = document.querySelector(`#${wId} #backdoor-copy-result-btn`);
                    if (copyResultBtn) {
                        copyResultBtn.style.display = 'none';
                    }
                    
                    generateBtn.disabled = true;
                    generateBtn.style.opacity = '0.5';
                    generateBtn.style.cursor = 'not-allowed';
                    
                    try {
                        const res = await fetch('/api/backdoor/generate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                module_path: selectedModule,
                                options: options
                            })
                        });
                        
                        const data = await res.json();
                        
                        if (data.success) {
                            let outputText = '=== Generation Successful ===\n\n';
                            if (data.output) outputText += data.output + '\n';
                            if (data.errors) outputText += 'Errors:\n' + data.errors + '\n';
                            
                            // Check if result is a text string
                            const resultText = data.result ? String(data.result) : null;
                            const isTextResult = resultText && resultText.length > 0 && !resultText.match(/^(True|False|None|\d+)$/);
                            
                            if (resultText) {
                                if (isTextResult) {
                                    // Show result in output
                                    outputText += '\nResult: ' + resultText;
                                    output.textContent = outputText;
                                    
                                    // Also show in dedicated text area for easy copying
                                    const resultTextContainer = document.querySelector(`#${wId} #backdoor-result-text-container`);
                                    const resultTextArea = document.querySelector(`#${wId} #backdoor-result-text`);
                                    const copyTextBtn = document.querySelector(`#${wId} #backdoor-copy-text-btn`);
                                    const copyResultBtn = document.querySelector(`#${wId} #backdoor-copy-result-btn`);
                                    
                                    if (resultTextContainer && resultTextArea) {
                                        resultTextContainer.style.display = 'flex';
                                        resultTextArea.value = resultText;
                                        copyResultBtn.style.display = 'flex';
                                        
                                        // Copy button handlers
                                        const copyToClipboard = (text) => {
                                            navigator.clipboard.writeText(text).then(() => {
                                                this.showNotification('Result copied to clipboard', 'success', 2000);
                                            }).catch(() => {
                                                // Fallback for older browsers
                                                resultTextArea.select();
                                                document.execCommand('copy');
                                                this.showNotification('Result copied to clipboard', 'success', 2000);
                                            });
                                        };
                                        
                                        if (copyTextBtn) {
                                            copyTextBtn.addEventListener('click', () => {
                                                copyToClipboard(resultText);
                                            });
                                        }
                                        
                                        if (copyResultBtn) {
                                            // Remove existing listeners
                                            const newCopyBtn = copyResultBtn.cloneNode(true);
                                            copyResultBtn.parentNode.replaceChild(newCopyBtn, copyResultBtn);
                                            newCopyBtn.addEventListener('click', () => {
                                                copyToClipboard(resultText);
                                            });
                                        }
                                    }
                                } else {
                                    // Simple result (True/False/None/number)
                                    outputText += '\nResult: ' + resultText;
                                    output.textContent = outputText;
                                    document.querySelector(`#${wId} #backdoor-result-text-container`).style.display = 'none';
                                    document.querySelector(`#${wId} #backdoor-copy-result-btn`).style.display = 'none';
                                }
                            } else {
                                output.textContent = outputText;
                                document.querySelector(`#${wId} #backdoor-result-text-container`).style.display = 'none';
                                document.querySelector(`#${wId} #backdoor-copy-result-btn`).style.display = 'none';
                            }
                            
                            output.style.color = '#c9d1d9';
                        } else {
                            let errorText = '=== Generation Failed ===\n\n';
                            if (data.error) errorText += data.error + '\n';
                            if (data.output) errorText += '\nOutput:\n' + data.output;
                            if (data.errors) errorText += '\nErrors:\n' + data.errors;
                            output.textContent = errorText;
                            output.style.color = '#f85149';
                            document.querySelector(`#${wId} #backdoor-result-text-container`).style.display = 'none';
                            document.querySelector(`#${wId} #backdoor-copy-result-btn`).style.display = 'none';
                        }
                    } catch (err) {
                        output.textContent = `Error: ${err.message}`;
                        output.style.color = '#f85149';
                    } finally {
                        generateBtn.disabled = false;
                        generateBtn.style.opacity = '1';
                        generateBtn.style.cursor = 'pointer';
                    }
                };
                
                moduleTypeSelect.addEventListener('change', loadModules);
                generateBtn.addEventListener('click', generateBackdoor);
                
                // Initial load
                loadModules();
            }
        });
    }

    spawnWebDelivery() {
        const winId = this.wm.createWindow({
            title: 'Web Delivery',
            icon: 'cloud-download-outline',
            width: '900px',
            height: '700px',
            top: '50px',
            left: '100px',
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif;">
                    <!-- Configuration Section -->
                    <div style="padding: 20px; border-bottom: 1px solid #30363d; background: #161b22;">
                        <h3 style="margin: 0 0 20px 0; font-size: 18px; color: #58a6ff;">Server Configuration</h3>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                            <div>
                                <label style="display: block; font-size: 13px; color: #c9d1d9; margin-bottom: 5px;">Host</label>
                                <input type="text" id="web-delivery-host" value="0.0.0.0" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; box-sizing: border-box;">
                            </div>
                            <div>
                                <label style="display: block; font-size: 13px; color: #c9d1d9; margin-bottom: 5px;">Port</label>
                                <input type="number" id="web-delivery-port" value="8080" min="1" max="65535" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; box-sizing: border-box;">
                            </div>
                        </div>
                        <div>
                            <label style="display: block; font-size: 13px; color: #c9d1d9; margin-bottom: 5px;">File from output/</label>
                            <div style="display: flex; gap: 10px;">
                                <input type="text" id="web-delivery-file" placeholder="e.g., payload.exe" style="flex: 1; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; box-sizing: border-box;">
                                <button id="web-delivery-browse-btn" style="padding: 10px 20px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; cursor: pointer; font-size: 13px;">
                                    Browse
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Server Status & Controls -->
                    <div style="padding: 20px; border-bottom: 1px solid #30363d; background: #161b22;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <div>
                                <div style="font-size: 12px; color: #8b949e; margin-bottom: 5px;">Server Status</div>
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <div id="web-delivery-status-indicator" style="width: 10px; height: 10px; border-radius: 50%; background: #666;"></div>
                                    <span id="web-delivery-status-text" style="color: #8b949e; font-size: 14px;">Stopped</span>
                                </div>
                            </div>
                            <div style="display: flex; gap: 10px;">
                                <button id="web-delivery-start-btn" style="padding: 10px 20px; background: #238636; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; font-weight: 500;">
                                    Start Server
                                </button>
                                <button id="web-delivery-stop-btn" style="padding: 10px 20px; background: #f85149; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; font-weight: 500; display: none;">
                                    Stop Server
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- URL Display -->
                    <div id="web-delivery-url-container" style="display: none; padding: 20px; border-bottom: 1px solid #30363d; background: #161b22;">
                        <div style="font-size: 12px; color: #8b949e; margin-bottom: 8px;">Download URL</div>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <input type="text" id="web-delivery-url" readonly style="flex: 1; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #58a6ff; font-size: 14px; font-family: 'Fira Code', monospace; outline: none; box-sizing: border-box;">
                            <button id="web-delivery-copy-btn" style="padding: 10px 20px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; cursor: pointer; font-size: 13px;">
                                Copy
                            </button>
                        </div>
                    </div>
                    
                    <!-- File Browser Modal -->
                    <div id="web-delivery-file-browser" style="display: none; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 10000; align-items: center; justify-content: center;">
                        <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; width: 600px; max-height: 80%; display: flex; flex-direction: column;">
                            <div style="padding: 15px; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center;">
                                <h3 style="margin: 0; font-size: 16px; color: #58a6ff;">Select File from output/</h3>
                                <button id="web-delivery-close-browser" style="background: transparent; border: none; color: #8b949e; cursor: pointer; font-size: 20px;">×</button>
                            </div>
                            <div id="web-delivery-file-list" style="flex: 1; overflow-y: auto; padding: 15px;">
                                <div style="text-align: center; color: #8b949e; padding: 20px;">Loading files...</div>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const hostInput = document.querySelector(`#${wId} #web-delivery-host`);
                const portInput = document.querySelector(`#${wId} #web-delivery-port`);
                const fileInput = document.querySelector(`#${wId} #web-delivery-file`);
                const browseBtn = document.querySelector(`#${wId} #web-delivery-browse-btn`);
                const startBtn = document.querySelector(`#${wId} #web-delivery-start-btn`);
                const stopBtn = document.querySelector(`#${wId} #web-delivery-stop-btn`);
                const statusIndicator = document.querySelector(`#${wId} #web-delivery-status-indicator`);
                const statusText = document.querySelector(`#${wId} #web-delivery-status-text`);
                const urlContainer = document.querySelector(`#${wId} #web-delivery-url-container`);
                const urlInput = document.querySelector(`#${wId} #web-delivery-url`);
                const copyBtn = document.querySelector(`#${wId} #web-delivery-copy-btn`);
                const fileBrowser = document.querySelector(`#${wId} #web-delivery-file-browser`);
                const fileList = document.querySelector(`#${wId} #web-delivery-file-list`);
                const closeBrowser = document.querySelector(`#${wId} #web-delivery-close-browser`);
                
                const updateStatus = async () => {
                    try {
                        const res = await fetch('/api/web-delivery/status');
                        const data = await res.json();
                        
                        if (data.running) {
                            statusIndicator.style.background = '#3fb950';
                            statusText.textContent = 'Running';
                            statusText.style.color = '#3fb950';
                            startBtn.style.display = 'none';
                            stopBtn.style.display = 'block';
                            urlContainer.style.display = 'block';
                            urlInput.value = data.url || '';
                        } else {
                            statusIndicator.style.background = '#666';
                            statusText.textContent = 'Stopped';
                            statusText.style.color = '#8b949e';
                            startBtn.style.display = 'block';
                            stopBtn.style.display = 'none';
                            urlContainer.style.display = 'none';
                        }
                    } catch (err) {
                        console.error('Error checking status:', err);
                    }
                };
                
                const loadFiles = async () => {
                    try {
                        const res = await fetch('/api/output/list');
                        const data = await res.json();
                        
                        if (data.error) {
                            fileList.innerHTML = `<div style="color: #f85149; padding: 20px; text-align: center;">Error: ${data.error}</div>`;
                            return;
                        }
                        
                        let html = '';
                        
                        // Files only (not directories)
                        if (data.files && data.files.length > 0) {
                            data.files.forEach(file => {
                                html += `
                                    <div class="web-delivery-file-item" data-path="${file.path}" style="padding: 12px; border: 1px solid #30363d; border-radius: 6px; margin-bottom: 8px; cursor: pointer; transition: all 0.2s; background: rgba(255,255,255,0.02);">
                                        <div style="display: flex; align-items: center; gap: 10px;">
                                            <ion-icon name="document-outline" style="font-size: 20px; color: #8b949e;"></ion-icon>
                                            <div style="flex: 1;">
                                                <div style="font-weight: 500; color: #c9d1d9;">${file.name}</div>
                                                <div style="font-size: 11px; color: #8b949e; margin-top: 2px;">${file.path}</div>
                                            </div>
                                        </div>
                                    </div>
                                `;
                            });
                        } else {
                            html = '<div style="text-align: center; color: #8b949e; padding: 40px;">No files found in output/</div>';
                        }
                        
                        fileList.innerHTML = html;
                        
                        // Add click handlers
                        document.querySelectorAll(`#${wId} .web-delivery-file-item`).forEach(item => {
                            item.addEventListener('click', () => {
                                const path = item.getAttribute('data-path');
                                fileInput.value = path;
                                fileBrowser.style.display = 'none';
                            });
                            
                            item.addEventListener('mouseenter', () => {
                                item.style.background = 'rgba(88, 166, 255, 0.1)';
                                item.style.borderColor = '#58a6ff';
                            });
                            
                            item.addEventListener('mouseleave', () => {
                                item.style.background = 'rgba(255,255,255,0.02)';
                                item.style.borderColor = '#30363d';
                            });
                        });
                    } catch (err) {
                        fileList.innerHTML = `<div style="color: #f85149; padding: 20px; text-align: center;">Error loading files: ${err.message}</div>`;
                    }
                };
                
                const startServer = async () => {
                    const host = hostInput.value.trim() || '0.0.0.0';
                    const port = parseInt(portInput.value) || 8080;
                    const filePath = fileInput.value.trim();
                    
                    if (!filePath) {
                        alert('Please select a file');
                        return;
                    }
                    
                    if (port < 1 || port > 65535) {
                        alert('Port must be between 1 and 65535');
                        return;
                    }
                    
                    startBtn.disabled = true;
                    startBtn.textContent = 'Starting...';
                    
                    try {
                        const res = await fetch('/api/web-delivery/start', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                host: host,
                                port: port,
                                file_path: filePath
                            })
                        });
                        
                        const data = await res.json();
                        
                        if (data.success) {
                            this.showNotification('Web Delivery server started', 'success', 3000);
                            updateStatus();
                        } else {
                            alert(`Error starting server: ${data.error || 'Unknown error'}`);
                        }
                    } catch (err) {
                        alert(`Error starting server: ${err.message}`);
                    } finally {
                        startBtn.disabled = false;
                        startBtn.textContent = 'Start Server';
                    }
                };
                
                const stopServer = async () => {
                    stopBtn.disabled = true;
                    stopBtn.textContent = 'Stopping...';
                    
                    try {
                        const res = await fetch('/api/web-delivery/stop', {
                            method: 'POST'
                        });
                        
                        const data = await res.json();
                        
                        if (data.success) {
                            this.showNotification('Web Delivery server stopped', 'success', 3000);
                            updateStatus();
                        } else {
                            alert(`Error stopping server: ${data.error || 'Unknown error'}`);
                        }
                    } catch (err) {
                        alert(`Error stopping server: ${err.message}`);
                    } finally {
                        stopBtn.disabled = false;
                        stopBtn.textContent = 'Stop Server';
                    }
                };
                
                browseBtn.addEventListener('click', () => {
                    fileBrowser.style.display = 'flex';
                    loadFiles();
                });
                
                closeBrowser.addEventListener('click', () => {
                    fileBrowser.style.display = 'none';
                });
                
                startBtn.addEventListener('click', startServer);
                stopBtn.addEventListener('click', stopServer);
                
                copyBtn.addEventListener('click', () => {
                    urlInput.select();
                    document.execCommand('copy');
                    this.showNotification('URL copied to clipboard', 'success', 2000);
                });
                
                // Initial status check
                updateStatus();
                // Update status every 2 seconds
                setInterval(updateStatus, 2000);
            }
        });
    }

    spawnVNCClient() {
        const winId = this.wm.createWindow({
            title: 'VNC Client',
            icon: 'desktop-outline',
            width: '1000px',
            height: '700px',
            headerButtons: `
                <button id="vnc-disconnect-btn" class="header-action-btn" title="Disconnect" style="display: none;">
                    <ion-icon name="stop-outline"></ion-icon>
                </button>
                <button id="vnc-panel-toggle-btn" class="header-action-btn" title="Hide connection panel">
                    <ion-icon name="chevron-up-outline"></ion-icon>
                </button>
            `,
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #0d1117;">
                    <!-- Connection Panel -->
                    <div id="vnc-connection-panel" style="padding: 20px; border-bottom: 1px solid #30363d; background: #161b22;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 12px; align-items: end;">
                            <div>
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px;">Host</label>
                                <input type="text" id="vnc-host" value="127.0.0.1" placeholder="VNC Server Host" style="width: 100%; padding: 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; box-sizing: border-box;">
                            </div>
                            <div>
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px;">Port</label>
                                <input type="number" id="vnc-port" value="5900" placeholder="5900" style="width: 100%; padding: 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; box-sizing: border-box;">
                            </div>
                            <div>
                                <label style="display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px;">Password (optional)</label>
                                <input type="password" id="vnc-password" placeholder="VNC Password" style="width: 100%; padding: 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; box-sizing: border-box;">
                            </div>
                            <button id="vnc-connect-button" style="padding: 8px 16px; background: #238636; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; font-weight: 500; height: 36px;">
                                Connect
                            </button>
                        </div>
                        <div id="vnc-status" style="margin-top: 12px; font-size: 12px; color: #8b949e;"></div>
                    </div>

                    <!-- VNC Canvas Container -->
                    <div id="vnc-canvas-container" style="flex: 1; position: relative; background: #000; overflow: auto; display: flex; align-items: center; justify-content: center; padding: 16px;">
                        <div id="vnc-screen" style="background: #000; position: relative; margin: 0 auto;">
                            <canvas id="vnc-canvas" style="display: block; max-width: 100%; height: auto; image-rendering: pixelated;"></canvas>
                        </div>
                        <div id="vnc-placeholder" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #8b949e; padding: 40px; text-align: center;">
                            <ion-icon name="desktop-outline" style="font-size: 64px; opacity: 0.3; margin-bottom: 16px;"></ion-icon>
                            <div style="font-size: 16px; margin-bottom: 8px;">VNC Remote Desktop</div>
                            <div style="font-size: 12px;">Enter connection details above and click Connect</div>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const hostInput = document.querySelector(`#${wId} #vnc-host`);
                const portInput = document.querySelector(`#${wId} #vnc-port`);
                const passwordInput = document.querySelector(`#${wId} #vnc-password`);
                const connectBtn = document.querySelector(`#${wId} #vnc-connect-button`);
                const disconnectHeaderBtn = document.querySelector(`#${wId} #vnc-disconnect-btn`);
                const panelToggleBtn = document.querySelector(`#${wId} #vnc-panel-toggle-btn`);
                const statusDiv = document.querySelector(`#${wId} #vnc-status`);
                const canvas = document.querySelector(`#${wId} #vnc-canvas`);
                const placeholder = document.querySelector(`#${wId} #vnc-placeholder`);
                const canvasContainer = document.querySelector(`#${wId} #vnc-canvas-container`);
                const connectionPanel = document.querySelector(`#${wId} #vnc-connection-panel`);
                let isConnected = false;

                let connectionId = null;
                let vncSocket = null;
                let vncAdapter = null;
                let vncScreenWidth = 0;
                let vncScreenHeight = 0;
                let vncPixelFormat = null;
                let pendingFramebufferRequest = false;
                let pendingFramebufferRequestSince = 0;
                let lastFramebufferAt = 0;
                let vncRefreshTimer = null;
                const VNC_REFRESH_INTERVAL_MS = 100; // ~10 FPS
                const VNC_PENDING_TIMEOUT_MS = 1200; // failsafe if we never get a FramebufferUpdate
                let vncDataBuffer = new Uint8Array(0);

                // Allow hiding/showing the connection panel to maximize usable canvas space
                let panelHidden = false;
                if (panelToggleBtn && connectionPanel) {
                    panelToggleBtn.addEventListener('click', () => {
                        panelHidden = !panelHidden;
                        connectionPanel.style.display = panelHidden ? 'none' : 'block';
                        const icon = panelToggleBtn.querySelector('ion-icon');
                        if (icon) {
                            icon.setAttribute('name', panelHidden ? 'chevron-down-outline' : 'chevron-up-outline');
                        }
                        panelToggleBtn.setAttribute('title', panelHidden ? 'Show connection panel' : 'Hide connection panel');
                    });
                }
                
                // VNC Protocol Handler
                class VNCProtocol {
                    constructor(canvas, adapter) {
                        this.canvas = canvas;
                        this.ctx = canvas.getContext('2d');
                        this.adapter = adapter;
                        this.screenWidth = 0;
                        this.screenHeight = 0;
                        this.pixelFormat = {
                            bitsPerPixel: 32,
                            depth: 24,
                            bigEndian: false,
                            trueColor: true,
                            redMax: 255,
                            greenMax: 255,
                            blueMax: 255,
                            redShift: 16,
                            greenShift: 8,
                            blueShift: 0
                        };
                        this.imageData = null;
                    }
                    
                    handleMessage(data) {
                        if (data.length === 0) return 0;
                        
                        const msgType = data[0];
                        
                        // RFB 3.8 server->client message types:
                        // 0 = FramebufferUpdate
                        // 1 = SetColorMapEntries
                        // 2 = Bell
                        // 3 = ServerCutText
                        if (msgType === 0) { // FramebufferUpdate
                            return this.handleFramebufferUpdate(data);
                        } else if (msgType === 1) { // SetColorMapEntries
                            return this.handleSetColorMapEntries(data);
                        } else if (msgType === 2) { // Bell
                            // Single-byte message
                            return 1;
                        } else if (msgType === 3) { // ServerCutText (clipboard)
                            if (data.length < 8) return 0;
                            const textLen = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
                            if (data.length < 8 + textLen) return 0;
                            return 8 + textLen;
                        }
                        
                        return 0; // Unknown message type
                    }
                    
                    handleSetColorMapEntries(data) {
                        // Format:
                        // type(1) + pad(1) + firstColor(2) + numColors(2) + colors(6*numColors)
                        if (data.length < 6) return 0;
                        const numColors = (data[4] << 8) | data[5];
                        const total = 6 + numColors * 6;
                        if (data.length < total) return 0;
                        // We don't use colormap (we rely on TrueColor), so just consume it.
                        return total;
                    }
                    
                    handleFramebufferUpdate(data) {
                        if (data.length < 4) return 0;
                        
                        const numRects = (data[2] << 8) | data[3];
                        let offset = 4;
                        let totalProcessed = 0;
                        
                        for (let i = 0; i < numRects; i++) {
                            if (offset + 12 > data.length) {
                                // Need more data
                                return totalProcessed;
                            }
                            
                            const x = (data[offset] << 8) | data[offset + 1];
                            const y = (data[offset + 2] << 8) | data[offset + 3];
                            const w = (data[offset + 4] << 8) | data[offset + 5];
                            const h = (data[offset + 6] << 8) | data[offset + 7];
                            const encoding = (data[offset + 8] << 24) | (data[offset + 9] << 16) | (data[offset + 10] << 8) | data[offset + 11];
                            offset += 12;
                            
                            if (encoding === 0) { // Raw encoding
                                const pixelSize = this.pixelFormat.bitsPerPixel / 8;
                                const rectSize = w * h * pixelSize;
                                
                                if (offset + rectSize > data.length) {
                                    // Need more data for this rectangle
                                    return totalProcessed;
                                }
                                
                                this.decodeRawRectangle(data, offset, x, y, w, h);
                                offset += rectSize;
                                totalProcessed = offset;
                            } else {
                                console.log(`Unsupported encoding: ${encoding}, skipping rectangle`);
                                // For unsupported encodings, we can't process this message
                                return 0;
                            }
                        }
                        
                        return offset; // Return bytes processed
                    }
                    
                    decodeRawRectangle(data, offset, x, y, w, h) {
                        if (!this.imageData || this.imageData.width !== this.screenWidth || this.imageData.height !== this.screenHeight) {
                            this.canvas.width = this.screenWidth;
                            this.canvas.height = this.screenHeight;
                            this.imageData = this.ctx.createImageData(this.screenWidth, this.screenHeight);
                        }
                        
                        const pixelSize = this.pixelFormat.bitsPerPixel / 8;
                        const pixels = this.imageData.data;
                        
                        // Check if we have enough data
                        const requiredSize = w * h * pixelSize;
                        if (offset + requiredSize > data.length) {
                            console.warn(`Incomplete rectangle data: need ${requiredSize} bytes, have ${data.length - offset}`);
                            return;
                        }
                        
                        for (let py = 0; py < h; py++) {
                            for (let px = 0; px < w; px++) {
                                const srcIdx = offset + (py * w + px) * pixelSize;
                                
                                let r, g, b;
                                
                                if (this.pixelFormat.bitsPerPixel === 32) {
                                    // 32-bit pixel: typically BGRA or RGBA
                                    if (this.pixelFormat.trueColor && this.pixelFormat.redShift > 0) {
                                        // TrueColor with shifts - decode using bit shifts
                                        let pixel;
                                        if (this.pixelFormat.bigEndian) {
                                            pixel = (data[srcIdx] << 24) | (data[srcIdx + 1] << 16) | (data[srcIdx + 2] << 8) | data[srcIdx + 3];
                                        } else {
                                            pixel = data[srcIdx] | (data[srcIdx + 1] << 8) | (data[srcIdx + 2] << 16) | (data[srcIdx + 3] << 24);
                                        }
                                        r = ((pixel >> this.pixelFormat.redShift) & this.pixelFormat.redMax) * 255 / this.pixelFormat.redMax;
                                        g = ((pixel >> this.pixelFormat.greenShift) & this.pixelFormat.greenMax) * 255 / this.pixelFormat.greenMax;
                                        b = ((pixel >> this.pixelFormat.blueShift) & this.pixelFormat.blueMax) * 255 / this.pixelFormat.blueMax;
                                    } else {
                                        // Direct BGRA format (most common VNC format)
                                        // Byte order: B, G, R, A (little-endian)
                                        b = data[srcIdx];
                                        g = data[srcIdx + 1];
                                        r = data[srcIdx + 2];
                                        // data[srcIdx + 3] is alpha, ignore it
                                    }
                                } else if (this.pixelFormat.bitsPerPixel === 16) {
                                    // 16-bit pixel
                                    let pixel;
                                    if (this.pixelFormat.bigEndian) {
                                        pixel = (data[srcIdx] << 8) | data[srcIdx + 1];
                                    } else {
                                        pixel = data[srcIdx] | (data[srcIdx + 1] << 8);
                                    }
                                    r = ((pixel >> this.pixelFormat.redShift) & this.pixelFormat.redMax) * 255 / this.pixelFormat.redMax;
                                    g = ((pixel >> this.pixelFormat.greenShift) & this.pixelFormat.greenMax) * 255 / this.pixelFormat.greenMax;
                                    b = ((pixel >> this.pixelFormat.blueShift) & this.pixelFormat.blueMax) * 255 / this.pixelFormat.blueMax;
                                } else if (this.pixelFormat.bitsPerPixel === 8) {
                                    // 8-bit indexed color (not supported, skip)
                                    continue;
                                } else {
                                    // Unsupported
                                    continue;
                                }
                                
                                const dstX = x + px;
                                const dstY = y + py;
                                
                                if (dstX >= 0 && dstX < this.screenWidth && dstY >= 0 && dstY < this.screenHeight) {
                                    const dstIdx = (dstY * this.screenWidth + dstX) * 4;
                                    pixels[dstIdx] = Math.min(255, Math.max(0, r));
                                    pixels[dstIdx + 1] = Math.min(255, Math.max(0, g));
                                    pixels[dstIdx + 2] = Math.min(255, Math.max(0, b));
                                    pixels[dstIdx + 3] = 255; // Alpha
                                }
                            }
                        }
                        
                        this.ctx.putImageData(this.imageData, 0, 0);
                    }
                    
                    setScreenSize(width, height) {
                        this.screenWidth = width;
                        this.screenHeight = height;
                        this.canvas.width = width;
                        this.canvas.height = height;
                        this.imageData = this.ctx.createImageData(width, height);
                        // Fill with black
                        const pixels = this.imageData.data;
                        for (let i = 0; i < pixels.length; i += 4) {
                            pixels[i] = 0;     // R
                            pixels[i + 1] = 0;  // G
                            pixels[i + 2] = 0;  // B
                            pixels[i + 3] = 255; // A
                        }
                        this.ctx.putImageData(this.imageData, 0, 0);
                    }
                    
                    requestUpdate(incremental = true) {
                        const request = new Uint8Array(10);
                        request[0] = 3; // FramebufferUpdateRequest
                        request[1] = incremental ? 1 : 0;
                        request[2] = 0; request[3] = 0; // x
                        request[4] = 0; request[5] = 0; // y
                        request[6] = (this.screenWidth >> 8) & 0xFF;
                        request[7] = this.screenWidth & 0xFF;
                        request[8] = (this.screenHeight >> 8) & 0xFF;
                        request[9] = this.screenHeight & 0xFF;
                        this.adapter.send(request.buffer);
                    }

                    setEncodings(encodings = [0]) {
                        if (!Array.isArray(encodings) || encodings.length === 0) {
                            return;
                        }

                        const msg = new Uint8Array(4 + encodings.length * 4);
                        msg[0] = 2; // SetEncodings
                        msg[1] = 0; // padding
                        msg[2] = (encodings.length >> 8) & 0xFF;
                        msg[3] = encodings.length & 0xFF;

                        encodings.forEach((encoding, idx) => {
                            const base = 4 + idx * 4;
                            const value = encoding >>> 0; // ensure unsigned
                            msg[base] = (value >>> 24) & 0xFF;
                            msg[base + 1] = (value >>> 16) & 0xFF;
                            msg[base + 2] = (value >>> 8) & 0xFF;
                            msg[base + 3] = value & 0xFF;
                        });

                        this.adapter.send(msg.buffer);
                    }
                }
                
                // Custom WebSocket-like adapter using Socket.IO
                class VNCWebSocketAdapter {
                    constructor() {
                        this.readyState = WebSocket.CONNECTING;
                        this.binaryType = 'arraybuffer';
                        this.onopen = null;
                        this.onclose = null;
                        this.onerror = null;
                        this.onmessage = null;
                        this.dataBuffer = new Uint8Array(0);
                    }
                    
                    connect(host, port, password) {
                        connectionId = 'vnc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                        vncSocket = this.socket;
                        
                        // Request connection via Socket.IO
                        this.socket.emit('vnc_connect', {
                            connection_id: connectionId,
                            host: host,
                            port: port,
                            password: password || ''
                        });
                        
                        // Listen for connection events
                        const onConnected = (data) => {
                            if (data.connection_id === connectionId) {
                                this.readyState = WebSocket.OPEN;
                                if (this.onopen) this.onopen({ target: this });
                                this.socket.off('vnc_connected', onConnected);
                            }
                        };
                        
                        const onData = (data) => {
                            if (data.connection_id === connectionId && this.onmessage) {
                                try {
                                    const binaryString = atob(data.data);
                                    const bytes = new Uint8Array(binaryString.length);
                                    for (let i = 0; i < binaryString.length; i++) {
                                        bytes[i] = binaryString.charCodeAt(i);
                                    }
                                    this.onmessage({ data: bytes.buffer, target: this });
                                } catch (e) {
                                    console.error('VNC data decode error:', e);
                                }
                            }
                        };
                        
                        const onDisconnected = (data) => {
                            if (data.connection_id === connectionId) {
                                this.readyState = WebSocket.CLOSED;
                                if (this.onclose) this.onclose({ code: 1000, target: this });
                                this.socket.off('vnc_disconnected', onDisconnected);
                                this.socket.off('vnc_data', onData);
                            }
                        };
                        
                        const onError = (data) => {
                            if (data.connection_id === connectionId) {
                                this.readyState = WebSocket.CLOSED;
                                if (this.onerror) this.onerror({ error: data.error, target: this });
                                this.socket.off('vnc_error', onError);
                            }
                        };
                        
                        this.socket.on('vnc_connected', onConnected);
                        this.socket.on('vnc_data', onData);
                        this.socket.on('vnc_disconnected', onDisconnected);
                        this.socket.on('vnc_error', onError);
                    }
                    
                    send(data) {
                        if (this.readyState === WebSocket.OPEN && vncSocket && connectionId) {
                            try {
                                const bytes = new Uint8Array(data);
                                let binary = '';
                                for (let i = 0; i < bytes.length; i++) {
                                    binary += String.fromCharCode(bytes[i]);
                                }
                                const base64 = btoa(binary);
                                vncSocket.emit('vnc_send', {
                                    connection_id: connectionId,
                                    data: base64
                                });
                            } catch (e) {
                                console.error('VNC send error:', e);
                            }
                        }
                    }
                    
                    close() {
                        if (vncSocket && connectionId) {
                            vncSocket.emit('vnc_disconnect', { connection_id: connectionId });
                        }
                        this.readyState = WebSocket.CLOSED;
                        if (this.onclose) this.onclose({ code: 1000, target: this });
                    }
                }
                
                const connect = () => {
                    if (isConnected) {
                        return;
                    }
                    const host = hostInput.value.trim();
                    const port = parseInt(portInput.value) || 5900;
                    const password = passwordInput.value;
                    
                    if (!host) {
                        statusDiv.textContent = 'Error: Host is required';
                        statusDiv.style.color = '#f85149';
                        return;
                    }
                    
                    if (port < 1 || port > 65535) {
                        statusDiv.textContent = 'Error: Port must be between 1 and 65535';
                        statusDiv.style.color = '#f85149';
                        return;
                    }
                    
                    connectBtn.disabled = true;
                    connectBtn.textContent = 'Connecting...';
                    statusDiv.textContent = `Connecting to ${host}:${port}...`;
                    statusDiv.style.color = '#8b949e';
                    hostInput.disabled = true;
                    portInput.disabled = true;
                    passwordInput.disabled = true;

                    try {
                        // Create WebSocket adapter
                        vncAdapter = new VNCWebSocketAdapter();
                        vncAdapter.socket = this.socket;

                        // Create VNC protocol handler
                        const vncProtocol = new VNCProtocol(canvas, vncAdapter);

                        const requestFramebuffer = (incremental = true) => {
                            if (pendingFramebufferRequest) {
                                return;
                            }
                            if (vncAdapter && vncAdapter.readyState === WebSocket.OPEN) {
                                pendingFramebufferRequest = true;
                                pendingFramebufferRequestSince = Date.now();
                                vncProtocol.requestUpdate(incremental);
                            }
                        };

                        // Handle connection
                        vncAdapter.onopen = () => {
                            isConnected = true;
                            placeholder.style.display = 'none';
                            canvas.style.display = 'block';
                            connectBtn.disabled = false;
                            connectBtn.textContent = 'Disconnect';
                            connectBtn.style.background = '#da3633'; // Red color
                            disconnectHeaderBtn.style.display = 'block';
                            statusDiv.textContent = `Connected to ${host}:${port} - Waiting for screen size...`;
                            statusDiv.style.color = '#8b949e';
                            
                            // After connection, we'll receive ServerInit with screen dimensions
                            // For now, set a default size and request update
                            vncProtocol.setScreenSize(1024, 768); // Default, will be updated by ServerInit
                        };
                        
                        // Buffer for incomplete messages
                        let messageBuffer = new Uint8Array(0);
                        
                        // Handle incoming VNC messages
                        vncAdapter.onmessage = (event) => {
                            const newData = new Uint8Array(event.data);
                            
                            // Append to buffer
                            const combined = new Uint8Array(messageBuffer.length + newData.length);
                            combined.set(messageBuffer);
                            combined.set(newData, messageBuffer.length);
                            messageBuffer = combined;
                            
                            // Check if this is ServerInit (first message after connection)
                            if (vncScreenWidth === 0 && messageBuffer.length >= 24) {
                                // ServerInit format: width (2), height (2), pixel format (16), name length (4), name (variable)
                                // Width and height are big-endian (MSB first)
                                vncScreenWidth = (messageBuffer[0] << 8) | messageBuffer[1];
                                vncScreenHeight = (messageBuffer[2] << 8) | messageBuffer[3];
                                
                                console.log(`[VNC] ServerInit received: ${vncScreenWidth}x${vncScreenHeight}, buffer length: ${messageBuffer.length}`);
                                console.log(`[VNC] First 20 bytes (hex):`, Array.from(messageBuffer.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
                                
                                // Read name length to know total ServerInit size
                                const nameLenOffset = 4 + 16; // width(2) + height(2) + pixel_format(16)
                                if (messageBuffer.length >= nameLenOffset + 4) {
                                    // Name length is big-endian 32-bit
                                    const nameLen = (messageBuffer[nameLenOffset] << 24) | 
                                                   (messageBuffer[nameLenOffset + 1] << 16) | 
                                                   (messageBuffer[nameLenOffset + 2] << 8) | 
                                                   messageBuffer[nameLenOffset + 3];
                                    
                                    const totalServerInitSize = nameLenOffset + 4 + nameLen;
                                    console.log(`[VNC] Name length: ${nameLen}, total ServerInit size: ${totalServerInitSize}`);
                                    
                                    if (messageBuffer.length >= totalServerInitSize) {
                                        if (vncScreenWidth === 0 || vncScreenHeight === 0) {
                                            console.error(`[VNC] Invalid screen dimensions: ${vncScreenWidth}x${vncScreenHeight}`);
                                            console.error(`[VNC] First 50 bytes:`, Array.from(messageBuffer.slice(0, 50)).map(b => b.toString(16).padStart(2, '0')).join(' '));
                                        }
                                        
                                        if (vncScreenWidth > 0 && vncScreenHeight > 0) {
                                            // We have complete ServerInit
                                            vncProtocol.setScreenSize(vncScreenWidth, vncScreenHeight);
                                            statusDiv.textContent = `Connected to ${host}:${port} (${vncScreenWidth}x${vncScreenHeight})`;
                                            statusDiv.style.color = '#3fb950';
                                            
                                            // Set pixel format (offset 4-19)
                                            vncProtocol.pixelFormat = {
                                                bitsPerPixel: messageBuffer[4],
                                                depth: messageBuffer[5],
                                                bigEndian: messageBuffer[6] !== 0,
                                                trueColor: messageBuffer[7] !== 0,
                                                redMax: (messageBuffer[8] << 8) | messageBuffer[9],
                                                greenMax: (messageBuffer[10] << 8) | messageBuffer[11],
                                                blueMax: (messageBuffer[12] << 8) | messageBuffer[13],
                                                redShift: messageBuffer[14],
                                                greenShift: messageBuffer[15],
                                                blueShift: messageBuffer[16]
                                            };
                                            
                                            // Remove ServerInit from buffer
                                            messageBuffer = messageBuffer.slice(totalServerInitSize);

                                            // Request only encodings we support (RAW)
                                            vncProtocol.setEncodings([0]);

                                            pendingFramebufferRequest = false;
                                            pendingFramebufferRequestSince = 0;
                                            lastFramebufferAt = Date.now();
                                            requestFramebuffer(false);
                                        }
                                    }
                                }
                            }
                            
                            // Process remaining messages in buffer
                            while (messageBuffer.length > 0) {
                                if (messageBuffer.length < 1) break;

                                const msgType = messageBuffer[0];

                                // Try to process one complete server message.
                                const processed = vncProtocol.handleMessage(messageBuffer);
                                if (processed > 0) {
                                    messageBuffer = messageBuffer.slice(processed);

                                    // Only a FramebufferUpdate should unblock the "pending" gate.
                                    if (msgType === 0) {
                                        pendingFramebufferRequest = false;
                                        pendingFramebufferRequestSince = 0;
                                        lastFramebufferAt = Date.now();
                                        requestFramebuffer(true);
                                    }
                                } else {
                                    // Need more data to parse a complete message.
                                    break;
                                }
                            }
                        };

                        const computePointerPosition = (e) => {
                            if (vncScreenWidth === 0 || vncScreenHeight === 0) {
                                return null;
                            }
                            const rect = canvas.getBoundingClientRect();
                            const rectWidth = rect.width || 1;
                            const rectHeight = rect.height || 1;
                            const relativeX = (e.clientX - rect.left) / rectWidth;
                            const relativeY = (e.clientY - rect.top) / rectHeight;
                            const x = Math.max(0, Math.min(vncScreenWidth - 1, Math.floor(relativeX * vncScreenWidth)));
                            const y = Math.max(0, Math.min(vncScreenHeight - 1, Math.floor(relativeY * vncScreenHeight)));
                            return { x, y };
                        };

                        // Handle mouse events
                        canvas.addEventListener('mousedown', (e) => {
                            if (vncAdapter.readyState === WebSocket.OPEN) {
                                const coords = computePointerPosition(e);
                                if (!coords) return;
                                const button = e.button === 0 ? 1 : (e.button === 2 ? 4 : 2); // Left=1, Middle=2, Right=4

                                const msg = new Uint8Array(6);
                                msg[0] = 5; // PointerEvent
                                msg[1] = button;
                                msg[2] = (coords.x >> 8) & 0xFF;
                                msg[3] = coords.x & 0xFF;
                                msg[4] = (coords.y >> 8) & 0xFF;
                                msg[5] = coords.y & 0xFF;
                                vncAdapter.send(msg.buffer);
                            }
                        });

                        canvas.addEventListener('mouseup', (e) => {
                            if (vncAdapter.readyState === WebSocket.OPEN) {
                                const coords = computePointerPosition(e);
                                if (!coords) return;

                                const msg = new Uint8Array(6);
                                msg[0] = 5; // PointerEvent
                                msg[1] = 0; // No button
                                msg[2] = (coords.x >> 8) & 0xFF;
                                msg[3] = coords.x & 0xFF;
                                msg[4] = (coords.y >> 8) & 0xFF;
                                msg[5] = coords.y & 0xFF;
                                vncAdapter.send(msg.buffer);
                            }
                        });

                        canvas.addEventListener('mousemove', (e) => {
                            if (vncAdapter.readyState === WebSocket.OPEN) {
                                const coords = computePointerPosition(e);
                                if (!coords) return;

                                const msg = new Uint8Array(6);
                                msg[0] = 5; // PointerEvent
                                msg[1] = e.buttons === 1 ? 1 : (e.buttons === 2 ? 4 : 0);
                                msg[2] = (coords.x >> 8) & 0xFF;
                                msg[3] = coords.x & 0xFF;
                                msg[4] = (coords.y >> 8) & 0xFF;
                                msg[5] = coords.y & 0xFF;
                                vncAdapter.send(msg.buffer);
                            }
                        });
                        
                        canvas.addEventListener('contextmenu', (e) => {
                            e.preventDefault(); // Prevent browser context menu
                        });
                        
                        // Handle keyboard events
                        canvas.addEventListener('keydown', (e) => {
                            if (vncAdapter.readyState === WebSocket.OPEN) {
                                const msg = new Uint8Array(8);
                                msg[0] = 4; // KeyEvent
                                msg[1] = 1; // Down
                                msg[2] = 0; msg[3] = 0; // padding
                                const key = e.keyCode || e.which;
                                msg[4] = (key >> 24) & 0xFF;
                                msg[5] = (key >> 16) & 0xFF;
                                msg[6] = (key >> 8) & 0xFF;
                                msg[7] = key & 0xFF;
                                vncAdapter.send(msg.buffer);
                            }
                        });
                        
                        canvas.addEventListener('keyup', (e) => {
                            if (vncAdapter.readyState === WebSocket.OPEN) {
                                const msg = new Uint8Array(8);
                                msg[0] = 4; // KeyEvent
                                msg[1] = 0; // Up
                                msg[2] = 0; msg[3] = 0; // padding
                                const key = e.keyCode || e.which;
                                msg[4] = (key >> 24) & 0xFF;
                                msg[5] = (key >> 16) & 0xFF;
                                msg[6] = (key >> 8) & 0xFF;
                                msg[7] = key & 0xFF;
                                vncAdapter.send(msg.buffer);
                            }
                        });
                        
                        // Make canvas focusable for keyboard events
                        canvas.setAttribute('tabindex', '0');
                        canvas.style.outline = 'none';
                        
                        vncAdapter.onclose = () => {
                            isConnected = false;
                            pendingFramebufferRequest = false;
                            pendingFramebufferRequestSince = 0;
                            lastFramebufferAt = 0;
                            if (vncRefreshTimer) {
                                clearInterval(vncRefreshTimer);
                                vncRefreshTimer = null;
                            }
                            placeholder.style.display = 'block';
                            canvas.style.display = 'none';
                            connectBtn.disabled = false;
                            connectBtn.textContent = 'Connect';
                            connectBtn.style.background = '#238636'; // Green color (back to original)
                            disconnectHeaderBtn.style.display = 'none';
                            statusDiv.textContent = 'Disconnected';
                            statusDiv.style.color = '#8b949e';
                            vncScreenWidth = 0;
                            vncScreenHeight = 0;
                            hostInput.disabled = false;
                            portInput.disabled = false;
                            passwordInput.disabled = false;
                        };
                        
                        vncAdapter.onerror = (event) => {
                            isConnected = false;
                            pendingFramebufferRequest = false;
                            pendingFramebufferRequestSince = 0;
                            lastFramebufferAt = 0;
                            if (vncRefreshTimer) {
                                clearInterval(vncRefreshTimer);
                                vncRefreshTimer = null;
                            }
                            statusDiv.textContent = `Error: ${event.error || 'Connection failed'}`;
                            statusDiv.style.color = '#f85149';
                            connectBtn.disabled = false;
                            connectBtn.textContent = 'Connect';
                            connectBtn.style.background = '#238636';
                            hostInput.disabled = false;
                            portInput.disabled = false;
                            passwordInput.disabled = false;
                        };
                        
                        // Connect
                        vncAdapter.connect(host, port, password);

                        // Periodic refresh loop (keeps VNC moving even if a message is dropped)
                        if (vncRefreshTimer) {
                            clearInterval(vncRefreshTimer);
                            vncRefreshTimer = null;
                        }
                        vncRefreshTimer = setInterval(() => {
                            try {
                                if (!isConnected || !vncAdapter || vncAdapter.readyState !== WebSocket.OPEN) return;
                                const now = Date.now();

                                // If we asked for a framebuffer but never got an update, retry.
                                if (pendingFramebufferRequest && pendingFramebufferRequestSince > 0 && (now - pendingFramebufferRequestSince) > VNC_PENDING_TIMEOUT_MS) {
                                    pendingFramebufferRequest = false;
                                    pendingFramebufferRequestSince = 0;
                                }

                                // Request at most ~10 FPS (and only when not already pending).
                                if (!pendingFramebufferRequest && (now - lastFramebufferAt) >= VNC_REFRESH_INTERVAL_MS) {
                                    requestFramebuffer(true);
                                }
                            } catch (e) {
                                // ignore timer errors
                            }
                        }, VNC_REFRESH_INTERVAL_MS);
                        
                    } catch (err) {
                        statusDiv.textContent = `Error: ${err.message}`;
                        statusDiv.style.color = '#f85149';
                        connectBtn.disabled = false;
                        connectBtn.textContent = 'Connect';
                        connectBtn.style.background = '#238636';
                        hostInput.disabled = false;
                        portInput.disabled = false;
                        passwordInput.disabled = false;
                        isConnected = false;
                    }
                };
                
                const disconnect = () => {
                    pendingFramebufferRequest = false;
                    pendingFramebufferRequestSince = 0;
                    lastFramebufferAt = 0;
                    if (vncRefreshTimer) {
                        clearInterval(vncRefreshTimer);
                        vncRefreshTimer = null;
                    }
                    if (vncAdapter) {
                        vncAdapter.close();
                        vncAdapter = null;
                    }
                    if (vncSocket && connectionId) {
                        vncSocket.emit('vnc_disconnect', { connection_id: connectionId });
                    }
                };
                
                connectBtn.addEventListener('click', () => {
                    if (isConnected) {
                        disconnect();
                    } else {
                        connect();
                    }
                });
                disconnectHeaderBtn.addEventListener('click', disconnect);
                
                // Allow Enter key to connect
                [hostInput, portInput, passwordInput].forEach(input => {
                    input.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter' && !connectBtn.disabled) {
                            connect();
                        }
                    });
                });
            }
        });
        return winId;
    }

    spawnDockerEnvironments() {
        const winId = this.wm.createWindow({
            title: 'Docker Environments',
            icon: 'cube-outline',
            width: '1200px',
            height: '800px',
            headerButtons: `
                <button id="refresh-docker-btn" class="header-action-btn" title="Refresh">
                    <ion-icon name="refresh-outline"></ion-icon>
                </button>
            `,
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif;">
                    <!-- Header -->
                    <div style="padding: 20px; border-bottom: 1px solid #30363d; background: #161b22;">
                        <h2 style="margin: 0; font-size: 18px; font-weight: 600; color: #c9d1d9; display: flex; align-items: center; gap: 10px;">
                            <ion-icon name="cube-outline" style="color: #58a6ff; font-size: 20px;"></ion-icon>
                            Docker Environments Manager
                        </h2>
                        <p style="margin: 5px 0 0 0; color: #8b949e; font-size: 12px;">Manage and launch Docker environments from dockers_environements modules</p>
                    </div>
                    
                    <!-- Environments List -->
                    <div style="flex: 1; overflow-y: auto; padding: 20px;">
                        <div id="docker-environments-list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 15px;">
                            <div style="text-align: center; color: #8b949e; padding: 40px; grid-column: 1 / -1;">Loading environments...</div>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const refreshBtn = document.querySelector(`#${wId} #refresh-docker-btn`);
                const envList = document.querySelector(`#${wId} #docker-environments-list`);

                const loadEnvironments = async () => {
                    try {
                        envList.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 40px; grid-column: 1 / -1;">Loading...</div>';
                        
                        const response = await fetch('/api/docker_environments/list');
                        const data = await response.json();
                        
                        if (data.error) {
                            envList.innerHTML = `<div style="text-align: center; color: #f85149; padding: 40px; grid-column: 1 / -1;">Error: ${data.error}</div>`;
                            return;
                        }

                        const environments = data.environments || [];
                        
                        if (environments.length === 0) {
                            envList.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 40px; grid-column: 1 / -1;">No Docker environments found. Check docker_environments modules directory.</div>';
                            return;
                        }

                        envList.innerHTML = environments.map(env => {
                            const isRunning = env.status === 'running';
                            const statusColor = isRunning ? '#3fb950' : '#8b949e';
                            const statusText = isRunning ? 'Running' : 'Stopped';
                            const hasWebInterface = env.web_port && env.web_port > 0;

                            return `
                                <div class="docker-env-card" data-env-name="${env.name}" style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; transition: all 0.2s;">
                                    <div style="display: flex; align-items: start; justify-content: space-between; margin-bottom: 15px;">
                                        <div style="flex: 1;">
                                            <h3 style="margin: 0 0 5px 0; color: #c9d1d9; font-size: 16px; font-weight: 600;">${env.name}</h3>
                                            <div style="display: flex; align-items: center; gap: 8px; margin-top: 5px;">
                                                <span style="width: 8px; height: 8px; border-radius: 50%; background: ${statusColor};"></span>
                                                <span style="color: ${statusColor}; font-size: 12px; font-weight: 500;">${statusText}</span>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    ${env.description ? `<p style="margin: 0 0 15px 0; color: #8b949e; font-size: 12px; line-height: 1.5;">${env.description}</p>` : ''}
                                    
                                    <div style="margin-bottom: 15px; font-size: 11px; color: #8b949e;">
                                        ${env.module_path ? `<div style="margin-bottom: 4px;"><strong>Module:</strong> ${env.module_path}</div>` : ''}
                                        ${env.container_name ? `<div style="margin-bottom: 4px;"><strong>Container:</strong> ${env.container_name}</div>` : ''}
                                        ${env.image ? `<div style="margin-bottom: 4px;"><strong>Image:</strong> ${env.image}</div>` : ''}
                                        ${hasWebInterface ? `<div style="margin-bottom: 4px;"><strong>Web Port:</strong> ${env.web_port}</div>` : ''}
                                    </div>
                                    
                                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                        ${!isRunning ? `
                                            <button class="docker-env-action-btn" data-action="start" data-env="${env.name}" data-module-path="${env.module_path || env.name}" style="flex: 1; min-width: 80px; padding: 8px 12px; background: #238636; border: 1px solid #238636; border-radius: 6px; color: white; cursor: pointer; font-size: 12px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 4px; transition: all 0.2s;">
                                                <ion-icon name="play-outline" style="font-size: 14px;"></ion-icon>
                                                Start
                                            </button>
                                        ` : `
                                            <button class="docker-env-action-btn" data-action="stop" data-env="${env.name}" data-module-path="${env.module_path || env.name}" style="flex: 1; min-width: 80px; padding: 8px 12px; background: #da3633; border: 1px solid #da3633; border-radius: 6px; color: white; cursor: pointer; font-size: 12px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 4px; transition: all 0.2s;">
                                                <ion-icon name="stop-outline" style="font-size: 14px;"></ion-icon>
                                                Stop
                                            </button>
                                        `}
                                        
                                        ${hasWebInterface && isRunning ? `
                                            <button class="docker-env-action-btn" data-action="open-web" data-env="${env.name}" data-port="${env.web_port}" style="flex: 1; min-width: 80px; padding: 8px 12px; background: #1f6feb; border: 1px solid #1f6feb; border-radius: 6px; color: white; cursor: pointer; font-size: 12px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 4px; transition: all 0.2s;">
                                                <ion-icon name="globe-outline" style="font-size: 14px;"></ion-icon>
                                                Open Web
                                            </button>
                                        ` : ''}
                                        
                                        <button class="docker-env-action-btn" data-action="logs" data-env="${env.name}" data-module-path="${env.module_path || env.name}" style="flex: 1; min-width: 80px; padding: 8px 12px; background: #6e7681; border: 1px solid #6e7681; border-radius: 6px; color: white; cursor: pointer; font-size: 12px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 4px; transition: all 0.2s;">
                                            <ion-icon name="document-text-outline" style="font-size: 14px;"></ion-icon>
                                            Logs
                                        </button>
                                    </div>
                                </div>
                            `;
                        }).join('');

                        // Add event listeners
                        document.querySelectorAll(`#${wId} .docker-env-action-btn`).forEach(btn => {
                            btn.addEventListener('click', async (e) => {
                                const action = btn.dataset.action;
                                const envName = btn.dataset.env;
                                const card = btn.closest('.docker-env-card');
                                
                                // Save original content
                                const originalHTML = btn.innerHTML;
                                
                                // Show loading state
                                btn.disabled = true;
                                btn.style.opacity = '0.7';
                                btn.style.cursor = 'wait';
                                btn.innerHTML = `
                                    <div style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                                    <span style="margin-left: 6px;">${action === 'start' ? 'Starting...' : action === 'stop' ? 'Stopping...' : 'Loading...'}</span>
                                `;
                                
                                // Add spin animation if not already in styles
                                if (!document.getElementById('docker-spinner-style')) {
                                    const style = document.createElement('style');
                                    style.id = 'docker-spinner-style';
                                    style.textContent = `
                                        @keyframes spin {
                                            to { transform: rotate(360deg); }
                                        }
                                    `;
                                    document.head.appendChild(style);
                                }

                                try {
                                    // Use module_path if available, otherwise use name
                                    const modulePath = btn.dataset.modulePath || envName;
                                    
                                    if (action === 'start') {
                                        const response = await fetch(`/api/docker_environments/${encodeURIComponent(modulePath)}/start`, { method: 'POST' });
                                        const result = await response.json();
                                        if (result.success) {
                                            if (this.showNotification) {
                                                this.showNotification(`Environment "${envName}" started successfully`, 'success', 3000);
                                            }
                                            loadEnvironments();
                                        } else {
                                            if (this.showNotification) {
                                                this.showNotification(`Failed to start: ${result.error || 'Unknown error'}`, 'error', 5000);
                                            }
                                            // Restore button
                                            btn.disabled = false;
                                            btn.style.opacity = '1';
                                            btn.style.cursor = 'pointer';
                                            btn.innerHTML = originalHTML;
                                        }
                                    } else if (action === 'stop') {
                                        const response = await fetch(`/api/docker_environments/${encodeURIComponent(modulePath)}/stop`, { method: 'POST' });
                                        const result = await response.json();
                                        if (result.success) {
                                            if (this.showNotification) {
                                                this.showNotification(`Environment "${envName}" stopped successfully`, 'success', 3000);
                                            }
                                            loadEnvironments();
                                        } else {
                                            if (this.showNotification) {
                                                this.showNotification(`Failed to stop: ${result.error || 'Unknown error'}`, 'error', 5000);
                                            }
                                            // Restore button
                                            btn.disabled = false;
                                            btn.style.opacity = '1';
                                            btn.style.cursor = 'pointer';
                                            btn.innerHTML = originalHTML;
                                        }
                                    } else if (action === 'open-web') {
                                        // Restore button immediately for open-web (no async operation)
                                        btn.disabled = false;
                                        btn.style.opacity = '1';
                                        btn.style.cursor = 'pointer';
                                        btn.innerHTML = originalHTML;
                                        
                                        const port = btn.dataset.port;
                                        const url = `http://localhost:${port}`;
                                        this.wm.createWindow({
                                            title: `${envName} - Web Interface`,
                                            icon: 'globe-outline',
                                            width: '1000px',
                                            height: '700px',
                                            top: '30px',
                                            left: '100px',
                                            content: `
                                                <div style="display: flex; flex-direction: column; height: 100%; background: #fff;">
                                                    <div style="padding: 10px; background: #0d1117; border-bottom: 2px solid #58a6ff; display: flex; align-items: center; gap: 10px;">
                                                        <span style="color: #58a6ff; font-weight: bold; font-size: 14px;">🐳 ${envName}</span>
                                                        <span style="color: #8b949e; font-size: 12px;">${url}</span>
                                                        <a href="${url}" target="_blank" style="margin-left: auto; color: #58a6ff; text-decoration: none; font-size: 12px;">Open in New Tab ↗</a>
                                                    </div>
                                                    <iframe src="${url}" style="flex: 1; border: none; background: white;"></iframe>
                                                </div>
                                            `
                                        });
                                    } else if (action === 'logs') {
                                        // Show loading for logs
                                        btn.innerHTML = `
                                            <div style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                                            <span style="margin-left: 6px;">Loading...</span>
                                        `;
                                        
                                        try {
                                            // Use module_path if available, otherwise use name
                                            const modulePath = btn.dataset.modulePath || envName;
                                            const response = await fetch(`/api/docker_environments/${encodeURIComponent(modulePath)}/logs`);
                                            const result = await response.json();
                                            
                                            if (result.success) {
                                                const logsWinId = this.wm.createWindow({
                                                    title: `${envName} - Logs`,
                                                    icon: 'document-text-outline',
                                                    width: '900px',
                                                    height: '600px',
                                                    content: `
                                                        <div style="display: flex; flex-direction: column; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Fira Code', monospace;">
                                                            <div style="padding: 15px; border-bottom: 1px solid #30363d; background: #161b22;">
                                                                <h3 style="margin: 0; font-size: 14px; color: #c9d1d9;">Container Logs</h3>
                                                            </div>
                                                            <div style="flex: 1; overflow-y: auto; padding: 15px; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word;">
                                                                ${result.logs || 'No logs available'}
                                                            </div>
                                                        </div>
                                                    `
                                                });
                                            } else {
                                                if (this.showNotification) {
                                                    this.showNotification(`Failed to get logs: ${result.error || 'Unknown error'}`, 'error', 5000);
                                                }
                                            }
                                        } catch (error) {
                                            console.error('Error loading logs:', error);
                                            if (this.showNotification) {
                                                this.showNotification(`Error loading logs: ${error.message || 'Network error'}`, 'error', 5000);
                                            }
                                        } finally {
                                            // Restore button
                                            btn.disabled = false;
                                            btn.style.opacity = '1';
                                            btn.style.cursor = 'pointer';
                                            btn.innerHTML = originalHTML;
                                        }
                                    }
                                } catch (error) {
                                    // Handle network errors or other exceptions
                                    console.error('Error:', error);
                                    if (this.showNotification) {
                                        this.showNotification(`Error: ${error.message || 'Network error'}`, 'error', 5000);
                                    }
                                    // Restore button
                                    btn.disabled = false;
                                    btn.style.opacity = '1';
                                    btn.style.cursor = 'pointer';
                                    btn.innerHTML = originalHTML;
                                }
                            });
                        });

                    } catch (error) {
                        envList.innerHTML = `<div style="text-align: center; color: #f85149; padding: 40px; grid-column: 1 / -1;">Error loading environments: ${error.message}</div>`;
                    }
                };

                refreshBtn.addEventListener('click', loadEnvironments);
                loadEnvironments();
            }
        });
        return winId;
    }

    spawnMarketplace() {
        const winId = this.wm.createWindow({
            title: 'Marketplace',
            icon: 'storefront-outline',
            width: '1400px',
            height: '900px',
            headerButtons: `
                <button id="refresh-marketplace-btn" class="header-action-btn" title="Refresh">
                    <ion-icon name="refresh-outline"></ion-icon>
                </button>
            `,
            content: `
                <div style="display: flex; flex-direction: column; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Outfit', sans-serif;">
                    <!-- Header -->
                    <div style="padding: 15px 20px; border-bottom: 1px solid #30363d; background: #161b22; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <h2 style="margin: 0; font-size: 18px; font-weight: 600; color: #c9d1d9; display: flex; align-items: center; gap: 10px;">
                                <ion-icon name="storefront-outline" style="color: #ffa500; font-size: 20px;"></ion-icon>
                                Marketplace
                            </h2>
                            <p style="margin: 5px 0 0 0; color: #8b949e; font-size: 12px;">Browse and manage modules</p>
                        </div>
                        <div id="marketplace-account-status" style="display: flex; align-items: center; gap: 10px;">
                            <span id="marketplace-account-info" style="color: #8b949e; font-size: 12px;">Not logged in</span>
                            <button id="marketplace-login-btn" class="btn-marketplace" style="padding: 6px 12px; background: #238636; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">Login</button>
                            <button id="marketplace-logout-btn" class="btn-marketplace" style="display: none; padding: 6px 12px; background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 4px; cursor: pointer; font-size: 12px;">Logout</button>
                        </div>
                    </div>

                    <!-- Tabs -->
                    <div style="display: flex; gap: 0; border-bottom: 1px solid #30363d; background: #161b22;">
                        <button class="marketplace-tab-btn active" data-tab="installed" style="padding: 12px 20px; background: none; border: none; color: #8b949e; cursor: pointer; font-size: 14px; font-weight: 500; border-bottom: 2px solid transparent; transition: all 0.2s; display: flex; align-items: center; gap: 6px;">
                            <ion-icon name="cube-outline"></ion-icon> Installed
                        </button>
                        <button class="marketplace-tab-btn" data-tab="browse" style="padding: 12px 20px; background: none; border: none; color: #8b949e; cursor: pointer; font-size: 14px; font-weight: 500; border-bottom: 2px solid transparent; transition: all 0.2s; display: flex; align-items: center; gap: 6px;">
                            <ion-icon name="search-outline"></ion-icon> Browse
                        </button>
                    </div>

                    <!-- Installed Tab -->
                    <div id="marketplace-installed-tab" class="marketplace-tab-content active" style="flex: 1; overflow-y: auto; padding: 20px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                            <h3 style="margin: 0; font-size: 16px; color: #c9d1d9;">Installed Modules</h3>
                        </div>
                        <div id="marketplace-installed-list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 15px;">
                            <div style="text-align: center; color: #8b949e; padding: 40px; grid-column: 1 / -1;">Loading installed modules...</div>
                        </div>
                    </div>

                    <!-- Browse Tab -->
                    <div id="marketplace-browse-tab" class="marketplace-tab-content" style="flex: 1; overflow-y: auto; padding: 20px; display: none;">
                        <div style="margin-bottom: 20px;">
                            <div style="display: flex; gap: 10px; align-items: center; background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 8px 12px;">
                                <ion-icon name="search-outline" style="color: #8b949e; font-size: 18px;"></ion-icon>
                                <input type="text" id="marketplace-search-input" placeholder="Search modules..." style="flex: 1; background: none; border: none; color: #c9d1d9; font-size: 14px; outline: none; font-family: 'Outfit', sans-serif;">
                                <button id="marketplace-search-btn" style="padding: 6px 16px; background: #238636; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">Search</button>
                            </div>
                        </div>
                        <div id="marketplace-browse-list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 15px;">
                            <div style="text-align: center; color: #8b949e; padding: 40px; grid-column: 1 / -1;">Loading marketplace modules...</div>
                        </div>
                        <div id="marketplace-pagination" style="display: none; justify-content: center; align-items: center; gap: 15px; margin-top: 20px;">
                            <button id="marketplace-prev-page" style="padding: 8px 16px; background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 4px; cursor: pointer; font-size: 12px;">Previous</button>
                            <span id="marketplace-page-info" style="color: #8b949e; font-size: 12px;">Page 1</span>
                            <button id="marketplace-next-page" style="padding: 8px 16px; background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 4px; cursor: pointer; font-size: 12px;">Next</button>
                        </div>
                    </div>

                    <!-- Login Modal -->
                    <div id="marketplace-login-modal" class="marketplace-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.7); z-index: 10000; align-items: center; justify-content: center;">
                        <div class="marketplace-modal-content" style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; width: 90%; max-width: 400px; padding: 0; overflow: hidden;">
                            <div style="padding: 20px; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center;">
                                <h3 style="margin: 0; color: #c9d1d9; font-size: 18px;">Marketplace Login</h3>
                                <button id="marketplace-modal-close" style="background: none; border: none; color: #8b949e; cursor: pointer; font-size: 24px; padding: 0; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;">&times;</button>
                            </div>
                            <div style="padding: 20px;">
                                <div id="marketplace-login-form">
                                    <div style="margin-bottom: 15px;">
                                        <label style="display: block; color: #c9d1d9; font-size: 13px; margin-bottom: 5px;">Email</label>
                                        <input type="email" id="marketplace-login-email" style="width: 100%; padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 14px; box-sizing: border-box; font-family: 'Outfit', sans-serif;" placeholder="your@email.com">
                                    </div>
                                    <div style="margin-bottom: 15px;">
                                        <label style="display: block; color: #c9d1d9; font-size: 13px; margin-bottom: 5px;">Password</label>
                                        <input type="password" id="marketplace-login-password" style="width: 100%; padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 14px; box-sizing: border-box; font-family: 'Outfit', sans-serif;" placeholder="••••••••">
                                    </div>
                                    <div style="margin-bottom: 15px;">
                                        <button id="marketplace-login-submit" style="width: 100%; padding: 10px; background: #238636; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500;">Login</button>
                                    </div>
                                    <div style="text-align: center;">
                                        <button id="marketplace-show-register" style="background: none; border: none; color: #58a6ff; cursor: pointer; font-size: 13px; text-decoration: underline;">Don't have an account? Register</button>
                                    </div>
                                </div>
                                <div id="marketplace-register-form" style="display: none;">
                                    <div style="margin-bottom: 15px;">
                                        <label style="display: block; color: #c9d1d9; font-size: 13px; margin-bottom: 5px;">Email</label>
                                        <input type="email" id="marketplace-register-email" style="width: 100%; padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 14px; box-sizing: border-box; font-family: 'Outfit', sans-serif;" placeholder="your@email.com">
                                    </div>
                                    <div style="margin-bottom: 15px;">
                                        <label style="display: block; color: #c9d1d9; font-size: 13px; margin-bottom: 5px;">Username</label>
                                        <input type="text" id="marketplace-register-username" style="width: 100%; padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 14px; box-sizing: border-box; font-family: 'Outfit', sans-serif;" placeholder="username">
                                    </div>
                                    <div style="margin-bottom: 15px;">
                                        <label style="display: block; color: #c9d1d9; font-size: 13px; margin-bottom: 5px;">Password</label>
                                        <input type="password" id="marketplace-register-password" style="width: 100%; padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 14px; box-sizing: border-box; font-family: 'Outfit', sans-serif;" placeholder="••••••••">
                                    </div>
                                    <div style="margin-bottom: 15px;">
                                        <label style="display: block; color: #c9d1d9; font-size: 13px; margin-bottom: 5px;">Confirm Password</label>
                                        <input type="password" id="marketplace-register-password-confirm" style="width: 100%; padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 14px; box-sizing: border-box; font-family: 'Outfit', sans-serif;" placeholder="••••••••">
                                    </div>
                                    <div style="margin-bottom: 15px;">
                                        <button id="marketplace-register-submit" style="width: 100%; padding: 10px; background: #238636; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500;">Register</button>
                                    </div>
                                    <div style="text-align: center;">
                                        <button id="marketplace-show-login" style="background: none; border: none; color: #58a6ff; cursor: pointer; font-size: 13px; text-decoration: underline;">Already have an account? Login</button>
                                    </div>
                                </div>
                                <div id="marketplace-auth-message" style="margin-top: 15px; padding: 10px; border-radius: 4px; display: none; font-size: 13px;"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Uninstall Confirmation Modal -->
                    <div id="marketplace-uninstall-modal" class="marketplace-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.7); z-index: 10000; align-items: center; justify-content: center;">
                        <div class="marketplace-modal-content" style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; width: 90%; max-width: 450px; padding: 0; overflow: hidden;">
                            <div style="padding: 20px; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center;">
                                <h3 style="margin: 0; color: #c9d1d9; font-size: 18px; display: flex; align-items: center; gap: 10px;">
                                    <ion-icon name="warning-outline" style="color: #f85149; font-size: 24px;"></ion-icon>
                                    Confirm Uninstall
                                </h3>
                                <button id="marketplace-uninstall-modal-close" style="background: none; border: none; color: #8b949e; cursor: pointer; font-size: 24px; padding: 0; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;">&times;</button>
                            </div>
                            <div style="padding: 20px;">
                                <p style="color: #c9d1d9; font-size: 14px; line-height: 1.6; margin: 0 0 20px 0;">
                                    Are you sure you want to uninstall <strong id="marketplace-uninstall-module-name" style="color: #ffa500;">this module</strong>?
                                </p>
                                <p style="color: #8b949e; font-size: 12px; margin: 0 0 20px 0;">
                                    This action cannot be undone. The module will be removed from your system.
                                </p>
                                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                                    <button id="marketplace-uninstall-cancel" style="padding: 10px 20px; background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500;">Cancel</button>
                                    <button id="marketplace-uninstall-confirm" style="padding: 10px 20px; background: #da3633; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 6px;">
                                        <ion-icon name="trash-outline"></ion-icon> Uninstall
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <style>
                    .marketplace-tab-btn.active {
                        color: #ffa500 !important;
                        border-bottom-color: #ffa500 !important;
                    }
                    .marketplace-tab-btn:hover {
                        color: #c9d1d9;
                    }
                    .marketplace-tab-content {
                        display: none;
                    }
                    .marketplace-tab-content.active {
                        display: block;
                    }
                    .marketplace-module-card {
                        background: #161b22;
                        border: 1px solid #30363d;
                        border-radius: 8px;
                        padding: 15px;
                        transition: all 0.2s;
                        cursor: pointer;
                    }
                    .marketplace-module-card:hover {
                        border-color: #ffa500;
                        transform: translateY(-2px);
                        box-shadow: 0 4px 12px rgba(255, 165, 0, 0.1);
                    }
                    .marketplace-module-badge {
                        display: inline-block;
                        padding: 3px 8px;
                        border-radius: 12px;
                        font-size: 11px;
                        font-weight: 500;
                        background: #21262d;
                        color: #8b949e;
                    }
                    .marketplace-module-badge.installed {
                        background: #238636;
                        color: #fff;
                    }
                    .marketplace-module-badge.free {
                        background: #1f6feb;
                        color: #fff;
                    }
                    .marketplace-module-badge.paid {
                        background: #f85149;
                        color: #fff;
                    }
                    .marketplace-modal {
                        display: none !important;
                    }
                    .marketplace-modal.active {
                        display: flex !important;
                    }
                    #marketplace-uninstall-modal.active {
                        display: flex !important;
                    }
                    .marketplace-modal-content input:focus {
                        outline: none;
                        border-color: #58a6ff;
                    }
                    .marketplace-modal-content button:hover {
                        opacity: 0.9;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            `,
            onLoad: (wId) => {
                // Initialize marketplace functionality
                const refreshBtn = document.querySelector(`#${wId} #refresh-marketplace-btn`);
                const installedTab = document.querySelector(`#${wId} #marketplace-installed-tab`);
                const browseTab = document.querySelector(`#${wId} #marketplace-browse-tab`);
                const tabBtns = document.querySelectorAll(`#${wId} .marketplace-tab-btn`);
                // Find login button with multiple fallback methods
                let loginBtn = document.querySelector(`#${wId} #marketplace-login-btn`);
                if (!loginBtn) {
                    loginBtn = document.getElementById('marketplace-login-btn');
                }
                if (!loginBtn) {
                    const windowEl = document.getElementById(wId);
                    if (windowEl) {
                        loginBtn = windowEl.querySelector('#marketplace-login-btn');
                    }
                }
                
                const logoutBtn = document.querySelector(`#${wId} #marketplace-logout-btn`);
                const accountInfo = document.querySelector(`#${wId} #marketplace-account-info`);

                let currentPage = 1;
                let currentSearch = '';
                let installedModulesList = []; // Cache for installed modules
                let marketplaceModulesList = []; // Cache for marketplace modules
                let moduleAccessCache = {}; // Cache for module access status (purchased, free, etc.)

                // Tab switching
                tabBtns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        const tabName = btn.dataset.tab;
                        tabBtns.forEach(b => b.classList.remove('active'));
                        document.querySelectorAll(`#${wId} .marketplace-tab-content`).forEach(c => {
                            c.classList.remove('active');
                            c.style.display = 'none';
                        });
                        btn.classList.add('active');
                        if (tabName === 'installed') {
                            installedTab.classList.add('active');
                            installedTab.style.display = 'block';
                            loadInstalledModules();
                        } else {
                            browseTab.classList.add('active');
                            browseTab.style.display = 'block';
                            loadMarketplaceModules();
                        }
                    });
                });

                // Check if a module is installed
                function isModuleInstalled(moduleId, moduleName) {
                    return installedModulesList.some(m => 
                        m.id === moduleId || 
                        m.marketplace_id === moduleId ||
                        (m.name && moduleName && m.name.toLowerCase() === moduleName.toLowerCase())
                    );
                }

                // Compare versions (simple semver comparison)
                function compareVersions(v1, v2) {
                    if (!v1 || !v2) return 0;
                    const parts1 = v1.split('.').map(Number);
                    const parts2 = v2.split('.').map(Number);
                    const maxLen = Math.max(parts1.length, parts2.length);
                    
                    for (let i = 0; i < maxLen; i++) {
                        const p1 = parts1[i] || 0;
                        const p2 = parts2[i] || 0;
                        if (p1 > p2) return 1;
                        if (p1 < p2) return -1;
                    }
                    return 0;
                }

                // Load installed modules
                async function loadInstalledModules() {
                    const listEl = document.querySelector(`#${wId} #marketplace-installed-list`);
                    listEl.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 40px; grid-column: 1 / -1;">Loading...</div>';
                    
                    try {
                        const response = await fetch('/api/market/installed');
                        const data = await response.json();
                        
                        if (data.success && data.modules && data.modules.length > 0) {
                            installedModulesList = data.modules; // Cache the list
                            
                            // Check for updates for each module
                            const modulesWithUpdates = await Promise.all(data.modules.map(async (module) => {
                                try {
                                    // Try to get marketplace info to check for updates
                                    const infoResponse = await fetch(`/api/market/info/${module.id || module.marketplace_id || module.id}`);
                                    const infoData = await infoResponse.json();
                                    
                                    if (infoData.success && infoData.module) {
                                        const marketplaceVersion = infoData.module.version;
                                        const installedVersion = module.version;
                                        
                                        if (marketplaceVersion && installedVersion && compareVersions(marketplaceVersion, installedVersion) > 0) {
                                            module.hasUpdate = true;
                                            module.updateVersion = marketplaceVersion;
                                        }
                                    }
                                } catch (e) {
                                    // Silently fail - no update info available
                                }
                                return module;
                            }));
                            
                            listEl.innerHTML = modulesWithUpdates.map(module => createModuleCard(module, true)).join('');
                            attachModuleActions(listEl, true);
                        } else {
                            installedModulesList = []; // Clear cache
                            listEl.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 40px; grid-column: 1 / -1;"><ion-icon name="cube-outline" style="font-size: 48px; color: #6e7681; margin-bottom: 10px;"></ion-icon><p>No modules installed</p></div>';
                        }
                    } catch (error) {
                        installedModulesList = []; // Clear cache on error
                        listEl.innerHTML = `<div style="text-align: center; color: #f85149; padding: 40px; grid-column: 1 / -1;">Error: ${error.message}</div>`;
                    }
                }

                // Load marketplace modules
                async function loadMarketplaceModules(page = 1, search = '') {
                    const listEl = document.querySelector(`#${wId} #marketplace-browse-list`);
                    listEl.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 40px; grid-column: 1 / -1;">Loading...</div>';
                    
                    try {
                        // Load installed modules first to check installation status
                        if (installedModulesList.length === 0) {
                            try {
                                const installedResponse = await fetch('/api/market/installed');
                                const installedData = await installedResponse.json();
                                if (installedData.success && installedData.modules) {
                                    installedModulesList = installedData.modules;
                                }
                            } catch (e) {
                                // Ignore error
                            }
                        }
                        
                        const params = new URLSearchParams({ page, limit: 20 });
                        if (search) params.append('search', search);
                        
                        const response = await fetch(`/api/market/list?${params}`);
                        const data = await response.json();
                        
                        if (data.success && data.modules && data.modules.length > 0) {
                            // Cache the modules list
                            marketplaceModulesList = data.modules;
                            
                            // Check access for each module (async, but we'll update UI after)
                            const modulesWithStatus = await Promise.all(data.modules.map(async (module) => {
                                const moduleId = module.id || module.marketplace_id || '';
                                const isInstalled = isModuleInstalled(moduleId, module.name);
                                
                                // Check if module is paid and if user has access
                                const price = module.price || 0;
                                const isFree = price === 0;
                                let hasAccess = isFree;
                                
                                if (!isFree && !isInstalled) {
                                    // Check access status
                                    if (moduleAccessCache[moduleId] === undefined) {
                                        try {
                                            const accessResponse = await fetch(`/api/market/check/${encodeURIComponent(moduleId)}`);
                                            const accessData = await accessResponse.json();
                                            if (accessData.success) {
                                                hasAccess = accessData.has_access || accessData.has_purchased || accessData.can_download || accessData.is_author;
                                                moduleAccessCache[moduleId] = {
                                                    hasAccess: hasAccess,
                                                    requiresPayment: accessData.requires_payment || false,
                                                    price: accessData.price || price,
                                                    currency: accessData.currency || module.currency || 'EUR'
                                                };
                                            }
                                        } catch (e) {
                                            console.warn('Error checking module access:', e);
                                            hasAccess = false;
                                        }
                                    } else {
                                        hasAccess = moduleAccessCache[moduleId].hasAccess;
                                    }
                                }
                                
                                return { 
                                    ...module, 
                                    installed: isInstalled,
                                    hasAccess: hasAccess,
                                    isFree: isFree
                                };
                            }));
                            
                            listEl.innerHTML = modulesWithStatus.map(module => createModuleCard(module, false)).join('');
                            attachModuleActions(listEl, false);
                            
                            if (data.total > data.limit) {
                                updatePagination(data.page, data.total, data.limit);
                            } else {
                                document.querySelector(`#${wId} #marketplace-pagination`).style.display = 'none';
                            }
                        } else {
                            listEl.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 40px; grid-column: 1 / -1;"><ion-icon name="search-outline" style="font-size: 48px; color: #6e7681; margin-bottom: 10px;"></ion-icon><p>No modules found</p></div>';
                            document.querySelector(`#${wId} #marketplace-pagination`).style.display = 'none';
                        }
                    } catch (error) {
                        listEl.innerHTML = `<div style="text-align: center; color: #f85149; padding: 40px; grid-column: 1 / -1;">Error: ${error.message}</div>`;
                    }
                }

                function getAuthorString(author) {
                    if (!author) return 'Unknown';
                    if (typeof author === 'string') return author;
                    if (typeof author === 'object') {
                        // Try different possible fields
                        return author.name || author.username || author.email || author.id || 'Unknown';
                    }
                    return 'Unknown';
                }

                function createModuleCard(module, isInstalled) {
                    const price = module.price || 0;
                    const currency = module.currency || 'EUR';
                    const isFree = module.isFree !== undefined ? module.isFree : (price === 0);
                    const authorStr = getAuthorString(module.author);
                    const moduleId = module.id || module.marketplace_id || '';
                    const actuallyInstalled = isInstalled || module.installed;
                    const hasUpdate = module.hasUpdate || false;
                    const updateVersion = module.updateVersion || '';
                    const hasAccess = module.hasAccess !== undefined ? module.hasAccess : isFree;
                    const requiresPayment = !isFree && !hasAccess && !actuallyInstalled;
                    
                    let badge = '';
                    if (actuallyInstalled) {
                        badge = '<span class="marketplace-module-badge installed">Installed</span>';
                    } else if (isFree) {
                        badge = '<span class="marketplace-module-badge free">Free</span>';
                    } else {
                        badge = `<span class="marketplace-module-badge paid">${price} ${currency}</span>`;
                    }
                    
                    // Version display with update indicator
                    let versionDisplay = module.version || 'N/A';
                    if (hasUpdate && updateVersion) {
                        versionDisplay = `${module.version || 'N/A'} → ${updateVersion}`;
                    }
                    
                    // Determine button text and class
                    let actionButton = '';
                    if (actuallyInstalled) {
                        actionButton = `<button class="marketplace-uninstall-btn" data-module-id="${moduleId}" style="flex: 1; min-width: 100px; padding: 8px; background: #da3633; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 4px;">
                                        <ion-icon name="trash-outline"></ion-icon> Uninstall
                                       </button>`;
                    } else if (requiresPayment) {
                        // Show Buy button for paid modules not purchased
                        actionButton = `<button class="marketplace-buy-btn" data-module-id="${moduleId}" data-price="${price}" data-currency="${currency}" style="flex: 1; min-width: 100px; padding: 8px; background: #f85149; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 4px;">
                                        <ion-icon name="card-outline"></ion-icon> Buy
                                       </button>`;
                    } else {
                        // Show Install button for free modules or purchased modules
                        actionButton = `<button class="marketplace-install-btn" data-module-id="${moduleId}" style="flex: 1; min-width: 100px; padding: 8px; background: #238636; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 4px;">
                                        <ion-icon name="download-outline"></ion-icon> Install
                                       </button>`;
                    }
                    
                    return `
                        <div class="marketplace-module-card" data-module-id="${moduleId}">
                            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                                <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: #ffa500; flex: 1;">${escapeHtml(module.name || 'Unknown')}</h3>
                                ${badge}
                            </div>
                            <div style="color: #8b949e; font-size: 13px; line-height: 1.5; margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">
                                ${escapeHtml(module.description || 'No description available')}
                            </div>
                            <div style="display: flex; gap: 15px; font-size: 12px; color: #6e7681; margin-bottom: 12px;">
                                <span><ion-icon name="code-outline"></ion-icon> ${escapeHtml(versionDisplay)}</span>
                                <span><ion-icon name="person-outline"></ion-icon> ${escapeHtml(authorStr)}</span>
                            </div>
                            <div style="display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap;">
                                ${actionButton}
                                ${hasUpdate && actuallyInstalled
                                    ? `<button class="marketplace-update-btn" data-module-id="${moduleId}" style="flex: 1; min-width: 100px; padding: 8px; background: #1f6feb; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 4px;">
                                        <ion-icon name="arrow-up-circle-outline"></ion-icon> Update
                                       </button>`
                                    : ''
                                }
                                <button class="marketplace-info-btn" data-module-id="${moduleId}" style="padding: 8px 12px; background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 4px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 4px;">
                                    <ion-icon name="information-circle-outline"></ion-icon> Info
                                </button>
                            </div>
                        </div>
                    `;
                }

                function attachModuleActions(containerEl, isInstalled) {
                    containerEl.querySelectorAll('.marketplace-install-btn').forEach(btn => {
                        btn.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            const moduleId = btn.dataset.moduleId;
                            await installModule(moduleId, btn);
                        });
                    });
                    
                    containerEl.querySelectorAll('.marketplace-buy-btn').forEach(btn => {
                        btn.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            const moduleId = btn.dataset.moduleId;
                            const price = btn.dataset.price;
                            const currency = btn.dataset.currency;
                            await buyModule(moduleId, price, currency, btn);
                        });
                    });
                    
                    containerEl.querySelectorAll('.marketplace-update-btn').forEach(btn => {
                        btn.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            const moduleId = btn.dataset.moduleId;
                            await updateModule(moduleId, btn);
                        });
                    });
                    
                    containerEl.querySelectorAll('.marketplace-uninstall-btn').forEach(btn => {
                        btn.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            const moduleId = btn.dataset.moduleId;
                            // Get module name from card
                            const card = btn.closest('.marketplace-module-card');
                            const moduleName = card ? card.querySelector('h3')?.textContent?.trim() || moduleId : moduleId;
                            openUninstallModal(moduleId, moduleName, btn);
                        });
                    });
                    
                    containerEl.querySelectorAll('.marketplace-info-btn').forEach(btn => {
                        btn.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            const moduleId = btn.dataset.moduleId;
                            await showModuleInfo(moduleId);
                        });
                    });
                }

                const buyModule = async (moduleId, price, currency, buttonEl = null) => {
                    if (buttonEl) {
                        const originalHTML = buttonEl.innerHTML;
                        buttonEl.disabled = true;
                        buttonEl.style.opacity = '0.6';
                        buttonEl.style.cursor = 'not-allowed';
                        buttonEl.innerHTML = '<div style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite;"></div> <span style="margin-left: 6px;">Processing...</span>';
                        
                        try {
                            const response = await fetch(`/api/market/buy/${encodeURIComponent(moduleId)}`, { method: 'POST' });
                            const data = await response.json();
                            
                            if (data.success) {
                                if (data.checkout_url) {
                                    // Open checkout window
                                    os.wm.createWindow({
                                        title: `Purchase Module - ${moduleId}`,
                                        icon: 'card-outline',
                                        width: '800px',
                                        height: '600px',
                                        content: `
                                            <div style="padding: 30px; background: #0d1117; color: #c9d1d9; font-family: 'Outfit', sans-serif; text-align: center; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center;">
                                                <div style="margin-bottom: 30px;">
                                                    <ion-icon name="card-outline" style="font-size: 64px; color: #635bff; margin-bottom: 20px;"></ion-icon>
                                                    <h2 style="color: #ffa500; margin: 0 0 10px 0; font-size: 24px;">Complete Your Purchase</h2>
                                                    <p style="color: #8b949e; margin: 0; font-size: 14px;">Module: <strong style="color: #c9d1d9;">${escapeHtml(moduleId)}</strong></p>
                                                    <p style="color: #8b949e; margin: 5px 0 0 0; font-size: 14px;">Price: <strong style="color: #c9d1d9;">${price} ${currency}</strong></p>
                                                </div>
                                                <div style="margin-bottom: 30px; padding: 20px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; max-width: 500px;">
                                                    <p style="color: #8b949e; font-size: 13px; line-height: 1.6; margin: 0;">
                                                        Click the button below to complete your purchase securely through Stripe. 
                                                        After payment, you'll be able to install the module.
                                                    </p>
                                                </div>
                                                <a href="${data.checkout_url}" target="_blank" style="display: inline-block; padding: 12px 24px; background: #635bff; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 14px; transition: all 0.2s;">
                                                    <ion-icon name="card-outline" style="vertical-align: middle; margin-right: 8px;"></ion-icon>
                                                    Proceed to Checkout
                                                </a>
                                                ${data.message ? `<p style="color: #58a6ff; margin-top: 20px; font-size: 12px;">${escapeHtml(data.message)}</p>` : ''}
                                                <p style="color: #6e7681; margin-top: 30px; font-size: 11px;">
                                                    After completing payment, close this window and click "Install" to install the module.
                                                </p>
                                            </div>
                                        `
                                    });
                                    
                                    if (os.showNotification) {
                                        os.showNotification('Checkout window opened. Complete payment to proceed.', 'info', 5000);
                                    }
                                    
                                    // Clear cache for this module to refresh access status
                                    delete moduleAccessCache[moduleId];
                                    
                                    // Refresh modules after a delay to check if purchase was completed
                                    setTimeout(async () => {
                                        await loadMarketplaceModules(currentPage, currentSearch);
                                    }, 3000);
                                } else {
                                    if (os.showNotification) {
                                        os.showNotification(data.message || 'Purchase successful! You can now install the module.', 'success', 5000);
                                    }
                                    // Clear cache and refresh
                                    delete moduleAccessCache[moduleId];
                                    await loadMarketplaceModules(currentPage, currentSearch);
                                }
                                
                                // Restore button
                                buttonEl.disabled = false;
                                buttonEl.style.opacity = '1';
                                buttonEl.style.cursor = 'pointer';
                                buttonEl.innerHTML = originalHTML;
                            } else {
                                if (data.requires_login) {
                                    if (os.showNotification) {
                                        os.showNotification('Please login first to purchase modules', 'error', 5000);
                                    }
                                    openLoginModal();
                                } else {
                                    if (os.showNotification) {
                                        os.showNotification(data.error || 'Purchase failed', 'error', 5000);
                                    }
                                }
                                // Restore button
                                buttonEl.disabled = false;
                                buttonEl.style.opacity = '1';
                                buttonEl.style.cursor = 'pointer';
                                buttonEl.innerHTML = originalHTML;
                            }
                        } catch (error) {
                            if (os.showNotification) {
                                os.showNotification(`Error: ${error.message}`, 'error', 5000);
                            }
                            // Restore button
                            buttonEl.disabled = false;
                            buttonEl.style.opacity = '1';
                            buttonEl.style.cursor = 'pointer';
                            buttonEl.innerHTML = originalHTML;
                        }
                    }
                };

                const installModule = async (moduleId, buttonEl = null) => {
                    if (buttonEl) {
                        const originalHTML = buttonEl.innerHTML;
                        buttonEl.disabled = true;
                        buttonEl.style.opacity = '0.6';
                        buttonEl.style.cursor = 'not-allowed';
                        buttonEl.innerHTML = '<div style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite;"></div> <span style="margin-left: 6px;">Installing...</span>';
                        
                        try {
                            const response = await fetch(`/api/market/install/${moduleId}`, { method: 'POST' });
                            const data = await response.json();
                            
                            if (data.success) {
                                if (os.showNotification) {
                                    os.showNotification('Module installed successfully!', 'success', 3000);
                                }
                                // Refresh both lists
                                await loadInstalledModules();
                                await loadMarketplaceModules(currentPage, currentSearch);
                            } else {
                                if (os.showNotification) {
                                    os.showNotification(data.error || 'Installation failed', 'error', 5000);
                                }
                                // Restore button
                                buttonEl.disabled = false;
                                buttonEl.style.opacity = '1';
                                buttonEl.style.cursor = 'pointer';
                                buttonEl.innerHTML = originalHTML;
                            }
                        } catch (error) {
                            if (os.showNotification) {
                                os.showNotification(`Error: ${error.message}`, 'error', 5000);
                            }
                            // Restore button
                            buttonEl.disabled = false;
                            buttonEl.style.opacity = '1';
                            buttonEl.style.cursor = 'pointer';
                            buttonEl.innerHTML = originalHTML;
                        }
                    } else {
                        // Fallback if no button provided
                        try {
                            const response = await fetch(`/api/market/install/${moduleId}`, { method: 'POST' });
                            const data = await response.json();
                            
                            if (data.success) {
                                if (os.showNotification) {
                                    os.showNotification('Module installed successfully!', 'success', 3000);
                                }
                                loadInstalledModules();
                                loadMarketplaceModules(currentPage, currentSearch);
                            } else {
                                if (os.showNotification) {
                                    os.showNotification(data.error || 'Installation failed', 'error', 5000);
                                }
                            }
                        } catch (error) {
                            if (os.showNotification) {
                                os.showNotification(`Error: ${error.message}`, 'error', 5000);
                            }
                        }
                    }
                };

                const updateModule = async (moduleId, buttonEl = null) => {
                    if (buttonEl) {
                        const originalHTML = buttonEl.innerHTML;
                        buttonEl.disabled = true;
                        buttonEl.style.opacity = '0.6';
                        buttonEl.style.cursor = 'not-allowed';
                        buttonEl.innerHTML = '<div style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite;"></div> <span style="margin-left: 6px;">Updating...</span>';
                        
                        try {
                            // Update is essentially a reinstall
                            const response = await fetch(`/api/market/install/${moduleId}`, { method: 'POST' });
                            const data = await response.json();
                            
                            if (data.success) {
                                if (os.showNotification) {
                                    os.showNotification('Module updated successfully!', 'success', 3000);
                                }
                                await loadInstalledModules();
                                await loadMarketplaceModules(currentPage, currentSearch);
                            } else {
                                if (os.showNotification) {
                                    os.showNotification(data.error || 'Update failed', 'error', 5000);
                                }
                                // Restore button
                                buttonEl.disabled = false;
                                buttonEl.style.opacity = '1';
                                buttonEl.style.cursor = 'pointer';
                                buttonEl.innerHTML = originalHTML;
                            }
                        } catch (error) {
                            if (os.showNotification) {
                                os.showNotification(`Error: ${error.message}`, 'error', 5000);
                            }
                            // Restore button
                            buttonEl.disabled = false;
                            buttonEl.style.opacity = '1';
                            buttonEl.style.cursor = 'pointer';
                            buttonEl.innerHTML = originalHTML;
                        }
                    }
                };

                const uninstallModule = async (moduleId, buttonEl = null) => {
                    if (buttonEl) {
                        const originalHTML = buttonEl.innerHTML;
                        buttonEl.disabled = true;
                        buttonEl.style.opacity = '0.6';
                        buttonEl.style.cursor = 'not-allowed';
                        buttonEl.innerHTML = '<div style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite;"></div> <span style="margin-left: 6px;">Uninstalling...</span>';
                        
                        try {
                            const response = await fetch(`/api/market/uninstall/${moduleId}`, { method: 'POST' });
                            const data = await response.json();
                            
                            if (data.success) {
                                if (os.showNotification) {
                                    os.showNotification('Module uninstalled successfully!', 'success', 3000);
                                }
                                await loadInstalledModules();
                                await loadMarketplaceModules(currentPage, currentSearch);
                            } else {
                                if (os.showNotification) {
                                    os.showNotification(data.error || 'Uninstallation failed', 'error', 5000);
                                }
                                // Restore button
                                buttonEl.disabled = false;
                                buttonEl.style.opacity = '1';
                                buttonEl.style.cursor = 'pointer';
                                buttonEl.innerHTML = originalHTML;
                            }
                        } catch (error) {
                            if (os.showNotification) {
                                os.showNotification(`Error: ${error.message}`, 'error', 5000);
                            }
                            // Restore button
                            buttonEl.disabled = false;
                            buttonEl.style.opacity = '1';
                            buttonEl.style.cursor = 'pointer';
                            buttonEl.innerHTML = originalHTML;
                        }
                    } else {
                        // Fallback if no button provided
                        try {
                            const response = await fetch(`/api/market/uninstall/${moduleId}`, { method: 'POST' });
                            const data = await response.json();
                            
                            if (data.success) {
                                if (os.showNotification) {
                                    os.showNotification('Module uninstalled successfully!', 'success', 3000);
                                }
                                loadInstalledModules();
                                loadMarketplaceModules(currentPage, currentSearch);
                            } else {
                                if (os.showNotification) {
                                    os.showNotification(data.error || 'Uninstallation failed', 'error', 5000);
                                }
                            }
                        } catch (error) {
                            if (os.showNotification) {
                                os.showNotification(`Error: ${error.message}`, 'error', 5000);
                            }
                        }
                    }
                };

                const showModuleInfo = async (moduleId) => {
                    try {
                        console.log('Showing module info for:', moduleId);
                        let module = null;
                        
                        // First try to get info from marketplace API
                        try {
                            let response = await fetch(`/api/market/info/${encodeURIComponent(moduleId)}`);
                            let data = await response.json();
                            
                            if (data.success && data.module) {
                                module = data.module;
                                console.log('Module found via API:', module);
                            }
                        } catch (apiError) {
                            console.warn('API error:', apiError);
                        }
                        
                        // If not found via API, try to find in cached marketplace modules
                        if (!module && marketplaceModulesList.length > 0) {
                            module = marketplaceModulesList.find(m => {
                                const mId = m.id || m.marketplace_id || '';
                                return mId === moduleId || 
                                       mId.includes(moduleId) ||
                                       (m.name && m.name.toLowerCase().includes(moduleId.toLowerCase()));
                            });
                            if (module) {
                                console.log('Module found in marketplace cache:', module);
                            }
                        }
                        
                        // If still not found, try to find in installed modules
                        if (!module) {
                            if (installedModulesList.length > 0) {
                                module = installedModulesList.find(m => 
                                    (m.id === moduleId) || 
                                    (m.marketplace_id === moduleId) ||
                                    (m.id && m.id.includes(moduleId)) ||
                                    (m.name && m.name.toLowerCase().includes(moduleId.toLowerCase()))
                                );
                                if (module) {
                                    console.log('Module found in installed cache:', module);
                                }
                            }
                            
                            // If still not in cache, fetch installed modules
                            if (!module) {
                                try {
                                    const installedResponse = await fetch('/api/market/installed');
                                    const installedData = await installedResponse.json();
                                    
                                    if (installedData.success && installedData.modules) {
                                        module = installedData.modules.find(m => 
                                            (m.id === moduleId) || 
                                            (m.marketplace_id === moduleId) ||
                                            (m.id && m.id.includes(moduleId)) ||
                                            (m.name && m.name.toLowerCase().includes(moduleId.toLowerCase()))
                                        );
                                        if (module) {
                                            console.log('Module found in installed modules:', module);
                                        }
                                    }
                                } catch (installedError) {
                                    console.warn('Error fetching installed modules:', installedError);
                                }
                            }
                        }
                        
                        if (module) {
                            const authorStr = getAuthorString(module.author);
                            const versionStr = module.version || 'N/A';
                            const typeStr = module.extension_type || module.type || 'module';
                            const descriptionStr = module.description || 'No description available';
                            const priceStr = module.price === 0 || module.price === undefined ? 'Free' : `${module.price} ${module.currency || 'USD'}`;
                            const nameStr = module.name || moduleId || 'Unknown';
                            
                            os.wm.createWindow({
                                title: `Module: ${nameStr}`,
                                icon: 'information-circle-outline',
                                width: '600px',
                                height: '500px',
                                content: `
                                    <div style="padding: 20px; background: #0d1117; color: #c9d1d9; font-family: 'Outfit', sans-serif; line-height: 1.6;">
                                        <h3 style="color: #ffa500; margin-top: 0; font-size: 20px;">${escapeHtml(nameStr)}</h3>
                                        <p style="color: #8b949e; margin-bottom: 20px; font-size: 14px;">${escapeHtml(descriptionStr)}</p>
                                        <div style="margin-top: 20px; border-top: 1px solid #30363d; padding-top: 20px;">
                                            <p style="margin: 10px 0;"><strong style="color: #58a6ff;">Version:</strong> <span style="color: #c9d1d9;">${escapeHtml(versionStr)}</span></p>
                                            <p style="margin: 10px 0;"><strong style="color: #58a6ff;">Author:</strong> <span style="color: #c9d1d9;">${escapeHtml(authorStr)}</span></p>
                                            <p style="margin: 10px 0;"><strong style="color: #58a6ff;">Type:</strong> <span style="color: #c9d1d9;">${escapeHtml(typeStr)}</span></p>
                                            <p style="margin: 10px 0;"><strong style="color: #58a6ff;">Price:</strong> <span style="color: #c9d1d9;">${escapeHtml(priceStr)}</span></p>
                                            ${module.license ? `<p style="margin: 10px 0;"><strong style="color: #58a6ff;">License:</strong> <span style="color: #c9d1d9;">${escapeHtml(module.license)}</span></p>` : ''}
                                            ${module.compatibility ? `<p style="margin: 10px 0;"><strong style="color: #58a6ff;">Compatibility:</strong> <span style="color: #c9d1d9;">KittySploit ${module.compatibility.kittysploit_min || 'N/A'} - ${module.compatibility.kittysploit_max || 'N/A'}</span></p>` : ''}
                                            ${module.path ? `<p style="margin: 10px 0;"><strong style="color: #58a6ff;">Path:</strong> <span style="color: #8b949e; font-size: 12px; font-family: monospace;">${escapeHtml(module.path)}</span></p>` : ''}
                                        </div>
                                    </div>
                                `
                            });
                        } else {
                            console.error('Module not found:', moduleId);
                            if (os.showNotification) {
                                os.showNotification(`Module "${moduleId}" not found`, 'error', 5000);
                            }
                        }
                    } catch (error) {
                        console.error('Error showing module info:', error);
                        if (os.showNotification) {
                            os.showNotification(`Error: ${error.message}`, 'error', 5000);
                        }
                    }
                };

                function updatePagination(page, total, limit) {
                    const paginationEl = document.querySelector(`#${wId} #marketplace-pagination`);
                    const pageInfoEl = document.querySelector(`#${wId} #marketplace-page-info`);
                    const prevBtn = document.querySelector(`#${wId} #marketplace-prev-page`);
                    const nextBtn = document.querySelector(`#${wId} #marketplace-next-page`);
                    
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

                function escapeHtml(text) {
                    const div = document.createElement('div');
                    div.textContent = text;
                    return div.innerHTML;
                }

                // Check auth status
                async function checkAuthStatus() {
                    try {
                        const response = await fetch('/api/market/status');
                        const data = await response.json();
                        
                        if (data.success) {
                            if (data.logged_in && data.account) {
                                if (accountInfo) accountInfo.textContent = `Logged in as ${data.account.username || data.account.email}`;
                                if (loginBtn) loginBtn.style.display = 'none';
                                if (logoutBtn) logoutBtn.style.display = 'block';
                            } else {
                                if (accountInfo) accountInfo.textContent = 'Not logged in';
                                if (loginBtn) loginBtn.style.display = 'block';
                                if (logoutBtn) logoutBtn.style.display = 'none';
                            }
                        }
                    } catch (error) {
                        console.error('Error checking auth status:', error);
                        // On error, assume not logged in
                        if (accountInfo) accountInfo.textContent = 'Not logged in';
                        if (loginBtn) loginBtn.style.display = 'block';
                        if (logoutBtn) logoutBtn.style.display = 'none';
                    }
                }

                // Event listeners
                refreshBtn.addEventListener('click', () => {
                    if (installedTab.classList.contains('active')) {
                        loadInstalledModules();
                    } else {
                        loadMarketplaceModules(currentPage, currentSearch);
                    }
                });

                document.querySelector(`#${wId} #marketplace-search-btn`).addEventListener('click', () => {
                    currentSearch = document.querySelector(`#${wId} #marketplace-search-input`).value;
                    currentPage = 1;
                    loadMarketplaceModules(currentPage, currentSearch);
                });

                document.querySelector(`#${wId} #marketplace-search-input`).addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        currentSearch = e.target.value;
                        currentPage = 1;
                        loadMarketplaceModules(currentPage, currentSearch);
                    }
                });

                // Modal management functions
                function openLoginModal() {
                    console.log('openLoginModal called');
                    // Try multiple selectors to find the modal
                    let modal = document.querySelector(`#${wId} #marketplace-login-modal`);
                    if (!modal) {
                        modal = document.querySelector(`#marketplace-login-modal`);
                    }
                    if (!modal) {
                        const windowEl = document.getElementById(wId);
                        if (windowEl) {
                            modal = windowEl.querySelector('#marketplace-login-modal');
                        }
                    }
                    if (modal) {
                        console.log('Modal found, opening...');
                        modal.classList.add('active');
                        modal.style.setProperty('z-index', '10000', 'important');
                        // Reset forms
                        const loginForm = document.querySelector(`#${wId} #marketplace-login-form`) || modal.querySelector('#marketplace-login-form');
                        const registerForm = document.querySelector(`#${wId} #marketplace-register-form`) || modal.querySelector('#marketplace-register-form');
                        if (loginForm) loginForm.style.display = 'block';
                        if (registerForm) registerForm.style.display = 'none';
                        const emailInput = document.querySelector(`#${wId} #marketplace-login-email`) || modal.querySelector('#marketplace-login-email');
                        const passwordInput = document.querySelector(`#${wId} #marketplace-login-password`) || modal.querySelector('#marketplace-login-password');
                        if (emailInput) emailInput.value = '';
                        if (passwordInput) passwordInput.value = '';
                        const registerEmail = document.querySelector(`#${wId} #marketplace-register-email`) || modal.querySelector('#marketplace-register-email');
                        const registerUsername = document.querySelector(`#${wId} #marketplace-register-username`) || modal.querySelector('#marketplace-register-username');
                        const registerPassword = document.querySelector(`#${wId} #marketplace-register-password`) || modal.querySelector('#marketplace-register-password');
                        const registerPasswordConfirm = document.querySelector(`#${wId} #marketplace-register-password-confirm`) || modal.querySelector('#marketplace-register-password-confirm');
                        if (registerEmail) registerEmail.value = '';
                        if (registerUsername) registerUsername.value = '';
                        if (registerPassword) registerPassword.value = '';
                        if (registerPasswordConfirm) registerPasswordConfirm.value = '';
                        const authMessage = document.querySelector(`#${wId} #marketplace-auth-message`) || modal.querySelector('#marketplace-auth-message');
                        if (authMessage) {
                            authMessage.style.display = 'none';
                            authMessage.textContent = '';
                        }
                        // Focus on email input
                        setTimeout(() => {
                            if (emailInput) emailInput.focus();
                        }, 100);
                    } else {
                        console.warn('Modal not found for opening');
                    }
                }

                function closeLoginModal() {
                    // Try multiple selectors to find the modal
                    let modal = document.querySelector(`#${wId} #marketplace-login-modal`);
                    if (!modal) {
                        modal = document.querySelector(`#marketplace-login-modal`);
                    }
                    if (!modal) {
                        // Try finding by class within the window
                        const windowEl = document.getElementById(wId);
                        if (windowEl) {
                            modal = windowEl.querySelector('#marketplace-login-modal');
                        }
                    }
                    if (modal) {
                        // Remove active class to hide modal
                        modal.classList.remove('active');
                        console.log('Modal closed successfully');
                    } else {
                        console.warn('Modal not found for closing');
                        // Last resort: try to find all modals and close them
                        const allModals = document.querySelectorAll('.marketplace-modal, [id*="marketplace-login-modal"]');
                        allModals.forEach(m => {
                            m.classList.remove('active');
                        });
                        console.log(`Closed ${allModals.length} modals as fallback`);
                    }
                }

                function showAuthMessage(message, type) {
                    const messageEl = document.querySelector(`#${wId} #marketplace-auth-message`);
                    if (messageEl) {
                        messageEl.textContent = message;
                        messageEl.style.display = 'block';
                        messageEl.style.background = type === 'success' ? '#238636' : '#da3633';
                        messageEl.style.color = '#fff';
                    }
                }

                // Login handler
                async function handleLogin() {
                    // Get inputs with fallback selectors
                    let emailInput = document.querySelector(`#${wId} #marketplace-login-email`);
                    let passwordInput = document.querySelector(`#${wId} #marketplace-login-password`);
                    if (!emailInput) {
                        emailInput = document.querySelector('#marketplace-login-email');
                    }
                    if (!passwordInput) {
                        passwordInput = document.querySelector('#marketplace-login-password');
                    }
                    
                    const email = emailInput ? emailInput.value.trim() : '';
                    const password = passwordInput ? passwordInput.value : '';
                    
                    if (!email || !password) {
                        showAuthMessage('Please enter email and password', 'error');
                        return;
                    }
                    
                    try {
                        const response = await fetch('/api/market/login', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email, password })
                        });
                        const data = await response.json();
                        
                        if (data.success) {
                            // Close modal immediately on success - try multiple times to ensure it closes
                            closeLoginModal();
                            // Force close again after a tiny delay
                            setTimeout(() => {
                                closeLoginModal();
                            }, 10);
                            // Update auth status and refresh modules
                            await checkAuthStatus();
                            await loadMarketplaceModules(currentPage, currentSearch);
                            // Show success notification
                            if (os && os.showNotification) {
                                os.showNotification('Login successful!', 'success', 3000);
                            }
                        } else {
                            showAuthMessage(data.error || 'Login failed', 'error');
                        }
                    } catch (error) {
                        showAuthMessage('Error connecting to server', 'error');
                        console.error('Login error:', error);
                    }
                }

                // Register handler
                async function handleRegister() {
                    const email = document.querySelector(`#${wId} #marketplace-register-email`).value.trim();
                    const username = document.querySelector(`#${wId} #marketplace-register-username`).value.trim();
                    const password = document.querySelector(`#${wId} #marketplace-register-password`).value;
                    const passwordConfirm = document.querySelector(`#${wId} #marketplace-register-password-confirm`).value;
                    
                    if (!email || !username || !password || !passwordConfirm) {
                        showAuthMessage('Please fill all fields', 'error');
                        return;
                    }
                    
                    if (password !== passwordConfirm) {
                        showAuthMessage('Passwords do not match', 'error');
                        return;
                    }
                    
                    try {
                        const response = await fetch('/api/market/register', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email, username, password, password_confirm: passwordConfirm })
                        });
                        const data = await response.json();
                        
                        if (data.success) {
                            showAuthMessage('Registration successful! Please login.', 'success');
                            setTimeout(() => {
                                document.querySelector(`#${wId} #marketplace-register-form`).style.display = 'none';
                                document.querySelector(`#${wId} #marketplace-login-form`).style.display = 'block';
                            }, 1500);
                        } else {
                            showAuthMessage(data.error || 'Registration failed', 'error');
                        }
                    } catch (error) {
                        showAuthMessage('Error connecting to server', 'error');
                        console.error('Register error:', error);
                    }
                }

                // Event listeners for modal
                if (loginBtn) {
                    loginBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('Login button clicked');
                        openLoginModal();
                    });
                    console.log('Login button event listener attached');
                } else {
                    console.warn('Login button not found, trying alternative selector...');
                    // Try to find button again after a delay
                    setTimeout(() => {
                        let retryBtn = document.querySelector(`#${wId} #marketplace-login-btn`) || 
                                      document.getElementById('marketplace-login-btn');
                        if (retryBtn) {
                            retryBtn.addEventListener('click', (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                console.log('Login button clicked (retry)');
                                openLoginModal();
                            });
                            console.log('Login button event listener attached (retry)');
                        }
                    }, 500);
                }
                
                const modalCloseBtn = document.querySelector(`#${wId} #marketplace-modal-close`);
                if (modalCloseBtn) {
                    modalCloseBtn.addEventListener('click', closeLoginModal);
                }
                
                // Close modal when clicking outside
                const modal = document.querySelector(`#${wId} #marketplace-login-modal`);
                if (modal) {
                    modal.addEventListener('click', (e) => {
                        if (e.target === modal) {
                            closeLoginModal();
                        }
                    });
                }
                
                // Login form handlers
                const loginSubmitBtn = document.querySelector(`#${wId} #marketplace-login-submit`);
                if (loginSubmitBtn) {
                    loginSubmitBtn.addEventListener('click', handleLogin);
                }
                
                // Allow Enter key to submit login
                const loginEmailInput = document.querySelector(`#${wId} #marketplace-login-email`);
                const loginPasswordInput = document.querySelector(`#${wId} #marketplace-login-password`);
                if (loginEmailInput && loginPasswordInput) {
                    loginPasswordInput.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') {
                            handleLogin();
                        }
                    });
                    loginEmailInput.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') {
                            loginPasswordInput.focus();
                        }
                    });
                }
                
                // Register form handlers
                const registerSubmitBtn = document.querySelector(`#${wId} #marketplace-register-submit`);
                if (registerSubmitBtn) {
                    registerSubmitBtn.addEventListener('click', handleRegister);
                }
                
                // Switch between login and register forms
                const showRegisterBtn = document.querySelector(`#${wId} #marketplace-show-register`);
                if (showRegisterBtn) {
                    showRegisterBtn.addEventListener('click', () => {
                        document.querySelector(`#${wId} #marketplace-login-form`).style.display = 'none';
                        document.querySelector(`#${wId} #marketplace-register-form`).style.display = 'block';
                        document.querySelector(`#${wId} #marketplace-auth-message`).style.display = 'none';
                    });
                }
                
                const showLoginBtn = document.querySelector(`#${wId} #marketplace-show-login`);
                if (showLoginBtn) {
                    showLoginBtn.addEventListener('click', () => {
                        document.querySelector(`#${wId} #marketplace-register-form`).style.display = 'none';
                        document.querySelector(`#${wId} #marketplace-login-form`).style.display = 'block';
                        document.querySelector(`#${wId} #marketplace-auth-message`).style.display = 'none';
                    });
                }

                logoutBtn.addEventListener('click', async () => {
                    if (!logoutBtn) return;
                    
                    // Disable button during logout
                    const originalHTML = logoutBtn.innerHTML;
                    logoutBtn.disabled = true;
                    logoutBtn.style.opacity = '0.6';
                    logoutBtn.innerHTML = 'Logging out...';
                    
                    try {
                        const response = await fetch('/api/market/logout', { method: 'POST' });
                        const data = await response.json();
                        
                        if (data.success) {
                            if (os.showNotification) {
                                os.showNotification('Logged out successfully', 'success', 3000);
                            }
                            // Clear local cache
                            installedModulesList = [];
                            
                            // Small delay to ensure config file is updated
                            await new Promise(resolve => setTimeout(resolve, 200));
                            
                            // Refresh auth status and modules
                            await checkAuthStatus();
                            await loadMarketplaceModules(currentPage, currentSearch);
                            
                            // Restore button
                            logoutBtn.disabled = false;
                            logoutBtn.style.opacity = '1';
                            logoutBtn.innerHTML = originalHTML;
                        } else {
                            if (os.showNotification) {
                                os.showNotification(data.error || 'Logout failed', 'error', 5000);
                            }
                            // Restore button on error
                            logoutBtn.disabled = false;
                            logoutBtn.style.opacity = '1';
                            logoutBtn.innerHTML = originalHTML;
                        }
                    } catch (error) {
                        if (os.showNotification) {
                            os.showNotification(`Error: ${error.message}`, 'error', 5000);
                        }
                        // Restore button on error
                        logoutBtn.disabled = false;
                        logoutBtn.style.opacity = '1';
                        logoutBtn.innerHTML = originalHTML;
                    }
                });

                // Uninstall modal management
                let pendingUninstall = null; // Store moduleId and button for uninstall
                
                function openUninstallModal(moduleId, moduleName, buttonEl) {
                    pendingUninstall = { moduleId, buttonEl };
                    const modal = document.querySelector(`#${wId} #marketplace-uninstall-modal`) || 
                                 document.getElementById('marketplace-uninstall-modal');
                    const moduleNameEl = document.querySelector(`#${wId} #marketplace-uninstall-module-name`) || 
                                        (modal ? modal.querySelector('#marketplace-uninstall-module-name') : null);
                    
                    if (modal) {
                        if (moduleNameEl) {
                            moduleNameEl.textContent = moduleName;
                        }
                        modal.classList.add('active');
                    }
                }
                
                function closeUninstallModal() {
                    const modal = document.querySelector(`#${wId} #marketplace-uninstall-modal`) || 
                                 document.getElementById('marketplace-uninstall-modal');
                    if (modal) {
                        modal.classList.remove('active');
                    }
                    pendingUninstall = null;
                }
                
                // Event listeners for uninstall modal
                const uninstallModal = document.querySelector(`#${wId} #marketplace-uninstall-modal`) || 
                                     document.getElementById('marketplace-uninstall-modal');
                if (uninstallModal) {
                    // Close button
                    const uninstallCloseBtn = document.querySelector(`#${wId} #marketplace-uninstall-modal-close`) || 
                                             uninstallModal.querySelector('#marketplace-uninstall-modal-close');
                    if (uninstallCloseBtn) {
                        uninstallCloseBtn.addEventListener('click', closeUninstallModal);
                    }
                    
                    // Cancel button
                    const uninstallCancelBtn = document.querySelector(`#${wId} #marketplace-uninstall-cancel`) || 
                                              uninstallModal.querySelector('#marketplace-uninstall-cancel');
                    if (uninstallCancelBtn) {
                        uninstallCancelBtn.addEventListener('click', closeUninstallModal);
                    }
                    
                    // Confirm button
                    const uninstallConfirmBtn = document.querySelector(`#${wId} #marketplace-uninstall-confirm`) || 
                                               uninstallModal.querySelector('#marketplace-uninstall-confirm');
                    if (uninstallConfirmBtn) {
                        uninstallConfirmBtn.addEventListener('click', async () => {
                            if (pendingUninstall) {
                                const { moduleId, buttonEl } = pendingUninstall;
                                closeUninstallModal();
                                await uninstallModule(moduleId, buttonEl);
                            }
                        });
                    }
                    
                    // Close when clicking outside
                    uninstallModal.addEventListener('click', (e) => {
                        if (e.target === uninstallModal) {
                            closeUninstallModal();
                        }
                    });
                }
                
                // Ensure modals are hidden on initial load
                const initialLoginModal = document.querySelector(`#${wId} #marketplace-login-modal`) || 
                                         document.getElementById('marketplace-login-modal');
                if (initialLoginModal) {
                    initialLoginModal.classList.remove('active');
                }
                
                const initialUninstallModal = document.querySelector(`#${wId} #marketplace-uninstall-modal`) || 
                                             document.getElementById('marketplace-uninstall-modal');
                if (initialUninstallModal) {
                    initialUninstallModal.classList.remove('active');
                }
                
                // Initial load
                checkAuthStatus();
                loadInstalledModules();
            }
        });
        return winId;
    }

    spawnNotes() {
        this.wm.createWindow({
            title: 'Notes',
            icon: 'document-text-outline',
            appId: 'notes',
            width: '760px',
            height: '560px',
            top: '90px',
            left: '140px',
            content: `
                <div class="notes-app-root" style="display:flex;height:100%;background:#0d1117;color:#c9d1d9;font-family:'Segoe UI',sans-serif;">
                    <div style="width:230px;border-right:1px solid #30363d;display:flex;flex-direction:column;background:#161b22;">
                        <div style="padding:12px;border-bottom:1px solid #30363d;">
                            <button type="button" class="notes-btn-new" style="width:100%;padding:8px;background:#238636;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:12px;font-weight:600;">New note</button>
                        </div>
                        <div class="notes-sidebar" style="flex:1;overflow-y:auto;padding:6px;"></div>
                    </div>
                    <div style="flex:1;display:flex;flex-direction:column;min-width:0;">
                        <div style="padding:10px 14px;border-bottom:1px solid #30363d;">
                            <input type="text" class="notes-title" placeholder="Title" style="width:100%;padding:8px;background:rgba(255,255,255,0.05);border:1px solid #30363d;border-radius:4px;color:#e6edf3;font-size:14px;box-sizing:border-box;">
                        </div>
                        <textarea class="notes-body" placeholder="Write your notes here…" style="flex:1;width:100%;padding:14px;background:#0d1117;border:none;color:#c9d1d9;font-size:13px;line-height:1.5;resize:none;box-sizing:border-box;outline:none;"></textarea>
                        <div style="padding:8px 12px;border-top:1px solid #30363d;font-size:11px;color:#8b949e;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                            <span>Saved in the browser (localStorage)</span>
                            <button type="button" class="notes-btn-del" style="padding:6px 10px;background:transparent;border:1px solid #f85149;color:#f85149;border-radius:4px;cursor:pointer;font-size:12px;">Delete</button>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const content = document.getElementById(`${wId}-content`);
                if (!content) return;
                const root = content.querySelector('.notes-app-root');
                if (!root) return;
                const STORAGE = 'kittyos.notes.v1';
                let state = { version: 1, items: [] };
                let currentId = null;
                const sidebar = root.querySelector('.notes-sidebar');
                const titleEl = root.querySelector('.notes-title');
                const bodyEl = root.querySelector('.notes-body');

                const load = () => {
                    try {
                        const raw = localStorage.getItem(STORAGE);
                        if (raw) {
                            const parsed = JSON.parse(raw);
                            if (parsed && Array.isArray(parsed.items)) state = parsed;
                        }
                    } catch (e) {
                        state = { version: 1, items: [] };
                    }
                };

                const save = () => {
                    try {
                        localStorage.setItem(STORAGE, JSON.stringify(state));
                    } catch (e) { /* ignore */ }
                };

                /** Always keep at least one note so the editor is never orphaned. */
                const ensureAtLeastOneNote = () => {
                    if (state.items.length > 0) return;
                    const id = 'n_' + Math.random().toString(36).slice(2, 12);
                    state.items = [{ id, title: 'New note', body: '', updatedAt: Date.now() }];
                    save();
                };

                const escapeHtml = (s) => String(s || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');

                const renderList = () => {
                    ensureAtLeastOneNote();
                    sidebar.innerHTML = state.items.map((n) => {
                        const active = n.id === currentId
                            ? 'background:rgba(88,166,255,0.12);border-color:#58a6ff;color:#58a6ff;'
                            : '';
                        const t = escapeHtml((n.title || 'Untitled').slice(0, 80));
                        const when = n.updatedAt ? new Date(n.updatedAt).toLocaleString() : '';
                        return `<button type="button" class="notes-row" data-id="${escapeHtml(n.id)}" style="width:100%;text-align:left;padding:8px 10px;margin-bottom:4px;border:1px solid #30363d;border-radius:6px;background:rgba(255,255,255,0.03);color:#c9d1d9;cursor:pointer;font-size:12px;${active}">
                            <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t}</div>
                            <div style="font-size:10px;color:#8b949e;margin-top:2px;">${escapeHtml(when)}</div>
                        </button>`;
                    }).join('');
                    sidebar.querySelectorAll('.notes-row').forEach((btn) => {
                        btn.onclick = () => selectNote(btn.getAttribute('data-id'));
                    });
                };

                const selectNote = (id) => {
                    currentId = id;
                    const n = state.items.find((x) => x.id === id);
                    if (!n) return;
                    titleEl.value = n.title || '';
                    bodyEl.value = n.body || '';
                    renderList();
                };

                const flushCurrent = () => {
                    if (!currentId) return;
                    const n = state.items.find((x) => x.id === currentId);
                    if (!n) return;
                    n.title = titleEl.value.trim() || 'Untitled';
                    n.body = bodyEl.value;
                    n.updatedAt = Date.now();
                    save();
                    renderList();
                };

                let debounce;
                const scheduleSave = () => {
                    clearTimeout(debounce);
                    debounce = setTimeout(() => flushCurrent(), 400);
                };

                titleEl.addEventListener('input', scheduleSave);
                bodyEl.addEventListener('input', scheduleSave);

                root.querySelector('.notes-btn-new').onclick = () => {
                    flushCurrent();
                    const id = 'n_' + Math.random().toString(36).slice(2, 12);
                    state.items.unshift({ id, title: 'New note', body: '', updatedAt: Date.now() });
                    save();
                    currentId = id;
                    titleEl.value = 'New note';
                    bodyEl.value = '';
                    renderList();
                    titleEl.focus();
                };

                root.querySelector('.notes-btn-del').onclick = () => {
                    if (!currentId) return;
                    if (state.items.length <= 1) {
                        if (!confirm('Clear this note? You will get a fresh empty note.')) return;
                        const n = state.items.find((x) => x.id === currentId);
                        if (n) {
                            n.title = 'New note';
                            n.body = '';
                            n.updatedAt = Date.now();
                            save();
                            titleEl.value = 'New note';
                            bodyEl.value = '';
                            renderList();
                        }
                        return;
                    }
                    if (!confirm('Delete this note?')) return;
                    state.items = state.items.filter((x) => x.id !== currentId);
                    ensureAtLeastOneNote();
                    currentId = state.items[0].id;
                    selectNote(currentId);
                    save();
                };

                load();
                ensureAtLeastOneNote();
                currentId = state.items[0].id;
                selectNote(currentId);
            }
        });
    }

    spawnAgentLauncher() {
        this.wm.createWindow({
            title: 'Agent Launcher',
            icon: 'hardware-chip-outline',
            appId: 'agent_launcher',
            width: '680px',
            height: '620px',
            top: '70px',
            left: '160px',
            content: `
                <div class="agent-launcher-root" style="display:flex;flex-direction:column;height:100%;background:#0d1117;color:#c9d1d9;font-family:'Segoe UI',sans-serif;padding:16px;box-sizing:border-box;gap:12px;">
                    <p style="margin:0;font-size:12px;color:#8b949e;line-height:1.5;">
                        Runs the console <strong style="color:#58a6ff;">agent</strong> command against a target (same as <code style="background:#161b22;padding:2px 6px;border-radius:4px;">agent &lt;target&gt; …</code>).
                        The target must not contain spaces (e.g. <code style="background:#161b22;padding:2px 6px;border-radius:4px;">https://example.com</code> or <code style="background:#161b22;padding:2px 6px;border-radius:4px;">192.168.1.5</code>).
                    </p>
                    <label style="font-size:12px;color:#c9d1d9;">Target <span style="color:#f85149">*</span></label>
                    <input type="text" class="agent-target" placeholder="https://example.com or 10.0.0.5" style="width:100%;padding:10px;background:rgba(255,255,255,0.05);border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:13px;box-sizing:border-box;">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div>
                            <label style="font-size:12px;color:#8b949e;">Threads</label>
                            <input type="number" class="agent-threads" value="5" min="1" max="64" style="width:100%;margin-top:4px;padding:8px;background:rgba(255,255,255,0.05);border:1px solid #30363d;border-radius:6px;color:#e6edf3;box-sizing:border-box;">
                        </div>
                        <div>
                            <label style="font-size:12px;color:#8b949e;">Protocol</label>
                            <select class="agent-protocol" style="width:100%;margin-top:4px;padding:8px;background:rgba(255,255,255,0.05);border:1px solid #30363d;border-radius:6px;color:#e6edf3;">
                                <option value="">Auto</option>
                                <option value="http">http</option>
                                <option value="https">https</option>
                            </select>
                        </div>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:#c9d1d9;">
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" class="agent-no-exploit"> Recon only (--no-exploit)</label>
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" class="agent-verbose"> Verbose (-v)</label>
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" class="agent-llm"> Local LLM (--llm-local)</label>
                    </div>
                    <button type="button" class="agent-run-btn" style="padding:10px 16px;background:#238636;border:none;border-radius:6px;color:#fff;font-weight:600;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:8px;width:fit-content;">
                        <ion-icon name="play-outline"></ion-icon> Run agent
                    </button>
                    <div style="flex:1;min-height:120px;display:flex;flex-direction:column;border:1px solid #30363d;border-radius:6px;overflow:hidden;background:#010409;">
                        <div style="padding:6px 10px;border-bottom:1px solid #30363d;font-size:11px;color:#8b949e;">Output</div>
                        <pre class="agent-output" style="flex:1;margin:0;padding:12px;overflow:auto;font-size:12px;line-height:1.45;color:#c9d1d9;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;"></pre>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const content = document.getElementById(`${wId}-content`);
                if (!content) return;
                const root = content.querySelector('.agent-launcher-root');
                if (!root) return;
                const out = root.querySelector('.agent-output');
                const run = async () => {
                    const target = (root.querySelector('.agent-target').value || '').trim();
                    if (!target || /\s/.test(target)) {
                        out.textContent = 'Enter a valid target with no spaces.';
                        return;
                    }
                    const threads = parseInt(root.querySelector('.agent-threads').value, 10) || 5;
                    const protocol = (root.querySelector('.agent-protocol').value || '').trim();
                    const noExploit = root.querySelector('.agent-no-exploit').checked;
                    const verbose = root.querySelector('.agent-verbose').checked;
                    const llm = root.querySelector('.agent-llm').checked;
                    const parts = ['agent', target, '--threads', String(Math.max(1, Math.min(64, threads)))];
                    if (protocol) parts.push('--protocol', protocol);
                    if (noExploit) parts.push('--no-exploit');
                    if (verbose) parts.push('--verbose');
                    if (llm) parts.push('--llm-local');
                    const command = parts.join(' ');
                    out.textContent = 'Running…\n> ' + command + '\n';
                    try {
                        const res = await fetch('/api/terminal/exec', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ command })
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                            out.textContent += (data.error || ('HTTP ' + res.status)) + '\n';
                            return;
                        }
                        out.textContent += (data.output || '') + '\n';
                        if (data.success === false && data.error) {
                            out.textContent += data.error + '\n';
                        }
                    } catch (e) {
                        out.textContent += 'Network error: ' + e + '\n';
                    }
                };
                root.querySelector('.agent-run-btn').onclick = run;
            }
        });
    }

    spawnScanner() {
        const winId = this.wm.createWindow({
            title: 'Scanner',
            icon: 'scan-outline',
            width: '1400px',
            height: '900px',
            content: `
                <div style="display: flex; height: 100%; background: #0d1117; color: #c9d1d9; font-family: 'Segoe UI', sans-serif;">
                    <!-- Left Panel: Configuration -->
                    <div style="width: 400px; border-right: 1px solid #30363d; display: flex; flex-direction: column; background: #161b22; overflow-y: auto;">
                        <div style="padding: 20px; border-bottom: 1px solid #30363d;">
                            <h3 style="margin: 0 0 15px 0; font-size: 18px; color: #58a6ff;">Scanner Configuration</h3>
                            <p style="margin: 0; font-size: 12px; color: #8b949e;">Configure and launch vulnerability scans</p>
                        </div>
                        
                        <div style="padding: 20px; flex: 1; overflow-y: auto;">
                            <!-- Target URL -->
                            <div style="margin-bottom: 20px;">
                                <label style="display: block; font-size: 13px; color: #c9d1d9; margin-bottom: 8px; font-weight: 500;">
                                    Target URL <span style="color: #f85149;">*</span>
                                </label>
                                <input type="text" id="scanner-url" placeholder="https://example.com or 192.168.1.1:8080" 
                                    style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; box-sizing: border-box;">
                                <div style="font-size: 11px; color: #8b949e; margin-top: 5px;">URL, hostname, or hostname:port</div>
                            </div>
                            
                            <!-- Port Override -->
                            <div style="margin-bottom: 20px;">
                                <label style="display: block; font-size: 13px; color: #c9d1d9; margin-bottom: 8px; font-weight: 500;">Port Override</label>
                                <input type="number" id="scanner-port" placeholder="Leave empty to auto-detect" 
                                    style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; box-sizing: border-box;">
                            </div>
                            
                            <!-- Protocol Filter -->
                            <div style="margin-bottom: 20px;">
                                <label style="display: block; font-size: 13px; color: #c9d1d9; margin-bottom: 8px; font-weight: 500;">Protocol Filter</label>
                                <select id="scanner-protocol" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; box-sizing: border-box;">
                                    <option value="">All Protocols</option>
                                    <option value="http">HTTP</option>
                                    <option value="https">HTTPS</option>
                                    <option value="ftp">FTP</option>
                                    <option value="ssh">SSH</option>
                                    <option value="smtp">SMTP</option>
                                    <option value="telnet">Telnet</option>
                                </select>
                            </div>
                            
                            <!-- Tags Filter -->
                            <div style="margin-bottom: 20px;">
                                <label style="display: block; font-size: 13px; color: #c9d1d9; margin-bottom: 8px; font-weight: 500;">Tags Filter</label>
                                <input type="text" id="scanner-tags" placeholder="ssh,apache (comma-separated)" 
                                    style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; box-sizing: border-box;">
                            </div>
                            
                            <!-- Module Filter -->
                            <div style="margin-bottom: 20px;">
                                <label style="display: block; font-size: 13px; color: #c9d1d9; margin-bottom: 8px; font-weight: 500;">Specific Module</label>
                                <input type="text" id="scanner-module" placeholder="http/apache_version_check" 
                                    style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; box-sizing: border-box;">
                            </div>
                            
                            <!-- Threads -->
                            <div style="margin-bottom: 20px;">
                                <label style="display: block; font-size: 13px; color: #c9d1d9; margin-bottom: 8px; font-weight: 500;">Threads</label>
                                <input type="number" id="scanner-threads" value="5" min="1" max="50" 
                                    style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 13px; outline: none; box-sizing: border-box;">
                            </div>
                            
                            <!-- Options -->
                            <div style="margin-bottom: 20px;">
                                <label style="display: block; font-size: 13px; color: #c9d1d9; margin-bottom: 10px; font-weight: 500;">Options</label>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer;">
                                        <input type="checkbox" id="scanner-scan-ports" checked style="cursor: pointer;">
                                        <span>Auto-scan ports</span>
                                    </label>
                                    <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer;">
                                        <input type="checkbox" id="scanner-auto-exploit" style="cursor: pointer;">
                                        <span>Auto-exploit after detection</span>
                                    </label>
                                    <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer;">
                                        <input type="checkbox" id="scanner-verbose" style="cursor: pointer;">
                                        <span>Verbose output</span>
                                    </label>
                                    <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer;">
                                        <input type="checkbox" id="scanner-no-cache" style="cursor: pointer;">
                                        <span>Disable cache</span>
                                    </label>
                                </div>
                            </div>
                            
                            <!-- Action Buttons -->
                            <div style="display: flex; gap: 10px; margin-top: 20px;">
                                <button id="scanner-start-btn" style="flex: 1; padding: 12px; background: #238636; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; font-weight: 500;">
                                    Start Scan
                                </button>
                                <button id="scanner-list-btn" style="flex: 1; padding: 12px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; cursor: pointer; font-size: 13px;">
                                    List Modules
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Right Panel: Output Terminal -->
                    <div style="flex: 1; display: flex; flex-direction: column; background: #0d1117;">
                        <div style="padding: 15px; border-bottom: 1px solid #30363d; display: flex; align-items: center; justify-content: space-between;">
                            <h3 style="margin: 0; font-size: 16px; color: #58a6ff;">Scan Output</h3>
                            <button id="scanner-clear-btn" style="padding: 6px 12px; background: rgba(255,255,255,0.05); border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; cursor: pointer; font-size: 12px;">
                                Clear
                            </button>
                        </div>
                        <div id="scanner-output" style="flex: 1; overflow-y: auto; padding: 15px; font-family: 'Consolas', 'Monaco', monospace; font-size: 12px; line-height: 1.6; color: #c9d1d9; white-space: pre-wrap; word-wrap: break-word;">
                            <div style="color: #8b949e;">Ready to scan. Configure options and click "Start Scan".</div>
                        </div>
                    </div>
                </div>
            `,
            onLoad: (wId) => {
                const outputDiv = document.querySelector(`#${wId} #scanner-output`);
                const startBtn = document.querySelector(`#${wId} #scanner-start-btn`);
                const listBtn = document.querySelector(`#${wId} #scanner-list-btn`);
                const clearBtn = document.querySelector(`#${wId} #scanner-clear-btn`);
                
                let isScanning = false;
                
                // Function to strip ANSI escape codes
                const stripAnsi = (text) => {
                    if (!text) return text;
                    // Remove ANSI escape sequences
                    // Handles cases like [[32m+[0m] which should become [+]
                    // Order matters: handle special cases first
                    return String(text)
                        .replace(/\x1b\[[0-9;]*m/g, '')           // Standard ANSI codes with \x1b[ prefix
                        .replace(/\[\[([0-9;]+)m/g, '[')          // Double bracket like [[32m -> [ (must be before single bracket)
                        .replace(/\[([0-9;]+)m\]/g, ']')          // Pattern like [0m] -> ] (must be before single bracket)
                        .replace(/\[([0-9;]+)m/g, '')             // Single bracket like [32m, [0m (general case)
                        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')    // Other ANSI codes with \x1b
                        .replace(/\[[0-9;]*[a-zA-Z]/g, '');       // Other codes without \x1b
                };
                
                const appendOutput = (text, color = '#c9d1d9') => {
                    // Strip ANSI codes before displaying
                    text = stripAnsi(text);
                    const div = document.createElement('div');
                    div.style.color = color;
                    div.textContent = text;
                    outputDiv.appendChild(div);
                    outputDiv.scrollTop = outputDiv.scrollHeight;
                };
                
                const clearOutput = () => {
                    outputDiv.innerHTML = '';
                };
                
                const buildScannerCommand = () => {
                    const url = document.querySelector(`#${wId} #scanner-url`).value.trim();
                    if (!url) {
                        appendOutput('Error: Target URL is required', '#f85149');
                        return null;
                    }
                    
                    const args = ['-u', url];
                    
                    const port = document.querySelector(`#${wId} #scanner-port`).value.trim();
                    if (port) {
                        args.push('--port', port);
                    }
                    
                    const protocol = document.querySelector(`#${wId} #scanner-protocol`).value;
                    if (protocol) {
                        args.push('--protocol', protocol);
                    }
                    
                    const tags = document.querySelector(`#${wId} #scanner-tags`).value.trim();
                    if (tags) {
                        args.push('--tags', tags);
                    }
                    
                    const module = document.querySelector(`#${wId} #scanner-module`).value.trim();
                    if (module) {
                        args.push('--module', module);
                    }
                    
                    const threads = document.querySelector(`#${wId} #scanner-threads`).value;
                    if (threads && threads !== '5') {
                        args.push('--threads', threads);
                    }
                    
                    if (!document.querySelector(`#${wId} #scanner-scan-ports`).checked) {
                        args.push('--no-scan-ports');
                    }
                    
                    if (document.querySelector(`#${wId} #scanner-auto-exploit`).checked) {
                        args.push('--auto-exploit');
                    }
                    
                    if (document.querySelector(`#${wId} #scanner-verbose`).checked) {
                        args.push('--verbose');
                    }
                    
                    if (document.querySelector(`#${wId} #scanner-no-cache`).checked) {
                        args.push('--no-cache');
                    }
                    
                    return args;
                };
                
                const executeScanner = () => {
                    if (isScanning) {
                        appendOutput('Scan already in progress...', '#f85149');
                        return;
                    }
                    
                    const args = buildScannerCommand();
                    if (!args) return;
                    
                    isScanning = true;
                    startBtn.disabled = true;
                    startBtn.textContent = 'Scanning...';
                    startBtn.style.opacity = '0.6';
                    
                    clearOutput();
                    appendOutput(`Starting scan: scanner ${args.join(' ')}`, '#58a6ff');
                    appendOutput('', '#8b949e');
                    
                    // Execute via terminal backend
                    if (this.socket) {
                        // Create a temporary terminal session for scanner output
                        const sessionId = 'scanner_' + Date.now();
                        this.socket.emit('join_terminal_session', { session_id: sessionId });
                        
                        // Listen for output
                        const outputListener = (data) => {
                            if (data.session_id === sessionId) {
                                // Support both 'output' and 'text' fields for compatibility
                                const output = data.output || data.text || '';
                                if (output) {
                                    appendOutput(output, '#c9d1d9');
                                }
                            }
                        };
                        
                        this.socket.on('terminal_output', outputListener);
                        
                        // Wait a bit for session to be set up before executing
                        setTimeout(() => {
                            // Execute command
                            this.socket.emit('terminal_exec', {
                                session_id: sessionId,
                                command: 'scanner ' + args.join(' ')
                            });
                        }, 100);
                        
                        // Listen for completion
                        const completeListener = (data) => {
                            if (data.session_id === sessionId) {
                                isScanning = false;
                                startBtn.disabled = false;
                                startBtn.textContent = 'Start Scan';
                                startBtn.style.opacity = '1';
                                
                                this.socket.off('terminal_output', outputListener);
                                this.socket.off('terminal_complete', completeListener);
                                
                                appendOutput('', '#8b949e');
                                appendOutput('Scan completed.', '#3fb950');
                            }
                        };
                        
                        this.socket.on('terminal_complete', completeListener);
                    } else {
                        // Fallback: use REST API
                        fetch('/api/terminal/exec', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({
                                command: 'scanner ' + args.join(' ')
                            })
                        })
                        .then(res => res.json())
                        .then(data => {
                            if (data.output) {
                                appendOutput(data.output, '#c9d1d9');
                            }
                            isScanning = false;
                            startBtn.disabled = false;
                            startBtn.textContent = 'Start Scan';
                            startBtn.style.opacity = '1';
                            appendOutput('', '#8b949e');
                            appendOutput('Scan completed.', '#3fb950');
                        })
                        .catch(err => {
                            appendOutput(`Error: ${err.message}`, '#f85149');
                            isScanning = false;
                            startBtn.disabled = false;
                            startBtn.textContent = 'Start Scan';
                            startBtn.style.opacity = '1';
                        });
                    }
                };
                
                const listModules = () => {
                    clearOutput();
                    appendOutput('Listing available scanner modules...', '#58a6ff');
                    appendOutput('', '#8b949e');
                    
                    if (this.socket) {
                        const sessionId = 'scanner_list_' + Date.now();
                        this.socket.emit('join_terminal_session', { session_id: sessionId });
                        
                        const outputListener = (data) => {
                            if (data.session_id === sessionId && data.output) {
                                appendOutput(data.output, '#c9d1d9');
                            }
                        };
                        
                        this.socket.on('terminal_output', outputListener);
                        
                        this.socket.emit('terminal_exec', {
                            session_id: sessionId,
                            command: 'scanner --list'
                        });
                        
                        const completeListener = (data) => {
                            if (data.session_id === sessionId) {
                                this.socket.off('terminal_output', outputListener);
                                this.socket.off('terminal_complete', completeListener);
                            }
                        };
                        
                        this.socket.on('terminal_complete', completeListener);
                    } else {
                        fetch('/api/terminal/exec', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({
                                command: 'scanner --list'
                            })
                        })
                        .then(res => res.json())
                        .then(data => {
                            if (data.output) {
                                appendOutput(data.output, '#c9d1d9');
                            }
                        })
                        .catch(err => {
                            appendOutput(`Error: ${err.message}`, '#f85149');
                        });
                    }
                };
                
                startBtn.addEventListener('click', executeScanner);
                listBtn.addEventListener('click', listModules);
                clearBtn.addEventListener('click', clearOutput);
                
                // Allow Enter key to start scan
                document.querySelector(`#${wId} #scanner-url`).addEventListener('keypress', (e) => {
                    if (e.key === 'Enter' && !isScanning) {
                        executeScanner();
                    }
                });
            }
        });
        return winId;
    }

    openBrowserServerAdmin(adminUrl) {
        return this.openBrowserServerPage(adminUrl, 'Browser Server Admin', 'settings-outline');
    }

    openBrowserServerPage(pageUrl, title, icon) {
        const winId = this.wm.createWindow({
            title: title,
            icon: icon,
            width: '1200px',
            height: '800px',
            content: `
                <div style="width: 100%; height: 100%; background: #0d1117; display: flex; flex-direction: column;">
                    <iframe 
                        src="${pageUrl}" 
                        style="width: 100%; height: 100%; border: none; background: white;"
                        frameborder="0"
                        allowfullscreen>
                    </iframe>
                </div>
            `,
            onLoad: (wId) => {
                // Iframe will load the page
            }
        });
        return winId;
    }
}

// Initialize
const os = new OS();
window.os = os; // for debugging/global access
