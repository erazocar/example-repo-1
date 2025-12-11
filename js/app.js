/**
 * HydroBlox PWA Application
 * This is the main application script for the exported PWA
 */
class ExportedApp {
    constructor() {
        this.workflows = null;
        this.currentWorkflow = null;
        this.visualizations = new Map();
        this.appInfo = null;
        // Initialize dbManager - will be set properly after window.db is initialized
        this.dbManager = null;
        this.hydrolangLoaded = false;
        this.initialized = false;
        this.layoutConfig = { include: { maps: true, charts: true, tables: true }, sidebar: true };
        
        // Track visualization state
        this.mapInitialized = false;
        this.currentWorkflowId = null;
        this.currentDatasetId = null;
        this.renderedVisualizations = {
            maps: null,
            charts: null,
            tables: null
        };
        
        // Initialize MetadataExplorer for JSON viewing (like main app)
        this.metadataExplorer = null;
    }

    /**
     * Initialize the application
     */
    async initialize() {
        try {
            this.showLoading(true, 'Initializing application...');
            
            // Load workflows first (doesn't require Hydrolang)
            this.showLoading(true, 'Loading workflow data...');
            try {
                await this.loadWorkflows();
                console.log('Workflows loaded successfully');
            } catch (workflowError) {
                console.error('Failed to load workflows:', workflowError);
                this.showError('Failed to load workflow data. The application may not function correctly.');
                // Continue anyway - UI might still be useful
            }
            
            // Ensure database manager is initialized
            if (!this.dbManager && window.db) {
                this.dbManager = window.db;
            }
            
            // Set up basic UI (doesn't require Hydrolang)
            this.showLoading(true, 'Setting up interface...');
            this.setupUI();
            
            // Set up event listeners
            this.setupEventListeners();
            
            // CRITICAL: Load Hydrolang and wait for lang to be ready
            this.showLoading(true, 'Loading visualization libraries...');
            try {
                // Wait for HydroSuite to be initialized
                await this.waitForHydrolang();
                
                // CRITICAL: Wait for lang to be ready
                if (window.lang && window.lang.map && window.lang.visualize) {
                    console.log('✓ Hydrolang lang ready - visualizations enabled');
                } else {
                    throw new Error('lang not available after initialization');
                }
            } catch (hydrolangError) {
                console.error('Hydrolang failed to load:', hydrolangError);
                this.showError('Visualization libraries failed to load. Maps and charts will not be available.');
                // Continue - basic functionality still works
            }
            
            this.showLoading(false);
            this.initialized = true;
            console.log('Application initialized successfully');
            
        } catch (error) {
            console.error('Fatal error during initialization:', error);
            this.showError(`Application failed to start: ${error.message}`);
            this.showLoading(false);
            throw error;
        }
    }

    /**
     * Show/hide loading spinner with message
     * @param {boolean} show - Whether to show the spinner
     * @param {string} message - Message to display
     */
    showLoading(show, message = 'Loading...') {
        let loadingEl = document.getElementById('loading-spinner');
        
        if (!loadingEl) {
            loadingEl = document.createElement('div');
            loadingEl.id = 'loading-spinner';
            loadingEl.className = 'loading-container';
            loadingEl.innerHTML = `
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p id="loading-message">Loading...</p>
                <div id="loading-progress" class="text-muted mt-2" style="font-size: 0.8rem;"></div>
            `;
            document.body.appendChild(loadingEl);
        }
        
        if (show) {
            loadingEl.style.display = 'flex';
            document.getElementById('loading-message').textContent = message;
        } else {
            loadingEl.style.display = 'none';
        }
    }

    /**
     * Load application info from the exported data
     */
    async loadAppInfo() {
        try {
            const appInfoResponse = await fetch('data/app-info.json');
            this.appInfo = await appInfoResponse.json();
            console.log('App info loaded:', this.appInfo);
        } catch (error) {
            console.error('Error loading app info:', error);
            this.appInfo = {
                version: "unknown",
                exportDate: new Date().toISOString(),
                name: "HydroBlox"
            };
        }
    }

    /**
     * Wait for Hydrolang to be available (loaded by the module system)
     */
    async waitForHydrolang() {
        return new Promise((resolve, reject) => {
            const timeout = 15000;
            let resolved = false;
            
            const markResolved = (success = true) => {
                if (resolved) return;
                resolved = true;
                
                if (success) {
                    this.hydrolangLoaded = true;
                    resolve();
                } else {
                    this.hydrolangLoaded = false;
                    resolve(); // Resolve anyway to allow app to continue
                }
            };
            
            // Check if Hydrolang is already available and initialized
            if (window.lang && window.lang.map && window.lang.visualize) {
                this.hydrolangLoaded = true;
                console.log('✓ Hydrolang already loaded and ready');
                    return markResolved(true);
            }
            
            // Check if Hydrolang class is available but not initialized
            if (window.Hydrolang) {
                try {
                    window.lang = new window.Hydrolang();
                    this.hydrolangLoaded = true;
                    console.log('✓ Hydrolang initialized successfully');
                    markResolved(true);
                    return;
                } catch (error) {
                    console.error('Failed to initialize Hydrolang:', error);
                    return markResolved(false);
                }
            }
            
            // Set up event listener for when modules are loaded
            const modulesLoadedHandler = () => {
                console.log('Hydrolang loaded via modules-loaded event');
                markResolved(true);
            };
            document.addEventListener('modules-loaded', modulesLoadedHandler, { once: true });
            
            // Listen for module load errors
            const errorHandler = (event) => {
                console.error('Module loading error:', event.detail);
                markResolved(false);
            };
            document.addEventListener('modules-load-error', errorHandler, { once: true });
            
            // Set timeout in case modules never load
            const timeoutId = setTimeout(() => {
                if (!resolved) {
                    console.error(`CRITICAL: Hydrolang did not load within ${timeout}ms`);
                    console.error('Maps and visualizations will not work');
                    console.error('Check browser console for module loading errors');
                    markResolved(false);
                }
            }, timeout);
            
            // Cleanup function
            const cleanup = () => {
                clearTimeout(timeoutId);
                document.removeEventListener('modules-loaded', modulesLoadedHandler);
                document.removeEventListener('modules-load-error', errorHandler);
            };
            
            // Ensure cleanup happens
            Promise.resolve().then(() => {
                if (resolved) cleanup();
            });
        });
    }

    /**
     * Set up the user interface
     */
    setupUI() {
        // Load app info first to get title and description
        this.loadAppInfo().then(() => {
            // Load and apply layout configuration
            return this.loadLayoutConfig();
        }).then(() => {
            // Make sure the display is full screen
            this.adjustFullScreen();
            
            // Initialize workflow select
            this.populateWorkflowSelect();
            
            // Initialize visualization container
            this.initializeVisualizationContainer();
            
            // CRITICAL: Display app title and description AFTER layout config is loaded
            // This ensures showcaseHeader and showcaseSubheader are available
            this.displayAppInfo();
            
            // Initialize Data Summary updates
            this.updateDataSummary();
        }).catch((error) => {
            console.error('Error setting up UI:', error);
        });
    }
    
    /**
     * Display application info (title and description) in the UI
     */
    displayAppInfo() {
        if (!this.appInfo) return;
        
        // CRITICAL: Get custom header and subheader from layout config
        const layoutConfig = this.layoutConfig || {};
        const showcaseHeader = layoutConfig.showcaseHeader || this.appInfo.title || 'HydroBlox Application';
        const showcaseSubheader = layoutConfig.showcaseSubheader || layoutConfig.description || this.appInfo.description || '';
        
        // Update page title
        if (this.appInfo.title || layoutConfig.showcaseHeader) {
            document.title = showcaseHeader;
        }
        
        // Update header title if available
        const headerTitle = document.querySelector('.app-title');
        if (headerTitle) {
            headerTitle.textContent = showcaseHeader;
        }
        
        // CRITICAL: Display application name and description in results-header style
        // Always show if showcaseHeader or showcaseSubheader is provided
        if (layoutConfig.showcaseHeader || layoutConfig.showcaseSubheader) {
            // Remove any existing showcase container first
            const existingContainer = document.querySelector('.showcase-container');
            if (existingContainer) {
                existingContainer.remove();
            }
            
            // Get content-grid for width matching
            const contentGrid = document.querySelector('.content-grid');
            const gridStyles = contentGrid ? window.getComputedStyle(contentGrid) : null;
            
            // Create showcase container styled like results-header (same width as content-grid, slight bevel, no shadow)
            const showcaseContainer = document.createElement('div');
            showcaseContainer.className = 'showcase-container results-header';
            showcaseContainer.style.cssText = `
                background: #fff;
                border-bottom: 1px solid #e1e5e9;
                padding: 12px;
                margin: 0;
                box-shadow: none;
                border: 1px solid #e1e5e9;
                border-radius: 0;
                border-top: none;
                ${gridStyles ? `width: ${gridStyles.width}; max-width: ${gridStyles.maxWidth || '100%'}; padding-left: ${gridStyles.paddingLeft}; padding-right: ${gridStyles.paddingRight};` : ''}
            `;
            
            // Create inner container for content
            const innerContainer = document.createElement('div');
            innerContainer.style.cssText = 'display: flex; flex-direction: column; gap: 0.5rem;';
            
            // Create application name section (display up top)
            if (showcaseHeader && showcaseHeader.trim()) {
                const appNameSection = document.createElement('div');
                appNameSection.style.cssText = 'font-size: 1.25rem; font-weight: 600; color: #212529; margin-bottom: 0.25rem;';
                appNameSection.textContent = showcaseHeader;
                innerContainer.appendChild(appNameSection);
            }
            
            // Create description section (paragraph style, smaller text)
            if (showcaseSubheader && showcaseSubheader.trim()) {
                const descSection = document.createElement('div');
                descSection.style.cssText = `
                    font-size: 0.95rem;
                    line-height: 1.6;
                    color: #495057;
                    word-wrap: break-word;
                    overflow-wrap: break-word;
                    white-space: pre-wrap;
                    max-height: 50vh;
                    overflow-y: auto;
                `;
                descSection.textContent = showcaseSubheader;
                innerContainer.appendChild(descSection);
            }
            
            showcaseContainer.appendChild(innerContainer);
            
            // Insert at the top, before results-header
            const resultsHeader = document.querySelector('.results-header');
            const resultsWrapper = document.querySelector('.results-wrapper');
            if (resultsHeader && resultsHeader.parentNode) {
                resultsHeader.parentNode.insertBefore(showcaseContainer, resultsHeader);
            } else if (resultsWrapper) {
                resultsWrapper.insertBefore(showcaseContainer, resultsWrapper.firstChild);
            } else {
                document.body.insertBefore(showcaseContainer, document.body.firstChild);
            }
            
            console.log('✓ Displayed custom header/subheader:', { showcaseHeader, showcaseSubheader });
        }
        
        // Display description using the same method as applyLayout (if not using showcase)
        if (this.appInfo.description && this.appInfo.description.trim() && !layoutConfig.showcaseSubheader) {
            const config = { description: this.appInfo.description };
            this.applyLayout(config);
        }
    }

