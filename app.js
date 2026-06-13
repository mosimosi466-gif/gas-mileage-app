// ==========================================================================
// APP STATE & STORAGE HANDLERS
// ==========================================================================
const STORAGE_KEYS = {
    VEHICLES: 'ecodrive_vehicles',
    RECORDS: 'ecodrive_records',
    THEME: 'ecodrive_theme',
    UNSAVED_COUNT: 'ecodrive_unsaved_count'
};

// Default setup if no data exists
const DEFAULT_VEHICLE = {
    id: 'default-vehicle-id',
    name: 'マイカー',
    maker: 'トヨタ',
    initialOdometer: 0,
    fuelCapacity: 50,
    createdAt: new Date().toISOString()
};

// Initialize State
let vehicles = [];
let records = [];
let activeTab = 'dashboard';
let chartInstance = null;
let currentChartType = 'efficiency'; // 'efficiency' or 'price'
let editModal = null;
let unsavedCount = 0;

// On Load Initialization
document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    initData();
    initElements();
    setupEventListeners();
    navigateTab(window.location.hash.replace('#', '') || 'dashboard');
    updateDashboard();
    updateSimulator();
    updateBackupStatus();
});

// Load and apply theme
function loadTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        if (savedTheme === 'light') {
            themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i><span>ライトモード</span>';
        } else {
            themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i><span>ダークモード</span>';
        }
    }
}

// Toggle light/dark theme
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem(STORAGE_KEYS.THEME, newTheme);
    
    const themeBtn = document.getElementById('theme-toggle');
    if (newTheme === 'light') {
        themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i><span>ライトモード</span>';
    } else {
        themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i><span>ダークモード</span>';
    }
    
    // Re-draw chart to adapt grid line colors
    if (chartInstance) {
        renderChart();
    }
}

// Load vehicles and records from localStorage
function initData() {
    // Load Vehicles
    const storedVehicles = localStorage.getItem(STORAGE_KEYS.VEHICLES);
    if (storedVehicles) {
        vehicles = JSON.parse(storedVehicles);
    } else {
        vehicles = [DEFAULT_VEHICLE];
        localStorage.setItem(STORAGE_KEYS.VEHICLES, JSON.stringify(vehicles));
    }

    // Load Records
    const storedRecords = localStorage.getItem(STORAGE_KEYS.RECORDS);
    if (storedRecords) {
        records = JSON.parse(storedRecords);
    } else {
        records = [];
        localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
    }

    // Load Unsaved Changes Count
    const storedUnsaved = localStorage.getItem(STORAGE_KEYS.UNSAVED_COUNT);
    unsavedCount = storedUnsaved ? parseInt(storedUnsaved) : 0;
    
    recalculateRecords();
}

// Update backup warning messages and badges
function updateBackupStatus() {
    const badge = document.getElementById('backup-badge');
    const statusText = document.getElementById('backup-status-text');

    if (badge) {
        if (unsavedCount >= 5) {
            badge.classList.remove('d-none');
            badge.textContent = '!';
            badge.title = `未保存の変更が ${unsavedCount} 件あります。バックアップを推奨します。`;
        } else {
            badge.classList.add('d-none');
        }
    }

    if (statusText) {
        if (unsavedCount === 0) {
            statusText.innerHTML = `<span style="color: var(--success); font-weight: 600;"><i class="fa-solid fa-circle-check"></i> データはバックアップ済みです。</span><br>アプリの記録データはブラウザのローカルストレージに保存されています。`;
        } else {
            statusText.innerHTML = `<span style="color: var(--warning); font-weight: 600;"><i class="fa-solid fa-triangle-exclamation"></i> 前回のバックアップ以降、新たに ${unsavedCount} 件の追加・変更があります。</span><br>PCの故障やブラウザデータの消失に備え、JSONファイルでのエクスポートによるバックアップを定期的にお勧めします。`;
        }
    }
}

// Recalculate calculated distances and efficiency values dynamically
function recalculateRecords() {
    // Group records by vehicle
    const vehicleRecordsMap = {};
    vehicles.forEach(v => {
        vehicleRecordsMap[v.id] = records.filter(r => r.vehicleId === v.id);
        
        // Sort chronologically by date, then by odometer value or created ID
        vehicleRecordsMap[v.id].sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            if (dateA.getTime() !== dateB.getTime()) {
                return dateA - dateB;
            }
            const odoA = parseFloat(a.odometer);
            const odoB = parseFloat(b.odometer);
            if (!isNaN(odoA) && !isNaN(odoB)) {
                return odoA - odoB;
            }
            return a.id.localeCompare(b.id);
        });
    });

    // Compute trips and efficiency
    records.forEach(record => {
        const vId = record.vehicleId;
        const vRecords = vehicleRecordsMap[vId] || [];
        const idx = vRecords.findIndex(r => r.id === record.id);
        const vehicle = vehicles.find(v => v.id === vId);
        
        if (record.distanceMethod === 'trip') {
            record.calculatedTrip = parseFloat(record.trip) || 0;
            record.calculatedEfficiency = record.calculatedTrip > 0 && record.fuel > 0 
                ? parseFloat((record.calculatedTrip / record.fuel).toFixed(2)) 
                : null;
            record.skippedRecordsCount = 0;
            record.calculationFuelUsed = record.fuel;
        } else {
            // Odometer method
            const currentOdo = parseFloat(record.odometer);
            
            if (isNaN(currentOdo)) {
                // User forgot to enter odometer
                record.calculatedTrip = null;
                record.calculatedEfficiency = null;
                record.skippedRecordsCount = 0;
                record.calculationFuelUsed = record.fuel;
            } else {
                let prevOdo = null;
                let prevOdoIndex = -1;
                
                // Find the nearest previous record with a known odometer
                if (idx > 0) {
                    for (let i = idx - 1; i >= 0; i--) {
                        const odo = parseFloat(vRecords[i].odometer);
                        if (!isNaN(odo)) {
                            prevOdo = odo;
                            prevOdoIndex = i;
                            break;
                        }
                    }
                }
                
                // If no previous record with odometer, check vehicle initial odometer
                let isVehicleInitial = false;
                if (prevOdo === null && vehicle && vehicle.initialOdometer !== undefined && vehicle.initialOdometer !== null && vehicle.initialOdometer !== '') {
                    prevOdo = parseFloat(vehicle.initialOdometer);
                    isVehicleInitial = true;
                }
                
                if (prevOdo !== null && currentOdo > prevOdo) {
                    // Calculate distance
                    record.calculatedTrip = parseFloat((currentOdo - prevOdo).toFixed(1));
                    
                    // Calculate sum of fuel from intermediate records (where odometer was skipped) + current record
                    let totalFuel = parseFloat(record.fuel) || 0;
                    let skippedCount = 0;
                    
                    const startIdx = isVehicleInitial ? 0 : (prevOdoIndex + 1);
                    for (let i = startIdx; i < idx; i++) {
                        totalFuel += parseFloat(vRecords[i].fuel) || 0;
                        skippedCount++;
                    }
                    
                    record.calculationFuelUsed = parseFloat(totalFuel.toFixed(2));
                    record.skippedRecordsCount = skippedCount;
                    record.calculatedEfficiency = totalFuel > 0 
                        ? parseFloat((record.calculatedTrip / totalFuel).toFixed(2)) 
                        : null;
                } else {
                    record.calculatedTrip = null; // baseline record
                    record.calculatedEfficiency = null;
                    record.skippedRecordsCount = 0;
                    record.calculationFuelUsed = record.fuel;
                }
            }
        }
    });
}

