// Configuration
const importantSuggestions = [1,2,3,4,5,6,7,8,9,10,20,30,40,50,60,70,80,90,100];
let soundOn = true, darkMode = false;
let orderCart = [];
let currentTotal = 0;
let paidAmount = 0;
let pendingTransaction = null;
let ecoBagQuantity = 0;
const ECO_BAG_PRICE = 5;

// Storage Manager
class RestaurantStorage {
    constructor() {
        this.dbName = 'SmartChangePOS';
        this.version = 2;
        this.db = null;
        this.storageType = 'localStorage'; // Default
        this.init();
    }

    async init() {
        return new Promise((resolve) => {
            if (!('indexedDB' in window)) {
                console.log('Using localStorage fallback');
                this.storageType = 'localStorage';
                resolve('localStorage');
                return;
            }

            const request = indexedDB.open(this.dbName, this.version);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('orders')) {
                    db.createObjectStore('orders', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('history')) {
                    db.createObjectStore('history', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('pending')) {
                    db.createObjectStore('pending', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('kitchen')) {
                    db.createObjectStore('kitchen', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('pbq')) {
                    db.createObjectStore('pbq', { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.storageType = 'indexedDB';
                console.log('Using IndexedDB');
                resolve('indexedDB');
            };

            request.onerror = () => {
                this.storageType = 'localStorage';
                resolve('localStorage');
            };
        });
    }

    // Generic save method
    async save(storeName, data) {
        if (this.db && this.storageType === 'indexedDB') {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.put({...data, id: data.id || Date.now()});
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } else {
            localStorage.setItem(storeName, JSON.stringify(data));
        }
    }

    // Generic load all method
    async loadAll(storeName) {
        if (this.db && this.storageType === 'indexedDB') {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } else {
            const data = localStorage.getItem(storeName);
            return data ? JSON.parse(data) : [];
        }
    }

    // Clear daily data
    async clearDailyData() {
        if (this.db && this.storageType === 'indexedDB') {
            const stores = ['pending', 'kitchen', 'pbq', 'orders'];
            const transaction = this.db.transaction(stores, 'readwrite');

            stores.forEach(storeName => {
                transaction.objectStore(storeName).clear();
            });

            return new Promise((resolve) => {
                transaction.oncomplete = () => resolve();
            });
        } else {
            const keysToRemove = ['pending', 'kitchen', 'pbq', 'orders', 'pendingOrders', 'kitchenOrders', 'pbqOrders'];
            keysToRemove.forEach(key => localStorage.removeItem(key));
        }
    }

    // Delete single item
    async delete(storeName, id) {
        if (this.db && this.storageType === 'indexedDB') {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.delete(id);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } else {
            const data = await this.loadAll(storeName);
            const updatedData = data.filter(item => item.id !== id);
            localStorage.setItem(storeName, JSON.stringify(updatedData));
        }
    }
}

// Initialize storage
const storage = new RestaurantStorage();

// Orders Storage - will be loaded from storage
let pendingOrders = [];
let kitchenOrders = [];
let pbqOrders = [];
let history = [];

// Global variables
window.currentPaymentOrderId = null;
window.currentAddItemsOrderId = null;
window.addItemsCart = [];

// Load initial data
async function loadInitialData() {
    try {
        pendingOrders = await storage.loadAll('pending');
        kitchenOrders = await storage.loadAll('kitchen');
        pbqOrders = await storage.loadAll('pbq');
        history = await storage.loadAll('history');

        // Migrate from old localStorage if needed
        if (pendingOrders.length === 0) {
            const oldPending = localStorage.getItem('pendingOrders');
            if (oldPending) {
                pendingOrders = JSON.parse(oldPending);
                await Promise.all(pendingOrders.map(order => storage.save('pending', order)));
            }
        }

        if (kitchenOrders.length === 0) {
            const oldKitchen = localStorage.getItem('kitchenOrders');
            if (oldKitchen) {
                kitchenOrders = JSON.parse(oldKitchen);
                await Promise.all(kitchenOrders.map(order => storage.save('kitchen', order)));
            }
        }

        if (pbqOrders.length === 0) {
            const oldPbq = localStorage.getItem('pbqOrders');
            if (oldPbq) {
                pbqOrders = JSON.parse(oldPbq);
                await Promise.all(pbqOrders.map(order => storage.save('pbq', order)));
            }
        }

        if (history.length === 0) {
            const oldHistory = localStorage.getItem('changeHistory');
            if (oldHistory) {
                history = JSON.parse(oldHistory);
                await Promise.all(history.map(transaction => storage.save('history', {
                    ...transaction,
                    id: Date.now() + Math.random()
                })));
            }
        }
    } catch (error) {
        console.log('Error loading data:', error);
    }
}

// Format number with commas
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Play sound
function play(type) {
    if (!soundOn) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g).connect(ctx.destination);
        o.frequency.value = type === 'calc' ? 800 : type === 'err' ? 400 : 600;
        g.gain.setValueAtTime(.1, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .1);
        o.start(); o.stop(ctx.currentTime + .1);
    } catch (e) {}
}

// Tab Switching
function switchTab(tab) {
    // Hide all views
    document.getElementById('cashier-view').style.display = 'none';
    document.getElementById('pending-view').style.display = 'none';
    document.getElementById('kitchen-view').style.display = 'none';
    document.getElementById('pbq-view').style.display = 'none';
    document.getElementById('more-view').style.display = 'none';

    // Remove active class from all buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected view and set active button
    document.getElementById(`${tab}-view`).style.display = 'flex';
    event.currentTarget.classList.add('active');

    // Update orders display for specific views
    if (tab === 'pending') {
        updatePendingDisplay();
    } else if (tab === 'kitchen' || tab === 'pbq') {
        updateKitchenDisplays();
    }

    play('btn');
}

// Get current time in HH:MM format
function getCurrentTime() {
    const now = new Date();
    return now.toTimeString().slice(0, 5);
}

// Get current date and time for timestamps
function getCurrentDateTime() {
    const now = new Date();
    return now.toLocaleString();
}

// ✅ FIXED: Check if order number is already taken (only for walk-in orders)
function isOrderNumberTaken(orderNumber, orderType) {
    if (!orderNumber || orderType === 'tawag') return false; // No numbering for tawag

    // Check pending orders
    const inPending = pendingOrders.some(order => order.number === orderNumber && order.type === 'walkin');
    if (inPending) return true;

    // Check kitchen orders
    const inKitchen = kitchenOrders.some(order => order.number === orderNumber && order.type === 'walkin');
    if (inKitchen) return true;

    // Check PBQ orders
    const inPbq = pbqOrders.some(order => order.number === orderNumber && order.type === 'walkin');
    if (inPbq) return true;

    return false;
}

// Order number validation - only for walk-in orders
document.getElementById('order-number').addEventListener('input', function() {
    const orderType = document.getElementById('order-type').value;
    const errorElement = document.getElementById('order-number-error');

    if (orderType === 'walkin' && isOrderNumberTaken(this.value.trim(), orderType)) {
        this.classList.add('input-error');
        errorElement.style.display = 'block';
    } else {
        this.classList.remove('input-error');
        errorElement.style.display = 'none';
    }
});

// Tawag time input toggle with auto-fill
document.getElementById('order-type').addEventListener('change', function() {
    const pickupTime = document.getElementById('pickup-time');
    const customerName = document.getElementById('customer-name');
    const orderNumber = document.getElementById('order-number');
    const errorElement = document.getElementById('order-number-error');

    if (this.value === 'tawag') {
        pickupTime.style.display = 'block';
        customerName.style.display = 'block';
        orderNumber.placeholder = 'Optional Reference';
        pickupTime.value = getCurrentTime();

        // Clear error for tawag orders
        orderNumber.classList.remove('input-error');
        errorElement.style.display = 'none';
    } else {
        pickupTime.style.display = 'none';
        customerName.style.display = 'none';
        orderNumber.placeholder = 'Order Number';

        // Re-validate if there's a value
        if (orderNumber.value.trim()) {
            if (isOrderNumberTaken(orderNumber.value.trim(), 'walkin')) {
                orderNumber.classList.add('input-error');
                errorElement.style.display = 'block';
            }
        }
    }
});

// Save order as pending (for Tawag orders)
async function saveAsPending() {
    const orderType = document.getElementById('order-type').value;
    const orderNumber = document.getElementById('order-number').value.trim();
    const customerName = document.getElementById('customer-name').value;
    const pickupTime = document.getElementById('pickup-time').value;
    const orderNotes = document.getElementById('order-notes').value.trim();

    // Validate based on order type
    if (orderType === 'walkin') {
        if (!orderNumber) {
            alert('Please enter an order number for walk-in order');
            return;
        }

        if (isOrderNumberTaken(orderNumber, orderType)) {
            alert('Order number already exists. Please use a different number.');
            return;
        }
    } else { // tawag
        if (!customerName) {
            alert('Please enter customer name for Tawag order');
            return;
        }
    }

    if (orderCart.length === 0 && ecoBagQuantity === 0) {
        alert('Please add items to the order');
        return;
    }

    const orderTotal = orderCart.reduce((sum, item) => sum + item.total, 0) + (ecoBagQuantity * ECO_BAG_PRICE);
    const orderId = Date.now();

    // Create pending order - for tawag, use customer name as identifier
    const pendingOrder = {
        id: orderId,
        number: orderType === 'tawag' ? `TAWAG-${customerName}-${Date.now().toString().slice(-4)}` : orderNumber,
        type: orderType,
        customerName: customerName,
        pickupTime: pickupTime,
        notes: orderNotes,
        timestamp: getCurrentDateTime(),
        items: [...orderCart],
        ecoBags: ecoBagQuantity,
        total: orderTotal,
        status: 'pending',
        paid: false
    };

    try {
        // Save to pending orders
        pendingOrders.push(pendingOrder);
        await storage.save('pending', pendingOrder);

        // Send to kitchen immediately for cooking
        await sendOrderToKitchen(pendingOrder);

        // Reset order form
        resetOrderForm();

        closePayment();
        updatePendingDisplay();
        updateKitchenDisplays();

        play('btn');
        alert(`Order ${orderType === 'tawag' ? 'for ' + customerName : '#' + orderNumber} saved as pending and sent to kitchen/PBQ!`);
    } catch (error) {
        console.error('Error saving order:', error);
        alert('Error saving order. Please try again.');
    }
}

// Proceed to Payment for Tawag Orders
function proceedToPayment(orderId) {
    const order = pendingOrders.find(o => o.id === orderId);
    if (!order) return;

    // Set up payment modal for this specific order
    currentTotal = order.total;
    paidAmount = 0;

    // Show payment modal with order context
    document.getElementById('payment-total').textContent = `₱${formatNumber(currentTotal)}`;
    document.getElementById('payment-paid').textContent = `₱0`;
    document.getElementById('payment-change').textContent = `₱0`;

    // Store which order we're processing payment for
    window.currentPaymentOrderId = orderId;

    // Show payment modal
    document.getElementById('payment-modal').classList.add('show');
    play('btn');
}

// Add Items to Kitchen Order
function addItemsToOrder(orderId) {
    const order = [...kitchenOrders, ...pbqOrders].find(o => o.id === orderId);
    if (!order) return;

    window.currentAddItemsOrderId = orderId;
    window.addItemsCart = [];

    // Populate add items grid
    const addItemsGrid = document.getElementById('add-items-grid');
    addItemsGrid.innerHTML = `
    <button class="add-item-btn meat" onclick="addToAddItemsCart(27, 'PBQ')">
    <div class="food-icon">🍢</div>
    <div class="food-name">PBQ</div>
    <div class="food-price">₱27</div>
    </button>
    <button class="add-item-btn noodles" onclick="addToAddItemsCart(240, 'Pancit')">
    <div class="food-icon">🍝</div>
    <div class="food-name">Pancit</div>
    <div class="food-price">₱240</div>
    </button>
    <button class="add-item-btn noodles" onclick="addToAddItemsCart(220, 'Lomi')">
    <div class="food-icon">🍜</div>
    <div class="food-name">Lomi</div>
    <div class="food-price">₱220</div>
    </button>
    <button class="add-item-btn veggie" onclick="addToAddItemsCart(230, 'Chopsuey')">
    <div class="food-icon">🥗</div>
    <div class="food-name">Chopsuey</div>
    <div class="food-price">₱230</div>
    </button>
    <button class="add-item-btn noodles" onclick="addToAddItemsCart(230, 'Bihon')">
    <div class="food-icon">🍝</div>
    <div class="food-name">Bihon</div>
    <div class="food-price">₱230</div>
    </button>
    <button class="add-item-btn noodles" onclick="addToAddItemsCart(240, 'Bam-e')">
    <div class="food-icon">🍲</div>
    <div class="food-name">Bam-e</div>
    <div class="food-price">₱240</div>
    </button>
    `;

    document.getElementById('add-items-modal').classList.add('show');
    play('btn');
}

function addToAddItemsCart(price, name) {
    const existingItem = window.addItemsCart.find(item => item.name === name);

    if (existingItem) {
        existingItem.quantity++;
        existingItem.total = existingItem.quantity * price;
    } else {
        window.addItemsCart.push({
            name: name,
            price: price,
            quantity: 1,
            total: price
        });
    }
    play('btn');
}

async function confirmAddItems() {
    const orderId = window.currentAddItemsOrderId;
    if (!orderId || window.addItemsCart.length === 0) return;

    // Find order in kitchen or PBQ
    let order = kitchenOrders.find(o => o.id === orderId);
    let orderArray = kitchenOrders;
    let storageKey = 'kitchen';

    if (!order) {
        order = pbqOrders.find(o => o.id === orderId);
        orderArray = pbqOrders;
        storageKey = 'pbq';
    }

    if (order) {
        // Add new items to order
        window.addItemsCart.forEach(newItem => {
            const existingItem = order.items.find(item => item.name === newItem.name);
            if (existingItem) {
                existingItem.quantity += newItem.quantity;
                existingItem.total = existingItem.quantity * existingItem.price;
            } else {
                order.items.push({...newItem});
            }
        });

        // Update total
        const addItemsTotal = window.addItemsCart.reduce((sum, item) => sum + item.total, 0);
        order.total += addItemsTotal;

        try {
            // Save updated orders
            await storage.save(storageKey, order);

            // Update pending order if it exists
            const pendingOrder = pendingOrders.find(o => o.id === orderId);
            if (pendingOrder) {
                window.addItemsCart.forEach(newItem => {
                    const existingItem = pendingOrder.items.find(item => item.name === newItem.name);
                    if (existingItem) {
                        existingItem.quantity += newItem.quantity;
                        existingItem.total = existingItem.quantity * existingItem.price;
                    } else {
                        pendingOrder.items.push({...newItem});
                    }
                });
                pendingOrder.total += addItemsTotal;
                await storage.save('pending', pendingOrder);
            }

            updateKitchenDisplays();
            updatePendingDisplay();

            closeAddItems();
            play('btn');
            alert('Items added to order!');
        } catch (error) {
            console.error('Error adding items:', error);
            alert('Error adding items. Please try again.');
        }
    }
}

function closeAddItems() {
    document.getElementById('add-items-modal').classList.remove('show');
    window.currentAddItemsOrderId = null;
    window.addItemsCart = [];
}

// Send order to kitchen
async function sendOrderToKitchen(orderData) {
    // Separate items for kitchen and PBQ
    const kitchenItems = orderData.items.filter(item => item.name !== 'PBQ');
    const pbqItems = orderData.items.filter(item => item.name === 'PBQ');

    const order = {
        id: orderData.id,
        number: orderData.number,
        type: orderData.type,
        customerName: orderData.customerName,
        pickupTime: orderData.pickupTime,
        notes: orderData.notes,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'new',
        items: [...orderData.items],
        total: orderData.total,
        paid: orderData.paid || false
    };

    try {
        // Send to appropriate queues
        if (kitchenItems.length > 0) {
            kitchenOrders.push({...order, items: kitchenItems});
            await storage.save('kitchen', {...order, items: kitchenItems});
        }

        if (pbqItems.length > 0) {
            pbqOrders.push({...order, items: pbqItems});
            await storage.save('pbq', {...order, items: pbqItems});
        }

        updateKitchenDisplays();
    } catch (error) {
        console.error('Error sending to kitchen:', error);
    }
}

// Mark Tawag order as paid
async function markTawagOrderAsPaid(orderId) {
    const orderIndex = pendingOrders.findIndex(order => order.id === orderId);
    if (orderIndex !== -1) {
        try {
            // Update payment status in kitchen/PBQ orders
            await updateOrderPaymentStatus(orderId, true);

            // Remove from pending orders
            const removedOrder = pendingOrders.splice(orderIndex, 1)[0];
            await storage.delete('pending', orderId);

            updatePendingDisplay();
            updateKitchenDisplays();
        } catch (error) {
            console.error('Error marking order as paid:', error);
        }
    }
}

// Update payment status in kitchen/PBQ orders
async function updateOrderPaymentStatus(orderId, paidStatus) {
    // Update in kitchen orders
    const kitchenOrderIndex = kitchenOrders.findIndex(order => order.id === orderId);
    if (kitchenOrderIndex !== -1) {
        kitchenOrders[kitchenOrderIndex].paid = paidStatus;
        await storage.save('kitchen', kitchenOrders[kitchenOrderIndex]);
    }

    // Update in PBQ orders
    const pbqOrderIndex = pbqOrders.findIndex(order => order.id === orderId);
    if (pbqOrderIndex !== -1) {
        pbqOrders[pbqOrderIndex].paid = paidStatus;
        await storage.save('pbq', pbqOrders[pbqOrderIndex]);
    }
}

// Edit pending order
async function editPendingOrder(orderId) {
    const order = pendingOrders.find(order => order.id === orderId);

    if (order) {
        // Populate form with order data
        document.getElementById('order-number').value = order.type === 'walkin' ? order.number : '';
        document.getElementById('order-type').value = order.type;
        document.getElementById('customer-name').value = order.customerName;
        document.getElementById('pickup-time').value = order.pickupTime;
        document.getElementById('order-notes').value = order.notes || '';

        // Set order cart
        orderCart = [...order.items];
        ecoBagQuantity = order.ecoBags;

        updateOrderDisplay();

        try {
            // Remove from pending and kitchen/PBQ
            const orderIndex = pendingOrders.findIndex(o => o.id === orderId);
            pendingOrders.splice(orderIndex, 1);
            await storage.delete('pending', orderId);

            // Remove from kitchen/PBQ
            await removeOrderFromKitchen(orderId);

            updatePendingDisplay();
            updateKitchenDisplays();
            switchTab('cashier');

            play('btn');
        } catch (error) {
            console.error('Error editing order:', error);
        }
    }
}

// Remove order from kitchen/PBQ
async function removeOrderFromKitchen(orderId) {
    kitchenOrders = kitchenOrders.filter(order => order.id !== orderId);
    pbqOrders = pbqOrders.filter(order => order.id !== orderId);

    try {
        await storage.delete('kitchen', orderId);
        await storage.delete('pbq', orderId);
    } catch (error) {
        console.error('Error removing from kitchen:', error);
    }
}

// Cancel pending order
async function cancelPendingOrder(orderId) {
    if (confirm('Are you sure you want to cancel this order?')) {
        const orderIndex = pendingOrders.findIndex(order => order.id === orderId);

        if (orderIndex !== -1) {
            try {
                // Remove from pending
                pendingOrders.splice(orderIndex, 1);
                await storage.delete('pending', orderId);

                // Remove from kitchen/PBQ
                await removeOrderFromKitchen(orderId);

                updatePendingDisplay();
                updateKitchenDisplays();
                play('btn');
            } catch (error) {
                console.error('Error canceling order:', error);
            }
        }
    }
}

// Update pending orders display
function updatePendingDisplay() {
    const pendingContainer = document.getElementById('pending-orders');

    if (pendingOrders.length === 0) {
        pendingContainer.innerHTML = '<div style="text-align:center;color:#8a6dcc;padding:30px;font-weight:600;">No pending orders</div>';
    } else {
        pendingContainer.innerHTML = pendingOrders.map(order => {
            const displayIdentifier = order.type === 'tawag' ? order.customerName : `#${order.number}`;

            return `
            <div class="order-card">
            <div class="order-header">
            <div class="order-number">${displayIdentifier}</div>
            <div class="order-type tawag">TAWAG</div>
            </div>
            <div class="order-time">
            <i class="fas fa-clock"></i> ${order.timestamp}
            </div>
            ${order.type === 'tawag' ? `
                <div class="order-time">
                <i class="fas fa-user"></i> ${order.customerName}${order.pickupTime ? ` • Pickup: ${order.pickupTime}` : ''}
                </div>
                ` : ''}
                ${order.notes ? `<div class="order-notes">${order.notes}</div>` : ''}
                <div class="order-items">
                ${order.items.map(item => `
                    <div class="order-item">
                    <span class="order-item-name">${item.name}</span>
                    <span class="order-item-quantity">×${item.quantity}</span>
                    </div>
                    `).join('')}
                    ${order.ecoBags > 0 ? `
                        <div class="order-item">
                        <span class="order-item-name">Eco Bag</span>
                        <span class="order-item-quantity">×${order.ecoBags}</span>
                        </div>
                        ` : ''}
                        </div>
                        <div class="order-total">Total: ₱${formatNumber(order.total)}</div>
                        <div class="order-actions">
                        <button class="btn-status btn-edit" onclick="editPendingOrder(${order.id})">
                        <i class="fas fa-edit"></i> Edit
                        </button>
                        <button class="btn-status btn-cancel" onclick="cancelPendingOrder(${order.id})">
                        <i class="fas fa-times"></i> Cancel
                        </button>
                        <button class="btn-status btn-collect-payment" onclick="proceedToPayment(${order.id})">
                        <i class="fas fa-credit-card"></i> Collect Payment
                        </button>
                        </div>
                        </div>
                        `}).join('');
    }
}

// Update kitchen displays
function updateKitchenDisplays() {
    // Kitchen View - Non-PBQ items only
    const kitchenWalkinOrders = kitchenOrders.filter(order =>
    order.type === 'walkin' && order.status !== 'completed'
    );
    const kitchenTawagOrders = kitchenOrders.filter(order =>
    order.type === 'tawag' && order.status !== 'completed'
    );

    document.getElementById('kitchen-walkin-orders').innerHTML =
    kitchenWalkinOrders.map(order => createOrderCard(order, 'kitchen')).join('') ||
    '<div style="text-align:center;color:#8a6dcc;padding:20px;">No walk-in orders</div>';

    document.getElementById('kitchen-tawag-orders').innerHTML =
    kitchenTawagOrders.map(order => createOrderCard(order, 'kitchen')).join('') ||
    '<div style="text-align:center;color:#8a6dcc;padding:20px;">No tawag orders</div>';

    // PBQ View - PBQ items only
    const pbqWalkinOrders = pbqOrders.filter(order =>
    order.type === 'walkin' && order.status !== 'completed'
    );
    const pbqTawagOrders = pbqOrders.filter(order =>
    order.type === 'tawag' && order.status !== 'completed'
    );

    document.getElementById('pbq-walkin-orders').innerHTML =
    pbqWalkinOrders.map(order => createOrderCard(order, 'pbq')).join('') ||
    '<div style="text-align:center;color:#8a6dcc;padding:20px;">No walk-in orders</div>';

    document.getElementById('pbq-tawag-orders').innerHTML =
    pbqTawagOrders.map(order => createOrderCard(order, 'pbq')).join('') ||
    '<div style="text-align:center;color:#8a6dcc;padding:20px;">No tawag orders</div>';
}

// Create order card for kitchen/pbq displays
function createOrderCard(order, view) {
    let customerInfo = '';
    if (order.type === 'tawag' && order.customerName) {
        customerInfo = ` • ${order.customerName}${order.pickupTime ? ` - Pickup: ${order.pickupTime}` : ''}`;
    } else if (order.type === 'tawag' && order.pickupTime) {
        customerInfo = ` • Pickup: ${order.pickupTime}`;
    }

    const paymentStatus = order.paid ?
    '<span class="payment-status paid">PAID</span>' :
    '<span class="payment-status unpaid">UNPAID</span>';

    const displayIdentifier = order.type === 'tawag' ? order.customerName : `#${order.number}`;

    return `
    <div class="order-card">
    <div class="order-header">
    <div class="order-number">${displayIdentifier} ${paymentStatus}</div>
    <div class="order-type ${order.type}">${order.type === 'walkin' ? 'WALK-IN' : 'TAWAG'}</div>
    </div>
    <div class="order-time">${order.timestamp}${customerInfo}</div>
    ${order.notes ? `<div class="order-notes">${order.notes}</div>` : ''}
    <div class="order-items">
    ${order.items.map(item => `
        <div class="order-item">
        <span class="order-item-name">${item.name}</span>
        <span class="order-item-quantity">×${item.quantity}</span>
        </div>
        `).join('')}
        </div>
        <div class="order-actions">
        <button class="btn-status btn-add-items" onclick="addItemsToOrder(${order.id})">
        <i class="fas fa-plus"></i> Add Items
        </button>
        <button class="btn-status btn-cooking" onclick="updateOrderStatus(${order.id}, 'cooking', '${view}')">
        Cooking
        </button>
        <button class="btn-status btn-ready" onclick="updateOrderStatus(${order.id}, 'ready', '${view}')">
        Ready
        </button>
        <button class="btn-status btn-complete" onclick="updateOrderStatus(${order.id}, 'completed', '${view}')">
        Complete
        </button>
        </div>
        </div>
        `;
}

// Update order status
async function updateOrderStatus(orderId, status, view) {
    let ordersArray = view === 'kitchen' ? kitchenOrders : pbqOrders;
    const orderIndex = ordersArray.findIndex(order => order.id === orderId);

    if (orderIndex !== -1) {
        ordersArray[orderIndex].status = status;

        // If order is completed, add to history if not already there
        if (status === 'completed') {
            const order = ordersArray[orderIndex];
            const transaction = {
                id: Date.now() + Math.random(),
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                total: order.total,
                paid: order.total,
                change: 0,
                items: [...order.items],
                ecoBags: 0,
                orderNumber: order.number,
                customerName: order.customerName,
                type: order.type
            };

            // Check if this transaction already exists in history
            const existingTransaction = history.find(t =>
            t.orderNumber === order.number && t.time === order.timestamp
            );

            if (!existingTransaction) {
                history.unshift(transaction);
                if (history.length > 50) history.pop();
                try {
                    await storage.save('history', transaction);
                } catch (error) {
                    console.error('Error saving to history:', error);
                }
            }
        }

        try {
            await storage.save(view === 'kitchen' ? 'kitchen' : 'pbq', ordersArray[orderIndex]);
            updateKitchenDisplays();
            play('btn');
        } catch (error) {
            console.error('Error updating order status:', error);
        }
    }
}

// Reset order form
function resetOrderForm() {
    orderCart = [];
    currentTotal = 0;
    paidAmount = 0;
    ecoBagQuantity = 0;
    pendingTransaction = null;
    window.currentPaymentOrderId = null;

    document.getElementById('order-number').value = '';
    document.getElementById('customer-name').value = '';
    document.getElementById('pickup-time').style.display = 'none';
    document.getElementById('customer-name').style.display = 'none';
    document.getElementById('order-notes').value = '';
    document.getElementById('order-type').value = 'walkin';

    // Clear error state
    document.getElementById('order-number').classList.remove('input-error');
    document.getElementById('order-number-error').style.display = 'none';

    updateOrderDisplay();
}

// Update eco bag display
function updateEcoBagDisplay() {
    const ecoBagBtn = document.getElementById('eco-bag-btn');
    if (ecoBagQuantity > 0) {
        ecoBagBtn.textContent = `Bag ×${ecoBagQuantity} ₱${formatNumber(ecoBagQuantity * ECO_BAG_PRICE)}`;
        ecoBagBtn.style.background = 'linear-gradient(135deg, #4caf50, #66bb6a)';
        ecoBagBtn.style.color = '#fff';
    } else {
        ecoBagBtn.textContent = 'Bag ₱5';
        ecoBagBtn.style.background = 'linear-gradient(135deg, #a8e6cf, #88d1bf)';
        ecoBagBtn.style.color = '#00695c';
    }
    updateOrderTotal();
}

// Eco bag functions
function addEcoBag() {
    ecoBagQuantity++;
    updateEcoBagDisplay();
    play('btn');
}

function removeEcoBag() {
    if (ecoBagQuantity > 0) {
        ecoBagQuantity--;
        updateEcoBagDisplay();
        play('btn');
    }
}

// Update order total including eco bag
function updateOrderTotal() {
    const foodTotal = orderCart.reduce((sum, item) => sum + item.total, 0);
    const ecoBagTotal = ecoBagQuantity * ECO_BAG_PRICE;
    currentTotal = foodTotal + ecoBagTotal;

    const totalDisplay = document.getElementById('total-display');
    const paymentTotal = document.getElementById('payment-total');

    totalDisplay.textContent = `Total: ₱${formatNumber(currentTotal)}`;
    if (paymentTotal) {
        paymentTotal.textContent = `₱${formatNumber(currentTotal)}`;
    }
}

// Order Cart Functions
function addToCart(price, name) {
    const existingItem = orderCart.find(item => item.name === name);

    if (existingItem) {
        existingItem.quantity++;
        existingItem.total = existingItem.quantity * price;
    } else {
        orderCart.push({
            name: name,
            price: price,
            quantity: 1,
            total: price
        });
    }

    updateOrderDisplay();
    play('btn');
}

function updateQuantity(name, change) {
    const item = orderCart.find(item => item.name === name);
    if (item) {
        item.quantity += change;
        if (item.quantity <= 0) {
            orderCart = orderCart.filter(i => i.name !== name);
        } else {
            item.total = item.quantity * item.price;
        }
        updateOrderDisplay();
        play('btn');
    }
}

function updateOrderDisplay() {
    const cartItems = document.getElementById('cart-items');

    if (orderCart.length === 0 && ecoBagQuantity === 0) {
        cartItems.innerHTML = '<div style="text-align:center;color:#8a6dcc;padding:20px;font-weight:600;">No items in order yet</div>';
    } else {
        let cartHTML = '';

        // Add food items
        orderCart.forEach(item => {
            cartHTML += `
            <div class="cart-item">
            <div class="cart-item-info">
            <div class="cart-item-name">${item.name}</div>
            <div class="quantity-controls">
            <button class="btn-quantity btn-minus" onclick="updateQuantity('${item.name}', -1)">
            <i class="fas fa-minus"></i>
            </button>
            <div class="quantity-display">${item.quantity}</div>
            <button class="btn-quantity" onclick="updateQuantity('${item.name}', 1)">
            <i class="fas fa-plus"></i>
            </button>
            </div>
            </div>
            <div class="cart-item-price">₱${formatNumber(item.total)}</div>
            </div>
            `;
        });

        // Add eco bag if any
        if (ecoBagQuantity > 0) {
            cartHTML += `
            <div class="cart-item">
            <div class="cart-item-info">
            <div class="cart-item-name">Eco Bag</div>
            <div class="quantity-controls">
            <button class="btn-quantity btn-minus" onclick="removeEcoBag()">
            <i class="fas fa-minus"></i>
            </button>
            <div class="quantity-display">${ecoBagQuantity}</div>
            <button class="btn-quantity" onclick="addEcoBag()">
            <i class="fas fa-plus"></i>
            </button>
            </div>
            </div>
            <div class="cart-item-price">₱${formatNumber(ecoBagQuantity * ECO_BAG_PRICE)}</div>
            </div>
            `;
        }

        cartItems.innerHTML = cartHTML;
    }

    updateOrderTotal();
}

// Payment Functions
function openPayment() {
    if (currentTotal <= 0) {
        alert('Please add items to your order first');
        return;
    }

    // Check for duplicate order number (only for walk-in)
    const orderType = document.getElementById('order-type').value;
    const orderNumber = document.getElementById('order-number').value.trim();

    if (orderType === 'walkin' && isOrderNumberTaken(orderNumber, orderType)) {
        alert('Order number already exists. Please use a different number.');
        return;
    }

    document.getElementById('payment-total').textContent = `₱${formatNumber(currentTotal)}`;
    paidAmount = 0;
    updatePaymentDisplay();
    document.getElementById('payment-modal').classList.add('show');
    play('btn');
}

function closePayment() {
    document.getElementById('payment-modal').classList.remove('show');
    window.currentPaymentOrderId = null;
}

function updatePaymentDisplay() {
    document.getElementById('payment-paid').textContent = `₱${formatNumber(paidAmount)}`;

    const change = paidAmount - currentTotal;
    const changeElement = document.getElementById('payment-change');
    changeElement.textContent = `₱${formatNumber(Math.abs(change))}`;

    if (change >= 0) {
        changeElement.className = 'payment-value change-value';
    } else {
        changeElement.className = 'payment-value insufficient';
    }
}

function addQuickAmount(amount) {
    paidAmount += amount;
    updatePaymentDisplay();
    play('btn');
}

function paymentInput(digit) {
    paidAmount = paidAmount * 10 + digit;
    updatePaymentDisplay();
    play('btn');
}

function paymentBackspace() {
    paidAmount = Math.floor(paidAmount / 10);
    updatePaymentDisplay();
    play('btn');
}

function paymentClear() {
    paidAmount = 0;
    updatePaymentDisplay();
    play('btn');
}

function setExactAmount() {
    paidAmount = currentTotal;
    updatePaymentDisplay();
    play('btn');
}

function calculateChange() {
    const orderId = window.currentPaymentOrderId;
    const isTawagPayment = !!orderId;
    const orderType = document.getElementById('order-type').value;

    if (paidAmount < currentTotal) {
        alert('Paid amount is less than total');
        play('err');
        return;
    }

    const change = paidAmount - currentTotal;
    document.getElementById('result-change').textContent = `₱${formatNumber(change)}`;

    // Generate suggestions
    const suggestionList = document.getElementById('suggestion-list');
    suggestionList.innerHTML = '';

    let first = true;
    for (const extra of importantSuggestions) {
        const newPaid = paidAmount + extra;
        const newChange = newPaid - currentTotal;
        if (newChange > 0) {
            const cls = first ? 'best' : 'normal';
            suggestionList.innerHTML += `
            <div class="suggestion-item ${cls}" onclick="useSuggestion(${newPaid})">
            Pay <b>₱${formatNumber(newPaid)}</b> → Change <b>₱${formatNumber(newChange)}</b>
            </div>`;
            first = false;
        }
    }

    // Get order info
    const orderNumber = isTawagPayment ?
    pendingOrders.find(o => o.id === orderId).number :
    (orderType === 'walkin' ? document.getElementById('order-number').value : '');

    const customerName = isTawagPayment ?
    pendingOrders.find(o => o.id === orderId).customerName :
    (orderType === 'tawag' ? document.getElementById('customer-name').value : '');

    // Store pending transaction
    pendingTransaction = {
        id: Date.now() + Math.random(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        total: currentTotal,
        paid: paidAmount,
        change: change,
        items: isTawagPayment ?
        pendingOrders.find(o => o.id === orderId).items :
        [...orderCart],
        ecoBags: isTawagPayment ?
        pendingOrders.find(o => o.id === orderId).ecoBags :
        ecoBagQuantity,
        orderNumber: orderNumber,
        customerName: customerName,
        type: isTawagPayment ? 'tawag' : orderType
    };

    document.getElementById('payment-modal').classList.remove('show');
    document.getElementById('result-modal').classList.add('show');
    play('calc');
}

function useSuggestion(newPaid) {
    paidAmount = newPaid;
    updatePaymentDisplay();
    document.getElementById('result-modal').classList.remove('show');
    document.getElementById('payment-modal').classList.add('show');
    play('btn');
}

function closeResult() {
    document.getElementById('result-modal').classList.remove('show');
}

async function completeTransaction() {
    const orderId = window.currentPaymentOrderId;
    const isTawagPayment = !!orderId;
    const orderType = document.getElementById('order-type').value;

    if (pendingTransaction) {
        try {
            // Add to history
            history.unshift(pendingTransaction);
            if (history.length > 50) history.pop();
            await storage.save('history', pendingTransaction);

            if (isTawagPayment) {
                // Mark the pending order as paid and remove from pending
                await markTawagOrderAsPaid(orderId);
            } else if (orderType === 'walkin') {
                // Send walk-in order to kitchen
                const orderNumber = document.getElementById('order-number').value.trim();
                if (orderNumber) {
                    const orderData = {
                        id: Date.now(),
                        number: orderNumber,
                        type: 'walkin',
                        customerName: '',
                        pickupTime: null,
                        notes: document.getElementById('order-notes').value.trim(),
                        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        status: 'new',
                        items: [...orderCart],
                        total: currentTotal,
                        paid: true
                    };
                    await sendOrderToKitchen(orderData);
                }
            }
        } catch (error) {
            console.error('Error completing transaction:', error);
        }
    }

    // Reset everything
    resetOrderForm();

    document.getElementById('result-modal').classList.remove('show');
    play('calc');
}

// More Tab Functions
function toggleTheme() {
    darkMode = !darkMode;
    document.body.classList.toggle('dark-mode', darkMode);
    const themeSwitch = document.getElementById('theme-switch');
    themeSwitch.classList.toggle('active', darkMode);
    play('btn');
}

function toggleSound() {
    soundOn = !soundOn;
    const soundSwitch = document.getElementById('sound-switch');
    soundSwitch.classList.toggle('active', soundOn);
    play('btn');
}

// History Functions
async function showHistory() {
    const historyList = document.getElementById('history-list');

    try {
        history = await storage.loadAll('history');

        if (history.length === 0) {
            historyList.innerHTML = '<div style="text-align:center;color:#8a6dcc;padding:30px;font-weight:600;">No transactions yet</div>';
        } else {
            historyList.innerHTML = history.map(transaction => {
                let itemsText = transaction.items.map(item => `${item.name}×${item.quantity}`).join(', ');
                if (transaction.ecoBags > 0) {
                    itemsText += itemsText ? `, Eco Bag×${transaction.ecoBags}` : `Eco Bag×${transaction.ecoBags}`;
                }

                const orderInfo = transaction.orderNumber && transaction.type === 'walkin' ?
                `Order #${transaction.orderNumber}` :
                (transaction.customerName ? `Order for ${transaction.customerName}` : 'Walk-in Order');

                return `
                <div class="summary-item" style="margin-bottom:15px;padding:15px;background:rgba(138,109,204,0.1);border-radius:15px;">
                <div class="summary-label" style="font-weight:700;color:#8a6dcc;">
                <i class="fas fa-clock"></i> ${transaction.time} • ${orderInfo}
                </div>
                <div class="summary-value" style="margin-top:8px;font-weight:600;">
                Order: ₱${formatNumber(transaction.total)} | Paid: ₱${formatNumber(transaction.paid)} | Change: ₱${formatNumber(transaction.change)}
                </div>
                <div class="summary-label" style="margin-top:8px;font-size:0.8rem;color:#6d5a8a;">
                ${itemsText}
                </div>
                </div>
                `;
            }).join('');
        }

        document.getElementById('history-modal').classList.add('show');
        play('btn');
    } catch (error) {
        console.error('Error loading history:', error);
    }
}

function closeHistory() {
    document.getElementById('history-modal').classList.remove('show');
}

async function clearHistory() {
    if (confirm('Clear all transaction history?')) {
        try {
            history = [];
            await storage.clearDailyData();
            play('btn');
            alert('History cleared!');
        } catch (error) {
            console.error('Error clearing history:', error);
        }
    }
}

// Summary Functions
async function showSummary() {
    try {
        history = await storage.loadAll('history');

        if (history.length === 0) {
            alert('No transactions to summarize yet');
            return;
        }

        const summaryGrid = document.getElementById('summary-grid');

        // Calculate item sales
        const itemSales = {};
        history.forEach(transaction => {
            // Food items
            transaction.items.forEach(item => {
                if (!itemSales[item.name]) {
                    itemSales[item.name] = { quantity: 0, total: 0 };
                }
                itemSales[item.name].quantity += item.quantity;
                itemSales[item.name].total += item.total;
            });

            // Eco bags
            if (transaction.ecoBags > 0) {
                if (!itemSales['Eco Bag']) {
                    itemSales['Eco Bag'] = { quantity: 0, total: 0 };
                }
                itemSales['Eco Bag'].quantity += transaction.ecoBags;
                itemSales['Eco Bag'].total += transaction.ecoBags * ECO_BAG_PRICE;
            }
        });

        // Calculate totals
        const totalTransactions = history.length;
        const totalSales = history.reduce((sum, t) => sum + t.total, 0);
        const totalReceived = history.reduce((sum, t) => sum + t.paid, 0);
        const totalChange = history.reduce((sum, t) => sum + t.change, 0);
        const netCash = totalReceived - totalChange;

        // Build the table HTML
        let tableHTML = `
        <div class="section-title" style="margin-bottom:15px;">
        <i class="fas fa-utensils"></i> Items Sold
        </div>
        <table class="summary-table">
        <thead>
        <tr>
        <th>Item</th>
        <th class="quantity">Qty</th>
        <th class="amount">Amount</th>
        </tr>
        </thead>
        <tbody>
        `;

        // Add items to table
        Object.keys(itemSales).forEach(itemName => {
            const sales = itemSales[itemName];
            tableHTML += `
            <tr>
            <td>${itemName}</td>
            <td class="quantity">${sales.quantity}</td>
            <td class="amount">₱${formatNumber(sales.total)}</td>
            </tr>
            `;
        });

        tableHTML += `
        </tbody>
        </table>

        <div class="summary-totals">
        <div class="section-title" style="margin-bottom:15px;">
        <i class="fas fa-chart-bar"></i> Summary
        </div>

        <div class="summary-total-item">
        <div class="summary-total-label">
        <i class="fas fa-receipt"></i> Transactions
        </div>
        <div class="summary-total-value">${totalTransactions}</div>
        </div>

        <div class="summary-total-item">
        <div class="summary-total-label">
        <i class="fas fa-shopping-cart"></i> Total Sales
        </div>
        <div class="summary-total-value">₱${formatNumber(totalSales)}</div>
        </div>

        <div class="summary-total-item">
        <div class="summary-total-label">
        <i class="fas fa-money-bill-wave"></i> Total Received
        </div>
        <div class="summary-total-value">₱${formatNumber(totalReceived)}</div>
        </div>

        <div class="summary-total-item">
        <div class="summary-total-label">
        <i class="fas fa-coins"></i> Change Given
        </div>
        <div class="summary-total-value">₱${formatNumber(totalChange)}</div>
        </div>

        <div class="summary-net-cash">
        <div class="summary-total-item">
        <div class="summary-total-label">
        <i class="fas fa-cash-register"></i> Net Cash
        </div>
        <div class="summary-total-value">₱${formatNumber(netCash)}</div>
        </div>
        </div>
        </div>
        `;

        summaryGrid.innerHTML = tableHTML;
        document.getElementById('summary-modal').classList.add('show');
        play('btn');
    } catch (error) {
        console.error('Error showing summary:', error);
    }
}

function closeSummary() {
    document.getElementById('summary-modal').classList.remove('show');
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Load initial data
    await loadInitialData();

    // Initialize compact calculator
    const compactCalc = document.getElementById('compact-calculator');
    const calcButtons = [
        ['7', '8', '9'],
        ['4', '5', '6'],
        ['1', '2', '3'],
        ['C', '0', '⌫']
    ];

    calcButtons.forEach(row => {
        row.forEach(key => {
            const btn = document.createElement('button');
            btn.className = 'calc-btn-compact';
            if (/\d/.test(key)) btn.classList.add('number');
            else if (key === 'C') btn.classList.add('clear');

            btn.textContent = key;
            btn.addEventListener('click', () => {
                if (key === 'C') paymentClear();
                else if (key === '⌫') paymentBackspace();
                else if (/\d/.test(key)) paymentInput(parseInt(key));
            });
                compactCalc.appendChild(btn);
        });
    });

    // Set initial toggle states
    document.getElementById('theme-switch').classList.toggle('active', darkMode);
    document.getElementById('sound-switch').classList.toggle('active', soundOn);

    // Initial display update
    updateOrderDisplay();
    updatePendingDisplay();
    updateKitchenDisplays();
});