    /**
     * Load and apply layout configuration
     */
    async loadLayoutConfig() {
        try {
            const response = await fetch('data/layout.json');
            if (!response.ok) return; // Use default layout if file doesn't exist
            
            const layoutConfig = await response.json();
            this.applyLayout(layoutConfig);
        } catch (error) {
            console.warn('Error loading layout configuration:', error);
            // Continue with default layout
        }
    }

    /**
     * Apply the selected layout configuration
     */
    applyLayout(config) {
        const resultsWrapper = document.querySelector('.results-wrapper');
        if (!resultsWrapper) return;
        this.layoutConfig = config || this.layoutConfig;
        
        // Remove any existing layout classes
        resultsWrapper.classList.remove('layout-default', 'layout-full-width', 'layout-split', 'layout-showcase');
        
        // Apply selected layout
        switch (config.type) {
            case 'full-width':
                resultsWrapper.classList.add('layout-full-width');
                this.applyFullWidthLayout();
                break;
            
            case 'split':
                resultsWrapper.classList.add('layout-split');
                this.applySplitLayout(config.split);
                break;
            
            case 'showcase':
                resultsWrapper.classList.add('layout-showcase');
                this.applyShowcaseLayout(config);
                break;
            
            case 'custom':
                if (config.custom) {
                    this.applyCustomLayout(config.custom);
                }
                break;
            
            default: // 'default'
                resultsWrapper.classList.add('layout-default');
                break;
        }

        // Apply sidebar visibility
        if (typeof config.sidebar === 'boolean') {
            const sidebar = document.querySelector('.results-sidebar');
            if (sidebar) sidebar.style.display = config.sidebar ? '' : 'none';
        }

        // Apply inclusion/filtering for sections
        const mapsSection = document.getElementById('maps-section');
        const chartsSection = document.getElementById('charts-section');
        const tablesSection = document.getElementById('tables-section');
        if (config.include) {
            if (mapsSection) mapsSection.style.display = config.include.maps === false ? 'none' : 'block';
            if (chartsSection) chartsSection.style.display = config.include.charts === false ? 'none' : 'block';
            if (tablesSection) tablesSection.style.display = config.include.tables === false ? 'none' : 'block';
        } else {
            // Default: show all sections
            if (mapsSection) mapsSection.style.display = 'block';
            if (chartsSection) chartsSection.style.display = 'block';
            if (tablesSection) tablesSection.style.display = 'block';
        }

        // Ensure primary tab is visible if specified
        if (config.primary) {
            const sections = { maps: mapsSection, charts: chartsSection, tables: tablesSection };
            Object.entries(sections).forEach(([key, section]) => {
                if (!section) return;
                // If section is set to be included and is primary, show it
                if (config.primary === key && (config.include?.[key] !== false)) {
                    section.style.display = '';
                }
            });
        }

        // Render description if provided - create a prominent description section
        if (config.description && config.description.trim()) {
            // Try to find existing description container or create one
            let descContainer = document.getElementById('app-description-container');
            if (!descContainer) {
                descContainer = document.createElement('div');
                descContainer.id = 'app-description-container';
                descContainer.className = 'app-description-container';
                descContainer.style.cssText = 'background: transparent; border: none; padding: 1rem 0; margin: 1rem 0; border-bottom: 1px solid #e9ecef;';
                
                // Insert at the top of main content, after header
                const mainContent = document.querySelector('.main-content') || document.querySelector('.app-container');
                if (mainContent) {
                    mainContent.insertBefore(descContainer, mainContent.firstChild);
                } else {
                    document.body.insertBefore(descContainer, document.body.firstChild);
                }
            }
            
            // Format description with line breaks
            const formattedDesc = config.description
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .map(line => {
                    // Convert bullet points
                    if (line.startsWith('•') || line.startsWith('-')) {
                        return `<li>${line.substring(1).trim()}</li>`;
                    }
                    return `<p>${line}</p>`;
                })
                .join('');
            
            const hasList = formattedDesc.includes('<li>');
            descContainer.innerHTML = `
                <div class="app-description-content" style="background: transparent; border: none; padding: 0.5rem 0;">
                    <div class="app-description-text" style="color: #495057; line-height: 1.6;">
                        ${hasList ? '<ul class="app-description-list" style="margin: 0; padding-left: 1.5rem;">' + formattedDesc.replace(/<p>/g, '').replace(/<\/p>/g, '') + '</ul>' : formattedDesc}
                    </div>
                </div>
            `;
        }
    }

    /**
     * Ensure visualization container exists to prevent runtime errors
     */
    initializeVisualizationContainer() {
        let container = document.getElementById('visualization-container');
        if (!container) {
            const vizSection = document.querySelector('.visualization-section') || document.createElement('div');
            if (!vizSection.parentNode) {
                vizSection.className = 'visualization-section';
                const wrapper = document.querySelector('.results-wrapper') || document.body;
                wrapper.appendChild(vizSection);
            }
            container = document.createElement('div');
            container.id = 'visualization-container';
            vizSection.appendChild(container);
        }
    }

    /**
     * Apply full-width layout adjustments
     */
    applyFullWidthLayout() {
        const visualizationSection = document.querySelector('.visualization-section');
        const controlPanel = document.querySelector('.control-panel');
        
        if (visualizationSection && controlPanel) {
            controlPanel.style.height = 'auto';
            visualizationSection.style.flex = '1';
            visualizationSection.style.maxWidth = '100%';
        }
    }

    /**
     * Apply split layout adjustments
     */
    applySplitLayout(splitPercent = 50) {
        const visualizationSection = document.querySelector('.visualization-section');
        if (!visualizationSection) return;
        
        // Create second visualization container if needed
        let secondViz = document.querySelector('.visualization-section-split');
        if (!secondViz) {
            secondViz = visualizationSection.cloneNode(true);
            secondViz.classList.add('visualization-section-split');
            visualizationSection.parentNode.appendChild(secondViz);
        }
        
        // Style containers for split view based on ratio
        const left = Math.max(20, Math.min(80, Number(splitPercent) || 50));
        const right = 100 - left;
        visualizationSection.style.width = left + '%';
        secondViz.style.width = right + '%';
    }

    /**
     * Apply showcase layout - single page application with header, description, and results sections
     */
    applyShowcaseLayout(config) {
        const appContainer = document.querySelector('.app-container') || document.body;
        const resultsWrapper = document.querySelector('.results-wrapper');
        
        // Hide sidebar and controls for showcase layout
        const sidebar = document.querySelector('.results-sidebar');
        const controlPanel = document.querySelector('.control-panel');
        if (sidebar) sidebar.style.display = 'none';
        if (controlPanel) controlPanel.style.display = 'none';
        
        // Create showcase structure if it doesn't exist
        let showcaseContainer = document.getElementById('showcase-container');
        if (!showcaseContainer) {
            showcaseContainer = document.createElement('div');
            showcaseContainer.id = 'showcase-container';
            showcaseContainer.className = 'showcase-container';
            
            // Insert after header or at the beginning of body
            const header = document.querySelector('.app-header');
            if (header && header.nextSibling) {
                header.parentNode.insertBefore(showcaseContainer, header.nextSibling);
            } else {
                appContainer.insertBefore(showcaseContainer, appContainer.firstChild);
            }
        }
        
        // Clear existing content
        showcaseContainer.innerHTML = '';
        
        // Create header section
        const headerSection = document.createElement('div');
        headerSection.className = 'showcase-header';
        // Use showcase-specific header, fallback to app title, then default
        const headerTitle = config.showcaseHeader || config.title || this.appInfo?.title || 'HydroBlox Application';
        headerSection.innerHTML = `
            <h1 class="showcase-title">${headerTitle}</h1>
        `;
        showcaseContainer.appendChild(headerSection);
        
        // Create subheader/description section if showcase subheader exists
        const subheaderText = config.showcaseSubheader || config.description;
        if (subheaderText && subheaderText.trim()) {
            const descSection = document.createElement('div');
            descSection.className = 'showcase-description';
            
            // Format description with line breaks
            const formattedDesc = subheaderText
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .map(line => {
                    // Convert bullet points
                    if (line.startsWith('•') || line.startsWith('-')) {
                        return `<li>${line.substring(1).trim()}</li>`;
                    }
                    return `<p>${line}</p>`;
                })
                .join('');
            
            const hasList = formattedDesc.includes('<li>');
            descSection.innerHTML = `
                <div class="showcase-description-content">
                    ${hasList ? '<ul class="showcase-description-list">' + formattedDesc.replace(/<p>/g, '').replace(/<\/p>/g, '') + '</ul>' : formattedDesc}
                </div>
            `;
            showcaseContainer.appendChild(descSection);
        }
        
        // Create results section
        const resultsSection = document.createElement('div');
        resultsSection.className = 'showcase-results';
        
        // Move visualization container into showcase results
        const visualizationContainer = document.getElementById('visualization-container');
        if (visualizationContainer) {
            resultsSection.appendChild(visualizationContainer);
        } else {
            // Create visualization container if it doesn't exist
            const vizContainer = document.createElement('div');
            vizContainer.id = 'visualization-container';
            resultsSection.appendChild(vizContainer);
        }
        
        showcaseContainer.appendChild(resultsSection);
        
        // Ensure workflow selector is visible but styled for showcase
        const workflowSelect = document.getElementById('workflow-select');
        if (workflowSelect) {
            workflowSelect.style.display = 'block';
            workflowSelect.style.marginBottom = '1rem';
            workflowSelect.style.width = '100%';
            workflowSelect.style.maxWidth = '400px';
            workflowSelect.style.margin = '0 auto 1.5rem auto';
        }
    }