// Save records back to storage
function saveRecords() {
    localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
    recalculateRecords();
}

// Save vehicles back to storage
function saveVehicles() {
    localStorage.setItem(STORAGE_KEYS.VEHICLES, JSON.stringify(vehicles));
    recalculateRecords();
}

// ==========================================================================
// ELEMENT INITIALIZATION & SELECTION
// ==========================================================================
function initElements() {
    populateVehicleSelectors();
    
    // Set default date for record form (today)
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('record-date');
    if (dateInput) {
        dateInput.value = today;
    }
    
    // Initialize Modal object
    editModal = document.getElementById('edit-record-modal');
}

// Populate vehicle dropdowns on dashboard, record form, history filter, edit modal
function populateVehicleSelectors() {
    const globalSelect = document.getElementById('global-vehicle-select');
    const formSelect = document.getElementById('record-vehicle');
    const editSelect = document.getElementById('edit-record-vehicle');

    // Store selected values if any
    const globalVal = globalSelect ? globalSelect.value : '';
    
    // Build options
    let optionsHtml = '';
    vehicles.forEach(v => {
        optionsHtml += `<option value="${v.id}">${v.name}${v.maker ? ' (' + v.maker + ')' : ''}</option>`;
    });

    if (globalSelect) {
        globalSelect.innerHTML = `<option value="all">すべての車両</option>` + optionsHtml;
        if (globalVal) globalSelect.value = globalVal;
        else globalSelect.value = 'all';
    }
    
    if (formSelect) {
        formSelect.innerHTML = optionsHtml;
    }
    
    if (editSelect) {
        editSelect.innerHTML = optionsHtml;
    }
}

// ==========================================================================
// NAVIGATION & TABS
// ==========================================================================
function setupEventListeners() {
    // Sidebar Navigation
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tabId = item.getAttribute('data-tab');
            navigateTab(tabId);
            window.location.hash = tabId;
        });
    });

    // Theme Toggle
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

    // Global Vehicle Picker Selector
    const globalVehicle = document.getElementById('global-vehicle-select');
    if (globalVehicle) {
        globalVehicle.addEventListener('change', () => {
            updateDashboard();
        });
    }

    // Input method toggles (Odometer vs Trip) - Add Form
    document.querySelectorAll('input[name="distance-method"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const method = e.target.value;
            const odoGroup = document.getElementById('odometer-group');
            const odoInput = document.getElementById('record-odometer');
            const tripGroup = document.getElementById('trip-group');
            const tripInput = document.getElementById('record-trip');
            
            if (method === 'odometer') {
                odoGroup.classList.remove('d-none');
                odoInput.removeAttribute('required');
                tripGroup.classList.add('d-none');
                tripInput.removeAttribute('required');
            } else {
                odoGroup.classList.add('d-none');
                odoInput.removeAttribute('required');
                tripGroup.classList.remove('d-none');
                tripInput.setAttribute('required', 'required');
            }
        });
    });

    // Input method toggles - Edit Form
    document.querySelectorAll('input[name="edit-distance-method"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const method = e.target.value;
            const odoGroup = document.getElementById('edit-odometer-group');
            const odoInput = document.getElementById('edit-record-odometer');
            const tripGroup = document.getElementById('edit-trip-group');
            const tripInput = document.getElementById('edit-record-trip');
            
            if (method === 'odometer') {
                odoGroup.classList.remove('d-none');
                odoInput.removeAttribute('required');
                tripGroup.classList.add('d-none');
                tripInput.removeAttribute('required');
            } else {
                odoGroup.classList.add('d-none');
                odoInput.removeAttribute('required');
                tripGroup.classList.remove('d-none');
                tripInput.setAttribute('required', 'required');
            }
        });
    });

    // Fuel cost calculation syncs - Add Form
    const addFuel = document.getElementById('record-fuel');
    const addUnitPrice = document.getElementById('record-unit-price');
    const addTotalCost = document.getElementById('record-total-cost');

    const autoCalcCostAdd = () => {
        const fuel = parseFloat(addFuel.value) || 0;
        const unitPrice = parseFloat(addUnitPrice.value) || 0;
        if (fuel > 0 && unitPrice > 0) {
            addTotalCost.value = Math.round(fuel * unitPrice);
        }
    };

    const autoCalcUnitPriceAdd = () => {
        const fuel = parseFloat(addFuel.value) || 0;
        const total = parseFloat(addTotalCost.value) || 0;
        if (fuel > 0 && total > 0) {
            addUnitPrice.value = Math.round(total / fuel);
        }
    };

    addFuel.addEventListener('input', autoCalcCostAdd);
    addUnitPrice.addEventListener('input', autoCalcCostAdd);
    addTotalCost.addEventListener('input', autoCalcUnitPriceAdd);

    // Fuel cost calculation syncs - Edit Form
    const editFuel = document.getElementById('edit-record-fuel');
    const editUnitPrice = document.getElementById('edit-record-unit-price');
    const editTotalCost = document.getElementById('edit-record-total-cost');

    const autoCalcCostEdit = () => {
        const fuel = parseFloat(editFuel.value) || 0;
        const unitPrice = parseFloat(editUnitPrice.value) || 0;
        if (fuel > 0 && unitPrice > 0) {
            editTotalCost.value = Math.round(fuel * unitPrice);
        }
    };

    const autoCalcUnitPriceEdit = () => {
        const fuel = parseFloat(editFuel.value) || 0;
        const total = parseFloat(editTotalCost.value) || 0;
        if (fuel > 0 && total > 0) {
            editUnitPrice.value = Math.round(total / fuel);
        }
    };

    editFuel.addEventListener('input', autoCalcCostEdit);
    editUnitPrice.addEventListener('input', autoCalcCostEdit);
    editTotalCost.addEventListener('input', autoCalcUnitPriceEdit);

    // Add Record Form Submission
    const addForm = document.getElementById('add-record-form');
    if (addForm) {
        addForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveNewRecord();
        });
    }

    // Reset Record Form
    const btnReset = document.getElementById('btn-reset-form');
    if (btnReset) {
        btnReset.addEventListener('click', () => {
            addForm.reset();
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('record-date').value = today;
            // Trigger radio check display default reset
            document.querySelector('input[name="distance-method"][value="odometer"]').click();
        });
    }

    // Chart Toggles (Efficiency vs Price)
    document.querySelectorAll('.chart-toggles .btn-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.chart-toggles .btn-toggle').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentChartType = e.target.getAttribute('data-chart-type');
            renderChart();
        });
    });

    // View All Records button click
    const viewAllBtn = document.getElementById('view-all-records-btn');
    if (viewAllBtn) {
        viewAllBtn.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTab('records-history');
            window.location.hash = 'records-history';
        });
    }

    // History Filters
    const searchInput = document.getElementById('history-search');
    const fuelTypeFilter = document.getElementById('history-filter-fuel-type');
    
    if (searchInput) searchInput.addEventListener('input', updateHistoryTable);
    if (fuelTypeFilter) fuelTypeFilter.addEventListener('change', updateHistoryTable);
    
    const btnClearFilters = document.getElementById('btn-clear-filters');
    if (btnClearFilters) {
        btnClearFilters.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            if (fuelTypeFilter) fuelTypeFilter.value = 'all';
            updateHistoryTable();
        });
    }

    // Edit Modal Events
    document.getElementById('btn-close-modal').addEventListener('click', closeModal);
    document.getElementById('btn-cancel-edit').addEventListener('click', closeModal);
    document.getElementById('edit-record-form').addEventListener('submit', saveEditedRecord);

    // Vehicle Add Form
    const addVehicleForm = document.getElementById('add-vehicle-form');
    if (addVehicleForm) {
        addVehicleForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveNewVehicle();
        });
    }

    // Quick Simulator Events
    const simDistance = document.getElementById('sim-distance');
    const simEfficiency = document.getElementById('sim-efficiency');
    const simPrice = document.getElementById('sim-price');
    if (simDistance) simDistance.addEventListener('input', updateSimulator);
    if (simEfficiency) simEfficiency.addEventListener('input', updateSimulator);
    if (simPrice) simPrice.addEventListener('input', updateSimulator);

    // Export/Import Settings Events
    document.getElementById('btn-export-json').addEventListener('click', exportJSON);
    document.getElementById('import-json-file').addEventListener('change', importJSON);
    document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
    document.getElementById('btn-reset-all').addEventListener('click', resetAllData);
}

