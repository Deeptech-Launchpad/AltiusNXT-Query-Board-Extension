// Prevent duplicate listeners
if (!window.hasQueryAssistantListener) {
    window.hasQueryAssistantListener = true;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "toggle_sidebar") {
            toggleSidebar();
        }
        sendResponse({ status: "received" });
    });

    window.addEventListener("message", (event) => {
        if (event.data.action === "close_sidebar") {
            removeSidebar();
        }
    });
}

function toggleSidebar() {
    const existingWrapper = document.getElementById("query-assistant-wrapper");
    if (existingWrapper) {
        removeSidebar();
    } else {
        createSidebar();
    }
}

function createSidebar() {
    // 1. Create Wrapper
    const wrapper = document.createElement('div');
    wrapper.id = "query-assistant-wrapper";
    
    // Default Styles (Fixed position, specific start size)
    Object.assign(wrapper.style, {
        position: "fixed",
        top: "50px",
        right: "50px",
        width: "400px",
        height: "600px",
        minWidth: "300px",
        minHeight: "400px",
        zIndex: "2147483647",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
        borderRadius: "12px",
        backgroundColor: "white",
        transition: "opacity 0.2s ease" 
    });

    // 2. Drag Header (Top Bar)
    const dragHeader = document.createElement('div');
    dragHeader.id = "query-assistant-header";
    Object.assign(dragHeader.style, {
        height: "40px",
        width: "45%",
        cursor: "grab",
        backgroundColor: "transparent", 
        position: "absolute",
        top: "0", left: "0", zIndex: "10" 
    });

    // 3. Iframe (Content)
    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL("popup.html");
    Object.assign(iframe.style, {
        width: "100%",
        height: "100%",
        border: "none",
        borderRadius: "12px",
        pointerEvents: "auto"
    });

    wrapper.appendChild(dragHeader);
    wrapper.appendChild(iframe);
    
    // 4. Add Resizers (N, S, E, W, NE, NW, SE, SW)
    const resizers = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    resizers.forEach(dir => {
        const resizer = document.createElement('div');
        resizer.className = 'resizer ' + dir;
        
        Object.assign(resizer.style, {
            position: "absolute",
            zIndex: "20",
            backgroundColor: "transparent" // Invisible but interactable
        });

        // Positioning logic
        if(dir === 'n')  Object.assign(resizer.style, { top: "-5px", left: "0", right: "0", height: "10px", cursor: "ns-resize" });
        if(dir === 's')  Object.assign(resizer.style, { bottom: "-5px", left: "0", right: "0", height: "10px", cursor: "ns-resize" });
        if(dir === 'e')  Object.assign(resizer.style, { top: "0", bottom: "0", right: "-5px", width: "10px", cursor: "ew-resize" });
        if(dir === 'w')  Object.assign(resizer.style, { top: "0", bottom: "0", left: "-5px", width: "10px", cursor: "ew-resize" });
        
        if(dir === 'ne') Object.assign(resizer.style, { top: "-5px", right: "-5px", width: "15px", height: "15px", cursor: "nesw-resize", zIndex: "21" });
        if(dir === 'nw') Object.assign(resizer.style, { top: "-5px", left: "-5px", width: "15px", height: "15px", cursor: "nwse-resize", zIndex: "21" });
        if(dir === 'se') Object.assign(resizer.style, { bottom: "-5px", right: "-5px", width: "15px", height: "15px", cursor: "nwse-resize", zIndex: "21" });
        if(dir === 'sw') Object.assign(resizer.style, { bottom: "-5px", left: "-5px", width: "15px", height: "15px", cursor: "nesw-resize", zIndex: "21" });

        makeResizable(resizer, wrapper, dir);
        wrapper.appendChild(resizer);
    });

    document.body.appendChild(wrapper);
    makeDraggable(wrapper, dragHeader);
}

function removeSidebar() {
    const wrapper = document.getElementById("query-assistant-wrapper");
    if (wrapper) wrapper.remove();
}

// --- LOGIC: DRAGGING ---
function makeDraggable(element, handle) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    handle.addEventListener('mousedown', (e) => {
        if (e.target !== handle) return; 
        e.preventDefault();
        
        isDragging = true;
        element.style.opacity = "0.7"; 

        startX = e.clientX;
        startY = e.clientY;

        const rect = element.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        addOverlay();
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        element.style.left = `${initialLeft + dx}px`;
        element.style.top = `${initialTop + dy}px`;
        element.style.right = "auto"; 
    });

    window.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            element.style.opacity = "1.0";
            removeOverlay();
        }
    });
}

// --- LOGIC: RESIZING ---
function makeResizable(resizer, element, dir) {
    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        
        const startX = e.clientX;
        const startY = e.clientY;
        
        const rect = element.getBoundingClientRect();
        const startWidth = rect.width;
        const startHeight = rect.height;
        const startLeft = rect.left;
        const startTop = rect.top;

        addOverlay();

        function onMouseMove(e) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            // Horizontal Resize
            if (dir.includes('e')) {
                element.style.width = `${startWidth + dx}px`;
            }
            if (dir.includes('w')) {
                element.style.width = `${startWidth - dx}px`;
                element.style.left = `${startLeft + dx}px`;
                element.style.right = "auto"; // Fix alignment
            }

            // Vertical Resize
            if (dir.includes('s')) {
                element.style.height = `${startHeight + dy}px`;
            }
            if (dir.includes('n')) {
                element.style.height = `${startHeight - dy}px`;
                element.style.top = `${startTop + dy}px`;
            }
        }

        function onMouseUp() {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            removeOverlay();
        }

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });
}

// Helper: Overlay to prevent iframe from stealing mouse events
function addOverlay() {
    if(!document.getElementById('qa-drag-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = "qa-drag-overlay";
        Object.assign(overlay.style, {
            position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
            zIndex: "2147483648", cursor: "grabbing"
        });
        document.body.appendChild(overlay);
    }
}

function removeOverlay() {
    const overlay = document.getElementById('qa-drag-overlay');
    if (overlay) overlay.remove();
}