    /**
     * Apply custom layout dimensions
     */
    applyCustomLayout(customConfig) {
        // Apply custom control panel height
        if (customConfig.controls?.height) {
            const controlPanel = document.querySelector('.control-panel');
            if (controlPanel) {
                controlPanel.style.height = customConfig.controls.height;
            }
        }
        
        // Apply custom visualization dimensions
        if (customConfig.visualization) {
            const visualizationSection = document.querySelector('.visualization-section');
            if (visualizationSection) {
                if (customConfig.visualization.width) {
                    visualizationSection.style.width = customConfig.visualization.width;
                }
                if (customConfig.visualization.height) {
                    visualizationSection.style.height = customConfig.visualization.height;
                }
            }
        }
        
        // Apply custom sidebar dimensions
        if (customConfig.sidebar?.width) {
            const sidebar = document.querySelector('.results-sidebar');
            if (sidebar) {
                sidebar.style.width = customConfig.sidebar.width;
            }
        }
    }
    
    /**
     * Adjust the display to be full screen
     */
    adjustFullScreen() {
        const resultsWrapper = document.querySelector('.results-wrapper');
        if (resultsWrapper) {
            resultsWrapper.style.position = 'absolute';
            resultsWrapper.style.top = '0';
            resultsWrapper.style.left = '0';
            resultsWrapper.style.right = '0';
            resultsWrapper.style.bottom = '0';
            resultsWrapper.style.width = '100%';
            resultsWrapper.style.height = '100%';
        }
    }

    async loadWorkflows() {
        try {
            const response = await fetch('data/workflows.json');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.text();
            if (!data || data.trim() === '') {
                throw new Error('Workflows file is empty');
            }
            
            const parsedData = JSON.parse(data);
            
            // CRITICAL: Validate and normalize workflow structure
            if (!parsedData || typeof parsedData !== 'object') {
                throw new Error('Invalid workflow data format');
            }
            
            // CRITICAL: Only load workflows from the exported file (not from IndexedDB)
            // This ensures we only get the workflows that were selected for export
            this.workflows = {};
            
            // Handle case where workflows might be an array instead of object
            if (Array.isArray(parsedData)) {
                console.warn('Workflows data is an array, converting to object structure');
                parsedData.forEach((workflow, index) => {
                    const workflowId = workflow.id || workflow.workflowId || `workflow-${index}`;
                    // Only include if it has items array (is a workflow)
                    if (workflow.items && Array.isArray(workflow.items)) {
                    this.workflows[workflowId] = workflow;
                    } else {
                        console.warn(`Skipping entry "${workflowId}" - not a valid workflow (missing items array)`);
                    }
                });
            } else {
                // Validate that entries are workflows, not items
                for (const [key, value] of Object.entries(parsedData)) {
                    // Check if this is a workflow (has 'items' array) or an item (has 'uniqueId')
                    if (value && typeof value === 'object') {
                        if (value.items && Array.isArray(value.items)) {
                            // This is a workflow - include it
                            this.workflows[key] = value;
                        } else if (value.uniqueId || value.itemName) {
                            // This is an item, not a workflow - skip it
                            console.warn(`Skipping item "${key}" - items should be nested in workflows`);
                            continue;
                        } else {
                            // Unknown structure - skip it
                            console.warn(`Skipping unknown structure for key "${key}"`);
                            continue;
                        }
                    }
                }
            }
            
            // Validate workflow structure
            if (!this.workflows || typeof this.workflows !== 'object') {
                throw new Error('Invalid workflow data format');
            }
            
            const workflowCount = Object.keys(this.workflows).length;
            console.log(`Loaded ${workflowCount} workflow(s)`);
            
            if (workflowCount === 0) {
                console.warn('No workflows found in export');
            }
            
            return this.workflows;
        } catch (error) {
            console.error('Error loading workflows:', error);
            // Return empty workflows object to allow app to continue
            this.workflows = {};
            throw new Error(`Failed to load workflows: ${error.message}`);
        }
    }

    populateWorkflowSelect() {
        const select = document.getElementById('workflow-select');
        if (!select || !this.workflows) return;

        console.log('Populating workflow select with:', this.workflows);

        // Clear existing options
        select.innerHTML = '<option value="">Select Workflow</option>';

        // Add workflow options
        Object.entries(this.workflows).forEach(([id, workflow]) => {
            console.log(`Adding workflow option: ID="${id}", Name="${workflow.name}"`);
            const option = document.createElement('option');
            option.value = id;
            option.textContent = workflow.name || id; // Fallback to ID if name is missing
            select.appendChild(option);
        });
        
        console.log(`✓ Added ${Object.keys(this.workflows).length} workflow(s) to dropdown`);
    }

    async loadWorkflow(workflowId) {
        const workflow = this.workflows[workflowId];
        if (!workflow) {
            console.warn(`Workflow ${workflowId} not found`);
            return;
        }

        console.log(`Loading workflow: ${workflow.name} (ID: ${workflowId})`);
        console.log('Workflow structure:', workflow);

        this.currentWorkflow = workflow;
        this.currentWorkflowId = workflowId;
        
        // CRITICAL: Populate dataset select with items from THIS workflow only
        this.populateDatasetSelect(workflowId);
        
        // Update workflow info
        this.updateWorkflowInfo(workflow);
        
        // Clear existing visualizations
        this.clearVisualizations();
        
        // Update metrics
        this.updateMetrics(workflow);
        
        // Update Data Summary
        this.updateDataSummary();
    }
    
    /**
     * Populate dataset select dropdown with items from the selected workflow
     */
    populateDatasetSelect(workflowId) {
        const datasetSelect = document.getElementById('dataset-select');
        if (!datasetSelect) return;
        
        const workflow = this.workflows[workflowId];
        if (!workflow || !workflow.items) {
            datasetSelect.innerHTML = '<option value="">No items available</option>';
            return;
        }
        
        // Clear existing options
        datasetSelect.innerHTML = '<option value="">Select Dataset/Item</option>';
        
        // CRITICAL: Show ALL items from the selected workflow (including visualization items)
        // This matches the main application behavior - visualization items appear in dropdown
        const items = Array.isArray(workflow.items) ? workflow.items : [];
        items.forEach(item => {
            const option = document.createElement('option');
            option.value = item.uniqueId;
            // Use display name if available, otherwise use itemName or uniqueId
            const displayName = item.name || item.settings?.name || item.itemName || item.settings?.itemName || item.uniqueId;
            option.textContent = displayName;
            datasetSelect.appendChild(option);
        });
        
        console.log(`✓ Populated dataset select with ${items.length} items from workflow ${workflowId}`);
    }

    updateWorkflowInfo(workflow) {
        const infoDiv = document.getElementById('workflow-info');
        if (!infoDiv) return;

        const itemsArray = Array.isArray(workflow.items) ? workflow.items : [];
        const connectionsArray = Array.isArray(workflow.connections) ? workflow.connections : [];

        infoDiv.innerHTML = `
            <h3>${workflow.name}</h3>
            <p>Items: ${itemsArray.length}</p>
            <p>Connections: ${connectionsArray.length}</p>
        `;
    }

    clearVisualizations() {
        // Clear all visualization sections like results manager does
        const mapsSection = document.getElementById('maps-section');
        const chartsSection = document.getElementById('charts-section');
        const tablesSection = document.getElementById('tables-section');
        
        if (mapsSection) {
            while (mapsSection.firstChild) {
                mapsSection.removeChild(mapsSection.firstChild);
            }
        }
        if (chartsSection) {
            while (chartsSection.firstChild) {
                chartsSection.removeChild(chartsSection.firstChild);
            }
        }
        if (tablesSection) {
            while (tablesSection.firstChild) {
                tablesSection.removeChild(tablesSection.firstChild);
            }
        }
        
        this.visualizations.clear();
        this.mapInitialized = false;
    }

    /**
     * Handle an item from the workflow - matches results manager behavior
     */
    async handleItem(item) {
        // CRITICAL: Get itemName from multiple sources and normalize it (matches results-manager.js)
        // Check for corrupted itemNames (e.g., "Layers--01", "item-name", etc.)
        let itemName = item.itemName || item.settings?.itemName || '';
        const itemType = item.type || item.settings?.type || '';
        const uniqueId = item.uniqueId || '';
        const name = item.name || item.settings?.name || '';
        
        // CRITICAL: Try to recover correct itemName if corrupted (matches results-manager.js logic)
        if (!['renderMap', 'Layers', 'draw', 'addCustomLegend'].includes(itemName)) {
            // Try to recover from name attribute (e.g., "Layers--01" or "renderMap--02")
            if (name) {
                const nameMatch = name.match(/(Layers|renderMap|draw|addCustomLegend)/i);
                if (nameMatch) {
                    itemName = nameMatch[1] === 'Layers' ? 'Layers' : 
                              nameMatch[1].toLowerCase() === 'rendermap' ? 'renderMap' : 
                              nameMatch[1].toLowerCase();
                }
            }
            // Try to recover from uniqueId
            if (!['renderMap', 'Layers', 'draw', 'addCustomLegend'].includes(itemName)) {
                if (uniqueId.match(/layers/i)) {
                    itemName = 'Layers';
                } else if (uniqueId.match(/rendermap/i)) {
                    itemName = 'renderMap';
                } else if (uniqueId.match(/draw/i)) {
                    itemName = 'draw';
                }
            }
            // Check type as fallback
            if (itemType === 'visualization' && !['renderMap', 'Layers', 'draw', 'addCustomLegend'].includes(itemName)) {
                // If it's a visualization type but no itemName, check uniqueId pattern
                if (uniqueId.match(/layers/i)) {
                    itemName = 'Layers';
                } else if (uniqueId.match(/rendermap/i)) {
                    itemName = 'renderMap';
                } else {
                    itemName = 'draw'; // Default fallback
                }
            }
        }
        
        console.log(`handleItem() called for: ${uniqueId}`, {
            itemName,
            itemType,
            name,
            uniqueId,
            parameters: item.parameters || item.settings?.parameters,
            fullItem: item
        });
        
        // CRITICAL: Handle Code Blocks - they need their code and settings preserved
        if (itemName === 'Code Block' || item.settings?.codeBlockType === 'code') {
            console.log(`Code Block item: ${item.name || item.uniqueId} (${item.settings?.language || 'javascript'})`);
            return;
        }
        
        // Determine the type of item (maps, charts, or tables) - matches results-manager.js handleDatasetSelection
        let type;
        if (itemName === 'renderMap' || itemName === 'Layers') {
            type = 'maps';
        } else if (itemName === 'draw' && (item.parameters?.type === 'chart' || item.settings?.parameters?.type === 'chart')) {
            type = 'charts';
        } else if (itemName === 'draw' && (item.parameters?.type === 'table' || item.settings?.parameters?.type === 'table')) {
            type = 'tables';
        } else {
            // For non-visualization items, try to create a quick visualization if results exist
            console.log(`Item ${itemName} is not a recognized visualization item, trying quick visualization`);
            if (item.results) {
                await this.createVisualization(item.uniqueId, item);
            }
            return;
        }
        
        console.log(`Determined visualization type: ${type} for item: ${itemName}`);
        
        // Switch to the appropriate tab
        this.showVisualizationTab(type);
        console.log(`Switched to ${type} tab`);
        
        // Handle the item based on its type (matches results-manager.js handleDatasetSelection)
        try {
            switch (type) {
                case 'maps':
                    if (itemName === 'Layers') {
                        console.log(`Calling addLayersToMap() for: ${uniqueId}`);
                        await this.addLayersToMap(item);
                    } else {
                        console.log(`Calling populateMaps() for: ${uniqueId}`);
                        await this.populateMaps(item);
                    }
                    break;
                case 'charts':
                case 'tables':
                    console.log(`Calling handleDrawItems() for: ${uniqueId} (type: ${type})`);
                    await this.handleDrawItems(item);
                    break;
            }
            console.log(`✓ Successfully handled visualization item: ${itemName}`);
        } catch (error) {
            console.error(`Error handling visualization item ${itemName}:`, error);
            throw error;
        }
    }