// Route navigation between tabs
function navigateTab(tabId) {
    if (!['dashboard', 'add-record', 'records-history', 'vehicles', 'data-settings'].includes(tabId)) {
        tabId = 'dashboard';
    }

    activeTab = tabId;

    // Update active class on nav links
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
        if (item.getAttribute('data-tab') === tabId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Update active class on tab panels
    document.querySelectorAll('.main-content .tab-content').forEach(panel => {
        if (panel.id === `${tabId}-tab`) {
            panel.classList.add('active');
        } else {
            panel.classList.remove('active');
        }
    });

    // Update headers dynamically
    const title = document.getElementById('page-title');
    const subtitle = document.getElementById('page-subtitle');
    
    switch (tabId) {
        case 'dashboard':
            title.textContent = 'ダッシュボード';
            subtitle.textContent = '燃費状況の概要と最近の走行レポート';
            updateDashboard();
            break;
        case 'add-record':
            title.textContent = '給油記録の入力';
            subtitle.textContent = '日々の給油データを入力して、燃費をリアルタイムに計算します。';
            // Sync vehicle selector on form
            populateVehicleSelectors();
            break;
        case 'records-history':
            title.textContent = '履歴一覧';
            subtitle.textContent = '過去のすべての給油記録と詳細データ。検索・編集も行えます。';
            updateHistoryTable();
            break;
        case 'vehicles':
            title.textContent = '車両管理';
            subtitle.textContent = '登録車両の追加・編集・削除を行えます。';
            updateVehiclesTab();
            break;
        case 'data-settings':
            title.textContent = 'データ・設定';
            subtitle.textContent = 'アプリのデータ管理、バックアップ、リセットが行えます。';
            break;
    }
}

// Show Toast notification
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');
    const toastIcon = toast.querySelector('.toast-icon');

    toastMsg.textContent = message;
    
    // Set style and icon based on type
    if (type === 'success') {
        toast.style.borderColor = 'var(--success)';
        toastIcon.className = 'fa-solid fa-circle-check toast-icon text-success';
    } else if (type === 'error') {
        toast.style.borderColor = 'var(--danger)';
        toastIcon.className = 'fa-solid fa-triangle-exclamation toast-icon text-danger';
    } else {
        toast.style.borderColor = 'var(--primary)';
        toastIcon.className = 'fa-solid fa-circle-info toast-icon text-primary';
    }

    toast.classList.add('active');
    
    setTimeout(() => {
        toast.classList.remove('active');
    }, 4000);
}

