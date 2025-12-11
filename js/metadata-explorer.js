export class MetadataExplorer {
    constructor() {
        this.activeExplorers = new Map(); // Track active explorer instances
    }

    openDataExplorer(data, title = 'Data Explorer', sourceItemId = null) {
        // Close any existing data explorer
        const existingExplorer = document.querySelector('.data-explorer-modal');
        if (existingExplorer) {
            existingExplorer.remove();
        }

        // Generate unique ID for this explorer instance
        const explorerId = `explorer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Use provided source item ID

        // Create explorer state
        const explorerState = {
            id: explorerId,
            rootData: data,
            currentPath: [],
            currentData: data,
            title: title,
            sourceItemId: sourceItemId, // Track which result item this data came from
            history: [{ path: [], data: data }]
        };

        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'data-explorer-modal';
        overlay.dataset.explorerId = explorerId;
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.3);
            z-index: 1000;
            display: flex;
            justify-content: center;
            align-items: center;
        `;

        // Create the explorer container (fixed size, centered)
        const explorerContainer = document.createElement('div');
        explorerContainer.className = 'data-explorer-container';
        explorerContainer.style.cssText = `
            width: 400px;
            height: 500px;
            max-width: calc(100vw - 40px);
            max-height: calc(100vh - 40px);
            position: relative;
            box-sizing: border-box;
        `;

        // Create the explorer window
        const explorerWindow = document.createElement('div');
        explorerWindow.className = 'data-explorer-window';
        explorerWindow.style.cssText = `
            width: 100%;
            height: 100%;
            max-width: 100%;
            max-height: 100%;
            background: white;
            border-radius: 6px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            display: flex;
            flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            overflow: hidden;
            box-sizing: border-box;
            position: relative;
        `;

        // Create header
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 10px 12px;
            border-bottom: 1px solid #eee;
            background: #f8f9fa;
            border-radius: 6px 6px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            min-height: 16px;
            cursor: move;
            flex-shrink: 0;
        `;
        header.innerHTML = `
            <h4 style="margin: 0; font-size: 13px; color: #333; font-weight: 500;">${title}</h4>
            <button class="close-btn" style="width: 20px; height: 20px; padding: 0; border: 1px solid #ccc; background: white; border-radius: 3px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 10px;">
                <i class="fas fa-times"></i>
            </button>
        `;

        // Create content area
        const content = document.createElement('div');
        content.className = 'explorer-content';
        content.style.cssText = `
            flex: 1;
            overflow: hidden;
            padding: 0;
            display: flex;
            flex-direction: column;
            min-height: 0;
        `;

        // Create navigation breadcrumb
        const breadcrumb = document.createElement('div');
        breadcrumb.className = 'explorer-breadcrumb';
        breadcrumb.style.cssText = `
            padding: 6px 12px;
            background: #f1f3f4;
            border-bottom: 1px solid #eee;
            font-size: 11px;
            color: #666;
            flex-shrink: 0;
            min-height: 30px;
            max-height: 40px;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
        `;

        // Create main explorer area
        const explorerArea = document.createElement('div');
        explorerArea.className = 'explorer-area';
        explorerArea.style.cssText = `
            padding: 12px;
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            box-sizing: border-box;
            min-height: 0;
            max-height: calc(100% - 80px);
        `;

        content.appendChild(breadcrumb);
        content.appendChild(explorerArea);

        explorerWindow.appendChild(header);
        explorerWindow.appendChild(content);
        explorerContainer.appendChild(explorerWindow);
        overlay.appendChild(explorerContainer);
        document.body.appendChild(overlay);

        // Store explorer state on the overlay
        overlay.explorerState = explorerState;

        // Track this explorer instance
        this.activeExplorers.set(explorerId, explorerState);

        // Initialize the explorer with the data
        this.renderExplorerContent(explorerArea, breadcrumb, explorerState);

        // Add event handlers
        header.querySelector('.close-btn').addEventListener('click', () => {
            this.closeExplorer(explorerId);
        });

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.closeExplorer(explorerId);
            }
        });

        // Close on escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                this.closeExplorer(explorerId);
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        return explorerId;
    }

    renderExplorerContent(container, breadcrumb, explorerState) {
        container.innerHTML = '';

        // Update breadcrumb
        const path = explorerState.currentPath;
        if (path.length === 0) {
            breadcrumb.innerHTML = '<button class="breadcrumb-root" style="all: unset; cursor: pointer; color: #007bff;"><i class="fas fa-home"></i> Root</button>';
        } else {
            breadcrumb.innerHTML = `<button class="breadcrumb-root" style="all: unset; cursor: pointer; color: #007bff;"><i class="fas fa-home"></i> Root</button> ${path.map(p => `<i class="fas fa-chevron-right" style="margin: 0 8px;"></i>${p}`).join('')}`;
        }

        // Make root clickable to return to root
        const rootBtn = breadcrumb.querySelector('.breadcrumb-root');
        if (rootBtn) {
            rootBtn.addEventListener('click', () => {
                this.navigateToPath(explorerState.id, []);
            });
        }

        // Add back button if not at root
        if (path.length > 0) {
            const backBtn = document.createElement('button');
            backBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Back';
            backBtn.style.cssText = `
                margin-bottom: 10px;
                padding: 4px 8px;
                border: 1px solid #ddd;
                background: white;
                border-radius: 3px;
                cursor: pointer;
                font-size: 11px;
            `;
            backBtn.addEventListener('click', () => {
                const parentPath = path.slice(0, -1);
                this.navigateToPath(explorerState.id, parentPath);
            });
            container.appendChild(backBtn);
        }

        this.renderExplorerData(container, explorerState.currentData, path, explorerState.id);
    }

    renderExplorerData(container, data, currentPath, explorerId = null) {
        if (data === null || data === undefined) {
            container.innerHTML += '<div style="padding: 20px; text-align: center; color: #999;">null</div>';
            return;
        }

        if (Array.isArray(data)) {
            this.renderArrayExplorer(container, data, currentPath, explorerId);
        } else if (typeof data === 'object') {
            this.renderObjectExplorer(container, data, currentPath, explorerId);
        } else {
            this.renderPrimitiveExplorer(container, data);
        }
    }

    renderArrayExplorer(container, data, currentPath, explorerId = null) {
        const header = document.createElement('div');
        header.innerHTML = `<h5 style="margin: 0 0 8px 0; font-size: 12px; color: #666;">Array (${data.length} items)</h5>`;
        container.appendChild(header);

        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        `;

        // Header
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr style="background: #f8f9fa;">
                <th style="padding: 6px 8px; text-align: left; border-bottom: 1px solid #eee; width: 50px; font-size: 11px;">Index</th>
                <th style="padding: 6px 8px; text-align: left; border-bottom: 1px solid #eee; font-size: 11px;">Value</th>
                <th style="padding: 6px 8px; text-align: left; border-bottom: 1px solid #eee; width: 60px; font-size: 11px;">Type</th>
                <th style="padding: 6px 8px; text-align: center; border-bottom: 1px solid #eee; width: 50px; font-size: 11px;">Action</th>
            </tr>
        `;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');

        // Implement pagination - show first 50 items initially
        const itemsPerPage = 50;
        const totalItems = data.length;
        let currentPage = 0;
        const maxPages = Math.ceil(totalItems / itemsPerPage);

        const renderPage = (page) => {
            const startIndex = page * itemsPerPage;
            const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
            const pageData = data.slice(startIndex, endIndex);

            pageData.forEach((item, pageIndex) => {
                const actualIndex = startIndex + pageIndex;
            const row = document.createElement('tr');
            row.style.borderBottom = '1px solid #f1f1f1';

            let displayValue, valueType;
            if (item === null || item === undefined) {
                displayValue = '<em style="color: #999;">null</em>';
                valueType = 'null';
            } else if (typeof item === 'object') {
                if (Array.isArray(item)) {
                    displayValue = `Array(${item.length})`;
                    valueType = 'array';
                } else {
                    displayValue = `Object(${Object.keys(item).length} keys)`;
                    valueType = 'object';
                }
            } else if (typeof item === 'string') {
                displayValue = item.length > 50 ? item.substring(0, 50) + '...' : item;
                valueType = 'string';
            } else {
                displayValue = String(item);
                valueType = typeof item;
            }

            const actionHtml = (typeof item === 'object' && item !== null) ?
                '<button class="explore-btn" style="padding: 2px 6px; border: 1px solid #007bff; background: #007bff; color: white; border-radius: 3px; cursor: pointer; font-size: 9px;">Go</button>' :
                '<span style="color: #ccc; font-size: 10px;">-</span>';

            row.innerHTML = `
                <td style="padding: 6px 8px; font-family: monospace; color: #666; font-size: 10px;">${actualIndex}</td>
                <td style="padding: 6px 8px; word-break: break-word; max-width: 200px; font-size: 11px;" title="${typeof item === 'string' ? item : JSON.stringify(item)}">${displayValue}</td>
                <td style="padding: 6px 8px; color: #666; font-size: 10px;">${valueType}</td>
                <td style="padding: 6px 8px; text-align: center;">${actionHtml}</td>
            `;

            if (typeof item === 'object' && item !== null) {
                const exploreBtn = row.querySelector('.explore-btn');
                exploreBtn.addEventListener('click', () => {
                    const newPath = [...currentPath, actualIndex];
                    this.navigateToPath(explorerId, newPath);
                });
            }

            tbody.appendChild(row);
        });
        };

        // Render first page
        renderPage(0);

        // Add load more button if there are more pages
        if (maxPages > 1) {
            const loadMoreRow = document.createElement('tr');
            loadMoreRow.innerHTML = `
                <td colspan="4" style="padding: 12px; text-align: center; border-top: 1px solid #e1e5e9;">
                    <button class="load-more-btn" style="
                        padding: 6px 12px;
                        background: #007bff;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 11px;
                    ">Load More (Showing ${Math.min(itemsPerPage, totalItems)} of ${totalItems})</button>
                </td>
            `;
            tbody.appendChild(loadMoreRow);

            const loadMoreBtn = loadMoreRow.querySelector('.load-more-btn');
            loadMoreBtn.addEventListener('click', () => {
                currentPage++;
                if (currentPage < maxPages) {
                    renderPage(currentPage);
                    loadMoreBtn.textContent = `Load More (Showing ${Math.min((currentPage + 1) * itemsPerPage, totalItems)} of ${totalItems})`;
                } else {
                    loadMoreBtn.textContent = `All ${totalItems} items loaded`;
                    loadMoreBtn.disabled = true;
                    loadMoreBtn.style.background = '#6c757d';
                }
            });
        }

        table.appendChild(tbody);
        container.appendChild(table);
    }

    renderObjectExplorer(container, data, currentPath, explorerId = null) {
        const keys = Object.keys(data);
        const header = document.createElement('div');
        header.innerHTML = `<h5 style="margin: 0 0 8px 0; font-size: 12px; color: #666;">Object (${keys.length} properties)</h5>`;
        container.appendChild(header);

        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        `;

        // Header
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr style="background: #f8f9fa;">
                <th style="padding: 6px 8px; text-align: left; border-bottom: 1px solid #eee; width: 120px; font-size: 11px;">Property</th>
                <th style="padding: 6px 8px; text-align: left; border-bottom: 1px solid #eee; font-size: 11px;">Value</th>
                <th style="padding: 6px 8px; text-align: left; border-bottom: 1px solid #eee; width: 60px; font-size: 11px;">Type</th>
                <th style="padding: 6px 8px; text-align: center; border-bottom: 1px solid #eee; width: 50px; font-size: 11px;">Action</th>
            </tr>
        `;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');

        // Implement pagination - show first 50 properties initially
        const itemsPerPage = 50;
        const totalItems = keys.length;
        let currentPage = 0;
        const maxPages = Math.ceil(totalItems / itemsPerPage);

        const renderPage = (page) => {
            const startIndex = page * itemsPerPage;
            const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
            const pageKeys = keys.slice(startIndex, endIndex);

            pageKeys.forEach(key => {
                const value = data[key];
                const row = document.createElement('tr');
                row.style.borderBottom = '1px solid #f1f1f1';

                let displayValue, valueType;
                if (value === null || value === undefined) {
                    displayValue = '<em style="color: #999;">null</em>';
                    valueType = 'null';
                } else if (typeof value === 'object') {
                    if (Array.isArray(value)) {
                        displayValue = `Array(${value.length})`;
                        valueType = 'array';
                    } else {
                        displayValue = `Object(${Object.keys(value).length} keys)`;
                        valueType = 'object';
                    }
                } else if (typeof value === 'string') {
                    displayValue = value.length > 50 ? value.substring(0, 50) + '...' : value;
                    valueType = 'string';
                } else {
                    displayValue = String(value);
                    valueType = typeof value;
                }

                const actionHtml = (typeof value === 'object' && value !== null) ?
                    '<button class="explore-btn" style="padding: 2px 6px; border: 1px solid #007bff; background: #007bff; color: white; border-radius: 3px; cursor: pointer; font-size: 9px;">Go</button>' :
                    '<span style="color: #ccc; font-size: 10px;">-</span>';

                const keyDisplay = key.length > 20 ? key.substring(0, 20) + '...' : key;

                row.innerHTML = `
                    <td style="padding: 6px 8px; font-weight: 500; word-break: break-word; font-size: 11px;" title="${key}">${keyDisplay}</td>
                    <td style="padding: 6px 8px; word-break: break-word; max-width: 150px; font-size: 11px;" title="${typeof value === 'string' ? value : JSON.stringify(value)}">${displayValue}</td>
                    <td style="padding: 6px 8px; color: #666; font-size: 10px;">${valueType}</td>
                    <td style="padding: 6px 8px; text-align: center;">${actionHtml}</td>
                `;

                if (typeof value === 'object' && value !== null) {
                    const exploreBtn = row.querySelector('.explore-btn');
                    exploreBtn.addEventListener('click', () => {
                        const newPath = [...currentPath, key];
                        this.navigateToPath(explorerId, newPath);
                    });
                }

                tbody.appendChild(row);
            });
        };

        // Render first page
        renderPage(0);

        // Add load more button if there are more pages
        if (maxPages > 1) {
            const loadMoreRow = document.createElement('tr');
            loadMoreRow.innerHTML = `
                <td colspan="4" style="padding: 12px; text-align: center; border-top: 1px solid #e1e5e9;">
                    <button class="load-more-btn" style="
                        padding: 6px 12px;
                        background: #007bff;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 11px;
                    ">Load More (Showing ${Math.min(itemsPerPage, totalItems)} of ${totalItems})</button>
                </td>
            `;
            tbody.appendChild(loadMoreRow);

            const loadMoreBtn = loadMoreRow.querySelector('.load-more-btn');
            loadMoreBtn.addEventListener('click', () => {
                currentPage++;
                if (currentPage < maxPages) {
                    renderPage(currentPage);
                    loadMoreBtn.textContent = `Load More (Showing ${Math.min((currentPage + 1) * itemsPerPage, totalItems)} of ${totalItems})`;
                } else {
                    loadMoreBtn.textContent = `All ${totalItems} properties loaded`;
                    loadMoreBtn.disabled = true;
                    loadMoreBtn.style.background = '#6c757d';
                }
            });
        }

        table.appendChild(tbody);
        container.appendChild(table);
    }

    renderPrimitiveExplorer(container, data) {
        const valueDiv = document.createElement('div');
        valueDiv.style.cssText = `
            padding: 12px;
            background: #f8f9fa;
            border-radius: 4px;
            border-left: 3px solid #007bff;
            font-family: monospace;
            white-space: pre-wrap;
            word-break: break-word;
            font-size: 11px;
        `;

        let displayValue = data;
        if (typeof data === 'string') {
            displayValue = `"${data}"`;
        }

        valueDiv.innerHTML = `
            <div style="margin-bottom: 6px; font-weight: bold; color: #666; font-family: sans-serif; font-size: 10px;">
                ${typeof data} value:
            </div>
            ${displayValue}
        `;
        container.appendChild(valueDiv);
    }

    getDataAtPath(data, path) {
        let current = data;
        for (const segment of path) {
            if (current && (Array.isArray(current) || typeof current === 'object')) {
                current = current[segment];
            } else {
                return null;
            }
        }
        return current;
    }

    navigateToPath(explorerId, newPath) {
        const explorerState = this.activeExplorers.get(explorerId);
        if (!explorerState) return;

        // Get the data at the new path
        const targetData = this.getDataAtPath(explorerState.rootData, newPath);
        if (targetData === undefined) return;

        // Update explorer state
        explorerState.currentPath = newPath;
        explorerState.currentData = targetData;

        // Add to history if not already there
        const existingHistoryIndex = explorerState.history.findIndex(h => JSON.stringify(h.path) === JSON.stringify(newPath));
        if (existingHistoryIndex === -1) {
            explorerState.history.push({ path: [...newPath], data: targetData });
        }

        // Find the overlay and update the display
        const overlay = document.querySelector(`.data-explorer-modal[data-explorer-id="${explorerId}"]`);
        if (overlay) {
            const explorerArea = overlay.querySelector('.explorer-area');
            const breadcrumb = overlay.querySelector('.explorer-breadcrumb');
            if (explorerArea && breadcrumb) {
                this.renderExplorerContent(explorerArea, breadcrumb, explorerState);
            }
        }
    }

    closeExplorer(explorerId) {
        const overlay = document.querySelector(`.data-explorer-modal[data-explorer-id="${explorerId}"]`);
        if (overlay) {
            overlay.remove();
            this.activeExplorers.delete(explorerId);
        }
    }

    getExplorerState(explorerId) {
        return this.activeExplorers.get(explorerId);
    }

    makeDraggable(element, handle, container = null) {
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        handle.style.cursor = 'move';

        handle.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            // Get the current position relative to the container (overlay)
            const rect = element.getBoundingClientRect();
            const containerRect = container ? container.getBoundingClientRect() : {
                left: 0, top: 0, width: window.innerWidth, height: window.innerHeight
            };

            startLeft = rect.left - containerRect.left;
            startTop = rect.top - containerRect.top;

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            e.preventDefault();
        });

        function handleMouseMove(e) {
            if (!isDragging) return;

            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            const containerRect = container ? container.getBoundingClientRect() : {
                left: 0, top: 0, width: window.innerWidth, height: window.innerHeight
            };

            // Constrain movement within the container
            const newLeft = Math.max(0, Math.min(containerRect.width - element.offsetWidth, startLeft + deltaX));
            const newTop = Math.max(0, Math.min(containerRect.height - element.offsetHeight, startTop + deltaY));

            element.style.left = `${newLeft}px`;
            element.style.top = `${newTop}px`;
            element.style.position = 'absolute';
        }

        function handleMouseUp() {
            isDragging = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        }
    }

    showTextModal(text, title = 'Text Content') {
        // Close any existing text modal
        const existingModal = document.querySelector('.text-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'text-modal';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 1001;
            display: flex;
            justify-content: center;
            align-items: center;
        `;

        // Create modal content
        const modal = document.createElement('div');
        modal.style.cssText = `
            background: white;
            border-radius: 8px;
            width: 90%;
            max-width: 600px;
            max-height: 80%;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
            display: flex;
            flex-direction: column;
        `;

        // Modal header
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 16px 20px;
            border-bottom: 1px solid #eee;
            background: #f8f9fa;
            border-radius: 8px 8px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        header.innerHTML = `
            <h3 style="margin: 0; font-size: 16px; color: #333;">${title}</h3>
            <button class="close-btn" style="padding: 4px 8px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer;">
                <i class="fas fa-times"></i>
            </button>
        `;

        // Modal content
        const content = document.createElement('div');
        content.style.cssText = `
            padding: 20px;
            overflow: auto;
            flex: 1;
            font-family: monospace;
            white-space: pre-wrap;
            word-break: break-word;
            line-height: 1.4;
        `;
        content.textContent = text;

        modal.appendChild(header);
        modal.appendChild(content);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Add event handlers
        header.querySelector('.close-btn').addEventListener('click', () => {
            overlay.remove();
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        });

        // Close on escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }
}