    /**
     * Load item data from IndexedDB - matches results manager
     */
    async loadItemDataFromIndexedDB(uniqueId) {
        try {
            // Ensure database is ready
            if (!this.dbManager || !this.dbManager.ready) {
                console.warn('Database not ready, attempting to initialize...');
                if (this.dbManager && typeof this.dbManager.initDB === 'function') {
                    await this.dbManager.initDB();
                }
            }

            if (this.dbManager && typeof this.dbManager.getResult === 'function') {
                const result = await this.dbManager.getResult(uniqueId);
                if (result) {
                    // The db-manager stores items with structure: { uniqueId, workflowId, itemName, timestamp, data }
                    return result.data !== undefined ? result.data : null;
                }
            }
            
            // Fallback: try to load from data/items folder
            try {
                const response = await fetch(`data/items/${uniqueId}.json`);
                if (response.ok) {
                    const json = await response.json();
                    return json.data || null;
                }
            } catch (e) {
                console.warn(`Could not load data for ${uniqueId} from filesystem`);
            }
            return null;
        } catch (error) {
            console.error(`Error loading data for item ${uniqueId}:`, error);
            return null;
        }
    }

    /**
     * Handle draw items - matches results manager handleDrawItems
     */
    async handleDrawItems(drawItem) {
        try {
            const drawType = drawItem.parameters?.type || 'chart';
            
            // For tables, try to use createDataTable as fallback if Hydrolang is not available
            if (drawType === 'table' && (!window.lang || !window.lang.visualize || !window.lang.visualize.draw)) {
                console.warn('Hydrolang not available for table, using fallback createDataTable');
                // Fetch data and use createDataTable
                const dataIds = Array.isArray(drawItem.data) ? drawItem.data : [];
                const drawDataPromises = dataIds.map(depId => this.loadItemDataFromIndexedDB(depId));
                const drawData = await Promise.all(drawDataPromises);
                const validDrawData = drawData.filter(data => data != null);
                
                if (validDrawData.length > 0) {
                    const targetSection = document.getElementById('tables-section');
                    if (targetSection) {
                        const placeholder = targetSection.querySelector('.placeholder[data-type="table"]');
                        if (placeholder) placeholder.style.display = 'none';
                        targetSection.style.display = 'block';
                        targetSection.classList.add('active');
                        
                        // Clear and create container
                        while (targetSection.firstChild) {
                            targetSection.removeChild(targetSection.firstChild);
                        }
                        
                        const container = document.createElement('div');
                        container.className = 'table-container';
                        container.style.cssText = 'width: 100%; padding: 20px;';
                        targetSection.appendChild(container);
                        
                        // Use first data item for table display
                        this.createDataTable(container, validDrawData[0], drawItem.uniqueId);
                        console.log('✓ Created fallback table using createDataTable');
                        return;
                    }
                }
                return;
            }
            
            if (!window.lang || !window.lang.visualize || !window.lang.visualize.draw) {
                console.warn('Hydrolang visualize.draw not available');
                return;
            }

            // Prevent multiple simultaneous renders
            const renderKey = `${drawItem.uniqueId}_${drawItem.parameters?.type || 'chart'}`;
            if (this.currentlyRendering && this.currentlyRendering.has(renderKey)) {
                console.log(`Already rendering ${renderKey}, skipping...`);
                return;
            }
            
            if (!this.currentlyRendering) {
                this.currentlyRendering = new Set();
            }
            this.currentlyRendering.add(renderKey);

            try {
                // Fetch all dependency data from IndexedDB
                const dataIds = Array.isArray(drawItem.data) ? drawItem.data : [];
                const drawDataPromises = dataIds.map(depId => this.loadItemDataFromIndexedDB(depId));
                const drawData = await Promise.all(drawDataPromises);

                // Filter out any null or undefined data
                const validDrawData = drawData.filter(data => data != null);

                if (validDrawData.length === 0) {
                    console.warn(`No valid data found for draw item ${drawItem.uniqueId}`);
                    return;
                }

                const drawType = drawItem.parameters?.type || 'chart';
                let targetSection = document.getElementById(`${drawType}s-section`);

                if (!targetSection) {
                    console.error(`Target section ${drawType}s-section not found`);
                    return;
                }
                
                // CRITICAL: Hide placeholder and ensure section is visible
                const placeholder = targetSection.querySelector(`.placeholder[data-type="${drawType}"]`);
                if (placeholder) {
                    placeholder.style.display = 'none';
                }
                
                // Ensure section is visible
                targetSection.style.display = 'block';
                targetSection.classList.add('active');

                // Clear existing content
                while (targetSection.firstChild) {
                    targetSection.removeChild(targetSection.firstChild);
                }
                
                // Force DOM reflow
                targetSection.offsetHeight;
                
                // Small delay to ensure clearing is complete
                await new Promise(resolve => setTimeout(resolve, 100));

                // Generate unique container ID
                const uniqueContainerId = `${drawItem.uniqueId}_${Date.now()}`;
                
                // Create container
                const container = document.createElement('div');
                container.id = uniqueContainerId;
                container.className = `${drawType}-container`;
                container.style.cssText = 'width: 100%; height: 100%; min-height: 400px; display: block; position: relative;';
                targetSection.appendChild(container);

                // Small delay to ensure container is in DOM
                await new Promise(resolve => setTimeout(resolve, 50));

                // Prepare draw parameters with unique container ID
                const drawParams = {
                    params: {
                        ...drawItem.parameters,
                        id: uniqueContainerId,
                    },
                    args: {
                        ...drawItem.arguments,
                        responsive: true
                    },
                    data: validDrawData,
                };

                console.log(`Rendering ${drawType} in container: ${uniqueContainerId}`);
                
                // CRITICAL: Ensure lang is ready
                if (!window.lang || !window.lang.visualize || !window.lang.visualize.draw) {
                    console.warn('Hydrolang visualize.draw not available', {
                        lang: !!window.lang,
                        visualize: !!window.lang?.visualize,
                        draw: !!window.lang?.visualize?.draw
                    });
                    return;
                }
                
                // Call the draw function
                await window.lang.visualize.draw(drawParams);
                
                console.log(`Successfully rendered ${drawType}: ${drawItem.uniqueId} in ${uniqueContainerId}`);

            } finally {
                // Remove from rendering tracker
                if (this.currentlyRendering) {
                    this.currentlyRendering.delete(renderKey);
                }
            }

        } catch (error) {
            console.error('Error handling draw item:', error);
            
            // Show error message
            const drawType = drawItem.parameters?.type || 'chart';
            const targetSection = document.getElementById(`${drawType}s-section`);
            
            // For tables, try fallback to createDataTable if visualization failed
            if (drawType === 'table' && targetSection) {
                try {
                    const dataIds = Array.isArray(drawItem.data) ? drawItem.data : [];
                    const drawDataPromises = dataIds.map(depId => this.loadItemDataFromIndexedDB(depId));
                    const drawData = await Promise.all(drawDataPromises);
                    const validDrawData = drawData.filter(data => data != null);
                    
                    if (validDrawData.length > 0) {
                        // Clear error and create fallback table
                        targetSection.innerHTML = '';
                        const container = document.createElement('div');
                        container.className = 'table-container';
                        container.style.cssText = 'width: 100%; padding: 20px;';
                        targetSection.appendChild(container);
                        this.createDataTable(container, validDrawData[0], drawItem.uniqueId);
                        console.log('✓ Created fallback table after visualization error');
                        return;
                    }
                } catch (fallbackError) {
                    console.error('Fallback table creation also failed:', fallbackError);
                }
            }
            
            if (targetSection) {
                targetSection.innerHTML = '<div class="error-message" style="padding: 20px; text-align: center; color: #dc3545;">Failed to render visualization. Please try again.</div>';
            }
            
            // Clean up rendering tracker
            if (this.currentlyRendering) {
                const renderKey = `${drawItem.uniqueId}_${drawItem.parameters?.type || 'chart'}`;
                this.currentlyRendering.delete(renderKey);
            }
        }
    }