// ==========================================================================
// DASHBOARD LOGIC (METRICS & CHARTS)
// ==========================================================================
function updateDashboard() {
    const selectedVehicleId = document.getElementById('global-vehicle-select').value;
    
    // Filter records by vehicle
    let filteredRecords = records;
    if (selectedVehicleId !== 'all') {
        filteredRecords = records.filter(r => r.vehicleId === selectedVehicleId);
    }
    
    // Sort chronologically ascending for stats computations
    filteredRecords.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Stats calculations
    let totalDistance = 0;
    let totalFuel = 0;
    let totalCost = 0;
    let recordsWithEfficiency = 0;
    let sumEfficiency = 0;
    let gasPrices = [];

    filteredRecords.forEach(r => {
        if (r.calculatedTrip) {
            totalDistance += r.calculatedTrip;
        }
        totalFuel += parseFloat(r.fuel) || 0;
        totalCost += parseFloat(r.totalCost) || 0;

        if (r.calculatedEfficiency) {
            sumEfficiency += r.calculatedEfficiency;
            recordsWithEfficiency++;
        }

        if (r.unitPrice) {
            gasPrices.push(parseFloat(r.unitPrice));
        }
    });

    // 1. Average Efficiency
    const statAvgEfficiency = document.getElementById('stat-avg-efficiency');
    const statEfficiencyCompare = document.getElementById('stat-efficiency-compare');
    if (recordsWithEfficiency > 0) {
        // Average = total computed distance / total fuel (of those records with computed trips)
        // For a more accurate "lifetime" metric, sum up distances of all trips divided by sum of fuels of those same trips:
        let distanceSum = 0;
        let fuelSum = 0;
        filteredRecords.forEach(r => {
            if (r.calculatedTrip && r.fuel) {
                distanceSum += r.calculatedTrip;
                fuelSum += parseFloat(r.fuel);
            }
        });

        const lifetimeAvg = fuelSum > 0 ? (distanceSum / fuelSum).toFixed(2) : 0;
        statAvgEfficiency.textContent = lifetimeAvg;

        // Compare with latest fuel efficiency
        const latestRecord = [...filteredRecords].reverse().find(r => r.calculatedEfficiency);
        if (latestRecord) {
            statEfficiencyCompare.textContent = `最新: ${latestRecord.calculatedEfficiency} km/L (${latestRecord.date})`;
        } else {
            statEfficiencyCompare.textContent = '生涯平均燃費';
        }
    } else {
        statAvgEfficiency.textContent = '-';
        statEfficiencyCompare.textContent = 'データ不足';
    }

    // 2. Total Distance
    const statTotalDistance = document.getElementById('stat-total-distance');
    const statLastOdometer = document.getElementById('stat-last-odometer');
    statTotalDistance.textContent = totalDistance > 0 ? totalDistance.toLocaleString(undefined, {maximumFractionDigits: 1}) : '0';
    
    // Find latest odometer
    const latestOdoRecord = [...filteredRecords].reverse().find(r => r.odometer);
    if (latestOdoRecord) {
        statLastOdometer.textContent = `現在メーター: ${parseFloat(latestOdoRecord.odometer).toLocaleString()} km`;
    } else {
        // Fallback to initial odometer
        if (selectedVehicleId !== 'all') {
            const v = vehicles.find(veh => veh.id === selectedVehicleId);
            if (v && v.initialOdometer) {
                statLastOdometer.textContent = `初期メーター: ${parseFloat(v.initialOdometer).toLocaleString()} km`;
            } else {
                statLastOdometer.textContent = 'メーター記録なし';
            }
        } else {
            statLastOdometer.textContent = '全車両の合計';
        }
    }

    // 3. Average Price
    const statAvgPrice = document.getElementById('stat-avg-price');
    const statPriceRange = document.getElementById('stat-price-range');
    if (gasPrices.length > 0) {
        // Weighted average cost = Total Cost / Total Fuel (where cost is recorded)
        let priceWeightedSum = 0;
        let fuelWeightedSum = 0;
        filteredRecords.forEach(r => {
            if (r.totalCost && r.fuel) {
                priceWeightedSum += parseFloat(r.totalCost);
                fuelWeightedSum += parseFloat(r.fuel);
            }
        });
        
        const avgPriceVal = fuelWeightedSum > 0 ? Math.round(priceWeightedSum / fuelWeightedSum) : Math.round(gasPrices.reduce((a,b)=>a+b, 0) / gasPrices.length);
        statAvgPrice.textContent = avgPriceVal;

        const minPrice = Math.min(...gasPrices);
        const maxPrice = Math.max(...gasPrices);
        statPriceRange.textContent = minPrice === maxPrice ? `給油価格: ${minPrice} 円/L` : `価格帯: ${minPrice} 〜 ${maxPrice} 円/L`;
    } else {
        statAvgPrice.textContent = '-';
        statPriceRange.textContent = '単価記録なし';
    }

    // 4. Total Cost / Total Fuel
    const statTotalCost = document.getElementById('stat-total-cost');
    const statTotalFuel = document.getElementById('stat-total-fuel');
    statTotalCost.textContent = totalCost > 0 ? totalCost.toLocaleString() : '0';
    statTotalFuel.textContent = totalFuel > 0 ? `総給油量: ${totalFuel.toFixed(1)} L` : '総給油量: 0 L';

    // 5. Recent Records
    updateRecentRecordsList(filteredRecords);

    // 6. Draw chart
    renderChart(filteredRecords);
}

