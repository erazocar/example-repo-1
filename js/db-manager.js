/**
 * HydroBlox IndexedDB Manager for PWA Export
 * 
 * This class handles database operations for the exported PWA:
 * - Initializes a separate IndexedDB database for exported data
 * - Imports data from the exported files
 * - Provides methods to access the imported data
 */
class DBManager {
    constructor() {
        this.dbName = 'HydroBloxExportDB';
        this.version = 1;
        this.db = null;
        this.ready = false;
        this.itemIndex = null;
    }

    /**
     * Initialize the database
     * @returns {Promise<boolean>} - Promise resolving to true if successful
     */
    async initDB() {
        try {
            // Only initialize once
            if (this.ready) {
                console.log('Database already initialized');
                return true;
            }

            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, this.version);

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    
                    // Create object stores for workflows, items, and application data
                    if (!db.objectStoreNames.contains('workflows')) {
                        const workflowStore = db.createObjectStore('workflows', { keyPath: 'id' });
                        workflowStore.createIndex('name', 'name', { unique: false });
                    }
                    
                    if (!db.objectStoreNames.contains('items')) {
                        const itemStore = db.createObjectStore('items', { keyPath: 'uniqueId' });
                        itemStore.createIndex('workflowId', 'workflowId', { unique: false });
                        itemStore.createIndex('itemName', 'itemName', { unique: false });
                    }
                    
                    if (!db.objectStoreNames.contains('appInfo')) {
                        db.createObjectStore('appInfo', { keyPath: 'key' });
                    }
                };

                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    this.ready = true;
                    console.log('Database initialized successfully');
                    resolve(true);
                };

                request.onerror = (event) => {
                    console.error('Database error:', event.target.error);
                    reject(event.target.error);
                };
            });
        } catch (error) {
            console.error('Error initializing database:', error);
            return false;
        }
    }
    
    /**
     * Import data from exported files
     * @param {Object} options - Options for importing data
     * @param {Function} options.updateProgress - Function to update progress display
     * @returns {Promise<boolean>} - Promise resolving to true if successful
     */
    async importData(options = {}) {
        const updateProgress = options.updateProgress || (msg => console.log(msg));
        const errors = [];
        
        if (!this.ready) {
            try {
                updateProgress('Initializing database...');
                await this.initDB();
            } catch (initError) {
                const errorMsg = `Failed to initialize database: ${initError.message}`;
                console.error(errorMsg, initError);
                updateProgress(errorMsg);
                return false;
            }
        }

        try {
            // Clear existing data before importing
            try {
                updateProgress('Clearing previous data...');
                await this.clearDatabase();
            } catch (clearError) {
                const warnMsg = `Warning: Failed to clear database: ${clearError.message}`;
                console.warn(warnMsg, clearError);
                updateProgress(warnMsg);
                errors.push(warnMsg);
                // Continue anyway
            }

            // First, fetch and store the item index with retry
            updateProgress('Fetching item index...');
            let itemIndexResponse;
            try {
                itemIndexResponse = await this.fetchWithRetry('./data/item-index.json');
                
                if (!itemIndexResponse || !itemIndexResponse.ok) {
                    throw new Error(`Failed to fetch item index: HTTP ${itemIndexResponse?.status || 'unknown'}`);
                }
                
                const indexText = await itemIndexResponse.text();
                if (!indexText || indexText.trim() === '') {
                    throw new Error('Item index file is empty');
                }
                
                this.itemIndex = JSON.parse(indexText);
                
                // Validate index structure
                if (!Array.isArray(this.itemIndex)) {
                    throw new Error('Item index is not an array');
                }
                
                console.log(`Item index loaded: ${this.itemIndex.length} items found`);
                
            } catch (fetchError) {
                const errorMsg = `Failed to load item index: ${fetchError.message}`;
                console.error(errorMsg, fetchError);
                updateProgress(errorMsg);
                this.itemIndex = [];
                errors.push(errorMsg);
                // Continue with empty index
            }

            // Store app info with fallback
            updateProgress('Loading application information...');
            try {
                const appInfoResponse = await this.fetchWithRetry('./data/app-info.json');
                if (appInfoResponse && appInfoResponse.ok) {
                    const appInfoText = await appInfoResponse.text();
                    if (appInfoText && appInfoText.trim()) {
                        const appInfo = JSON.parse(appInfoText);
                        await this.storeAppInfo(appInfo);
                        console.log('App info loaded successfully');
                    } else {
                        throw new Error('App info file is empty');
                    }
                } else {
                    throw new Error(`Failed to fetch: HTTP ${appInfoResponse?.status || 'unknown'}`);
                }
            } catch (appInfoError) {
                const errorMsg = `Failed to load app info: ${appInfoError.message}`;
                console.warn(errorMsg, appInfoError);
                updateProgress(errorMsg);
                errors.push(errorMsg);
                // Use fallback
                await this.storeAppInfo({
                    appInfo: {
                        version: "1.0.0",
                        exportDate: new Date().toISOString(),
                        name: "HydroBlox"
                    }
                });
            }

            // Store workflows with fallback
            updateProgress('Loading workflows...');
            let workflows = {};
            let workflowCount = 0;
            try {
                const workflowsResponse = await this.fetchWithRetry('./data/workflows.json');
                if (workflowsResponse && workflowsResponse.ok) {
                    const workflowsText = await workflowsResponse.text();
                    if (!workflowsText || workflowsText.trim() === '') {
                        throw new Error('Workflows file is empty');
                    }
                    
                    workflows = JSON.parse(workflowsText);
                    
                    // Validate and normalize workflows structure
                    if (!workflows || typeof workflows !== 'object') {
                        throw new Error('Invalid workflows format');
                    }
                    
                    // CRITICAL: Handle different possible structures
                    // Case 1: workflows is an array (incorrect structure)
                    if (Array.isArray(workflows)) {
                        console.warn('Workflows is an array, converting to object structure');
                        const normalizedWorkflows = {};
                        workflows.forEach((workflow, index) => {
                            const workflowId = workflow.id || workflow.workflowId || `workflow-${index}`;
                            // Only include if it has items array (is a workflow)
                            if (workflow.items && Array.isArray(workflow.items)) {
                            normalizedWorkflows[workflowId] = workflow;
                            } else {
                                console.warn(`Skipping entry "${workflowId}" - not a valid workflow (missing items array)`);
                            }
                        });
                        workflows = normalizedWorkflows;
                    }
                    
                    // Case 2: Validate that each workflow has the correct structure
                    // Ensure workflows object has workflow objects with 'items' arrays, not items themselves
                    const validatedWorkflows = {};
                    for (const [workflowId, workflow] of Object.entries(workflows)) {
                        // Check if this entry is actually a workflow or an item
                        if (workflow.items && Array.isArray(workflow.items)) {
                            // This is a workflow with items - good!
                            validatedWorkflows[workflowId] = workflow;
                        } else if (workflow.uniqueId || workflow.itemName) {
                            // This looks like an item, not a workflow - skip it
                            console.warn(`Skipping item "${workflowId}" - items should be nested in workflows, not at root level`);
                            continue;
                        } else {
                            // Unknown structure - skip it (don't preserve invalid structures)
                            console.warn(`Skipping unknown structure for key "${workflowId}"`);
                            continue;
                        }
                    }
                    
                    workflows = validatedWorkflows;
                    workflowCount = Object.keys(workflows).length;
                    await this.storeWorkflows(workflows);
                    console.log(`Loaded ${workflowCount} workflow(s)`);
                } else {
                    throw new Error(`Failed to fetch: HTTP ${workflowsResponse?.status || 'unknown'}`);
                }
            } catch (workflowsError) {
                const errorMsg = `Failed to load workflows: ${workflowsError.message}`;
                console.error(errorMsg, workflowsError);
                updateProgress(errorMsg);
                errors.push(errorMsg);
                workflows = {};
                // Continue with empty workflows
            }

            // Store items in batches to avoid memory issues
            const totalItems = this.itemIndex ? this.itemIndex.length : 0;
            let processedItems = 0;
            let failedItems = 0;
            
            if (totalItems > 0) {
                const batchSize = 5; // Process 5 items at a time

                for (let i = 0; i < totalItems; i += batchSize) {
                    const batch = this.itemIndex.slice(i, i + batchSize);
                    updateProgress(`Loading items ${i + 1} to ${Math.min(i + batchSize, totalItems)} of ${totalItems}...`);
                    try {
                        const result = await this.storeItemBatch(batch);
                        processedItems += result.succeeded;
                        failedItems += result.failed;
                    } catch (batchError) {
                        const errorMsg = `Batch ${i}-${i + batchSize} failed: ${batchError.message}`;
                        console.warn(errorMsg, batchError);
                        updateProgress(errorMsg);
                        errors.push(errorMsg);
                        failedItems += batch.length;
                        // Continue with next batch
                    }
                }

                const successRate = totalItems > 0 ? Math.round((processedItems / totalItems) * 100) : 100;
                const summaryMsg = `Import complete: ${processedItems}/${totalItems} items (${successRate}%) from ${workflowCount} workflow(s)`;
                updateProgress(summaryMsg);
                console.log(summaryMsg);
                
                if (failedItems > 0) {
                    const warnMsg = `Warning: ${failedItems} items failed to load`;
                    console.warn(warnMsg);
                    updateProgress(warnMsg);
                    errors.push(warnMsg);
                }
            } else {
                const msg = 'No items to import. Database initialized successfully.';
                updateProgress(msg);
                console.log(msg);
            }

            // Report any errors that occurred
            if (errors.length > 0) {
                console.warn(`Import completed with ${errors.length} warning(s):`, errors);
                return true; // Still return true if we have some data
            }

            return true;
        } catch (error) {
            const errorMsg = `Critical error during import: ${error.message}`;
            console.error(errorMsg, error);
            updateProgress(errorMsg);
            return false;
        }
    }

    /**
     * Fetch with retry mechanism
     * @param {string} url - URL to fetch
     * @param {number} retries - Number of retries
     * @returns {Promise<Response>} - Fetch response
     */
    async fetchWithRetry(url, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    return response;
                }
            } catch (error) {
                console.warn(`Fetch attempt ${i + 1} failed for ${url}:`, error);
                if (i === retries - 1) {
                    throw error;
                }
            }
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
    
    /**
     * Store a batch of items
     * @param {Array} itemBatch - Array of item metadata to load and store
     * @returns {Promise<{succeeded: number, failed: number}>}
     */
    async storeItemBatch(itemBatch) {
        let loadedCount = 0;
        let loadFailedCount = 0;
        
        const itemPromises = itemBatch.map(async (itemMeta) => {
            try {
                if (!itemMeta || !itemMeta.id) {
                    console.warn('Invalid item metadata:', itemMeta);
                    loadFailedCount++;
                    return null;
                }
                
                const itemResponse = await this.fetchWithRetry(`./data/items/${itemMeta.id}.json`, 2);
                if (!itemResponse || !itemResponse.ok) {
                    console.warn(`Failed to fetch item ${itemMeta.id}: HTTP ${itemResponse ? itemResponse.status : 'No response'}`);
                    loadFailedCount++;
                    return null;
                }

                const itemText = await itemResponse.text();
                if (!itemText || itemText.trim() === '') {
                    console.warn(`Item ${itemMeta.id} file is empty`);
                    loadFailedCount++;
                    return null;
                }
                
                const itemData = JSON.parse(itemText);
                
                // Validate item data structure
                if (!itemData || typeof itemData !== 'object') {
                    console.warn(`Item ${itemMeta.id} has invalid data structure`);
                    loadFailedCount++;
                    return null;
                }
                
                loadedCount++;
                return {
                    uniqueId: itemMeta.id,
                    workflowId: itemMeta.workflowId,
                    itemName: itemMeta.itemName,
                    timestamp: itemMeta.timestamp || new Date().toISOString(),
                    data: itemData.data !== undefined ? itemData.data : itemData,
                    // CRITICAL: Include settings from item file (for code blocks, etc.)
                    settings: itemData.settings || {},
                    name: itemData.name,
                    type: itemData.type
                };
            } catch (error) {
                console.warn(`Error loading item ${itemMeta?.id || 'unknown'}:`, error);
                loadFailedCount++;
                return null;
            }
        });

        const items = await Promise.all(itemPromises);

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['items'], 'readwrite');
            const itemStore = transaction.objectStore('items');

            let storeCompleted = 0;
            let storeFailed = 0;
            const validItems = items.filter(item => item !== null);

            if (validItems.length === 0) {
                console.warn(`No valid items in batch to store (loaded: ${loadedCount}, failed: ${loadFailedCount})`);
                resolve({ succeeded: 0, failed: loadFailedCount });
                return;
            }

            validItems.forEach(item => {
                const request = itemStore.put(item);

                request.onsuccess = () => {
                    storeCompleted++;
                    checkDone();
                };

                request.onerror = (event) => {
                    console.error(`Error storing item ${item.uniqueId}:`, event.target.error);
                    storeFailed++;
                    checkDone();
                };
            });

            function checkDone() {
                if (storeCompleted + storeFailed === validItems.length) {
                    if (storeFailed > 0) {
                        console.warn(`Stored ${storeCompleted} items, but ${storeFailed} failed to store`);
                    }
                    resolve({ 
                        succeeded: storeCompleted, 
                        failed: loadFailedCount + storeFailed 
                    });
                }
            }

            transaction.oncomplete = () => {
                // Backup completion handler
                if (storeCompleted + storeFailed === validItems.length) {
                    resolve({ 
                        succeeded: storeCompleted, 
                        failed: loadFailedCount + storeFailed 
                    });
                }
            };

            transaction.onerror = (event) => {
                console.error('Transaction error:', event.target.error);
                reject(new Error(`Transaction failed: ${event.target.error.message}`));
            };
        });
    }

    /**
     * Store workflows
     * @param {Object} workflows - Workflows to store
     * @returns {Promise<void>}
     */
    async storeWorkflows(workflows) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['workflows'], 'readwrite');
            const workflowStore = transaction.objectStore('workflows');
            let completed = 0;
            
            // CRITICAL: Validate workflows structure before processing
            if (!workflows || typeof workflows !== 'object' || Array.isArray(workflows)) {
                reject(new Error('Invalid workflows structure: expected object with workflow IDs as keys'));
                return;
            }
            
            const workflowEntries = Object.entries(workflows);
            const totalWorkflows = workflowEntries.length;
            
            if (totalWorkflows === 0) {
                resolve();
                return;
            }
            
            for (const [workflowId, workflow] of workflowEntries) {
                // CRITICAL: Validate workflow structure
                if (!workflow || typeof workflow !== 'object') {
                    console.error(`Invalid workflow structure for ${workflowId}:`, workflow);
                    completed++;
                    if (completed === totalWorkflows) {
                        resolve();
                    }
                    continue;
                }
                
                // Ensure items is an array
                const items = Array.isArray(workflow.items) ? workflow.items : [];
                
                // Store COMPLETE workflow structure - don't strip item properties!
                const request = workflowStore.put({
                    id: workflowId,
                    name: workflow.name || `Workflow ${workflowId}`,
                    items: items.map(item => {
                        // CRITICAL: Validate item structure
                        if (!item || typeof item !== 'object') {
                            console.warn(`Invalid item in workflow ${workflowId}:`, item);
                            return null;
                        }
                        // CRITICAL: Store ALL item properties including complete settings
                        // This ensures code blocks have code, language, libraries, etc.
                        return {
                            uniqueId: item.uniqueId,
                            name: item.name,
                            itemName: item.itemName,
                            type: item.type,
                            parameters: item.parameters || {},
                            arguments: item.arguments || {},
                            data: item.data || [],
                            // CRITICAL: Include complete settings (code, language, libraries for code blocks)
                            settings: item.settings || {},
                            status: item.status,
                            // Include results if available
                            results: item.results || null
                        };
                    }).filter(item => item !== null), // Remove invalid items
                    connections: workflow.connections || [],
                    created: workflow.created
                });
                
                request.onsuccess = () => {
                    completed++;
                    if (completed === Object.keys(workflows).length) {
                        resolve();
                    }
                };
                
                request.onerror = (event) => {
                    console.error(`Error storing workflow ${workflowId}:`, event.target.error);
                    reject(event.target.error);
                };
            }
            
            // Handle empty workflows object
            if (Object.keys(workflows).length === 0) {
                resolve();
            }
            
            transaction.onerror = (event) => {
                console.error('Transaction error:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * Store application info
     * @param {Object} appInfo - Application info to store
     * @returns {Promise<void>}
     */
    async storeAppInfo(appInfo) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['appInfo'], 'readwrite');
            const appInfoStore = transaction.objectStore('appInfo');
            
            // Handle both nested and flat app info structures
            const info = appInfo.appInfo || appInfo;
            
            const request = appInfoStore.put({
                key: 'appInfo',
                version: info.version || '1.0.0',
                exportDate: info.exportDate || new Date().toISOString(),
                name: info.name || info.title || 'HydroBlox Application',
                title: info.title,
                description: info.description,
                layout: info.layout,
                workflowCount: info.workflowCount
            });
            
            request.onsuccess = () => {
                resolve();
            };
            
            request.onerror = (event) => {
                console.error('Error storing app info:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * Get all workflows
     * @returns {Promise<Array>} - Promise resolving to an array of workflows
     */
    async getWorkflows() {
        return new Promise((resolve, reject) => {
            if (!this.ready) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction(['workflows'], 'readonly');
            const workflowStore = transaction.objectStore('workflows');
            const request = workflowStore.getAll();
            
            request.onsuccess = () => {
                resolve(request.result);
            };
            
            request.onerror = (event) => {
                console.error('Error getting workflows:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * Get items for a workflow
     * @param {string} workflowId - ID of the workflow
     * @returns {Promise<Array>} - Promise resolving to an array of items
     */
    async getWorkflowItems(workflowId) {
        return new Promise((resolve, reject) => {
            if (!this.ready) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction(['items'], 'readonly');
            const itemStore = transaction.objectStore('items');
            const index = itemStore.index('workflowId');
            const request = index.getAll(workflowId);
            
            request.onsuccess = () => {
                resolve(request.result);
            };
            
            request.onerror = (event) => {
                console.error(`Error getting items for workflow ${workflowId}:`, event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * Get a specific result by ID
     * @param {string} uniqueId - ID of the item
     * @returns {Promise<Object>} - Promise resolving to the item data
     */
    async getResult(uniqueId) {
        return new Promise((resolve, reject) => {
            if (!this.ready) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction(['items'], 'readonly');
            const itemStore = transaction.objectStore('items');
            const request = itemStore.get(uniqueId);
            
            request.onsuccess = () => {
                resolve(request.result);
            };
            
            request.onerror = (event) => {
                console.error(`Error getting item ${uniqueId}:`, event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * Clear the database
     * @returns {Promise<boolean>} - Promise resolving to true if successful
     */
    async clearDatabase() {
        return new Promise((resolve, reject) => {
            if (!this.ready) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction(['workflows', 'items', 'appInfo'], 'readwrite');
            const workflowStore = transaction.objectStore('workflows');
            const itemStore = transaction.objectStore('items');
            const appInfoStore = transaction.objectStore('appInfo');
            
            workflowStore.clear();
            itemStore.clear();
            appInfoStore.clear();
            
            transaction.oncomplete = () => {
                console.log('Database cleared successfully');
                resolve(true);
            };
            
            transaction.onerror = (event) => {
                console.error('Error clearing database:', event.target.error);
                reject(event.target.error);
            };
        });
    }
}

// Initialize and expose the database manager
window.db = new DBManager(); 