    /**
     * Populate maps - matches results manager populateMaps
     */
    async populateMaps(mapItem) {
        try {
            // CRITICAL: Ensure lang is ready
            if (!window.lang || !window.lang.map || !window.lang.map.renderMap) {
                console.warn('Hydrolang map.renderMap not available', {
                    lang: !!window.lang,
                    map: !!window.lang?.map,
                    renderMap: !!window.lang?.map?.renderMap
                });
                return;
            }

            const mapsSection = document.getElementById('maps-section');
            if (!mapsSection) {
                console.error('Maps section not found');
                return;
            }

            // CRITICAL: Hide placeholder and ensure section is visible
            const placeholder = mapsSection.querySelector('.placeholder[data-type="map"]');
            if (placeholder) {
                placeholder.style.display = 'none';
            }
            
            // Ensure maps section is visible
            mapsSection.style.display = 'block';
            mapsSection.classList.add('active');

            // CRITICAL: Use existing #map container or create it if it doesn't exist
            let mapContainer = document.getElementById('map');
            if (!mapContainer) {
                console.log('Map container #map not found, creating it...');
                // Create the map container if it doesn't exist (matches main app structure)
                mapContainer = document.createElement('div');
                mapContainer.id = 'map';
                // Insert after placeholder but before maps-grid (if exists)
                const mapsGrid = mapsSection.querySelector('.maps-grid');
                if (mapsGrid) {
                    mapsSection.insertBefore(mapContainer, mapsGrid);
                } else {
                    mapsSection.appendChild(mapContainer);
                }
                console.log('✓ Created map container');
            }
            
            // Clear existing map content and show container
            mapContainer.innerHTML = '';
            mapContainer.style.display = 'block';
            mapContainer.style.width = '100%';
            mapContainer.style.height = '500px'; // Set explicit height for visibility
            mapContainer.style.minHeight = '400px';
            mapContainer.style.position = 'relative';
            mapContainer.style.visibility = 'visible';

            // Use the container ID directly
            const uniqueContainerId = 'map';

            // Small delay to ensure container is in DOM
            await new Promise(resolve => setTimeout(resolve, 50));

            // Prepare map parameters (matches main app pattern - no data for renderMap)
            const mapParams = {
                params: {
                    maptype: mapItem.parameters?.maptype || 'leaflet',
                    lat: mapItem.parameters?.lat || 40.75,
                    lon: mapItem.parameters?.lon || -111.87,
                    id: uniqueContainerId,
                    ...mapItem.parameters
                },
                args: {
                    zoom: mapItem.arguments?.zoom || 10,
                    ...mapItem.arguments
                }
                // NO data parameter - renderMap just initializes the map
            };

            console.log(`Rendering map in container: ${uniqueContainerId}`);
            
            // CRITICAL: Ensure lang is ready
            if (!window.lang || !window.lang.map || !window.lang.map.renderMap) {
                console.warn('Hydrolang map.renderMap not available', {
                    lang: !!window.lang,
                    map: !!window.lang?.map,
                    renderMap: !!window.lang?.map?.renderMap
                });
                return;
            }
            
            // Render the map
            await window.lang.map.renderMap(mapParams);
            
            // CRITICAL: Ensure container is visible and has dimensions after render
            mapContainer.style.display = 'block';
            mapContainer.style.visibility = 'visible';
            mapContainer.style.width = '100%';
            mapContainer.style.height = '500px'; // Set explicit height
            mapContainer.style.minHeight = '400px';
            
            this.mapInitialized = true;
            console.log(`Successfully rendered map: ${mapItem.uniqueId} in ${uniqueContainerId}`, {
                containerExists: !!mapContainer,
                containerVisible: mapContainer.style.display !== 'none',
                containerDimensions: {
                    width: mapContainer.offsetWidth,
                    height: mapContainer.offsetHeight
                }
            });

        } catch (error) {
            console.error('Error populating map:', error);
            const mapsSection = document.getElementById('maps-section');
            if (mapsSection) {
                mapsSection.innerHTML = '<div class="error-message" style="padding: 20px; text-align: center; color: #dc3545;">Failed to render map. Please try again.</div>';
            }
        }
    }