// Update recent records widget
function updateRecentRecordsList(filteredRecords) {
    const listContainer = document.getElementById('recent-records-list');
    if (!listContainer) return;

    // Show latest 4 records
    const recent = [...filteredRecords].reverse().slice(0, 4);

    if (recent.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-folder-open"></i>
                <p>記録がありません。新しく記録を追加してください。</p>
            </div>`;
        return;
    }

    let html = '';
    recent.forEach(r => {
        const dateObj = new Date(r.date);
        const day = dateObj.getDate();
        const month = `${dateObj.getMonth() + 1}月`;
        const v = vehicles.find(veh => veh.id === r.vehicleId);
        const vehicleName = v ? v.name : '不明な車両';
        const costStr = r.totalCost ? `${parseInt(r.totalCost).toLocaleString()}円` : '';
        const fuelStr = r.fuel ? `${parseFloat(r.fuel).toFixed(1)}L` : '';
        const costFuelStr = (costStr && fuelStr) ? `${costStr} / ${fuelStr}` : (costStr || fuelStr || '金額記録なし');

        let efficiencyText = r.calculatedEfficiency 
            ? `${r.calculatedEfficiency} <span class="unit" style="font-size: 0.65rem; color: var(--text-secondary);">km/L</span>` 
            : (r.distanceMethod === 'odometer' && isNaN(parseFloat(r.odometer)) 
                ? '<span class="invalid" style="color: var(--text-muted); font-size:0.75rem;">距離未入力</span>' 
                : '<span class="invalid">初回給油</span>');

        if (r.calculatedEfficiency && r.skippedRecordsCount > 0) {
            efficiencyText += `<div style="font-size: 0.55rem; color: var(--warning); margin-top: 2px;"><i class="fa-solid fa-clock-rotate-left"></i> ${r.skippedRecordsCount}回スキップ</div>`;
        }

        html += `
            <div class="recent-record-item">
                <div class="record-item-left">
                    <div class="record-item-date">
                        <span class="day">${day}</span>
                        <span class="month">${month}</span>
                    </div>
                    <div class="record-item-summary">
                        <h4>${vehicleName}</h4>
                        <p>${costFuelStr}</p>
                    </div>
                </div>
                <div class="record-item-right">
                    <div class="record-item-efficiency">${efficiencyText}</div>
                    <div class="record-item-cost">${r.unitPrice ? r.unitPrice + ' 円/L' : ''}</div>
                </div>
            </div>`;
    });

    listContainer.innerHTML = html;
}

// Render line chart showing trends
function renderChart(filteredRecords) {
    const ctx = document.getElementById('efficiencyChart');
    if (!ctx) return;

    // Determine target records
    if (!filteredRecords) {
        const selectedVehicleId = document.getElementById('global-vehicle-select').value;
        filteredRecords = records;
        if (selectedVehicleId !== 'all') {
            filteredRecords = records.filter(r => r.vehicleId === selectedVehicleId);
        }
    }

    // Sort chronologically
    const sorted = [...filteredRecords].sort((a, b) => new Date(a.date) - new Date(b.date));

    // Destroy existing chart
    if (chartInstance) {
        chartInstance.destroy();
    }

    // Extract dates and data points
    // To make graph look good, we skip records that don't have the chosen metric value
    let labels = [];
    let dataPoints = [];

    sorted.forEach(r => {
        if (currentChartType === 'efficiency') {
            if (r.calculatedEfficiency !== null) {
                labels.push(r.date);
                dataPoints.push(r.calculatedEfficiency);
            }
        } else {
            if (r.unitPrice !== null && r.unitPrice !== undefined && r.unitPrice !== '') {
                labels.push(r.date);
                dataPoints.push(parseFloat(r.unitPrice));
            }
        }
    });

    if (labels.length === 0) {
        ctx.style.display = 'none';
        let parent = ctx.parentElement;
        let placeholder = parent.querySelector('.chart-placeholder');
        if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.className = 'chart-placeholder empty-state';
            parent.appendChild(placeholder);
        }
        placeholder.innerHTML = `
            <i class="fa-solid fa-chart-line text-muted" style="font-size: 2.5rem;"></i>
            <p style="margin-top:10px;">グラフを描画するための十分な給油データ（2点以上）がありません。</p>
        `;
        return;
    }

    // Graph exists, hide placeholder
    ctx.style.display = 'block';
    const placeholder = ctx.parentElement.querySelector('.chart-placeholder');
    if (placeholder) placeholder.remove();

    // Setup chart parameters according to active theme colors
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 23, 42, 0.05)';
    const textColor = isDark ? '#9ca3af' : '#475569';
    
    let label = currentChartType === 'efficiency' ? '燃費 (km/L)' : '単価 (円/L)';
    let lineColor = currentChartType === 'efficiency' ? '#00fe9c' : '#00f2fe';
    let gradientStart = currentChartType === 'efficiency' ? 'rgba(0, 254, 156, 0.2)' : 'rgba(0, 242, 254, 0.2)';
    let gradientEnd = 'rgba(0, 0, 0, 0)';

    // Get context gradient
    const chartCtx = ctx.getContext('2d');
    const gradient = chartCtx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, gradientStart);
    gradient.addColorStop(1, gradientEnd);

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: dataPoints,
                borderColor: lineColor,
                borderWidth: 3,
                backgroundColor: gradient,
                fill: true,
                tension: 0.3,
                pointBackgroundColor: lineColor,
                pointBorderColor: isDark ? '#0d1527' : '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: isDark ? 'rgba(13, 21, 39, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                    titleColor: isDark ? '#ffffff' : '#0f172a',
                    bodyColor: isDark ? '#ffffff' : '#0f172a',
                    borderColor: lineColor,
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.raw} ${currentChartType === 'efficiency' ? 'km/L' : '円/L'}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: gridColor
                    },
                    ticks: {
                        color: textColor,
                        font: {
                            family: 'Outfit'
                        }
                    }
                },
                y: {
                    grid: {
                        color: gridColor
                    },
                    ticks: {
                        color: textColor,
                        font: {
                            family: 'Outfit'
                        }
                    }
                }
            }
        }
    });
}

// ==========================================================================
// ADD & EDIT RECORD OPERATIONS
// ==========================================================================
function saveNewRecord() {
    const vId = document.getElementById('record-vehicle').value;
    const date = document.getElementById('record-date').value;
    const method = document.querySelector('input[name="distance-method"]:checked').value;
    
    let odometer = null;
    let trip = null;

    if (method === 'odometer') {
        const odoVal = document.getElementById('record-odometer').value;
        odometer = odoVal !== '' ? parseFloat(odoVal) : null;
    } else {
        trip = parseFloat(document.getElementById('record-trip').value);
    }

    const fuel = parseFloat(document.getElementById('record-fuel').value);
    const unitPriceInput = document.getElementById('record-unit-price').value;
    const totalCostInput = document.getElementById('record-total-cost').value;
    
    const unitPrice = unitPriceInput !== '' ? parseFloat(unitPriceInput) : null;
    const totalCost = totalCostInput !== '' ? parseFloat(totalCostInput) : null;
    
    const fuelType = document.getElementById('record-fuel-type').value;
    
    // Extract checked tags
    const checkedTags = [];
    document.querySelectorAll('input[name="tags"]:checked').forEach(cb => {
        checkedTags.push(cb.value);
    });

    const note = document.getElementById('record-note').value;

    // Validate inputs
    if (isNaN(fuel) || fuel <= 0) {
        showToast('給油量を正しく入力してください。', 'error');
        return;
    }

    if (method === 'odometer' && odometer !== null && (isNaN(odometer) || odometer < 0)) {
        showToast('オドメーター値を正しく入力してください。', 'error');
        return;
    }

    if (method === 'trip' && (isNaN(trip) || trip <= 0)) {
        showToast('区間走行距離を正しく入力してください。', 'error');
        return;
    }

    // Build record object
    const newRecord = {
        id: 'record_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        vehicleId: vId,
        date: date,
        distanceMethod: method,
        odometer: odometer,
        trip: trip,
        fuel: fuel,
        unitPrice: unitPrice,
        totalCost: totalCost,
        fuelType: fuelType,
        tags: checkedTags,
        note: note,
        createdAt: new Date().toISOString()
    };

    records.push(newRecord);
    saveRecords();
    unsavedCount++;
    localStorage.setItem(STORAGE_KEYS.UNSAVED_COUNT, unsavedCount);
    updateBackupStatus();
    
    showToast('給油記録を保存しました！');
    
    // Clear and reset form
    document.getElementById('add-record-form').reset();
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('record-date').value = today;
    document.querySelector('input[name="distance-method"][value="odometer"]').click();
    
    // Redirect to Dashboard
    setTimeout(() => {
        navigateTab('dashboard');
        window.location.hash = 'dashboard';
    }, 500);
}

// Delete Record
function deleteRecord(id) {
    if (confirm('この給油記録を削除してもよろしいですか？')) {
        records = records.filter(r => r.id !== id);
        saveRecords();
        unsavedCount++;
        localStorage.setItem(STORAGE_KEYS.UNSAVED_COUNT, unsavedCount);
        updateBackupStatus();
        showToast('記録を削除しました。');
        
        // Refresh visible page
        if (activeTab === 'dashboard') {
            updateDashboard();
        } else if (activeTab === 'records-history') {
            updateHistoryTable();
        }
    }
}

// Edit Record Modal Actions
function openEditModal(id) {
    const record = records.find(r => r.id === id);
    if (!record) return;

    // Populate modal fields
    document.getElementById('edit-record-id').value = record.id;
    document.getElementById('edit-record-vehicle').value = record.vehicleId;
    document.getElementById('edit-record-date').value = record.date;
    
    // Setup method toggle
    if (record.distanceMethod === 'odometer') {
        document.getElementById('edit-method-odometer').checked = true;
        document.getElementById('edit-odometer-group').classList.remove('d-none');
        document.getElementById('edit-record-odometer').value = record.odometer;
        document.getElementById('edit-record-odometer').removeAttribute('required');
        
        document.getElementById('edit-method-trip').checked = false;
        document.getElementById('edit-trip-group').classList.add('d-none');
        document.getElementById('edit-record-trip').value = '';
        document.getElementById('edit-record-trip').removeAttribute('required');
    } else {
        document.getElementById('edit-method-odometer').checked = false;
        document.getElementById('edit-odometer-group').classList.add('d-none');
        document.getElementById('edit-record-odometer').value = '';
        document.getElementById('edit-record-odometer').removeAttribute('required');
        
        document.getElementById('edit-method-trip').checked = true;
        document.getElementById('edit-trip-group').classList.remove('d-none');
        document.getElementById('edit-record-trip').value = record.trip;
        document.getElementById('edit-record-trip').setAttribute('required', 'required');
    }

    document.getElementById('edit-record-fuel').value = record.fuel;
    document.getElementById('edit-record-unit-price').value = record.unitPrice || '';
    document.getElementById('edit-record-total-cost').value = record.totalCost || '';
    document.getElementById('edit-record-fuel-type').value = record.fuelType;
    document.getElementById('edit-record-note').value = record.note || '';

    // Check tags
    document.querySelectorAll('input[name="edit-tags"]').forEach(cb => {
        cb.checked = record.tags.includes(cb.value);
    });

    // Show Modal
    editModal.classList.add('active');
}

function closeModal() {
    if (editModal) {
        editModal.classList.remove('active');
    }
}

function saveEditedRecord(e) {
    e.preventDefault();
    const id = document.getElementById('edit-record-id').value;
    const idx = records.findIndex(r => r.id === id);
    if (idx === -1) return;

    const vId = document.getElementById('edit-record-vehicle').value;
    const date = document.getElementById('edit-record-date').value;
    const method = document.querySelector('input[name="edit-distance-method"]:checked').value;
    
    let odometer = null;
    let trip = null;

    if (method === 'odometer') {
        const odoVal = document.getElementById('edit-record-odometer').value;
        odometer = odoVal !== '' ? parseFloat(odoVal) : null;
    } else {
        trip = parseFloat(document.getElementById('edit-record-trip').value);
    }

    const fuel = parseFloat(document.getElementById('edit-record-fuel').value);
    const unitPriceVal = document.getElementById('edit-record-unit-price').value;
    const totalCostVal = document.getElementById('edit-record-total-cost').value;
    
    const unitPrice = unitPriceVal !== '' ? parseFloat(unitPriceVal) : null;
    const totalCost = totalCostVal !== '' ? parseFloat(totalCostVal) : null;
    const fuelType = document.getElementById('edit-record-fuel-type').value;

    const checkedTags = [];
    document.querySelectorAll('input[name="edit-tags"]:checked').forEach(cb => {
        checkedTags.push(cb.value);
    });
    const note = document.getElementById('edit-record-note').value;

    // Validate inputs
    if (isNaN(fuel) || fuel <= 0) {
        showToast('給油量を正しく入力してください。', 'error');
        return;
    }
    if (method === 'odometer' && odometer !== null && (isNaN(odometer) || odometer < 0)) {
        showToast('オドメーター値を正しく入力してください。', 'error');
        return;
    }
    if (method === 'trip' && (isNaN(trip) || trip <= 0)) {
        showToast('区間走行距離を正しく入力してください。', 'error');
        return;
    }

    // Update record
    records[idx] = {
        ...records[idx],
        vehicleId: vId,
        date: date,
        distanceMethod: method,
        odometer: odometer,
        trip: trip,
        fuel: fuel,
        unitPrice: unitPrice,
        totalCost: totalCost,
        fuelType: fuelType,
        tags: checkedTags,
        note: note
    };

    saveRecords();
    unsavedCount++;
    localStorage.setItem(STORAGE_KEYS.UNSAVED_COUNT, unsavedCount);
    updateBackupStatus();
    closeModal();
    showToast('記録を更新しました。');

    // Refresh active tab
    if (activeTab === 'records-history') {
        updateHistoryTable();
    } else {
        updateDashboard();
    }
}

// ==========================================================================
// HISTORY TABLE LOGIC
// ==========================================================================
function updateHistoryTable() {
    const tableBody = document.getElementById('history-table-body');
    const recordsCountEl = document.getElementById('records-count');
    if (!tableBody) return;

    const searchVal = document.getElementById('history-search').value.toLowerCase();
    const fuelTypeFilterVal = document.getElementById('history-filter-fuel-type').value;
    const selectedVehicleId = document.getElementById('global-vehicle-select').value;

    // Filter records
    let filtered = records;
    
    // Filter by vehicle
    if (selectedVehicleId !== 'all') {
        filtered = filtered.filter(r => r.vehicleId === selectedVehicleId);
    }

    // Filter by fuel type
    if (fuelTypeFilterVal !== 'all') {
        filtered = filtered.filter(r => r.fuelType === fuelTypeFilterVal);
    }

    // Filter by search text (memo, tags, vehicle name)
    if (searchVal) {
        filtered = filtered.filter(r => {
            const v = vehicles.find(veh => veh.id === r.vehicleId);
            const vehicleName = v ? v.name.toLowerCase() : '';
            const makerName = v && v.maker ? v.maker.toLowerCase() : '';
            const noteText = r.note ? r.note.toLowerCase() : '';
            const tagsText = r.tags.join(' ').toLowerCase();
            
            return vehicleName.includes(searchVal) || 
                   makerName.includes(searchVal) ||
                   noteText.includes(searchVal) || 
                   tagsText.includes(searchVal) ||
                   r.date.includes(searchVal);
        });
    }

    // Sort chronologically descending for listing
    filtered.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        if (dateA.getTime() !== dateB.getTime()) {
            return dateB - dateA;
        }
        return b.id.localeCompare(a.id);
    });

    recordsCountEl.textContent = filtered.length;

    if (filtered.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 3rem; color: var(--text-muted);">
                    <i class="fa-solid fa-folder-open" style="font-size: 2rem; margin-bottom: 10px; display: block;"></i>
                    該当する給油記録が見つかりません。
                </td>
            </tr>`;
        return;
    }

    let html = '';
    filtered.forEach(r => {
        const v = vehicles.find(veh => veh.id === r.vehicleId);
        const vehicleName = v ? v.name : '削除済みの車両';
        const costStr = r.totalCost ? `${parseInt(r.totalCost).toLocaleString()}円` : '-';
        const unitPriceStr = r.unitPrice ? `${r.unitPrice}円` : '-';
        
        let distanceStr = '-';
        if (r.calculatedTrip !== null && r.calculatedTrip !== undefined) {
            distanceStr = `${r.calculatedTrip} km`;
            if (r.distanceMethod === 'odometer') {
                distanceStr += ` <small style="color:var(--text-muted); block; font-size:0.7rem;">(Odo: ${r.odometer})</small>`;
            } else {
                distanceStr += ` <small style="color:var(--text-muted); block; font-size:0.7rem;">(Trip)</small>`;
            }
        } else if (r.distanceMethod === 'odometer') {
            if (isNaN(parseFloat(r.odometer))) {
                distanceStr = `<small style="color:var(--text-muted); font-style:italic;">距離未記入</small>`;
            } else {
                distanceStr = `<small style="color:var(--text-muted);">初回基準<br>(Odo: ${r.odometer})</small>`;
            }
        }

        let efficiencyText = r.calculatedEfficiency 
            ? `<span class="efficiency-badge">${r.calculatedEfficiency} km/L</span>` 
            : '<span class="efficiency-badge invalid">計算不可</span>';

        if (r.calculatedEfficiency && r.skippedRecordsCount > 0) {
            efficiencyText += `<div style="font-size: 0.65rem; color: var(--warning); margin-top: 4px; line-height: 1.2;"><i class="fa-solid fa-clock-rotate-left"></i> 未入力給油分合算 (${r.skippedRecordsCount}回)</div>`;
        }

        // Tags and Details html
        let detailHtml = `<span class="badge-fuel-type">${r.fuelType}</span>`;
        r.tags.forEach(tag => {
            detailHtml += `<span class="badge-tag" style="margin-left: 3px;">${tag}</span>`;
        });
        if (r.note) {
            detailHtml += `<div class="table-note" style="font-size:0.7rem; color:var(--text-secondary); margin-top:4px;"><i class="fa-regular fa-comment-dots"></i> ${r.note}</div>`;
        }

        html += `
            <tr>
                <td style="white-space: nowrap;">${r.date}</td>
                <td><strong>${vehicleName}</strong></td>
                <td>${distanceStr}</td>
                <td>${r.fuel.toFixed(2)} L</td>
                <td>${unitPriceStr}</td>
                <td><strong>${costStr}</strong></td>
                <td>${efficiencyText}</td>
                <td>${detailHtml}</td>
                <td>
                    <div class="table-row-actions">
                        <button class="btn-icon-edit" onclick="openEditModal('${r.id}')" title="編集"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button class="btn-icon-delete" onclick="deleteRecord('${r.id}')" title="削除"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </td>
            </tr>`;
    });

    tableBody.innerHTML = html;
}