    /**
     * Add layers to map - matches results manager addLayersToMap
     */
    async addLayersToMap(layerItem) {
        // CRITICAL: If map not initialized, create a default map first
        if (!this.mapInitialized) {
            console.log('Map not initialized, creating default map first...');
            // Create a default map item to initialize the map
            const defaultMapItem = {
                uniqueId: 'default-map-for-layers',
                itemName: 'renderMap',
                parameters: {
                    maptype: 'leaflet',
                    lat: 40.75,
                    lon: -111.87
                },
                arguments: {
                    zoom: 10
                }
            };
            await this.populateMaps(defaultMapItem);
            
            // Wait a bit for map to be ready
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // CRITICAL: Ensure only one map container exists (prevent multiple Leaflet instances)
        const mapsSection = document.getElementById('maps-section');
        if (mapsSection) {
            // Remove any duplicate map containers, keep only the first one
            const mapContainers = mapsSection.querySelectorAll('.map-container');
            if (mapContainers.length > 1) {
                console.warn(`Found ${mapContainers.length} map containers, removing duplicates`);
                for (let i = 1; i < mapContainers.length; i++) {
                    mapContainers[i].remove();
                }
            }
        }

        try {
            // CRITICAL: Ensure lang is ready
            if (!window.lang || !window.lang.map || !window.lang.map.Layers) {
                console.warn('Hydrolang map.Layers not available', {
                    lang: !!window.lang,
                    map: !!window.lang?.map,
                    Layers: !!window.lang?.map?.Layers
                });
                return;
            }

            // CRITICAL: Load ALL connected data items (not just first one)
            const dataIds = Array.isArray(layerItem.data) ? layerItem.data : [];
            if (dataIds.length === 0) {
                // Try to get data from settings if not in item.data
                const settings = layerItem.settings || {};
                if (settings.data && Array.isArray(settings.data) && settings.data.length > 0) {
                    console.log(`Found data in settings.data, using that instead`);
                    dataIds.push(...settings.data);
                } else {
                    console.warn(`Layers item ${layerItem.uniqueId} has no data connections`);
                    return;
                }
            }

            // Load all layer data from IndexedDB
            const layerDataPromises = dataIds.map(depId => this.loadItemDataFromIndexedDB(depId));
            const layerDataArray = await Promise.all(layerDataPromises);

            // Filter out any null or undefined data
            const validLayerData = layerDataArray.filter(data => data != null);

            if (validLayerData.length === 0) {
                console.warn(`No valid data found for Layers item ${layerItem.uniqueId}`);
                return;
            }

            // CRITICAL: Layers can accept single data or array of data
            const layerData = validLayerData.length === 1 ? validLayerData[0] : validLayerData;

            const args = layerItem.arguments || {};
            const params = layerItem.parameters || {};

            console.log(`Adding layer to map: ${layerItem.uniqueId} with ${validLayerData.length} data source(s)`);

            await window.lang.map.Layers({
                args,
                params,
                data: layerData
            });

            console.log(`Successfully added layer: ${layerItem.uniqueId}`);

        } catch (error) {
            console.error('Error adding map layer:', error);
        }
    }

    /**
     * Create visualization for non-draw items (fallback)
     */
    async createVisualization(itemId, item) {
        const container = document.getElementById('visualization-container');
        if (!container) return;

        // Create visualization element
        const vizElement = document.createElement('div');
        vizElement.className = 'visualization-item';
        vizElement.id = `viz-${itemId}`;

        // Create visualization based on item type and data
        if (item.results) {
            const include = this.layoutConfig?.include || { maps: true, charts: true, tables: true };
            if (item.type === 'chart') {
                if (!include.charts) return;
                this.createChart(vizElement, item.results);
            } else if (item.type === 'map') {
                if (!include.maps) return;
                this.createMap(vizElement, item.results);
            } else if (item.type === 'table') {
                if (!include.tables) return;
                this.createTable(vizElement, item.results);
            }
        }

        container.appendChild(vizElement);
        this.visualizations.set(itemId, vizElement);
    }

    createChart(element, data) {
        // Use Hydrolang visualization if available
        if (window.suite && window.suite.lang && window.suite.lang.visualize && window.suite.lang.visualize.draw) {
            try {
                const containerId = `chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                element.innerHTML = `<div id="${containerId}" class="chart-container" style="width: 100%; height: 400px;"></div>`;

                // Prepare data for Hydrolang visualization
                const chartData = Array.isArray(data) ? data : [data];

                const drawParams = {
                    params: {
                        type: 'chart',
                        id: containerId,
                        name: data.title || 'Chart'
                    },
                    args: {
                        responsive: true,
                        chartType: data.chartType || 'line'
                    },
                    data: chartData
                };

                window.suite.lang.visualize.draw(drawParams).then(() => {
                    console.log('Chart rendered successfully');
                }).catch(error => {
                    console.error('Error rendering chart:', error);
                    this.fallbackChartRender(element, data, containerId);
                });

            } catch (error) {
                console.error('Error creating chart with Hydrolang:', error);
                this.fallbackChartRender(element, data);
            }
        } else {
            this.fallbackChartRender(element, data);
        }
    }

    fallbackChartRender(element, data, containerId) {
        // Fallback simple chart implementation
        const id = containerId || `chart-${Date.now()}`;
        element.innerHTML = `
            <div class="chart-container">
                <h4>${data.title || 'Chart'}</h4>
                <div id="${id}" class="chart-placeholder">
                    <div class="fallback-chart" style="width: 100%; height: 300px; border: 1px solid #ddd; display: flex; align-items: center; justify-content: center; background: #f8f9fa;">
                        <div style="text-align: center;">
                            <i class="fas fa-chart-line" style="font-size: 48px; color: #6c757d; margin-bottom: 10px;"></i>
                            <p style="margin: 0; color: #6c757d;">Chart visualization</p>
                            <small style="color: #999;">Data loaded successfully</small>
                        </div>
                    </div>
                </div>
                <div class="chart-data" style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px; font-family: monospace; font-size: 12px;">
                    <strong>Data Preview:</strong><br>
                    ${JSON.stringify(data, null, 2).substring(0, 500)}${JSON.stringify(data).length > 500 ? '...' : ''}
                </div>
            </div>
        `;
    }

    createMap(element, data) {
        // Use Hydrolang map if available
        if (window.lang && window.lang.map && window.lang.map.renderMap) {
            try {
                const containerId = `map-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                element.innerHTML = `<div id="${containerId}" class="map-container" style="width: 100%; height: 400px;"></div>`;

                // Prepare data for Hydrolang map
                const mapParams = {
                    params: {
                        maptype: "leaflet",
                        lat: data.lat || 40.75,
                        lon: data.lon || -111.87,
                        id: containerId
                    },
                    args: {
                        zoom: data.zoom || 10,
                        layers: data.layers || []
                    }
                };

                window.lang.map.renderMap(mapParams).then(() => {
                    console.log('Map rendered successfully');
                    this.mapInitialized = true;

                    // Add layers if data contains layer information
                    if (data.layers && Array.isArray(data.layers)) {
                        data.layers.forEach(layer => {
                            if (window.lang.map.Layers) {
                                window.lang.map.Layers({
                                    params: layer.params || {},
                                    args: layer.args || {},
                                    data: layer.data || []
                                });
                            }
                        });
                    }
                }).catch(error => {
                    console.error('Error rendering map:', error);
                    this.fallbackMapRender(element, data, containerId);
                });

            } catch (error) {
                console.error('Error creating map with Hydrolang:', error);
                this.fallbackMapRender(element, data);
            }
        } else {
            this.fallbackMapRender(element, data);
        }
    }

    fallbackMapRender(element, data, containerId) {
        // Fallback simple map implementation
        const id = containerId || `map-${Date.now()}`;
        element.innerHTML = `
            <div class="map-container">
                <h4>${data.title || 'Map'}</h4>
                <div id="${id}" class="map-placeholder">
                    <div class="fallback-map" style="width: 100%; height: 300px; border: 1px solid #ddd; display: flex; align-items: center; justify-content: center; background: #f8f9fa;">
                        <div style="text-align: center;">
                            <i class="fas fa-map" style="font-size: 48px; color: #6c757d; margin-bottom: 10px;"></i>
                            <p style="margin: 0; color: #6c757d;">Map visualization</p>
                            <small style="color: #999;">Location: ${data.lat || 'N/A'}, ${data.lon || 'N/A'}</small>
                        </div>
                    </div>
                </div>
                <div class="map-data" style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px; font-family: monospace; font-size: 12px;">
                    <strong>Map Configuration:</strong><br>
                    Latitude: ${data.lat || 'Default'}<br>
                    Longitude: ${data.lon || 'Default'}<br>
                    Layers: ${data.layers ? data.layers.length : 0}
                </div>
            </div>
        `;
    }

    createTable(element, data) {
        // Create a basic table view of the data
        const table = document.createElement('table');
        table.className = 'data-table';

        // Add headers
        if (data.headers) {
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            data.headers.forEach(header => {
                const th = document.createElement('th');
                th.textContent = header;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);
            table.appendChild(thead);
        }

        // Add data rows
        if (data.rows) {
            const tbody = document.createElement('tbody');
            data.rows.forEach(row => {
                const tr = document.createElement('tr');
                row.forEach(cell => {
                    const td = document.createElement('td');
                    td.textContent = cell;
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
        }

        element.appendChild(table);
    }

    updateMetrics(workflow) {
        const metricsPanel = document.getElementById('metrics-panel');
        if (!metricsPanel) return;

        let metricsHtml = '<h3>Workflow Metrics</h3>';

        // Collect metrics from all items - items is an ARRAY
        const items = Array.isArray(workflow.items) ? workflow.items : [];
        items.forEach((item) => {
            if (item.results?.metrics) {
                metricsHtml += `
                    <div class="metric-group">
                        <h4>${item.type} Metrics</h4>
                        <ul>
                            ${Object.entries(item.results.metrics)
                                .map(([key, value]) => `<li>${key}: ${value}</li>`)
                                .join('')}
                        </ul>
                    </div>
                `;
            }
        });

        metricsPanel.innerHTML = metricsHtml;
    }

    // Add reporting functionality
    async generateQuickReport(result) {
        try {
            // Use the same data loading pattern as loadItemDataFromIndexedDB with fallback
            let data = null;
            
            // Try to get from database manager first
            if (this.dbManager && typeof this.dbManager.getResult === 'function') {
                try {
                    const dbResult = await this.dbManager.getResult(result.uniqueId);
                    if (dbResult && dbResult.data !== undefined) {
                        data = dbResult.data;
                    }
                } catch (dbError) {
                    console.warn(`Could not load from dbManager for ${result.uniqueId}:`, dbError);
                }
            }
            
            // Fallback: try to load from data/items folder
            if (!data) {
                try {
                    const response = await fetch(`data/items/${result.uniqueId}.json`);
                    if (response.ok) {
                        const json = await response.json();
                        data = json.data || null;
                    }
                } catch (fetchError) {
                    console.warn(`Could not load data for ${result.uniqueId} from filesystem:`, fetchError);
                }
            }

            // Get reports container and placeholder
            const reportList = document.querySelector('.report-list');
            const reportPlaceholder = document.querySelector('.placeholder[data-type="report"]');
            const reportsPlaceholder = document.querySelector('.reports-panel .placeholder');

            // Clear existing reports and hide placeholder
            reportList.innerHTML = '';
            if (reportPlaceholder) {
                reportPlaceholder.style.display = 'none';
            }
            if (reportsPlaceholder) {
                reportsPlaceholder.style.display = 'none';
            }

            // Also hide empty state
            const emptyState = document.querySelector('.reports-panel .empty-state');
            if (emptyState) {
                emptyState.style.display = 'none';
            }

            // Create report item (NO collapse, show directly)
            const reportItem = document.createElement('div');
            reportItem.className = 'report-item card mb-3';

            // Create report header (simple, no collapse)
            const reportHeader = document.createElement('div');
            reportHeader.className = 'card-header py-2';
            reportHeader.style.fontSize = '0.9rem';
            
            const reportTitle = document.createElement('h6');
            reportTitle.className = 'mb-0';
            reportTitle.textContent = result.name || result.uniqueId || 'Report';
            
            reportHeader.appendChild(reportTitle);
            
            // Create report content (always visible, scrollable)
            const reportContent = document.createElement('div');
            reportContent.className = 'card-body p-2';

            // Create visualization container (scrollable)
            const vizContainer = document.createElement('div');
            vizContainer.id = `report-viz-${result.uniqueId}`;
            vizContainer.className = 'report-visualization';
            vizContainer.style.minHeight = '200px';
            vizContainer.style.maxHeight = '500px';
            vizContainer.style.overflowY = 'auto';
            vizContainer.style.overflowX = 'hidden';
            vizContainer.style.width = '100%';

            // Assemble report
            reportContent.appendChild(vizContainer);
            reportItem.appendChild(reportHeader);
            reportItem.appendChild(reportContent);
            reportList.appendChild(reportItem);

            // Create interactive JSON tree or table view
            this.createDataTable(vizContainer, data, result.uniqueId);
        } catch (error) {
            console.error('Error generating quick report:', error);
        }
    }

    createDataTable(container, data, uniqueId) {
        if (!data) {
            container.innerHTML = '<div style="text-align: center; color: #6c757d; padding: 20px;">No data available</div>';
            return;
        }

        // Handle arrays
        if (Array.isArray(data)) {
            if (data.length === 0) {
                container.innerHTML = '<div style="text-align: center; color: #6c757d; padding: 20px;">Empty array</div>';
                return;
            }

            // For array of objects, create a table
            if (typeof data[0] === 'object' && data[0] !== null) {
                this.createObjectArrayTable(container, data, uniqueId);
            } else {
                // For array of primitives
                this.createPrimitiveArrayTable(container, data, uniqueId);
            }
        }
        // Handle objects
        else if (typeof data === 'object' && data !== null) {
            this.createObjectTable(container, data, uniqueId);
        }
        // Handle primitives
        else {
            container.innerHTML = `<div style="padding: 20px; text-align: center;">
                <strong>Value:</strong> ${JSON.stringify(data)}
            </div>`;
        }
    }

    createObjectArrayTable(container, data, uniqueId) {
        const maxRows = 10;
        const previewData = data.slice(0, maxRows);

        // Get all unique keys from first few objects
        const allKeys = new Set();
        previewData.slice(0, 5).forEach(item => {
            if (typeof item === 'object' && item !== null) {
                Object.keys(item).forEach(key => allKeys.add(key));
            }
        });

        const keys = Array.from(allKeys).slice(0, 6); // Limit columns

        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            background: white;
            border-radius: 4px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        `;

        // Header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.style.background = '#f8f9fa';

        keys.forEach(key => {
            const th = document.createElement('th');
            th.textContent = key.length > 15 ? key.substring(0, 15) + '...' : key;
            th.title = key;
            th.style.cssText = `
                padding: 8px 12px;
                text-align: left;
                font-weight: 500;
                color: #495057;
                border-bottom: 1px solid #e1e5e9;
                max-width: 150px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            `;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body
        const tbody = document.createElement('tbody');
        previewData.forEach((item, index) => {
            const row = document.createElement('tr');
            row.style.borderBottom = '1px solid #f1f3f4';

            keys.forEach(key => {
                const td = document.createElement('td');
                let originalValue = item && typeof item === 'object' ? item[key] : '';
                let cellValue = originalValue;

                if (cellValue === null || cellValue === undefined) {
                    td.textContent = '';
                    td.style.color = '#6c757d';
                } else if (typeof cellValue === 'object') {
                    td.innerHTML = `<span class="json-expand-btn" style="cursor: pointer; color: #007bff;"><i class="fas fa-expand-alt" style="margin-right: 4px;"></i>Object</span>`;
                    td.dataset.originalValue = JSON.stringify(cellValue);
                    td.dataset.valueType = 'object';
                    td.querySelector('.json-expand-btn').addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.showJsonExpander(originalValue, `${key} - Data Explorer`, item.uniqueId);
                    });
                } else if (typeof cellValue === 'string' && cellValue.length > 30) {
                    const truncated = cellValue.substring(0, 30) + '...';
                    td.innerHTML = `<span class="json-expand-btn" style="cursor: pointer;" title="Click to expand">${truncated}</span>`;
                    td.dataset.fullText = cellValue;
                    td.querySelector('.json-expand-btn').addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.showJsonExpander(cellValue, `${key} - Text Content`, item.uniqueId);
                    });
                } else {
                    td.textContent = cellValue;
                }

                td.style.cssText = `
                    padding: 8px 12px;
                    color: #495057;
                    max-width: 150px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                `;
                row.appendChild(td);
            });
            tbody.appendChild(row);
        });
        table.appendChild(tbody);

        container.appendChild(table);

        if (data.length > maxRows) {
            const moreInfo = document.createElement('div');
            moreInfo.style.cssText = `
                padding: 12px;
                text-align: center;
                color: #6c757d;
                font-size: 12px;
                background: #f8f9fa;
                margin-top: 8px;
                border-radius: 4px;
            `;
            moreInfo.textContent = `Showing ${maxRows} of ${data.length} items`;
            container.appendChild(moreInfo);
        }
    }

    createPrimitiveArrayTable(container, data, uniqueId) {
        const maxRows = 15;
        const previewData = data.slice(0, maxRows);

        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            background: white;
            border-radius: 4px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        `;

        // Header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.style.background = '#f8f9fa';
        headerRow.innerHTML = `
            <th style="padding: 8px 12px; text-align: left; font-weight: 500; color: #495057; border-bottom: 1px solid #e1e5e9; width: 80px;">Index</th>
            <th style="padding: 8px 12px; text-align: left; font-weight: 500; color: #495057; border-bottom: 1px solid #e1e5e9;">Value</th>
        `;
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body
        const tbody = document.createElement('tbody');
        previewData.forEach((item, index) => {
            const row = document.createElement('tr');
            row.style.borderBottom = '1px solid #f1f3f4';

            let displayValue = item;
            if (typeof item === 'string' && item.length > 50) {
                displayValue = item.substring(0, 50) + '...';
            }

            row.innerHTML = `
                <td style="padding: 8px 12px; color: #6c757d; font-family: monospace;">${index}</td>
                <td style="padding: 8px 12px; color: #495057;" title="${typeof item === 'string' ? item : String(item)}">${displayValue}</td>
            `;
            tbody.appendChild(row);
        });
        table.appendChild(tbody);

        container.appendChild(table);

        if (data.length > maxRows) {
            const moreInfo = document.createElement('div');
            moreInfo.style.cssText = `
                padding: 12px;
                text-align: center;
                color: #6c757d;
                font-size: 12px;
                background: #f8f9fa;
                margin-top: 8px;
                border-radius: 4px;
            `;
            moreInfo.textContent = `Showing ${maxRows} of ${data.length} items`;
            container.appendChild(moreInfo);
        }
    }

    createObjectTable(container, data, uniqueId) {
        const keys = Object.keys(data);
        const maxKeys = 15;
        const previewKeys = keys.slice(0, maxKeys);

        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            background: white;
            border-radius: 4px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        `;

        // Header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.style.background = '#f8f9fa';
        headerRow.innerHTML = `
            <th style="padding: 8px 12px; text-align: left; font-weight: 500; color: #495057; border-bottom: 1px solid #e1e5e9; width: 40%;">Property</th>
            <th style="padding: 8px 12px; text-align: left; font-weight: 500; color: #495057; border-bottom: 1px solid #e1e5e9;">Value</th>
        `;
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body
        const tbody = document.createElement('tbody');
        previewKeys.forEach(key => {
            const row = document.createElement('tr');
            row.style.borderBottom = '1px solid #f1f3f4';

            let value = data[key];
            let displayValue;

            const keyDisplay = key.length > 25 ? key.substring(0, 25) + '...' : key;

            const keyTd = document.createElement('td');
            keyTd.textContent = keyDisplay;
            keyTd.title = key;
            keyTd.style.cssText = `
                padding: 8px 12px;
                color: #495057;
                font-weight: 500;
                max-width: 150px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            `;

            const valueTd = document.createElement('td');
            valueTd.style.cssText = `
                padding: 8px 12px;
                color: #495057;
                max-width: 200px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            `;

            if (value === null || value === undefined) {
                valueTd.innerHTML = '<em style="color: #6c757d;">null</em>';
            } else if (typeof value === 'object') {
                if (Array.isArray(value)) {
                    valueTd.innerHTML = `<span class="json-expand-btn" style="cursor: pointer; color: #007bff;"><i class="fas fa-expand-alt" style="margin-right: 4px;"></i>Array(${value.length})</span>`;
                    valueTd.dataset.originalValue = JSON.stringify(value);
                    valueTd.dataset.valueType = 'array';
                    valueTd.querySelector('.json-expand-btn').addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.showJsonExpander(value, `${key} - Data Explorer`, uniqueId);
                    });
                } else {
                    valueTd.innerHTML = `<span class="json-expand-btn" style="cursor: pointer; color: #007bff;"><i class="fas fa-expand-alt" style="margin-right: 4px;"></i>Object(${Object.keys(value).length} keys)</span>`;
                    valueTd.dataset.originalValue = JSON.stringify(value);
                    valueTd.dataset.valueType = 'object';
                    valueTd.querySelector('.json-expand-btn').addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.showJsonExpander(value, `${key} - Data Explorer`, uniqueId);
                    });
                }
            } else if (typeof value === 'string' && value.length > 40) {
                const truncated = value.substring(0, 40) + '...';
                valueTd.innerHTML = `<span class="json-expand-btn" style="cursor: pointer;" title="Click to expand">${truncated}</span>`;
                valueTd.dataset.fullText = value;
                valueTd.querySelector('.json-expand-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showJsonExpander(value, `${key} - Text Content`, uniqueId);
                });
            } else {
                valueTd.textContent = String(value);
                valueTd.title = typeof value === 'string' ? value : String(value);
            }

            row.appendChild(keyTd);
            row.appendChild(valueTd);
            tbody.appendChild(row);
        });
        table.appendChild(tbody);

        container.appendChild(table);

        if (keys.length > maxKeys) {
            const moreInfo = document.createElement('div');
            moreInfo.style.cssText = `
                padding: 12px;
                text-align: center;
                color: #6c757d;
                font-size: 12px;
                background: #f8f9fa;
                margin-top: 8px;
                border-radius: 4px;
            `;
            moreInfo.textContent = `Showing ${maxKeys} of ${keys.length} properties`;
            container.appendChild(moreInfo);
        }
    }

    showError(message, options = {}) {
        const { dismissible = true, persistent = false, type = 'error' } = options;
        
        // Create or update error display
        let errorDiv = document.getElementById('error-display');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.id = 'error-display';
            errorDiv.className = `alert alert-${type === 'warning' ? 'warning' : 'danger'} alert-dismissible fade show`;
            errorDiv.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                left: 20px;
                max-width: 600px;
                margin: 0 auto;
                z-index: 10000;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            `;
            document.body.appendChild(errorDiv);
        }
        
        errorDiv.innerHTML = `
            <strong>${type === 'warning' ? 'Warning' : 'Error'}:</strong> ${message}
            ${dismissible ? '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>' : ''}
        `;
        
        // Auto-dismiss after 10 seconds unless persistent
        if (!persistent && dismissible) {
            setTimeout(() => {
                if (errorDiv && errorDiv.parentNode) {
                    errorDiv.remove();
                }
            }, 10000);
        }
        
        // Make dismissible work
        if (dismissible) {
            const closeBtn = errorDiv.querySelector('.btn-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    errorDiv.remove();
                });
            }
        }
    }

    /**
     * Initialize visualization tab buttons (maps, charts, tables)
     */
    initializeVisualizationTabs() {
        const tabButtons = document.querySelectorAll('.tab-button[data-tab]');
        tabButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const tab = button.dataset.tab;
                this.showVisualizationTab(tab);
            });
        });
    }
    
    /**
     * Show selected visualization tab
     */
    showVisualizationTab(tab) {
        console.log(`Switching to ${tab} tab`);
        
        // Hide all visualization sections
        document.querySelectorAll('.visualization-section').forEach(section => {
            section.style.display = 'none';
            section.classList.remove('active');
        });
        
        // Show selected section with explicit visibility
        const selectedSection = document.getElementById(`${tab}-section`);
        if (selectedSection) {
            selectedSection.style.display = 'block';
            selectedSection.style.visibility = 'visible';
            selectedSection.classList.add('active');
            console.log(`✓ ${tab}-section is now visible`);
        } else {
            console.error(`Section ${tab}-section not found!`);
        }
        
        // Update button states
        document.querySelectorAll('.tab-button').forEach(button => {
            if (button.dataset.tab === tab) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }
    
    /**
     * Clean up custom layout - remove unnecessary buttons and elements
     */
    cleanupCustomLayout() {
        const layoutConfig = this.layoutConfig || {};
        
        // CRITICAL: Always remove counters and unnecessary buttons (for all layouts)
        // Remove export button
        const exportBtn = document.querySelector('.export-button');
        if (exportBtn) exportBtn.remove();
        
        // Remove tool buttons (export current view, expand, refresh, etc.)
        const toolBtns = document.querySelectorAll('.panel-tools .tool-btn');
        toolBtns.forEach(btn => btn.remove());
        
        // CRITICAL: Remove ALL item counters (always, not just custom layout)
        const countSpans = document.querySelectorAll('.count, .panel-title .count, span.count, .item-count');
        countSpans.forEach(span => {
            const text = span.textContent || '';
            if (text.includes('items') || text.includes('0') || span.classList.contains('count')) {
                span.remove();
            }
        });
        
        // CRITICAL: Remove from panel titles (check all children)
        const panelTitles = document.querySelectorAll('.panel-title');
        panelTitles.forEach(title => {
            // Remove any count spans
            const countSpans = title.querySelectorAll('.count, span');
            countSpans.forEach(span => {
                const text = span.textContent || '';
                if (text.includes('items') || text.includes('0') || span.classList.contains('count')) {
                    span.remove();
                }
            });
        });
        
        // Also remove from reports panel
        const reportsPanel = document.querySelector('.reports-panel .panel-title');
        if (reportsPanel) {
            const reportsCount = reportsPanel.querySelector('.count, span');
            if (reportsCount) reportsCount.remove();
        }
        
        // Remove Reports download button
        const reportsDownloadBtn = document.getElementById('export-reports-btn');
        if (reportsDownloadBtn) reportsDownloadBtn.remove();
        
        // Fix result-header width to match content-grid
        const resultsHeader = document.querySelector('.results-header');
        const contentGrid = document.querySelector('.content-grid');
        if (resultsHeader && contentGrid) {
            // Get computed styles from content-grid to match exactly
            const gridStyles = window.getComputedStyle(contentGrid);
            resultsHeader.style.width = gridStyles.width;
            resultsHeader.style.maxWidth = gridStyles.maxWidth || '100%';
            resultsHeader.style.paddingLeft = gridStyles.paddingLeft;
            resultsHeader.style.paddingRight = gridStyles.paddingRight;
            resultsHeader.style.marginLeft = gridStyles.marginLeft;
            resultsHeader.style.marginRight = gridStyles.marginRight;
            // Remove shadow
            resultsHeader.style.boxShadow = 'none';
        }
        
        // Fix workflow-controls width to match content-grid
        const workflowControls = document.querySelector('.workflow-controls');
        if (workflowControls && contentGrid) {
            const gridStyles = window.getComputedStyle(contentGrid);
            workflowControls.style.maxWidth = gridStyles.maxWidth || '100%';
        }
        
        // Only remove other elements for custom/showcase layouts
        if (layoutConfig.type === 'custom' || layoutConfig.type === 'showcase') {
            // Remove metric chips
            const metricChips = document.querySelectorAll('.metric-chip');
            metricChips.forEach(chip => chip.remove());
            
            // Remove quick metrics container
            const quickMetrics = document.querySelector('.quick-metrics');
            if (quickMetrics) quickMetrics.remove();
            
            // Remove header-right if empty
            const headerRight = document.querySelector('.header-right');
            if (headerRight && headerRight.children.length === 0) {
                headerRight.remove();
            }
            
            // Fix workflow/item select alignment using Bootstrap
            const workflowControls = document.querySelector('.workflow-controls');
            if (workflowControls) {
                workflowControls.className = 'workflow-controls d-flex align-items-center gap-3 mb-3';
                const controlGroups = workflowControls.querySelectorAll('.control-group');
                controlGroups.forEach(group => {
                    group.className = 'control-group d-flex align-items-center gap-2';
                    const label = group.querySelector('label');
                    if (label) {
                        label.className = 'form-label mb-0';
                        label.style.minWidth = '80px';
                    }
                    const select = group.querySelector('select');
                    if (select) {
                        select.className = 'form-select';
                    }
                });
            }
        }
    }

    setupEventListeners() {
        // CRITICAL: Set up visualization tab buttons first
        this.initializeVisualizationTabs();
        
        // CRITICAL: Clean up custom layout - remove unnecessary buttons
        this.cleanupCustomLayout();
        
        // Workflow selection change
        const workflowSelect = document.getElementById('workflow-select');
        workflowSelect?.addEventListener('change', () => {
            const selectedId = workflowSelect.value;
            if (selectedId) {
                this.loadWorkflow(selectedId);
            }
        });

        // Add offline status indicator
        window.addEventListener('online', () => this.updateOnlineStatus(true));
        window.addEventListener('offline', () => this.updateOnlineStatus(false));
        this.updateOnlineStatus(navigator.onLine);

        // Add dataset selection handling for reports
        const datasetSelect = document.getElementById('dataset-select');
        if (datasetSelect) {
            datasetSelect.addEventListener('change', async () => {
                const selectedId = datasetSelect.value;
                if (!selectedId || !this.currentWorkflow) return;
                
                    // Find item in array by uniqueId
                    const items = Array.isArray(this.currentWorkflow.items) ? this.currentWorkflow.items : [];
                    const item = items.find(i => i.uniqueId === selectedId);
                if (!item) {
                    console.warn(`Item not found: ${selectedId}`);
                    return;
                }
                
                // CRITICAL: Check if this is a visualization item or data item
                // Check multiple sources for itemName to handle different data structures
                const itemName = item.itemName || item.settings?.itemName || item.name || '';
                const itemType = item.type || item.settings?.type || '';
                const isVisualization = ['renderMap', 'Layers', 'draw', 'addCustomLegend'].includes(itemName) ||
                                      itemType === 'visualization' ||
                                      itemName?.toLowerCase().includes('map') ||
                                      itemName?.toLowerCase().includes('chart') ||
                                      itemName?.toLowerCase().includes('table') ||
                                      itemName?.toLowerCase() === 'layers';
                
                console.log(`Item selected: ${selectedId}`, {
                    itemName,
                    itemType,
                    isVisualization,
                    fullItem: item
                });
                
                if (isVisualization) {
                    // Handle visualization items - route to appropriate tab and render
                    console.log(`Routing visualization item to handleItem(): ${itemName}`);
                    await this.handleItem(item);
                } else {
                    // Handle data items - generate quick report
                    console.log(`Generating report for data item: ${selectedId}`);
                        await this.generateQuickReport({ uniqueId: selectedId, ...item });
                }
            });
        }
    }
    
    /**
     * Update online/offline status display
     * @param {boolean} isOnline - Whether the app is online
     */
    updateOnlineStatus(isOnline) {
        const statusIndicator = document.getElementById('online-status');
        if (!statusIndicator) {
            const header = document.querySelector('.controls-section');
            if (header) {
                const indicator = document.createElement('div');
                indicator.id = 'online-status';
                indicator.style.marginLeft = 'auto';
                indicator.style.padding = '4px 8px';
                indicator.style.borderRadius = '4px';
                indicator.style.fontSize = '0.8rem';
                header.appendChild(indicator);
            }
        }
        
        const indicator = document.getElementById('online-status');
        if (indicator) {
            if (isOnline) {
                indicator.textContent = 'Online';
                indicator.style.backgroundColor = '#d4edda';
                indicator.style.color = '#155724';
            } else {
                indicator.textContent = 'Offline';
                indicator.style.backgroundColor = '#f8d7da';
                indicator.style.color = '#721c24';
            }
        }
    }
    
    /**
     * Update Data Summary panel with MB totals, export date, and workflows modal
     */
    async updateDataSummary() {
        // Remove refresh button
        const refreshBtn = document.querySelector('.data-panel .tool-btn[title="Refresh"]');
        if (refreshBtn) refreshBtn.remove();
        
        // Calculate total data size in MB from all items
        let totalSizeBytes = 0;
        if (this.workflows && this.dbManager) {
            const sizePromises = [];
            Object.values(this.workflows).forEach(workflow => {
                if (workflow.items && Array.isArray(workflow.items)) {
                    workflow.items.forEach(item => {
                        if (item.uniqueId) {
                            sizePromises.push(
                                this.dbManager.getResult(item.uniqueId)
                                    .then(result => {
                                        if (result && result.data) {
                                            const jsonString = JSON.stringify(result.data);
                                            return new Blob([jsonString]).size;
                                        }
                                        return 0;
                                    })
                                    .catch(() => 0)
                            );
                        }
                    });
                }
            });
            
            if (sizePromises.length > 0) {
                try {
                    const sizes = await Promise.all(sizePromises);
                    totalSizeBytes = sizes.reduce((sum, size) => sum + size, 0);
                } catch (error) {
                    console.error('Error calculating data sizes:', error);
                }
            }
        }
        
        // Convert to MB
        const totalSizeMB = totalSizeBytes / (1024 * 1024);
        const dataUsageEl = document.getElementById('data-usage');
        if (dataUsageEl) {
            dataUsageEl.textContent = totalSizeMB >= 0.1 ? `${totalSizeMB.toFixed(2)} MB` : 
                                      totalSizeBytes >= 1024 ? `${(totalSizeBytes / 1024).toFixed(2)} KB` : 
                                      `${totalSizeBytes} B`;
        }
        
        // Set Last Updated to export date
        const lastUpdateEl = document.getElementById('last-update');
        if (lastUpdateEl && this.appInfo && this.appInfo.exportDate) {
            const exportDate = new Date(this.appInfo.exportDate);
            lastUpdateEl.textContent = exportDate.toLocaleString();
        } else if (lastUpdateEl) {
            lastUpdateEl.textContent = new Date().toLocaleString();
        }
        
        // Replace Status with Workflows - find the stat-item with "Status" label
        const statItems = document.querySelectorAll('.data-panel .stat-item');
        statItems.forEach(statItem => {
            const label = statItem.querySelector('label');
            if (label && label.textContent.trim() === 'Status') {
                label.textContent = 'Workflows';
                const badge = statItem.querySelector('.status-badge');
                if (badge) {
                    const workflowCount = Object.keys(this.workflows || {}).length;
                    badge.textContent = `${workflowCount} workflow${workflowCount !== 1 ? 's' : ''}`;
                    badge.className = 'status-badge ready';
                    badge.style.cursor = 'pointer';
                    badge.title = 'Click to view connected workflows';
                    // Remove existing listeners and add new one
                    const newBadge = badge.cloneNode(true);
                    badge.parentNode.replaceChild(newBadge, badge);
                    newBadge.addEventListener('click', () => this.showWorkflowsModal());
                }
            }
        });
    }
    
    /**
     * Show workflows modal with connected workflows
     */
    showWorkflowsModal() {
        // Remove existing modal if any
        const existingModal = document.getElementById('workflows-modal');
        if (existingModal) existingModal.remove();
        
        // Create modal
        const modal = document.createElement('div');
        modal.id = 'workflows-modal';
        modal.className = 'modal fade show';
        modal.style.display = 'block';
        modal.setAttribute('tabindex', '-1');
        modal.setAttribute('role', 'dialog');
        
        const workflowCount = Object.keys(this.workflows || {}).length;
        
        modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered" role="document">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Connected Workflows</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <p class="text-muted mb-3">This application contains ${workflowCount} workflow${workflowCount !== 1 ? 's' : ''}:</p>
                        <ul class="list-group">
                            ${Object.entries(this.workflows || {}).map(([id, workflow]) => `
                                <li class="list-group-item d-flex justify-content-between align-items-center">
                                    <div>
                                        <strong>${workflow.name || id}</strong>
                                        <br>
                                        <small class="text-muted">${Array.isArray(workflow.items) ? workflow.items.length : 0} items</small>
                                    </div>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Add backdrop
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop fade show';
        document.body.appendChild(backdrop);
        
        // Close handlers
        const closeModal = () => {
            modal.remove();
            backdrop.remove();
        };
        
        modal.querySelectorAll('[data-bs-dismiss="modal"], .btn-close').forEach(btn => {
            btn.addEventListener('click', closeModal);
        });
        
        backdrop.addEventListener('click', closeModal);
    }
    
    /**
     * Initialize MetadataExplorer for JSON viewing (uses existing implementation from main app)
     */
    async initializeMetadataExplorer() {
        if (this.metadataExplorer) return;
        
        try {
            // Import MetadataExplorer from bundled file
            // In the exported PWA, app.js is in js/app.js, so metadata-explorer.js is at js/metadata-explorer.js
            const { MetadataExplorer } = await import('./metadata-explorer.js');
            this.metadataExplorer = new MetadataExplorer();
            console.log('✓ MetadataExplorer initialized');
        } catch (error) {
            console.warn('Failed to load MetadataExplorer, JSON expansion will not work:', error);
        }
    }
    
    /**
     * Use MetadataExplorer to open JSON data (like main app)
     */
    showJsonExpander(data, title = 'Data Explorer', sourceItemId = null) {
        if (!this.metadataExplorer) {
            // Try to initialize if not already done
            this.initializeMetadataExplorer().then(() => {
                if (this.metadataExplorer) {
                    this.metadataExplorer.openDataExplorer(data, title, sourceItemId);
                } else {
                    console.error('MetadataExplorer not available');
                }
            });
            return;
        }
        
        // Use the existing MetadataExplorer from main app
        this.metadataExplorer.openDataExplorer(data, title, sourceItemId);
    }
}

// Make the ExportedApp class globally available
window.ExportedApp = ExportedApp;