// ==========================================================================
// VEHICLE MANAGEMENT LOGIC
// ==========================================================================
function updateVehiclesTab() {
    const container = document.getElementById('vehicle-cards-container');
    if (!container) return;

    let html = '';
    vehicles.forEach(v => {
        // Compute lifetime average and total distance for this vehicle
        const vRecords = records.filter(r => r.vehicleId === v.id);
        
        let totalDist = 0;
        let totalFuel = 0;
        vRecords.forEach(r => {
            if (r.calculatedTrip) totalDist += r.calculatedTrip;
            if (r.calculatedTrip && r.fuel) totalFuel += parseFloat(r.fuel);
        });

        const avgEfficiency = totalFuel > 0 ? (totalDist / totalFuel).toFixed(2) : '-';
        const isDefault = v.id === 'default-vehicle-id';

        html += `
            <div class="vehicle-card">
                <div class="vehicle-card-left">
                    <div class="vehicle-avatar">
                        <i class="fa-solid fa-car"></i>
                    </div>
                    <div class="vehicle-card-details">
                        <h3>${v.name}</h3>
                        <p>メーカー・型式: ${v.maker || '未設定'} / タンク容量: ${v.fuelCapacity ? v.fuelCapacity + ' L' : '未設定'}</p>
                        <p style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">初期走行距離: ${v.initialOdometer || 0} km</p>
                    </div>
                </div>
                <div class="vehicle-card-stats">
                    <div class="v-stat">
                        <span>平均燃費</span>
                        <strong class="efficiency">${avgEfficiency} ${avgEfficiency !== '-' ? 'km/L' : ''}</strong>
                    </div>
                    <div class="v-stat">
                        <span>記録件数</span>
                        <strong>${vRecords.length} 件</strong>
                    </div>
                    <div class="v-stat">
                        <span>総走行</span>
                        <strong>${totalDist.toLocaleString()} km</strong>
                    </div>
                </div>
                <div class="vehicle-card-actions">
                    ${!isDefault ? `
                        <button class="btn-vehicle-delete" onclick="deleteVehicle('${v.id}')" title="この車両と記録を削除">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>` : `<small style="color:var(--text-muted); font-size:0.65rem;">標準車両</small>`
                    }
                </div>
            </div>`;
    });

    container.innerHTML = html;
}

function saveNewVehicle() {
    const name = document.getElementById('vehicle-name').value.trim();
    const maker = document.getElementById('vehicle-maker').value.trim();
    const initOdoVal = document.getElementById('vehicle-initial-odometer').value;
    const fuelCapVal = document.getElementById('vehicle-fuel-capacity').value;

    const initialOdometer = initOdoVal !== '' ? parseFloat(initOdoVal) : 0;
    const fuelCapacity = fuelCapVal !== '' ? parseFloat(fuelCapVal) : null;

    if (!name) {
        showToast('車両名を入力してください。', 'error');
        return;
    }

    const newVehicle = {
        id: 'vehicle_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: name,
        maker: maker,
        initialOdometer: initialOdometer,
        fuelCapacity: fuelCapacity,
        createdAt: new Date().toISOString()
    };

    vehicles.push(newVehicle);
    saveVehicles();
    unsavedCount++;
    localStorage.setItem(STORAGE_KEYS.UNSAVED_COUNT, unsavedCount);
    updateBackupStatus();
    
    showToast(`車両「${name}」を登録しました。`);
    
    // Clear Form
    document.getElementById('add-vehicle-form').reset();
    
    // Update view
    updateVehiclesTab();
    populateVehicleSelectors();
}

function deleteVehicle(id) {
    if (id === 'default-vehicle-id') {
        showToast('標準車両は削除できません。', 'error');
        return;
    }

    const vehicle = vehicles.find(v => v.id === id);
    if (!vehicle) return;

    const count = records.filter(r => r.vehicleId === id).length;
    let confirmMsg = `本当に車両「${vehicle.name}」を削除してもよろしいですか？`;
    if (count > 0) {
        confirmMsg += `\n※この車両に紐づく ${count} 件の給油記録も同時に削除されます。この操作は取り消せません。`;
    }

    if (confirm(confirmMsg)) {
        // Delete records related to vehicle
        records = records.filter(r => r.vehicleId !== id);
        // Delete vehicle
        vehicles = vehicles.filter(v => v.id !== id);
        
        saveVehicles();
        saveRecords();
        unsavedCount++;
        localStorage.setItem(STORAGE_KEYS.UNSAVED_COUNT, unsavedCount);
        updateBackupStatus();
        
        showToast('車両と関連する給油記録を削除しました。');
        
        // Refresh views
        updateVehiclesTab();
        populateVehicleSelectors();
    }
}

// ==========================================================================
// SIMULATOR LOGIC
// ==========================================================================
function updateSimulator() {
    const distance = parseFloat(document.getElementById('sim-distance').value) || 0;
    const efficiency = parseFloat(document.getElementById('sim-efficiency').value) || 0;
    const price = parseFloat(document.getElementById('sim-price').value) || 0;

    const fuelEl = document.getElementById('sim-res-fuel');
    const costEl = document.getElementById('sim-res-cost');

    if (distance > 0 && efficiency > 0) {
        const requiredFuel = distance / efficiency;
        fuelEl.textContent = requiredFuel.toFixed(1);

        if (price > 0) {
            costEl.textContent = Math.round(requiredFuel * price).toLocaleString();
        } else {
            costEl.textContent = '-';
        }
    } else {
        fuelEl.textContent = '-';
        costEl.textContent = '-';
    }
}

// ==========================================================================
// BACKUP & EXPORT/IMPORT OPERATIONS
// ==========================================================================

// JSON Export
function exportJSON() {
    const dataStr = JSON.stringify({
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        vehicles: vehicles,
        records: records
    }, null, 2);

    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `ecodrive_backup_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    unsavedCount = 0;
    localStorage.setItem(STORAGE_KEYS.UNSAVED_COUNT, unsavedCount);
    updateBackupStatus();
    
    showToast('JSONファイルをエクスポートしました。');
}

// JSON Import
function importJSON(e) {
    const fileReader = new FileReader();
    const file = e.target.files[0];
    
    if (!file) return;

    fileReader.onload = function(event) {
        try {
            const parsedData = JSON.parse(event.target.result);
            
            // Validation
            if (!parsedData.vehicles || !parsedData.records) {
                showToast('不正なバックアップファイルです。インポートできませんでした。', 'error');
                return;
            }

            if (confirm('バックアップデータをインポートしますか？\n現在のデータは上書きされます。')) {
                vehicles = parsedData.vehicles;
                records = parsedData.records;
                
                // Save to storage
                localStorage.setItem(STORAGE_KEYS.VEHICLES, JSON.stringify(vehicles));
                localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
                
                unsavedCount = 0;
                localStorage.setItem(STORAGE_KEYS.UNSAVED_COUNT, unsavedCount);
                
                initData();
                populateVehicleSelectors();
                
                showToast('データのインポートが完了しました！');
                navigateTab('dashboard');
                window.location.hash = 'dashboard';
            }
        } catch (error) {
            showToast('ファイルの解析に失敗しました。JSONファイルか確認してください。', 'error');
        }
    };
    
    fileReader.readAsText(file);
    // Reset file input value
    e.target.value = '';
}

// CSV Export
function exportCSV() {
    // Generate CSV content with UTF-8 BOM for Japanese Excel compatibility
    let csvContent = '\uFEFF';
    
    // Headers
    csvContent += '給油日,車両名,区間走行距離(km),給油量(L),単価(円/L),合計金額(円),燃費(km/L),オドメーター値(km),油種,状況タグ,備考メモ\n';
    
    // Sort records chronologically
    const sortedRecords = [...records].sort((a, b) => new Date(a.date) - new Date(b.date));

    sortedRecords.forEach(r => {
        const v = vehicles.find(veh => veh.id === r.vehicleId);
        const vehicleName = v ? v.name : '不明な車両';
        
        const date = r.date;
        const trip = r.calculatedTrip !== null ? r.calculatedTrip : '';
        const fuel = r.fuel;
        const unitPrice = r.unitPrice !== null ? r.unitPrice : '';
        const totalCost = r.totalCost !== null ? r.totalCost : '';
        const efficiency = r.calculatedEfficiency !== null ? r.calculatedEfficiency : '';
        const odometer = r.odometer !== null ? r.odometer : '';
        const fuelType = r.fuelType;
        const tags = r.tags.join('|');
        const note = r.note ? r.note.replace(/"/g, '""') : ''; // Escape quotes in note

        const row = [
            `"${date}"`,
            `"${vehicleName}"`,
            trip,
            fuel,
            unitPrice,
            totalCost,
            efficiency,
            odometer,
            `"${fuelType}"`,
            `"${tags}"`,
            `"${note}"`
        ];

        csvContent += row.join(',') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const exportFileDefaultName = `ecodrive_records_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', url);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    unsavedCount = 0;
    localStorage.setItem(STORAGE_KEYS.UNSAVED_COUNT, unsavedCount);
    updateBackupStatus();
    
    showToast('CSVファイルをエクスポートしました。');
}

// Reset all data
function resetAllData() {
    if (confirm('【警告】すべての給油記録と登録車両を完全に削除し、初期状態に戻しますか？\nこの操作は元に戻せません。')) {
        localStorage.removeItem(STORAGE_KEYS.VEHICLES);
        localStorage.removeItem(STORAGE_KEYS.RECORDS);
        localStorage.removeItem(STORAGE_KEYS.UNSAVED_COUNT);
        
        initData();
        populateVehicleSelectors();
        
        showToast('データを初期化しました。', 'info');
        navigateTab('dashboard');
        window.location.hash = 'dashboard';
    }
}
